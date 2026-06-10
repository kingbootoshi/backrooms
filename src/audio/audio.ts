/**
 * Sample-based soundscape - ElevenLabs-generated beds and one-shots.
 * Everything routes through a master gain that feeds BOTH the speakers and a
 * MediaStreamDestination, so the saved tape carries the full audio mix.
 *
 * Files preload from the moment the module is constructed; decoding happens
 * once the AudioContext exists (user gesture). Playback degrades gracefully -
 * any sound not yet decoded simply stays silent for that trigger.
 *
 * Beds are level-aware: each floor of the descent crossfades to its own
 * music + ambient loop. The tension loop rides above all of them, driven by
 * threat.
 */

// BASE_URL-aware so the game works at bootoshi.ai/backrooms/ and in dev alike.
const BASE = import.meta.env.BASE_URL;

const SOUNDS = {
  ambient: `${BASE}audio/ambient-room.mp3`,
  music: `${BASE}audio/music-bed.mp3`,
  tension: `${BASE}audio/tension.mp3`,
  level2Music: `${BASE}audio/level2-music.mp3`,
  level2Ambient: `${BASE}audio/level2-ambient.mp3`,
  level3Music: `${BASE}audio/level3-music.mp3`,
  step1: `${BASE}audio/step1.mp3`,
  step2: `${BASE}audio/step2.mp3`,
  entityStep: `${BASE}audio/entity-step.mp3`,
  heartbeat: `${BASE}audio/heartbeat.mp3`,
  distantBang: `${BASE}audio/distant-bang.mp3`,
  groan: `${BASE}audio/groan.mp3`,
  deathSting: `${BASE}audio/death-sting.mp3`,
  tapeEnd: `${BASE}audio/tape-end.mp3`,
  doorSlam: `${BASE}audio/door-slam.mp3`,
  tapeRewind: `${BASE}audio/tape-rewind.mp3`,
} as const;

export type SoundName = keyof typeof SOUNDS;

interface PlayOpts {
  gain?: number;
  pan?: number;
  rate?: number;
}

interface Loop {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

export class AudioEngine {
  private ctx!: AudioContext;
  private master!: GainNode;
  private streamDest!: MediaStreamAudioDestinationNode;
  private started = false;
  private ending = false;

  private readonly fetches = new Map<SoundName, Promise<ArrayBuffer>>();
  private readonly buffers = new Map<SoundName, AudioBuffer>();

  private tensionGain!: GainNode;
  private musicLoop: Loop | null = null;
  private ambientLoop: Loop | null = null;
  // beds requested before decode finishes start as soon as samples land
  private pendingBeds: { music: SoundName; ambient: SoundName; musicVol: number; ambientVol: number } = {
    music: "music",
    ambient: "ambient",
    musicVol: 0.3,
    ambientVol: 0.55,
  };
  private decoded = false;

  private heartbeatTimer = 0;
  private ambientTimer = 16;
  private stepToggle = false;
  private threatSmoothed = 0;

  constructor() {
    // begin downloads immediately - decode waits for the gesture
    for (const [name, url] of Object.entries(SOUNDS) as Array<[SoundName, string]>) {
      this.fetches.set(
        name,
        fetch(url).then((r) => {
          if (!r.ok) throw new Error(`audio fetch failed: ${url}`);
          return r.arrayBuffer();
        }),
      );
    }
  }

  /** Call from a user gesture. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.ctx = new AudioContext();
    void this.ctx.resume();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.streamDest = this.ctx.createMediaStreamDestination();
    // soft limiter keeps stingers from clipping the speakers or the tape
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 24;
    limiter.ratio.value = 14;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.18;
    this.master.connect(limiter);
    limiter.connect(this.ctx.destination);
    limiter.connect(this.streamDest);

    this.tensionGain = this.ctx.createGain();
    this.tensionGain.gain.value = 0;
    this.tensionGain.connect(this.master);

    void this.decodeAndStartBeds();
  }

  get audioStream(): MediaStream {
    return this.streamDest.stream;
  }

  private async decodeAndStartBeds(): Promise<void> {
    await Promise.all(
      [...this.fetches.entries()].map(async ([name, p]) => {
        try {
          const data = await p;
          this.buffers.set(name, await this.ctx.decodeAudioData(data));
        } catch {
          // a missing sample mutes that sound, never the game
        }
      }),
    );
    this.decoded = true;
    if (this.ending) return;
    this.startLoopInto("tension", this.tensionGain);
    const b = this.pendingBeds;
    this.setBeds(b.music, b.ambient, b.musicVol, b.ambientVol, 0.8);
  }

  /** Crossfade the level beds. Safe to call before decode - it queues. */
  setBeds(music: SoundName, ambient: SoundName, musicVol: number, ambientVol: number, fade = 2.2): void {
    this.pendingBeds = { music, ambient, musicVol, ambientVol };
    if (!this.started || !this.decoded || this.ending) return;
    this.musicLoop = this.swapLoop(this.musicLoop, music, musicVol, fade);
    this.ambientLoop = this.swapLoop(this.ambientLoop, ambient, ambientVol, fade);
  }

  private swapLoop(old: Loop | null, name: SoundName, vol: number, fade: number): Loop | null {
    const t = this.ctx.currentTime;
    if (old) {
      old.gain.gain.setTargetAtTime(0, t, fade / 3);
      const src = old.src;
      setTimeout(() => {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
      }, fade * 1000 + 400);
    }
    const buf = this.buffers.get(name);
    if (!buf) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(vol, t, fade / 3);
    src.connect(gain);
    gain.connect(this.master);
    src.start();
    return { src, gain };
  }

  private startLoopInto(name: SoundName, out: GainNode): void {
    const buf = this.buffers.get(name);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(out);
    src.start();
  }

  private play(name: SoundName, opts: PlayOpts = {}): void {
    if (!this.started) return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    const g = this.ctx.createGain();
    g.gain.value = opts.gain ?? 1;
    src.connect(g);
    if (opts.pan !== undefined) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      g.connect(p).connect(this.master);
    } else {
      g.connect(this.master);
    }
    src.start();
  }

  // ---- per-frame -------------------------------------------------------------

  update(dt: number, threat: number): void {
    if (!this.started || this.ending) return;
    this.threatSmoothed += (threat - this.threatSmoothed) * Math.min(1, dt * 2);
    this.tensionGain.gain.setTargetAtTime(this.threatSmoothed * 0.55, this.ctx.currentTime, 0.15);

    // heartbeat under high threat
    if (this.threatSmoothed > 0.5) {
      this.heartbeatTimer -= dt;
      if (this.heartbeatTimer <= 0) {
        const urgency = (this.threatSmoothed - 0.5) / 0.5;
        this.play("heartbeat", { gain: 0.35 + urgency * 0.45, rate: 1 + urgency * 0.25 });
        this.heartbeatTimer = 1.05 - urgency * 0.55;
      }
    }

    // the building talks: distant bangs and worse, panned at random
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      const groan = Math.random() < 0.3;
      this.play(groan ? "groan" : "distantBang", {
        gain: 0.18 + Math.random() * 0.14,
        pan: Math.random() * 2 - 1,
        rate: 0.92 + Math.random() * 0.16,
      });
      this.ambientTimer = 14 + Math.random() * 26;
    }
  }

  // ---- one-shots ---------------------------------------------------------------

  /** Player footstep on carpet - alternating samples, humanized pitch. */
  footstep(volume: number): void {
    this.stepToggle = !this.stepToggle;
    this.play(this.stepToggle ? "step1" : "step2", {
      gain: volume * 0.5,
      rate: 0.92 + Math.random() * 0.18,
    });
  }

  /** Heavy footfall from elsewhere, panned toward its source. */
  entityStep(volume: number, pan: number): void {
    this.play("entityStep", { gain: volume * 0.85, pan, rate: 0.95 + Math.random() * 0.1 });
  }

  /** The descent: a rusted door booms shut somewhere above you. */
  doorSlam(): void {
    this.play("doorSlam", { gain: 0.85 });
  }

  /** Finale: the tape pulls itself backwards. */
  tapeRewind(): void {
    this.play("tapeRewind", { gain: 0.65 });
  }

  deathSting(): void {
    if (!this.started) return;
    this.ending = true;
    this.play("deathSting", { gain: 0.95 });
    const t = this.ctx.currentTime;
    this.musicLoop?.gain.gain.setTargetAtTime(0, t + 0.8, 0.25);
    this.ambientLoop?.gain.gain.setTargetAtTime(0, t + 0.8, 0.25);
    this.tensionGain.gain.setTargetAtTime(0, t + 0.8, 0.25);
  }

  /** Victory - the building lets go, then one mechanical tape-stop clunk. */
  tapeEnd(): void {
    if (!this.started) return;
    this.ending = true;
    const t = this.ctx.currentTime;
    this.musicLoop?.gain.gain.setTargetAtTime(0, t, 0.6);
    this.ambientLoop?.gain.gain.setTargetAtTime(0, t, 0.6);
    this.tensionGain.gain.setTargetAtTime(0, t, 0.2);
    setTimeout(() => this.play("tapeEnd", { gain: 0.7 }), 1000);
  }

  /** Fade the beds for the finale monologue without ending the engine. */
  hushBeds(): void {
    if (!this.started || !this.decoded) return;
    const t = this.ctx.currentTime;
    this.musicLoop?.gain.gain.setTargetAtTime(0.06, t, 0.8);
    this.ambientLoop?.gain.gain.setTargetAtTime(0.04, t, 0.8);
    this.tensionGain.gain.setTargetAtTime(0, t, 0.4);
  }
}
