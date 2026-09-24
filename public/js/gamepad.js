// Controller input: Xbox, PlayStation, Switch Pro and Steam Deck (Steam presents it as an
// Xbox-style pad), via the browser Gamepad API. Polled every animation frame; emits named
// button presses with auto-repeat, holds, and analog stick values.
// Polled on a 60 Hz timer (not the render loop), so input stays responsive even when the
// 3D scene is rendering slowly.

// Standard Gamepad mapping (https://w3c.github.io/gamepad/#remapping)
const BUTTONS = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'view', 'menu', 'ls', 'rs', 'up', 'down', 'left', 'right', 'home'];
const REPEATS = new Set(['up', 'down', 'left', 'right', 'lb', 'rb']);
const REPEAT_DELAY = 380;
const REPEAT_RATE = 110;
const STICK_DEAD = 0.45; // left stick acts like a d-pad past this

export const GLYPHS = {
  xbox: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', view: '⧉', menu: '☰', rs: 'R3', ls: 'L3' },
  ps: { a: '✕', b: '○', x: '□', y: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', view: 'Share', menu: 'Options', rs: 'R3', ls: 'L3' },
  nintendo: { a: 'B', b: 'A', x: 'Y', y: 'X', lb: 'L', rb: 'R', lt: 'ZL', rt: 'ZR', view: '−', menu: '+', rs: 'RS', ls: 'LS' },
};

export function styleFor(id = '') {
  const s = id.toLowerCase();
  if (/054c|sony|playstation|dualshock|dualsense|wireless controller/.test(s)) return 'ps';
  if (/057e|nintendo|pro controller|joy-con/.test(s)) return 'nintendo';
  return 'xbox'; // Xbox, Steam Deck / Steam Virtual Gamepad, generic XInput
}

export class PadInput {
  /**
   * @param {object} h
   * @param {(name: string, e: { repeat: boolean }) => void} h.onPress
   * @param {(name: string) => void} [h.onRelease]
   * @param {(x: number, y: number) => void} [h.onLook]   right stick, -1..1
   * @param {(style: string|null) => void} [h.onActive]   controller in use (null = mouse/keyboard took over)
   */
  constructor(h) {
    this.h = h;
    this.prev = {};
    this.downAt = {};
    this.nextRepeat = {};
    this.active = false;
    this.style = 'xbox';
    this.pad = null;
    this.loop = this.loop.bind(this);
    setInterval(this.loop, 16);
    // Moving the mouse a real distance (not a stray nudge) hands control back to the mouse.
    let mx = null; let my = null; let travel = 0; let since = 0;
    addEventListener('mousemove', (e) => {
      if (mx !== null) {
        const now = performance.now();
        if (now - since > 3000) travel = 0;
        since = now;
        travel += Math.hypot(e.clientX - mx, e.clientY - my);
        if (this.active && travel > 40) { travel = 0; this.setActive(false); }
      }
      mx = e.clientX; my = e.clientY;
    });
    addEventListener('keydown', () => this.setActive(false));
  }

  setActive(on) {
    if (on === this.active) return;
    this.active = on;
    this.h.onActive?.(on ? this.style : null);
  }

  isDown(name) { return !!this.prev[name]; }
  heldFor(name) { return this.prev[name] ? performance.now() - this.downAt[name] : 0; }

  rumble(ms = 120, strong = 0.35, weak = 0.2) {
    try { this.pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }); } catch { /* not supported */ }
  }

  loop() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    // Use the most recently used connected pad.
    const pad = pads.sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!pad) return;
    this.pad = pad;
    const now = performance.now();
    const state = {};
    BUTTONS.forEach((name, i) => {
      const b = pad.buttons[i];
      state[name] = !!b && (b.pressed || b.value > 0.5);
    });
    const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
    // Left stick doubles as a d-pad.
    if (lx < -STICK_DEAD) state.left = true;
    if (lx > STICK_DEAD) state.right = true;
    if (ly < -STICK_DEAD) state.up = true;
    if (ly > STICK_DEAD) state.down = true;

    let any = false;
    for (const name of BUTTONS) {
      const down = state[name]; const was = this.prev[name];
      if (down && !was) {
        any = true;
        this.downAt[name] = now;
        this.nextRepeat[name] = now + REPEAT_DELAY;
        if (!this.active) { this.style = styleFor(pad.id); this.setActive(true); }
        this.h.onPress(name, { repeat: false });
      } else if (down && was && REPEATS.has(name) && now >= this.nextRepeat[name]) {
        this.nextRepeat[name] = now + REPEAT_RATE;
        this.h.onPress(name, { repeat: true });
      } else if (!down && was) {
        this.h.onRelease?.(name);
      }
      this.prev[name] = down;
    }
    const look = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    if (look(rx) || look(ry)) { any = true; if (!this.active) { this.style = styleFor(pad.id); this.setActive(true); } }
    this.h.onLook?.(look(rx), look(ry));
    if (any) this.lastInput = now;
  }
}
