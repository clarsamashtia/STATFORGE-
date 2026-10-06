/* Rooms, matchmaking, match lifecycle, disconnect/forfeit handling and server-authoritative ranked results. */
const crypto = require('crypto');
const G = require('./game-state'), PL = require('./players');
const GRACE = Number(process.env.GRACE_MS || 30000);            // reconnect window before a forfeit
const rooms = new Map(), sessions = new Map(), queue = [];
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rcode = () => { for (;;) { let c = ''; for (let i = 0; i < 4; i++) c += ALPHA[crypto.randomInt(ALPHA.length)]; if (!rooms.has(c)) return c; } };
const matchId = () => { for (;;) { let s = ''; for (let i = 0; i < 6; i++) s += ALPHA[crypto.randomInt(ALPHA.length)]; const id = `SF-${new Date().getFullYear()}-${s}`; if (!PL.db.processed[id]) return id; } };
const prof = pid => PL.db.profiles[pid];
const send = (pid, o) => { const s = sessions.get(pid); if (s && s.conn && s.conn.alive) s.conn.send(o); };
const other = (room, pid) => room.players.find(x => x !== pid);

function roomState(r) {
  return { code: r.code, host: r.host, level: r.level, ranked: r.ranked, status: r.status, max: 2,
    players: r.players.map(pid => { const s = sessions.get(pid), p = prof(pid), i = r.info[pid];
      return { id: pid, name: p.name, ch: i.ch, ready: i.ready, online: !!(s && s.connected), rating: p.rating, rank: G.rankOf(p.rating) }; }) };
}
const bcast = (r, o) => r.players.forEach(pid => send(pid, o));
const pushRoom = r => bcast(r, { t: 'room', room: roomState(r) });

function session(pid) { return sessions.get(pid); }
function createRoom(pid, opts = {}) {
  const s = session(pid); if (s.room) leaveRoom(pid, true);
  const r = { code: rcode(), host: pid, players: [pid], info: { [pid]: { ch: s.ch, eq: s.eq, ready: false } }, level: Number.isInteger(opts.level) && opts.level >= 0 && opts.level <= 6 ? opts.level : 0, ranked: !!opts.ranked, status: 'lobby', match: null };
  if (r.ranked) r.level = 1;
  rooms.set(r.code, r); s.room = r.code; pushRoom(r); return r;
}
function joinRoom(pid, code) {
  const s = session(pid), r = rooms.get(String(code || '').toUpperCase().trim());
  if (!r) return send(pid, { t: 'error', code: 'NOT_FOUND', msg: 'ROOM NOT FOUND' });
  if (r.players.includes(pid)) return pushRoom(r);
  if (r.status !== 'lobby') return send(pid, { t: 'error', code: 'STARTED', msg: 'MATCH ALREADY STARTED' });
  if (r.players.length >= 2) return send(pid, { t: 'error', code: 'FULL', msg: 'ROOM FULL' });
  if (s.room) leaveRoom(pid, true);
  r.players.push(pid); r.info[pid] = { ch: s.ch, eq: s.eq, ready: false }; s.room = r.code; pushRoom(r);
}
function removeFromRoom(r, pid) {
  r.players = r.players.filter(x => x !== pid); delete r.info[pid]; const s = session(pid); if (s) s.room = null;
  if (!r.players.length) { rooms.delete(r.code); return; }
  if (r.host === pid) r.host = r.players[0];
  r.players.forEach(x => { r.info[x].ready = false; }); pushRoom(r);
}
function leaveRoom(pid, silent) {
  const s = session(pid), r = s && rooms.get(s.room); if (!r) return;
  if (r.status === 'playing' && r.match && !r.match.done) { finishMatch(r, other(r, pid), 'forfeit'); }
  bcast(r, { t: 'left', id: pid }); removeFromRoom(r, pid); if (!silent) send(pid, { t: 'room', room: null });
}
function setReady(pid, v) { const r = rooms.get(session(pid).room); if (!r || r.status !== 'lobby') return; r.info[pid].ready = !!v; pushRoom(r); }
function setLevel(pid, n) { const r = rooms.get(session(pid).room); if (!r || r.host !== pid || r.ranked || r.status !== 'lobby' || !Number.isInteger(n) || n < 0 || n > 6) return; r.level = n; r.players.forEach(x => { r.info[x].ready = false; }); pushRoom(r); }
function setup(pid, d) { const s = session(pid); if (Number.isInteger(d.ch) && d.ch >= 0 && d.ch <= 3) s.ch = d.ch; if (d.eq && typeof d.eq === 'object') s.eq = Object.fromEntries(Object.entries(d.eq).slice(0, 12).map(([k, v]) => [String(k).slice(0, 12), String(v).slice(0, 24)]));
  const r = rooms.get(s.room); if (r && r.status === 'lobby') { r.info[pid].ch = s.ch; r.info[pid].eq = s.eq; pushRoom(r); } }
function start(pid) {
  const r = rooms.get(session(pid).room); if (!r || r.host !== pid || r.status !== 'lobby') return;
  if (r.players.length !== 2 || !r.players.every(x => r.info[x].ready && session(x) && session(x).connected)) return send(pid, { t: 'error', code: 'NOT_READY', msg: 'BOTH PLAYERS MUST BE CONNECTED AND READY' });
  beginMatch(r);
}
function beginMatch(r) {
  r.status = 'playing';
  r.match = { id: matchId(), seed: crypto.randomInt(1, 2 ** 31), level: r.level, ranked: r.ranked, started: Date.now(), done: false, g: r.level === 1 ? G.newGame() : null, reports: {} };
  r.players.forEach((pid, idx) => { send(pid, { t: 'start', idx, matchId: r.match.id, level: r.level, seed: r.match.seed, ranked: r.ranked, peer: roomState(r).players[1 - idx] });
    if (r.match.g) send(pid, { t: 'l1', view: G.view(r.match.g, idx), turn: r.match.g.turn === idx ? 0 : 1, last: null, winner: null }); });
  pushRoom(r);
}
function l1move(pid, d) {
  const r = rooms.get(session(pid).room); if (!r || r.status !== 'playing' || !r.match || !r.match.g || r.match.done) return;
  const idx = r.players.indexOf(pid), g = r.match.g;
  const [a, b] = G.flipPt(idx, d.r, d.c), [a2, b2] = G.flipPt(idx, d.r2, d.c2);
  const res = G.applyMove(g, idx, a, b, a2, b2);
  if (!res.ok) return send(pid, { t: 'l1bad', view: G.view(g, idx), turn: g.turn === idx ? 0 : 1 });
  r.players.forEach((x, i) => { const L = res.last, fp = G.flipPt(i, ...L.from), tp = G.flipPt(i, ...L.to);
    send(x, { t: 'l1', view: G.view(g, i), turn: g.turn === i ? 0 : 1, winner: res.winner === null ? null : (res.winner === i ? 0 : 1),
      last: { from: fp, to: tp, a: { k: L.a.k, s: L.a.side === i ? 0 : 1 }, d: L.d && { k: L.d.k, s: L.d.side === i ? 0 : 1 }, o: L.o, stalemate: !!L.stalemate } }); });
  if (res.winner !== null) finishMatch(r, r.players[res.winner], res.last.stalemate ? 'no moves' : 'flag captured');
}
/* Ratings are computed here and only here. A match id is processed at most once. */
function finishMatch(r, winnerPid, reason) {
  const m = r.match; if (!m || m.done) return; m.done = true; r.status = 'done';
  const ids = r.players.slice(); const out = {};
  const dup = r.ranked && PL.db.processed[m.id];
  ids.forEach(pid => { const p = prof(pid), won = pid === winnerPid, draw = !winnerPid, o = draw ? 'draw' : won ? 'win' : 'loss';
    const before = p.rating; let after = before, changed = false;
    if (r.ranked && !dup) { after = G.newRating(before, o); p.rating = after; if (o === 'win') { p.wins++; p.streak = Math.max(0, p.streak) + 1; p.best = Math.max(p.best, p.streak); } else if (o === 'loss') { p.losses++; p.streak = 0; } else p.draws++;
      const opp = prof(ids.find(x => x !== pid)); p.history.unshift({ id: m.id, res: o === 'win' ? 'VICTORY' : o === 'loss' ? 'DEFEAT' : 'DRAW', rank: G.rankOf(after), delta: after - before, t: Date.now(), opp: opp ? opp.name : '?' }); p.history.length = Math.min(p.history.length, 50); changed = true; }
    out[pid] = { t: 'result', matchId: m.id, ranked: r.ranked, you: o, reason, before, after, delta: after - before, rankBefore: G.rankOf(before), rankAfter: G.rankOf(after), promoted: G.rankOf(after) !== G.rankOf(before) && after > before, demoted: G.rankOf(after) !== G.rankOf(before) && after < before, wins: p.wins, losses: p.losses, processed: changed }; });
  if (r.ranked && !dup) PL.db.processed[m.id] = Date.now();
  PL.save(); ids.forEach(pid => send(pid, out[pid]));
}
function queueJoin(pid) { if (queue.includes(pid)) return; const s = session(pid); if (s.room) leaveRoom(pid, true); queue.push(pid); send(pid, { t: 'queued', n: queue.length }); pump(); }
function queueLeave(pid) { const i = queue.indexOf(pid); if (i >= 0) queue.splice(i, 1); }
function pump() {
  while (queue.length >= 2) { const a = queue.shift(), b = queue.shift(); const sa = session(a), sb = session(b);
    if (!sa || !sa.connected) { if (sb && sb.connected) queue.unshift(b); continue; } if (!sb || !sb.connected) { queue.unshift(a); continue; }
    const r = createRoom(a, { ranked: true }); joinRoom(b, r.code); r.players.forEach(x => { r.info[x].ready = true; }); pushRoom(r);
    setTimeout(() => { if (rooms.get(r.code) === r && r.status === 'lobby' && r.players.length === 2) beginMatch(r); }, 3000); }
}
function relay(pid, msg) { const r = rooms.get(session(pid).room); if (!r) return; const o = other(r, pid); if (o) send(o, msg); }
function disconnect(pid) {
  const s = session(pid); if (!s) return; s.connected = false; queueLeave(pid); const r = rooms.get(s.room);
  if (!r) { sessions.delete(pid); return; }
  bcast(r, { t: 'peer', id: pid, online: false });
  if (r.status === 'playing' && r.match && !r.match.done) { clearTimeout(s.grace); s.grace = setTimeout(() => { if (!s.connected) { finishMatch(r, other(r, pid), 'abandoned'); removeFromRoom(r, pid); sessions.delete(pid); } }, GRACE); }
  else { clearTimeout(s.grace); s.grace = setTimeout(() => { if (!s.connected) { removeFromRoom(r, pid); sessions.delete(pid); } }, 15000); }
}
function reconnect(pid, conn) {
  const s = sessions.get(pid); if (!s) return null; clearTimeout(s.grace); s.conn = conn; s.connected = true;
  const r = rooms.get(s.room); if (r) { bcast(r, { t: 'peer', id: pid, online: true }); send(pid, { t: 'room', room: roomState(r) });
    if (r.status === 'playing' && r.match && !r.match.done) { const idx = r.players.indexOf(pid); send(pid, { t: 'start', idx, matchId: r.match.id, level: r.match.level, seed: r.match.seed, ranked: r.ranked, resume: true, peer: roomState(r).players[1 - idx] });
      if (r.match.g) send(pid, { t: 'l1', view: G.view(r.match.g, idx), turn: r.match.g.turn === idx ? 0 : 1, last: null, winner: null }); } }
  return s;
}
function newSession(pid, conn, ch) { const s = { pid, conn, connected: true, room: null, ch: ch || 0, eq: {}, grace: null }; sessions.set(pid, s); return s; }
function leaderboard(pid) {
  const all = Object.values(PL.db.profiles).filter(p => p.wins + p.losses + p.draws > 0).sort((a, b) => b.rating - a.rating || b.wins - a.wins || (b.wins / (b.wins + b.losses + b.draws)) - (a.wins / (a.wins + a.losses + a.draws)));
  const row = (p, i) => ({ pos: i + 1, name: p.name, rank: G.rankOf(p.rating), rating: p.rating, wins: p.wins, wr: Math.round(100 * p.wins / (p.wins + p.losses + p.draws)), me: p.id === pid });
  const idx = all.findIndex(p => p.id === pid); return { rows: all.slice(0, 20).map(row), mypos: idx >= 0 ? idx + 1 : null, total: all.length };
}
function myProfile(pid) { const p = prof(pid), lb = leaderboard(pid), nx = G.nextRank(p.rating), mat = p.wins + p.losses + p.draws;
  return { ...PL.publicProfile(p), rank: G.rankOf(p.rating), next: nx, floor: G.rankFloor(p.rating), pos: lb.mypos, wr: mat ? Math.round(100 * p.wins / mat) : 0 }; }
const history = pid => prof(pid).history.slice(0, 20);
module.exports = { sessions, rooms, newSession, reconnect, disconnect, createRoom, joinRoom, leaveRoom, setReady, setLevel, setup, start, l1move, relay, queueJoin, queueLeave, leaderboard, myProfile, history, send, finishMatch };
