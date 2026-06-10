import { mulberry32, randInt, type Rng } from "../util/rng";

export const SIZE = 64; // cells per side
export const CELL = 4; // meters per cell
export const WALL_H = 3.2; // ceiling height

const FLOOR = 0;
const WALL = 1;

export interface Cell {
  x: number;
  z: number;
}

/**
 * Grid-based backrooms layout. Rectangular wall slabs + pillar field over an
 * open floor, then a connectivity pass guarantees every floor cell is
 * reachable from spawn. Grid form keeps collision, line-of-sight, and
 * pathfinding O(1) per cell - the whole map is one Uint8Array.
 */
export interface MazeOpts {
  slabCount?: number;
  pillarChance?: number;
}

export class Maze {
  readonly grid: Uint8Array;
  readonly spawn: Cell;
  readonly exit: Cell;
  readonly exitFacing: Cell; // direction the exit doorway faces (unit cell offset)
  private readonly rng: Rng;
  private readonly slabCount: number;
  private readonly pillarChance: number;

  constructor(seed: number, opts: MazeOpts = {}) {
    this.rng = mulberry32(seed);
    this.slabCount = opts.slabCount ?? 430;
    this.pillarChance = opts.pillarChance ?? 0.55;
    this.grid = new Uint8Array(SIZE * SIZE);
    this.generate();
    this.spawn = { x: SIZE >> 1, z: SIZE >> 1 };
    this.carveSpawn();
    this.enforceConnectivity();
    this.exit = this.pickExit();
    this.exitFacing = this.pickExitFacing();
  }

  // ---- queries -------------------------------------------------------------

  isWall(cx: number, cz: number): boolean {
    if (cx < 0 || cz < 0 || cx >= SIZE || cz >= SIZE) return true;
    return this.grid[cz * SIZE + cx] === WALL;
  }

  worldToCell(wx: number, wz: number): Cell {
    return { x: Math.floor(wx / CELL), z: Math.floor(wz / CELL) };
  }

  cellCenter(c: Cell): { x: number; z: number } {
    return { x: (c.x + 0.5) * CELL, z: (c.z + 0.5) * CELL };
  }

  /** DDA raycast through the grid. True when the segment is unobstructed. */
  hasLineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return true;
    const steps = Math.ceil((dist / CELL) * 3);
    const sx = dx / steps;
    const sz = dz / steps;
    let x = ax;
    let z = az;
    for (let i = 0; i <= steps; i++) {
      const c = this.worldToCell(x, z);
      if (this.isWall(c.x, c.z)) return false;
      x += sx;
      z += sz;
    }
    return true;
  }

  /** BFS shortest path between cells. Returns cell list excluding `from`. */
  findPath(from: Cell, to: Cell): Cell[] {
    if (this.isWall(to.x, to.z) || this.isWall(from.x, from.z)) return [];
    const prev = new Int32Array(SIZE * SIZE).fill(-1);
    const queue = new Int32Array(SIZE * SIZE);
    const start = from.z * SIZE + from.x;
    const goal = to.z * SIZE + to.x;
    if (start === goal) return [];
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    prev[start] = start;
    while (head < tail) {
      const cur = queue[head++];
      if (cur === goal) break;
      const cx = cur % SIZE;
      const cz = (cur / SIZE) | 0;
      for (const [ox, oz] of NEIGHBORS) {
        const nx = cx + ox;
        const nz = cz + oz;
        if (nx < 0 || nz < 0 || nx >= SIZE || nz >= SIZE) continue;
        const ni = nz * SIZE + nx;
        if (prev[ni] !== -1 || this.grid[ni] === WALL) continue;
        prev[ni] = cur;
        queue[tail++] = ni;
      }
    }
    if (prev[goal] === -1) return [];
    const path: Cell[] = [];
    let cur = goal;
    while (cur !== start) {
      path.push({ x: cur % SIZE, z: (cur / SIZE) | 0 });
      cur = prev[cur];
    }
    return path.reverse();
  }

  /** Random reachable floor cell within a ring around `near` (cell units). */
  randomFloorNear(near: Cell, minDist: number, maxDist: number): Cell | null {
    for (let attempt = 0; attempt < 80; attempt++) {
      const ang = this.rng() * Math.PI * 2;
      const d = minDist + this.rng() * (maxDist - minDist);
      const x = Math.round(near.x + Math.cos(ang) * d);
      const z = Math.round(near.z + Math.sin(ang) * d);
      if (!this.isWall(x, z)) return { x, z };
    }
    return null;
  }

  // ---- generation ----------------------------------------------------------

  private generate(): void {
    const g = this.grid;
    // Border walls
    for (let i = 0; i < SIZE; i++) {
      g[i] = WALL;
      g[(SIZE - 1) * SIZE + i] = WALL;
      g[i * SIZE] = WALL;
      g[i * SIZE + SIZE - 1] = WALL;
    }
    // Rectangular wall slabs - the partitions that carve the open plane into
    // corridors and dead-end rooms.
    const slabCount = this.slabCount;
    for (let s = 0; s < slabCount; s++) {
      const horizontal = this.rng() < 0.5;
      const len = randInt(this.rng, 2, 9);
      const x0 = randInt(this.rng, 1, SIZE - 2);
      const z0 = randInt(this.rng, 1, SIZE - 2);
      for (let i = 0; i < len; i++) {
        const x = horizontal ? x0 + i : x0;
        const z = horizontal ? z0 : z0 + i;
        if (x > 0 && z > 0 && x < SIZE - 1 && z < SIZE - 1) {
          g[z * SIZE + x] = WALL;
        }
      }
    }
    // Pillar field - lone columns in the open stretches.
    for (let z = 2; z < SIZE - 2; z++) {
      for (let x = 2; x < SIZE - 2; x++) {
        if (x % 5 === 2 && z % 5 === 2 && this.rng() < this.pillarChance) {
          g[z * SIZE + x] = WALL;
        }
      }
    }
  }

  private carveSpawn(): void {
    for (let z = -1; z <= 1; z++) {
      for (let x = -1; x <= 1; x++) {
        this.grid[(this.spawn.z + z) * SIZE + (this.spawn.x + x)] = FLOOR;
      }
    }
  }

  /** Flood fill from spawn; everything unreachable becomes wall. */
  private enforceConnectivity(): void {
    const reachable = this.floodDistances(this.spawn);
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] === FLOOR && reachable[i] === -1) this.grid[i] = WALL;
    }
  }

  /** Exit lives among the deepest reachable cells - a real journey to find. */
  private pickExit(): Cell {
    const dist = this.floodDistances(this.spawn);
    let max = 0;
    for (let i = 0; i < dist.length; i++) if (dist[i] > max) max = dist[i];
    const threshold = Math.floor(max * 0.85);
    const candidates: number[] = [];
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] >= threshold) candidates.push(i);
    }
    const pick = candidates[randInt(this.rng, 0, candidates.length - 1)];
    return { x: pick % SIZE, z: (pick / SIZE) | 0 };
  }

  private pickExitFacing(): Cell {
    // Face the doorway against an adjacent wall so it reads as a passage out.
    for (const [ox, oz] of NEIGHBORS) {
      if (this.isWall(this.exit.x + ox, this.exit.z + oz)) return { x: ox, z: oz };
    }
    return { x: 1, z: 0 };
  }

  private floodDistances(from: Cell): Int32Array {
    const dist = new Int32Array(SIZE * SIZE).fill(-1);
    const queue = new Int32Array(SIZE * SIZE);
    let head = 0;
    let tail = 0;
    const start = from.z * SIZE + from.x;
    dist[start] = 0;
    queue[tail++] = start;
    while (head < tail) {
      const cur = queue[head++];
      const cx = cur % SIZE;
      const cz = (cur / SIZE) | 0;
      for (const [ox, oz] of NEIGHBORS) {
        const nx = cx + ox;
        const nz = cz + oz;
        if (nx < 0 || nz < 0 || nx >= SIZE || nz >= SIZE) continue;
        const ni = nz * SIZE + nx;
        if (dist[ni] !== -1 || this.grid[ni] === WALL) continue;
        dist[ni] = dist[cur] + 1;
        queue[tail++] = ni;
      }
    }
    return dist;
  }
}

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
