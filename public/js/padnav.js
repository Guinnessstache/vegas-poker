// Controller navigation for menus and dialogs: a gold highlight that the d-pad moves to the
// nearest control in that direction, plus an on-screen keyboard for text fields.

const FOCUSABLE = 'button, select, input:not([type=hidden]), [data-pad]';

function visible(el) {
  if (el.disabled) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
  // Hidden ancestors (display:none makes the rect 0, but pointer-events/visibility may not).
  for (let p = el.parentElement; p; p = p.parentElement) {
    const ps = getComputedStyle(p);
    if (ps.visibility === 'hidden' || ps.display === 'none') return false;
  }
  return true;
}

export class PadNav {
  constructor() {
    this.current = null;
  }

  items(root) {
    return [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[data-pad-skip]') && visible(el));
  }

  // Put the highlight on `el` (or the root's default / first control).
  focus(el) {
    if (this.current && this.current !== el) this.current.classList.remove('pad-focus');
    this.current = el || null;
    if (!el) return;
    el.classList.add('pad-focus');
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  clear() { this.focus(null); if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); }

  ensure(root) {
    if (this.current && root.contains(this.current) && visible(this.current)) return this.current;
    const list = this.items(root);
    const pick = root.querySelector('[data-pad-default]');
    this.focus(pick && visible(pick) ? pick : list[0] || null);
    return this.current;
  }

  // Move in a direction; selects and sliders use left/right to change their value.
  move(root, dir) {
    const had = this.current && root.contains(this.current) && visible(this.current);
    const cur = this.ensure(root);
    if (!cur || !had) return; // the first press just shows where the highlight is
    if ((dir === 'left' || dir === 'right') && this.adjust(cur, dir === 'right' ? 1 : -1)) return;
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2; const ay = a.top + a.height / 2;
    let best = null; let bestScore = Infinity;
    for (const el of this.items(root)) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2; const by = b.top + b.height / 2;
      const dx = bx - ax; const dy = by - ay;
      // Gap between the two boxes across the direction of travel (0 when they line up).
      const gapX = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
      const gapY = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
      let main; let cross; let center;
      if (dir === 'right') { main = b.left - a.right; cross = gapY; center = dy; if (dx <= 4) continue; }
      if (dir === 'left') { main = a.left - b.right; cross = gapY; center = dy; if (dx >= -4) continue; }
      if (dir === 'down') { main = b.top - a.bottom; cross = gapX; center = dx; if (dy <= 4) continue; }
      if (dir === 'up') { main = a.top - b.bottom; cross = gapX; center = dx; if (dy >= -4) continue; }
      const score = Math.max(0, main) + cross * 3 + Math.abs(center) * 0.15 + (main < -4 ? 40 : 0);
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) this.focus(best);
  }

  adjust(el, step) {
    if (el.tagName === 'SELECT') {
      const i = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + step));
      if (i !== el.selectedIndex) { el.selectedIndex = i; el.dispatchEvent(new Event('change', { bubbles: true })); }
      return true;
    }
    if (el.tagName === 'INPUT' && el.type === 'range') {
      const range = Number(el.max) - Number(el.min);
      const s = Math.max(Number(el.step) || 1, range / 20);
      el.value = Math.max(Number(el.min), Math.min(Number(el.max), Number(el.value) + step * s));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    return false;
  }

  // "A" on the highlighted control.
  activate(onText) {
    const el = this.current;
    if (!el) return false;
    if (el.tagName === 'INPUT' && ['text', 'search', 'number', ''].includes(el.type)) { onText?.(el); return true; }
    if (el.tagName === 'SELECT') { this.adjust(el, 1); return true; }
    el.click();
    return true;
  }
}

// ---------------- on-screen keyboard ----------------
const ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', "'"],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '?'],
  ['⇧', 'space', '⌫', 'done'],
];

export class OnScreenKeyboard {
  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'osk';
    this.el.className = 'osk hidden';
    this.el.setAttribute('role', 'dialog');
    this.el.innerHTML = '<div class="osk-label"></div><div class="osk-preview"></div><div class="osk-keys"></div><div class="osk-help"></div>';
    document.body.append(this.el);
    this.keys = [];
    this.row = 1; this.col = 0;
    this.shift = false;
    this.render();
  }

  get open() { return !this.el.classList.contains('hidden'); }

  render() {
    const box = this.el.querySelector('.osk-keys');
    box.textContent = '';
    this.keys = ROWS.map((row, r) => row.map((k, c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `osk-key${k.length > 1 && k !== '⌫' ? ' wide' : ''}`;
      b.dataset.k = k;
      b.textContent = k === 'space' ? 'Space' : k === 'done' ? 'Done' : (this.shift ? k.toUpperCase() : k);
      b.addEventListener('click', () => { this.row = r; this.col = c; this.press(); });
      box.append(b);
      if (c === row.length - 1) box.append(document.createElement('br'));
      return b;
    }));
    this.highlight();
  }

  highlight() {
    this.keys.flat().forEach((b) => b.classList.remove('osk-focus'));
    this.keys[this.row]?.[this.col]?.classList.add('osk-focus');
  }

  show(input, { glyphs, label, onDone } = {}) {
    this.input = input;
    this.onDone = onDone;
    this.upper = input.classList.contains('code-input');
    this.shift = this.upper || !input.value; // capitalise a new name/sentence
    this.el.querySelector('.osk-label').textContent = label || input.placeholder || 'Type';
    const g = glyphs || { a: 'A', b: 'B', x: 'X', y: 'Y', menu: '☰' };
    this.el.querySelector('.osk-help').innerHTML = `<b>${g.a}</b> type · <b>${g.b}</b> delete · <b>${g.x}</b> space · <b>${g.y}</b> shift · <b>${g.menu}</b> done`;
    this.el.classList.remove('hidden');
    this.row = 1; this.col = 0;
    this.render();
    this.update();
  }

  hide() { this.el.classList.add('hidden'); this.input = null; }

  update() {
    const v = this.input?.value || '';
    this.el.querySelector('.osk-preview').textContent = v || ' ';
  }

  type(ch) {
    const inp = this.input;
    if (!inp) return;
    const max = Number(inp.maxLength) > 0 ? Number(inp.maxLength) : 240;
    if (inp.value.length >= max) return;
    inp.value += this.upper ? ch.toUpperCase() : ch;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    if (this.shift && !this.upper) { this.shift = false; this.render(); }
    this.update();
  }

  backspace() {
    if (!this.input) return;
    this.input.value = this.input.value.slice(0, -1);
    this.input.dispatchEvent(new Event('input', { bubbles: true }));
    this.update();
  }

  done() {
    const inp = this.input; const cb = this.onDone;
    this.hide();
    inp?.dispatchEvent(new Event('change', { bubbles: true }));
    cb?.(inp);
  }

  press() {
    const k = ROWS[this.row][this.col];
    if (k === '⇧') { this.shift = !this.shift; this.render(); return; }
    if (k === 'space') return this.type(' ');
    if (k === '⌫') return this.backspace();
    if (k === 'done') return this.done();
    this.type(this.shift ? k.toUpperCase() : k);
  }

  // Controller buttons while the keyboard is open.
  handle(name) {
    const rows = ROWS.length;
    if (name === 'up' || name === 'down') {
      const frac = this.col / Math.max(1, ROWS[this.row].length - 1);
      this.row = (this.row + (name === 'down' ? 1 : rows - 1)) % rows;
      this.col = Math.round(frac * (ROWS[this.row].length - 1));
    } else if (name === 'left' || name === 'right') {
      const n = ROWS[this.row].length;
      this.col = (this.col + (name === 'right' ? 1 : n - 1)) % n;
    } else if (name === 'a') this.press();
    else if (name === 'b') this.backspace();
    else if (name === 'x') this.type(' ');
    else if (name === 'y') { this.shift = !this.shift; this.render(); }
    else if (name === 'menu' || name === 'view') this.done();
    this.highlight();
  }
}
