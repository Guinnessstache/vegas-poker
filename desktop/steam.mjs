// Thin, failure-tolerant wrapper around steamworks.js.
// Everything degrades gracefully when Steam isn't running (or on unsupported platforms),
// so the desktop app still works as a plain game.
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

let steamworks = null;
try { steamworks = require('steamworks.js'); } catch (e) { console.warn('[steam] steamworks.js unavailable:', e.message); }

// Extra Steam calls steamworks.js doesn't expose (friends list, lobby invites), made directly
// against the flat C API of the steam_api library that steamworks.js already loaded.
// These don't need the Steam overlay, which Electron windows can't reliably show.
function loadFlatApi() {
  let koffi;
  try { koffi = require('koffi'); } catch (e) { console.warn('[steam] koffi unavailable:', e.message); return null; }
  const libName = process.platform === 'win32' ? 'steam_api64.dll' : process.platform === 'darwin' ? 'libsteam_api.dylib' : 'libsteam_api.so';
  const candidates = [libName];
  try {
    const dir = path.dirname(require.resolve('steamworks.js/package.json')).replace('app.asar', 'app.asar.unpacked');
    const sub = process.platform === 'win32' ? 'win64' : process.platform === 'darwin' ? 'osx' : 'linux64';
    candidates.push(path.join(dir, 'dist', sub, libName));
  } catch { /* ignore */ }
  let lib = null;
  for (const c of candidates) { try { lib = koffi.load(c); break; } catch { /* try next */ } }
  if (!lib) { console.warn('[steam] could not load', libName); return null; }
  try {
    const f = {
      friends: lib.func('void *SteamAPI_SteamFriends_v017()'),
      matchmaking: lib.func('void *SteamAPI_SteamMatchmaking_v009()'),
      utils: lib.func('void *SteamAPI_SteamUtils_v010()'),
      friendCount: lib.func('int SteamAPI_ISteamFriends_GetFriendCount(void *self, int flags)'),
      friendByIndex: lib.func('uint64_t SteamAPI_ISteamFriends_GetFriendByIndex(void *self, int i, int flags)'),
      friendName: lib.func('const char *SteamAPI_ISteamFriends_GetFriendPersonaName(void *self, uint64_t id)'),
      friendState: lib.func('int SteamAPI_ISteamFriends_GetFriendPersonaState(void *self, uint64_t id)'),
      smallAvatar: lib.func('int SteamAPI_ISteamFriends_GetSmallFriendAvatar(void *self, uint64_t id)'),
      imageSize: lib.func('bool SteamAPI_ISteamUtils_GetImageSize(void *self, int image, _Out_ uint32_t *w, _Out_ uint32_t *h)'),
      imageRGBA: lib.func('bool SteamAPI_ISteamUtils_GetImageRGBA(void *self, int image, _Out_ uint8_t *buf, int size)'),
      inviteToLobby: lib.func('bool SteamAPI_ISteamMatchmaking_InviteUserToLobby(void *self, uint64_t lobby, uint64_t invitee)'),
      lobbyStringFilter: lib.func('void SteamAPI_ISteamMatchmaking_AddRequestLobbyListStringFilter(void *self, const char *key, const char *value, int cmp)'),
      lobbyDistanceFilter: lib.func('void SteamAPI_ISteamMatchmaking_AddRequestLobbyListDistanceFilter(void *self, int filter)'),
      lobbyCountFilter: lib.func('void SteamAPI_ISteamMatchmaking_AddRequestLobbyListResultCountFilter(void *self, int max)'),
    };
    return f;
  } catch (e) {
    console.warn('[steam] flat API bind failed:', e.message);
    return null;
  }
}

const GAME_TAG = 'high-roller-holdem-p2p-1'; // lobbies from this version of the game
const PERSONA = ['Offline', 'Online', 'Busy', 'Away', 'Snooze', 'Looking to trade', 'Looking to play', 'Invisible'];
const FRIEND_FLAG_IMMEDIATE = 0x04;

// Call before app 'ready' so the overlay can hook the renderer.
export function enableOverlay() {
  try { steamworks?.electronEnableSteamOverlay(); } catch (e) { console.warn('[steam] overlay:', e.message); }
}

// Returns true when the game should quit because Steam is relaunching it
// (only matters for real App IDs when the exe is started outside of Steam).
export function restartThroughSteamIfNeeded(appId) {
  if (!steamworks || !appId || appId === 480) return false;
  try { return steamworks.restartAppIfNecessary(appId); } catch { return false; }
}

export class Steam {
  constructor(appId) {
    this.appId = appId;
    this.client = null;
    this.lobby = null;
    this.error = null;
    if (!steamworks) { this.error = 'steamworks.js not installed'; return; }
    try {
      this.client = steamworks.init(appId);
    } catch (e) {
      this.error = `Steam not available (${e.message}). Is the Steam client running?`;
      this.client = null;
    }
  }

  get ok() { return !!this.client; }

  flatApi() {
    if (!this.client) return null;
    if (this._flat === undefined) this._flat = loadFlatApi();
    return this._flat;
  }

  // Steam friends list (no overlay needed). Online friends first.
  listFriends() {
    const f = this.flatApi();
    if (!f) return null;
    const fr = f.friends();
    const utils = f.utils();
    const n = f.friendCount(fr, FRIEND_FLAG_IMMEDIATE);
    const out = [];
    for (let i = 0; i < n; i++) {
      const id = f.friendByIndex(fr, i, FRIEND_FLAG_IMMEDIATE);
      const state = f.friendState(fr, id);
      const item = { id: String(id), name: f.friendName(fr, id) || 'Friend', state, status: PERSONA[state] || 'Online' };
      try {
        const img = f.smallAvatar(fr, id);
        if (img > 0) {
          const w = [0], h = [0];
          if (f.imageSize(utils, img, w, h) && w[0] > 0 && w[0] <= 64) {
            const buf = Buffer.alloc(w[0] * h[0] * 4);
            if (f.imageRGBA(utils, img, buf, buf.length)) item.avatar = { w: w[0], h: h[0], rgba: buf.toString('base64') };
          }
        }
      } catch { /* avatars are optional */ }
      out.push(item);
    }
    out.sort((a, b) => (a.state === 0) - (b.state === 0) || a.name.localeCompare(b.name));
    return out;
  }

  inviteFriend(steamId) {
    const f = this.flatApi();
    if (!f || !this.lobby) return false;
    return f.inviteToLobby(f.matchmaking(), BigInt(this.lobby.id), BigInt(steamId));
  }

  info() {
    if (!this.client) return { ok: false, error: this.error };
    const me = this.client.localplayer;
    return {
      ok: true,
      appId: this.client.utils.getAppId(),
      name: me.getName(),
      steamId: String(me.getSteamId().steamId64),
      country: me.getIpCountry(),
      deck: this.client.utils.isSteamRunningOnSteamDeck(),
    };
  }

  // Friends clicked "Join game" / accepted an invite while we're running.
  onJoinRequest(handler) {
    if (!this.client) return;
    this.client.callback.register(steamworks.SteamCallback.GameLobbyJoinRequested, (ev) => handler(ev.lobby_steam_id));
  }

  get mySteamId() {
    try { return String(this.client.localplayer.getSteamId().steamId64); } catch { return null; }
  }

  // Create (or reuse) the Steam lobby for a table this player is hosting. The lobby only
  // carries the table code and the host's Steam ID; the game itself runs in the host's app.
  // Public so friends can find it by table code (searches only match the exact code).
  async hostTable({ code }) {
    if (!this.client) return null;
    const me = this.mySteamId;
    if (this.lobby && this.lobby.getData('code') === code && this.lobby.getData('host') === me) return String(this.lobby.id);
    this.leave();
    const { matchmaking } = this.client;
    this.lobby = await matchmaking.createLobby(2 /* Public */, 16);
    this.lobby.mergeFullData({ code, host: me, game: GAME_TAG });
    this.lobby.setJoinable(true);
    this.setPresence(code);
    return String(this.lobby.id);
  }

  // Find a hosted table by its code (anywhere in the world).
  async findTable(code) {
    if (!this.client) return null;
    const f = this.flatApi();
    if (f) {
      const mm = f.matchmaking();
      f.lobbyStringFilter(mm, 'game', GAME_TAG, 0 /* Equal */);
      f.lobbyStringFilter(mm, 'code', code, 0);
      f.lobbyDistanceFilter(mm, 3 /* Worldwide */);
      f.lobbyCountFilter(mm, 10);
    }
    const lobbies = await this.client.matchmaking.getLobbies();
    const hit = lobbies.find((l) => l.getData('game') === GAME_TAG && l.getData('code') === code);
    return hit ? String(hit.id) : null;
  }

  // Join a table's lobby and return who is hosting it.
  async joinLobby(lobbyId) {
    if (!this.client) return null;
    this.leave();
    this.lobby = await this.client.matchmaking.joinLobby(BigInt(lobbyId));
    const data = this.lobby.getFullData();
    const host = data.host || String(this.lobby.getOwner().steamId64);
    const hostHere = this.lobby.getMembers().some((m) => String(m.steamId64) === host);
    if (data.code) this.setPresence(data.code);
    return { code: data.code || null, host, hostHere, game: data.game || null };
  }

  isHosting() {
    return !!this.lobby && this.lobby.getData('host') === this.mySteamId;
  }

  isLobbyMember(steamId) {
    if (!this.lobby) return false;
    try { return this.lobby.getMembers().some((m) => String(m.steamId64) === String(steamId)); } catch { return false; }
  }

  // Steam peer-to-peer packets (relayed through Valve's network when a direct path isn't possible).
  startNetworking({ onPacket, onPeerFailed }) {
    if (!this.client) return false;
    if (this._net) return true;
    const n = this.client.networking;
    const cb = this.client.callback;
    cb.register(steamworks.SteamCallback.P2PSessionRequest, ({ remote }) => {
      try { n.acceptP2PSession(remote); } catch { /* ignore */ }
    });
    cb.register(steamworks.SteamCallback.P2PSessionConnectFail, ({ remote }) => onPeerFailed?.(String(remote)));
    this._net = setInterval(() => {
      for (let i = 0; i < 512; i++) {
        let size = 0;
        try { size = n.isP2PPacketAvailable(); } catch { size = 0; }
        if (!size) break;
        let p;
        try { p = n.readP2PPacket(size); } catch { break; }
        try { onPacket(String(p.steamId.steamId64), p.data); } catch (e) { console.warn('[steam] packet handler', e); }
      }
    }, 4);
    return true;
  }

  sendPacket(steamId, buf) {
    if (!this.client) return false;
    return this.client.networking.sendP2PPacket(BigInt(steamId), 2 /* Reliable */, buf);
  }

  invite() {
    if (!this.client || !this.lobby) return false;
    this.lobby.openInviteDialog();
    return true;
  }

  setPresence(code) {
    try {
      this.client.localplayer.setRichPresence('status', code ? `At a poker table (${code})` : 'In the lobby');
    } catch { /* ignore */ }
  }

  leave() {
    if (this.lobby) { try { this.lobby.leave(); } catch { /* ignore */ } }
    this.lobby = null;
    if (this.client) this.setPresence(null);
  }

  unlock(achievement) {
    if (!this.client) return false;
    try {
      if (this.client.achievement.isActivated(achievement)) return true;
      return this.client.achievement.activate(achievement);
    } catch { return false; }
  }

  openOverlay(dialog) {
    if (!this.client) return;
    const map = { friends: 0, achievements: 6, settings: 3 };
    try { this.client.overlay.activateDialog(map[dialog] ?? 0); } catch { /* ignore */ }
  }
}
