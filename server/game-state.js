/* Ranking rules (centralised) + the authoritative Level 1 (Ranking of Pieces) engine. */
const RANKS = [['BRONZE III', 0], ['BRONZE II', 200], ['BRONZE I', 400], ['SILVER III', 600], ['SILVER II', 800], ['SILVER I', 1000],
  ['GOLD III', 1200], ['GOLD II', 1400], ['GOLD I', 1600], ['PLATINUM III', 1800], ['PLATINUM II', 2000], ['PLATINUM I', 2200],
  ['DIAMOND III', 2400], ['DIAMOND II', 2600], ['DIAMOND I', 2800], ['MASTER', 3000]];
const RATING = { win: 25, loss: -15, draw: 0 };          // change here only
const rankOf = r => { let n = RANKS[0][0]; for (const [x, m] of RANKS) if (r >= m) n = x; return n; };
const nextRank = r => { for (const [x, m] of RANKS) if (m > r) return { name: x, need: m - r }; return null; };
const rankFloor = r => { let f = 0; for (const [, m] of RANKS) if (r >= m) f = m; return f; };
function ratingChange(outcome) { return RATING[outcome] || 0; }
function newRating(old, outcome) { return Math.max(0, old + ratingChange(outcome)); }

/* ---- Level 1 engine: 20 pieces per side = 4 Data Organization + 3 each of five types + 1 Data flag ---- */
const TYPES = [['DO', 2, 4], ['TD', 3, 3], ['LM', 4, 3], ['CT', 5, 3], ['MV', 6, 3], ['DI', 7, 3]];
const rint = n => Math.floor(Math.random() * n);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rint(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function newBoard() {
  const b = Array.from({ length: 10 }, () => Array(10).fill(null));
  for (const side of [0, 1]) {
    const rows = side ? [0, 1, 2, 3] : [6, 7, 8, 9], back = side ? 0 : 9, list = [], cells = [];
    for (const [k, r, c] of TYPES) for (let i = 0; i < c; i++) list.push({ k, r });
    rows.forEach(r => { for (let c = 0; c < 10; c++) cells.push([r, c]); });
    const fc = rint(10); b[back][fc] = { k: 'D', r: 0, side, rev: false };
    const rest = shuffle(cells.filter(x => !(x[0] === back && x[1] === fc)));
    list.forEach((p, i) => { b[rest[i][0]][rest[i][1]] = { k: p.k, r: p.r, side, rev: false }; });
  }
  return b;
}
const inb = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 10;
function legal(b, side, r, c, r2, c2) {
  if (![r, c, r2, c2].every(Number.isInteger) || !inb(r, c) || !inb(r2, c2)) return false;
  const p = b[r][c]; if (!p || p.side !== side || p.r <= 0) return false;
  if (Math.abs(r - r2) + Math.abs(c - c2) !== 1) return false;
  const t = b[r2][c2]; return !(t && t.side === side);
}
const hasMove = (b, side) => { for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) { const p = b[r][c]; if (p && p.side === side && p.r > 0) for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (legal(b, side, r, c, r + dr, c + dc)) return true; } return false; };
function outcome(a, d) { if (d.k === 'D') return 'flag'; if (a.k === 'DO' && d.k === 'DI') return 'att'; return a.r > d.r ? 'att' : a.r === d.r ? 'both' : 'def'; }
/* Applies a move for `side`. Returns {ok, last, winner(side)|null}. All validation happens here, on the server. */
function applyMove(g, side, r, c, r2, c2) {
  if (g.over || g.turn !== side || !legal(g.board, side, r, c, r2, c2)) return { ok: false };
  const b = g.board, a = b[r][c], d = b[r2][c2]; let last = { from: [r, c], to: [r2, c2], a: { k: a.k, side: a.side }, d: null, o: 'move' };
  if (!d) { b[r2][c2] = a; b[r][c] = null; }
  else {
    a.rev = d.rev = true; const o = outcome(a, d); last = { from: [r, c], to: [r2, c2], a: { k: a.k, side: a.side }, d: { k: d.k, side: d.side }, o };
    if (o === 'flag' || o === 'att') { b[r2][c2] = a; b[r][c] = null; } else if (o === 'def') b[r][c] = null; else { b[r][c] = null; b[r2][c2] = null; }
    if (o === 'flag') { g.over = true; g.winner = side; }
  }
  g.moves++;
  if (!g.over) { g.turn = 1 - side; if (!hasMove(b, g.turn)) { g.over = true; g.winner = side; last.stalemate = true; } }
  return { ok: true, last, winner: g.over ? g.winner : null };
}
/* Per-player view: coordinates rotated for player 1 so each player sees themselves at the bottom; enemy identities hidden until revealed. */
function view(g, pi) {
  const out = Array.from({ length: 10 }, () => Array(10).fill(null));
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) { const p = g.board[r][c]; if (!p) continue;
    const vr = pi ? 9 - r : r, vc = pi ? 9 - c : c, mine = p.side === pi, vis = mine || p.rev;
    out[vr][vc] = vis ? { k: p.k, s: mine ? 0 : 1, v: 1 } : { s: 1, v: 0 }; }
  return out;
}
const flipPt = (pi, r, c) => pi ? [9 - r, 9 - c] : [r, c];
const newGame = () => ({ board: newBoard(), turn: 0, moves: 0, over: false, winner: null });
module.exports = { RANKS, RATING, rankOf, nextRank, rankFloor, ratingChange, newRating, newGame, applyMove, view, flipPt, legal };
