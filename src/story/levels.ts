/**
 * The descent, as data. Each level is a reskin + retuning of the same core:
 * maze params, painted palette, fog, lights, entity behavior, soundscape,
 * and the lines the camcorder types onto the tape.
 */

export interface WorldPalette {
  wallBase: string;
  wallStripes: boolean;
  wallStain: string;
  floorBase: string;
  floorFiberTint: number; // 0..1 how colored the fiber mottle is
  ceilBase: string;
  fogColor: number;
  fogDensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  ambientColor: number;
  ambientIntensity: number;
  panelEvery: number; // light panel grid spacing (cells)
  panelColor: number;
  carryColor: number;
  carryIntensity: number;
}

export interface StalkerSpec {
  mode: "hunt" | "glimpse";
  grace: number;
  huntDuration: number;
  cooldown: number;
  stalkSpeed: number;
  chaseSpeed: number;
  watchedFactor: number;
}

export interface ScriptLine {
  at: number; // seconds since level start
  text: string;
  hold: number; // seconds the line stays up after typing
}

export interface LevelSpec {
  name: string;
  mazeSlabs: number;
  mazePillarChance: number;
  palette: WorldPalette;
  exitSignText: string;
  stalker: StalkerSpec;
  music: "music" | "level2Music" | "level3Music";
  ambient: "ambient" | "level2Ambient";
  musicVol: number;
  ambientVol: number;
  dateBurn: string | null; // null = real date (level 1)
  freezeClock: boolean;
  script: ScriptLine[];
  glimpseLine: string | null;
  descendLines: string[] | null; // typed over black while descending INTO this level
}

export const LEVELS: LevelSpec[] = [
  {
    // LEVEL 1 - THE LOBBY. Untouched: this is the game as it always was.
    name: "lobby",
    mazeSlabs: 430,
    mazePillarChance: 0.55,
    palette: {
      wallBase: "#b3a05e",
      wallStripes: true,
      wallStain: "70,58,20",
      floorBase: "#857642",
      floorFiberTint: 1,
      ceilBase: "#c9bf95",
      fogColor: 0x6e6234,
      fogDensity: 0.052,
      hemiSky: 0xfff3c4,
      hemiGround: 0x57492a,
      hemiIntensity: 1.05,
      ambientColor: 0xfff0c0,
      ambientIntensity: 0.35,
      panelEvery: 3,
      panelColor: 0xfff7d8,
      carryColor: 0xffeec0,
      carryIntensity: 14,
    },
    exitSignText: "EXIT",
    stalker: {
      mode: "hunt",
      grace: 42,
      huntDuration: 90,
      cooldown: 26,
      stalkSpeed: 2.7,
      chaseSpeed: 4.7,
      watchedFactor: 0.32,
    },
    music: "music",
    ambient: "ambient",
    musicVol: 0.3,
    ambientVol: 0.55,
    dateBurn: null,
    freezeClock: false,
    script: [{ at: 1.5, text: "> find the exit_", hold: 6 }],
    glimpseLine: null,
    descendLines: null,
  },
  {
    // LEVEL 2 - MAINTENANCE. Quiet. The tape starts talking.
    name: "maintenance",
    mazeSlabs: 520,
    mazePillarChance: 0.35,
    palette: {
      wallBase: "#6a705f",
      wallStripes: false,
      wallStain: "20,26,14",
      floorBase: "#41443c",
      floorFiberTint: 0.3,
      ceilBase: "#54564c",
      fogColor: 0x47503a,
      fogDensity: 0.055,
      hemiSky: 0xcfe3c0,
      hemiGround: 0x2c3324,
      hemiIntensity: 0.92,
      ambientColor: 0xd2e8c8,
      ambientIntensity: 0.34,
      panelEvery: 4,
      panelColor: 0xd9ffd0,
      carryColor: 0xe8ffd8,
      carryIntensity: 11,
    },
    exitSignText: "DOWN",
    stalker: {
      mode: "glimpse",
      grace: 24,
      huntDuration: 0,
      cooldown: 38,
      stalkSpeed: 0,
      chaseSpeed: 0,
      watchedFactor: 1,
    },
    music: "level2Music",
    ambient: "level2Ambient",
    musicVol: 0.34,
    ambientVol: 0.5,
    dateBurn: "OCT 07 2009",
    freezeClock: true,
    script: [
      { at: 9, text: "> tape contains prior footage_", hold: 5 },
      { at: 22, text: "> previous owner: m. carver_", hold: 5 },
      { at: 36, text: "> status: missing since 2009_", hold: 5 },
      { at: 80, text: "> the stairs only go down_", hold: 5 },
    ],
    glimpseLine: "> ...he is still down here_",
    descendLines: ["that door never led outside.", "descending."],
  },
  {
    // LEVEL 3 - THE DARK. It wants the camera back.
    name: "dark",
    mazeSlabs: 380,
    mazePillarChance: 0.7,
    palette: {
      wallBase: "#5e3a34",
      wallStripes: false,
      wallStain: "18,8,8",
      floorBase: "#36211e",
      floorFiberTint: 0.2,
      ceilBase: "#2c1b18",
      fogColor: 0x3a1d1a,
      fogDensity: 0.058,
      hemiSky: 0xff8866,
      hemiGround: 0x3a1a14,
      hemiIntensity: 1.0,
      ambientColor: 0xff9988,
      ambientIntensity: 0.42,
      panelEvery: 4,
      panelColor: 0xff7a5c,
      carryColor: 0xffb09a,
      carryIntensity: 15,
    },
    exitSignText: "EXIT",
    stalker: {
      mode: "hunt",
      grace: 6,
      huntDuration: 100000,
      cooldown: 6,
      stalkSpeed: 3.4,
      chaseSpeed: 5.1,
      watchedFactor: 0.5,
    },
    music: "level3Music",
    ambient: "level2Ambient",
    musicVol: 0.4,
    ambientVol: 0.3,
    dateBurn: "MAR 21 1991",
    freezeClock: true,
    script: [
      { at: 7, text: "> RUN_", hold: 4 },
      { at: 40, text: "> it wants the camera back_", hold: 5 },
    ],
    glimpseLine: null,
    descendLines: ["the tape is older than the camera.", "keep descending."],
  },
];

/** Typed over black at the very end, one line at a time. The loop closes. */
export const FINALE_LINES: string[] = [
  "you found the door.",
  "the camera was recovered at the entrance.",
  "rewound. relabeled. left for the next visitor.",
  "m. carver was never found.",
  "but the handwriting on this tape's label",
  "is yours.",
];
