import * as THREE from "three";
import { AudioEngine } from "./audio/audio";
import { Stalker } from "./entity/stalker";
import { Input } from "./player/input";
import { Player } from "./player/player";
import { Recorder } from "./recording/recorder";
import { Osd, type OsdMode } from "./render/osd";
import { PostFx } from "./render/postfx";
import { Maze } from "./world/maze";
import { World } from "./world/world";

type GameState = "playing" | "dying" | "winning" | "ended";
export type EndReason = "death" | "escape";

/**
 * Orchestrates one full run: world, player, the other thing, camcorder
 * post-chain, procedural audio, and the tape recording of all of it.
 */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private readonly maze: Maze;
  private readonly world: World;
  private readonly player: Player;
  private readonly stalker: Stalker;
  private readonly input = new Input();
  private readonly osd = new Osd();
  private readonly postfx: PostFx;
  private readonly audio: AudioEngine;
  private readonly recorder = new Recorder();
  private readonly hemi: THREE.HemisphereLight;
  private readonly fadePlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  private state: GameState = "playing";
  private paused = false;
  private elapsed = 0;
  private sequenceTimer = 0;
  private flickerTimer = 3;
  private flickerLeft = 0;

  onEnd: ((reason: EndReason, tape: Blob) => void) | null = null;

  constructor(container: HTMLElement, audio: AudioEngine) {
    this.audio = audio;
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(1); // VHS pass supplies the softness; keeps fill-rate low
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 90);

    // world
    this.maze = new Maze((Math.random() * 0x7fffffff) | 0);
    this.world = new World(this.maze);
    this.scene.add(this.world.group);
    this.scene.fog = new THREE.FogExp2(0x6e6234, 0.052);
    this.scene.background = new THREE.Color(0x6e6234);

    // lighting - one hemisphere + ambient + a dim carry-light at the player
    this.hemi = new THREE.HemisphereLight(0xfff3c4, 0x57492a, 1.05);
    this.scene.add(this.hemi);
    this.scene.add(new THREE.AmbientLight(0xfff0c0, 0.35));
    const carry = new THREE.PointLight(0xffeec0, 14, 16, 1.8);
    carry.name = "carry";
    this.scene.add(carry);

    // actors
    this.player = new Player(this.maze);
    this.stalker = new Stalker(this.maze);
    this.scene.add(this.stalker.mesh);
    this.player.onFootstep = (v) => this.audio.footstep(v);
    this.stalker.onStep = (v, pan) => this.audio.entityStep(v, pan);

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

    window.addEventListener("resize", () => this.onResize());
    document.addEventListener("pointerlockchange", () => {
      if (!document.pointerLockElement && this.state === "playing") this.paused = true;
    });
    // clicking the view always re-arms mouse look if it was ever dropped
    this.renderer.domElement.addEventListener("click", () => {
      if (this.state === "playing" && !document.pointerLockElement) this.requestPointer();
    });
  }

  /** Call from a user gesture: unlocks audio, starts the tape, locks pointer. */
  start(): void {
    this.audio.start();
    this.recorder.start(this.renderer.domElement, this.audio.audioStream);
    this.requestPointer();
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  requestPointer(): void {
    this.paused = false;
    this.renderer.domElement.requestPointerLock();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Dev/test escape hatch - jump straight to an ending sequence. */
  forceEnd(reason: EndReason): void {
    if (this.state !== "playing") return;
    this.state = reason === "death" ? "dying" : "winning";
    this.sequenceTimer = 0;
    if (reason === "death") {
      this.audio.deathSting();
      this.postfx.slamGlitch(1);
    } else {
      this.audio.tapeEnd();
    }
  }

  // ---- main loop -------------------------------------------------------------

  private tick(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const simDt = this.paused ? 0 : dt;
    this.elapsed += simDt;

    switch (this.state) {
      case "playing":
        this.tickPlaying(simDt);
        break;
      case "dying":
        this.tickDying(simDt);
        break;
      case "winning":
        this.tickWinning(simDt);
        break;
      case "ended":
        return;
    }

    // light flicker - the fluorescents are never quite stable
    this.tickFlicker(simDt);

    // carry light follows the camera
    const carry = this.scene.getObjectByName("carry");
    carry?.position.copy(this.player.position).setY(this.player.position.y + 0.2);

    this.audio.update(simDt, this.stalker.threat);

    let osdMode: OsdMode = "rec";
    if (this.paused) osdMode = "pause";
    if (this.state === "dying") osdMode = "lost";
    if (this.state === "winning" && this.sequenceTimer > 0.9) osdMode = "end";
    this.osd.update(osdMode, this.elapsed);

    this.postfx.render(this.elapsed, dt);
  }

  private tickPlaying(dt: number): void {
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
      document.exitPointerLock();
      return;
    }

    // reached the way out?
    const ex = this.world.exitPosition;
    const dx = this.player.position.x - ex.x;
    const dz = this.player.position.z - ex.z;
    if (Math.hypot(dx, dz) < 1.5) {
      this.state = "winning";
      this.sequenceTimer = 0;
      this.audio.tapeEnd();
      document.exitPointerLock();
    }
  }

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

  private tickWinning(dt: number): void {
    this.sequenceTimer += dt;
    this.player.applyToCamera(this.camera);
    this.fadePlane.material.opacity = Math.min(1, this.sequenceTimer / 1.2);
    this.postfx.setGlitch(0.15);
    if (this.sequenceTimer > 2.6) void this.finish("escape");
  }

  private tickFlicker(dt: number): void {
    this.flickerTimer -= dt;
    if (this.flickerTimer <= 0) {
      this.flickerLeft = 0.08 + Math.random() * 0.22;
      this.flickerTimer = 3 + Math.random() * 7 - this.stalker.threat * 2.5;
    }
    if (this.flickerLeft > 0) {
      this.flickerLeft -= dt;
      this.hemi.intensity = 1.05 - Math.random() * 0.5;
    } else {
      this.hemi.intensity += (1.05 - this.hemi.intensity) * Math.min(1, dt * 10);
    }
  }

  private async finish(reason: EndReason): Promise<void> {
    if (this.state === "ended") return;
    this.state = "ended";
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

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
