// App entry: lobby, socket wiring, HUD, and glue between the 3D view, media, and sound.
import { io } from '/socket.io/socket.io.esm.min.js';
import { World } from './scene/world.js';
import { GameView } from './game.js';
import { MediaManager } from './media.js';
import { Sound } from './sound.js';
import { evaluate } from '/shared/handEval.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n || 0).toLocaleString();
const safe = (store) => ({
  get: (k) => { try { return store.getItem(k); } catch { return null; } },
  set: (k, v) => { try { store.setItem(k, v); } catch { /* ignore */ } },
  del: (k) => { try { store.removeItem(k); } catch { /* ignore */ } },
});
const local = safe(window.localStorage);
const session = safe(window.sessionStorage);

// Per-tab identity so refreshing reconnects you to your seat (and two tabs = two players for testing).
let clientKey = session.get('hr_key');
if (!clientKey) {
  clientKey = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)) + Math.random().toString(36).slice(2, 10);
  session.set('hr_key', clientKey);
}

const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const quality = local.get('hr_quality') || (isMobile ? 'medium' : 'high');

// ---------------- boot ----------------
const world = new World($('scene'), quality);
const sfx = new Sound();
sfx.sfxOn = local.get('hr_sfx') !== '0';
const app = { code: null, pid: null, room: null, state: null, lastTurnKey: '', lastStreetKey: '' };

const view = new GameView(world, {
  sfx,
  onSeatClick: (seat) => emit('sit', { seat }),
});
view.onBanner = showBanner;
world.onResize = () => view.applyCamera(); // re-aim when rotating the phone

const socket = io({ transports: ['websocket', 'polling'] });
const media = new MediaManager(socket, {
  onRemoteVideo: (pid, video) => { view.setVideoForPid(pid, video); renderTiles(); },
  onRemoteGone: (pid) => { view.setVideoForPid(pid, null); renderTiles(); },
  onLevel: (pid, level) => {
    view.setSpeaking(pid, level);
    if (pid === app.pid) $('self-level').style.width = `${Math.round(level * 100)}%`;
  },
  onLocalStream: (stream) => {
    $('self-video').srcObject = stream;
    $('self-wrap').classList.toggle('hidden', !stream || !stream.getVideoTracks().length);
  },
});

setTimeout(() => { $('loading').classList.add('fade'); showLobby(); }, 350);

function emit(ev, data = {}) {
  return new Promise((resolve) => socket.emit(ev, data, (res) => {
    if (res && !res.ok && res.error) toast(res.error);
    resolve(res || { ok: false });
  }));
}

// ---------------- lobby ----------------
function showLobby() {
  $('lobby').classList.remove('hidden');
  $('hud').classList.add('hidden');
  world.setCameraGoal(world.camera.position, world.camLook, 'lobby');
  $('name-input').value = local.get('hr_name') || '';
  const params = new URLSearchParams(location.search);
  const code = (params.get('room') || '').toUpperCase();
  if (code) {
    $('code-input').value = code;
    // Auto-rejoin after a page refresh.
    if (session.get('hr_room') === code && local.get('hr_name')) { joinTable(code); return; }
    ($('name-input').value ? $('join-btn') : $('name-input')).focus();
  } else $('name-input').focus();
}

function getName() {
  const n = $('name-input').value.trim();
  if (!n) { $('lobby-error').textContent = 'Enter a name first.'; $('name-input').focus(); return null; }
  local.set('hr_name', n);
  return n;
}

$('create-btn').addEventListener('click', async () => {
  const name = getName();
  if (!name) return;
  unlockAudio();
  const res = await emit('create', {
    name, key: clientKey,
    settings: {
      startingStack: Number($('set-stack').value),
      bigBlind: Number($('set-blinds').value),
      actionTime: Number($('set-timer').value),
      allowRebuy: $('set-rebuy').value === '1',
    },
  });
  if (res.ok) enterGame(res);
  else $('lobby-error').textContent = res.error || 'Could not create table';
});

$('join-btn').addEventListener('click', () => joinTable($('code-input').value));
$('code-input').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinTable(e.target.value); });
$('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') ($('code-input').value ? joinTable($('code-input').value) : $('create-btn').click()); });

async function joinTable(code) {
  const name = getName();
  if (!name) return;
  code = String(code || '').toUpperCase().trim();
  if (code.length !== 5) { $('lobby-error').textContent = 'Table codes are 5 characters.'; return; }
  unlockAudio();
  const res = await emit('join', { code, name, key: clientKey });
  if (res.ok) enterGame(res);
  else { $('lobby-error').textContent = res.error || 'Could not join'; session.del('hr_room'); }
}

function enterGame(res) {
  app.code = res.code;
  app.pid = res.pid;
  media.setMyPid(res.pid);
  session.set('hr_room', res.code);
  history.replaceState(null, '', `?room=${res.code}`);
  $('lobby').classList.add('hidden');
  $('lobby-error').textContent = '';
  $('hud').classList.remove('hidden');
  $('room-code').textContent = res.code;
  if (local.get('hr_amb') !== '0') sfx.setAmbience(true);
  view.applyCamera();
}

function unlockAudio() { sfx.ensure(); media.unlockPlayback(); }
document.addEventListener('pointerdown', () => media.unlockPlayback(), { passive: true });

// ---------------- socket ----------------
socket.on('connect', () => {
  if (app.code) socket.emit('join', { code: app.code, key: clientKey, name: local.get('hr_name') }, (res) => {
    if (!res?.ok) { toast('That table has closed.'); leaveToLobby(); }
  });
});
socket.on('disconnect', () => toast('Connection lost — reconnecting…'));

socket.on('room', (room) => {
  app.room = room;
  view.setRoom(room, app.pid);
  media.syncMembers(room.members);
  view.rebindVideos(media.videoMap());
  updateHUD();
  renderTiles();
});

socket.on('state', (s) => {
  // Convert server deadline to local clock.
  s.deadline = s.deadline ? s.deadline - s.serverNow + Date.now() : 0;
  const t = s.table;
  const turnKey = `${t.handNumber}:${t.street}:${t.toAct}:${s.deadline ? Math.round(s.deadline / 1000) : 0}`;
  s.turnStart = app.state && app.lastTurnKey === turnKey ? app.state.turnStart : Date.now();
  app.lastTurnKey = turnKey;
  const wasMyTurn = !!app.state?.you.legal;
  app.state = s;
  view.applyState(s);
  view.rebindVideos(media.videoMap());
  const streetKey = `${t.handNumber}:${t.street}`;
  if (streetKey !== app.lastStreetKey) {
    app.lastStreetKey = streetKey;
    if (t.street === 'preflop' || t.street === 'idle') { $('pre-checkfold').checked = false; $('pre-callany').checked = false; }
  }
  if (!wasMyTurn && s.you.legal) {
    sfx.play('turn');
    if (tryPreAction(s.you.legal)) return;
  }
  updateHUD();
});

socket.on('events', (events) => {
  view.handleEvents(events);
  for (const e of events) {
    if (e.type === 'win') {
      const name = app.state?.table.seats[e.seat]?.name || 'Player';
      addChat({ system: true, text: `${name} won ${fmt(e.amount)}${e.hand ? ` with ${e.hand}` : ''}.` });
    }
  }
});

socket.on('chat', (m) => { addChat(m); if (!m.system && m.pid !== app.pid) sfx.play('chat'); });
socket.on('chatHistory', (list) => { $('chat-log').innerHTML = ''; list.forEach(addChat); });
socket.on('toast', toast);
socket.on('reaction', ({ pid, emoji }) => {
  const seat = app.state?.table.seats.findIndex((s) => s && s.id === pid);
  if (seat >= 0) view.showReaction(seat, emoji);
  if (pid === app.pid && seat === app.state?.you.seat) toast(`You reacted ${emoji}`);
});

// ---------------- HUD ----------------
function updateHUD() {
  const s = app.state, room = app.room;
  if (!s || !room) return;
  const t = s.table, you = s.you;
  const me = you.seat >= 0 ? t.seats[you.seat] : null;

  // Host controls
  $('host-controls').classList.toggle('hidden', !you.isHost);
  $('start-btn').classList.toggle('hidden', room.running);
  $('pause-btn').classList.toggle('hidden', !room.running);

  // Status line
  const seated = t.seats.filter(Boolean).length;
  let status = '';
  if (you.seat < 0) status = '👀 Spectating — click “Sit here” on an empty seat to play';
  else if (!room.running) status = you.isHost ? (seated < 2 ? 'Share the code — waiting for at least one friend' : 'Ready when you are — hit “Deal cards”') : 'Waiting for the host to deal';
  else if (t.street === 'idle') status = seated < 2 ? 'Waiting for more players…' : 'Shuffling up…';
  else status = `Hand #${t.handNumber} · Blinds ${fmt(t.sb)}/${fmt(t.bb)} · ${t.street === 'preflop' ? 'Pre-flop' : t.street[0].toUpperCase() + t.street.slice(1)}`;
  $('status-line').textContent = status;

  // My info
  $('my-info').classList.toggle('hidden', you.seat < 0);
  if (me) {
    $('my-stack').textContent = fmt(me.stack);
    $('sitout-btn').textContent = you.sittingOut ? "I'm back" : 'Sit out';
    const liveHand = me.inHand && t.street !== 'idle' && !t.handOver;
    $('rebuy-btn').classList.toggle('hidden', !(room.settings.allowRebuy && me.stack < room.settings.startingStack && !liveHand));
    $('rebuy-btn').textContent = me.stack === 0 ? `Rebuy ${fmt(room.settings.startingStack)}` : 'Top up';
    let hint = '';
    if (you.hole.length === 2) {
      try { hint = evaluate([...you.hole, ...t.board]).name; } catch { hint = ''; }
    }
    $('my-hand').textContent = hint;
    renderMyCards(app.hudCards && me.inHand && !me.folded ? you.hole : [], t.handNumber);
  }

  // Action bar
  const bar = $('action-bar');
  const legal = you.legal;
  bar.classList.toggle('hidden', !me);
  bar.classList.toggle('disabled', !legal);
  bar.classList.toggle('my-turn', !!legal);
  const canPre = me && me.inHand && !me.folded && !me.allIn && t.street !== 'idle' && !t.handOver;
  $('action-bar').querySelector('.pre-row').style.visibility = canPre ? 'visible' : 'hidden';
  if (legal) {
    $('call-btn').innerHTML = legal.canCheck ? 'Check <kbd>C</kbd>' : `Call ${fmt(legal.toCall)}${legal.toCall >= me.stack ? ' (All-in)' : ''} <kbd>C</kbd>`;
    const slider = $('raise-slider');
    slider.min = legal.minRaiseTo;
    slider.max = legal.maxRaiseTo;
    slider.step = 1;
    if (!app.raiseTouched || Number($('raise-input').value) < legal.minRaiseTo || Number($('raise-input').value) > legal.maxRaiseTo) {
      setRaise(legal.minRaiseTo);
      app.raiseTouched = false;
    }
    $('raise-btn').disabled = !legal.canRaise;
    $('raise-slider').disabled = $('raise-input').disabled = !legal.canRaise;
    updateRaiseLabel();
  } else app.raiseTouched = false;
}

function setRaise(v) {
  const legal = app.state?.you.legal;
  if (!legal) return;
  v = Math.round(Number(v) || 0);
  const sb = Math.max(1, app.state.table.sb);
  if (v < legal.maxRaiseTo) v = Math.round(v / sb) * sb; // snap to small-blind increments
  v = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, v));
  $('raise-slider').value = v;
  $('raise-input').value = v;
  updateRaiseLabel();
}

function updateRaiseLabel() {
  const legal = app.state?.you.legal;
  if (!legal) return;
  const v = Number($('raise-input').value);
  const allIn = v >= legal.maxRaiseTo;
  $('raise-btn').innerHTML = !legal.canRaise ? 'Raise' : allIn ? `All-in ${fmt(v)} <kbd>R</kbd>` : `${legal.isBet ? 'Bet' : 'Raise to'} ${fmt(v)} <kbd>R</kbd>`;
}

$('raise-slider').addEventListener('input', (e) => { app.raiseTouched = true; setRaise(e.target.value); });
$('raise-input').addEventListener('change', (e) => { app.raiseTouched = true; setRaise(e.target.value); });
document.querySelectorAll('.presets button').forEach((b) => b.addEventListener('click', () => {
  const s = app.state; const legal = s?.you.legal;
  if (!legal) return;
  app.raiseTouched = true;
  const t = s.table;
  const me = t.seats[s.you.seat];
  const potNow = t.pot + t.seats.reduce((a, p) => a + (p ? p.bet : 0), 0);
  const potAfterCall = potNow + legal.toCall;
  const base = me.bet + legal.toCall;
  const p = b.dataset.preset;
  const v = p === 'min' ? legal.minRaiseTo : p === 'allin' ? legal.maxRaiseTo
    : base + potAfterCall * (p === 'half' ? 0.5 : p === 'threeq' ? 0.75 : 1);
  setRaise(p === 'allin' ? legal.maxRaiseTo : v);
  if (p === 'allin') { $('raise-slider').value = legal.maxRaiseTo; $('raise-input').value = legal.maxRaiseTo; updateRaiseLabel(); }
}));

function act(action, amount) {
  if (!app.state?.you.legal) return;
  emit('act', { action, amount });
  $('action-bar').classList.add('disabled');
  $('action-bar').classList.remove('my-turn');
}
$('fold-btn').addEventListener('click', () => {
  const legal = app.state?.you.legal;
  if (legal?.canCheck && !confirmFold()) return;
  act('fold');
});
function confirmFold() {
  // Folding when you could check for free is almost always a misclick.
  toast('You can check for free — press Fold again to fold anyway.');
  if (app.foldArmed && Date.now() - app.foldArmed < 3000) { app.foldArmed = 0; return true; }
  app.foldArmed = Date.now();
  return false;
}
$('call-btn').addEventListener('click', () => { const l = app.state?.you.legal; if (l) act(l.canCheck ? 'check' : 'call'); });
$('raise-btn').addEventListener('click', () => {
  const l = app.state?.you.legal;
  if (!l?.canRaise) return;
  const v = Number($('raise-input').value);
  act(v >= l.maxRaiseTo ? 'allin' : 'raise', v);
});

function tryPreAction(legal) {
  if ($('pre-checkfold').checked) {
    $('pre-checkfold').checked = false;
    act(legal.canCheck ? 'check' : 'fold');
    return true;
  }
  if ($('pre-callany').checked) {
    act(legal.canCheck ? 'check' : 'call');
    return true;
  }
  return false;
}
$('pre-checkfold').addEventListener('change', (e) => { if (e.target.checked) $('pre-callany').checked = false; });
$('pre-callany').addEventListener('change', (e) => { if (e.target.checked) $('pre-checkfold').checked = false; });

$('sitout-btn').addEventListener('click', () => emit('sitout', { value: !app.state?.you.sittingOut }));
$('rebuy-btn').addEventListener('click', () => emit('rebuy'));
$('start-btn').addEventListener('click', () => emit('start'));
$('pause-btn').addEventListener('click', () => emit('pause'));
$('stand-btn').addEventListener('click', () => { emit('stand'); $('menu').classList.add('hidden'); });
$('leave-btn').addEventListener('click', async () => {
  await emit('leave');
  leaveToLobby();
});

function leaveToLobby() {
  app.code = null; app.state = null; app.room = null;
  session.del('hr_room');
  media.closeAll();
  resetMediaUI();
  sfx.setAmbience(false);
  history.replaceState(null, '', location.pathname);
  location.reload(); // cleanest way to reset the 3D table
}

$('blinds-btn').addEventListener('click', () => {
  const d = $('blinds-dialog');
  $('blinds-select').value = String(app.room?.settings.bigBlind || 100);
  d.showModal();
  d.onclose = () => { if (d.returnValue === 'ok') emit('settings', { bigBlind: Number($('blinds-select').value) }); };
});

$('copy-link').addEventListener('click', async () => {
  const url = `${location.origin}/?room=${app.code}`;
  try {
    if (navigator.share && isMobile) await navigator.share({ title: "High Roller Hold'em", text: `Join my poker table! Code ${app.code}`, url });
    else { await navigator.clipboard.writeText(url); toast('Invite link copied — send it to your friends!'); }
  } catch { toast(`Share this link: ${url}`); }
});

// Camera view
const CAMS = ['seat', 'overhead', 'orbit'];
function setCam(v) {
  view.setCameraView(v);
  document.querySelectorAll('#cam-seg button').forEach((b) => b.classList.toggle('active', b.dataset.cam === v));
  if (v === 'orbit') toast('Free camera: drag to orbit, scroll to zoom');
}
document.querySelectorAll('#cam-seg button').forEach((b) => b.addEventListener('click', () => setCam(b.dataset.cam)));
$('cam-cycle').addEventListener('click', () => {
  const next = CAMS[(CAMS.indexOf(view.camView) + 1) % CAMS.length];
  setCam(next);
  toast({ seat: 'Seated view', overhead: 'Overhead view', orbit: 'Free camera: drag to orbit, pinch to zoom' }[next]);
});

// Menu
$('menu-btn').addEventListener('click', () => $('menu').classList.toggle('hidden'));
$('quality-select').value = quality;
$('quality-select').addEventListener('change', (e) => { local.set('hr_quality', e.target.value); world.setQuality(e.target.value); });
$('sfx-toggle').checked = sfx.sfxOn;
$('sfx-toggle').addEventListener('change', (e) => { sfx.sfxOn = e.target.checked; local.set('hr_sfx', e.target.checked ? '1' : '0'); });
$('amb-toggle').checked = local.get('hr_amb') !== '0';
$('amb-toggle').addEventListener('change', (e) => { sfx.setAmbience(e.target.checked); local.set('hr_amb', e.target.checked ? '1' : '0'); });
// Readability helpers (default on for phones): flat 2D hole cards + floating community cards.
const pref = (k, dflt) => { const v = local.get(k); return v === null ? dflt : v === '1'; };
app.hudCards = pref('hr_hudcards', isMobile);
app.boardHud = pref('hr_boardhud', isMobile);
view.floatBoard = pref('hr_float', false);
$('boardhud-toggle').checked = app.boardHud;
$('boardhud-toggle').addEventListener('change', (e) => { app.boardHud = e.target.checked; local.set('hr_boardhud', e.target.checked ? '1' : '0'); renderBoardStrip(app.lastBoard || [], app.lastTable); });
view.onBoard = (cards, table) => { app.lastBoard = cards; app.lastTable = table; renderBoardStrip(cards, table); };
$('hudcards-toggle').checked = app.hudCards;
$('float-toggle').checked = view.floatBoard;
$('hudcards-toggle').addEventListener('change', (e) => { app.hudCards = e.target.checked; local.set('hr_hudcards', e.target.checked ? '1' : '0'); app.cardsKey = ''; updateHUD(); });
$('float-toggle').addEventListener('change', (e) => { view.floatBoard = e.target.checked; local.set('hr_float', e.target.checked ? '1' : '0'); });
$('tiles-toggle').addEventListener('change', (e) => { $('tiles').classList.toggle('hidden', !e.target.checked); renderTiles(); });
$('fullscreen-btn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.();
});
let lastFrames = 0;
setInterval(() => {
  const f = (world.totalFrames || 0) - lastFrames;
  lastFrames = world.totalFrames || 0;
  $('fps').textContent = `${f} fps · ${Math.round(world.renderer.getPixelRatio() * 100)}% res · GPU: ${world.gpuName}`;
}, 1000);
if (world.softwareGL) {
  setTimeout(() => toast('Your browser is drawing 3D without the graphics card. Turn on hardware acceleration in your browser settings for smooth play (⚙ menu shows the GPU in use).', 12000), 1500);
}

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'f') $('fold-btn').click();
  else if (k === 'c') $('call-btn').click();
  else if (k === 'r') $('raise-btn').click();
  else if (k === 'b') { $('boardhud-toggle').click(); toast(`Board cards on screen: ${app.boardHud ? 'on' : 'off'} (B)`); }
  else if (k === 'v') setCam(CAMS[(CAMS.indexOf(view.camView) + 1) % CAMS.length]);
  else if (k === 'enter' && app.code) { $('chat-input').focus(); e.preventDefault(); }
});

// Chat + reactions
$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('chat-input').value.trim();
  if (text) emit('chat', { text });
  $('chat-input').value = '';
  $('chat-input').blur();
});
document.querySelectorAll('.reactions button').forEach((b) => b.addEventListener('click', () => socket.emit('reaction', { emoji: b.dataset.emoji })));

function addChat(m) {
  const log = $('chat-log');
  const div = document.createElement('div');
  if (m.system) { div.className = 'sys'; div.textContent = m.text; }
  else {
    const who = document.createElement('span');
    who.className = 'who';
    const member = app.room?.members.find((x) => x.pid === m.pid);
    who.style.color = ['#ff8a80', '#82b1ff', '#8be0a8', '#d1a3ff', '#ffcf7a', '#7fe3ee', '#ff9ccf', '#cfcfcf'][member ? member.color % 8 : 0];
    who.textContent = m.name;
    div.append(who, document.createTextNode(m.text));
  }
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
  log.appendChild(div);
  while (log.children.length > 150) log.firstChild.remove();
  if (atBottom) log.scrollTop = log.scrollHeight;
}

// ---------------- media UI ----------------
$('media-start').addEventListener('click', async () => {
  try {
    unlockAudio();
    const got = await media.start({ video: true, audio: true });
    $('media-start').classList.add('hidden');
    $('media-controls').classList.remove('hidden');
    $('mic-btn').disabled = !got.mic;
    $('cam-btn').disabled = !got.cam;
    updateMediaButtons();
    if (!got.cam) toast('No camera found — joined with microphone only.');
    else if (!got.mic) toast('No microphone found — joined with camera only.');
  } catch (err) {
    const msg = err?.name === 'NotAllowedError' ? 'Camera/mic permission was blocked. Allow it in the browser address bar and try again.' : err?.message || String(err);
    toast(msg, 6000);
  }
});
$('mic-btn').addEventListener('click', () => { media.toggleMic(); updateMediaButtons(); });
$('cam-btn').addEventListener('click', () => { media.toggleCam(); updateMediaButtons(); $('self-wrap').classList.toggle('hidden', !media.camOn); });
$('media-stop').addEventListener('click', () => { media.stop(); resetMediaUI(); });

function updateMediaButtons() {
  $('mic-btn').innerHTML = media.micOn ? '🎙<span class="lbl-long"> Mute</span>' : '🔇<span class="lbl-long"> Unmute</span>';
  $('cam-btn').innerHTML = media.camOn ? '📷<span class="lbl-long"> Camera off</span>' : '🚫<span class="lbl-long"> Camera on</span>';
}
function resetMediaUI() {
  $('media-start').classList.remove('hidden');
  $('media-controls').classList.add('hidden');
  $('self-wrap').classList.add('hidden');
}

function renderTiles() {
  const box = $('tiles');
  if (box.classList.contains('hidden') || !app.room) { box.innerHTML = ''; return; }
  const vids = media.videoMap();
  const want = app.room.members.filter((m) => m.pid !== app.pid && m.media?.cam && vids.has(m.pid));
  const have = new Map([...box.children].map((el) => [el.dataset.pid, el]));
  for (const [pid, el] of have) if (!want.find((m) => m.pid === pid)) el.remove();
  for (const m of want) {
    let el = have.get(m.pid);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tile'; el.dataset.pid = m.pid;
      const v = document.createElement('video');
      v.muted = true; v.autoplay = true; v.playsInline = true;
      const s = document.createElement('span');
      el.append(v, s);
      box.appendChild(el);
    }
    const v = el.querySelector('video');
    const src = vids.get(m.pid).srcObject;
    if (v.srcObject !== src) { v.srcObject = src; v.play().catch(() => {}); }
    el.querySelector('span').textContent = m.name;
  }
}

// Crisp 2D copy of your hole cards (DOM, so it's sharp at any screen density).
const SUIT_SYM = { s: '\u2660\uFE0E', h: '\u2665\uFE0E', d: '\u2666\uFE0E', c: '\u2663\uFE0E' };
function renderMyCards(hole, handNumber) {
  const box = $('my-cards');
  const key = hole.join(',') + '|' + handNumber;
  if (key === app.cardsKey) return;
  app.cardsKey = key;
  if (hole.length !== 2) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.innerHTML = hole.map((c) => {
    const rank = c[0] === 'T' ? '10' : c[0];
    const red = c[1] === 'h' || c[1] === 'd';
    return `<span class="mini-card${red ? ' red' : ''}"><b>${rank}</b><i>${SUIT_SYM[c[1]]}</i></span>`;
  }).join('');
  box.classList.remove('hidden');
  box.classList.remove('deal'); void box.offsetWidth; box.classList.add('deal');
}

function miniCard(c, extra = '') {
  const rank = c[0] === 'T' ? '10' : c[0];
  const red = c[1] === 'h' || c[1] === 'd';
  return `<span class="mini-card${red ? ' red' : ''}${extra}"><b>${rank}</b><i>${SUIT_SYM[c[1]]}</i></span>`;
}

// Flat, crisp copy of the community cards (follows the 3D deal animation).
function renderBoardStrip(cards, table) {
  const box = $('board-strip');
  const live = table && table.street !== 'idle';
  if (!app.boardHud || !live || !app.state || app.state.you.seat < 0) { box.classList.add('hidden'); box.innerHTML = ''; app.boardKey = ''; return; }
  const key = cards.map((c) => c.card + (c.hl ? '*' : '')).join(',');
  if (key === app.boardKey && box.children.length) return;
  const prev = app.boardKey ? app.boardKey.split(',').length : 0;
  app.boardKey = key;
  const anyHl = cards.some((c) => c.hl);
  let html = cards.map((c, i) => miniCard(c.card, `${c.hl ? ' hl' : anyHl ? ' dim' : ''}${i >= prev && key ? ' fresh' : ''}`)).join('');
  for (let i = cards.length; i < 5; i++) html += '<span class="mini-card empty"></span>';
  box.innerHTML = html;
  box.classList.remove('hidden');
}

// ---------------- banner / toast ----------------
let bannerTimer;
function showBanner(title, sub, isMe) {
  const b = $('banner');
  b.querySelector('.b-title').textContent = title;
  b.querySelector('.b-sub').textContent = sub || '';
  b.classList.toggle('me', !!isMe);
  b.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('show'), 3600);
}

let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// Expose for debugging in the console.
window.__poker = { app, world, view, media, socket };
