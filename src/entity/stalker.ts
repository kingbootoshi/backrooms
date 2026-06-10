import * as THREE from "three";
import type { StalkerSpec } from "../story/levels";
import { CELL, Maze } from "../world/maze";

type State = "dormant" | "stalking" | "chasing" | "cooldown" | "apparition";

const SIGHT_RANGE = 24;
const KILL_RANGE = 1.05;
const STRIDE = 1.0;

/**
 * The other thing on the tape. In "hunt" mode it cycles dormant -> stalking
 * (drifting toward the player's general area) -> chasing (direct BFS pursuit).
 * Eye contact slows it; breaking line of sight is the player's only defense.
 * In "glimpse" mode it never hunts: it appears far off in the fog, stands
 * facing you, and is gone when you get close. Some floors it only watches.
 */
export class Stalker {
  readonly mesh: THREE.Group;
  readonly position = new THREE.Vector3();
  /** 0..1 proximity threat for audio + glitch. 0 while inactive. */
  threat = 0;
  killed = false;

  private state: State = "dormant";
  private stateTimer: number;
  private path: Array<{ x: number; z: number }> = [];
  private repathTimer = 0;
  private lostSightTimer = 0;
  private strideAccum = 0;
  private elapsed = 0;
  private head!: THREE.Object3D;
  private headTwitchTarget = new THREE.Euler();
  private twitchTimer = 0;
  private glimpsed = false;

  onStep: ((volume: number, pan: number) => void) | null = null;
  onGlimpse: (() => void) | null = null;

  constructor(
    private readonly maze: Maze,
    private readonly spec: StalkerSpec,
  ) {
    this.mesh = this.buildMesh();
    this.mesh.visible = false;
    this.stateTimer = spec.grace;
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    cameraForward: THREE.Vector3,
    cameraRight: THREE.Vector3,
  ): void {
    this.elapsed += dt;
    this.stateTimer -= dt;

    if (this.spec.mode === "glimpse") {
      this.updateGlimpse(dt, playerPos);
      return;
    }

    switch (this.state) {
      case "dormant":
      case "cooldown":
        this.threat = 0;
        if (this.stateTimer <= 0) this.spawn(playerPos);
        return;
      case "stalking":
      case "chasing":
        break;
      case "apparition":
        return; // hunt mode never enters apparition
    }

    const dx = playerPos.x - this.position.x;
    const dz = playerPos.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    const hasLos = this.maze.hasLineOfSight(this.position.x, this.position.z, playerPos.x, playerPos.z);

    // threat drives drone volume + vhs glitch
    this.threat = THREE.MathUtils.clamp(1 - dist / 30, 0, 1) * (this.state === "chasing" ? 1 : 0.7);

    // state transitions
    if (this.state === "stalking" && hasLos && dist < SIGHT_RANGE) {
      this.state = "chasing";
      this.lostSightTimer = 0;
    } else if (this.state === "chasing") {
      if (!hasLos) {
        this.lostSightTimer += dt;
        if (this.lostSightTimer > 7) this.state = "stalking";
      } else {
        this.lostSightTimer = 0;
      }
    }

    // hunt window expires only when it has lost the player
    if (this.stateTimer <= 0 && this.state === "stalking" && dist > 22) {
      this.despawn();
      return;
    }

    // kill check
    if (dist < KILL_RANGE) {
      this.killed = true;
      return;
    }

    // being watched pins it down
    const toEntity = new THREE.Vector3(dx, 0, dz).normalize();
    const watched = hasLos && dist < 30 && cameraForward.dot(toEntity) > 0.58;

    // pathing
    this.repathTimer -= dt;
    if (this.repathTimer <= 0) {
      this.repathTimer = this.state === "chasing" ? 0.45 : 1.2;
      const myCell = this.maze.worldToCell(this.position.x, this.position.z);
      const target =
        this.state === "chasing"
          ? this.maze.worldToCell(playerPos.x, playerPos.z)
          : this.maze.randomFloorNear(this.maze.worldToCell(playerPos.x, playerPos.z), 2, 6) ??
            this.maze.worldToCell(playerPos.x, playerPos.z);
      this.path = this.maze.findPath(myCell, target);
    }

    // movement along path
    const ramp = Math.min(1.3, (this.elapsed / 300) * 1.3); // slow aggression ramp
    let speed = this.state === "chasing" ? this.spec.chaseSpeed + ramp : this.spec.stalkSpeed;
    if (watched) speed *= this.spec.watchedFactor;

    if (this.path.length > 0) {
      const next = this.path[0];
      const tx = (next.x + 0.5) * CELL;
      const tz = (next.z + 0.5) * CELL;
      const mx = tx - this.position.x;
      const mz = tz - this.position.z;
      const md = Math.hypot(mx, mz);
      if (md < 0.35) {
        this.path.shift();
      } else {
        const step = Math.min(speed * dt, md);
        this.position.x += (mx / md) * step;
        this.position.z += (mz / md) * step;
        this.strideAccum += step;
        // face movement direction
        this.mesh.rotation.y = THREE.MathUtils.damp(
          this.mesh.rotation.y,
          Math.atan2(mx, mz),
          8,
          dt,
        );
      }
    } else if (this.state === "chasing" && hasLos) {
      // terminal lunge - straight line, no grid
      const step = speed * dt;
      this.position.x += (dx / dist) * step;
      this.position.z += (dz / dist) * step;
      this.strideAccum += step;
      this.mesh.rotation.y = Math.atan2(dx, dz);
    }

    // footfalls, panned by where it stands relative to the view
    if (this.strideAccum >= STRIDE) {
      this.strideAccum -= STRIDE;
      const vol = THREE.MathUtils.clamp(1 - dist / 34, 0, 1);
      if (vol > 0.02) this.onStep?.(vol, cameraRight.dot(toEntity));
    }

    this.animate(dt);
    this.mesh.position.copy(this.position);
  }

  /**
   * Ghost mode: position driven by a recorded trajectory. Keeps the twitch
   * animation and footfalls; faces its direction of travel toward the player.
   */
  ghostSet(x: number, z: number, visible: boolean, playerPos: THREE.Vector3, dt: number): void {
    if (!visible) {
      this.mesh.visible = false;
      this.threat = 0;
      return;
    }
    const moved = Math.hypot(x - this.position.x, z - this.position.z);
    this.position.set(x, 0, z);
    this.strideAccum += moved;
    const dx = playerPos.x - x;
    const dz = playerPos.z - z;
    const dist = Math.hypot(dx, dz);
    this.mesh.rotation.y = THREE.MathUtils.damp(this.mesh.rotation.y, Math.atan2(dx, dz), 8, dt);
    this.threat = THREE.MathUtils.clamp(1 - dist / 30, 0, 1);
    if (this.strideAccum >= STRIDE) {
      this.strideAccum -= STRIDE;
      const vol = THREE.MathUtils.clamp(1 - dist / 34, 0, 1);
      if (vol > 0.02 && dist > 1e-3) {
        const toEntity = new THREE.Vector3(-dx / dist, 0, -dz / dist);
        const right = new THREE.Vector3(Math.cos(this.mesh.rotation.y), 0, -Math.sin(this.mesh.rotation.y));
        this.onStep?.(vol, right.dot(toEntity));
      }
    }
    this.mesh.visible = true;
    this.animate(dt);
    this.mesh.position.copy(this.position);
  }

  // ---- glimpse mode ----------------------------------------------------------

  /** It only watches. Appears far off with line of sight, vanishes up close. */
  private updateGlimpse(dt: number, playerPos: THREE.Vector3): void {
    if (this.state !== "apparition") {
      this.threat = 0;
      if (this.stateTimer <= 0) this.spawnApparition(playerPos);
      return;
    }

    const dx = playerPos.x - this.position.x;
    const dz = playerPos.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    // face the player, perfectly still - the twitch does the rest
    this.mesh.rotation.y = Math.atan2(dx, dz);
    this.threat = 0.3;

    if (dist < 9 || this.stateTimer <= 0) {
      this.mesh.visible = false;
      this.state = "dormant";
      this.stateTimer = this.spec.cooldown + Math.random() * 18;
      this.threat = 0;
      return;
    }
    this.animate(dt);
    this.mesh.position.copy(this.position);
  }

  private spawnApparition(playerPos: THREE.Vector3): void {
    const playerCell = this.maze.worldToCell(playerPos.x, playerPos.z);
    for (let i = 0; i < 60; i++) {
      const cell = this.maze.randomFloorNear(playerCell, 4, 6);
      if (!cell) continue;
      const c = this.maze.cellCenter(cell);
      if (!this.maze.hasLineOfSight(c.x, c.z, playerPos.x, playerPos.z)) continue;
      const d = Math.hypot(c.x - playerPos.x, c.z - playerPos.z);
      if (d < 12) continue; // never too close
      this.position.set(c.x, 0, c.z);
      this.mesh.position.copy(this.position);
      this.mesh.visible = true;
      this.state = "apparition";
      this.stateTimer = 7;
      if (!this.glimpsed) {
        this.glimpsed = true;
        this.onGlimpse?.();
      }
      return;
    }
    this.stateTimer = 6; // no valid spot - retry shortly
  }

  // ---- hunt mode internals ----------------------------------------------------

  private spawn(playerPos: THREE.Vector3): void {
    const playerCell = this.maze.worldToCell(playerPos.x, playerPos.z);
    // out of sight, beyond the fog line
    for (let i = 0; i < 40; i++) {
      const cell = this.maze.randomFloorNear(playerCell, 8, 14);
      if (!cell) continue;
      const c = this.maze.cellCenter(cell);
      if (this.maze.hasLineOfSight(c.x, c.z, playerPos.x, playerPos.z)) continue;
      this.position.set(c.x, 0, c.z);
      this.mesh.position.copy(this.position);
      this.mesh.visible = true;
      this.state = "stalking";
      this.stateTimer = this.spec.huntDuration;
      this.path = [];
      this.repathTimer = 0;
      return;
    }
    // no valid spot found - retry shortly
    this.stateTimer = 5;
  }

  private despawn(): void {
    this.mesh.visible = false;
    this.state = "cooldown";
    // cooldowns shrink as the tape runs on
    this.stateTimer = Math.max(10, this.spec.cooldown - this.elapsed / 30);
    this.threat = 0;
  }

  private animate(dt: number): void {
    // head twitch - small, wrong, constant
    this.twitchTimer -= dt;
    if (this.twitchTimer <= 0) {
      this.twitchTimer = 0.3 + Math.random() * 1.4;
      this.headTwitchTarget.set(
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 1.1,
        (Math.random() - 0.5) * 0.45,
      );
    }
    this.head.rotation.x = THREE.MathUtils.damp(this.head.rotation.x, this.headTwitchTarget.x, 14, dt);
    this.head.rotation.y = THREE.MathUtils.damp(this.head.rotation.y, this.headTwitchTarget.y, 14, dt);
    this.head.rotation.z = THREE.MathUtils.damp(this.head.rotation.z, this.headTwitchTarget.z, 14, dt);
    // uneven vertical hitch while moving
    this.mesh.position.y = Math.abs(Math.sin(this.strideAccum * Math.PI)) * 0.06;
  }

  /** Tall, thin, black silhouette. The fog does the rest. */
  private buildMesh(): THREE.Group {
    const g = new THREE.Group();
    const black = new THREE.MeshBasicMaterial({ color: 0x050505 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 1.95, 0.3), black);
    body.position.y = 1.0;
    g.add(body);

    this.head = new THREE.Group();
    this.head.position.y = 2.18;
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.3), black);
    skull.position.y = 0.18;
    this.head.add(skull);
    // pale eyes - the only part of it that catches light
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xcfc6a8 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.PlaneGeometry(0.045, 0.028), eyeMat);
      eye.position.set(side * 0.075, 0.24, 0.152);
      this.head.add(eye);
    }
    g.add(this.head);

    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.25, 0.09), black);
      arm.position.set(side * 0.3, 1.25, 0);
      arm.rotation.z = side * 0.07;
      g.add(arm);
    }
    g.scale.setScalar(1.18); // just past human - reads wrong at a distance
    return g;
  }
}
