import {
  ACESFilmicToneMapping,
  FogExp2,
  PCFShadowMap,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  type Material,
  type Mesh,
} from 'three';
import { AudioEngine } from '../audio/AudioEngine';
import { ChaseCamera } from '../camera/ChaseCamera';
import { CAR_PAINTS, PHYSICS, QUALITY, RACE, type QualityLevel, type QualitySetting } from '../config';
import { CarEffects } from '../fx/CarEffects';
import { PostFX } from '../fx/PostFX';
import { PlanarReflection } from '../fx/PlanarReflection';
import { HeadlightBeams } from '../fx/HeadlightBeams';
import { isLogitechDirectInput, isMac, prettifyPadName } from '../input/GamepadManager';
import { InputManager, type FrameActions } from '../input/InputManager';
import { GhostPlayer, GhostRecorder } from '../race/Ghost';
import { RaceSession, type RaceEvent } from '../race/RaceSession';
import {
  loadRecords,
  loadSettings,
  saveRecords as storeRecords,
  saveSettings,
  trackSignature,
  type GameSettings,
  type Records,
} from '../settings/Settings';
import { formatDelta, formatTime } from '../ui/format';
import { Minimap } from '../ui/Minimap';
import { UI, type ResultsData, type UIAction } from '../ui/UI';
import { Autopilot } from '../vehicle/Autopilot';
import { CarModel } from '../vehicle/CarModel';
import type { CarVisual } from '../vehicle/CarVisual';
import { GltfCarModel } from '../vehicle/GltfCarModel';
import { hasModel, loadCarSource, loadManifest } from '../vehicle/carAssets';
import { CARS, carById, carStats, type CarSpec } from '../vehicle/cars';
import { CarPhysics, type DriveInput, type WallHit } from '../vehicle/CarPhysics';
import { buildNeonEnvironment } from '../world/envMap';
import { Environment, FOG_COLOR } from '../world/Environment';
import { createTrackQuery, Track } from '../world/Track';
import { laneOffsets, TRACKS, trackById, type TrackDef } from '../world/tracks';
import { Traffic, type TrafficHit } from '../race/Traffic';
import { TrafficFactory } from '../race/TrafficFactory';
import { TrackMesh } from '../world/TrackMesh';

type State = 'loading' | 'menu' | 'countdown' | 'racing' | 'finishing' | 'results' | 'paused';
type ActiveState = 'countdown' | 'racing' | 'finishing';

/** Fizik alt adımı: kare hızından bağımsız, kararlı entegrasyon. */
const PHYS_STEP = 1 / 120;
/** Geri sayımda ilk rakam görünmeden önceki bekleme. */
const COUNTDOWN_LEAD = 0.8;
const FINISH_CINEMATIC = 3.4;
const SPEEDO_MAX_KMH = 280;
const QUALITY_LABEL: Record<QualityLevel, string> = { low: 'Düşük', medium: 'Orta', high: 'Yüksek', ultra: 'Ultra' };

/** Yükleme adımları arasında arayüzün güncellenmesine izin ver (arka plan sekmede rAF durur). */
const PARKED: DriveInput = { steer: 0, throttle: 0, brake: 1, handbrake: false };

const nextFrame = () =>
  new Promise<void>((r) => {
    if (document.hidden) setTimeout(r, 16);
    else requestAnimationFrame(() => r());
  });

export class Game {
  private renderer!: WebGLRenderer;
  private readonly scene = new Scene();
  private chase!: ChaseCamera;
  private post!: PostFX;
  private settings: GameSettings = loadSettings();
  private track: Track = new Track(trackById(this.settings.track));
  private trackMesh!: TrackMesh;
  private traffic: Traffic | null = null;
  private trafficFactory: Promise<TrafficFactory> | null = null;
  private trackSwitching = false;
  private readonly reflection = new PlanarReflection();
  private readonly beams = new HeadlightBeams();
  private env!: Environment;
  private readonly car = new CarPhysics();
  private carModel!: CarVisual;
  private ghostModel!: CarVisual;
  private carSpec: CarSpec = CARS[0];
  /** Garajda göz atılan araç (seçili olandan farklı olabilir: modeli yoksa). */
  private garageIndex = 0;
  private carSwapToken = 0;
  private fx!: CarEffects;
  private minimap!: Minimap;
  private readonly q = createTrackQuery();
  private readonly pilot: Autopilot;
  private readonly input: InputManager;
  private readonly audio = new AudioEngine();
  private readonly ui: UI;

  private records: Records = loadRecords(this.recordsKey(this.settings.car));
  private state: State = 'loading';
  private pausedFrom: ActiveState | null = null;
  private race: RaceSession | null = null;
  private pendingResults: ResultsData | null = null;
  private lastLapDelta: number | null = null;
  private countdownT = 0;
  private countdownShown = -1;
  private finishT = 0;
  private fireworkIndex = 0;
  private readonly ghostRec = new GhostRecorder();
  private ghostPlayer: GhostPlayer | null = null;
  private readonly ghostPose = { x: 0, z: 0, yaw: 0, speed: 0 };
  private time = 0;
  private last = 0;
  private width = 1;
  private height = 1;
  private autoLevel: QualityLevel = 'medium';
  private readonly perf = { acc: 0, frames: 0, grace: 3 };
  private frameImpact: WallHit | null = null;
  private respawnBlink = 0;
  private respawnCooldown = 0;
  private offroadTime = 0;
  private stuckTime = 0;
  private boostVisual = 0;
  private aberrationKick = 0;
  private screenShownAt = 0;
  private contextLost = false;
  private readonly tutorial = {
    active: false,
    step: 0,
    t: 0,
    boosted: false,
    offroadShown: false,
    contextUntil: 0,
  };

  /** Geliştirme testleri için: yarışta sürüşü otopilota bırak. */
  autoDrive = false;

  constructor(private readonly container: HTMLElement) {
    this.ui = new UI({
      action: (a) => this.onAction(a),
      setting: (k, d) => this.onSetting(k, d),
      interact: () => this.audio.unlock(),
    });
    this.input = new InputManager({
      onPadConnect: (id) => {
        const name = prettifyPadName(id);
        this.ui.setPadStatus(true, name);
        this.ui.toast(`Gamepad bağlandı: ${name}`, 'good');
      },
      onPadDisconnect: () => {
        const gp = this.input.gamepad;
        this.ui.setPadStatus(gp.connected, gp.name);
        this.ui.toast('Gamepad bağlantısı kesildi', 'warn');
        if (this.state === 'racing' || this.state === 'countdown') {
          this.pause('Gamepad bağlantısı kesildi — yeniden bağlayın ya da klavyeyle devam edin.');
        }
      },
    });
    this.input.onDeviceChange = (d) => this.ui.setInputDevice(d, this.input.padStyle);
    this.pilot = new Autopilot(this.track);
  }

  // ===================================================================== kurulum

  async init(): Promise<void> {
    this.ui.setLoading(0.06, 'Grafik motoru başlatılıyor…');
    try {
      this.createRenderer();
    } catch (err) {
      console.warn('WebGL başlatılamadı:', err);
      this.ui.showError(
        'Tarayıcınız WebGL desteklemiyor ya da donanım hızlandırma kapalı. Güncel bir Chrome, Edge, Firefox veya Safari ile tekrar deneyin.',
      );
      return;
    }

    this.ui.setLoading(0.15, 'Yazı tipleri yükleniyor…');
    await this.loadFonts();
    await nextFrame();

    this.ui.setLoading(0.3, 'Neon ortam ışığı hazırlanıyor…');
    this.scene.environment = buildNeonEnvironment(this.renderer);
    this.scene.environmentIntensity = 0.6;
    this.scene.fog = new FogExp2(FOG_COLOR.getHex(), 0.0011);
    await nextFrame();

    this.ui.setLoading(0.45, 'Şehir ve gökyüzü kuruluyor…');
    this.env = new Environment(this.scene, this.track);
    await nextFrame();

    this.ui.setLoading(0.6, 'Pist döşeniyor…');
    this.trackMesh = new TrackMesh(this.track);
    this.scene.add(this.trackMesh.group);
    await nextFrame();

    this.ui.setLoading(0.72, 'Araç garajdan çıkıyor…');
    await loadManifest();
    if (!this.isAvailable(carById(this.settings.car))) this.settings.car = CARS[0].id;
    await this.applyCar(carById(this.settings.car), true);
    this.fx = new CarEffects(this.scene, this.chase.camera);
    this.fx.onBackfire = () => this.audio.backfire();
    this.trackMesh.enableWetRoad(this.reflection);
    this.post.reflection = this.reflection;
    this.scene.add(this.beams.group);
    this.rebuildReflectionHidden();
    // Uzak trafik araçları yansımada çizilmesin (performans)
    this.reflection.beforeRender = (x, z) => this.traffic?.setFarHidden(x, z, 120, true);
    this.reflection.afterRender = () => this.traffic?.setFarHidden(0, 0, 0, false);
    this.minimap = new Minimap(document.getElementById('minimap') as unknown as SVGSVGElement, this.track);
    this.wireCarEvents();
    await this.setupTraffic();

    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const cores = navigator.hardwareConcurrency || 4;
    this.autoLevel = coarse ? 'low' : cores >= 8 ? 'high' : 'medium';
    this.applyQuality();
    this.chase.shakeEnabled = this.settings.cameraShake;
    this.audio.setVolumes(this.settings.sfxVolume, this.settings.musicVolume);

    this.placeOnGrid();
    this.chase.setMode('cinematic');
    this.chase.update(0.016, this.car, 0);

    this.ui.setLoading(0.86, 'Gölgelendiriciler derleniyor…');
    await nextFrame();
    try {
      await this.renderer.compileAsync(this.scene, this.chase.camera);
    } catch {
      /* eski sürücüler: ilk karede derlenir */
    }
    this.ui.setLoading(1, 'Hazır');
    await nextFrame();

    this.ui.setInputDevice(this.input.lastDevice, this.input.padStyle);
    this.ui.setPadStatus(this.input.gamepad.connected, this.input.gamepad.name);
    this.bindWindowEvents();
    this.goMenu();
    this.last = performance.now();
    requestAnimationFrame(this.frame);

    if (import.meta.env.DEV) (window as unknown as { __neon: Game }).__neon = this;
  }

  // ===================================================================== araçlar

  /** Model dosyası olan araçlar ve (dosyası olmasa da) prosedürel yedeği olan Golf. */
  private isAvailable(spec: CarSpec): boolean {
    return spec.id === 'golf6' || hasModel(spec);
  }

  /** Aracı yükleyip sahneye koy; fizik değerlerini ve rekorları değiştir. */
  private async applyCar(spec: CarSpec, initial = false): Promise<void> {
    const token = ++this.carSwapToken;
    const source = await loadCarSource(spec);
    if (token !== this.carSwapToken) return; // bu arada başka araç seçildi
    if (!source && spec.id !== 'golf6') return;
    const paint = CAR_PAINTS[this.settings.paint];
    const make = (ghost: boolean): CarVisual =>
      source
        ? new GltfCarModel(source, spec, paint, { ghost, headlight: !ghost })
        : new CarModel(paint, { ghost, headlight: !ghost });
    const old = [this.carModel, this.ghostModel].filter(Boolean);
    const visible = this.carModel?.root.visible ?? true;
    this.carModel = make(false);
    this.ghostModel = make(true);
    this.ghostModel.root.visible = false;
    this.carModel.root.visible = visible;
    for (const o of old) {
      this.scene.remove(o.root);
      o.dispose();
    }
    this.scene.add(this.carModel.root, this.ghostModel.root);
    if (this.fx) this.rebuildReflectionHidden();
    this.carSpec = spec;
    this.car.setParams(spec.physics);
    this.records = loadRecords(this.recordsKey(spec.id));
    if (!initial) this.carModel.update(0.016, this.car);
  }

  // ===================================================================== pistler

  private recordsKey(carId: string): string {
    const def = this.track?.def ?? trackById(this.settings.track);
    return `${def.id}-${trackSignature(def.points)}:${carId}`;
  }

  private rebuildReflectionHidden(): void {
    const h = this.reflection.hidden;
    h.length = 0;
    h.push(...this.trackMesh.noReflect, this.env.ground, this.fx.skids.mesh, this.fx.speedLines.lines, this.beams.group);
    h.push(...this.carModel.floorDecals);
  }

  /** Trafik şablonları: modeli olan gerçek araçlar + prosedürel Golf (bir kez üretilir). */
  private getTrafficFactory(): Promise<TrafficFactory> {
    if (!this.trafficFactory) {
      this.trafficFactory = (async () => {
        const factory = new TrafficFactory();
        for (const spec of CARS) {
          if (!this.isAvailable(spec)) continue;
          const source = await loadCarSource(spec);
          if (source || spec.id === 'golf6') factory.add(spec, source);
        }
        return factory;
      })();
    }
    return this.trafficFactory;
  }

  private async setupTraffic(): Promise<void> {
    this.traffic?.dispose();
    this.traffic = null;
    if (!this.track.def.traffic) return;
    const factory = await this.getTrafficFactory();
    if (!factory.ready) return;
    this.traffic = new Traffic(this.scene, this.track, factory);
    this.traffic.reset(this.track.def.gridS);
  }

  /** Menüden pist değiştir: pist, çevre, trafik ve rekorlar yeniden kurulur. */
  private async switchTrack(def: TrackDef): Promise<void> {
    if (this.trackSwitching) return;
    this.trackSwitching = true;
    try {
      this.scene.remove(this.trackMesh.group);
      this.trackMesh.dispose();
      this.env.dispose();
      this.traffic?.dispose();
      this.traffic = null;
      this.track = new Track(def);
      this.q.index = -1;
      this.env = new Environment(this.scene, this.track);
      this.trackMesh = new TrackMesh(this.track);
      this.scene.add(this.trackMesh.group);
      this.trackMesh.enableWetRoad(this.reflection);
      this.pilot.setTrack(this.track);
      this.minimap = new Minimap(document.getElementById('minimap') as unknown as SVGSVGElement, this.track);
      this.records = loadRecords(this.recordsKey(this.carSpec.id));
      this.rebuildReflectionHidden();
      this.applyQuality();
      await this.setupTraffic();
      this.placeOnGrid();
      this.fx.clear();
      this.chase.snap();
      this.trackMesh.setStartLights(0, false);
    } finally {
      this.trackSwitching = false;
    }
  }

  private renderMenu(): void {
    const def = this.track.def;
    this.ui.renderMenu(
      this.records,
      this.settings,
      RaceSession.medalTargets(def, this.settings.laps),
      this.carLabel(this.carSpec),
      { name: def.name, blurb: def.blurb, sprint: def.kind === 'sprint' },
    );
  }

  /** Otoyolda otopilot: şeridinde yavaş araç varsa boş şeride geç, yoksa takip et. */
  private highwayPilot(): void {
    const lanes = laneOffsets(this.track.def).forward;
    if (!this.traffic || !lanes.length) {
      this.pilot.laneOffset = 0;
      this.pilot.speedCap = Infinity;
      return;
    }
    if (!lanes.some((l) => Math.abs(l - this.pilot.laneOffset) < 0.1)) this.pilot.laneOffset = lanes[0];
    const s = this.q.s;
    const cur = this.traffic.gapAhead(s, this.pilot.laneOffset);
    if (cur.gap < 60) {
      for (const lane of lanes) {
        if (Math.abs(lane - this.pilot.laneOffset) < 0.1) continue;
        const other = this.traffic.gapAhead(s - 12, lane);
        if (other.gap > cur.gap + 25) {
          this.pilot.laneOffset = lane;
          break;
        }
      }
    }
    const g = this.traffic.gapAhead(s, this.pilot.laneOffset);
    this.pilot.speedCap = g.gap < 50 ? Math.max(4, g.speed + (g.gap - 16) * 0.5) : Infinity;
  }

  private carLabel(spec: CarSpec): string {
    return spec.short;
  }

  private openGarage(): void {
    this.garageIndex = Math.max(0, CARS.findIndex((c) => c.id === this.settings.car));
    this.parkForShowroom();
    this.renderGarage();
    this.showScreen('garage');
    this.chase.setMode('showroom');
  }

  private parkForShowroom(): void {
    this.placeOnGrid();
    const def = this.track.def;
    this.track.frameAt(def.gridS - 18, this.q);
    const lat = def.gridLateral;
    this.car.reset(this.q.cx + this.q.nx * lat, this.q.cz + this.q.nz * lat, Track.yawOf(this.q.tx, this.q.tz));
    this.track.query(this.car.x, this.car.z, -1, this.q);
    this.fx.breakTrails();
    this.chase.snap();
  }

  private renderGarage(): void {
    const spec = CARS[this.garageIndex];
    const available = this.isAvailable(spec);
    const fallback = spec.id === 'golf6' && !hasModel(spec);
    this.ui.renderGarage({
      index: this.garageIndex,
      total: CARS.length,
      name: spec.name,
      short: spec.short,
      year: spec.year,
      blurb: spec.blurb,
      stats: carStats(spec, PHYSICS),
      status: !available
        ? `Model dosyası henüz eklenmedi. Sketchfab'dan indirip README'deki adımla içe aktarınca bu araç açılır.`
        : fallback
          ? 'GLB modeli eklenmedi; kodla üretilmiş Golf 6 kullanılıyor.'
          : spec.model?.glossy
            ? 'Gerçek araç taraması: kendi rengiyle gelir; renk seçimi yalnızca neon alt ışığı değiştirir.'
            : '',
      paint: CAR_PAINTS[this.settings.paint].name,
      credit: hasModel(spec) ? spec.credit : undefined,
    });
  }

  private browseGarage(dir: number): void {
    this.garageIndex = (this.garageIndex + dir + CARS.length) % CARS.length;
    const spec = CARS[this.garageIndex];
    if (this.isAvailable(spec)) {
      this.settings.car = spec.id;
      saveSettings(this.settings);
      void this.applyCar(spec).then(() => this.renderGarage());
    }
    this.renderGarage();
    this.audio.uiMove();
  }

  private createRenderer(): void {
    const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.type = PCFShadowMap;
    this.measure();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(this.width, this.height, false);
    this.container.appendChild(renderer.domElement);
    renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.onContextLost();
    });
    this.renderer = renderer;
    this.chase = new ChaseCamera(this.width / this.height);
    this.scene.add(this.chase.camera);
    this.post = new PostFX(renderer, this.scene, this.chase.camera);
  }

  private async loadFonts(): Promise<void> {
    if (!document.fonts?.load) return;
    const load = Promise.all([
      document.fonts.load('italic 700 64px "Chakra Petch"'),
      document.fonts.load('600 16px "Chakra Petch"'),
      document.fonts.load('500 16px "JetBrains Mono"'),
    ]).catch(() => undefined);
    await Promise.race([load, new Promise((r) => setTimeout(r, 2500))]);
  }

  private wireCarEvents(): void {
    this.car.onWallHit = (hit) => {
      if (!this.frameImpact || hit.strength > this.frameImpact.strength) this.frameImpact = { ...hit };
    };
    this.car.onDriftLevel = (level) => {
      if (this.state !== 'racing') return;
      this.audio.driftCharge(level);
      this.rumble(0.15, 0.3, 80);
    };
    this.car.onBoost = (level) => {
      if (this.state !== 'racing') return;
      this.audio.boost(level);
      this.ui.flash(level === 2 ? 'Süper turbo!' : 'Turbo!', '', level === 2 ? 'mag' : 'cyan', 900);
      this.chase.addTrauma(0.22 + level * 0.08);
      this.aberrationKick = 1;
      this.tutorial.boosted = true;
      this.rumble(0.35, 0.6, 220);
    };
  }

  private bindWindowEvents(): void {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    // Kapsayıcı düzeni geç oturursa (gömülü görünümler, mobil adres çubuğu) da yakala.
    if ('ResizeObserver' in window) new ResizeObserver(() => this.onResize()).observe(this.container);
    this.onResize();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pause('Oyun, sekme arka plana geçtiği için duraklatıldı.');
        this.audio.setHidden(true);
      } else {
        this.audio.setHidden(false);
        this.last = performance.now();
      }
    });
    window.addEventListener('blur', () => this.pause('Pencere odağı kaybolduğu için duraklatıldı.'));
  }

  private measure(): void {
    this.width = Math.max(1, this.container.clientWidth || window.innerWidth);
    this.height = Math.max(1, this.container.clientHeight || window.innerHeight);
  }

  private onResize = (): void => {
    const pw = this.width;
    const ph = this.height;
    this.measure();
    if (pw === this.width && ph === this.height && this.renderer.domElement.width > 2) return;
    const p = QUALITY[this.currentQuality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixelRatio));
    this.renderer.setSize(this.width, this.height, false);
    this.chase.setAspect(this.width / this.height);
    this.post.setSize(this.width, this.height);
    this.resizeReflection();
  };

  private resizeReflection(): void {
    const pr = this.renderer.getPixelRatio();
    this.reflection.setSize(this.width * pr, this.height * pr);
  }

  private onContextLost(): void {
    this.contextLost = true;
    this.pause();
    this.ui.showError('Grafik bağlamı kayboldu (sürücü sıfırlandı). Devam etmek için sayfayı yenileyin.');
  }

  // ===================================================================== kalite

  private get currentQuality(): QualityLevel {
    return this.settings.quality === 'auto' ? this.autoLevel : this.settings.quality;
  }

  private applyQuality(): void {
    const p = QUALITY[this.currentQuality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixelRatio));
    this.renderer.setSize(this.width, this.height, false);
    const shadowsChanged = this.renderer.shadowMap.enabled !== p.shadows;
    this.renderer.shadowMap.enabled = p.shadows;
    this.env.sun.castShadow = p.shadows;
    if (p.shadows && this.env.sun.shadow.mapSize.x !== p.shadowMapSize) {
      this.env.sun.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
      this.env.sun.shadow.map?.dispose();
      this.env.sun.shadow.map = null;
    }
    if (shadowsChanged) {
      this.scene.traverse((o) => {
        const m = (o as Mesh).material as Material | Material[] | undefined;
        if (!m) return;
        for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
      });
    }
    this.post.configure(p, this.width, this.height);
    this.fx.setQuality(p.particleScale, p.speedLines);
    this.reflection.scale = p.reflection;
    this.beams.setEnabled(this.currentQuality === 'high' || this.currentQuality === 'ultra');
    this.resizeReflection();
    this.trackMesh.setWetStrength(p.reflection > 0 ? 0.72 : 0);
    this.perf.grace = 3;
    this.perf.acc = 0;
    this.perf.frames = 0;
  }

  /** "Otomatik" kalitede kare hızı düşükse bir kademe azalt. */
  private monitorPerformance(dt: number): void {
    if (this.settings.quality !== 'auto' || this.autoLevel === 'low') return;
    if (this.state !== 'menu' && this.state !== 'racing') return;
    this.perf.grace -= dt;
    if (this.perf.grace > 0) return;
    this.perf.acc += dt;
    this.perf.frames++;
    if (this.perf.acc < 3) return;
    const fps = this.perf.frames / this.perf.acc;
    this.perf.acc = 0;
    this.perf.frames = 0;
    if (fps < 44) {
      this.autoLevel = this.autoLevel === 'ultra' || this.autoLevel === 'high' ? 'medium' : 'low';
      this.applyQuality();
      this.ui.toast(`Akıcılık için grafik kalitesi düşürüldü: ${QUALITY_LABEL[this.autoLevel]}`, 'warn');
    }
  }

  // ===================================================================== döngü

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    // dt = 0 olabilir (sekme dönüşü); girdiyi bir sonraki kareye bırak.
    if (document.hidden || this.contextLost || dt <= 0) return;
    this.update(dt);
    this.render(dt);
    this.input.endFrame();
  };

  /**
   * Yalnızca geliştirme testleri: sekme gizliyken (requestAnimationFrame durur) döngüyü elle
   * ilerletir. Son kare çizilir.
   */
  debugTick(seconds: number, fps = 60): void {
    if (!import.meta.env.DEV) return;
    const dt = 1 / fps;
    const n = Math.max(1, Math.round(seconds * fps));
    for (let i = 0; i < n; i++) {
      this.update(dt);
      if (i === n - 1) this.render(dt);
      this.input.endFrame();
    }
  }

  private update(dt: number): void {
    const a = this.input.update(dt);
    const simulate = this.state !== 'paused' && this.state !== 'loading';
    if (simulate) this.time += dt;

    switch (this.state) {
      case 'menu':
        this.handleMenuInput(a);
        if (this.ui.current === 'garage') this.stepPhysics(dt, PARKED);
        else this.updateAttract(dt, 0.82);
        if (this.ui.current === 'controls') this.updatePadTest();
        break;
      case 'countdown':
        this.updateCountdown(dt, a);
        break;
      case 'racing':
        this.updateRacing(dt, a);
        break;
      case 'finishing':
        this.updateFinishing(dt, a);
        break;
      case 'results':
        this.handleMenuInput(a);
        this.updateAttract(dt, 0.55);
        break;
      case 'paused':
        this.handleMenuInput(a, true);
        break;
      default:
        break;
    }

    if (simulate) {
      this.carModel.update(dt, this.car);
      this.beams.update(this.car, this.car.p.carHalfLength);
      if (this.respawnBlink > 0) {
        this.respawnBlink = Math.max(0, this.respawnBlink - dt);
        this.carModel.root.visible = this.respawnBlink === 0 || Math.floor(this.respawnBlink * 14) % 2 === 0;
      }
      const driving = this.state === 'racing' || this.state === 'finishing' || this.state === 'menu' || this.state === 'results';
      this.fx.update(dt, this.car, this.carModel, driving);
      this.fx.updateSpeedLines(dt, this.car, this.state === 'racing');
      this.boostVisual += ((this.car.boostTime > 0 ? 1 : 0) - this.boostVisual) * (1 - Math.exp(-6 * dt));
      this.chase.update(dt, this.car, this.boostVisual);
      this.env.update(this.time, this.car.x, this.car.z);
      this.aberrationKick = Math.max(0, this.aberrationKick - dt * 1.8);
      this.post.update(dt);
      const speedF = Math.min(1, Math.abs(this.car.speed) / 64);
      this.post.aberration = this.state === 'racing' ? speedF * 0.004 + this.boostVisual * 0.01 + this.aberrationKick * 0.012 : 0;
    }
    this.monitorPerformance(dt);
  }

  private render(dt: number): void {
    this.fx.setViewport(this.renderer.domElement.height, this.chase.camera.fov);
    this.post.render(this.state === 'paused' ? 0 : dt);
  }

  private stepPhysics(dt: number, drive: DriveInput): void {
    if (!(dt > 0)) return;
    const steps = Math.max(1, Math.ceil(dt / PHYS_STEP - 1e-6));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.car.step(h, drive, this.track, this.q);
  }

  // ===================================================================== durumlar

  private placeOnGrid(): void {
    const def = this.track.def;
    this.track.frameAt(def.gridS, this.q);
    const lat = def.gridLateral;
    this.car.reset(this.q.cx + this.q.nx * lat, this.q.cz + this.q.nz * lat, Track.yawOf(this.q.tx, this.q.tz));
    this.track.query(this.car.x, this.car.z, -1, this.q);
    this.pilot.laneOffset = lat;
  }

  private showScreen(name: Parameters<UI['show']>[0], opts?: Parameters<UI['show']>[1]): void {
    this.ui.show(name, opts);
    this.screenShownAt = performance.now();
  }

  private goMenu(): void {
    this.state = 'menu';
    this.race = null;
    this.pausedFrom = null;
    this.ui.showHud(false);
    this.ui.showCountdown(null);
    this.ui.setWarning(null);
    this.ui.showTutorial(null);
    this.ui.clearFlash();
    this.renderMenu();
    this.showScreen('menu');
    this.chase.setMode('cinematic');
    this.audio.setPaused(false);
    this.audio.setDriving(false);
    this.input.keyboard.captureGameKeys = false;
    this.ghostModel.root.visible = false;
    this.carModel.root.visible = true;
    this.respawnBlink = 0;
    this.trackMesh.setStartLights(0, false);
    if (Math.abs(this.q.lateral) > this.track.roadHalfWidth) this.respawnAtNearest();
  }

  private startRace(): void {
    this.audio.unlock();
    this.placeOnGrid();
    this.race = new RaceSession(this.track, this.settings.laps, this.q.s, this.records.bestLap);
    this.lastLapDelta = null;
    this.pendingResults = null;
    this.fx.clear();
    this.chase.setMode('chase');
    this.chase.snap();
    this.showScreen(null);
    this.ui.showHud(true);
    this.ui.clearFlash();
    this.ui.setWarning(null);
    this.ui.fadeHints(false);
    const targets = RaceSession.medalTargets(this.track.def, this.settings.laps);
    this.ui.setHudMode(this.race.sprint);
    this.traffic?.reset(this.q.s);
    this.ui.setHudTarget(`Altın hedef ${formatTime(targets.gold)}`);
    this.state = 'countdown';
    this.pausedFrom = null;
    this.countdownT = 0;
    this.countdownShown = -1;
    this.trackMesh.setStartLights(0, false);
    this.ghostRec.reset();
    this.ghostPlayer = this.settings.ghost && this.records.ghost ? new GhostPlayer(this.records.ghost) : null;
    this.ghostModel.root.visible = false;
    this.carModel.root.visible = true;
    this.respawnBlink = 0;
    this.audio.setPaused(false);
    this.audio.setDriving(true);
    this.input.keyboard.captureGameKeys = true;
    this.offroadTime = 0;
    this.stuckTime = 0;
    this.respawnCooldown = 0;
    this.frameImpact = null;
    Object.assign(this.tutorial, {
      active: this.settings.hints && !this.settings.tutorialDone && this.track.def.kind === 'circuit',
      step: 0,
      t: 0,
      boosted: false,
      offroadShown: false,
      contextUntil: 0,
    });
    this.updateTutorial(0);
    this.updateHud();
  }

  private updateCountdown(dt: number, a: FrameActions): void {
    this.countdownT += dt;
    const e = this.countdownT;
    const n = e < COUNTDOWN_LEAD ? 0 : Math.min(4, 1 + Math.floor(e - COUNTDOWN_LEAD));
    if (n !== this.countdownShown) {
      this.countdownShown = n;
      if (n >= 1 && n <= 3) {
        this.ui.showCountdown(String(4 - n));
        this.trackMesh.setStartLights(n, false);
        this.audio.countdown();
        this.rumble(0.1, 0.25, 70);
      } else if (n === 4) {
        this.ui.showCountdown('BAŞLA!', true);
        this.trackMesh.setStartLights(3, true);
        this.audio.go();
        this.post.flash = 0.5;
        this.rumble(0.3, 0.5, 160);
        this.state = 'racing';
      }
    }
    // Kalkışta motoru bağırt
    this.audio.updateCar(0, a.drive.throttle, 0, false, false);
    this.updateTutorial(dt);
    this.updateHud();
    if (a.pause) this.pause();
  }

  private updateRacing(dt: number, a: FrameActions): void {
    const race = this.race!;
    if (this.autoDrive) this.highwayPilot();
    const drive = this.autoDrive ? this.pilot.drive(this.car, this.q) : a.drive;
    this.stepPhysics(dt, drive);
    this.processImpact();
    this.updateTraffic(dt, true);

    const car = this.car;
    const facingDot = Math.sin(car.yaw) * this.q.tx + Math.cos(car.yaw) * this.q.tz;
    const events = race.update(dt, this.q.s, car.speed, facingDot);
    for (const ev of events) this.onRaceEvent(ev);
    if (this.state !== 'racing') return;

    this.ghostRec.sample(dt, car.x, car.z, car.yaw);
    const ghost = this.updateGhost(dt, race.currentLapTime);
    this.minimap.update(car.x, car.z, ghost);

    this.respawnCooldown -= dt;
    if (a.respawn && this.respawnCooldown <= 0) this.respawn(false);

    this.offroadTime = car.offroad ? this.offroadTime + dt : 0;
    const stuck = Math.abs(car.speed) < 2.5 && (car.offroad || race.isWrongWay || car.scraping);
    this.stuckTime = stuck ? this.stuckTime + dt : 0;
    if (this.stuckTime > 5) this.respawn(true);

    const k = this.ui.labels;
    if (race.isWrongWay) this.ui.setWarning('wrong', `Aracı çevir ya da ${this.ui.kbd(k.respawn)} ile piste dön`);
    else if (this.offroadTime > 0.5) this.ui.setWarning('offroad', `Yavaşlıyorsun · ${this.ui.kbd(k.respawn)} piste döndürür`);
    else this.ui.setWarning(null);

    if (race.lap > 1) this.ui.fadeHints(true);
    if (race.raceTime > 1.1 && race.raceTime - dt <= 1.1) this.ui.showCountdown(null);
    this.updateTutorial(dt);
    this.updateHud();
    this.updateDrivingAudio();
    if (a.pause) this.pause();
  }

  private updateFinishing(dt: number, a: FrameActions): void {
    this.finishT += dt;
    this.pilot.pace = 0.5;
    this.highwayPilot();
    this.stepPhysics(dt, this.pilot.drive(this.car, this.q));
    this.frameImpact = null;
    this.updateTraffic(dt, false);
    const times = [0.15, 0.6, 1.05, 1.5, 2.1, 2.6];
    const finishS = this.track.def.kind === 'sprint' ? (this.track.def.finishS ?? 0) : this.track.def.startS;
    while (this.fireworkIndex < times.length && this.finishT >= times[this.fireworkIndex]) {
      const f = createTrackQuery();
      this.track.frameAt(finishS + 10 + Math.random() * 30, f);
      const side = (Math.random() - 0.5) * 50;
      this.fx.firework(f.cx + f.nx * side, 16 + Math.random() * 14, f.cz + f.nz * side);
      this.fireworkIndex++;
    }
    this.minimap.update(this.car.x, this.car.z, null);
    this.updateHud();
    this.updateDrivingAudio();
    if (this.finishT >= FINISH_CINEMATIC) this.showResults();
    else if (a.pause) this.pause();
  }

  private updateAttract(dt: number, pace: number): void {
    this.pilot.pace = pace;
    this.highwayPilot();
    this.stepPhysics(dt, this.pilot.drive(this.car, this.q));
    this.frameImpact = null;
    this.updateTraffic(dt, false);
    if (Math.abs(this.q.lateral) > this.track.roadHalfWidth + 2 && Math.abs(this.car.speed) < 2) this.respawnAtNearest();
    // Açık yolda gösteri turu: yolun sonuna gelince başa dön
    const def = this.track.def;
    if (!this.track.closed && this.q.s > (def.finishS ?? this.track.length) + 300) {
      this.placeOnGrid();
      this.traffic?.reset(this.q.s);
      this.fx.breakTrails();
      this.chase.snap();
    }
  }

  /** Trafiği ilerlet; oyuncuyla çarpışmayı efekte çevir. */
  private updateTraffic(dt: number, scoring: boolean): void {
    if (!this.traffic) return;
    const hit = this.traffic.update(dt, this.car, this.q.s, this.q.lateral);
    if (hit) this.onTrafficHit(hit, scoring);
  }

  private onTrafficHit(hit: TrafficHit, scoring: boolean): void {
    if (hit.strength < 1) return;
    this.fx.wallHit({ strength: hit.strength * 0.8, x: hit.x, z: hit.z, nx: -hit.nx, nz: -hit.nz }, Math.abs(this.car.speed));
    this.chase.addTrauma(Math.min(1, hit.strength / 14));
    this.audio.impact(hit.strength * 1.2);
    this.rumble(Math.min(1, hit.strength / 10), Math.min(1, hit.strength / 7), 160 + hit.strength * 10);
    if (hit.strength > 8) this.post.flash = Math.max(this.post.flash, Math.min(0.6, hit.strength / 40));
    if (scoring && hit.strength > 14) this.ui.flash('Kaza!', '', 'red', 900);
  }

  private onRaceEvent(ev: RaceEvent): void {
    const race = this.race!;
    if (ev.type === 'lap') {
      this.lastLapDelta = ev.delta;
      // Hayalet: şimdiye kadarki en iyi tur
      const data = this.ghostRec.finish(ev.time);
      if (!this.records.ghost || ev.time < this.records.ghost.lapTime) {
        this.records.ghost = data;
        this.saveRecords();
        if (this.settings.ghost) this.ghostPlayer = new GhostPlayer(data);
      }
      this.ghostRec.reset();
      if (ev.lap < race.laps) {
        const next = ev.lap + 1;
        const deltaTxt = ev.delta !== null ? `  ${formatDelta(ev.delta)}` : '';
        const finalLap = next === race.laps;
        this.ui.flash(
          finalLap ? 'Son tur!' : `Tur ${next}`,
          `Tur ${ev.lap}: ${formatTime(ev.time)}${deltaTxt}${ev.best && ev.delta !== null ? ' · en iyi' : ''}`,
          ev.best ? 'green' : finalLap ? 'amber' : 'cyan',
          2200,
        );
        this.audio.lap(ev.best);
      }
    } else if (ev.type === 'split') {
      this.ui.flash(`${ev.km}. km`, formatTime(ev.time), 'cyan', 1300);
      this.audio.lap(false);
    } else if (ev.type === 'finish') {
      if (race.sprint) {
        // Sprintte hayalet bütün koşudur
        const data = this.ghostRec.finish(ev.total);
        if (!this.records.ghost || ev.total < this.records.ghost.lapTime) this.records.ghost = data;
      }
      this.finishRace(ev.total, ev.laps, ev.splits);
    }
  }

  private finishRace(total: number, laps: number[], splits: number[] = []): void {
    const race = this.race!;
    this.state = 'finishing';
    this.finishT = 0;
    this.fireworkIndex = 0;
    const key = String(race.laps);
    const prev = this.records.bestTotal[key] ?? null;
    const newRecord = prev === null || total < prev;
    if (newRecord) this.records.bestTotal[key] = total;
    const bestLap = Math.min(...laps);
    const newBestLap = this.records.bestLap === null || bestLap < this.records.bestLap;
    if (newBestLap) this.records.bestLap = bestLap;
    this.saveRecords();
    if (!this.settings.tutorialDone) {
      this.settings.tutorialDone = true;
      saveSettings(this.settings);
    }
    this.pendingResults = {
      total,
      laps,
      medal: RaceSession.medalFor(total, this.track.def, race.laps),
      newRecord,
      newBestLap,
      previousRecord: prev,
      targets: RaceSession.medalTargets(this.track.def, race.laps),
      splits: race.sprint ? splits : undefined,
      crashes: this.traffic?.crashes ?? 0,
    };
    this.ui.flash('Bitiş!', formatTime(total), 'green', 2800);
    this.ui.setWarning(null);
    this.ui.showTutorial(null);
    this.audio.finish();
    this.post.flash = 0.9;
    this.chase.setMode('orbit');
    this.ghostModel.root.visible = false;
    this.rumble(0.5, 0.8, 400);
  }

  private showResults(): void {
    if (!this.pendingResults) return;
    this.state = 'results';
    this.ui.showHud(false);
    this.ui.clearFlash();
    this.ui.showCountdown(null);
    this.ui.renderResults(this.pendingResults);
    this.showScreen('results');
    this.audio.setDriving(false);
    this.input.keyboard.captureGameKeys = false;
  }

  private pause(reason = ''): void {
    if (this.state !== 'countdown' && this.state !== 'racing' && this.state !== 'finishing') return;
    this.pausedFrom = this.state;
    this.state = 'paused';
    this.ui.setPauseSub(reason);
    this.showScreen('pause');
    this.audio.setPaused(true);
    this.input.keyboard.captureGameKeys = false;
    this.input.keyboard.clear();
  }

  private resume(): void {
    if (this.state !== 'paused' || !this.pausedFrom) return;
    this.state = this.pausedFrom;
    this.pausedFrom = null;
    this.showScreen(null);
    this.audio.setPaused(false);
    if (this.state !== 'finishing') this.audio.setDriving(true);
    this.input.keyboard.captureGameKeys = true;
  }

  private respawnAtNearest(): void {
    this.track.query(this.car.x, this.car.z, -1, this.q);
    this.track.frameAt(this.q.s, this.q);
    const lat = this.track.def.respawnLateral;
    this.car.reset(this.q.cx + this.q.nx * lat, this.q.cz + this.q.nz * lat, Track.yawOf(this.q.tx, this.q.tz));
    this.traffic?.clearAround(this.q.s, 45);
    this.track.query(this.car.x, this.car.z, -1, this.q);
    this.fx.breakTrails();
  }

  private respawn(auto: boolean): void {
    this.respawnAtNearest();
    this.race?.resync(this.q.s);
    this.chase.snap();
    this.respawnBlink = 1;
    this.respawnCooldown = 1.2;
    this.stuckTime = 0;
    this.offroadTime = 0;
    this.ui.setWarning(null);
    this.ui.flash(auto ? 'Piste döndürüldün' : 'Piste dönüldü', '', 'cyan', 900);
  }

  // ===================================================================== yardımcılar

  private processImpact(): void {
    const hit = this.frameImpact;
    this.frameImpact = null;
    if (!hit) return;
    const speed = Math.abs(this.car.speed);
    if (hit.strength > 1.2) {
      this.fx.wallHit(hit, speed);
      this.chase.addTrauma(Math.min(0.8, hit.strength / 16));
      this.audio.impact(hit.strength);
      if (hit.strength > 9) this.post.flash = Math.max(this.post.flash, 0.35);
      this.rumble(Math.min(1, hit.strength / 14), Math.min(1, hit.strength / 9), 120 + hit.strength * 8);
    } else if (speed > 8 && Math.random() < 0.35) {
      this.fx.wallHit({ ...hit, strength: 0.4 }, speed);
    }
  }

  private updateGhost(dt: number, lapTime: number): { x: number; z: number } | null {
    const gp = this.ghostPlayer;
    if (!gp || !this.settings.ghost || !gp.poseAt(lapTime, this.ghostPose)) {
      this.ghostModel.root.visible = false;
      return null;
    }
    const p = this.ghostPose;
    this.ghostModel.root.visible = true;
    this.ghostModel.placeGhost(p.x, p.z, p.yaw, p.speed, dt);
    const d = Math.hypot(p.x - this.car.x, p.z - this.car.z);
    this.ghostModel.setGhostOpacity(0.34 * Math.max(0.15, Math.min(1, (d - 2) / 8)));
    return p;
  }

  private updateDrivingAudio(): void {
    const car = this.car;
    const speed = Math.abs(car.speed);
    let slip = car.drifting
      ? 0.55 + car.driftCharge * 0.45
      : Math.max(0, (Math.abs(car.slip) - 0.1) * 4) + (car.input.handbrake && speed > 6 ? 0.6 : 0);
    if (car.input.brake > 0.7 && car.speed > 22) slip = Math.max(slip, 0.4);
    slip *= Math.min(1, speed / 10);
    this.audio.updateCar(speed, car.input.throttle, car.offroad ? 0 : slip, car.offroad, car.boostTime > 0);
  }

  private updateHud(): void {
    const race = this.race;
    if (!race) return;
    const best = race.sprint
      ? (this.records.bestTotal['1'] ?? null)
      : race.bestLap !== null && this.records.bestLap !== null
        ? Math.min(race.bestLap, this.records.bestLap)
        : (race.bestLap ?? this.records.bestLap);
    const sprint = race.sprint
      ? {
          km: race.covered / 1000,
          totalKm: race.distance / 1000,
          crashes: this.traffic?.crashes ?? 0,
          target: RaceSession.medalTargets(this.track.def, race.laps).gold,
        }
      : undefined;
    this.ui.updateHud({
      sprint,
      lap: Math.min(race.lap, race.laps),
      laps: race.laps,
      lapTime: this.state === 'countdown' ? 0 : race.currentLapTime,
      best,
      delta: this.lastLapDelta,
      total: race.raceTime,
      speedKmh: this.car.kmh,
      speedFrac: this.car.kmh / SPEEDO_MAX_KMH,
      driftCharge: this.car.driftCharge,
      driftLevel: this.car.driftLevel,
      drifting: this.car.drifting,
      boosting: this.car.boostTime > 0,
    });
  }

  private updateTutorial(dt: number): void {
    const t = this.tutorial;
    if (!this.settings.hints) {
      this.ui.showTutorial(null);
      return;
    }
    const k = this.ui.labels;
    const key = (x: string) => this.ui.kbd(x);
    const steer = this.input.lastDevice === 'gamepad' ? 'sol çubuk' : `${key('A')} ${key('D')}`;

    // Bağlamsal ipucu: pist dışında kalınca (öğretici bitse de bir kez)
    if (this.state === 'racing' && this.offroadTime > 1.2 && !t.offroadShown) {
      t.offroadShown = true;
      t.contextUntil = this.time + 4.5;
      this.ui.showTutorial(`Pist dışı aracı yavaşlatır. Takılırsan ${key(k.respawn)} ile piste dön.`);
      return;
    }
    if (t.contextUntil > this.time) return;
    if (!t.active) {
      this.ui.showTutorial(null);
      return;
    }

    t.t += dt;
    let html: string | null = null;
    switch (t.step) {
      case 0:
        html = `Yeşil ışıkta ${key(k.throttle)} ile gaz ver, ${steer} ile yönlen, ${key(k.brake)} fren.`;
        if (this.state === 'racing' && t.t > 5) this.nextTutorialStep();
        break;
      case 1:
        html = `Viraja girerken direksiyonu kır ve ${key(k.drift)} tuşunu <b>basılı tut</b> → drift.`;
        if (this.car.drifting) this.nextTutorialStep();
        break;
      case 2:
        html = `Drift'i sürdür; çubuk dolunca ${key(k.drift)} tuşunu bırak → <b>turbo</b>!`;
        if (t.boosted) this.nextTutorialStep();
        else if (!this.car.drifting && t.t > 0.6) {
          t.step = 1;
          t.t = 0;
        }
        break;
      case 3:
        html = `Harika! Drift tut, bırak, turbo. ${key(k.respawn)} piste döndürür, ${key(k.pause)} duraklatır.`;
        if (t.t > 5) {
          t.active = false;
          this.settings.tutorialDone = true;
          saveSettings(this.settings);
        }
        break;
      default:
        t.active = false;
    }
    this.ui.showTutorial(t.active ? html : null);
  }

  private saveRecords(): void {
    storeRecords(this.recordsKey(this.carSpec.id), this.records);
  }

  private nextTutorialStep(): void {
    this.tutorial.step++;
    this.tutorial.t = 0;
  }

  /** Tarayıcının gördüğü kumandaları ve okunan tuşları Kontroller ekranında göster. */
  private updatePadTest(): void {
    let raw: Gamepad[] = [];
    try {
      raw = Array.from(navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => !!p && p.connected);
    } catch {
      raw = [];
    }
    const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
    const st = this.input.gamepad.state;
    const names = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', '↑', '↓', '←', '→'];
    let html: string;
    if (!raw.length) {
      html =
        'Tarayıcı şu an hiç kumanda görmüyor. Kumandada bir tuşa basın — tarayıcılar, sayfa açıkken bir tuşa basılana kadar kumandayı gizler.';
    } else {
      const rows = raw.map((p) => {
        const map = p.mapping === 'standard' ? 'standart' : isLogitechDirectInput(p.id) ? 'Logitech D modu (düzeltildi)' : 'ham';
        return `<div><code>${esc(prettifyPadName(p.id))}</code> · eşleme: ${map} · ${p.buttons.length} tuş, ${p.axes.length} eksen</div>`;
      });
      const pressed = names.filter((_, i) => st.buttons[i]);
      const live = [
        `Yön: <code>${st.lx.toFixed(2)}</code>`,
        `Gaz (RT): <code>${st.rt.toFixed(2)}</code>`,
        `Fren (LT): <code>${st.lt.toFixed(2)}</code>`,
        `Basılı: <code>${pressed.length ? pressed.join(' ') : '—'}</code>`,
      ].join(' · ');
      html = rows.join('') + `<div>${live}</div>`;
    }
    const f710 = raw.some((p) => /f710|046d/i.test(p.id));
    let tip = '';
    if (isMac() && !raw.length)
      tip =
        'Logitech F710: arkadaki X/D anahtarını D konumuna alın — macOS X (XInput) modunu sürücüsüz tanımaz. Mode ışığı kapalı olsun, sonra bir tuşa basın.';
    else if (f710 && !st.remapped && raw.every((p) => p.mapping !== 'standard'))
      tip = 'Kumanda ham modda görünüyor; tuşlar beklenenden farklıysa Mode ışığını kapatın.';
    else if (f710) tip = 'F710 D modunda tetikler analog değildir; açık/kapalı çalışır.';
    this.ui.renderPadTest(st.connected, html, tip);
  }

  private rumble(strong: number, weak: number, ms: number): void {
    if (this.settings.vibration) this.input.gamepad.rumble(strong, weak, ms);
  }

  // ===================================================================== menü olayları

  private handleMenuInput(a: FrameActions, paused = false): void {
    const nav = this.ui.nav;
    if (a.navUp) nav.move(-1);
    if (a.navDown) nav.move(1);
    if (a.navLeft && !nav.adjust(-1)) nav.move(-1);
    if (a.navRight && !nav.adjust(1)) nav.move(1);
    if (a.confirm && performance.now() - this.screenShownAt > 250) nav.activate();
    if (a.back || (paused && a.pause)) this.onBack();
  }

  private onBack(): void {
    switch (this.ui.current) {
      case 'settings': {
        const to = this.ui.settingsReturnScreen;
        if (to === 'menu') this.renderMenu();
        this.showScreen(to);
        this.audio.uiBack();
        break;
      }
      case 'controls':
        this.showScreen('menu');
        this.audio.uiBack();
        break;
      case 'garage':
        this.renderMenu();
        this.showScreen('menu');
        this.chase.setMode('cinematic');
        this.audio.uiBack();
        break;
      case 'pause':
        this.resume();
        break;
      default:
        break;
    }
  }

  private onAction(name: UIAction): void {
    if (performance.now() - this.screenShownAt < 200) return;
    if (name !== 'back' && name !== 'pause') this.audio.uiSelect();
    switch (name) {
      case 'start':
      case 'restart':
        this.startRace();
        break;
      case 'settings':
        this.ui.renderSettings(this.settings);
        this.showScreen('settings', { returnTo: this.state === 'paused' ? 'pause' : 'menu' });
        break;
      case 'controls':
        this.ui.renderCredits(CARS.filter((c) => hasModel(c) && c.credit).map((c) => c.credit!));
        this.showScreen('controls');
        break;
      case 'garage':
        this.openGarage();
        break;
      case 'back':
        this.onBack();
        break;
      case 'resume':
        this.resume();
        break;
      case 'menu':
        this.goMenu();
        break;
      case 'pause':
        this.pause();
        break;
    }
  }

  private onSetting(key: keyof GameSettings, dir: number): void {
    const s = this.settings;
    const cycle = <T>(list: readonly T[], v: T): T => list[(list.indexOf(v) + dir + list.length) % list.length];
    switch (key) {
      case 'laps':
        s.laps = cycle(RACE.lapOptions, s.laps as (typeof RACE.lapOptions)[number]);
        break;
      case 'paint':
        s.paint = (s.paint + dir + CAR_PAINTS.length) % CAR_PAINTS.length;
        this.carModel.setPaint(CAR_PAINTS[s.paint]);
        if (this.ui.current === 'garage') this.renderGarage();
        break;
      case 'car':
        this.browseGarage(dir);
        return;
      case 'track': {
        if (this.trackSwitching) return;
        const i = TRACKS.findIndex((t) => t.id === s.track);
        const next = TRACKS[(i + dir + TRACKS.length) % TRACKS.length];
        s.track = next.id;
        saveSettings(s);
        this.audio.uiMove();
        this.ui.toast(`${next.name} hazırlanıyor…`);
        void this.switchTrack(next).then(() => this.renderMenu());
        return;
      }
      case 'sfxVolume':
      case 'musicVolume': {
        let v = Math.round(s[key] * 10) + dir;
        if (v > 10) v = 0;
        if (v < 0) v = 10;
        s[key] = v / 10;
        this.audio.unlock();
        this.audio.setVolumes(s.sfxVolume, s.musicVolume);
        break;
      }
      case 'quality':
        s.quality = cycle<QualitySetting>(['auto', 'low', 'medium', 'high', 'ultra'], s.quality);
        this.applyQuality();
        break;
      case 'cameraShake':
        s.cameraShake = !s.cameraShake;
        this.chase.shakeEnabled = s.cameraShake;
        break;
      case 'vibration':
        s.vibration = !s.vibration;
        if (s.vibration) this.rumble(0.4, 0.6, 150);
        break;
      case 'ghost':
        s.ghost = !s.ghost;
        if (!s.ghost) {
          this.ghostPlayer = null;
          this.ghostModel.root.visible = false;
        } else if (this.race && this.records.ghost) {
          this.ghostPlayer = new GhostPlayer(this.records.ghost);
        }
        break;
      case 'hints':
        s.hints = !s.hints;
        break;
    }
    saveSettings(s);
    this.ui.renderSettings(s);
    this.audio.uiMove();
  }
}
