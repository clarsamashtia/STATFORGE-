/* Player registry + persistent profiles. Storage is a JSON file (DATA_FILE). It is fine for one server instance;
   on hosts with an ephemeral disk, mount a persistent volume or swap this module for a real database. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
let db = { profiles: {}, processed: {} };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) {}
let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => { try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); const t = FILE + '.tmp'; fs.writeFileSync(t, JSON.stringify(db)); fs.renameSync(t, FILE); } catch (e) { console.error('[db] save failed:', e.message); } }, 150);
}
function flush() { clearTimeout(timer); try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(db)); } catch (e) {} }
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
/* Trust-on-first-use identity: the browser keeps a random id + secret token; the server stores only the token hash. */
function auth(id, token, name) {
  if (typeof id !== 'string' || !/^[a-z0-9]{8,40}$/i.test(id) || typeof token !== 'string' || token.length < 16 || token.length > 80) return null;
  let p = db.profiles[id];
  if (!p) { p = db.profiles[id] = { id, th: hash(token), name: 'PLAYER', ch: 0, rating: 0, wins: 0, losses: 0, draws: 0, streak: 0, best: 0, created: Date.now(), history: [] }; }
  else if (p.th !== hash(token)) return null;
  if (name) p.name = String(name).replace(/[^\w \-.]/g, '').trim().slice(0, 14) || p.name;
  save(); return p;
}
const publicProfile = p => ({ id: p.id, name: p.name, rating: p.rating, wins: p.wins, losses: p.losses, draws: p.draws, matches: p.wins + p.losses + p.draws, streak: p.streak, best: p.best });
module.exports = { db, save, flush, auth, publicProfile };
