import * as THREE from "three";

/**
 * All surfaces are procedurally painted to canvas - zero asset downloads,
 * instant load, and the mono-yellow palette stays exactly on tone.
 */

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  return [c, ctx];
}

function grain(ctx: CanvasRenderingContext2D, size: number, amount: number, alpha: number): void {
  for (let i = 0; i < amount; i++) {
    const v = Math.floor(Math.random() * 60);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
  }
}

function toTexture(canvas: HTMLCanvasElement, repeatX: number, repeatY: number): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  return tex;
}

/** Faded yellow wallpaper with vertical striping and water stains. */
export function wallpaperTexture(repeatX: number, repeatY: number): THREE.Texture {
  const size = 256;
  const [canvas, ctx] = makeCanvas(size);
  ctx.fillStyle = "#b3a05e";
  ctx.fillRect(0, 0, size, size);
  // vertical stripes
  for (let x = 0; x < size; x += 16) {
    ctx.fillStyle = x % 32 === 0 ? "rgba(0,0,0,0.045)" : "rgba(255,255,230,0.05)";
    ctx.fillRect(x, 0, 8, size);
  }
  // mottled stains
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 12 + Math.random() * 34;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(70,58,20,0.10)");
    g.addColorStop(1, "rgba(70,58,20,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // grime creeping up from the floor line
  const floorGrime = ctx.createLinearGradient(0, size, 0, size * 0.7);
  floorGrime.addColorStop(0, "rgba(40,32,10,0.22)");
  floorGrime.addColorStop(1, "rgba(40,32,10,0)");
  ctx.fillStyle = floorGrime;
  ctx.fillRect(0, 0, size, size);
  grain(ctx, size, 1400, 0.05);
  return toTexture(canvas, repeatX, repeatY);
}

/** Damp mustard carpet. */
export function carpetTexture(repeat: number): THREE.Texture {
  const size = 256;
  const [canvas, ctx] = makeCanvas(size);
  ctx.fillStyle = "#857642";
  ctx.fillRect(0, 0, size, size);
  // fiber mottle
  for (let i = 0; i < 5200; i++) {
    const v = 110 + Math.floor(Math.random() * 40);
    ctx.fillStyle = `rgba(${v},${v - 16},${Math.floor(v * 0.5)},0.16)`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  // dark blotches
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 10 + Math.random() * 28;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(30,24,8,0.14)");
    g.addColorStop(1, "rgba(30,24,8,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  grain(ctx, size, 900, 0.04);
  return toTexture(canvas, repeat, repeat);
}

/** Drop-ceiling acoustic tile grid. */
export function ceilingTexture(repeat: number): THREE.Texture {
  const size = 256;
  const [canvas, ctx] = makeCanvas(size);
  ctx.fillStyle = "#c9bf95";
  ctx.fillRect(0, 0, size, size);
  // tile perforations
  for (let i = 0; i < 2400; i++) {
    ctx.fillStyle = "rgba(60,52,28,0.10)";
    ctx.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
  }
  // T-bar grid lines (one tile per texture repeat)
  ctx.strokeStyle = "rgba(58,50,26,0.55)";
  ctx.lineWidth = 5;
  ctx.strokeRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(255,250,220,0.18)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(4, 4, size - 8, size - 8);
  // water stains
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 14 + Math.random() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(96,76,30,0.16)");
    g.addColorStop(1, "rgba(96,76,30,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return toTexture(canvas, repeat, repeat);
}
