/**
 * Menülerde klavye/gamepad ile odak gezintisi. Etkin ekranın `[data-nav]` öğeleri arasında
 * dolaşır; fareyle üzerine gelmek odağı da taşır. Öğeye gerçek DOM odağı verilir, böylece
 * Enter/Space tarayıcı tarafından düğmeye iletilir ve ekran okuyucular doğru çalışır.
 */
export class MenuNavigator {
  private root: HTMLElement | null = null;
  private items: HTMLElement[] = [];
  private index = 0;
  onMove?: () => void;
  onAdjust?: (el: HTMLElement, dir: number) => void;

  constructor(container: HTMLElement) {
    container.addEventListener('pointermove', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-nav]');
      if (!el || !this.root?.contains(el)) return;
      const i = this.items.indexOf(el);
      if (i >= 0 && i !== this.index) this.focus(i, false);
    });
  }

  setRoot(root: HTMLElement | null, preferred?: HTMLElement | null): void {
    this.root = root;
    this.refresh();
    if (!root) return;
    const auto = preferred ?? root.querySelector<HTMLElement>('[data-autofocus]');
    const i = auto ? this.items.indexOf(auto) : 0;
    this.focus(Math.max(0, i), false);
  }

  refresh(): void {
    if (!this.root) {
      this.items = [];
      return;
    }
    this.items = Array.from(this.root.querySelectorAll<HTMLElement>('[data-nav]')).filter(
      (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
    );
    this.index = Math.min(this.index, Math.max(0, this.items.length - 1));
  }

  get current(): HTMLElement | null {
    return this.items[this.index] ?? null;
  }

  private focus(i: number, sound = true): void {
    if (!this.items.length) return;
    this.items.forEach((el) => el.classList.remove('is-focused'));
    this.index = (i + this.items.length) % this.items.length;
    const el = this.items[this.index];
    el.classList.add('is-focused');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
    if (sound) this.onMove?.();
  }

  move(delta: number): void {
    if (!this.items.length) return;
    // DOM odağı başka yerdeyse (fare tıklaması) oradan devam et
    const active = document.activeElement as HTMLElement | null;
    const ai = active ? this.items.indexOf(active) : -1;
    if (ai >= 0) this.index = ai;
    this.focus(this.index + delta);
  }

  adjust(dir: number): boolean {
    const el = this.current;
    if (!el || !el.hasAttribute('data-setting')) return false;
    this.onAdjust?.(el, dir);
    return true;
  }

  activate(): void {
    this.current?.click();
  }
}
