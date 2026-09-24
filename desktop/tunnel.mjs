// Carries TCP connections between players over a packet transport (Steam P2P in the game).
//
// The host's game server only listens on 127.0.0.1. A guest's app opens a local port that
// looks exactly like that server; every TCP connection the guest makes to it is forwarded,
// byte for byte, to the host's app, which connects to its own local server. Socket.IO,
// WebSockets and plain HTTP all work unchanged, and nobody needs a public server or open ports.
//
// Frame: [type u8][connection id u32 BE][payload]
import net from 'node:net';

const T = { OPEN: 1, DATA_TO_HOST: 2, DATA_TO_GUEST: 3, CLOSE_TO_HOST: 4, CLOSE_TO_GUEST: 5, PING: 6, PONG: 7 };
const CHUNK = 32 * 1024;
const PING_EVERY = 2000;
const HOST_TIMEOUT = 20000; // guest gives up on a host it hasn't heard from at all
const GUEST_TIMEOUT = 30000; // host drops a silent guest's connections
const MAX_QUEUE = 8 * 1024 * 1024;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function frame(type, id, payload) {
  const len = payload ? payload.length : 0;
  const buf = Buffer.allocUnsafe(5 + len);
  buf.writeUInt8(type, 0);
  buf.writeUInt32BE(id >>> 0, 1);
  if (len) payload.copy(buf, 5);
  return buf;
}

export class Tunnel {
  /**
   * @param {object} o
   * @param {(peer: string, buf: Buffer) => boolean} o.send  deliver one reliable, ordered packet
   * @param {number} o.localPort                            the host's own game server port
   * @param {(peer: string) => boolean} o.authorize          may this peer use our server?
   * @param {(peer: string) => void} [o.onHostLost]          the host we joined went away
   * @param {(...a: any[]) => void} [o.log]
   */
  constructor({ send, localPort, authorize, onHostLost, log }) {
    this.sendRaw = send;
    this.localPort = localPort;
    this.authorize = authorize;
    this.onHostLost = onHostLost || (() => {});
    this.log = log || (() => {});
    this.conns = new Map(); // key -> { sock, pending?: Buffer[] }
    this.queues = new Map(); // peer -> { items: Buffer[], bytes }
    this.seen = new Map(); // peer -> last packet time (host side)
    this.client = null; // { peer, server, port, lastPong, timer }
    this.nextId = 1;
    this.timer = setInterval(() => this.tick(), 50);
    this.timer.unref?.();
  }

  // ---------- sending ----------
  out(peer, type, id, payload) {
    let q = this.queues.get(peer);
    if (!q) this.queues.set(peer, (q = { items: [], bytes: 0 }));
    if (q.bytes > MAX_QUEUE) { this.dropPeer(peer); return; }
    const buf = frame(type, id, payload);
    q.items.push(buf);
    q.bytes += buf.length;
    this.flush(peer);
  }

  pipe(peer, type, id, data) {
    for (let i = 0; i < data.length; i += CHUNK) this.out(peer, type, id, data.subarray(i, i + CHUNK));
  }

  flush(peer) {
    const q = this.queues.get(peer);
    if (!q) return;
    while (q.items.length) {
      let ok = false;
      try { ok = this.sendRaw(peer, q.items[0]); } catch { ok = false; }
      if (!ok) return; // retried on the next tick
      q.bytes -= q.items.shift().length;
    }
  }

  tick() {
    for (const peer of this.queues.keys()) this.flush(peer);
    const now = Date.now();
    for (const [peer, t] of this.seen) {
      if (now - t > GUEST_TIMEOUT) { this.log('[tunnel] guest timed out', peer); this.dropPeer(peer); }
    }
  }

  // ---------- receiving ----------
  handlePacket(peer, buf) {
    if (!buf || buf.length < 5) return;
    if (this.client?.peer === peer) this.client.lastPong = Date.now(); // anything from the host proves it's alive
    const type = buf.readUInt8(0);
    const id = buf.readUInt32BE(1);
    const payload = buf.subarray(5);
    switch (type) {
      case T.OPEN: this.seen.set(peer, Date.now()); this.accept(peer, id); break;
      case T.DATA_TO_HOST: {
        this.seen.set(peer, Date.now());
        const c = this.conns.get(`h:${peer}:${id}`);
        if (!c) return;
        if (c.sock) c.sock.write(Buffer.from(payload)); else c.pending.push(Buffer.from(payload));
        break;
      }
      case T.CLOSE_TO_HOST: {
        const key = `h:${peer}:${id}`;
        const c = this.conns.get(key);
        this.conns.delete(key);
        c?.sock?.destroy();
        break;
      }
      case T.DATA_TO_GUEST: {
        const c = this.conns.get(`g:${peer}:${id}`);
        c?.sock.write(Buffer.from(payload));
        break;
      }
      case T.CLOSE_TO_GUEST: {
        const key = `g:${peer}:${id}`;
        const c = this.conns.get(key);
        this.conns.delete(key);
        c?.sock.destroy();
        break;
      }
      case T.PING: this.seen.set(peer, Date.now()); this.out(peer, T.PONG, 0); break;
      case T.PONG: if (this.client?.peer === peer) this.client.lastPong = Date.now(); break;
      default: break;
    }
  }

  // ---------- host side ----------
  async accept(peer, id) {
    const key = `h:${peer}:${id}`;
    const entry = { sock: null, pending: [] };
    this.conns.set(key, entry);
    // A guest who just joined our Steam lobby may not be in our member list for a moment.
    let ok = false;
    for (let i = 0; i < 24 && !ok; i++) {
      try { ok = !!this.authorize(peer); } catch { ok = false; }
      if (!ok) await sleep(250);
      if (this.conns.get(key) !== entry) return; // closed while waiting
    }
    if (!ok) {
      this.log('[tunnel] refused connection from', peer, '(not in our lobby)');
      this.conns.delete(key);
      this.out(peer, T.CLOSE_TO_GUEST, id);
      return;
    }
    if (!this.seenOpen?.has(peer)) { (this.seenOpen ||= new Set()).add(peer); this.log('[tunnel] guest connected', peer); }
    const sock = net.connect(this.localPort, '127.0.0.1');
    sock.setNoDelay(true);
    entry.sock = sock;
    for (const b of entry.pending) sock.write(b);
    entry.pending = null;
    sock.on('data', (d) => this.pipe(peer, T.DATA_TO_GUEST, id, d));
    sock.on('error', () => sock.destroy());
    sock.on('close', () => {
      if (this.conns.get(key) === entry) { this.conns.delete(key); this.out(peer, T.CLOSE_TO_GUEST, id); }
    });
  }

  // ---------- guest side ----------
  /** Start forwarding a local port to `peer`'s game server. Resolves with the port. */
  async connectTo(peer) {
    this.closeClient();
    const server = net.createServer((sock) => {
      const id = this.nextId++;
      const key = `g:${peer}:${id}`;
      const entry = { sock };
      sock.setNoDelay(true);
      this.conns.set(key, entry);
      this.out(peer, T.OPEN, id);
      sock.on('data', (d) => this.pipe(peer, T.DATA_TO_HOST, id, d));
      sock.on('error', () => sock.destroy());
      sock.on('close', () => {
        if (this.conns.get(key) === entry) { this.conns.delete(key); this.out(peer, T.CLOSE_TO_HOST, id); }
      });
    });
    await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res); });
    const client = { peer, server, port: server.address().port, lastPong: Date.now() };
    client.timer = setInterval(() => {
      this.out(peer, T.PING, 0);
      if (Date.now() - client.lastPong > HOST_TIMEOUT) {
        this.log('[tunnel] host stopped answering', peer);
        this.closeClient();
        this.onHostLost(peer);
      }
    }, PING_EVERY);
    client.timer.unref?.();
    this.out(peer, T.PING, 0);
    this.client = client;
    return client.port;
  }

  get clientPeer() { return this.client?.peer || null; }

  closeClient() {
    const c = this.client;
    if (!c) return;
    this.client = null;
    clearInterval(c.timer);
    c.server.close();
    for (const [key, e] of this.conns) {
      if (key.startsWith(`g:${c.peer}:`)) { this.conns.delete(key); e.sock.destroy(); }
    }
    this.queues.delete(c.peer);
  }

  /** Forget everything about a peer (it left, timed out, or Steam says the session failed). */
  dropPeer(peer) {
    this.seen.delete(peer);
    this.queues.delete(peer);
    for (const [key, e] of this.conns) {
      if (key.startsWith(`h:${peer}:`)) { this.conns.delete(key); e.sock?.destroy(); }
    }
    if (this.client?.peer === peer) { this.closeClient(); this.onHostLost(peer); }
  }

  close() {
    this.closeClient();
    clearInterval(this.timer);
    for (const e of this.conns.values()) e.sock?.destroy();
    this.conns.clear();
    this.queues.clear();
  }
}
