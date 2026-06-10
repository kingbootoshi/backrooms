import * as THREE from "three";
import { AudioEngine } from "./audio/audio";
import { Stalker } from "./entity/stalker";
import { Input } from "./player/input";
import { Player } from "./player/player";
import { TouchControls } from "./player/touch";
import { Recorder } from "./recording/recorder";
import { Osd, type OsdMode } from "./render/osd";
import { PostFx } from "./render/postfx";
import { GhostPlayback, type GhostTape } from "./replay/ghost";
import { GhostHud } from "./replay/hud";
import { FINALE_LINES, LEVELS, type LevelSpec, type ScriptLine } from "./story/levels";
import { Maze } from "./world/maze";
import { World } from "./world/world";

type GameState = "playing" | "descending" | "dying" | "finale" | "ended";
export type EndReason = "death" | "escape";

const MONOLOGUE_CPS = 20; // finale typing speed, chars per second
const MONOLOGUE_HOLD = 1.7; // seconds each finale line lingers after typing

/** The tape's closing words when the runner was never human. */
const GHOST_FINALE_LINES: string[] = [
  "this tape was not held by human hands.",
  "sixty million attempts are on it.",
  "it learned to run.",
];

/**
 * Orchestrates one full descent: three levels on the same engine, the other
 * thing, camcorder post-chain, procedural audio, the lines the tape types,
 * and the recording of all of it - one continuous tape, top to bottom.
 */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private readonly input = new Input();
  private readonly osd = new Osd();
  private readonly postfx: PostFx;
  private readonly audio: AudioEngine;
  private readonly recorder = new Recorder();
  private readonly hemi: THREE.HemisphereLight;
  private readonly ambientLight: THREE.AmbientLight;
  private readonly carry: THREE.PointLight;
  private readonly fadePlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  private readonly isTouch = window.matchMedia("(pointer: coarse)").matches;
  private touch: TouchControls | null = null;

  // level-owned objects, rebuilt on every descent
  private maze!: Maze;
  private world!: World;
  private player!: Player;
  private stalker!: Stalker;
  private levelIndex = 0;
  private level!: LevelSpec;
  private levelElapsed = 0;
  private scriptQueue: ScriptLine[] = [];

  private state: GameState = "playing";
  private paused = false;
  private elapsed = 0;
  private sequenceTimer = 0;
  private descendLoaded = false;
  private flickerTimer = 3;
  private flickerLeft = 0;

  // finale timeline, computed once
  private finaleStarts: number[] = [];
  private finaleRewindAt = 0;
  private finaleEndAt = 0;
  private finaleRewindPlayed = false;
  private finaleEndPlayed = false;
  private finaleLines: string[] = FINALE_LINES;

  // ghost replay - the RL agent's recorded run, driven instead of input
  private readonly ghost: GhostPlayback | null = null;
  private readonly ghostTape: GhostTape | null = null;
  private ghostHud: GhostHud | null = null;

  onEnd: ((reason: EndReason, tape: Blob) => void) | null = null;

  constructor(container: HTMLElement, audio: AudioEngine, ghostTape: GhostTape | null = null) {
    this.audio = audio;
    if (ghostTape) {
      this.ghostTape = ghostTape;
      this.ghost = new GhostPlayback(ghostTape);
      this.ghostHud = new GhostHud(ghostTape);
      this.finaleLines = GHOST_FINALE_LINES;
    }
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(1); // VHS pass supplies the softness; keeps fill-rate low
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 90);

    // lighting rig - one hemisphere + ambient + a dim carry-light, retuned per level
    this.hemi = new THREE.HemisphereLight(0xfff3c4, 0x57492a, 1.05);
    this.scene.add(this.hemi);
    this.ambientLight = new THREE.AmbientLight(0xfff0c0, 0.35);
    this.scene.add(this.ambientLight);
    this.carry = new THREE.PointLight(0xffeec0, 14, 16, 1.8);
    this.scene.add(this.carry);

    // in-camera fade quad - end-of-tape fades are burned into the recording
    this.fadePlane = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, fog: false }),
    );
    this.fadePlane.renderOrder = 999;
    this.fadePlane.position.z = -1;
    this.camera.add(this.fadePlane);
    this.scene.add(this.camera);

    this.postfx = new PostFx(this.renderer, this.scene, this.camera, this.osd.texture);
    this.postfx.setSize(window.innerWidth, window.innerHeight);

    this.loadLevel(this.ghostTape ? levelIndexByName(this.ghostTape.level) : 0);

    window.addEventListener("resize", () => this.onResize());
    if (this.ghost) {
      // ghost runs need no input and no pointer lock - the tape drives
    } else if (this.isTouch) {
      // phones: on-screen thumb controls, no pointer lock, no pause loop
      this.touch = new TouchControls(this.input, container);
    } else {
      document.addEventListener("pointerlockchange", () => {
        if (!document.pointerLockElement && this.state === "playing") this.paused = true;
      });
      // clicking the view always re-arms mouse look if it was ever dropped
      this.renderer.domElement.addEventListener("click", () => {
        if (this.state === "playing" && !document.pointerLockElement) this.requestPointer();
      });
    }
  }

  /** Call from a user gesture: unlocks audio, starts the tape, locks pointer. */
  start(): void {
    this.audio.start();
    try {
      // recording is a bonus, never a blocker - some mobile browsers
      // refuse canvas capture and the run must still play
      this.recorder.start(this.renderer.domElement, this.audio.audioStream);
    } catch {
      /* no tape on this device */
    }
    this.requestPointer();
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  requestPointer(): void {
    this.paused = false;
    if (!this.isTouch && !this.ghost) this.renderer.domElement.requestPointerLock();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Dev/test escape hatches. */
  forceEnd(reason: EndReason): void {
    if (this.state !== "playing") return;
    if (reason === "death") {
      this.state = "dying";
      this.sequenceTimer = 0;
      this.audio.deathSting();
      this.postfx.slamGlitch(1);
    } else {
      this.startFinale();
    }
  }

  /** Dev/test: jump straight down one level. */
  skipLevel(): void {
    if (this.state !== "playing") return;
    if (this.levelIndex < LEVELS.length - 1) this.startDescend();
    else this.startFinale();
  }

  // ---- level loading -----------------------------------------------------------

  private loadLevel(index: number): void {
    // tear down the previous floor completely
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.dispose();
    }
    if (this.stalker) this.scene.remove(this.stalker.mesh);

    this.levelIndex = index;
    this.level = LEVELS[index];
    const spec = this.level;

    // ghost tapes carry the seed of the maze the agent actually ran -
    // the generator is parity-tested, so this rebuilds its exact world
    this.maze = new Maze(this.ghostTape ? this.ghostTape.seed : (Math.random() * 0x7fffffff) | 0, {
      slabCount: spec.mazeSlabs,
      pillarChance: spec.mazePillarChance,
    });
    this.world = new World(this.maze, spec.palette, spec.exitSignText);
    this.scene.add(this.world.group);

    this.scene.fog = new THREE.FogExp2(spec.palette.fogColor, spec.palette.fogDensity);
    this.scene.background = new THREE.Color(spec.palette.fogColor);

    this.hemi.color.set(spec.palette.hemiSky);
    this.hemi.groundColor.set(spec.palette.hemiGround);
    this.hemi.intensity = spec.palette.hemiIntensity;
    this.ambientLight.color.set(spec.palette.ambientColor);
    this.ambientLight.intensity = spec.palette.ambientIntensity;
    this.carry.color.set(spec.palette.carryColor);
    this.carry.intensity = spec.palette.carryIntensity;

    this.player = new Player(this.maze);
    this.stalker = new Stalker(this.maze, spec.stalker);
    this.scene.add(this.stalker.mesh);
    this.player.onFootstep = (v) => this.audio.footstep(v);
    this.stalker.onStep = (v, pan) => this.audio.entityStep(v, pan);
    if (spec.glimpseLine) {
      const line = spec.glimpseLine;
      this.stalker.onGlimpse = () => this.osd.showLine(line, 5);
    }

    this.audio.setBeds(spec.music, spec.ambient, spec.musicVol, spec.ambientVol);
    this.osd.setDateBurn(spec.dateBurn, spec.freezeClock);

    this.levelElapsed = 0;
    this.scriptQueue = [...spec.script];
    if (spec.descendLines) {
      // typed over black while the next floor fades in
      this.scriptQueue.unshift(
        { at: 0.2, text: spec.descendLines[0], hold: 2.2 },
        { at: 2.9, text: spec.descendLines[1] ?? "", hold: 2.2 },
      );
    }
  }

  // ---- main loop -------------------------------------------------------------

  private tick(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const simDt = this.paused ? 0 : dt;
    this.elapsed += simDt;

    switch (this.state) {
      case "playing":
        this.levelElapsed += simDt;
        this.runScript();
        this.tickPlaying(simDt);
        break;
      case "descending":
        this.levelElapsed += dt;
        this.runScript();
        this.tickDescending(dt);
        break;
      case "dying":
        this.tickDying(simDt);
        break;
      case "finale":
        this.tickFinale(dt);
        return; // finale owns the OSD + render
      case "ended":
        return;
    }

    // light flicker - the fluorescents are never quite stable
    this.tickFlicker(simDt);

    // carry light follows the camera
    this.carry.position.copy(this.player.position).setY(this.player.position.y + 0.2);

    this.audio.update(simDt, this.stalker.threat);

    let osdMode: OsdMode = "rec";
    if (this.paused) osdMode = "pause";
    if (this.state === "dying") osdMode = "lost";
    this.osd.update(osdMode, this.elapsed);

    this.postfx.render(this.elapsed, dt);
  }

  private runScript(): void {
    while (this.scriptQueue.length > 0 && this.scriptQueue[0].at <= this.levelElapsed) {
      const line = this.scriptQueue.shift();
      if (line && line.text) this.osd.showLine(line.text, line.hold);
    }
  }

  private tickPlaying(dt: number): void {
    if (this.ghost) {
      this.tickGhost(dt);
      return;
    }
    if (!this.paused) {
      this.player.update(dt, this.input);
    }
    this.player.applyToCamera(this.camera);

    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3(forward.z, 0, -forward.x).negate();

    this.stalker.update(dt, this.player.position, forward, right);

    // ambient dread follows proximity
    this.postfx.setGlitch(this.stalker.threat * 0.5);

    if (this.stalker.killed) {
      this.state = "dying";
      this.sequenceTimer = 0;
      this.audio.deathSting();
      this.postfx.slamGlitch(1);
      document.exitPointerLock?.();
      return;
    }

    // reached the way out?
    const ex = this.world.exitPosition;
    const dx = this.player.position.x - ex.x;
    const dz = this.player.position.z - ex.z;
    if (Math.hypot(dx, dz) < 1.5) {
      if (this.levelIndex < LEVELS.length - 1) {
        this.startDescend();
      } else {
        this.startFinale();
      }
    }
  }

  // ---- ghost replay ------------------------------------------------------------

  /** The tape drives: camera and entity follow the RL agent's recorded run. */
  private tickGhost(dt: number): void {
    const ghost = this.ghost as GhostPlayback;
    const frame = ghost.sample(this.levelElapsed);

    this.player.ghostMove(frame.x, frame.z, frame.yaw, dt);
    this.player.applyToCamera(this.camera);
    this.stalker.ghostSet(frame.sx, frame.sz, frame.sactive, this.player.position, dt);
    this.postfx.setGlitch(this.stalker.threat * 0.5);
    this.ghostHud?.update(frame);

    if (this.levelElapsed >= ghost.duration) {
      if (ghost.outcome === "death") {
        this.state = "dying";
        this.sequenceTimer = 0;
        this.audio.deathSting();
        this.postfx.slamGlitch(1);
      } else {
        // win or timeout - the tape ends either way
        this.startFinale();
      }
    }
  }

  // ---- the descent -------------------------------------------------------------

  private startDescend(): void {
    this.state = "descending";
    this.sequenceTimer = 0;
    this.descendLoaded = false;
    this.osd.clearLine();
    this.audio.doorSlam();
    this.postfx.slamGlitch(0.85);
  }

  private tickDescending(dt: number): void {
    this.sequenceTimer += dt;
    const seq = this.sequenceTimer;

    // slam to black, swap the world underneath, hold while the tape talks,
    // then open the eyes one floor lower
    if (seq < 0.5) {
      this.fadePlane.material.opacity = Math.min(1, seq / 0.45);
    } else if (!this.descendLoaded) {
      this.descendLoaded = true;
      this.fadePlane.material.opacity = 1;
      this.loadLevel(this.levelIndex + 1);
      this.postfx.setGlitch(0.25);
    } else if (seq > 5.6) {
      const t = (seq - 5.6) / 1.0;
      this.fadePlane.material.opacity = Math.max(0, 1 - t);
      if (t >= 1) {
        this.fadePlane.material.opacity = 0;
        this.postfx.setGlitch(0);
        this.state = "playing";
      }
    }
    this.player.applyToCamera(this.camera);
    this.audio.update(dt, 0);
  }

  // ---- endings -------------------------------------------------------------

  private tickDying(dt: number): void {
    this.sequenceTimer += dt;
    // wrench the view onto it
    const toIt = new THREE.Vector3()
      .copy(this.stalker.position)
      .setY(2.4)
      .sub(this.player.position);
    const targetYaw = Math.atan2(-toIt.x, -toIt.z);
    const targetPitch = Math.atan2(toIt.y, Math.hypot(toIt.x, toIt.z));
    const k = Math.min(1, dt * 14);
    this.player.yaw += shortestAngle(this.player.yaw, targetYaw) * k;
    this.player.pitch += (targetPitch - this.player.pitch) * k;
    this.player.applyToCamera(this.camera);
    // it closes the last distance itself
    this.stalker.mesh.position.lerp(
      new THREE.Vector3().copy(this.player.position).setY(0).addScaledVector(toIt.clone().setY(0).normalize(), -0.4),
      Math.min(1, dt * 9),
    );
    this.postfx.slamGlitch(Math.min(1, 0.55 + this.sequenceTimer * 0.5));
    if (this.sequenceTimer > 1.7) void this.finish("death");
  }

  private startFinale(): void {
    this.state = "finale";
    this.sequenceTimer = 0;
    this.osd.clearLine();
    this.audio.hushBeds();
    document.exitPointerLock?.();
    // timeline: fade to black, then each line types and lingers
    let t = 1.4;
    this.finaleStarts = this.finaleLines.map((line) => {
      const start = t;
      t += line.length / MONOLOGUE_CPS + MONOLOGUE_HOLD;
      return start;
    });
    this.finaleRewindAt = t + 0.4;
    this.finaleEndAt = t + 2.9;
  }

  private tickFinale(dt: number): void {
    this.sequenceTimer += dt;
    const seq = this.sequenceTimer;

    this.fadePlane.material.opacity = Math.min(1, seq / 0.9);
    this.postfx.setGlitch(0.12);

    if (!this.finaleRewindPlayed && seq >= this.finaleRewindAt) {
      this.finaleRewindPlayed = true;
      this.audio.tapeRewind();
    }
    if (!this.finaleEndPlayed && seq >= this.finaleEndAt) {
      this.finaleEndPlayed = true;
      this.audio.tapeEnd();
    }

    if (seq >= this.finaleEndAt + 1.2) {
      this.osd.update("end", this.elapsed);
      this.postfx.render(this.elapsed, dt);
      if (seq >= this.finaleEndAt + 3.2) void this.finish("escape");
      return;
    }

    // which line is up?
    let current = -1;
    for (let i = 0; i < this.finaleStarts.length; i++) {
      if (seq >= this.finaleStarts[i]) current = i;
    }
    if (current >= 0) {
      const line = this.finaleLines[current];
      const chars = Math.floor((seq - this.finaleStarts[current]) * MONOLOGUE_CPS);
      this.osd.drawMonologue(line, chars);
    } else {
      this.osd.drawMonologue("", 0);
    }

    this.postfx.render(this.elapsed, dt);
  }

  private tickFlicker(dt: number): void {
    this.flickerTimer -= dt;
    if (this.flickerTimer <= 0) {
      this.flickerLeft = 0.08 + Math.random() * 0.22;
      this.flickerTimer = 3 + Math.random() * 7 - this.stalker.threat * 2.5;
    }
    const base = this.level.palette.hemiIntensity;
    if (this.flickerLeft > 0) {
      this.flickerLeft -= dt;
      this.hemi.intensity = base - Math.random() * base * 0.5;
    } else {
      this.hemi.intensity += (base - this.hemi.intensity) * Math.min(1, dt * 10);
    }
  }

  private async finish(reason: EndReason): Promise<void> {
    if (this.state === "ended") return;
    this.state = "ended";
    this.touch?.setVisible(false);
    this.ghostHud?.destroy();
    this.ghostHud = null;
    // hold the final frame on tape for a beat before cutting
    await delay(350);
    const tape = await this.recorder.stop();
    this.renderer.setAnimationLoop(null);
    this.onEnd?.(reason, tape);
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.postfx.setSize(window.innerWidth, window.innerHeight);
  }
}

function levelIndexByName(name: string): number {
  const i = LEVELS.findIndex((l) => l.name === name);
  return i >= 0 ? i : 0;
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
