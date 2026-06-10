/**
 * Ghost tape: a trajectory recorded by the RL agent in the Python twin of
 * this game (github.com/kingbootoshi/backrooms - backrooms-rl). The maze
 * generator is parity-tested between the two, so `seed` reproduces the exact
 * maze the agent ran - the camera just follows its footsteps.
 *
 * Tick layout (flat array, 20 Hz):
 *  [0]x [1]z [2]yaw [3]stalkerX [4]stalkerZ [5]stalkerActive
 *  [6]value [7]reward [8]cumReturn [9]bfsToExit
 *  [10..25] 16 lidar rays (0..1)
 *  [26..32] action probs: fwd, back, strafeL, strafeR, turnL, turnR, sprint
 */

export interface GhostTape {
  level: string;
  seed: number;
  dt: number;
  outcome: "win" | "death" | "timeout";
  policy: string;
  initialBfs: number;
  ticks: number[][];
}

export interface GhostFrame {
  x: number;
  z: number;
  yaw: number;
  sx: number;
  sz: number;
  sactive: boolean;
  value: number;
  reward: number;
  cumReturn: number;
  bfs: number;
  rays: number[];
  probs: number[]; // fwd, back, strafeL, strafeR, turnL, turnR, sprint
  t: number;
  progress: number; // 0..1 through the tape
}

export async function loadGhostTape(name: string): Promise<GhostTape> {
  const url = /^(https?:)?\/\//.test(name) || name.includes("/")
    ? name
    : `${import.meta.env.BASE_URL}replays/${name}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ghost tape not found: ${url}`);
  return (await res.json()) as GhostTape;
}

/** Samples the tape at an arbitrary time, interpolating between 20 Hz ticks. */
export class GhostPlayback {
  constructor(private readonly tape: GhostTape) {}

  get duration(): number {
    return this.tape.ticks.length * this.tape.dt;
  }

  get outcome(): "win" | "death" | "timeout" {
    return this.tape.outcome;
  }

  sample(time: number): GhostFrame {
    const ticks = this.tape.ticks;
    const ft = Math.max(0, time / this.tape.dt);
    const i = Math.min(ticks.length - 1, Math.floor(ft));
    const j = Math.min(ticks.length - 1, i + 1);
    const f = Math.min(1, ft - i);
    const a = ticks[i];
    const b = ticks[j];

    const lerp = (k: number) => a[k] + (b[k] - a[k]) * f;
    return {
      x: lerp(0),
      z: lerp(1),
      yaw: a[2] + shortestAngle(a[2], b[2]) * f,
      sx: lerp(3),
      sz: lerp(4),
      sactive: a[5] > 0.5,
      value: lerp(6),
      reward: a[7],
      cumReturn: lerp(8),
      bfs: a[9],
      rays: a.slice(10, 26),
      probs: a.slice(26, 33),
      t: time,
      progress: Math.min(1, ft / Math.max(1, ticks.length - 1)),
    };
  }
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
