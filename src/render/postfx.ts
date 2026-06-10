import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

/**
 * Single-pass VHS camcorder grade: barrel lens, chroma fringe, tracking
 * tear bands, tape grain, scanlines, head-switch noise, vignette - with the
 * OSD composited in-shader so it lands on tape. `uGlitch` (0..1) drives the
 * dread: it climbs as things go wrong and slams to 1 on signal loss.
 */
const VhsShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tOsd: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uGlitch: { value: 0 },
    uRes: { value: new THREE.Vector2(1280, 720) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tOsd;
    uniform float uTime;
    uniform float uGlitch;
    uniform vec2 uRes;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 uv = vUv;
      vec2 cc = uv - 0.5;

      // barrel lens distortion
      float r2 = dot(cc, cc);
      uv = 0.5 + cc * (1.0 + (0.07 + uGlitch * 0.22) * r2);

      // tracking tear bands - rare at rest, violent under glitch
      float bandSeed = hash(vec2(floor(uv.y * 36.0), floor(uTime * 13.0)));
      float band = step(0.985 - uGlitch * 0.45, bandSeed);
      uv.x += band * (hash(vec2(uTime * 7.0, floor(uv.y * 36.0))) - 0.5) * (0.025 + uGlitch * 0.22);

      // vertical hold wobble under heavy glitch
      uv.y += uGlitch * uGlitch * sin(uTime * 47.0 + uv.x * 9.0) * 0.012;

      // chroma fringe
      float ca = 0.0014 + uGlitch * 0.009;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + vec2(ca, 0.0)).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - vec2(ca, 0.0)).b;

      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) col = vec3(0.0);

      // tape grade: mild desaturation, lifted blacks
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(luma), 0.22);
      col = col * 0.93 + 0.022;

      // OSD burn-in (after lens, before tape artifacts - like real hardware)
      vec4 osd = texture2D(tOsd, uv);
      col = mix(col, osd.rgb, osd.a * 0.92);

      // tape grain
      float n = hash(uv * uRes * 0.5 + vec2(fract(uTime * 91.7) * 113.0));
      col += (n - 0.5) * (0.085 + uGlitch * 0.4);

      // big dropout blobs while glitching
      if (uGlitch > 0.25) {
        float blob = step(0.93, hash(vec2(floor(uv.y * 18.0), floor(uTime * 29.0)) + floor(uv.x * 3.0)));
        col = mix(col, vec3(hash(uv * uRes + uTime)), blob * uGlitch * 0.9);
      }

      // scanlines
      col *= 0.94 + 0.06 * sin(uv.y * uRes.y * 3.14159);

      // head-switching noise strip at frame bottom
      if (uv.y < 0.016) {
        col = vec3(hash(vec2(uv.x * uRes.x, floor(uTime * 120.0)))) * 0.55;
      }

      // vignette
      float vig = smoothstep(0.92, 0.32, length(cc));
      col *= mix(0.62, 1.0, vig);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFx {
  private readonly composer: EffectComposer;
  private readonly vhsPass: ShaderPass;
  private glitchTarget = 0;
  private glitchCurrent = 0;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    osdTexture: THREE.Texture,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.vhsPass = new ShaderPass(VhsShader);
    this.vhsPass.uniforms.tOsd.value = osdTexture;
    this.composer.addPass(this.vhsPass);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.vhsPass.uniforms.uRes.value.set(width, height);
  }

  /** Baseline dread level 0..1 - eased toward smoothly. */
  setGlitch(level: number): void {
    this.glitchTarget = THREE.MathUtils.clamp(level, 0, 1);
  }

  /** Instant slam for hard cuts (death). */
  slamGlitch(level: number): void {
    this.glitchCurrent = level;
    this.glitchTarget = level;
  }

  render(time: number, dt: number): void {
    this.glitchCurrent += (this.glitchTarget - this.glitchCurrent) * Math.min(1, dt * 4);
    this.vhsPass.uniforms.uTime.value = time;
    this.vhsPass.uniforms.uGlitch.value = this.glitchCurrent;
    this.composer.render();
  }
}
