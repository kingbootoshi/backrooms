# UNMARKED TAPE

A found-footage horror experience. The less you know, the better.

## Play

```sh
bun install
bun dev
```

Open the URL it prints. Headphones on. Lights off.

- **WASD** - move
- **Mouse** - look
- **SHIFT** - run (you cannot run forever)

Your entire run is recorded. When the tape ends - however it ends - you can
watch it back and save it as a `.webm` file.

Every run generates a new layout.

## Tech

- Three.js, TypeScript, Vite, Bun - no game engine
- Entire level renders in ~6 draw calls (instanced geometry + dense fog)
- All textures painted procedurally to canvas at boot
- AI-generated soundscape (ElevenLabs): ambient beds, music, and one-shots,
  mixed live in WebAudio through a limited master bus - the same mix feeds
  your speakers and the tape
- Camcorder grade is a single post shader pass; the OSD is burned into the
  recording like real hardware
- Tape capture via `MediaRecorder` on the post-processed canvas, with the
  WebM duration header patched so the saved file scrubs correctly
