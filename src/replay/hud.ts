/**
 * Live RL telemetry over the ghost replay - what the policy is "thinking",
 * rendered like lab equipment bolted onto a camcorder feed.
 *
 * Panels: value-function sparkline, lidar radar (the 16 rays the agent sees),
 * action probabilities, progress-to-exit, entity proximity, reward ticker.
 * Pure DOM + one canvas; sits OVER the game canvas, not burned into the tape.
 */

import type { GhostFrame, GhostTape } from "./ghost";

const W = 320;
const PANEL_BG = "rgba(6, 10, 6, 0.82)";
const GREEN = "#7dff9a";
const DIM = "#3f7a4d";
const AMBER = "#ffd27d";
const RED = "#ff6a5e";

export class GhostHud {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly valueHistory: number[] = [];
  private readonly rewardHistory: number[] = [];
  private readonly initialBfs: number;
  private readonly policyName: string;
  private readonly levelName: string;

  constructor(tape: GhostTape) {
    this.initialBfs = Math.max(1, tape.initialBfs);
    this.policyName = tape.policy.toUpperCase();
    this.levelName = tape.level.toUpperCase();

    this.root = document.createElement("div");
    this.root.id = "ghost-hud";
    this.root.style.cssText = [
      "position:fixed", "top:16px", "right:16px", `width:${W}px`,
      "z-index:40", "pointer-events:none",
      "font-family:'Courier New',monospace",
      `color:${GREEN}`,
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText = `background:${PANEL_BG};border:1px solid ${DIM};padding:10px 12px;margin-bottom:8px;font-size:11px;line-height:1.6;letter-spacing:0.08em`;
    header.innerHTML =
      `<div style="color:${AMBER};font-size:12px;font-weight:bold">NEURAL PILOT &mdash; ${this.policyName}</div>` +
      `<div>PPO &middot; 60M STEPS &middot; PUFFERLIB</div>` +
      `<div>FLOOR: ${this.levelName} &middot; SEED ${tape.seed}</div>` +
      `<div id="ghost-hud-status">REPLAYING RECOVERED TRAJECTORY</div>`;
    this.root.appendChild(header);

    this.canvas = document.createElement("canvas");
    this.canvas.width = W * 2;
    this.canvas.height = 560 * 2;
    this.canvas.style.cssText = `width:${W}px;height:560px;display:block`;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    ctx.scale(2, 2);
    this.root.appendChild(this.canvas);

    document.body.appendChild(this.root);
  }

  destroy(): void {
    this.root.remove();
  }

  update(frame: GhostFrame): void {
    this.valueHistory.push(frame.value);
    if (this.valueHistory.length > 240) this.valueHistory.shift();
    this.rewardHistory.push(frame.reward);
    if (this.rewardHistory.length > 240) this.rewardHistory.shift();

    const { ctx } = this;
    ctx.clearRect(0, 0, W, 560);
    let y = 0;

    y = this.panelRadar(y, frame);
    y = this.panelValue(y, frame);
    y = this.panelActions(y, frame);
    y = this.panelMission(y, frame);
  }

  // ---- panels ------------------------------------------------------------------

  /** Lidar radar: the 16 wall distances the agent actually sees. Forward = up. */
  private panelRadar(y0: number, f: GhostFrame): number {
    const H = 190;
    this.panelBox(y0, H, "AGENT LIDAR / 16 RAYS");
    const { ctx } = this;
    const cx = W / 2;
    const cy = y0 + 30 + (H - 42) / 2;
    const R = (H - 56) / 2;

    // rings
    ctx.strokeStyle = "rgba(125,255,154,0.12)";
    ctx.lineWidth = 1;
    for (const rr of [R * 0.33, R * 0.66, R]) {
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ray polygon - ray 0 is forward, angles go counterclockwise in player frame
    ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const r = f.rays[i % 16] * R;
      const ang = -Math.PI / 2 + (i % 16) * ((Math.PI * 2) / 16);
      const x = cx + Math.cos(ang) * r;
      const yy = cy + Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(125,255,154,0.14)";
    ctx.fill();
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // agent dot + forward notch
    ctx.fillStyle = AMBER;
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = AMBER;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - 10);
    ctx.stroke();

    return y0 + H + 8;
  }

  /** Value function: "how good does the policy think its situation is". */
  private panelValue(y0: number, f: GhostFrame): number {
    const H = 110;
    this.panelBox(y0, H, "VALUE ESTIMATE V(s)");
    const { ctx } = this;
    const gx = 12;
    const gy = y0 + 32;
    const gw = W - 24;
    const gh = H - 64;

    const hist = this.valueHistory;
    const lo = Math.min(...hist, -1);
    const hi = Math.max(...hist, 1);
    ctx.beginPath();
    for (let i = 0; i < hist.length; i++) {
      const x = gx + (i / 239) * gw;
      const yy = gy + gh - ((hist[i] - lo) / (hi - lo + 1e-6)) * gh;
      if (i === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.strokeStyle = f.value >= 0 ? GREEN : RED;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = "bold 18px 'Courier New', monospace";
    ctx.fillStyle = f.value >= 0 ? GREEN : RED;
    ctx.textAlign = "right";
    ctx.fillText(f.value.toFixed(2), W - 12, y0 + 24);
    ctx.textAlign = "left";
    ctx.font = "10px 'Courier New', monospace";
    ctx.fillStyle = DIM;
    ctx.fillText(`return ${f.cumReturn.toFixed(1)}`, gx, y0 + H - 14);

    return y0 + H + 8;
  }

  /** Live action distribution out of the policy head. */
  private panelActions(y0: number, f: GhostFrame): number {
    const H = 120;
    this.panelBox(y0, H, "POLICY OUTPUT π(a|s)");
    const { ctx } = this;
    const labels = ["FWD", "BCK", "S-L", "S-R", "T-L", "T-R", "SPR"];
    const bw = (W - 24 - 6 * 6) / 7;
    ctx.font = "9px 'Courier New', monospace";
    for (let i = 0; i < 7; i++) {
      const p = f.probs[i];
      const x = 12 + i * (bw + 6);
      const maxH = H - 58;
      const bh = Math.max(1, p * maxH);
      ctx.fillStyle = i === 6 ? AMBER : GREEN;
      ctx.globalAlpha = 0.25 + p * 0.75;
      ctx.fillRect(x, y0 + 28 + (maxH - bh), bw, bh);
      ctx.globalAlpha = 1;
      ctx.fillStyle = DIM;
      ctx.textAlign = "center";
      ctx.fillText(labels[i], x + bw / 2, y0 + H - 18);
      ctx.fillText(`${Math.round(p * 100)}`, x + bw / 2, y0 + H - 7);
    }
    ctx.textAlign = "left";
    return y0 + H + 8;
  }

  /** Exit progress + entity proximity + clock. */
  private panelMission(y0: number, f: GhostFrame): number {
    const H = 116;
    this.panelBox(y0, H, "MISSION");
    const { ctx } = this;
    const gx = 12;
    const gw = W - 24;

    // distance-to-exit bar (BFS cells, inverted = progress)
    const prog = Math.max(0, Math.min(1, 1 - f.bfs / this.initialBfs));
    ctx.font = "10px 'Courier New', monospace";
    ctx.fillStyle = DIM;
    ctx.fillText(`EXIT  ${f.bfs.toFixed(0)} cells`, gx, y0 + 30);
    ctx.strokeStyle = DIM;
    ctx.strokeRect(gx, y0 + 36, gw, 10);
    ctx.fillStyle = GREEN;
    ctx.fillRect(gx + 1, y0 + 37, (gw - 2) * prog, 8);

    // entity proximity
    const sdx = f.sx - f.x;
    const sdz = f.sz - f.z;
    const sdist = Math.hypot(sdx, sdz);
    const danger = f.sactive ? Math.max(0, Math.min(1, 1 - sdist / 30)) : 0;
    ctx.fillStyle = DIM;
    ctx.fillText(
      f.sactive ? `ENTITY  ${sdist.toFixed(1)}m` : "ENTITY  --",
      gx,
      y0 + 64,
    );
    ctx.strokeStyle = DIM;
    ctx.strokeRect(gx, y0 + 70, gw, 10);
    if (danger > 0) {
      ctx.fillStyle = RED;
      ctx.fillRect(gx + 1, y0 + 71, (gw - 2) * danger, 8);
    }

    // clock + last reward
    ctx.fillStyle = AMBER;
    ctx.font = "bold 12px 'Courier New', monospace";
    ctx.fillText(`T+${f.t.toFixed(1)}s`, gx, y0 + 100);
    ctx.textAlign = "right";
    ctx.fillStyle = f.reward >= 0 ? GREEN : RED;
    ctx.fillText(`r ${f.reward >= 0 ? "+" : ""}${f.reward.toFixed(3)}`, W - 12, y0 + 100);
    ctx.textAlign = "left";

    return y0 + H + 8;
  }

  private panelBox(y0: number, h: number, title: string): void {
    const { ctx } = this;
    ctx.fillStyle = PANEL_BG;
    ctx.fillRect(0, y0, W, h);
    ctx.strokeStyle = DIM;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, y0 + 0.5, W - 1, h - 1);
    ctx.font = "bold 10px 'Courier New', monospace";
    ctx.fillStyle = AMBER;
    ctx.textAlign = "left";
    ctx.fillText(title, 12, y0 + 16);
  }
}
