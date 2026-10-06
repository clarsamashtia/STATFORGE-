/* STATFORGE multiplayer server. `npm start` -> http://localhost:3000 (also serves the game files for local testing).
   Environment: PORT, ALLOWED_ORIGINS (comma list, optional), SERVE_STATIC=0 (API only), DATA_FILE, GRACE_MS. */
const http = require('http'), fs = require('fs'), path = require('path');
const { accept } = require('./ws-lite'), R = require('./rooms'), PL = require('./players');
const PORT = Number(process.env.PORT || 3000), ROOT = path.resolve(__dirname, '..');
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.json': 'application/json', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent((req.url || '/').split('?')[0]);
  if (u === '/health') { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); return res.end(JSON.stringify({ ok: true, rooms: R.rooms.size, players: R.sessions.size })); }
  if (process.env.SERVE_STATIC === '0') { res.writeHead(404); return res.end('Statforge multiplayer API'); }
  let f = path.join(ROOT, u === '/' ? 'index.html' : u); if (!f.startsWith(ROOT) || f.startsWith(path.join(ROOT, 'server'))) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
server.on('upgrade', (req, socket) => {
  if (!String(req.url).startsWith('/ws')) return socket.destroy();
  const o = req.headers.origin; if (ORIGINS.length && o && !ORIGINS.includes(o)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy(); }
  const conn = accept(req, socket); if (!conn) return; let pid = null, tokens = 60, last = Date.now(), lastPos = 0;
  const refill = () => { const n = Date.now(); tokens = Math.min(80, tokens + (n - last) / 1000 * 40); last = n; };
  conn.onclose = () => { if (pid) { const s = R.sessions.get(pid); if (s && s.conn === conn) R.disconnect(pid); } };
  conn.onmessage = raw => {
    refill(); if (--tokens < 0) return; let m; try { m = JSON.parse(raw); } catch (e) { return; } if (!m || typeof m.t !== 'string') return;
    if (m.t === 'hello') { const p = PL.auth(m.id, m.token, m.name); if (!p) { conn.send({ t: 'error', code: 'AUTH', msg: 'AUTH FAILED' }); return conn.close(1008); }
      pid = p.id; const old = R.sessions.get(pid); if (old && old.conn !== conn && old.conn && old.conn.alive) { old.conn.onclose = null; old.conn.close(1000); }
      if (!R.reconnect(pid, conn)) R.newSession(pid, conn, Number.isInteger(m.ch) ? m.ch : p.ch); R.setup(pid, { ch: m.ch, eq: m.eq }); p.ch = R.sessions.get(pid).ch;
      return conn.send({ t: 'hello_ok', me: R.myProfile(pid) }); }
    if (!pid) return;
    switch (m.t) {
      case 'setup': { if (m.name) PL.auth(m.id || pid, null, null); R.setup(pid, m); break; }
      case 'create': R.createRoom(pid, { level: m.level }); break;
      case 'join': R.joinRoom(pid, m.code); break;
      case 'leave': R.leaveRoom(pid); break;
      case 'ready': R.setReady(pid, m.v); break;
      case 'level': R.setLevel(pid, m.n); break;
      case 'start': R.start(pid); break;
      case 'queue': R.queueJoin(pid); break;
      case 'unqueue': R.queueLeave(pid); conn.send({ t: 'unqueued' }); break;
      case 'l1move': R.l1move(pid, m); break;
      case 'pos': { const n = Date.now(); if (n - lastPos < 40) break; lastPos = n; const v = [m.x, m.y, m.z, m.yaw, m.ph]; if (!v.every(x => Number.isFinite(x) && Math.abs(x) < 2000)) break; R.relay(pid, { t: 'pos', id: pid, x: m.x, y: m.y, z: m.z, yaw: m.yaw, ph: m.ph, st: String(m.st || 'idle').slice(0, 12), sc: String(m.sc || '').slice(0, 8) }); break; }
      case 'ev': { const s = JSON.stringify(m.d || {}); if (s.length > 2048) break; R.relay(pid, { t: 'ev', id: pid, d: m.d }); break; }
      case 'lb': conn.send({ t: 'lb', ...R.leaderboard(pid) }); break;
      case 'me': conn.send({ t: 'me', me: R.myProfile(pid) }); break;
      case 'hist': conn.send({ t: 'hist', rows: R.history(pid) }); break;
      case 'ping': conn.send({ t: 'pong', ts: m.ts }); break;
    }
  };
});
setInterval(() => R.sessions.forEach(s => s.connected && s.conn && s.conn.ping()), 25000).unref();
process.on('SIGINT', () => { PL.flush(); process.exit(0); }); process.on('SIGTERM', () => { PL.flush(); process.exit(0); });
if (require.main === module) server.listen(PORT, () => console.log(`Statforge server listening on :${PORT}  (game: http://localhost:${PORT}/  health: /health  ws: /ws)`));
module.exports = { server };
