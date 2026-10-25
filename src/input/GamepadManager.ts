/**
 * Tarayıcının standart Gamepad API'si üzerine ince bir katman.
 *
 * - `gamepadconnected` / `gamepaddisconnected` olaylarını dinler, ayrıca her karede
 *   `navigator.getGamepads()` ile yoklar (bazı tarayıcılar olayları geç/hiç göndermez).
 * - "standard" eşlemeyi esas alır (W3C Gamepad §Remapping): A=0, B=1, X=2, Y=3,
 *   LB=4, RB=5, LT=6, RT=7, Select=8, Start=9, D-pad=12..15, sol çubuk = eksen 0/1.
 * - Standart olmayan eşlemelerde tetikler çoğunlukla eksen 2 ve 5'te (-1..1) gelir;
 *   bu durumda eksenlerden okunur.
 */

export const BUTTON = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  SELECT: 8,
  START: 9,
  L3: 10,
  R3: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

export type ButtonName = keyof typeof BUTTON;

export interface PadSnapshot {
  connected: boolean;
  id: string;
  index: number;
  mapping: string;
  /** Ölü bölge uygulanmış sol çubuk. */
  lx: number;
  ly: number;
  /** 0..1 */
  lt: number;
  rt: number;
  buttons: boolean[];
  /** Logitech DirectInput düzeni standart düzene çevrildi mi. */
  remapped: boolean;
}

/**
 * Logitech F310/F510/F710 "D" (DirectInput) modu ve benzeri ham HID kumandalar: tarayıcı
 * standart eşleme vermezse ham düğme sırası X, A, B, Y, LB, RB, LT, RT, Back, Start, L3, R3'tür.
 * Standart indeks → ham indeks.
 */
const DIRECTINPUT_MAP = [1, 2, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** Logitech DirectInput kumandaları (vendor 046d; F310 c216, F510 c218, F710 c219). */
export function isLogitechDirectInput(id: string): boolean {
  return /046d/i.test(id) && /c216|c218|c219|rumblepad|dual action|f310|f510|f710/i.test(id);
}

/** Logitech F710 X (XInput) modu — macOS bu modu sürücüsüz tanımaz. */
export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);
}

/**
 * Chrome'da şapka (hat/D-pad) tek eksende gelir: yukarı −1, saat yönünde 2/7 adımla,
 * boşta ≈ 1.29. Dönüş: [yukarı, aşağı, sol, sağ].
 */
function decodeHat(v: number): [boolean, boolean, boolean, boolean] {
  if (v > 1.05 || v < -1.05) return [false, false, false, false];
  const i = Math.round((v + 1) / (2 / 7)) % 8; // 0 yukarı, 1 sağ-yukarı, 2 sağ ... 7 sol-yukarı
  return [i === 7 || i === 0 || i === 1, i >= 3 && i <= 5, i >= 5 && i <= 7, i >= 1 && i <= 3];
}

const STICK_DEADZONE = 0.16;
const TRIGGER_DEADZONE = 0.06;
const BUTTON_COUNT = 17;

function emptySnapshot(): PadSnapshot {
  return {
    connected: false,
    id: '',
    index: -1,
    mapping: '',
    lx: 0,
    ly: 0,
    lt: 0,
    rt: 0,
    buttons: new Array(BUTTON_COUNT).fill(false),
    remapped: false,
  };
}

export interface GamepadEvents {
  onConnect?: (id: string) => void;
  onDisconnect?: (id: string) => void;
}

export class GamepadManager {
  readonly supported: boolean;
  /** Etkin kumandanın bu karedeki durumu. */
  readonly state: PadSnapshot = emptySnapshot();
  private prevButtons: boolean[] = new Array(BUTTON_COUNT).fill(false);
  private activeIndex = -1;
  private known = new Map<number, string>();
  /** Standart dışı kumandada tetiklerin eksen 2/5'te olduğu (dinlenmede -1) görüldü mü. */
  private axisTriggers = new Set<number>();
  /** Standart dışı kumandada şapka (D-pad) ekseni: boştayken > 1 değeri görülen eksen. */
  private hatAxis = new Map<number, number>();
  /** Bu karede herhangi bir girdi oldu mu (son kullanılan cihazı belirlemek için). */
  hadInput = false;

  constructor(private readonly events: GamepadEvents = {}) {
    this.supported = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
    if (!this.supported) return;
    window.addEventListener('gamepadconnected', (e) => {
      const gp = (e as GamepadEvent).gamepad;
      this.register(gp);
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      const gp = (e as GamepadEvent).gamepad;
      this.unregister(gp.index);
    });
  }

  get connected(): boolean {
    return this.state.connected;
  }

  get name(): string {
    return prettifyPadName(this.state.id);
  }

  private register(gp: Gamepad): void {
    if (this.known.has(gp.index)) return;
    this.known.set(gp.index, gp.id);
    if (this.activeIndex < 0) this.activeIndex = gp.index;
    this.events.onConnect?.(gp.id);
  }

  private unregister(index: number): void {
    const id = this.known.get(index);
    if (id === undefined) return;
    this.known.delete(index);
    this.axisTriggers.delete(index);
    this.hatAxis.delete(index);
    if (this.activeIndex === index) {
      this.activeIndex = this.known.size ? [...this.known.keys()][0] : -1;
      this.prevButtons.fill(false);
      // Olay dinleyicileri güncel durumu görsün: etkin kumandanın anlık görüntüsünü hemen sıfırla.
      Object.assign(this.state, emptySnapshot());
    }
    this.events.onDisconnect?.(id);
  }

  /** Her karede bir kez çağrılır. */
  poll(): void {
    this.hadInput = false;
    const s = this.state;
    for (let i = 0; i < BUTTON_COUNT; i++) this.prevButtons[i] = s.buttons[i];

    if (!this.supported) return;
    let pads: (Gamepad | null)[] = [];
    try {
      pads = Array.from(navigator.getGamepads?.() ?? []);
    } catch {
      pads = [];
    }

    // Olay gelmeden görünen / olay gelmeden kaybolan kumandaları yakala.
    const seen = new Set<number>();
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      seen.add(gp.index);
      if (!this.known.has(gp.index)) this.register(gp);
    }
    for (const idx of [...this.known.keys()]) if (!seen.has(idx)) this.unregister(idx);

    // Birden çok kumanda varsa son tuşa basılanı etkin yap.
    for (const gp of pads) {
      if (!gp || !gp.connected || gp.index === this.activeIndex) continue;
      if (gp.buttons.some((b) => b.pressed)) {
        this.activeIndex = gp.index;
        this.prevButtons.fill(true); // geçişte yanlış "yeni basıldı" üretme
        break;
      }
    }

    const gp = pads.find((p) => p && p.connected && p.index === this.activeIndex) ?? null;
    if (!gp) {
      if (s.connected) Object.assign(s, emptySnapshot());
      return;
    }

    s.connected = true;
    s.id = gp.id;
    s.index = gp.index;
    s.mapping = gp.mapping;

    const [lx, ly] = radialDeadzone(gp.axes[0] ?? 0, gp.axes[1] ?? 0, STICK_DEADZONE);
    s.lx = lx;
    s.ly = ly;

    const standard = gp.mapping === 'standard';
    const directInput = !standard && isLogitechDirectInput(gp.id);
    s.remapped = directInput;
    const btn = (i: number): GamepadButton | undefined =>
      directInput && i < DIRECTINPUT_MAP.length ? gp.buttons[DIRECTINPUT_MAP[i]] : gp.buttons[i];
    let lt = btn(BUTTON.LT)?.value ?? 0;
    let rt = btn(BUTTON.RT)?.value ?? 0;
    if (!standard && gp.axes.length >= 6) {
      // Standart dışı sürücüler: tetikler eksen 2/5'te, -1 (bırakılmış) .. 1 (tam basılı).
      // Sağ çubuk da bu eksenlerde olabileceği için önce dinlenme değerini (-1) görmek gerekir.
      const a2 = gp.axes[2] ?? 0;
      const a5 = gp.axes[5] ?? 0;
      if (a2 < -0.9 && a5 < -0.9) this.axisTriggers.add(gp.index);
      if (this.axisTriggers.has(gp.index)) {
        lt = Math.max(lt, (a2 + 1) / 2);
        rt = Math.max(rt, (a5 + 1) / 2);
      }
    }
    s.lt = lt > TRIGGER_DEADZONE ? (lt - TRIGGER_DEADZONE) / (1 - TRIGGER_DEADZONE) : 0;
    s.rt = rt > TRIGGER_DEADZONE ? (rt - TRIGGER_DEADZONE) / (1 - TRIGGER_DEADZONE) : 0;

    for (let i = 0; i < BUTTON_COUNT; i++) {
      const b = btn(i);
      s.buttons[i] = !!b && (b.pressed || b.value > 0.5);
    }
    // Tetikler eksenden okunduysa düğme durumunu da onlara göre ayarla.
    s.buttons[BUTTON.LT] = s.buttons[BUTTON.LT] || s.lt > 0.5;
    s.buttons[BUTTON.RT] = s.buttons[BUTTON.RT] || s.rt > 0.5;

    // Standart dışı kumandada D-pad şapka ekseninden gelir.
    if (!standard) {
      if (!this.hatAxis.has(gp.index)) {
        for (let a = 2; a < gp.axes.length; a++) if ((gp.axes[a] ?? 0) > 1.05) this.hatAxis.set(gp.index, a);
      }
      const ha = this.hatAxis.get(gp.index);
      if (ha !== undefined) {
        const [up, down, left, right] = decodeHat(gp.axes[ha] ?? 2);
        s.buttons[BUTTON.UP] ||= up;
        s.buttons[BUTTON.DOWN] ||= down;
        s.buttons[BUTTON.LEFT] ||= left;
        s.buttons[BUTTON.RIGHT] ||= right;
      }
    }

    this.hadInput =
      Math.abs(s.lx) > 0.3 || Math.abs(s.ly) > 0.3 || s.lt > 0.1 || s.rt > 0.1 || s.buttons.some(Boolean);
  }

  pressed(b: number): boolean {
    return this.state.buttons[b] ?? false;
  }

  justPressed(b: number): boolean {
    return (this.state.buttons[b] ?? false) && !this.prevButtons[b];
  }

  /** Kısa titreşim; desteklenmiyorsa sessizce yok sayılır. */
  rumble(strong: number, weak: number, durationMs: number): void {
    if (!this.supported || this.activeIndex < 0) return;
    try {
      const gp = navigator.getGamepads()[this.activeIndex];
      const act = (gp as (Gamepad & { vibrationActuator?: GamepadHapticActuator }) | null)?.vibrationActuator;
      void act?.playEffect?.('dual-rumble', {
        startDelay: 0,
        duration: durationMs,
        strongMagnitude: Math.min(1, Math.max(0, strong)),
        weakMagnitude: Math.min(1, Math.max(0, weak)),
      })?.catch(() => undefined);
    } catch {
      /* titreşim desteklenmiyor */
    }
  }
}

function radialDeadzone(x: number, y: number, dz: number): [number, number] {
  const mag = Math.hypot(x, y);
  if (mag < dz) return [0, 0];
  const scaled = Math.min(1, (mag - dz) / (1 - dz));
  return [(x / mag) * scaled, (y / mag) * scaled];
}

/** "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)" → "Xbox Wireless Controller" */
export function prettifyPadName(id: string): string {
  if (!id) return '';
  let name = id.replace(/\(.*?(vendor|product|standard gamepad).*?\)/gi, '').trim();
  name = name.replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '').trim();
  if (!name) name = 'Gamepad';
  if (/xbox|xinput/i.test(id)) return name.length > 28 ? 'Xbox Kumanda' : name;
  if (/054c|dualsense|dualshock|playstation|wireless controller/i.test(id) && !/xbox/i.test(id))
    return /dualsense|0ce6/i.test(id) ? 'DualSense' : name.length > 28 ? 'PlayStation Kumanda' : name;
  return name.length > 32 ? name.slice(0, 30) + '…' : name;
}

/** PlayStation ise Cross/Circle/Options gibi etiketler göster. */
export function padStyle(id: string): 'xbox' | 'playstation' | 'generic' {
  if (/054c|dualsense|dualshock|playstation/i.test(id)) return 'playstation';
  if (/xbox|xinput|045e/i.test(id)) return 'xbox';
  return 'generic';
}
