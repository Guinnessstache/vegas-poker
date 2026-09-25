// A small TURN relay (RFC 5766), just enough for WebRTC webcams when two players can't
// connect directly. Clients talk to it over TCP (turn:...?transport=tcp), which lets guests reach
// the host's relay through the Steam tunnel; the relayed media itself moves over UDP inside the
// host's machine. Long-term credentials, per-allocation UDP relay sockets, permissions, channels.
import net from 'node:net';
import dgram from 'node:dgram';
import { createHash, createHmac, randomBytes } from 'node:crypto';

const MAGIC = 0x2112a442;
const M = { BINDING: 0x001, ALLOCATE: 0x003, REFRESH: 0x004, SEND: 0x006, DATA: 0x007, CREATE_PERMISSION: 0x008, CHANNEL_BIND: 0x009 };
const CLASS = { REQUEST: 0x000, INDICATION: 0x010, SUCCESS: 0x100, ERROR: 0x110 };
const A = {
  MAPPED_ADDRESS: 0x0001, USERNAME: 0x0006, MESSAGE_INTEGRITY: 0x0008, ERROR_CODE: 0x0009, CHANNEL_NUMBER: 0x000c,
  LIFETIME: 0x000d, XOR_PEER_ADDRESS: 0x0012, DATA: 0x0013, REALM: 0x0014, NONCE: 0x0015, XOR_RELAYED_ADDRESS: 0x0016,
  REQUESTED_TRANSPORT: 0x0019, XOR_MAPPED_ADDRESS: 0x0020, SOFTWARE: 0x8022, FINGERPRINT: 0x8028,
};
const MAX_LIFETIME = 3600;
const DEFAULT_LIFETIME = 600;

const methodOf = (type) => (type & 0x000f) | ((type & 0x00e0) >> 1) | ((type & 0x3e00) >> 2);
const classOf = (type) => type & 0x0110;
const typeOf = (method, cls) => (method & 0x000f) | ((method & 0x0070) << 1) | ((method & 0x0f80) << 2) | cls;

// ---------------- message encoding ----------------
function parse(buf) {
  const type = buf.readUInt16BE(0);
  const len = buf.readUInt16BE(2);
  const tid = buf.subarray(8, 20);
  const attrs = [];
  let o = 20;
  while (o + 4 <= 20 + len) {
    const t = buf.readUInt16BE(o); const l = buf.readUInt16BE(o + 2);
    attrs.push({ type: t, value: buf.subarray(o + 4, o + 4 + l), offset: o });
    o += 4 + l + ((4 - (l % 4)) % 4);
  }
  return { type, method: methodOf(type), cls: classOf(type), tid, attrs, raw: buf.subarray(0, 20 + len) };
}
const attr = (msg, t) => msg.attrs.find((a) => a.type === t);

function xorAddr(ip, port, tid) {
  const b = Buffer.alloc(8);
  b.writeUInt8(0, 0); b.writeUInt8(0x01, 1);
  b.writeUInt16BE(port ^ (MAGIC >>> 16), 2);
  const parts = ip.split('.').map(Number);
  const n = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  b.writeUInt32BE((n ^ MAGIC) >>> 0, 4);
  return b;
}
function readXorAddr(v) {
  if (v.readUInt8(1) !== 0x01) return null; // IPv4 only
  const port = v.readUInt16BE(2) ^ (MAGIC >>> 16);
  const n = (v.readUInt32BE(4) ^ MAGIC) >>> 0;
  return { ip: [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'), port };
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

// Build a message. `key` adds MESSAGE-INTEGRITY; FINGERPRINT is always added.
function build(method, cls, tid, attrs, key) {
  const parts = [];
  for (const [t, v] of attrs) {
    const h = Buffer.alloc(4); h.writeUInt16BE(t, 0); h.writeUInt16BE(v.length, 2);
    parts.push(h, v, Buffer.alloc((4 - (v.length % 4)) % 4));
  }
  let body = Buffer.concat(parts);
  const header = (extra) => {
    const h = Buffer.alloc(20);
    h.writeUInt16BE(typeOf(method, cls), 0);
    h.writeUInt16BE(body.length + extra, 2);
    h.writeUInt32BE(MAGIC, 4);
    tid.copy(h, 8);
    return h;
  };
  if (key) {
    const hmac = createHmac('sha1', key).update(Buffer.concat([header(24), body])).digest();
    const mi = Buffer.alloc(4); mi.writeUInt16BE(A.MESSAGE_INTEGRITY, 0); mi.writeUInt16BE(20, 2);
    body = Buffer.concat([body, mi, hmac]);
  }
  const fpHead = header(8);
  const crc = (crc32(Buffer.concat([fpHead, body])) ^ 0x5354554e) >>> 0;
  const fp = Buffer.alloc(8); fp.writeUInt16BE(A.FINGERPRINT, 0); fp.writeUInt16BE(4, 2); fp.writeUInt32BE(crc, 4);
  body = Buffer.concat([body, fp]);
  return Buffer.concat([header(0), body]);
}

function checkIntegrity(msg, key) {
  const mi = attr(msg, A.MESSAGE_INTEGRITY);
  if (!mi) return false;
  const upto = Buffer.from(msg.raw.subarray(0, mi.offset));
  upto.writeUInt16BE(mi.offset - 20 + 24, 2); // length as if MESSAGE-INTEGRITY were last
  const want = createHmac('sha1', key).update(upto).digest();
  return want.equals(mi.value);
}

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const errorCode = (code, reason) => {
  const r = Buffer.from(reason, 'utf8');
  const b = Buffer.alloc(4 + r.length);
  b.writeUInt8(Math.floor(code / 100), 2); b.writeUInt8(code % 100, 3); r.copy(b, 4);
  return b;
};

// ---------------- server ----------------
export async function startTurnServer({ host = '127.0.0.1', port = 0, relayIp = '127.0.0.1', username, credential, realm = 'highroller', log = () => {} } = {}) {
  username ||= `hr${randomBytes(4).toString('hex')}`;
  credential ||= randomBytes(12).toString('hex');
  const key = createHash('md5').update(`${username}:${realm}:${credential}`).digest();
  const conns = new Set();

  const server = net.createServer((sock) => {
    sock.setNoDelay(true);
    const c = { sock, buf: Buffer.alloc(0), nonce: randomBytes(8).toString('hex'), alloc: null };
    conns.add(c);
    const sendMsg = (b) => { if (!sock.destroyed) sock.write(b); };
    const cleanup = () => { conns.delete(c); if (c.alloc) { clearTimeout(c.alloc.timer); c.alloc.udp.close(); c.alloc = null; } };
    sock.on('close', cleanup);
    sock.on('error', () => sock.destroy());

    const reply = (msg, cls, attrs, signed = true) => sendMsg(build(msg.method, cls, msg.tid, attrs, signed ? key : null));
    const fail = (msg, code, reason, extra = []) => reply(msg, CLASS.ERROR, [[A.ERROR_CODE, errorCode(code, reason)], ...extra], code !== 401 && code !== 438);

    const expire = (secs) => {
      clearTimeout(c.alloc.timer);
      c.alloc.timer = setTimeout(() => { if (c.alloc) { c.alloc.udp.close(); c.alloc = null; } }, secs * 1000);
    };

    const toClient = (data, from) => {
      const a = c.alloc;
      if (!a || !a.perms.has(from.address)) return;
      const ch = a.peerToChannel.get(`${from.address}:${from.port}`);
      if (ch) {
        const pad = (4 - (data.length % 4)) % 4;
        const h = Buffer.alloc(4); h.writeUInt16BE(ch, 0); h.writeUInt16BE(data.length, 2);
        sendMsg(Buffer.concat([h, data, Buffer.alloc(pad)]));
      } else {
        sendMsg(build(M.DATA, CLASS.INDICATION, randomBytes(12), [[A.XOR_PEER_ADDRESS, xorAddr(from.address, from.port, null)], [A.DATA, data]]));
      }
    };

    const handle = (msg) => {
      if (msg.method === M.BINDING && msg.cls === CLASS.REQUEST) {
        return reply(msg, CLASS.SUCCESS, [[A.XOR_MAPPED_ADDRESS, xorAddr(sock.remoteAddress.replace('::ffff:', ''), sock.remotePort)]], false);
      }
      if (msg.cls === CLASS.INDICATION && msg.method === M.SEND) {
        const a = c.alloc; const p = attr(msg, A.XOR_PEER_ADDRESS); const d = attr(msg, A.DATA);
        if (!a || !p || !d) return;
        const peer = readXorAddr(p.value);
        if (peer && a.perms.has(peer.ip)) a.udp.send(d.value, peer.port, peer.ip);
        return;
      }
      if (msg.cls !== CLASS.REQUEST) return;
      // Everything else needs long-term credentials.
      const user = attr(msg, A.USERNAME); const nonce = attr(msg, A.NONCE);
      if (!attr(msg, A.MESSAGE_INTEGRITY) || !user) {
        return fail(msg, 401, 'Unauthorized', [[A.REALM, Buffer.from(realm)], [A.NONCE, Buffer.from(c.nonce)]]);
      }
      if (!nonce || nonce.value.toString() !== c.nonce) {
        return fail(msg, 438, 'Stale Nonce', [[A.REALM, Buffer.from(realm)], [A.NONCE, Buffer.from(c.nonce)]]);
      }
      if (user.value.toString() !== username || !checkIntegrity(msg, key)) {
        return fail(msg, 401, 'Unauthorized', [[A.REALM, Buffer.from(realm)], [A.NONCE, Buffer.from(c.nonce)]]);
      }
      const lifetimeReq = attr(msg, A.LIFETIME)?.value.readUInt32BE(0);
      switch (msg.method) {
        case M.ALLOCATE: {
          if (c.alloc) return fail(msg, 437, 'Allocation Mismatch');
          const rt = attr(msg, A.REQUESTED_TRANSPORT);
          if (!rt || rt.value.readUInt8(0) !== 17) return fail(msg, 442, 'Unsupported Transport Protocol');
          const udp = dgram.createSocket('udp4');
          udp.on('error', () => {});
          udp.bind(0, relayIp, () => {
            const a = { udp, perms: new Set(), channels: new Map(), peerToChannel: new Map(), timer: null };
            c.alloc = a;
            udp.on('message', (data, rinfo) => toClient(data, rinfo));
            const life = Math.min(MAX_LIFETIME, lifetimeReq || DEFAULT_LIFETIME);
            expire(life);
            const { port: rport } = udp.address();
            log('[turn] allocation', `${relayIp}:${rport}`);
            reply(msg, CLASS.SUCCESS, [
              [A.XOR_RELAYED_ADDRESS, xorAddr(relayIp, rport)],
              [A.XOR_MAPPED_ADDRESS, xorAddr(sock.remoteAddress.replace('::ffff:', ''), sock.remotePort)],
              [A.LIFETIME, u32(life)],
            ]);
          });
          return undefined;
        }
        case M.REFRESH: {
          if (!c.alloc) return fail(msg, 437, 'Allocation Mismatch');
          const life = lifetimeReq === 0 ? 0 : Math.min(MAX_LIFETIME, lifetimeReq || DEFAULT_LIFETIME);
          if (life === 0) { clearTimeout(c.alloc.timer); c.alloc.udp.close(); c.alloc = null; } else expire(life);
          return reply(msg, CLASS.SUCCESS, [[A.LIFETIME, u32(life)]]);
        }
        case M.CREATE_PERMISSION: {
          if (!c.alloc) return fail(msg, 437, 'Allocation Mismatch');
          for (const p of msg.attrs.filter((x) => x.type === A.XOR_PEER_ADDRESS)) {
            const peer = readXorAddr(p.value);
            if (peer) c.alloc.perms.add(peer.ip);
          }
          return reply(msg, CLASS.SUCCESS, []);
        }
        case M.CHANNEL_BIND: {
          if (!c.alloc) return fail(msg, 437, 'Allocation Mismatch');
          const ch = attr(msg, A.CHANNEL_NUMBER)?.value.readUInt16BE(0);
          const p = attr(msg, A.XOR_PEER_ADDRESS);
          const peer = p && readXorAddr(p.value);
          if (!ch || ch < 0x4000 || ch > 0x7ffe || !peer) return fail(msg, 400, 'Bad Request');
          c.alloc.channels.set(ch, peer);
          c.alloc.peerToChannel.set(`${peer.ip}:${peer.port}`, ch);
          c.alloc.perms.add(peer.ip);
          return reply(msg, CLASS.SUCCESS, []);
        }
        default:
          return fail(msg, 400, 'Bad Request');
      }
    };

    sock.on('data', (d) => {
      c.buf = c.buf.length ? Buffer.concat([c.buf, d]) : d;
      while (c.buf.length >= 4) {
        const first = c.buf.readUInt16BE(0);
        if (first >= 0x4000 && first <= 0x7fff) {
          // ChannelData: [channel][length][data][pad to 4 over TCP]
          const len = c.buf.readUInt16BE(2);
          const total = 4 + len + ((4 - (len % 4)) % 4);
          if (c.buf.length < total) break;
          const peer = c.alloc?.channels.get(first);
          if (peer && c.alloc.perms.has(peer.ip)) c.alloc.udp.send(c.buf.subarray(4, 4 + len), peer.port, peer.ip);
          c.buf = c.buf.subarray(total);
        } else {
          if (c.buf.length < 20) break;
          const total = 20 + c.buf.readUInt16BE(2);
          if (c.buf.length < total) break;
          const msgBuf = c.buf.subarray(0, total);
          c.buf = c.buf.subarray(total);
          if (msgBuf.readUInt32BE(4) !== MAGIC) { sock.destroy(); return; }
          try { handle(parse(msgBuf)); } catch (e) { log('[turn] bad message', e.message); }
        }
      }
    });
  });

  await new Promise((res, rej) => { server.once('error', rej); server.listen(port, host, res); });
  const actual = server.address().port;
  log('[turn] relay listening on', `${host}:${actual}`);
  return {
    port: actual, username, credential,
    close() { for (const c of conns) c.sock.destroy(); server.close(); },
  };
}
