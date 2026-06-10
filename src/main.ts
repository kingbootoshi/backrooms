import { AudioEngine } from "./audio/audio";
import { Game, type EndReason } from "./game";

// samples begin downloading the moment the page opens
const audio = new AudioEngine();

const app = document.getElementById("app") as HTMLElement;
const startOverlay = document.getElementById("start-overlay") as HTMLElement;
const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
const pauseOverlay = document.getElementById("pause-overlay") as HTMLElement;
const endOverlay = document.getElementById("end-overlay") as HTMLElement;
const endTitle = document.getElementById("end-title") as HTMLElement;
const endSub = document.getElementById("end-sub") as HTMLElement;
const replay = document.getElementById("replay") as HTMLVideoElement;
const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
const restartBtn = document.getElementById("restart-btn") as HTMLButtonElement;

let game: Game | null = null;
let tapeUrl: string | null = null;

startBtn.addEventListener("click", () => {
  startOverlay.classList.add("hidden");
  game = new Game(app, audio);
  game.onEnd = onEnd;
  game.start();
  pollPause();
  if (new URLSearchParams(location.search).has("debug")) {
    (window as unknown as { __game: Game }).__game = game;
  }
});

// Pause loop - pointer lock drops put up the pause card; click resumes.
function pollPause(): void {
  if (!game) return;
  pauseOverlay.classList.toggle("hidden", !game.isPaused || !endOverlay.classList.contains("hidden"));
  requestAnimationFrame(pollPause);
}

pauseOverlay.addEventListener("click", () => {
  game?.requestPointer();
});

function onEnd(reason: EndReason, tape: Blob): void {
  pauseOverlay.classList.add("hidden");
  endOverlay.classList.remove("hidden");

  if (reason === "death") {
    endTitle.textContent = "SIGNAL LOST";
    endTitle.className = "death";
    endSub.textContent = "the tape is all that remains - watch your final journey";
  } else {
    endTitle.textContent = "YOU GOT OUT";
    endTitle.className = "escape";
    endSub.textContent = "the tape made it out with you - watch your journey";
  }

  tapeUrl = URL.createObjectURL(tape);
  replay.src = tapeUrl;
  void replay.play().catch(() => {
    /* user can press play manually */
  });

  saveBtn.onclick = () => {
    if (!tapeUrl) return;
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.href = tapeUrl;
    a.download = `backrooms-tape-${stamp}.webm`;
    a.click();
  };
}

restartBtn.addEventListener("click", () => {
  location.reload();
});
