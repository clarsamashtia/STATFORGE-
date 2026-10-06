/* STATFORGE multiplayer adapter.
   Bridges the existing game (js/core/main.js) to the Node server (server/server.js) over WebSocket (/ws).
   It never replaces game systems: it wraps level start/finish functions and feeds the existing UI.
   The server is authoritative for rooms, Level 1 moves, results, ratings, leaderboard and history. */
(function () {
  'use strict';
  /* ---------- configuration (edit ONLY this line after deploying the server) ---------- */
  const PROD_WS = '';                                   // e.g. 'wss://statforge-server.onrender.com/ws'
  function serverURL() {
    const q = new URLSearchParams(location.search).get('server'); let saved = '';
    if (q) { try { localStorage.setItem('statforge_server', q); } catch (e) {} }
    try { saved = localStorage.getItem('statforge_server') || ''; } catch (e) {}
    let u = q || saved;
    if (!u) { if (location.protocol === 'http:' && location.host) u = 'ws://' + location.host + '/ws'; else u = PROD_WS; }   // local/LAN: same host as the page
    if (!u) return '';
    u = u.replace(/^http/, 'ws'); if (!/\/ws$/.test(u)) u = u.replace(/\/+$/, '') + '/ws';
    if (location.protocol === 'https:' && /^ws:\/\//.test(u) && !/localhost|127\.0\.0\.1/.test(u)) u = u.replace(/^ws:/, 'wss:');   // never mixed content
    return u;
  }
  const $ = id => document.getElementById(id);
  const LV = ['Free roam in Pixel Academy', '1 · Ranking of Pieces', '2 · Sorting Game', '3 · Nominal, Ordinal, Interval or Ratio', '4 · Computation', '5 · Excel Tech', '6 · The Final'];
  const MP = { ws: null, state: 'offline', url: '', me: null, room: null, match: null, result: null, peers: {}, tries: 0, want: false, timer: null, view: 0, lastPos: 0, lastSent: '', queued: false };
  window.MP = MP;

  /* ---------- identity (random id + secret kept in this browser; server stores only a hash) ---------- */
  function ident() {
    let id = '', tk = '';
    try { id = localStorage.getItem('statforge_mp_id') || ''; tk = localStorage.getItem('statforge_mp_token') || ''; } catch (e) {}
    const rnd = n => Array.from(crypto.getRandomValues(new Uint8Array(n))).map(b => b.toString(16).padStart(2, '0')).join('');
    if (!id) { id = rnd(8); tk = rnd(16); try { localStorage.setItem('statforge_mp_id', id); localStorage.setItem('statforge_mp_token', tk); } catch (e) {} }
    return { id, tk };
  }
  const ID = ident(); MP.id = ID.id;

  /* ---------- connection ---------- */
  function setState(s) { MP.state = s; renderStatus(); renderChip(); }
  function connect() {
    if (MP.ws && (MP.ws.readyState === 0 || MP.ws.readyState === 1)) return;
    MP.url = serverURL(); MP.want = true;
    if (!MP.url) { setState('offline'); MP.err = location.protocol === 'file:' ? 'Open the game through http://localhost:3000 (not file://).' : 'No multiplayer server configured.'; renderStatus(); return; }
    setState(MP.tries ? 'reconnecting' : 'connecting');
    let ws; try { ws = new WebSocket(MP.url); } catch (e) { return fail(); } MP.ws = ws;
    const guard = setTimeout(() => { if (ws.readyState !== 1) try { ws.close(); } catch (e) {} }, 8000);
    ws.onopen = () => { clearTimeout(guard); send({ t: 'hello', id: ID.id, token: ID.tk, name: S.name, ch: S.ch, eq: S.eq || {} }); };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } try { onMsg(m); } catch (x) { console.error('[mp]', x); } };
    ws.onclose = () => { clearTimeout(guard); if (MP.ws === ws) { MP.ws = null; fail(); } };
    ws.onerror = () => {};
  }
  function fail() {
    const wasOnline = MP.state === 'online'; setState('offline'); MP.tries++;
    if (MP.match && !MP.match.done && wasOnline) toast('<b style="color:#f88">Connection lost.</b> Reconnecting…', 'bad', 3000);
    if (MP.want && (MP.room || MP.match || MP.view !== undefined)) { clearTimeout(MP.timer); MP.timer = setTimeout(() => { if (MP.want) connect(); }, Math.min(1000 * 2 ** Math.min(MP.tries, 4), 12000)); }
  }
  function send(o) { if (MP.ws && MP.ws.readyState === 1) { MP.ws.send(JSON.stringify(o)); return true; } return false; }
  MP.send = send;
  function close() { MP.want = false; clearTimeout(MP.timer); if (MP.ws) { const w = MP.ws; MP.ws = null; try { w.close(); } catch (e) {} } MP.tries = 0; setState('offline'); }

  /* ---------- helpers ---------- */
  const thumb = i => `assets/characters/${CH[i].id}/front.png`;
  const rooms = () => MP.room && MP.room.players;
  const peer = () => (rooms() || []).find(p => p.id !== ID.id);
  const peerCh = () => { const p = peer(); return p ? p.ch : (S.ch + 1) % 4; };
  const isHost = () => MP.room && MP.room.host === ID.id;
  const live = n => MP.match && !MP.match.done && MP.match.level === n;
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function withSeed(seed, fn) { const o = Math.random; Math.random = mulberry32(seed ^ 0x9e3779b9); try { fn(); } finally { Math.random = o; } }
  const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const ev = d => send({ t: 'ev', d });
  MP.ev = ev;

  /* ---------- status / chip ---------- */
  function renderStatus() {
    const el = $('mpst'); if (!el) return;
    const m = { online: ['● SERVER ONLINE', 'on'], connecting: ['● CONNECTING…', 'wait'], reconnecting: ['● RECONNECTING…', 'wait'], offline: ['● SERVER OFFLINE', 'off'] }[MP.state];
    el.textContent = m[0]; el.className = 'mpst ' + m[1];
    const on = MP.state === 'online';
    ['mpQ', 'mpC', 'mpJb', 'mpLB', 'mpMR'].forEach(i => { if ($(i)) $(i).disabled = !on; });
    $('mpRetry').style.display = on || MP.state !== 'offline' ? 'none' : '';
    if (MP.state === 'offline' && MP.view === 0) $('mpS').innerHTML = '<b>MULTIPLAYER SERVER UNAVAILABLE</b><br>' + esc(MP.err || 'Retry, or play Practice vs AI.');
    else if (on && MP.view === 0 && !MP.queued) $('mpS').textContent = '';
  }
  function renderChip() {
    let c = $('mph'); if (!c) { c = document.createElement('div'); c.id = 'mph'; document.body.appendChild(c); }
    if (!MP.room) { c.style.display = 'none'; return; }
    const p = peer(), dot = MP.state === 'online' ? '●' : '○';
    c.style.display = (mode === 'menu' || mode === 'chars') ? 'none' : 'block';
    c.textContent = `${dot} ${MP.state === 'online' ? 'ONLINE' : 'RECONNECTING'} · ROOM ${MP.room.code} · vs ${p ? p.name + (p.online ? '' : ' (offline)') : 'waiting…'}${MP.match && MP.match.ranked ? ' · RANKED' : ''}`;
  }
  setInterval(renderChip, 1000);

  /* ---------- lobby UI ---------- */
  function view(n) { MP.view = n; [0, 1, 2].forEach(i => $('mpv' + i).style.display = i === n ? 'block' : 'none'); renderStatus(); }
  window.MPopen = function () {
    hide('menu'); show('mp'); $('mpn').value = S.name === 'Scholar' ? '' : S.name; $('mpS').textContent = ''; drawChars(); view(MP.room ? 1 : 0); if (MP.room) renderRoom(); connect(); renderStatus();
  };
  function drawChars() {
    $('mpch').innerHTML = CH.map((c, i) => `<img src="${thumb(i)}" data-i="${i}" alt="${c.n}" title="${c.n}" class="${i === S.ch ? 'on' : ''}">`).join('');
  }
  function applyIdentity() {
    const n = $('mpn').value.trim().toUpperCase(); if (n) S.name = n.slice(0, 12); save(); hudUpd();
    send({ t: 'setup', name: S.name, ch: S.ch, eq: S.eq || {} });
  }
  $('mpch').onclick = e => { const i = e.target.closest('[data-i]'); if (!i) return; S.ch = +i.dataset.i; save(); drawChars(); sfx('click'); if (MP.state === 'online') send({ t: 'setup', ch: S.ch, eq: S.eq || {} }); };
  $('mpn').onchange = () => { const n = $('mpn').value.trim().toUpperCase(); if (n) { S.name = n.slice(0, 12); save(); } };
  const needOnline = () => { if (MP.state !== 'online') { renderStatus(); return false; } applyIdentity(); return true; };
  $('mpQ').onclick = () => { if (!needOnline()) return; MP.queued = true; $('mpS').innerHTML = '<b>SEARCHING FOR AN OPPONENT…</b> (ranked · Level 1)'; $('mpQ').textContent = 'Cancel search'; $('mpQ').onclick = cancelQueue; send({ t: 'queue' }); };
  function cancelQueue() { send({ t: 'unqueue' }); resetQ(); }
  function resetQ() { MP.queued = false; $('mpQ').textContent = 'Ranked Match'; $('mpQ').onclick = () => { if (!needOnline()) return; MP.queued = true; $('mpS').innerHTML = '<b>SEARCHING FOR AN OPPONENT…</b> (ranked · Level 1)'; $('mpQ').textContent = 'Cancel search'; $('mpQ').onclick = cancelQueue; send({ t: 'queue' }); }; $('mpS').textContent = ''; }
  $('mpC').onclick = () => { if (needOnline()) send({ t: 'create' }); };
  $('mpJb').onclick = () => { if (!needOnline()) return; const c = $('mpJ').value.trim().toUpperCase(); if (c.length < 3) { $('mpS').textContent = 'Enter the room code.'; return; } send({ t: 'join', code: c }); };
  $('mpJ').addEventListener('keydown', e => { if (e.key === 'Enter') $('mpJb').click(); });
  $('mpAI').onclick = () => { if (MP.room) send({ t: 'leave' }); gm = 'ai'; diff = 'medium'; toChars(); };
  $('mpRetry').onclick = () => { MP.tries = 0; connect(); };
  $('mpB').onclick = () => { if (MP.queued) cancelQueue(); hide('mp'); show('menu'); if (!MP.room) close(); };
  $('mpLB').onclick = () => { if (!needOnline()) return; view(2); $('mpdata').textContent = 'Loading…'; send({ t: 'lb' }); };
  $('mpMR').onclick = () => { if (!needOnline()) return; view(2); $('mpdata').textContent = 'Loading…'; send({ t: 'me' }); send({ t: 'hist' }); };
  $('mpBack2').onclick = () => view(MP.room ? 1 : 0);
  $('mpLeave').onclick = () => { send({ t: 'leave' }); MP.room = null; MP.match = null; view(0); renderChip(); };
  $('mpRd').onclick = () => { const me = (rooms() || []).find(p => p.id === ID.id); send({ t: 'ready', v: !(me && me.ready) }); };
  $('mpGo').onclick = () => send({ t: 'start' });

  function renderRoom() {
    const r = MP.room; if (!r) { view(0); return; }
    if (MP.view === 0 || MP.view === undefined) view(1);
    $('mpcode').textContent = r.code;
    $('mpplayers').innerHTML = `<div style="text-align:center">PLAYERS ${r.players.length}/2${r.ranked ? ' · RANKED' : ''}</div>` + r.players.map((p, i) => `<div class="mpp"><img src="${thumb(p.ch)}" alt=""><div><b>${esc(p.name)}</b>${p.id === r.host ? ' ★' : ''}${p.id === ID.id ? ' (you)' : ''}<br><small>${CH[p.ch].n} · ${p.rank} ${p.rating}</small></div><span class="rd ${p.ready ? 'y' : 'n'}">${p.online ? (p.ready ? 'READY' : 'NOT READY') : 'OFFLINE'}</span></div>`).join('');
    const lw = $('mplvw');
    if (r.ranked) lw.innerHTML = '<div class="note" style="color:#dfe8ff">Ranked match: Level 1 · Ranking of Pieces (server-controlled).</div>';
    else if (isHost()) { lw.innerHTML = `<select id="mpsel">${LV.map((n, i) => `<option value="${i}" ${i === r.level ? 'selected' : ''}>${n}</option>`).join('')}</select>`; $('mpsel').onchange = e => send({ t: 'level', n: +e.target.value }); }
    else lw.innerHTML = `<div class="note" style="color:#dfe8ff">Host chose: ${LV[r.level]}</div>`;
    const me = r.players.find(p => p.id === ID.id), ready2 = r.players.length === 2 && r.players.every(p => p.ready && p.online);
    $('mpRd').textContent = me && me.ready ? 'Unready' : 'Ready'; $('mpGo').style.display = isHost() && !r.ranked ? '' : 'none'; $('mpGo').disabled = !ready2;
    $('mpS1').textContent = r.players.length < 2 ? 'Share the room code with your friend.' : ready2 ? (isHost() ? 'Both ready: press Start Match.' : 'Waiting for the host to start…') : 'Both players must be ready.';
  }

  /* ---------- messages ---------- */
  function onMsg(m) {
    switch (m.t) {
      case 'hello_ok': MP.me = m.me; MP.tries = 0; setState('online'); if (MP.view === 0) $('mpS').textContent = ''; break;
      case 'error': if (m.code === 'AUTH') { close(); MP.err = 'Identity rejected by the server.'; renderStatus(); } else { $('mpS').textContent = m.msg; $('mpS1').textContent = m.msg; toast('<b style="color:#f88">' + esc(m.msg) + '</b>', 'bad', 2500); } if (MP.queued) resetQ(); break;
      case 'queued': break;
      case 'unqueued': break;
      case 'room': MP.queued = false; if (!m.room) { MP.room = null; view(0); resetQ(); } else { const first = !MP.room; MP.room = m.room; if (first && $('mp').classList.contains('on')) { view(1); } renderRoom(); } renderChip(); break;
      case 'start': onStart(m); break;
      case 'pos': peerPos(m); break;
      case 'ev': onEv(m.d || {}); break;
      case 'l1': onL1(m); break;
      case 'l1bad': onL1(m); break;
      case 'result': onResult(m); break;
      case 'peer': { const p = (rooms() || []).find(x => x.id === m.id); if (p) p.online = m.online; if (m.id !== ID.id) toast(m.online ? '<b style="color:#6f6">Opponent reconnected.</b>' : '<b style="color:#f88">Player disconnected.</b> Waiting for them to return…', m.online ? 'good' : 'bad', 3500); renderChip(); if ($('mp').classList.contains('on')) renderRoom(); break; }
      case 'left': if (m.id !== ID.id) { delete MP.peers[m.id]; if (MP.match && !MP.match.done && MP.match.level !== 1) toast('<b style="color:#f88">Your opponent left the match.</b>', 'bad', 3500); } break;
      case 'lb': renderLB(m); break;
      case 'me': MP.me = m.me; MP.meView = m.me; renderProfile(); break;
      case 'hist': MP.hist = m.rows; renderProfile(); break;
    }
  }
  const dt = t => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  function renderLB(m) {
    $('mpdata').innerHTML = `<div class="ttl">STATFORGE LEADERBOARD</div><table><tr><th>#</th><th>PLAYER</th><th>RANK</th><th>RATING</th><th>W</th><th>WIN%</th></tr>${m.rows.map(r => `<tr class="${r.me ? 'me' : ''}"><td>${r.pos}</td><td>${esc(r.name)}</td><td>${r.rank}</td><td>${r.rating}</td><td>${r.wins}</td><td>${r.wr}%</td></tr>`).join('') || '<tr><td colspan="6">No ranked matches played yet.</td></tr>'}</table>${m.mypos ? `<p>Your position: #${m.mypos} of ${m.total}</p>` : '<p>Play a ranked match to appear here.</p>'}`;
  }
  function renderProfile() {
    const p = MP.meView; if (!p || $('mpv2').style.display === 'none') return;
    const pct = p.next ? Math.round(100 * (1 - p.next.need / (p.rating + p.next.need - p.floor))) : 100;
    $('mpdata').innerHTML = `<div class="ttl">MY RANK</div><div style="font-size:clamp(22px,3vw,34px);font-weight:900;color:var(--gold)">${p.rank}</div><div>Rating: <b>${p.rating}</b>${p.pos ? ' · Leaderboard #' + p.pos : ''}</div>
      <div>Wins ${p.wins} · Losses ${p.losses} · Draws ${p.draws} · Matches ${p.matches} · Win rate ${p.wr}%</div><div>Current streak ${p.streak} · Best streak ${p.best}</div>
      ${p.next ? `<div>Next: ${p.next.name} — ${p.next.need} rating needed</div><div class="mpbar"><i style="width:${pct}%"></i></div>` : '<div>Top rank reached!</div>'}
      <div class="ttl" style="margin-top:8px">MATCH HISTORY</div><table>${(MP.hist || []).map(h => `<tr><td>${h.res}</td><td>${h.rank}</td><td>${h.delta > 0 ? '+' : ''}${h.delta}</td><td>${dt(h.t)}</td></tr>`).join('') || '<tr><td>No ranked matches yet.</td></tr>'}</table>`;
  }

  /* ---------- match start ---------- */
  function onStart(m) {
    if (m.resume && MP.match && MP.match.id === m.matchId) { MP.match.resumed = true; return; }
    MP.match = { id: m.matchId, level: m.level, seed: m.seed, ranked: m.ranked, idx: m.idx, done: false }; MP.result = null; MP.queued = false;
    window.SHUF_RNG = mulberry32(m.seed);
    hide('mp'); hide('menu'); hide('chars'); hide('ai'); resOpen = false; hide('res'); setPause(false);
    $('hud').classList.add('on'); hudUpd(); gm = 'mp'; diff = 'medium';
    mode = 'academy'; setScene('academy'); Object.assign(P, { x: 0, y: 0, z: 14, vy: 0 }); cam.yaw = 0; cam.pitch = .3; $('hlv').textContent = 'PIXEL ACADEMY'; renderChip();
    if (m.level > 0) withSeed(m.seed + m.level, () => enterLevel(m.level));
    else toast('<b style="color:#6f6">Match started: free roam.</b> You can see each other. Walk to a gate to play a trial.', 'good', 4000);
    toast('<b>MATCH START</b> — ' + (m.ranked ? 'RANKED · ' : '') + LV[m.level], 'good', 2500);
  }

  /* ---------- presence: send my position, draw the other player ---------- */
  setInterval(() => {
    if (!MP.room || MP.state !== 'online' || !(mode === 'academy' || mode === 'l2' || mode === 'l6') || paused) return;
    const msg = { t: 'pos', x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), yaw: +P.yaw.toFixed(2), ph: +P.ph.toFixed(1), st: P.an.s, sc: scene };
    const key = [msg.x, msg.y, msg.z, msg.yaw, msg.st, msg.sc].join(); const now = performance.now();
    if (key !== MP.lastSent || now - MP.lastPos > 700) { MP.lastSent = key; MP.lastPos = now; send(msg); }
  }, 70);
  function peerPos(m) {
    let p = MP.peers[m.id]; if (!p) p = MP.peers[m.id] = { x: m.x, y: m.y, z: m.z, yaw: m.yaw, ph: 0 };
    p.tx = m.x; p.ty = m.y; p.tz = m.z; p.tyaw = m.yaw; p.st = m.st; p.sc = m.sc; p.seen = performance.now();
    if (m.sc === 'l6' && live(6) && L6 && L6.mp) L6.r.tz = m.z;
  }
  let lastDraw = performance.now();
  window.MPdraw = function () {
    const now = performance.now(), dtt = Math.min(.1, (now - lastDraw) / 1000); lastDraw = now;
    if (!MP.room) return;
    for (const id in MP.peers) {
      const p = MP.peers[id], info = (rooms() || []).find(x => x.id === id); if (!info || p.tx === undefined) continue;
      const k = 1 - Math.exp(-dtt * 12); p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; p.z += (p.tz - p.z) * k;
      let dy = p.tyaw - p.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); p.yaw += dy * k;
      if (p.st === 'walk' || p.st === 'run') p.ph += dtt * (p.st === 'run' ? 15 : 10);
      if (p.sc !== scene || performance.now() - p.seen > 4000) continue;
      if (scene === 'l6' && L6) continue;                    // Level 6 draws its own rival avatar
      avatar(D, CH[info.ch], p.x, p.y, p.z, p.yaw, { s: p.st || 'idle', t: now / 1000 }, info.eq || {}, p.ph);
      lab('mp' + id, info.name, p.x, p.y + 2.5, p.z);
    }
  };

  /* ---------- Level 1 (server authoritative) ---------- */
  function applyL1(m) {
    L1.b = m.view.map(row => row.map(p => p ? { t: p.k ? TK(p.k) : TK('DI'), side: p.s, rev: !!p.v } : null));
    L1.turn = m.turn; L1.sel = null; L1.moves = 1;
  }
  function l1text() { const p = peer(); $('l1s').innerHTML = L1.over ? '' : `Turn: <b style="color:${L1.turn === 0 ? '#8ec5ff' : '#ff9d92'}">${L1.turn === 0 ? 'YOU' : 'OPPONENT'}</b> · ${p ? esc(p.name) : 'Online'}${MP.match && MP.match.ranked ? ' · RANKED' : ''}`; }
  function onL1(m) {
    if (!MP.match || MP.match.level !== 1) return;
    if (!L1 || !L1.mp) { if (mode !== 'l1') withSeed(1, () => enterLevel(1)); if (!L1) return; }
    if (m.t === 'l1bad') { applyL1(m); L1.busy = L1.turn !== 0; l1render(); l1text(); return; }
    applyL1(m); const last = m.last;
    if (!last || last.o === 'move') { if (last) sfx('click'); L1.busy = L1.turn !== 0; l1render(); l1text(); if (m.winner !== null && m.winner !== undefined) { L1.over = true; setTimeout(() => l1done(m.winner === 0), 400); } return; }
    const A = { t: TK(last.a.k), side: last.a.s }, D2 = { t: TK(last.d.k), side: last.d.s }, o = last.o;
    if (o === 'att' || o === 'flag') L1.lost[D2.side].push(D2.t.k); else if (o === 'def') L1.lost[A.side].push(A.t.k); else { L1.lost[A.side].push(A.t.k); L1.lost[D2.side].push(D2.t.k); }
    if ((A.side === 0 && (o === 'att' || o === 'flag')) || (A.side === 1 && o === 'def')) addXP(10);
    sfx((A.side === 0) === (o === 'att' || o === 'flag') ? 'good' : 'bad'); if (o === 'flag') setTimeout(() => sfx('win'), 250);
    L1.busy = true; l1render(); l1text();
    const mm = $('l1m'); mm.style.display = 'block';
    mm.innerHTML = `<div style="color:var(--gold)">${A.side ? 'OPPONENT' : 'YOU'} attacked with <b>${A.t.n}</b> → ${D2.side ? 'OPPONENT' : 'YOUR'} <b>${D2.t.n}</b></div>${why(A, D2, o)}<br><br><button class="btn" id="l1c">Continue</button>`;
    $('l1c').onclick = () => { mm.style.display = 'none'; if (m.winner !== null && m.winner !== undefined) { L1.over = true; l1done(m.winner === 0); } else { L1.busy = L1.turn !== 0; l1render(); l1text(); } };
  }
  const _l1start = l1start; l1start = function () { _l1start(); if (live(1)) { L1.mp = true; L1.moves = 1; L1.busy = true; $('l1sh').style.display = 'none'; $('l1i').textContent = 'Online match: select one of your BLUE pieces, then a highlighted square. The server validates every move.'; l1text(); } };
  const _l1move = l1move; l1move = function (r, c, r2, c2) { if (L1 && L1.mp) { L1.busy = true; send({ t: 'l1move', r, c, r2, c2 }); sfx('click'); return; } return _l1move(r, c, r2, c2); };

  /* ---------- results (ratings are computed on the server only) ---------- */
  function resultHTML(r) {
    if (!r.ranked) return `<div class="mpres"><b>FRIENDLY MATCH</b> — no rating change.</div>`;
    const w = r.you === 'win', d = r.you === 'draw';
    return `<div class="mpres"><b>MATCH COMPLETE · ${d ? 'DRAW' : w ? '🏆 VICTORY' : 'DEFEAT'}</b><br>${r.delta > 0 ? '+' : ''}${r.delta} RATING · ${r.before} → ${r.after}<br>${r.rankAfter}${r.promoted ? ` — <b style="color:#6f6">RANK UP!</b> ${r.rankBefore} → ${r.rankAfter}` : r.demoted ? ` — rank lowered: ${r.rankBefore} → ${r.rankAfter}` : ''}<br>WINS ${r.wins} · LOSSES ${r.losses}<br><small>Match ${r.matchId}${r.processed ? ' · LEADERBOARD UPDATED' : ''}</small></div>`;
  }
  function onResult(r) {
    if (!MP.match || r.matchId !== MP.match.id) return; MP.result = r; MP.match.done = true;
    if (r.reason === 'abandoned' || r.reason === 'forfeit') toast(`<b>${r.you === 'win' ? 'Your opponent left. You win by forfeit.' : 'You forfeited the match.'}</b>`, r.you === 'win' ? 'good' : 'bad', 4000);
    if (live(1) || (L1 && L1.mp && !L1.over && mode === 'l1')) { L1.over = true; $('l1m').style.display = 'none'; l1done(r.you === 'win'); }
    if (resOpen) $('rb').insertAdjacentHTML('beforeend', resultHTML(r));
    send({ t: 'me' });
  }
  const _finish = finish; finish = function (n, win, lines) {
    const ret = _finish(n, win, lines);
    if (MP.match && !MP.match.done && MP.match.level === n && n !== 1) { MP.match.done = true; ev({ k: 'fin', win }); send({ t: 'done' }); }
    if (MP.result && MP.match && MP.result.matchId === MP.match.id && $('rb')) $('rb').insertAdjacentHTML('beforeend', resultHTML(MP.result));
    else if (MP.match && MP.match.level === n && !MP.match.ranked && MP.match.done) $('rb').insertAdjacentHTML('beforeend', resultHTML({ ranked: false }));
    return ret;
  };
  function leaveMatch() { if (MP.room) { send({ t: 'leave' }); } MP.room = null; MP.match = null; MP.peers = {}; window.SHUF_RNG = null; renderChip(); }
  const _exitLevel = exitLevel; exitLevel = function () { if (MP.match && MP.room) leaveMatch(); return _exitLevel(); };
  const _l1render = l1render; l1render = function () { _l1render(); if (L1 && L1.mp) l1text(); };
  const _toMenu = toMenu; toMenu = function () { if (MP.room) leaveMatch(); return _toMenu(); };
  const _l1x = $('l1x').onclick; $('l1x').onclick = function () { if (L1 && L1.mp) { if (MP.match && !MP.match.done) leaveMatch(); } return _l1x && _l1x.apply(this, arguments); };

  /* ---------- friendly-level adapters: same game, real opponent progress instead of the AI ---------- */
  function onEv(d) {
    switch (d.k) {
      case 'l2': if (L2 && L2.mp) { L2.ai.i = d.i; L2.ai.s = d.s; if (d.i >= 10) { L2.fin = L2.fin || 'a'; l2end(); } } break;
      case 'l3a': if (L3 && L3.mp) { if (L3.ph === 'ask' && L3.who === 1) l3remote(d.t); else L3.pend = d.t; } break;
      case 'l4': if (L4 && L4.mp) { L4.ah = d.h; L4.rw = d.w; if (d.ok) { L4.rok[d.q] = 1; if (d.q === L4.i && L4.ph === 'ask') L4.first = true; } } break;
      case 'l4end': if (L4 && L4.mp) { L4.rend = { h: d.h, lost: d.lost }; if (d.lost) L4.ah = 0; l4tryEnd(); } break;
      case 'l5': if (L5 && L5.mp) { L5.ai.i = d.i; L5.ai.m = d.m; l5ui(); if (d.i >= 10 && !L5.over) l5end(false, 'Your rival finished all the tasks first.'); } break;
      case 'l6': if (L6 && L6.mp) { L6.r.k = d.qi; L6.r.m = d.m; if (d.done && !L6.over) l6lose('Your rival reached the exit first!'); } break;
    }
  }
  /* Level 2 */
  const _l2start = l2start; l2start = function () { _l2start(); if (live(2)) { L2.mp = true; L2.ai.c = 1e9; } };
  const _drop = drop; drop = function (t) { _drop(t); if (L2 && L2.mp) ev({ k: 'l2', i: L2.i, s: L2.s, m: L2.m }); };
  /* Level 3 (turns relayed; both sides judge the same answers with the same bank) */
  function l3remote(t) { const s = L3; if (!s || s.ph !== 'ask' || s.who !== 1) return; const b = judge(t);
    if (!b) return l3res(1, false, `Rival said <b>${esc(t)}</b>, which can't be verified as ${s.sc}. <b style="color:#f88">Rival loses a heart.</b>`);
    if (b.sc !== s.sc) return l3res(1, false, `Rival said <b>${b.id}</b>, which is <b>${b.sc}</b>, not ${s.sc}. <b style="color:#f88">Rival loses a heart.</b>`);
    if (s.used.has(b.id)) return l3res(1, false, `Rival repeated <b>${b.id}</b>. <b style="color:#f88">Rival loses a heart.</b>`);
    s.used.add(b.id); s.ok[1]++; l3res(1, true, `Rival: <b>${b.id}</b> <b style="color:#6f6">✔</b> — valid ${s.sc} example.`); }
  const _l3start = l3start; l3start = function () { _l3start(); if (live(3)) { L3.mp = true; L3.rv = CH[peerCh()]; l3fix(); } };
  const _l3turn = l3turn; l3turn = function () { _l3turn(); if (L3 && L3.mp) l3fix(); };
  function l3fix() { const s = L3; if (!s.fixed || s.fixN !== s.n) { s.fixN = s.n; s.fixed = 1; if (!isHost()) s.who = 1 - s.who; } s.ai = null; $('l3a').disabled = s.who !== 0; $('l3b').disabled = s.who !== 0; if (s.who === 0 && s.ph === 'ask') $('l3a').focus(); l3ui(); if (s.who === 1 && s.pend) { const t = s.pend; s.pend = null; l3remote(t); } }
  const _l3submit = l3submit; l3submit = function () { const s = L3, t = $('l3a').value.trim(); const ok = s && s.mp && s.ph === 'ask' && s.who === 0 && t; _l3submit(); if (ok) ev({ k: 'l3a', t }); };
  $('l3b').onclick = l3submit;
  /* Level 4 */
  const _l4start = l4start; l4start = function () { _l4start(); if (live(4)) { L4.mp = true; L4.rv = CH[peerCh()]; L4.rok = {}; } };
  const _l4ai = l4ai; l4ai = function () { if (L4 && L4.mp) return; return _l4ai(); };
  const _l4ask = l4ask; l4ask = function () { _l4ask(); if (L4 && L4.mp && L4.rok[L4.i]) L4.first = true; };
  function l4send(q, ok) { ev({ k: 'l4', q, ok, h: L4.h, w: L4.water }); }
  const _l4submit = l4submit; l4submit = function () { const s = L4; if (!s || !s.mp) return _l4submit(); const was = s.pD, h0 = s.h, q = s.i; _l4submit(); if (L4 && !was && L4.pD) l4send(q, L4.h > h0); };
  $('l4b').onclick = l4submit;
  const _l4round = l4round; l4round = function (timeout) { const s = L4, was = s && s.pD; _l4round(timeout); if (s && s.mp && timeout && !was) l4send(s.i, false); };
  function l4tryEnd() { const s = L4; if (!s || s.over || !s.mp) return; const me = s.myEnd, re = s.rend; let win = null, why = '';
    if (re && re.lost && !(me && me.lost)) { win = true; why = 'The rival drowned!'; }
    else if (me && me.lost) { win = false; why = 'You were overtaken by the rising water.'; }
    else if (me && re) { win = s.h >= re.h; why = win ? 'You built the taller tower.' : 'The rival built the taller tower.'; }
    if (win === null) return; s.over = true; setTimeout(() => finish(4, win, [why, `Final height — You: ${s.h} blocks · Rival: ${re ? re.h : s.ah} blocks`]), 1200); }
  const _l4next = l4next; l4next = function () { const s = L4; if (!s || !s.mp) return _l4next(); if (s.myEnd) return; const pl = s.h <= s.water;
    if (pl || s.i >= 9) { s.myEnd = { lost: pl }; ev({ k: 'l4end', h: s.h, lost: pl }); s.ph = 'wait'; $('l4n').textContent = pl ? 'You were caught by the water…' : 'Waiting for your opponent to finish…'; l4tryEnd(); return; }
    s.i++; l4ask(); };
  /* Level 5 */
  const _l5start = l5start; l5start = function () { _l5start(); if (live(5)) { L5.mp = true; L5.ai.c = 1e9; L5.rv = CH[peerCh()]; } };
  const _l5task = l5task; l5task = function () { _l5task(); if (L5 && L5.mp) ev({ k: 'l5', i: L5.i, m: L5.m }); };
  /* Level 6 (existing rival avatar is driven by the other player's real position) */
  const _l6start = l6start; l6start = function () { _l6start(); if (live(6)) { L6.mp = true; L6.rv = CH[peerCh()]; L6.r.w = 0; L6.r.tz = L6.r.z; } };
  const _l6rival = l6rival; l6rival = function (dt) { const s = L6; if (!s || !s.mp) return _l6rival(dt); const r = s.r; if (r.tz !== undefined) r.z += (r.tz - r.z) * Math.min(1, dt * 6); r.w = 0; };
  const _l6gate = l6gate; l6gate = function (left) { const s = L6, q0 = s && s.qi; _l6gate(left); if (s && s.mp) ev({ k: 'l6', qi: s.qi, m: s.m }); };
  const _l6win = l6win; l6win = function () { if (L6 && L6.mp) ev({ k: 'l6', qi: 15, m: L6.m, done: true }); return _l6win(); };

  /* ---------- keep the identity fresh when the player changes character / name elsewhere ---------- */
  document.addEventListener('visibilitychange', () => { if (!document.hidden && MP.want && MP.state === 'offline') { MP.tries = 0; connect(); } });
})();
