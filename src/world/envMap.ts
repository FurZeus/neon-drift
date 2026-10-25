import {
  BackSide,
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';

/**
 * Araç boyası ve metal yüzeyler için kodla kurulan küçük bir "neon stüdyo" ortam haritası.
 * Harici HDR dosyası gerekmez.
 */
export function buildNeonEnvironment(renderer: WebGLRenderer): Texture {
  const pmrem = new PMREMGenerator(renderer);
  const scene = new Scene();
  scene.background = new Color(0x080512);
  const disposables: Array<{ dispose(): void }> = [];

  const roomGeo = new BoxGeometry(30, 14, 30);
  const roomMat = new MeshBasicMaterial({ color: 0x0d0820, side: BackSide });
  disposables.push(roomGeo, roomMat);
  scene.add(new Mesh(roomGeo, roomMat));

  const panelGeo = new PlaneGeometry(1, 1);
  disposables.push(panelGeo);
  const panel = (color: number, intensity: number, x: number, y: number, z: number, w: number, h: number) => {
    const mat = new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity) });
    disposables.push(mat);
    const m = new Mesh(panelGeo, mat);
    m.scale.set(w, h, 1);
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  // Tepede geniş yumuşak ışık kutusu: kaput ve tavanda araç fotoğrafı gibi parlama
  panel(0xd9d4ff, 0.55, 0, 6.8, 0, 22, 12);
  panel(0xffffff, 2, 0, 6.6, 0, 22, 1.2);
  // Yanlarda neon şeritler: gövde yanlarında renkli yansıma
  panel(0xff2bd6, 4, -13, 2, 0, 3, 10);
  panel(0x29f0ff, 4, 13, 2, 0, 3, 10);
  panel(0x8b6cff, 2.5, 0, 3, -13, 16, 2);
  panel(0xffb547, 1.6, 0, -1, 13, 12, 1);
  panel(0xffffff, 1.2, 6, 5, 9, 4, 0.6);
  // Ufuk hizasında mor bant
  panel(0x5a3aa8, 1.2, 0, 0.5, -13.5, 28, 2.5);
  panel(0x5a3aa8, 1.2, 0, 0.5, 13.5, 28, 2.5);

  const rt = pmrem.fromScene(scene, 0.04);
  pmrem.dispose();
  disposables.forEach((d) => d.dispose());
  return rt.texture;
}
