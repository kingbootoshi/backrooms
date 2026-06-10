import fixWebmDuration from "fix-webm-duration";

/**
 * Records the post-processed canvas + the full audio mix into one WebM tape.
 * Chunked every second so a long run never holds a single giant buffer.
 * MediaRecorder's chunked WebM omits the duration header, which breaks the
 * scrubber on playback - we patch the EBML header with the measured duration.
 */
export class Recorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType = "";
  private startedAt = 0;

  start(canvas: HTMLCanvasElement, audioStream: MediaStream | null): void {
    this.startedAt = performance.now();
    const stream = canvas.captureStream(30);
    if (audioStream) {
      for (const track of audioStream.getAudioTracks()) stream.addTrack(track);
    }
    this.mimeType = pickMimeType();
    this.recorder = new MediaRecorder(stream, {
      mimeType: this.mimeType || undefined,
      videoBitsPerSecond: 5_000_000,
      audioBitsPerSecond: 128_000,
    });
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(1000);
  }

  async stop(): Promise<Blob> {
    const raw = await new Promise<Blob>((resolve) => {
      const rec = this.recorder;
      const settle = () => resolve(new Blob(this.chunks, { type: this.mimeType || "video/webm" }));
      if (!rec || rec.state === "inactive") {
        settle();
        return;
      }
      // Safari (especially iOS) can drop onstop entirely - the ending must
      // never hang on the recorder. Settle with whatever chunks exist.
      const failsafe = setTimeout(settle, 3000);
      rec.onstop = () => {
        clearTimeout(failsafe);
        settle();
      };
      rec.onerror = () => {
        clearTimeout(failsafe);
        settle();
      };
      try {
        rec.stop();
      } catch {
        clearTimeout(failsafe);
        settle();
      }
    });
    if (!raw.type.includes("webm")) return raw;
    const durationMs = performance.now() - this.startedAt;
    try {
      return await fixWebmDuration(raw, durationMs, { logger: false });
    } catch {
      return raw; // unpatched tape still plays
    }
  }
}

function pickMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}
