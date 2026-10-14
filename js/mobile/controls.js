/* STATFORGE MobileControlManager.
   Decides, per level, which touch controls exist (so the joystick never covers a task that does not need movement),
   keeps layout variables for the responsive CSS (css/mobile.css), floats the joystick under the thumb, and widens
   the 3D field of view on narrow screens. It reuses the existing joy / tJump / doInteract / drop() code in main.js. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  /* which controls each mode needs: 'move' = joystick + jump (+ talk), 'sort' = big Qualitative/Quantitative buttons, 'none' = UI only */
  const RULES = { academy: 'move', l6: 'move', l2: 'sort', l1: 'none', l3: 'none', l4: 'none', l5: 'none', shop: 'none', menu: 'none', chars: 'none' };
  const MCM = window.MobileControlManager = { RULES, kind: () => (TOUCH ? (RULES[mode] || 'none') : 'none') };

  /* touch detection that also covers iPadOS "desktop" mode and emulators; a real mouse switches it off (main.js) */
  if (!TOUCH && matchMedia('(hover:none)').matches && navigator.maxTouchPoints > 0) { TOUCH = true; document.body.classList.add('touch'); }
  /* touch devices never take pointer lock (it freezes touch coordinates in some browsers); mouse-look on hybrids uses drag instead */
  const _rpl = HTMLCanvasElement.prototype.requestPointerLock;
  HTMLCanvasElement.prototype.requestPointerLock = function () { if (TOUCH) return; return _rpl && _rpl.apply(this, arguments); };
  const compact = () => matchMedia('(max-width:700px),(max-height:520px)').matches;

  /* ---- Level 2 touch classification buttons (use the existing drop() logic) ---- */
  const b = document.createElement('div'); b.id = 'l2b';
  b.innerHTML = '<div id="l2i"></div><div class="l2r"><button class="btn b" id="l2q">QUALITATIVE<small style="display:block;font-size:.62em;opacity:.8">words / labels</small></button><button class="btn" id="l2n">QUANTITATIVE<small style="display:block;font-size:.62em;opacity:.8">numbers / amounts</small></button></div>';
  document.body.appendChild(b);
  const sortTap = type => e => { e.preventDefault(); if (!(L2 && !L2.over && L2.i < 10 && mode === 'l2' && !dlg && !paused && !INS)) return; if (!L2.carry) L2.carry = L2.q[L2.i]; drop(type); };
  $('l2q').addEventListener('pointerdown', sortTap('ql')); $('l2n').addEventListener('pointerdown', sortTap('qn'));

  /* ---- floating joystick: the touch zone is the whole lower-left; the stick appears under the thumb ---- */
  const tc = $('tc'), jb = $('jb'), jk = $('jk'), zone = document.createElement('div'); zone.id = 'jz'; tc.insertBefore(zone, tc.firstChild);
  let zid = null, cx = 0, cy = 0;
  function setBase(x, y) { const R = jb.offsetWidth / 2, m = 8; x = Math.max(R + m, Math.min(innerWidth - R - m, x)); y = Math.max(R + m, Math.min(innerHeight - R - m, y)); jb.style.left = (x - R) + 'px'; jb.style.top = (y - R) + 'px'; jb.style.bottom = 'auto'; cx = x; cy = y; }
  function stick(e) { let dx = e.clientX - cx, dy = e.clientY - cy; const R = jb.offsetWidth / 2, l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; } joy.x = dx / R; joy.y = dy / R; if (Math.hypot(joy.x, joy.y) < .12) joy.x = joy.y = 0; joy.run = Math.hypot(joy.x, joy.y) > .88; jk.style.transform = `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))`; }
  function release(e) { if (e.pointerId !== zid) return; zid = null; joy.x = joy.y = 0; joy.run = false; jk.style.transform = 'translate(-50%,-50%)'; jb.style.left = jb.style.top = jb.style.bottom = ''; jb.classList.remove('hot'); }
  zone.addEventListener('pointerdown', e => { if (zid !== null) return; e.preventDefault(); zid = e.pointerId; try { zone.setPointerCapture(e.pointerId); } catch (x) {} setBase(e.clientX, e.clientY); jb.classList.add('hot'); stick(e); });
  zone.addEventListener('pointermove', e => { if (e.pointerId === zid) stick(e); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(v => zone.addEventListener(v, release));
  jb.style.pointerEvents = 'none';

  /* ---- the control manager (replaces main.js touchUI; called every frame, cheap when nothing changed) ---- */
  let last = '';
  window.touchUI = function () {
    const kind = MCM.kind(), idle = !paused && !dlg && !resOpen;
    const move = kind === 'move' && idle, sort = mode === 'l2' && idle && !INS && !!L2 && !L2.over, pause = TOUCH && mode !== 'menu' && mode !== 'chars';
    if (sort) { const it = L2.q[L2.i], t = it ? 'Item: ' + it[0] : 'All sorted!'; if ($('l2i').textContent !== t) $('l2i').textContent = t; }
    const key = [kind, move, move && !!near, sort, pause].join();
    if (key === last) return; last = key;
    document.body.dataset.ctl = TOUCH ? kind : 'none';
    tc.style.display = move ? 'block' : 'none'; $('bi').style.display = move && near ? 'flex' : 'none'; $('bp').style.display = pause ? 'flex' : 'none';
    b.style.display = sort ? 'flex' : 'none';
    if (!move) { joy.x = joy.y = 0; joy.run = false; tJump = false; zid = null; jb.style.left = jb.style.top = jb.style.bottom = ''; }
    hudH();
  };

  /* ---- layout variables for the CSS: height of the HUD so level panels start below it ---- */
  function hudH() { const hud = $('hud'); let h = 0; if (hud.classList.contains('on')) hud.querySelectorAll('#hl,#hm').forEach(e => { const r = e.getBoundingClientRect(); if (r.width > 2) h = Math.max(h, r.bottom); }); document.documentElement.style.setProperty('--hudh', Math.round(h) + 'px'); }
  setInterval(hudH, 400); addEventListener('resize', hudH); addEventListener('orientationchange', () => setTimeout(hudH, 250));

  /* ---- portrait hint: non-blocking banner, only for modes where landscape is clearly better ---- */
  const rot = $('rot'); rot.querySelector('.pn').innerHTML = '<span>↻ Rotate your device for better gameplay.</span> <button class="btn" id="rotX">OK</button>';
  $('rotX').onclick = () => document.body.classList.add('norot');
  setInterval(() => { const want = TOUCH && matchMedia('(orientation:portrait)').matches && (mode === 'l6' || mode === 'l2' || mode === 'academy'); const show = !!want && !document.body.classList.contains('norot'); if (show && !rot.classList.contains('show')) setTimeout(() => document.body.classList.add('norot'), 9000); rot.classList.toggle('show', show); }, 500);

  /* ---- field of view: keep the horizontal view useful in portrait / narrow windows (called from main.js camSet) ---- */
  window.fovFor = function (v) { const a = innerWidth / innerHeight; if (a >= 1.2) return v; const h = 2 * Math.atan(Math.tan(v / 2) * 1.2); return Math.min(1.75, 2 * Math.atan(Math.tan(h / 2) / a)); };
})();
