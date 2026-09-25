// Steam tunnel: TCP carried over a lossy-but-reliable packet link (like Steam P2P).
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { Tunnel } from '../desktop/tunnel.mjs';

function fakeSteam() {
  const peers = {};
  const pipes = {};
  const send = (from) => (to, buf) => {
    if (Math.random() < 0.15) return false; // "try again later"
    (pipes[`${from}>${to}`] ||= []).push(Buffer.from(buf));
    return true;
  };
  const timer = setInterval(() => {
    for (const k in pipes) {
      const [from, to] = k.split('>');
      while (pipes[k].length) peers[to]?.handlePacket(from, pipes[k].shift());
    }
  }, 3);
  return { peers, send, stop: () => clearInterval(timer) };
}

async function echoServer() {
  const srv = net.createServer((s) => s.pipe(s));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return srv;
}

const roundTrip = (port, data) => new Promise((resolve, reject) => {
  const chunks = [];
  let got = 0;
  const s = net.connect(port, '127.0.0.1', () => s.write(data));
  s.on('data', (d) => { chunks.push(d); got += d.length; if (got >= data.length) { s.end(); resolve(Buffer.concat(chunks)); } });
  s.on('error', reject);
  s.on('close', () => { if (got < data.length) resolve(Buffer.concat(chunks)); });
});

test('carries TCP byte-exact through refused and delayed sends', async () => {
  const echo = await echoServer();
  const net_ = fakeSteam();
  net_.peers.HOST = new Tunnel({ send: net_.send('HOST'), localPort: echo.address().port, authorize: (p) => p === 'GUEST' });
  net_.peers.GUEST = new Tunnel({ send: net_.send('GUEST'), localPort: 1, authorize: () => false });
  const port = await net_.peers.GUEST.connectTo('HOST');
  const big = Buffer.alloc(700_000);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 255;
  const results = await Promise.all([roundTrip(port, big), roundTrip(port, Buffer.from('hello')), roundTrip(port, big.subarray(0, 50_000))]);
  assert.ok(results[0].equals(big));
  assert.equal(results[1].toString(), 'hello');
  assert.ok(results[2].equals(big.subarray(0, 50_000)));
  net_.peers.HOST.close(); net_.peers.GUEST.close(); net_.stop(); echo.close();
});

test('host refuses players who are not in its lobby', async () => {
  const echo = await echoServer();
  const net_ = fakeSteam();
  net_.peers.HOST = new Tunnel({ send: net_.send('HOST'), localPort: echo.address().port, authorize: () => false });
  let refused = 0;
  net_.peers.STRANGER = new Tunnel({ send: net_.send('STRANGER'), localPort: 1, authorize: () => false, onRefused: () => refused++ });
  const port = await net_.peers.STRANGER.connectTo('HOST');
  const out = await roundTrip(port, Buffer.from('let me in'));
  assert.equal(out.length, 0);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(refused, 1, 'guest is told it was refused');
  net_.peers.HOST.close(); net_.peers.STRANGER.close(); net_.stop(); echo.close();
});
