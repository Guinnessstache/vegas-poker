import express from 'express';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Server } from 'socket.io';
import { Room, rooms } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));
app.use('/vendor/three', express.static(path.join(root, 'node_modules/three'), { maxAge: '7d' }));

// The hand evaluator is shared with the browser (for the "your hand" hint).
app.get('/shared/handEval.js', (_req, res) => res.type('application/javascript').sendFile(path.join(__dirname, 'handEval.js')));

app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

// ICE servers for WebRTC. STUN works for most home networks; set TURN_* env vars
// if some friends can't see/hear each other (strict NATs, corporate/mobile networks).
app.get('/api/ice', (_req, res) => {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(',').map((s) => s.trim()),
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || '',
    });
  }
  res.json({ iceServers });
});

app.get('/api/room/:code', (req, res) => {
  const r = rooms.get(String(req.params.code).toUpperCase());
  if (!r) return res.status(404).json({ exists: false });
  res.json({ exists: true, players: [...r.members.values()].filter((m) => m.connected).length });
});

const server = createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6, pingInterval: 10000, pingTimeout: 20000 });

io.on('connection', (socket) => {
  let room = null;
  let member = null;

  const reply = (cb, err, extra = {}) => typeof cb === 'function' && cb(err ? { ok: false, error: err } : { ok: true, ...extra });
  const guard = (fn) => (...args) => {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    if (!room || !member) return reply(cb, 'Not in a room');
    try { reply(cb, fn(...args)); } catch (e) { console.error(e); reply(cb, 'Server error'); }
  };

  const enter = (r, { name, key }, cb) => {
    if (typeof key !== 'string' || key.length < 16 || key.length > 64) return reply(cb, 'Bad client key');
    if (room && room !== r && member) room.leave(member);
    room = r;
    member = r.join(socket, key, name);
    reply(cb, null, { code: r.code, pid: member.pid });
  };

  socket.on('create', (data = {}, cb) => {
    const r = new Room(io, data.settings);
    enter(r, data, cb);
  });

  socket.on('join', (data = {}, cb) => {
    const r = rooms.get(String(data.code || '').toUpperCase().trim());
    if (!r) return reply(cb, 'No table with that code. Check the code and try again.');
    if (r.members.size >= 16 && !r.members.has(data.key)) return reply(cb, 'That table is full.');
    enter(r, data, cb);
  });

  socket.on('sit', guard((d) => room.sit(member, Number(d?.seat))));
  socket.on('stand', guard(() => room.stand(member)));
  socket.on('start', guard(() => room.start(member)));
  socket.on('pause', guard(() => room.pause(member)));
  socket.on('act', guard((d) => room.act(member, String(d?.action), d?.amount)));
  socket.on('rebuy', guard(() => room.rebuy(member)));
  socket.on('sitout', guard((d) => room.setSittingOut(member, d?.value)));
  socket.on('settings', guard((d) => room.updateSettings(member, d || {})));
  socket.on('chat', guard((d) => room.userChat(member, d?.text)));
  socket.on('media', guard((d) => room.setMedia(member, d)));
  socket.on('rtc', guard((d) => room.relaySignal(member, d?.to, d?.data)));
  socket.on('reaction', guard((d) => {
    const emoji = String(d?.emoji || '').slice(0, 8);
    if (emoji) io.to(room.code).emit('reaction', { pid: member.pid, emoji });
  }));
  socket.on('leave', guard(() => { room.leave(member); socket.leave(room.code); room = null; member = null; }));

  socket.on('disconnect', () => {
    if (room && member && member.socketId === socket.id) room.disconnect(member);
  });
});

server.listen(PORT, () => {
  console.log(`\n  ♠ ♥ High Roller Hold'em running on http://localhost:${PORT}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) console.log(`    LAN: http://${ni.address}:${PORT}  (camera/mic need HTTPS or localhost)`);
    }
  }
  console.log('');
});
