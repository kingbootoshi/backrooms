import * as THREE from "three";

export type OsdMode = "rec" | "pause" | "lost" | "end";

/**
 * Camcorder on-screen display, drawn to a 2D canvas and composited inside the
 * post shader - so every OSD pixel lands on the recorded tape, exactly like a
 * real camcorder burns its overlay into the footage.
 */
export class Osd {
  readonly texture: THREE.CanvasTexture;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private lastDraw = -1;
  private battery = 100;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 1024;
    this.canvas.height = 576;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  /** Redraws at ~12fps - the OSD only needs to tick, not render-rate update. */
  update(mode: OsdMode, elapsed: number): void {
    const frame = Math.floor(elapsed * 12);
    if (frame === this.lastDraw && mode === "rec") return;
    this.lastDraw = frame;
    this.battery = Math.max(8, 100 - elapsed * 0.18);

    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.font = "bold 30px 'Courier New', monospace";
    ctx.fillStyle = "#f0f0f0";
    ctx.strokeStyle = "#f0f0f0";
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 4;

    this.drawCorners(w, h);

    if (mode === "lost") {
      this.drawSignalLost(w, h, elapsed);
      this.texture.needsUpdate = true;
      return;
    }
    if (mode === "end") {
      ctx.textAlign = "center";
      ctx.font = "bold 56px 'Courier New', monospace";
      ctx.fillText("- TAPE END -", w / 2, h / 2);
      this.texture.needsUpdate = true;
      return;
    }

    // REC indicator
    ctx.textAlign = "left";
    if (mode === "pause") {
      ctx.fillText("❚❚ PAUSE", 64, 78);
    } else {
      if (Math.floor(elapsed * 1.4) % 2 === 0) {
        ctx.fillStyle = "#ff3b30";
        ctx.beginPath();
        ctx.arc(74, 68, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#f0f0f0";
      }
      ctx.fillText("REC", 96, 78);
    }

    // Battery + tape speed (top-right)
    ctx.textAlign = "right";
    ctx.fillText("SP", w - 64, 78);
    const blink = this.battery < 18 && Math.floor(elapsed * 2) % 2 === 0;
    if (!blink) {
      const bx = w - 188;
      ctx.strokeRect(bx, 54, 64, 28);
      ctx.fillRect(bx + 64, 61, 6, 14);
      ctx.fillRect(bx + 3, 57, (58 * this.battery) / 100, 22);
    }

    // Timestamp (bottom-left) - real camcorder date burn
    ctx.textAlign = "left";
    const now = new Date();
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const hh = now.getHours();
    const ampm = hh >= 12 ? "PM" : "AM";
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    const mm = String(now.getMinutes()).padStart(2, "0");
    ctx.fillText(
      `${months[now.getMonth()]} ${String(now.getDate()).padStart(2, "0")} ${now.getFullYear()}`,
      64,
      h - 96,
    );
    ctx.fillText(`${ampm} ${h12}:${mm}`, 64, h - 56);

    // Tape counter (bottom-right)
    ctx.textAlign = "right";
    const t = Math.max(0, elapsed);
    const min = String(Math.floor(t / 60)).padStart(2, "0");
    const sec = String(Math.floor(t % 60)).padStart(2, "0");
    const frames = String(Math.floor((t % 1) * 24)).padStart(2, "0");
    ctx.fillText(`0:${min}:${sec}.${frames}`, w - 64, h - 56);

    // Objective ticker for the first moments of tape
    if (mode === "rec" && elapsed < 9) {
      ctx.textAlign = "center";
      ctx.font = "26px 'Courier New', monospace";
      const msg = "> find the exit_";
      const shown = msg.slice(0, Math.floor(Math.max(0, elapsed - 1.5) * 10));
      ctx.globalAlpha = elapsed > 7.5 ? Math.max(0, 1 - (elapsed - 7.5) / 1.5) : 1;
      ctx.fillText(shown, w / 2, h - 56);
      ctx.globalAlpha = 1;
    }

    this.texture.needsUpdate = true;
  }

  private drawCorners(w: number, h: number): void {
    const { ctx } = this;
    const m = 40;
    const len = 46;
    ctx.beginPath();
    for (const [cx, cy, dx, dy] of [
      [m, m, 1, 1],
      [w - m, m, -1, 1],
      [m, h - m, 1, -1],
      [w - m, h - m, -1, -1],
    ]) {
      ctx.moveTo(cx + dx * len, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + dy * len);
    }
    ctx.stroke();
  }

  private drawSignalLost(w: number, h: number, elapsed: number): void {
    const { ctx } = this;
    // torn static bars
    for (let i = 0; i < 26; i++) {
      const y = Math.random() * h;
      const bh = 2 + Math.random() * 16;
      ctx.fillStyle = `rgba(255,255,255,${0.12 + Math.random() * 0.5})`;
      ctx.fillRect(0, y, w, bh);
    }
    ctx.fillStyle = "#f0f0f0";
    ctx.textAlign = "center";
    ctx.font = "bold 60px 'Courier New', monospace";
    if (Math.floor(elapsed * 6) % 3 !== 0) {
      ctx.fillText("SIGNAL LOST", w / 2 + (Math.random() - 0.5) * 14, h / 2 + (Math.random() - 0.5) * 10);
    }
  }
}
