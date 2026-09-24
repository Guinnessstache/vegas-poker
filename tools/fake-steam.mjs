// DEVELOPMENT ONLY — a pretend Steam so two copies of the desktop app can be tested against
// each other on one machine without Steam accounts. Not part of the shipped game.
//
//   node tools/fake-steam.mjs 4700                     # start the pretend Steam network
//   HR_FAKE_STEAM=4700:111:Alice HR_USER_DATA=/tmp/a npm run desktop
//   HR_FAKE_STEAM=4700:222:Bob   HR_USER_DATA=/tmp/b npm run desktop
//
// It stands in for the Steam features the game uses: lobbies (create / find by code / join /
// members), peer-to-peer packets, friend invites and the friends list.
import net from 'node:net';
import { pathToFileURL } from 'node:url';

function lines(sock, onMsg) {
  let buf = '';
  sock.setEncoding('utf8');
  sock.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line) { try { onMsg(JSON.parse(line)); } catch (e) { console.warn('[fake-steam] bad message', e.message); } }
    }
  });
}
const write = (sock, obj) => { if (!sock.destroyed) sock.write(`${JSON.stringify(obj)}\n`); };

// ---------------- the pretend Steam network ----------------
export function startBus(port = 4700) {
  const users = new Map(); // id -> { sock, name }
  const lobbies = new Map(); // id -> { data, members: Set }
  let nextLobby = 9000;
  const lobbyView = (id) => { const l = lobbies.get(id); return l ? { lobby: id, data: l.data, members: [...l.members] } : { lobby: null }; };
  const tellMembers = (id) => {
    const l = lobbies.get(id);
    if (!l) return;
    for (const m of l.members) { const u = users.get(m); if (u) write(u.sock, { op: 'members', lobby: id, members: [...l.members] }); }
  };
  const leave = (who, id) => {
    const l = lobbies.get(id);
    if (!l) return;
    l.members.delete(who);
    if (!l.members.size) lobbies.delete(id); else tellMembers(id);
  };
  const tellUsers = () => {
    const list = [...users].map(([id, u]) => ({ id, name: u.name }));
    for (const u of users.values()) write(u.sock, { op: 'users', list });
  };
  const server = net.createServer((sock) => {
    let me = null;
    lines(sock, (m) => {
      const reply = (x) => write(sock, { rid: m.rid, ...x });
      switch (m.op) {
        case 'hello': me = m.id; users.set(me, { sock, name: m.name }); tellUsers(); break;
        case 'create': { const id = String(nextLobby++); lobbies.set(id, { data: m.data, members: new Set([me]) }); reply(lobbyView(id)); break; }
        case 'find': { const hit = [...lobbies].find(([, l]) => l.data.code === m.code && l.data.game === m.game); reply({ lobby: hit ? hit[0] : null }); break; }
        case 'join': { const l = lobbies.get(m.lobby); if (l) { l.members.add(me); tellMembers(m.lobby); } reply(lobbyView(m.lobby)); break; }
        case 'leave': leave(me, m.lobby); break;
        case 'packet': { const u = users.get(m.to); if (u) write(u.sock, { op: 'packet', from: me, data: m.data }); break; }
        case 'invite': { const u = users.get(m.to); if (u) write(u.sock, { op: 'invite', from: me, lobby: m.lobby }); break; }
        default: break;
      }
    });
    sock.on('error', () => {});
    sock.on('close', () => {
      if (!me) return;
      users.delete(me);
      for (const id of [...lobbies.keys()]) leave(me, id);
      tellUsers();
    });
  });
  return new Promise((res) => server.listen(port, '127.0.0.1', () => res(server)));
}

// ---------------- what the game talks to (same methods as desktop/steam.mjs) ----------------
export class FakeSteam {
  static async connect(spec) {
    const [port, id, name] = String(spec).split(':');
    const s = new FakeSteam(id, name || `Player ${id}`);
    await new Promise((res, rej) => { s.sock = net.connect(Number(port), '127.0.0.1', res); s.sock.once('error', rej); });
    lines(s.sock, (m) => s.onMessage(m));
    write(s.sock, { op: 'hello', id, name: s.name });
    return s;
  }

  constructor(id, name) {
    this.id = id; this.name = name; this.ok = true;
    this.lobbyId = null; this.data = null; this.members = [];
    this.users = []; this.rid = 0; this.waiting = new Map();
    this.onPacket = null; this.joinHandler = null;
  }

  onMessage(m) {
    if (m.rid) { this.waiting.get(m.rid)?.(m); this.waiting.delete(m.rid); return; }
    if (m.op === 'packet') this.onPacket?.(m.from, Buffer.from(m.data, 'base64'));
    else if (m.op === 'members' && m.lobby === this.lobbyId) this.members = m.members;
    else if (m.op === 'users') this.users = m.list;
    else if (m.op === 'invite') this.joinHandler?.(m.lobby); // pretend the player clicked Accept
  }

  req(obj) {
    const rid = ++this.rid;
    return new Promise((res) => { this.waiting.set(rid, res); write(this.sock, { ...obj, rid }); });
  }

  info() { return { ok: true, appId: 480, name: this.name, steamId: this.id, country: 'US', deck: false }; }
  get mySteamId() { return this.id; }
  onJoinRequest(h) { this.joinHandler = h; }

  async hostTable({ code }) {
    if (this.isHosting() && this.data.code === code) return this.lobbyId;
    this.leave();
    const r = await this.req({ op: 'create', data: { code, host: this.id, game: 'fake' } });
    Object.assign(this, { lobbyId: r.lobby, data: r.data, members: r.members });
    return r.lobby;
  }
  async findTable(code) { return (await this.req({ op: 'find', code, game: 'fake' })).lobby; }
  async joinLobby(id) {
    this.leave();
    const r = await this.req({ op: 'join', lobby: String(id) });
    if (!r.lobby) throw new Error('lobby not found');
    Object.assign(this, { lobbyId: r.lobby, data: r.data, members: r.members });
    return { code: r.data.code, host: r.data.host, hostHere: r.members.includes(r.data.host), game: r.data.game };
  }
  isHosting() { return !!this.lobbyId && this.data?.host === this.id; }
  isLobbyMember(p) { return this.members.includes(String(p)); }
  startNetworking({ onPacket }) { this.onPacket = onPacket; return true; }
  sendPacket(peer, buf) { write(this.sock, { op: 'packet', to: String(peer), data: Buffer.from(buf).toString('base64') }); return true; }
  listFriends() { return this.users.filter((u) => u.id !== this.id).map((u) => ({ id: u.id, name: u.name, state: 1, status: 'Online' })); }
  inviteFriend(id) { if (!this.lobbyId) return false; write(this.sock, { op: 'invite', to: String(id), lobby: this.lobbyId }); return true; }
  invite() { return false; }
  leave() { if (this.lobbyId) write(this.sock, { op: 'leave', lobby: this.lobbyId }); this.lobbyId = null; this.data = null; this.members = []; }
  unlock() { return true; }
  openOverlay() {}
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const port = Number(process.argv[2] || 4700);
  await startBus(port);
  console.log(`[fake-steam] pretend Steam network on 127.0.0.1:${port}`);
}
