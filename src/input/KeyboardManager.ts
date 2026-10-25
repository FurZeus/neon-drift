/** Klavye durumunu `KeyboardEvent.code` üzerinden izler (klavye düzeninden bağımsız). */

const GAME_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
]);

export class KeyboardManager {
  private down = new Set<string>();
  private pressedThisFrame = new Set<string>();
  /** Tekrar eden (basılı tutulan) tuş olayları dahil — menü gezintisi için. */
  private repeatsThisFrame: string[] = [];
  hadInput = false;
  /** Oyun sırasında Space/oklar sayfayı kaydırmasın; menüde düğme etkileşimine izin ver. */
  captureGameKeys = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      this.hadInput = true;
      if (!e.repeat) {
        this.down.add(e.code);
        this.pressedThisFrame.add(e.code);
      }
      this.repeatsThisFrame.push(e.code);
      // Basılı tutulan Space/Enter, odak yeni bir menü düğmesine geçince onu tetiklemesin.
      if (e.repeat && (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter')) {
        e.preventDefault();
        return;
      }
      if (GAME_KEYS.has(e.code)) {
        const t = e.target;
        const onButton = t instanceof Element && (t.tagName === 'BUTTON' || t.getAttribute('role') === 'button');
        // Menüde Space/Enter düğmeyi tetikler; oyunda ve oklarla gezinirken kaydırmayı engelle.
        if (this.captureGameKeys || !onButton || e.code.startsWith('Arrow')) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    // Odak kaybında takılı kalan tuşları bırak.
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    });
  }

  clear(): void {
    this.down.clear();
    this.pressedThisFrame.clear();
    this.repeatsThisFrame.length = 0;
  }

  isDown(...codes: string[]): boolean {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  justPressed(...codes: string[]): boolean {
    for (const c of codes) if (this.pressedThisFrame.has(c)) return true;
    return false;
  }

  /** Basılı tutmada tekrar eden olaylar dahil. */
  repeated(...codes: string[]): boolean {
    for (const c of codes) if (this.repeatsThisFrame.includes(c)) return true;
    return false;
  }

  endFrame(): void {
    this.pressedThisFrame.clear();
    this.repeatsThisFrame.length = 0;
    this.hadInput = false;
  }
}
