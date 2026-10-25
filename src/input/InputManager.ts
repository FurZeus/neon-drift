import type { DriveInput } from '../vehicle/CarPhysics';
import { BUTTON, GamepadManager, padStyle } from './GamepadManager';
import { KeyboardManager } from './KeyboardManager';

export type InputDevice = 'keyboard' | 'gamepad';

export interface FrameActions {
  drive: DriveInput;
  pause: boolean;
  respawn: boolean;
  navUp: boolean;
  navDown: boolean;
  navLeft: boolean;
  navRight: boolean;
  /** Menüde onay (kumanda A). Klavyede Enter/Space odaklı düğmeyi tarayıcı tetikler. */
  confirm: boolean;
  /** Menüde geri (kumanda B, klavye Escape/Backspace). */
  back: boolean;
}

const NAV_DELAY = 0.38;
const NAV_REPEAT = 0.12;

/** Klavye ve kumandayı tek bir eylem kümesinde birleştirir. */
export class InputManager {
  readonly keyboard = new KeyboardManager();
  readonly gamepad: GamepadManager;
  lastDevice: InputDevice = 'keyboard';
  onDeviceChange?: (device: InputDevice) => void;

  readonly actions: FrameActions = {
    drive: { steer: 0, throttle: 0, brake: 0, handbrake: false },
    pause: false,
    respawn: false,
    navUp: false,
    navDown: false,
    navLeft: false,
    navRight: false,
    confirm: false,
    back: false,
  };

  private navHeld: 'up' | 'down' | 'left' | 'right' | null = null;
  private navTimer = 0;

  constructor(events: { onPadConnect?: (id: string) => void; onPadDisconnect?: (id: string) => void } = {}) {
    this.gamepad = new GamepadManager({
      onConnect: (id) => events.onPadConnect?.(id),
      onDisconnect: (id) => {
        if (!this.gamepad.connected) this.setDevice('keyboard');
        events.onPadDisconnect?.(id);
      },
    });
  }

  get padStyle(): 'xbox' | 'playstation' | 'generic' {
    return padStyle(this.gamepad.state.id);
  }

  private setDevice(d: InputDevice): void {
    if (d === this.lastDevice) return;
    this.lastDevice = d;
    this.onDeviceChange?.(d);
  }

  update(dt: number): FrameActions {
    const kb = this.keyboard;
    const gp = this.gamepad;
    gp.poll();
    const pad = gp.state;

    if (kb.hadInput) this.setDevice('keyboard');
    else if (gp.hadInput) this.setDevice('gamepad');

    // ---- Sürüş ----
    const a = this.actions;
    let steer = 0;
    if (kb.isDown('KeyA', 'ArrowLeft')) steer -= 1;
    if (kb.isDown('KeyD', 'ArrowRight')) steer += 1;
    let throttle = kb.isDown('KeyW', 'ArrowUp') ? 1 : 0;
    let brake = kb.isDown('KeyS', 'ArrowDown') ? 1 : 0;
    let handbrake = kb.isDown('Space');

    if (pad.connected) {
      // Hafif üstel eğri: merkeze yakın daha hassas direksiyon.
      const lx = Math.sign(pad.lx) * Math.pow(Math.abs(pad.lx), 1.35);
      steer += lx;
      if (gp.pressed(BUTTON.LEFT)) steer -= 1;
      if (gp.pressed(BUTTON.RIGHT)) steer += 1;
      throttle = Math.max(throttle, pad.rt);
      brake = Math.max(brake, pad.lt);
      handbrake = handbrake || gp.pressed(BUTTON.A);
    }
    a.drive.steer = Math.max(-1, Math.min(1, steer));
    a.drive.throttle = throttle;
    a.drive.brake = brake;
    a.drive.handbrake = handbrake;

    // ---- Tek seferlik eylemler ----
    a.pause = kb.justPressed('Escape', 'KeyP') || gp.justPressed(BUTTON.START);
    a.respawn = kb.justPressed('KeyR') || gp.justPressed(BUTTON.Y);
    a.confirm = gp.justPressed(BUTTON.A);
    a.back = kb.justPressed('Escape', 'Backspace') || gp.justPressed(BUTTON.B);

    // ---- Menü gezintisi (klavye: tuş tekrarları; kumanda: kendi tekrar zamanlayıcımız) ----
    a.navUp = kb.repeated('ArrowUp', 'KeyW');
    a.navDown = kb.repeated('ArrowDown', 'KeyS');
    a.navLeft = kb.repeated('ArrowLeft', 'KeyA');
    a.navRight = kb.repeated('ArrowRight', 'KeyD');

    if (pad.connected) {
      let dir: typeof this.navHeld = null;
      if (gp.pressed(BUTTON.UP) || pad.ly < -0.55) dir = 'up';
      else if (gp.pressed(BUTTON.DOWN) || pad.ly > 0.55) dir = 'down';
      else if (gp.pressed(BUTTON.LEFT) || pad.lx < -0.55) dir = 'left';
      else if (gp.pressed(BUTTON.RIGHT) || pad.lx > 0.55) dir = 'right';
      let fire = false;
      if (dir !== this.navHeld) {
        this.navHeld = dir;
        this.navTimer = NAV_DELAY;
        fire = dir !== null;
      } else if (dir) {
        this.navTimer -= dt;
        if (this.navTimer <= 0) {
          this.navTimer = NAV_REPEAT;
          fire = true;
        }
      }
      if (fire) {
        if (dir === 'up') a.navUp = true;
        if (dir === 'down') a.navDown = true;
        if (dir === 'left') a.navLeft = true;
        if (dir === 'right') a.navRight = true;
      }
    } else {
      this.navHeld = null;
    }

    return a;
  }

  endFrame(): void {
    this.keyboard.endFrame();
  }
}
