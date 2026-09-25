// Electron entry point for the desktop / Steam build.
// - Runs the game server in-process on a private localhost port. Every table is hosted by the
//   player who created it, inside their own copy of the game. There is no central server.
// - Friends reach the host through Steam: a Steam lobby carries the table code and host's
//   Steam ID, and game traffic is tunneled over Steam peer-to-peer (relayed by Valve when needed).
import { app, BrowserWindow, ipcMain, session, shell, Menu } from 'electron';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { Steam, enableOverlay, restartThroughSteamIfNeeded } from './steam.mjs';
import { Tunnel } from './tunnel.mjs';
import { startTurnServer } from '../server/turn.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const APP_ID = Number(process.env.STEAM_APP_ID || config.steamAppId || 480);

// Steam sets SteamGameId for anything it launches (real games and "non-Steam game" shortcuts).
// The overlay (and so the invite dialog) is only injected into processes Steam launched.
const LAUNCHED_BY_STEAM = !!(process.env.SteamGameId || process.env.SteamOverlayGameId);

// Development only: a separate profile per copy, so two copies can run side by side.
if (process.env.HR_USER_DATA) app.setPath('userData', process.env.HR_USER_DATA);

if (restartThroughSteamIfNeeded(APP_ID)) app.exit(0);
enableOverlay();
if (process.env.HR_NO_SANDBOX) app.commandLine.appendSwitch('no-sandbox');
// Development only: fake camera/mic for automated tests.
if (process.env.HR_FAKE_MEDIA) { app.commandLine.appendSwitch('use-fake-device-for-media-stream'); app.commandLine.appendSwitch('use-fake-ui-for-media-stream'); }

// One running copy; a second launch (e.g. accepting an invite) is forwarded here.
if (!app.requestSingleInstanceLock()) app.exit(0);

// Everything the main process logs also goes to <userData>/highroller.log (Settings → Open log file).
let LOG_FILE = null;
function setupLogFile() {
  try {
    const dir = app.getPath('userData');
    mkdirSync(dir, { recursive: true });
    LOG_FILE = path.join(dir, 'highroller.log');
    writeFileSync(LOG_FILE, `High Roller Hold'em ${app.getVersion()} — ${process.platform} — ${new Date().toISOString()}\n`);
    const fmt = (x) => (typeof x === 'string' ? x : x instanceof Error ? (x.stack || x.message)
      : JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? String(v) : v)));
    for (const level of ['log', 'warn', 'error']) {
      const orig = console[level].bind(console);
      console[level] = (...args) => {
        orig(...args);
        try { appendFileSync(LOG_FILE, `${new Date().toISOString().slice(11, 23)} ${level === 'log' ? '' : `${level.toUpperCase()} `}${args.map(fmt).join(' ')}\n`); } catch { /* ignore */ }
      };
    }
  } catch { /* logging is best-effort */ }
}

let win = null;
let steam = null;
let localServer = null;
let tunnel = null;
let relay = null; // webcam relay (TURN) for players who can't connect directly
const bannedPeers = new Set(); // Steam IDs the host kicked from their table
let pendingJoin = null; // { code, server, via } waiting for the renderer

function lobbyFromArgs(argv) {
  const i = argv.indexOf('+connect_lobby');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

// Join the Steam lobby for a table and open a tunnel to whoever hosts it.
async function connectLobby(lobbyId) {
  if (!steam?.ok) return { error: 'Steam is not running.' };
  const t = await steam.joinLobby(lobbyId);
  if (!t?.code) return { error: 'That table has closed.' };
  if (t.host === steam.mySteamId) return { self: true, code: t.code };
  if (!t.hostHere) { steam.leave(); return { error: 'That table has closed (the host left).' }; }
  const port = await tunnel.connectTo(t.host);
  console.log('[tunnel] joining table', t.code, 'hosted by', t.host);
  return { code: t.code, server: `http://127.0.0.1:${port}`, via: 'steam' };
}

async function joinSteamLobby(lobbyId) {
  try {
    const target = await connectLobby(lobbyId);
    if (target.error || target.self) { if (target.error) win?.webContents.send('hr:notice', target.error); return; }
    if (win && !win.webContents.isLoading()) win.webContents.send('hr:join-table', target);
    else pendingJoin = target;
  } catch (e) {
    console.warn('[steam] join lobby failed', e);
    win?.webContents.send('hr:notice', 'Could not join that table through Steam.');
  }
}

async function createWindow() {
  const { startServer } = await import('../server/index.js');
  try { relay = await startTurnServer({ log: (...a) => console.log(...a) }); } catch (e) { console.warn('[turn] relay failed to start', e); }
  localServer = await startServer({ port: 0, host: '127.0.0.1', quiet: true,
    relay: relay && { port: relay.port, username: relay.username, credential: relay.credential } });
  const localUrl = `http://127.0.0.1:${localServer.port}`;

  // Carries friends' game traffic to our server (when hosting) or ours to theirs (when joining).
  tunnel = new Tunnel({
    send: (peer, buf) => steam.sendPacket(peer, buf),
    localPort: localServer.port,
    services: relay ? { 1: relay.port } : {},
    authorize: (peer) => steam.isHosting() && steam.isLobbyMember(peer) && !bannedPeers.has(peer),
    onRefused: (peer) => {
      console.warn('[tunnel] host refused us', peer);
      steam.leave();
      win?.webContents.send('hr:refused');
    },
    onHostLost: (peer) => {
      console.warn('[tunnel] lost the host', peer, 'status', steam.peerStatus?.(peer));
      steam.leave();
      win?.webContents.send('hr:host-lost');
    },
    log: (...a) => console.log(...a),
  });
  steam.startNetworking({
    onPacket: (peer, data) => tunnel.handlePacket(peer, data),
    onPeerFailed: (peer) => { console.warn('[steam] P2P session failed with', peer); tunnel.dropPeer(peer); },
  });
  // Connection health for the log: state (connecting / finding route / connected) and ping.
  setInterval(() => {
    const host = tunnel.clientPeer;
    if (host) console.log('[net] host', host, steam.peerStatus?.(host));
    for (const guest of tunnel.seen.keys()) console.log('[net] guest', guest, steam.peerStatus?.(guest));
  }, 5000).unref();

  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b0604',
    title: "High Roller Hold'em",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [`--hr-local=${localUrl}`],
    },
  });
  win.once('ready-to-show', () => { win.show(); });

  // Camera + mic for the table video; everything else stays denied.
  const allowed = new Set(['media', 'speaker-selection', 'fullscreen', 'clipboard-sanitized-write', 'clipboard-read']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  // Links (GitHub, docs) open in the user's browser, not inside the game.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(localUrl)) { e.preventDefault(); shell.openExternal(url); }
  });

  // F11 fullscreen, Ctrl+Shift+I devtools (handy while developing).
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'I' && input.control && input.shift) win.webContents.toggleDevTools();
  });

  win.webContents.on('did-finish-load', () => {
    if (pendingJoin) { win.webContents.send('hr:join-table', pendingJoin); pendingJoin = null; }
  });

  await win.loadURL(localUrl);
}

// ---------- IPC for the renderer (see preload.cjs) ----------
ipcMain.handle('hr:steam-info', () => ({ ...(steam?.info() ?? { ok: false }), overlay: LAUNCHED_BY_STEAM }));
ipcMain.handle('hr:host-table', async (_e, { code, listed }) => {
  try {
    if (tunnel?.clientPeer) return { ok: false, error: 'not the host' };
    const id = await steam?.hostTable({ code, listed: !!listed });
    console.log('[steam] lobby for table', code, '=>', id);
    return { ok: !!id, lobbyId: id };
  } catch (e) {
    console.warn('[steam] createLobby failed', e);
    return { ok: false, error: String(e?.message || e) };
  }
});
ipcMain.handle('hr:update-table', (_e, info) => steam?.updateTable?.(info) ?? false);
ipcMain.handle('hr:list-tables', async () => {
  try { return { ok: true, tables: (await steam?.listTables?.()) || [] }; } catch (e) { console.warn('[steam] list tables failed', e); return { ok: false, tables: [] }; }
});
ipcMain.handle('hr:join-lobby', async (_e, lobbyId) => {
  try { return await connectLobby(String(lobbyId)); } catch (e) { console.warn('[steam] join lobby failed', e); return { error: 'Could not join that table.' }; }
});
ipcMain.handle('hr:ban-peer', (_e, steamId) => {
  if (!steamId) return false;
  bannedPeers.add(String(steamId));
  tunnel?.dropPeer(String(steamId));
  console.log('[tunnel] banned', steamId);
  return true;
});
ipcMain.handle('hr:find-table', async (_e, code) => {
  try {
    const lobbyId = await steam?.findTable(String(code || '').toUpperCase());
    if (!lobbyId) return { error: 'No table with that code. Check the code, and make sure the host still has the game open.' };
    return await connectLobby(lobbyId);
  } catch (e) {
    console.warn('[steam] find table failed', e);
    return { error: 'Could not search Steam for that table. Is Steam online?' };
  }
});
ipcMain.handle('hr:invite', () => {
  const opened = steam?.invite() ?? false;
  return { opened, overlay: LAUNCHED_BY_STEAM };
});
ipcMain.handle('hr:friends', () => {
  try { return steam?.listFriends() ?? null; } catch (e) { console.warn('[steam] friends', e); return null; }
});
ipcMain.handle('hr:invite-friend', (_e, id) => {
  try { return steam?.inviteFriend(String(id)) ?? false; } catch (e) { console.warn('[steam] invite friend', e); return false; }
});
ipcMain.handle('hr:leave-table', () => { tunnel?.closeClient(); steam?.leave(); return true; });
ipcMain.handle('hr:achievement', (_e, name) => steam?.unlock(String(name)) ?? false);
ipcMain.handle('hr:overlay', (_e, dialog) => { steam?.openOverlay(dialog); return true; });
ipcMain.handle('hr:fullscreen', (_e, on) => { win?.setFullScreen(on == null ? !win.isFullScreen() : !!on); return win?.isFullScreen(); });
ipcMain.handle('hr:quit', () => app.quit());
ipcMain.handle('hr:relay-port', () => tunnel?.clientRelayPort || null);
ipcMain.handle('hr:keyboard', (_e, rect) => steam?.showKeyboard?.(rect) ?? false);
ipcMain.handle('hr:open-log', () => { if (LOG_FILE) shell.showItemInFolder(LOG_FILE); return LOG_FILE; });

app.on('second-instance', (_e, argv) => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  const lobby = lobbyFromArgs(argv);
  if (lobby) joinSteamLobby(lobby);
});

app.whenReady().then(async () => {
  setupLogFile();
  Menu.setApplicationMenu(null);
  if (process.env.HR_FAKE_STEAM) {
    // Development only: simulated Steam for testing two copies against each other (tools/fake-steam.mjs).
    const { FakeSteam } = await import('../tools/fake-steam.mjs');
    steam = await FakeSteam.connect(process.env.HR_FAKE_STEAM);
  } else steam = new Steam(APP_ID);
  if (steam.ok) console.log('[steam] signed in as', steam.info().name);
  else console.log('[steam]', steam.error);
  steam.onJoinRequest((lobbyId) => joinSteamLobby(lobbyId));
  const launchLobby = lobbyFromArgs(process.argv);
  await createWindow();
  if (launchLobby) joinSteamLobby(launchLobby);
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  tunnel?.close();
  relay?.close();
  steam?.leave();
  localServer?.close();
});
