import { CAR_PAINTS, type QualitySetting } from '../config';
import type { CarCredit } from '../vehicle/cars';
import type { InputDevice } from '../input/InputManager';
import type { Medal } from '../race/RaceSession';
import type { GameSettings, Records } from '../settings/Settings';
import { formatDelta, formatTime } from './format';
import { MenuNavigator } from './MenuNavigator';

export type ScreenName = 'loading' | 'error' | 'menu' | 'garage' | 'settings' | 'controls' | 'pause' | 'results';

export type UIAction = 'start' | 'garage' | 'settings' | 'controls' | 'back' | 'resume' | 'restart' | 'menu' | 'pause';

export interface UIHandlers {
  action(name: UIAction): void;
  setting(key: keyof GameSettings, dir: number): void;
  /** Herhangi bir kullanıcı etkileşimi (ses bağlamını açmak için). */
  interact(): void;
}

export interface HudData {
  /** Otoyol sprinti: tur yerine kilometre ve çarpma sayısı. */
  sprint?: { km: number; totalKm: number; crashes: number; target: number };
  lap: number;
  laps: number;
  lapTime: number;
  best: number | null;
  delta: number | null;
  total: number;
  speedKmh: number;
  speedFrac: number;
  driftCharge: number;
  driftLevel: number;
  drifting: boolean;
  boosting: boolean;
}

export interface ResultsData {
  total: number;
  laps: number[];
  /** Sprintte kilometre ara süreleri. */
  splits?: number[];
  crashes?: number;
  medal: Medal;
  newRecord: boolean;
  newBestLap: boolean;
  previousRecord: number | null;
  targets: { gold: number; silver: number; bronze: number };
}

export type PadStyle = 'xbox' | 'playstation' | 'generic';

const QUALITY_LABEL: Record<QualitySetting, string> = {
  auto: 'Otomatik',
  low: 'Düşük',
  medium: 'Orta',
  high: 'Yüksek',
  ultra: 'Ultra',
};

const SETTING_ROWS: Array<{ key: keyof GameSettings; label: string; hint?: string }> = [
  { key: 'laps', label: 'Tur sayısı' },
  { key: 'paint', label: 'Araç rengi', hint: 'Garajdaki seçili araca uygulanır' },
  { key: 'sfxVolume', label: 'Ses efektleri', hint: 'Motor, lastik, geri sayım' },
  { key: 'musicVolume', label: 'Müzik', hint: 'Sentezlenmiş synthwave döngüsü' },
  { key: 'quality', label: 'Grafik kalitesi', hint: 'Bloom, gölge, parçacık, çözünürlük' },
  { key: 'cameraShake', label: 'Kamera sarsıntısı' },
  { key: 'vibration', label: 'Gamepad titreşimi' },
  { key: 'ghost', label: 'Hayalet araç', hint: 'En iyi turunu yarı saydam araçla göster' },
  { key: 'hints', label: 'Öğretici ipuçları' },
];

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} bulunamadı`);
  return el;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function keyLabels(device: InputDevice, style: PadStyle) {
  if (device === 'gamepad') {
    const ps = style === 'playstation';
    return {
      throttle: ps ? 'R2' : 'RT',
      brake: ps ? 'L2' : 'LT',
      steer: 'Sol çubuk',
      drift: ps ? '✕' : 'A',
      respawn: ps ? '△' : 'Y',
      pause: ps ? 'Options' : 'Start',
      confirm: ps ? '✕' : 'A',
      back: ps ? '○' : 'B',
      nav: 'D-pad',
    };
  }
  return {
    throttle: 'W',
    brake: 'S',
    steer: 'A D',
    drift: 'Space',
    respawn: 'R',
    pause: 'Esc',
    confirm: 'Enter',
    back: 'Esc',
    nav: '↑ ↓',
  };
}

const kbd = (k: string) =>
  k
    .split(' ')
    .map((p) => `<kbd>${escapeHtml(p)}</kbd>`)
    .join(' ');

function creditHtml(c: CarCredit): string {
  return `“${escapeHtml(c.title)}” — ${escapeHtml(c.author)} · <a href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer">Sketchfab</a> · ${escapeHtml(c.license)}`;
}

export class UI {
  readonly nav: MenuNavigator;
  current: ScreenName = 'loading';
  private readonly screens = new Map<ScreenName, HTMLElement>();
  private readonly hud = $('hud');
  private readonly cache = new Map<string, string>();
  private flashTimer = 0;
  private settingsReturn: ScreenName = 'menu';
  private device: InputDevice = 'keyboard';
  private padStyle: PadStyle = 'generic';

  // Önbelleğe alınmış HUD öğeleri
  private readonly el = {
    lap: $('hud-lap'),
    laps: $('hud-laps'),
    lapTime: $('hud-laptime'),
    best: $('hud-best'),
    delta: $('hud-delta'),
    total: $('hud-total'),
    target: $('hud-target'),
    speed: $('hud-speed'),
    speedFill: $('speedo-fill'),
    speedo: document.querySelector('.speedo') as HTMLElement,
    driftMeter: $('drift-meter'),
    driftFill: $('drift-fill'),
    driftState: $('drift-state'),
    hints: $('hud-hints'),
    flash: $('hud-flash'),
    warning: $('hud-warning'),
    warningTitle: $('hud-warning-title'),
    warningSub: $('hud-warning-sub'),
    tutorial: $('tutorial'),
    countdown: $('countdown'),
    toasts: $('toasts'),
    hudPad: $('hud-pad'),
    menuPad: $('menu-pad'),
    menuPadText: $('menu-pad-text'),
    menuRecord: $('menu-record'),
    menuHowto: $('menu-howto'),
    menuFooter: $('menu-footer'),
    settingsList: $('settings-list'),
    pauseSub: $('pause-sub'),
  };

  constructor(private readonly handlers: UIHandlers) {
    for (const name of ['loading', 'error', 'menu', 'garage', 'settings', 'controls', 'pause', 'results'] as ScreenName[]) {
      this.screens.set(name, $(`screen-${name}`));
    }
    const root = $('ui');
    this.nav = new MenuNavigator(root);
    this.nav.onAdjust = (el, dir) => {
      const key = el.dataset.setting as keyof GameSettings | undefined;
      if (key) this.handlers.setting(key, dir);
    };

    root.addEventListener('click', (e) => {
      this.handlers.interact();
      const target = e.target as HTMLElement;
      const arrow = target.closest<HTMLElement>('.opt-arrow');
      const opt = target.closest<HTMLElement>('[data-setting]');
      if (opt) {
        const dir = arrow ? Number(arrow.dataset.dir) || 1 : 1;
        this.handlers.setting(opt.dataset.setting as keyof GameSettings, dir);
        return;
      }
      const btn = target.closest<HTMLElement>('[data-action]');
      if (btn) this.handlers.action(btn.dataset.action as UIAction);
    });
    $('hud-pause').addEventListener('click', () => this.handlers.action('pause'));
    window.addEventListener('pointerdown', () => this.handlers.interact(), { passive: true });
    window.addEventListener('keydown', () => this.handlers.interact());
  }

  /** Sadece değişince DOM'a yaz. */
  private set(el: HTMLElement, key: string, text: string): void {
    if (this.cache.get(key) === text) return;
    this.cache.set(key, text);
    el.textContent = text;
  }

  show(name: ScreenName | null, opts: { returnTo?: ScreenName } = {}): void {
    if (name === 'settings') this.settingsReturn = opts.returnTo ?? (this.current === 'pause' ? 'pause' : 'menu');
    for (const [n, el] of this.screens) el.classList.toggle('is-active', n === name);
    this.current = name ?? ('none' as ScreenName);
    const root = name ? this.screens.get(name)! : null;
    // Yalnızca menü ekranlarında gezinti
    this.nav.setRoot(root && name !== 'loading' && name !== 'error' ? root : null);
    if (!name) (document.activeElement as HTMLElement | null)?.blur?.();
  }

  get settingsReturnScreen(): ScreenName {
    return this.settingsReturn;
  }

  setLoading(progress: number, text: string): void {
    ($('loading-fill') as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
    $('loading-text').textContent = text;
  }

  showError(message: string): void {
    $('error-text').textContent = message;
    this.show('error');
  }

  // ---------- HUD ----------

  showHud(visible: boolean): void {
    this.hud.hidden = !visible;
  }

  setHudTarget(text: string): void {
    this.set(this.el.target, 'target', text);
  }

  setHudMode(sprint: boolean): void {
    $('hud-lap-label').textContent = sprint ? 'KM' : 'TUR';
    $('hud-row1-label').textContent = sprint ? 'HEDEF' : 'TUR';
    $('hud-row2-label').textContent = 'EN İYİ';
    $('hud-row3-label').textContent = sprint ? 'ÇARPMA' : 'FARK';
    this.cache.clear();
  }

  updateHud(d: HudData): void {
    const e = this.el;
    this.set(e.total, 'total', formatTime(d.total));
    this.set(e.best, 'best', formatTime(d.best));
    if (d.sprint) {
      this.set(e.lap, 'lap', d.sprint.km.toFixed(1));
      this.set(e.laps, 'laps', d.sprint.totalKm.toFixed(1));
      this.set(e.lapTime, 'lapTime', formatTime(d.sprint.target));
      this.set(e.delta, 'delta', String(d.sprint.crashes));
    } else {
      this.set(e.lap, 'lap', String(d.lap));
      this.set(e.laps, 'laps', String(d.laps));
      this.set(e.lapTime, 'lapTime', formatTime(d.lapTime));
    }
    const deltaText = d.sprint ? `c${d.sprint.crashes}` : d.delta === null ? '—' : formatDelta(d.delta);
    if (this.cache.get('deltaKey') !== deltaText) {
      this.cache.set('deltaKey', deltaText);
      if (!d.sprint) this.set(e.delta, 'delta', deltaText);
      e.delta.classList.toggle('is-good', !d.sprint && d.delta !== null && d.delta < 0);
      e.delta.classList.toggle('is-bad', (!d.sprint && d.delta !== null && d.delta >= 0) || (!!d.sprint && d.sprint.crashes > 0));
    }
    this.set(e.speed, 'speed', String(Math.round(d.speedKmh)));
    const frac = Math.max(0, Math.min(1, d.speedFrac)) * 100;
    const dash = `${frac.toFixed(1)} 100`;
    if (this.cache.get('dash') !== dash) {
      this.cache.set('dash', dash);
      e.speedFill.style.strokeDasharray = dash;
    }
    const boostKey = d.boosting ? '1' : '0';
    if (this.cache.get('boost') !== boostKey) {
      this.cache.set('boost', boostKey);
      e.speedo.classList.toggle('is-boost', d.boosting);
    }

    const level = d.boosting ? 'boost' : String(d.driftLevel);
    if (this.cache.get('dlevel') !== level) {
      this.cache.set('dlevel', level);
      e.driftMeter.dataset.level = level;
    }
    const width = `${(d.boosting ? 100 : d.driftCharge * 100).toFixed(0)}%`;
    if (this.cache.get('dwidth') !== width) {
      this.cache.set('dwidth', width);
      e.driftFill.style.width = width;
    }
    const state = d.boosting
      ? 'TURBO!'
      : d.drifting
        ? d.driftLevel === 2
          ? 'SÜPER TURBO — BIRAK!'
          : d.driftLevel === 1
            ? 'TURBO HAZIR — BIRAK!'
            : 'DRİFT…'
        : 'DRİFT AT, ŞARJ ET';
    this.set(e.driftState, 'dstate', state);
  }

  setInputDevice(device: InputDevice, style: PadStyle): void {
    this.device = device;
    this.padStyle = style;
    const k = keyLabels(device, style);
    const kbExtra = device === 'keyboard';
    this.el.hints.innerHTML = [
      `<span>${kbd(k.throttle)}${kbExtra ? ' <kbd>↑</kbd>' : ''} Gaz</span>`,
      `<span>${kbd(k.brake)}${kbExtra ? ' <kbd>↓</kbd>' : ''} Fren</span>`,
      `<span>${device === 'gamepad' ? escapeHtml(k.steer) : kbd(k.steer)} Yön</span>`,
      `<span>${kbd(k.drift)} Drift</span>`,
      `<span>${kbd(k.respawn)} Piste dön</span>`,
      `<span>${kbd(k.pause)} Duraklat</span>`,
    ].join('');

    this.el.menuHowto.innerHTML = [
      ['Gaz', device === 'gamepad' ? kbd(k.throttle) : `${kbd('W')} ${kbd('↑')}`],
      ['Fren / geri', device === 'gamepad' ? kbd(k.brake) : `${kbd('S')} ${kbd('↓')}`],
      ['Yön', device === 'gamepad' ? escapeHtml(k.steer) : `${kbd('A')} ${kbd('D')}`],
      ['Drift (basılı tut)', kbd(k.drift)],
      ['Duraklat', kbd(k.pause)],
    ]
      .map(([a, b]) => `<li><span>${a}</span><span>${b}</span></li>`)
      .join('');

    this.el.menuFooter.innerHTML =
      device === 'gamepad'
        ? `<span>${escapeHtml(k.nav)} Seç</span><span>${kbd(k.confirm)} Onayla</span><span>${kbd(k.back)} Geri</span>`
        : `<span>${kbd('↑')} ${kbd('↓')} Seç</span><span>${kbd('Enter')} Onayla</span><span>${kbd('Esc')} Geri</span>`;
  }

  get labels() {
    return keyLabels(this.device, this.padStyle);
  }

  fadeHints(faded: boolean): void {
    this.el.hints.classList.toggle('is-faded', faded);
  }

  setPadStatus(connected: boolean, name: string): void {
    const state = connected ? 'on' : 'off';
    this.el.hudPad.dataset.state = state;
    this.el.menuPad.dataset.state = state;
    const text = connected ? name : 'Klavye';
    this.el.hudPad.querySelector('.pad-text')!.textContent = text;
    this.el.menuPadText.textContent = connected
      ? `Gamepad bağlı: ${name}`
      : 'Gamepad algılanmadı — bağlayıp bir tuşa basın. Logitech F710 ise arkadaki anahtarı D konumuna alın.';
  }

  toast(message: string, kind: 'info' | 'warn' | 'good' = 'info', ms = 3200): void {
    const t = document.createElement('div');
    t.className = `toast${kind === 'warn' ? ' is-warn' : kind === 'good' ? ' is-good' : ''}`;
    t.textContent = message;
    this.el.toasts.append(t);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstElementChild?.remove();
    window.setTimeout(() => {
      t.classList.add('is-out');
      window.setTimeout(() => t.remove(), 320);
    }, ms);
  }

  flash(title: string, sub = '', tone: 'mag' | 'cyan' | 'amber' | 'green' | 'red' = 'mag', ms = 1500): void {
    const color = { mag: 'var(--mag)', cyan: 'var(--cyan)', amber: 'var(--amber)', green: 'var(--green)', red: 'var(--red)' }[tone];
    const box = document.createElement('div');
    box.className = 'flash-msg';
    box.style.setProperty('--tone', color);
    box.innerHTML = `<b>${escapeHtml(title)}</b>${sub ? `<span>${escapeHtml(sub)}</span>` : ''}`;
    this.el.flash.replaceChildren(box);
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      box.classList.add('is-out');
      window.setTimeout(() => box.remove(), 360);
    }, ms);
  }

  clearFlash(): void {
    window.clearTimeout(this.flashTimer);
    this.el.flash.replaceChildren();
  }

  setWarning(kind: 'wrong' | 'offroad' | null, sub = ''): void {
    const key = `${kind}|${sub}`;
    if (this.cache.get('warn') === key) return;
    this.cache.set('warn', key);
    const w = this.el.warning;
    if (!kind) {
      w.hidden = true;
      return;
    }
    w.hidden = false;
    w.classList.toggle('is-amber', kind === 'offroad');
    this.el.warningTitle.textContent = kind === 'wrong' ? 'TERS YÖN' : 'PİST DIŞI';
    this.el.warningSub.innerHTML = sub;
  }

  showTutorial(html: string | null): void {
    const t = this.el.tutorial;
    if (!html) {
      t.hidden = true;
      this.cache.delete('tut');
      return;
    }
    if (this.cache.get('tut') === html) return;
    this.cache.set('tut', html);
    t.innerHTML = `<small>İPUCU</small>${html}`;
    t.hidden = false;
    // Animasyonu yeniden başlat
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
  }

  kbd(k: string): string {
    return kbd(k);
  }

  showCountdown(text: string | null, go = false): void {
    const c = this.el.countdown;
    if (!text) {
      c.replaceChildren();
      return;
    }
    const b = document.createElement('b');
    b.textContent = text;
    if (go) b.className = 'is-go';
    c.replaceChildren(b);
  }

  /** Kontroller ekranındaki canlı kumanda testi. */
  renderPadTest(connected: boolean, html: string, tip: string): void {
    const key = `${connected}|${html}|${tip}`;
    if (this.cache.get('padtest') === key) return;
    this.cache.set('padtest', key);
    $('pad-test').dataset.state = connected ? 'on' : 'off';
    $('pad-test-body').innerHTML = html;
    $('pad-tip').textContent = tip;
  }

  setPauseSub(text: string): void {
    this.el.pauseSub.textContent = text;
  }

  // ---------- Menü ----------

  renderMenu(
    records: Records,
    settings: GameSettings,
    targets: { gold: number },
    carName: string,
    track: { name: string; blurb: string; sprint: boolean },
  ): void {
    const lapsKey = track.sprint ? '1' : String(settings.laps);
    const rec = records.bestTotal[lapsKey] ?? null;
    $('menu-track-name').textContent = track.name;
    $('menu-track-blurb').textContent = track.blurb;
    this.el.menuRecord.innerHTML = [
      ['Araç', `${escapeHtml(carName)} · ${escapeHtml(CAR_PAINTS[settings.paint].name)}`],
      [track.sprint ? 'Rekor · 4 km' : `Rekor · ${settings.laps} tur`, formatTime(rec)],
      ...(track.sprint ? [] : [['En iyi tur', formatTime(records.bestLap)]]),
      ['Altın hedef', formatTime(targets.gold)],
    ]
      .map(([a, b]) => `<div class="rec-item"><span class="rec-label">${a}</span><b>${b}</b></div>`)
      .join('');
  }

  renderSettings(s: GameSettings): void {
    const list = this.el.settingsList;
    const focusedKey = (document.activeElement as HTMLElement | null)?.dataset?.setting;
    list.innerHTML = SETTING_ROWS.map((row) => {
      const value = this.settingValue(row.key, s);
      return `<button class="opt" type="button" data-nav data-setting="${row.key}">
        <span class="opt-label">${row.label}${row.hint ? `<small>${row.hint}</small>` : ''}</span>
        <span class="opt-value"><i class="opt-arrow" data-dir="-1" aria-hidden="true">◀</i><b>${value}</b><i class="opt-arrow" data-dir="1" aria-hidden="true">▶</i></span>
      </button>`;
    }).join('');
    if (this.current === 'settings') {
      const keep = focusedKey ? list.querySelector<HTMLElement>(`[data-setting="${focusedKey}"]`) : null;
      this.nav.setRoot(this.screens.get('settings')!, keep);
    }
  }

  private settingValue(key: keyof GameSettings, s: GameSettings): string {
    const pct = (v: number) => (v <= 0.001 ? 'Kapalı' : `%${Math.round(v * 100)}`);
    switch (key) {
      case 'laps':
        return `${s.laps} tur`;
      case 'paint': {
        const p = CAR_PAINTS[s.paint];
        const hex = `#${p.accent.toString(16).padStart(6, '0')}`;
        return `<span class="opt-swatch" style="background:${hex};color:${hex}"></span>${escapeHtml(p.name)}`;
      }
      case 'sfxVolume':
        return pct(s.sfxVolume);
      case 'musicVolume':
        return pct(s.musicVolume);
      case 'quality':
        return QUALITY_LABEL[s.quality];
      default:
        return s[key] ? 'Açık' : 'Kapalı';
    }
  }

  // ---------- Garaj ----------

  renderGarage(g: {
    index: number;
    total: number;
    name: string;
    short: string;
    year: string;
    blurb: string;
    stats: { speed: number; accel: number; grip: number; drift: number };
    status: string;
    paint: string;
    credit?: CarCredit;
  }): void {
    $('garage-index').textContent = `${g.index + 1} / ${g.total}`;
    $('garage-name').textContent = g.name;
    $('garage-blurb').textContent = `${g.year} · ${g.blurb}`;
    $('garage-car-short').textContent = g.short;
    $('garage-paint').textContent = g.paint;
    $('garage-status').textContent = g.status;
    const rows: Array<[string, number]> = [
      ['Son hız', g.stats.speed],
      ['İvme', g.stats.accel],
      ['Yol tutuş', g.stats.grip],
      ['Drift', g.stats.drift],
    ];
    $('garage-stats').innerHTML = rows
      .map(
        ([label, v]) =>
          `<div class="stat-row"><span>${label}</span><span class="stat-bar">${Array.from({ length: 10 }, (_, i) => `<i class="${i < v ? 'on' : ''}${i < v && v >= 9 ? ' hi' : ''}"></i>`).join('')}</span><b>${v}</b></div>`,
      )
      .join('');
    $('garage-credit').innerHTML = g.credit ? creditHtml(g.credit) : 'Model: kodla üretildi (Neon Drift).';
  }

  renderCredits(credits: CarCredit[]): void {
    $('credits').innerHTML = credits.length
      ? `<b>Araç modelleri</b> (Sketchfab):<br>` + credits.map((c) => creditHtml(c)).join('<br>')
      : '';
  }

  // ---------- Sonuç ----------

  renderResults(r: ResultsData): void {
    $('results-title').textContent = formatTime(r.total);
    $('results-kicker').textContent = r.medal ? 'Yarış tamamlandı' : 'Yarış tamamlandı — hedefe biraz kaldı';
    const badges: string[] = [];
    const medalText = { gold: 'Altın', silver: 'Gümüş', bronze: 'Bronz' } as const;
    badges.push(
      r.medal
        ? `<span class="badge badge-${r.medal}">★ ${medalText[r.medal]} madalya</span>`
        : `<span class="badge badge-none">Madalya yok</span>`,
    );
    if (r.newRecord) badges.push(`<span class="badge badge-record">Yeni rekor!</span>`);
    else if (r.previousRecord !== null)
      badges.push(`<span class="badge badge-none">Rekor ${formatTime(r.previousRecord)} (${formatDelta(r.total - r.previousRecord)})</span>`);
    if (r.newBestLap && !r.newRecord) badges.push(`<span class="badge badge-record">En iyi tur!</span>`);
    $('results-badges').innerHTML = badges.join('');

    if (r.splits) {
      $('results-laps-title').textContent = 'Ara süreler';
      const rows = r.splits.map((t, i) => `<li><span>${i + 1}. km</span><b>${formatTime(t)}</b></li>`);
      rows.push(`<li class="is-best"><span>Bitiş</span><b>${formatTime(r.total)}</b></li>`);
      rows.push(`<li><span>Çarpma</span><b>${r.crashes ?? 0}</b></li>`);
      $('results-laps').innerHTML = rows.join('');
    } else {
      $('results-laps-title').textContent = 'Turlar';
      const best = Math.min(...r.laps);
      $('results-laps').innerHTML = r.laps
        .map((t, i) => `<li class="${t === best ? 'is-best' : ''}"><span>Tur ${i + 1}${t === best ? ' · en iyi' : ''}</span><b>${formatTime(t)}</b></li>`)
        .join('');
    }
    const rows: Array<[string, number]> = [
      ['Altın', r.targets.gold],
      ['Gümüş', r.targets.silver],
      ['Bronz', r.targets.bronze],
    ];
    $('results-targets').innerHTML = rows
      .map(([n, t]) => `<li class="${r.total <= t ? 'is-hit' : ''}"><span>${r.total <= t ? '✓ ' : ''}${n}</span><b>${formatTime(t)}</b></li>`)
      .join('');
  }
}
