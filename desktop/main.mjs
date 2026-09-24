// Electron entry point for the desktop / Steam build.
// - Runs the game server in-process on a private localhost port (serves the UI, offline tables).
// - Connects to Steam (overlay, friends-only lobbies, invites, achievements) when available.
// - Online tables live on the configured online server so friends anywhere can join.
import { app, BrowserWindow, ipcMain, session, shell, Menu } from 'electron';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Steam, enableOverlay, restartThroughSteamIfNeeded } from './steam.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const APP_ID = Number(process.env.STEAM_APP_ID || config.steamAppId || 480);
const ONLINE_SERVER = (process.env.HR_ONLINE_SERVER || config.onlineServer || '').replace(/\/$/, '');

// Steam sets SteamGameId for anything it launches (real games and "non-Steam game" shortcuts).
// The overlay (and so the invite dialog) is only injected into processes Steam launched.
const LAUNCHED_BY_STEAM = !!(process.env.SteamGameId || process.env.SteamOverlayGameId);

if (restartThroughSteamIfNeeded(APP_ID)) app.exit(0);
enableOverlay();
if (process.env.HR_NO_SANDBOX) app.commandLine.appendSwitch('no-sandbox');

// One running copy; a second launch (e.g. accepting an invite) is forwarded here.
if (!app.requestSingleInstanceLock()) app.exit(0);

let win = null;
let steam = null;
let localServer = null;
let pendingJoin = null; // { code, server } waiting for the renderer

function lobbyFromArgs(argv) {
  const i = argv.indexOf('+connect_lobby');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

async function joinSteamLobby(lobbyId) {
  try {
    const target = await steam.joinLobby(lobbyId);
    if (!target?.code) return;
    if (win && !win.webContents.isLoading()) win.webContents.send('hr:join-table', target);
    else pendingJoin = target;
  } catch (e) {
    console.warn('[steam] join lobby failed', e);
  }
}

async function createWindow() {
  const { startServer } = await import('../server/index.js');
  localServer = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const localUrl = `http://127.0.0.1:${localServer.port}`;

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
      additionalArguments: [
        `--hr-online=${ONLINE_SERVER}`,
        `--hr-local=${localUrl}`,
      ],
    },
  });
  win.once('ready-to-show', () => { win.show(); });

  // Camera + mic for the table video; everything else stays denied.
  const allowed = new Set(['media', 'fullscreen', 'clipboard-sanitized-write', 'clipboard-read']);
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
ipcMain.handle('hr:host-table', async (_e, { code, server }) => {
  try {
    const id = await steam?.hostTable({ code, server });
    console.log('[steam] lobby for table', code, '=>', id);
    return { ok: !!id, lobbyId: id };
  } catch (e) {
    console.warn('[steam] createLobby failed', e);
    return { ok: false, error: String(e?.message || e) };
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
ipcMain.handle('hr:leave-table', () => { steam?.leave(); return true; });
ipcMain.handle('hr:achievement', (_e, name) => steam?.unlock(String(name)) ?? false);
ipcMain.handle('hr:overlay', (_e, dialog) => { steam?.openOverlay(dialog); return true; });
ipcMain.handle('hr:fullscreen', (_e, on) => { win?.setFullScreen(on == null ? !win.isFullScreen() : !!on); return win?.isFullScreen(); });
ipcMain.handle('hr:quit', () => app.quit());

app.on('second-instance', (_e, argv) => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  const lobby = lobbyFromArgs(argv);
  if (lobby) joinSteamLobby(lobby);
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  steam = new Steam(APP_ID);
  if (steam.ok) console.log('[steam] signed in as', steam.info().name);
  else console.log('[steam]', steam.error);
  steam.onJoinRequest((lobbyId) => joinSteamLobby(lobbyId));
  const launchLobby = lobbyFromArgs(process.argv);
  await createWindow();
  if (launchLobby) joinSteamLobby(launchLobby);
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  steam?.leave();
  localServer?.close();
});
