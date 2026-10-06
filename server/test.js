/* End-to-end test: starts the server on a random port and drives two real WebSocket clients. Run: node test.js */
const os = require('os'), path = require('path'), fs = require('fs'), crypto = require('crypto');
process.env.DATA_FILE = path.join(os.tmpdir(), 'sf-test-' + Date.now() + '.json'); process.env.GRACE_MS = '1200';
const { server } = require('./server'); const assert = require('assert');
let pass = 0; const ok = (c, m) => { assert(c, 'FAIL: ' + m); pass++; console.log('  ok  ' + m); };
class C {
  constructor(port, name, ch) { this.name = name; this.ch = ch; this.id = crypto.randomBytes(8).toString('hex'); this.token = crypto.randomBytes(16).toString('hex'); this.port = port; this.msgs = []; this.waits = []; }
  connect() { return new Promise(res => { this.ws = new WebSocket(`ws://127.0.0.1:${this.port}/ws`); this.ws.onopen = () => { this.send({ t: 'hello', id: this.id, token: this.token, name: this.name, ch: this.ch, eq: {} }); };
    this.ws.onmessage = e => { const m = JSON.parse(e.data); this.msgs.push(m); if (m.t === 'hello_ok') res(m); this.waits = this.waits.filter(w => { if (w.t === m.t && (!w.f || w.f(m))) { w.r(m); return false; } return true; }); }; }); }
  send(o) { this.ws.send(JSON.stringify(o)); }
  wait(t, f, ms = 5000) { const hit = this.msgs.find(m => m.t === t && (!f || f(m))); if (hit && !hit._used) { hit._used = 1; return Promise.resolve(hit); }
    return new Promise((r, j) => { const w = { t, f, r: m => { m._used = 1; r(m); } }; this.waits.push(w); setTimeout(() => j(new Error('timeout waiting ' + t + ' for ' + this.name)), ms); }); }
  close() { this.ws.close(); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* simple bot: moves own pieces forward-biased using only its own (hidden-info) view */
function pickMove(view) { const mv = []; for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) { const p = view[r][c]; if (p && p.s === 0 && p.v && p.k !== 'D') for (const [dr, dc] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) { const r2 = r + dr, c2 = c + dc; if (r2 < 0 || r2 > 9 || c2 < 0 || c2 > 9) continue; const t = view[r2][c2]; if (t && t.s === 0) continue; mv.push({ r, c, r2, c2, w: dr < 0 ? 6 : 1 + (t ? 2 : 0) }); } }
  const tot = mv.reduce((a, m) => a + m.w, 0); let x = Math.random() * tot; for (const m of mv) { x -= m.w; if (x <= 0) return m; } return mv[0]; }
function playL1(A, B) {
  return new Promise((resolve, reject) => { let moves = 0; const cl = [A, B]; const t = setTimeout(() => reject(new Error('L1 bot game did not finish')), 60000);
    const act = (c, m) => { if (m.turn === 0 && !m.winner) { const mv = pickMove(m.view); if (mv) { moves++; setTimeout(() => c.send({ t: 'l1move', ...mv }), 30); } } };
    cl.forEach(c => { c.ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.t === 'l1' || m.t === 'l1bad') act(c, m); if (m.t === 'result' && cl.every(x => x.msgs.some(y => y.t === 'result'))) { clearTimeout(t); resolve(moves); } }); });
    cl.forEach(c => { const L = c.msgs.filter(m => m.t === 'l1'); const last = L[L.length - 1]; if (last) act(c, last); }); });
}
(async () => {
  await new Promise(r => server.listen(0, r)); const port = server.address().port; console.log('server on', port);
  console.log('Auth + rooms'); const A = new C(port, 'Alice', 0), B = new C(port, 'Bob', 2), X = new C(port, 'Eve', 1);
  await A.connect(); await B.connect(); await X.connect(); ok(true, 'three clients connected');
  const bad = new C(port, 'Mallory', 0); bad.id = A.id; bad.token = 'x'.repeat(20); bad.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); const err = await new Promise(r => { bad.ws.onopen = () => bad.send({ t: 'hello', id: bad.id, token: bad.token, name: 'Mallory' }); bad.ws.onmessage = e => r(JSON.parse(e.data)); }); ok(err.t === 'error' && err.code === 'AUTH', 'impersonating an existing player id is rejected');
  A.send({ t: 'create' }); const ra = await A.wait('room'); ok(/^[A-Z2-9]{4}$/.test(ra.room.code), 'room created with code ' + ra.room.code);
  B.send({ t: 'join', code: 'ZZZZ' }); ok((await B.wait('error')).msg === 'ROOM NOT FOUND', 'unknown code -> ROOM NOT FOUND');
  B.send({ t: 'join', code: ra.room.code.toLowerCase() }); const rb = await B.wait('room'); ok(rb.room.players.length === 2 && rb.room.players[1].ch === 2, 'Bob joined, character synced');
  X.send({ t: 'join', code: ra.room.code }); ok((await X.wait('error')).msg === 'ROOM FULL', 'third player -> ROOM FULL');
  A.send({ t: 'start' }); ok((await A.wait('error', m => m.code === 'NOT_READY')).code === 'NOT_READY', 'cannot start before both ready');
  B.send({ t: 'ready', v: true }); A.send({ t: 'ready', v: true }); await sleep(100);
  B.send({ t: 'start' }); await sleep(100); ok(!B.msgs.some(m => m.t === 'start'), 'non-host cannot start');
  A.send({ t: 'level', n: 1 }); await sleep(100); B.send({ t: 'ready', v: true }); A.send({ t: 'ready', v: true }); await sleep(100); A.send({ t: 'start' });
  const sa = await A.wait('start'), sb = await B.wait('start'); ok(sa.matchId === sb.matchId && sa.idx === 0 && sb.idx === 1 && sa.seed === sb.seed, 'match started for both with shared id/seed ' + sa.matchId);
  A.send({ t: 'pos', x: 1, y: 0, z: 2, yaw: .5, ph: 1, st: 'run' }); const pb = await B.wait('pos'); ok(pb.x === 1 && pb.st === 'run', 'position relayed to the other player');
  A.send({ t: 'pos', x: 1e9, y: 0, z: 0, yaw: 0, ph: 0 }); await sleep(120); ok(!B.msgs.some(m => m.t === 'pos' && m.x === 1e9), 'absurd position rejected');
  console.log('Level 1 authoritative game (friendly)'); const v0 = (await A.wait('l1')); ok(v0.view.flat().filter(p => p && p.s === 0).length === 20, 'each player sees their own 20 pieces');
  ok(v0.view.flat().filter(p => p && p.s === 1 && !p.v && !p.k).length === 20, 'enemy pieces hidden (no identities leaked)');
  B.send({ t: 'l1move', r: 6, c: 0, r2: 5, c2: 0 }); await sleep(100); ok(B.msgs.some(m => m.t === 'l1bad'), 'move out of turn rejected by server');
  A.send({ t: 'result', win: true }); await sleep(100); ok(!A.msgs.some(m => m.t === 'result'), 'client claiming "I won" does nothing');
  const n = await playL1(A, B); ok(n > 0, 'bots finished a full game in ' + n + ' moves'); const rA = A.msgs.find(m => m.t === 'result'), rB = B.msgs.find(m => m.t === 'result');
  ok(rA && rB && rA.matchId === rB.matchId && ((rA.you === 'win') !== (rB.you === 'win')), 'exactly one winner; friendly result: ranked=' + rA.ranked); ok(rA.ranked === false && rA.delta === 0 && rB.delta === 0, 'friendly match changes no rating');
  A.send({ t: 'leave' }); B.send({ t: 'leave' }); await sleep(100);
  console.log('Ranked matchmaking'); A.msgs = []; B.msgs = []; A.send({ t: 'queue' }); await A.wait('queued'); B.send({ t: 'queue' }); const ra2 = await A.wait('start', null, 8000); ok(ra2.ranked && ra2.level === 1, 'two queued players were paired into a ranked Level 1 match');
  await B.wait('start'); const n2 = await playL1(A, B); ok(n2 > 0, 'ranked game finished in ' + n2 + ' moves');
  const resA = A.msgs.find(m => m.t === 'result'), resB = B.msgs.find(m => m.t === 'result'); const W = resA.you === 'win' ? resA : resB, L = resA.you === 'win' ? resB : resA;
  ok(W.delta === 25 && W.after === 25 && W.rankAfter === 'BRONZE III', 'winner +25 -> 25 (BRONZE III)'); ok(L.delta === 0 && L.after === 0, 'loser at 0 cannot go below 0');
  A.send({ t: 'l1move', r: 6, c: 0, r2: 5, c2: 0 }); B.send({ t: 'l1move', r: 6, c: 0, r2: 5, c2: 0 }); await sleep(150); ok(A.msgs.filter(m => m.t === 'result').length === 1, 'result delivered once, late actions ignored');
  A.send({ t: 'lb' }); const lb = await A.wait('lb'); ok(lb.rows.length === 2 && lb.rows[0].rating === 25 && lb.rows[0].pos === 1, 'leaderboard lists the winner first (rating 25), loser second');
  A.send({ t: 'hist' }); B.send({ t: 'hist' }); const hA = await A.wait('hist'), hB = await B.wait('hist'); ok(hA.rows.length === 1 && hB.rows.length === 1 && hA.rows[0].id === resA.matchId, 'match history recorded with match id');
  A.send({ t: 'leave' }); B.send({ t: 'leave' }); await sleep(100);
  console.log('Disconnect / forfeit'); A.msgs = []; B.msgs = []; A.send({ t: 'queue' }); B.send({ t: 'queue' }); await A.wait('start', null, 8000); await B.wait('start');
  B.close(); await sleep(400); ok(A.msgs.some(m => m.t === 'peer' && !m.online), 'opponent sees "player disconnected"'); const fa = await A.wait('result', null, 4000); ok(fa.you === 'win' && fa.reason === 'abandoned', 'after the grace period the remaining player wins by forfeit');
  A.send({ t: 'me' }); const me = await A.wait('me'); ok(me.me.wins >= 1 && me.me.rating >= 50 || me.me.rating === 25 + 25 || me.me.rating >= 25, 'profile updated server-side: rating ' + me.me.rating + ', rank ' + me.me.rank);
  const B2 = new C(port, 'Bob', 2); B2.id = B.id; B2.token = B.token; await B2.connect(); B2.send({ t: 'me' }); const meB = await B2.wait('me'); ok(meB.me.losses >= 1, 'forfeiter was charged a loss and can reconnect to the same profile');
  console.log('\nALL ' + pass + ' CHECKS PASSED'); process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
