import type { Input } from "./input";

/**
 * On-screen thumb controls for coarse-pointer devices (phones/tablets).
 * Left ~45% of the screen: a drag joystick appears under the thumb - move.
 * Everywhere else: drag to look. Pushing the stick to its edge sprints.
 * Writes straight into the shared Input, so Player code never knows.
 */

const STICK_RADIUS = 64; // px from origin to full deflection
const SPRINT_DEFLECTION = 0.92; // stick magnitude that triggers sprint
const LOOK_SENSITIVITY = 2.4; // touch px feel coarser than mouse px

export class TouchControls {
  private readonly root: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly nub: HTMLDivElement;

  private moveId: number | null = null;
  private lookId: number | null = null;
  private originX = 0;
  private originY = 0;
  private lastLookX = 0;
  private lastLookY = 0;

  constructor(private readonly input: Input, container: HTMLElement) {
    this.root = document.createElement("div");
    style(this.root, {
      position: "fixed",
      inset: "0",
      zIndex: "5",
      touchAction: "none",
    });

    this.base = document.createElement("div");
    style(this.base, {
      position: "fixed",
      width: `${STICK_RADIUS * 2}px`,
      height: `${STICK_RADIUS * 2}px`,
      marginLeft: `${-STICK_RADIUS}px`,
      marginTop: `${-STICK_RADIUS}px`,
      borderRadius: "50%",
      border: "1px solid rgba(232, 232, 232, 0.35)",
      background: "rgba(0, 0, 0, 0.12)",
      display: "none",
      pointerEvents: "none",
    });

    this.nub = document.createElement("div");
    style(this.nub, {
      position: "fixed",
      width: "44px",
      height: "44px",
      marginLeft: "-22px",
      marginTop: "-22px",
      borderRadius: "50%",
      border: "1px solid rgba(232, 232, 232, 0.7)",
      background: "rgba(232, 232, 232, 0.18)",
      display: "none",
      pointerEvents: "none",
    });

    this.root.appendChild(this.base);
    this.root.appendChild(this.nub);
    container.appendChild(this.root);

    this.root.addEventListener("touchstart", this.onStart, { passive: false });
    this.root.addEventListener("touchmove", this.onMove, { passive: false });
    this.root.addEventListener("touchend", this.onEnd);
    this.root.addEventListener("touchcancel", this.onEnd);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? "" : "none";
    if (!visible) this.releaseAll();
  }

  private onStart = (e: TouchEvent): void => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (this.moveId === null && t.clientX < window.innerWidth * 0.45) {
        this.moveId = t.identifier;
        this.originX = t.clientX;
        this.originY = t.clientY;
        this.placeStick(t.clientX, t.clientY);
      } else if (this.lookId === null) {
        this.lookId = t.identifier;
        this.lastLookX = t.clientX;
        this.lastLookY = t.clientY;
      }
    }
  };

  private onMove = (e: TouchEvent): void => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.moveId) {
        let dx = (t.clientX - this.originX) / STICK_RADIUS;
        let dy = (t.clientY - this.originY) / STICK_RADIUS;
        const mag = Math.hypot(dx, dy);
        if (mag > 1) {
          dx /= mag;
          dy /= mag;
        }
        this.input.touchStrafe = dx;
        this.input.touchForward = -dy;
        this.input.touchSprint = Math.min(mag, 1) >= SPRINT_DEFLECTION;
        this.nub.style.left = `${this.originX + dx * STICK_RADIUS}px`;
        this.nub.style.top = `${this.originY + dy * STICK_RADIUS}px`;
        this.nub.style.borderColor = this.input.touchSprint
          ? "rgba(255, 120, 120, 0.9)"
          : "rgba(232, 232, 232, 0.7)";
      } else if (t.identifier === this.lookId) {
        this.input.touchLookDX += (t.clientX - this.lastLookX) * LOOK_SENSITIVITY;
        this.input.touchLookDY += (t.clientY - this.lastLookY) * LOOK_SENSITIVITY;
        this.lastLookX = t.clientX;
        this.lastLookY = t.clientY;
      }
    }
  };

  private onEnd = (e: TouchEvent): void => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.moveId) this.releaseMove();
      if (t.identifier === this.lookId) this.lookId = null;
    }
  };

  private placeStick(x: number, y: number): void {
    this.base.style.left = `${x}px`;
    this.base.style.top = `${y}px`;
    this.nub.style.left = `${x}px`;
    this.nub.style.top = `${y}px`;
    this.base.style.display = "block";
    this.nub.style.display = "block";
  }

  private releaseMove(): void {
    this.moveId = null;
    this.input.touchStrafe = 0;
    this.input.touchForward = 0;
    this.input.touchSprint = false;
    this.base.style.display = "none";
    this.nub.style.display = "none";
  }

  private releaseAll(): void {
    this.releaseMove();
    this.lookId = null;
  }
}

function style(el: HTMLElement, rules: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, rules);
}
