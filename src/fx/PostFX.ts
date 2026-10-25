import { HalfFloatType, Vector2, WebGLRenderTarget, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { QualityPreset } from '../config';
import type { PlanarReflection } from './PlanarReflection';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.55 },
    uAberration: { value: 0 },
    uFlash: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uAberration;
    uniform float uFlash;
    uniform float uTime;
    varying vec2 vUv;
    float grain(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 7.13) * 43758.5453);
    }
    void main() {
      vec2 c = vUv - 0.5;
      float d = length(c);
      vec2 off = c * uAberration * d;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      col *= 1.0 - uVignette * smoothstep(0.32, 0.9, d);
      col += vec3(1.0, 0.85, 1.0) * uFlash;
      // Çok hafif film greni: koyu gökyüzü degradelerinde renk kademelenmesini kırar
      col += (grain(gl_FragCoord.xy) - 0.5) * 0.012;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/**
 * Sınırlı son işleme: bloom + vinyet/renk sapması. Düşük kalitede tamamen kapalıdır ve
 * sahne doğrudan çizilir.
 */
export class PostFX {
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private final: ShaderPass | null = null;
  private preset: QualityPreset | null = null;
  private width = 1;
  private height = 1;
  /** 0..1 — çarpma / bitiş anı parlaması. */
  flash = 0;
  aberration = 0;
  /** Ana çizimden önce güncellenecek ıslak yol yansıması. */
  reflection: PlanarReflection | null = null;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
  ) {}

  configure(preset: QualityPreset, width: number, height: number): void {
    this.preset = preset;
    this.width = width;
    this.height = height;
    this.disposeComposer();
    if (!preset.bloom) return;
    const pr = this.renderer.getPixelRatio();
    const rt = new WebGLRenderTarget(Math.floor(width * pr), Math.floor(height * pr), {
      type: HalfFloatType,
      samples: preset.msaa,
    });
    const composer = new EffectComposer(this.renderer, rt);
    composer.setPixelRatio(pr);
    composer.setSize(width, height);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new Vector2(width, height), 0.72, 0.5, 0.9);
    composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    composer.addPass(this.final);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(width, height);
    }
  }

  /** Zamanla sönen efektler (oyun zamanıyla; duraklatmada donar). */
  update(dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 2.5);
  }

  render(dt: number): void {
    this.reflection?.render(this.renderer, this.scene, this.camera);
    if (!this.composer || !this.final) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.final.uniforms.uAberration.value = this.preset?.chromatic ? this.aberration : 0;
    this.final.uniforms.uFlash.value = this.flash * 0.35;
    this.final.uniforms.uTime.value = (this.final.uniforms.uTime.value + dt) % 100;
    this.composer.render(dt);
  }

  get size(): [number, number] {
    return [this.width, this.height];
  }

  private disposeComposer(): void {
    if (!this.composer) return;
    this.composer.passes.forEach((p) => (p as { dispose?: () => void }).dispose?.());
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.composer = null;
    this.bloom = null;
    this.final = null;
  }

  dispose(): void {
    this.disposeComposer();
  }
}
