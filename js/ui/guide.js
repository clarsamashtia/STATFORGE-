/* STATFORGE guidance layer (additive; touches no game state).
   1) Academy: a compass arrow + distance that points at your next open trial gate.
   2) Level entry: a short "objective" strip that fades after a few seconds, with keyboard or touch wording.
   Reads only globals from main.js (mode, P, cam, PA, BUILT, S, tState, NM, dlg, paused, resOpen, TOUCH). */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const st = document.createElement('style');
  st.textContent = `
#gArrow{position:fixed;left:50%;top:calc(var(--hudh,64px) + 10px);transform:translateX(-50%);z-index:6;display:none;pointer-events:none;text-align:center;font:bold 14px/1.2 monospace;color:#ffd84a;text-shadow:0 2px 0 #000}
#gArrow .gi{width:46px;height:46px;margin:0 auto 2px;transition:transform .08s linear}
#gArrow .gi svg{width:100%;height:100%;filter:drop-shadow(0 2px 0 #000)}
#gArrow .gt{background:rgba(10,14,34,.85);border:3px solid #ffd84a;padding:3px 10px;white-space:nowrap}
#gObj{position:fixed;left:50%;top:calc(var(--hudh,64px) + 12px);transform:translateX(-50%);z-index:8;width:min(640px,92vw);display:none;pointer-events:none;background:rgba(10,14,34,.9);border:4px solid #6ff;padding:8px 14px;font:bold 15px/1.35 monospace;color:#fff;text-align:center;transition:opacity .6s}
#gObj b{color:#ffd84a}
@media(max-height:520px),(max-width:700px){#gObj{font-size:12px;padding:5px 9px}#gArrow .gi{width:34px;height:34px}#gArrow{font-size:11px}}`;
  document.head.appendChild(st);

  const arrow = document.createElement('div'); arrow.id = 'gArrow';
  arrow.innerHTML = '<div class="gi"><svg viewBox="0 0 24 24"><path d="M12 2 L21 20 L12 15 L3 20 Z" fill="#ffd84a" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg></div><div class="gt"></div>';
  document.body.appendChild(arrow);
  const obj = document.createElement('div'); obj.id = 'gObj'; document.body.appendChild(obj);
  const gi = arrow.querySelector('.gi'), gt = arrow.querySelector('.gt');

  /* what each trial actually asks for (checked against the win/lose code in main.js) */
  const act = () => (TOUCH ? 'Tap' : 'Press E');
  const OBJ = {
    1: () => '<b>GOAL:</b> capture the rival\'s <b>Data</b> flag before they take yours. Select a piece, then a highlighted square. Only Data Organization beats Data Interpretation.',
    4: () => '<b>GOAL:</b> solve each problem to climb. Correct answers lift your tower; when time runs out the <b>water rises</b>. Stay above it.',
    5: () => '<b>GOAL:</b> finish the 10 tasks (spreadsheet, calculator, mean/median/mode scenarios) before your rival and the clock.',
    6: () => `<b>GOAL:</b> run through the temple. At each gate pick the lane with the <b>correct answer</b> ${TOUCH ? '(drag the joystick left or right)' : '(A/D or arrow keys)'}. A wrong lane costs you seconds. Reach the exit first.`
  };

  /* ---- level-entry strip ---- */
  let lastMode = '', hideT = 0, fadeT = 0;
  function showObj(n) {
    const f = OBJ[n]; if (!f) return;
    clearTimeout(hideT); clearTimeout(fadeT);
    obj.innerHTML = f(); obj.style.opacity = 1; obj.style.display = 'block';
    fadeT = setTimeout(() => { obj.style.opacity = 0; }, 8000);
    hideT = setTimeout(() => { obj.style.display = 'none'; }, 8700);
  }
  const hideObj = () => { clearTimeout(hideT); clearTimeout(fadeT); obj.style.display = 'none'; };

  /* ---- academy compass ---- */
  /* Ma'am Olga first: the arrow points at her until her opening dialogue has been read to the end,
     then at the next open trial gate. (Saves from before this flag existed count as "read" once they have any progress.) */
  const olgaRead = () => !!S.olgaRead || (S.olgaRead === undefined && !!S.intro && (S.xp > 0 || Object.keys(S.done || {}).length > 0));
  function target() {
    if (!olgaRead()) return { n: 0, label: "MA'AM OLGA", x: 0, z: -9 };
    const n = BUILT.find(k => tState(k) === 'open' && !S.done[k]); if (!n) return null;
    const a = PA[n - 1]; return { n, label: 'TRIAL ' + n, x: 17 * Math.sin(a), z: -17 * Math.cos(a) };
  }
  function tick() {
    if (mode !== lastMode) {
      lastMode = mode; hideObj();
      const m = /^l([1-6])$/.exec(mode); if (m) showObj(+m[1]);
    }
    if (resOpen) hideObj();
    const ok = mode === 'academy' && !paused && !dlg && !resOpen;
    const t = ok && target();
    if (!t) { arrow.style.display = 'none'; return; }
    const dx = t.x - P.x, dz = t.z - P.z, dist = Math.hypot(dx, dz);
    if (dist < 4) { arrow.style.display = 'none'; return; }
    const s = Math.sin(cam.yaw), c = Math.cos(cam.yaw);
    const fwd = -s * dx - c * dz, right = c * dx - s * dz;   /* same axes the movement code uses */
    gi.style.transform = `rotate(${Math.atan2(right, fwd)}rad)`;
    gt.textContent = `${t.label} · ${Math.round(dist)} m`;
    arrow.style.display = 'block';
  }
  setInterval(tick, 80);
})();
