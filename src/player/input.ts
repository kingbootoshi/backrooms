/**
 * Keyboard + mouse capture, with touch state merged in (see TouchControls).
 * Mouse and touch-look deltas accumulate between frames.
 */
export class Input {
  private keys = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;

  // written by TouchControls on coarse-pointer devices
  touchForward = 0;
  touchStrafe = 0;
  touchSprint = false;
  touchLookDX = 0;
  touchLookDY = 0;

  constructor() {
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ArrowUp", "ArrowDown"].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    document.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
  }

  get forward(): number {
    const keys = (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0) -
      (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0);
    return clamp1(keys + this.touchForward);
  }

  get strafe(): number {
    const keys = (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) -
      (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0);
    return clamp1(keys + this.touchStrafe);
  }

  get sprinting(): boolean {
    return this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || this.touchSprint;
  }

  consumeMouse(): { dx: number; dy: number } {
    const d = { dx: this.mouseDX + this.touchLookDX, dy: this.mouseDY + this.touchLookDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.touchLookDX = 0;
    this.touchLookDY = 0;
    return d;
  }
}

function clamp1(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
