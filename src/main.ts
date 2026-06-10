import { AudioEngine } from "./audio/audio";
import { Game, type EndReason } from "./game";
import { loadGhostTape, type GhostTape } from "./replay/ghost";

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
const escapeReward = document.getElementById("escape-reward") as HTMLElement;
const secretWordEl = document.getElementById("secret-word") as HTMLElement;

// winners ping one of these at @kingbootoshi - unmistakable proof they got out
const SECRET_WORDS = ["ALMONDWATER", "CARPETJUICE", "DRYWALLMILK", "HUMMINGYELLOW", "MOISTCEILING"];

let game: Game | null = null;
let tapeUrl: string | null = null;
let tapeExt = "webm";
let ghostTape: GhostTape | null = null;

// ?replay=lobby | dark-win | dark-death | <url> - watch the RL agent's run
// inside the real renderer. Same seed, same maze, machine at the wheel.
const replayParam = new URLSearchParams(location.search).get("replay");
if (replayParam) {
  loadGhostTape(replayParam)
    .then((tape) => {
      ghostTape = tape;
      const title = document.querySelector("#start-overlay h1");
      const meta = document.querySelector(".tape-meta");
      if (title) title.textContent = "MACHINE TAPE";
      if (meta) {
        meta.innerHTML =
          `recovered trajectory &mdash; neural pilot, ${tape.outcome === "death" ? "did not survive" : "made it out"}<br />` +
          "no human input &mdash; the policy drives, you watch<br />" +
          "headphones recommended";
      }
      startBtn.textContent = "▶ PLAY MACHINE TAPE";
    })
    .catch(() => {
      const meta = document.querySelector(".tape-meta");
      if (meta) meta.innerHTML = "machine tape not found &mdash; starting a normal run instead";
    });
}

// phones get thumb-control instructions instead of WASD
if (window.matchMedia("(pointer: coarse)").matches) {
  const meta = document.querySelector(".tape-meta");
  if (meta) {
    meta.innerHTML =
      "LEFT THUMB &mdash; move &nbsp;&middot;&nbsp; RIGHT THUMB &mdash; look<br />" +
      "push the stick to its edge to run<br />" +
      "headphones strongly recommended &mdash; your journey is recorded";
  }
}

startBtn.addEventListener("click", () => {
  startOverlay.classList.add("hidden");
  game = new Game(app, audio, ghostTape);
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

  if (ghostTape) {
    // machine runs earn no secret words - the raffle is for humans
    if (reason === "death") {
      endTitle.textContent = "PILOT TERMINATED";
      endTitle.className = "death";
      endSub.textContent = "the entity caught the neural net - its tape survives";
    } else {
      endTitle.textContent = "THE MACHINE GOT OUT";
      endTitle.className = "escape";
      endSub.textContent = "no human hands on this tape - watch the policy run";
    }
  } else if (reason === "death") {
    endTitle.textContent = "SIGNAL LOST";
    endTitle.className = "death";
    endSub.textContent = "the tape is all that remains - watch your final journey";
  } else {
    endTitle.textContent = "YOU GOT OUT";
    endTitle.className = "escape";
    endSub.textContent = "the tape made it out with you - watch your journey";
    secretWordEl.textContent = SECRET_WORDS[Math.floor(Math.random() * SECRET_WORDS.length)];
    escapeReward.classList.remove("hidden");
  }

  // some mobile browsers refuse canvas capture - the run still ends cleanly,
  // there is just no tape to show
  if (tape.size === 0) {
    replay.style.display = "none";
    saveBtn.style.display = "none";
    return;
  }

  tapeExt = tape.type.includes("mp4") ? "mp4" : "webm";
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
    a.download = `backrooms-tape-${stamp}.${tapeExt}`;
    a.click();
  };
}

restartBtn.addEventListener("click", () => {
  location.reload();
});
