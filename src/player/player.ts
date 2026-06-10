import * as THREE from "three";
import { CELL, Maze } from "../world/maze";
import type { Input } from "./input";

const EYE_HEIGHT = 1.62;
const RADIUS = 0.42;
const WALK_SPEED = 3.1;
const SPRINT_SPEED = 5.3;
const STAMINA_MAX = 6; // seconds of sprint
const STRIDE = 2.1; // meters per footstep

/**
 * First-person body: yaw/pitch look, axis-separated circle-vs-grid collision,
 * sprint stamina, head bob, and handheld camcorder sway baked into the camera.
 */
export class Player {
  readonly position: THREE.Vector3;
  yaw = 0;
  pitch = 0;
  stamina = STAMINA_MAX;
  speedNorm = 0; // 0..1 of sprint speed, for footstep volume
  private bobPhase = 0;
  private strideAccum = 0;
  private swayTime = 0;
  private lastSpeed = 0;

  onFootstep: ((volume: number) => void) | null = null;

  constructor(private readonly maze: Maze) {
    const s = maze.cellCenter(maze.spawn);
    this.position = new THREE.Vector3(s.x, EYE_HEIGHT, s.z);
    this.yaw = Math.random() * Math.PI * 2;
  }

  update(dt: number, input: Input): void {
    // look
    const { dx, dy } = input.consumeMouse();
    this.yaw -= dx * 0.0022;
    this.pitch -= dy * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);

    // stamina + speed
    const wantsSprint = input.sprinting && input.forward > 0;
    if (wantsSprint && this.stamina > 0) {
      this.stamina = Math.max(0, this.stamina - dt);
    } else {
      this.stamina = Math.min(STAMINA_MAX, this.stamina + dt * 0.7);
    }
    const exhausted = this.stamina <= 0.01;
    const speed = wantsSprint && !exhausted ? SPRINT_SPEED : WALK_SPEED;

    // movement in yaw space
    const f = input.forward;
    const s = input.strafe;
    const mag = Math.hypot(f, s);
    let vx = 0;
    let vz = 0;
    if (mag > 0) {
      const nf = f / mag;
      const ns = s / mag;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      vx = (-sin * nf + cos * ns) * speed;
      vz = (-cos * nf - sin * ns) * speed;
    }

    // axis-separated collision against wall cells
    const nx = this.resolveAxis(this.position.x + vx * dt, this.position.z, true);
    this.position.x = nx;
    const nz = this.resolveAxis(this.position.z + vz * dt, this.position.x, false);
    this.position.z = nz;

    // footsteps + bob
    const actualSpeed = mag > 0 ? speed : 0;
    this.lastSpeed = actualSpeed;
    this.speedNorm = actualSpeed / SPRINT_SPEED;
    if (actualSpeed > 0) {
      this.strideAccum += actualSpeed * dt;
      this.bobPhase += dt * (actualSpeed * 2.4);
      if (this.strideAccum >= STRIDE) {
        this.strideAccum -= STRIDE;
        this.onFootstep?.(0.6 + this.speedNorm * 0.5);
      }
    } else {
      this.bobPhase *= Math.max(0, 1 - dt * 6);
    }
    this.swayTime += dt;
  }

  /** Applies position + handheld camcorder feel to the camera. */
  applyToCamera(camera: THREE.PerspectiveCamera): void {
    const bobAmp = 0.024 + this.speedNorm * 0.05;
    const bobY = Math.sin(this.bobPhase * 2) * bobAmp;
    const bobX = Math.cos(this.bobPhase) * bobAmp * 0.6;

    // slow handheld drift, always present - nobody holds a camcorder still
    const t = this.swayTime;
    const driftYaw = Math.sin(t * 0.45) * 0.006 + Math.sin(t * 1.13) * 0.003;
    const driftPitch = Math.sin(t * 0.62 + 1.7) * 0.005 + Math.sin(t * 1.41) * 0.0024;
    const driftRoll = Math.sin(t * 0.51 + 0.6) * 0.008 + (this.lastSpeed > 0 ? Math.sin(this.bobPhase) * 0.006 : 0);

    camera.position.set(this.position.x + bobX * Math.cos(this.yaw), this.position.y + bobY, this.position.z - bobX * Math.sin(this.yaw));
    camera.rotation.order = "YXZ";
    camera.rotation.y = this.yaw + driftYaw;
    camera.rotation.x = this.pitch + driftPitch + bobY * 0.4;
    camera.rotation.z = driftRoll;
  }

  /** Move along one axis, clamping against any wall AABB the circle overlaps. */
  private resolveAxis(target: number, other: number, isX: boolean): number {
    const px = isX ? target : other;
    const pz = isX ? other : target;
    const minCx = Math.floor((px - RADIUS) / CELL);
    const maxCx = Math.floor((px + RADIUS) / CELL);
    const minCz = Math.floor((pz - RADIUS) / CELL);
    const maxCz = Math.floor((pz + RADIUS) / CELL);
    let result = target;
    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        if (!this.maze.isWall(cx, cz)) continue;
        const lo = (isX ? cx : cz) * CELL;
        const hi = lo + CELL;
        // overlap on the perpendicular axis?
        const perpLo = (isX ? cz : cx) * CELL;
        const perpHi = perpLo + CELL;
        if (other + RADIUS <= perpLo || other - RADIUS >= perpHi) continue;
        if (result + RADIUS > lo && result - RADIUS < hi) {
          // push out toward the side we came from
          result = result < (lo + hi) / 2 ? lo - RADIUS : hi + RADIUS;
        }
      }
    }
    return result;
  }
}
