import {
  HalfFloatType,
  LinearFilter,
  Matrix4,
  PerspectiveCamera,
  Plane,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';

/**
 * y = 0 düzleminde (pist tamamen düz) ayna yansıması. Sahneyi aynalanmış kamerayla düşük
 * çözünürlükte bir dokuya çizer; yol malzemesi bu dokuyu ıslaklık maskesiyle karıştırır.
 * Mantık three.js `Reflector` sınıfından uyarlanmıştır, ancak doku matrisi dünya koordinatı
 * kullanır (yansıyan yüzey ayrı bir mesh değil, mevcut yol malzemesi).
 */
export class PlanarReflection {
  readonly target: WebGLRenderTarget;
  /** Dünya konumu → yansıma dokusu (projektif) koordinatı. */
  readonly textureMatrix = new Matrix4();
  /** Yansıma çiziminde gizlenecek nesneler (yolun kendisi, şerit çizgileri, zemin süsleri…). */
  readonly hidden: Object3D[] = [];
  /** 0 = kapalı; aksi halde ekran çözünürlüğüne oranı. */
  scale = 0;
  /** Yansıma çiziminden hemen önce / sonra (ör. uzak trafik araçlarını gizlemek için). */
  beforeRender?: (camX: number, camZ: number) => void;
  afterRender?: () => void;

  private readonly cam = new PerspectiveCamera();
  private readonly normal = new Vector3(0, 1, 0);
  private readonly origin = new Vector3(0, 0, 0);
  private readonly camPos = new Vector3();
  private readonly view = new Vector3();
  private readonly lookAt = new Vector3();
  private readonly tgt = new Vector3();
  private readonly rot = new Matrix4();
  private readonly plane = new Plane();
  private readonly clip = new Vector4();
  private readonly q = new Vector4();
  private readonly visibility: boolean[] = [];

  constructor() {
    this.target = new WebGLRenderTarget(4, 4, {
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
    });
    this.target.texture.generateMipmaps = false;
  }

  get enabled(): boolean {
    return this.scale > 0;
  }

  setSize(drawingWidth: number, drawingHeight: number): void {
    if (!this.enabled) return;
    const w = Math.max(64, Math.round(drawingWidth * this.scale));
    const h = Math.max(64, Math.round(drawingHeight * this.scale));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
  }

  render(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): void {
    if (!this.enabled) return;
    camera.updateMatrixWorld();
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    this.view.subVectors(this.origin, this.camPos);
    if (this.view.dot(this.normal) > 0) return; // kamera düzlemin altında

    this.view.reflect(this.normal).negate().add(this.origin);
    this.rot.extractRotation(camera.matrixWorld);
    this.lookAt.set(0, 0, -1).applyMatrix4(this.rot).add(this.camPos);
    this.tgt.subVectors(this.origin, this.lookAt).reflect(this.normal).negate().add(this.origin);

    const cam = this.cam;
    cam.position.copy(this.view);
    cam.up.set(0, 1, 0).applyMatrix4(this.rot).reflect(this.normal);
    cam.lookAt(this.tgt);
    cam.far = camera.far;
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    // Eğik yakın düzlem: düzlemin altındaki geometriyi kırp
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.origin).applyMatrix4(cam.matrixWorldInverse);
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const p = cam.projectionMatrix.elements;
    this.q.set((Math.sign(this.clip.x) + p[8]) / p[0], (Math.sign(this.clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
    this.clip.multiplyScalar(2 / this.clip.dot(this.q));
    p[2] = this.clip.x;
    p[6] = this.clip.y;
    p[10] = this.clip.z + 1 - 0.003;
    p[14] = this.clip.w;

    for (let i = 0; i < this.hidden.length; i++) {
      this.visibility[i] = this.hidden[i].visible;
      this.hidden[i].visible = false;
    }
    this.beforeRender?.(this.camPos.x, this.camPos.z);
    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.state.buffers.depth.setMask(true);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevShadow;
    for (let i = 0; i < this.hidden.length; i++) this.hidden[i].visible = this.visibility[i];
    this.afterRender?.();
  }

  dispose(): void {
    this.target.dispose();
  }
}
