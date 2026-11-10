'use strict';
// ---------- Live, playable game engine ----------
// Coordinates are in yards in the "frame" of the team with the ball (offense / kicking team):
// x = 0..120 (own end line .. opponent end line; goal lines at 10 and 110), y = 0..53.33 (sideline to sideline).
const Live = (() => {
  const FW = 120, FH = 53.33, HASH = [23.58, 29.75];
  const ZOOM = { close: 34, normal: 46, far: 60 };
  let L, f, cfg, onDone, gameRef;
  let cv, ctx, W = 0, H = 0, DPR = 1, SC = 20;
  let state = 'idle', P = null, user = 0, ctrl = null;
  const cam = { x: 60, y: 26.67 };
  const keys = {};
  let pressed = {};
  const mouse = { x: 0, y: 0, wx: 0, wy: 0 };
  let aiming = false, banners = [], floats = [], meter = null, raf = 0, lastTs = 0, acc = 0;
  let simTimer = 0, postTimer = 0, pendingRes = null, presnapTimer = 0, kickPlan = null, prevState = null;
  let showHelp = true, hudCache = '', tickerLines = [];
  const el = id => document.getElementById(id);

  // ---------- helpers ----------
  const clampY = y => U.clamp(y, 1.2, FH - 1.2);
  const clampHash = y => U.clamp(y, HASH[0], HASH[1]);
  let frameTi = 0;
  const flip = () => frameTi !== user;
  const goalDir = e => (e.side === 'O' ? 1 : -1);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const eff = (e, a) => f.eff(e.p, a);
  const isUserEnt = e => e && e.ti === user;
  function w2s(x, y) { const sx = flip() ? FW - x : x; return [(sx - cam.x) * SC + W / 2, (y - cam.y) * SC + H / 2]; }
  function s2w(px, py) { let sx = (px - W / 2) / SC + cam.x; const sy = (py - H / 2) / SC + cam.y; if (flip()) sx = FW - sx; return [sx, sy]; }

  // ---------- lifecycle ----------
  function start(Lg, game, settings, done) {
    L = Lg; gameRef = game; cfg = Object.assign({}, DEFAULT_GAME_SETTINGS, settings); onDone = done;
    const injRate = { off: 0, low: 0.5, normal: 1, high: 1.8 }[cfg.injuries] ?? 1;
    const fatRate = { off: 0, normal: 1, high: 1.6 }[cfg.fatigue] ?? 1;
    f = new GameFlow(L, game.home, game.away, {
      quarterLen: +cfg.quarterLen, ot: cfg.ot, injuries: injRate > 0, injuryRate: injRate, fatigue: fatRate > 0, fatigueRate: fatRate,
      penalties: cfg.penalties, runoff: +cfg.runoff, playoff: !!game.playoff, subThreshold: +cfg.subThreshold, difficulty: cfg.difficulty,
      userTeam: L.userTeam
    });
    f.live = true;
    user = f.userTi;
    el('game').classList.remove('hidden');
    cv = el('field'); ctx = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    cv.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    cv.addEventListener('contextmenu', e => e.preventDefault());
    buildTouchUI();
    if (touchMode) {
      const de = document.documentElement;
      try { if (de.requestFullscreen && !document.fullscreenElement) de.requestFullscreen().catch(() => {}); } catch (e) { /* ignore */ }
    }
    banners = []; floats = []; tickerLines = []; P = null; state = 'idle'; hudCache = ''; frameTi = user;
    drawHelp();
    banner(`${f.teams[f.recvFirst].name} win the toss and will receive`, 'info');
    lastTs = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
    nextPlay();
  }

  function cleanup() {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    cv.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    for (const k in keys) keys[k] = false;
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); } catch (e) { /* ignore */ }
    el('game').classList.add('hidden');
    el('overlay').innerHTML = '';
    el('banner').innerHTML = '';
    state = 'idle';
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, touchMode ? 1.5 : 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * DPR; cv.height = H * DPR;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const zy = ZOOM[cfg.zoom] || 34;
    SC = Math.min(H / zy, W / (zy * 1.15));
  }

  // ---------- input ----------
  function onKey(e) {
    if (el('game').classList.contains('hidden')) return;
    const c = e.code;
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c)) e.preventDefault();
    if (!keys[c]) pressed[c] = true;
    keys[c] = true;
    if (c === 'Escape' || c === 'KeyP') togglePause();
    if (c === 'KeyH') { showHelp = !showHelp; drawHelp(); }
    if (c === 'Equal' || c === 'NumpadAdd') { cfg.zoom = cfg.zoom === 'far' ? 'normal' : 'close'; resize(); }
    if (c === 'Minus' || c === 'NumpadSubtract') { cfg.zoom = cfg.zoom === 'close' ? 'normal' : 'far'; resize(); }
    if (state === 'playcall' && /^Digit[1-9]$/.test(c)) {
      const btn = document.querySelectorAll('#overlay .play-card')[+c.slice(5) - 1];
      if (btn) btn.click();
    }
    if (state === 'playcall' && c === 'KeyT') { const b = document.getElementById('tmo-btn'); if (b && !b.disabled) b.click(); }
  }
  function onKeyUp(e) { keys[e.code] = false; }
  function onMove(e) {
    if (aiming && aimPid != null && e.pointerId !== aimPid) return;
    mouse.x = e.clientX; mouse.y = e.clientY;
    const [wx, wy] = s2w(mouse.x, mouse.y);
    mouse.wx = wx; mouse.wy = wy;
  }
  function onDown(e) {
    if (e.pointerType === 'touch') setTouch(true);
    e.preventDefault();
    if (aiming) return;
    onMove(e);
    if (state === 'live' && ctrl && P && P.type === 'scrim' && P.ball.state === 'held' && P.ball.carrier === ctrl && ctrl.role === 'qb' && ctrl.canThrow && !P.thrown) {
      aiming = true;
      aimPid = e.pointerId;
      return;
    }
    if (state === 'presnap' || state === 'live' || state === 'meter') {
      // click a teammate to control him
      let best = null, bd = 2.2;
      for (const en of P ? P.ents : []) {
        if (en.ti !== user) continue;
        const d = Math.hypot(en.x - mouse.wx, en.y - mouse.wy);
        if (d < bd) { bd = d; best = en; }
      }
      if (best) setCtrl(best);
    }
  }
  function onUp(e) {
    if (!aiming || (aimPid != null && e.pointerId !== aimPid)) return;
    onMove(e);
    aiming = false; aimPid = null;
    if (e.type === 'pointercancel') return;
    if (state === 'live' && ctrl && P.ball.carrier === ctrl && ctrl.canThrow && !P.thrown) {
      throwBall(ctrl, mouse.wx, mouse.wy, !!(keys.ShiftLeft || keys.ShiftRight || e.button === 2 || lobOn));
      lobOn = false;
    }
  }

  // ---------- touch controls (tablets) ----------
  let touchMode = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  let aimPid = null, lobOn = false, joyPid = null, touchCache = '';
  const TB = [['sp', 'Space'], ['e', 'KeyE'], ['q', 'KeyQ'], ['r', 'KeyR'], ['c', 'KeyC'], ['f', 'KeyF'], ['shift', 'ShiftLeft']];
  function setTouch(on) {
    if (touchMode === on) return;
    touchMode = on;
    el('game').classList.toggle('touch', on);
    drawHelp();
    touchCache = '';
  }
  function buildTouchUI() {
    let tu = el('touch-ui');
    if (!tu) {
      tu = document.createElement('div');
      tu.id = 'touch-ui';
      tu.innerHTML = `<div id="joy"><div id="joy-knob"></div></div>
        <div id="tbtns">
          <button class="tb big" id="tb-sp"></button>
          <button class="tb" id="tb-e"></button><button class="tb" id="tb-q"></button>
          <button class="tb" id="tb-r"></button><button class="tb" id="tb-c"></button>
          <button class="tb" id="tb-f"></button><button class="tb hold" id="tb-shift">SPRINT</button>
          <button class="tb" id="tb-lob">LOB</button><button class="tb" id="tb-tab">SWITCH</button>
        </div>
        <button class="tb small" id="tb-pause">❚❚</button>
        <div id="touch-hint"></div>`;
      el('game').appendChild(tu);
      for (const [id, code] of TB) {
        const b = el('tb-' + id);
        const down = ev => { ev.preventDefault(); setTouch(true); if (!keys[code]) pressed[code] = true; keys[code] = true; b.classList.add('on'); };
        const up = ev => { ev.preventDefault(); keys[code] = false; b.classList.remove('on'); };
        b.addEventListener('pointerdown', down);
        b.addEventListener('pointerup', up);
        b.addEventListener('pointercancel', up);
        b.addEventListener('pointerleave', up);
      }
      el('tb-lob').addEventListener('pointerdown', ev => { ev.preventDefault(); lobOn = !lobOn; touchCache = ''; });
      el('tb-tab').addEventListener('pointerdown', ev => { ev.preventDefault(); pressed.Tab = true; });
      el('tb-pause').addEventListener('pointerdown', ev => { ev.preventDefault(); togglePause(); });
      const joy = el('joy'), knob = el('joy-knob');
      const setJoy = ev => {
        const r = joy.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2;
        let dx = (ev.clientX - cx) / R, dy = (ev.clientY - cy) / R;
        const m = Math.hypot(dx, dy);
        if (m > 1) { dx /= m; dy /= m; }
        knob.style.transform = `translate(${dx * R * 0.6}px, ${dy * R * 0.6}px)`;
        const t = 0.35;
        keys.KeyA = dx < -t; keys.KeyD = dx > t; keys.KeyW = dy < -t; keys.KeyS = dy > t;
        if (keys.KeyW && !joy._w) pressed.KeyW = true;
        joy._w = keys.KeyW;
      };
      const endJoy = ev => {
        if (ev.pointerId !== joyPid) return;
        joyPid = null;
        keys.KeyA = keys.KeyD = keys.KeyW = keys.KeyS = false;
        knob.style.transform = '';
      };
      joy.addEventListener('pointerdown', ev => { ev.preventDefault(); setTouch(true); joyPid = ev.pointerId; joy.setPointerCapture(ev.pointerId); setJoy(ev); });
      joy.addEventListener('pointermove', ev => { if (ev.pointerId === joyPid) setJoy(ev); });
      joy.addEventListener('pointerup', endJoy);
      joy.addEventListener('pointercancel', endJoy);
    }
    el('game').classList.toggle('touch', touchMode);
    touchCache = '';
  }
  function touchCtx() {
    const show = ['presnap', 'live', 'meter', 'post'].includes(state);
    if (!show) return { hide: true };
    if (state === 'presnap') return { sp: P && P.type === 'scrim' && P.userOff ? 'SNAP' : P && P.type === 'scrim' ? 'READY' : '', tab: true, hint: 'Tap a teammate (or SWITCH) to control him' };
    if (state === 'meter') return { sp: 'KICK', hint: 'Tap KICK 3 times: start · power · accuracy. Stick up/down aims.' };
    if (state === 'post') return { sp: 'NEXT' };
    if (!ctrl || !P) return {};
    const carrier = P.ball.state === 'held' ? P.ball.carrier : null;
    if (carrier === ctrl) {
      if (ctrl.role === 'qb' && ctrl.canThrow && !P.thrown && !P.open && P.type === 'scrim')
        return { lob: true, sprint: true, tab: true, hint: 'Drag your finger on the field to aim · lift to throw' };
      return { sp: 'JUKE', e: 'SPIN', q: 'STIFF', r: 'TRUCK', c: 'DIVE', sprint: true, f: P.kickRet && ctrl.x >= 110 ? 'KNEEL' : '' };
    }
    const defending = carrier ? ctrl.ti !== carrier.ti : (P.type === 'scrim' ? ctrl.side === 'D' : ctrl.side === 'O');
    if (defending) return { sp: ctrl.eng ? 'SWIM' : 'DIVE', e: 'JUMP', sprint: true, tab: true };
    const kickAir = (P.type === 'kickoff' || P.type === 'punt') && P.ball.state === 'air' && P.kr && P.kr.ti === user;
    return { sp: !P.thrown && ['wr', 'te', 'rb'].includes(ctrl.role) && P.type === 'scrim' ? 'OPEN!' : '', e: 'JUMP', sprint: true, tab: true,
      f: kickAir ? (P.fairCatch ? 'RETURN' : 'FAIR') : '' };
  }
  function updateTouchUI() {
    const tu = el('touch-ui');
    if (!tu) return;
    if (!touchMode) { if (tu.style.display !== 'none') tu.style.display = 'none'; return; }
    const c = touchCtx();
    const sig = JSON.stringify(c) + lobOn;
    if (sig === touchCache) return;
    touchCache = sig;
    tu.style.display = c.hide ? 'none' : 'block';
    const set = (id, label) => { const b = el('tb-' + id); b.textContent = label || ''; b.style.display = label ? '' : 'none'; };
    set('sp', c.sp); set('e', c.e); set('q', c.q); set('r', c.r); set('c', c.c); set('f', c.f);
    set('shift', c.sprint ? 'SPRINT' : ''); set('tab', c.tab ? 'SWITCH' : ''); set('lob', c.lob ? (lobOn ? 'LOB ✓' : 'LOB') : '');
    el('tb-lob').classList.toggle('on', lobOn);
    el('touch-hint').textContent = c.hint || '';
    el('joy').style.visibility = state === 'post' ? 'hidden' : 'visible';
  }
  function inputVec() {
    let x = 0, y = 0;
    if (keys.KeyA || keys.ArrowLeft) x -= 1;
    if (keys.KeyD || keys.ArrowRight) x += 1;
    if (keys.KeyW || keys.ArrowUp) y -= 1;
    if (keys.KeyS || keys.ArrowDown) y += 1;
    if (flip()) x = -x;
    return { x, y };
  }
  const sprintKey = () => keys.ShiftLeft || keys.ShiftRight;

  function setCtrl(e) {
    if (ctrl === e) return;
    ctrl = e;
    if (e) { e.override = false; e.ctrlT = P ? P.t : 0; }
  }
  function cycleCtrl() {
    if (!P) return;
    const ref = P.ball && P.ball.state !== 'held' ? P.ball : (P.ball.carrier || P.ents[0]);
    const mine = P.ents.filter(e => e.ti === user && e !== ctrl).sort((a, b) => dist(a, ref) - dist(b, ref));
    if (mine.length) setCtrl(mine[0]);
  }

  // ---------- main loop ----------
  function loop(ts) {
    raf = requestAnimationFrame(loop);
    const dtReal = Math.min(0.05, (ts - lastTs) / 1000 || 0);
    lastTs = ts;
    if (state !== 'paused') {
      acc += dtReal * (+cfg.speed || 1);
      const STEP = 1 / 60;
      let n = 0;
      while (acc >= STEP && n < 6) { update(STEP); acc -= STEP; n++; }
      if (n >= 6) acc = 0;
    }
    render(dtReal);
  }

  function update(dt) {
    banners.forEach(b => b.t -= dt);
    floats.forEach(fl => { fl.t -= dt; fl.y -= dt * 1.2; });
    floats = floats.filter(fl => fl.t > 0);
    switch (state) {
      case 'presnap': updatePresnap(dt); break;
      case 'live': updateLive(dt); break;
      case 'post':
        postTimer -= dt;
        if (postTimer <= 0 || pressed.Space || pressed.Enter) commit();
        break;
      case 'meter': updateMeter(dt); break;
      case 'fgflight': updateFG(dt); break;
      case 'simdef':
        simTimer -= dt;
        if (simTimer <= 0) simDefStep();
        break;
    }
    pressed = {};
    updateBannerDom();
  }

  // ---------- flow control ----------
  function nextPlay() {
    aiming = false; meter = null;
    f.prepareNext();
    flushEvents();
    if (f.over) return gameOver();
    if (f.phase === 'kickoff') {
      const kt = f.kickTeam;
      if (cfg.playMode === 'offense' && kt === user) return startSimDef();
      if (kt === user) return showKickoffChoice();
      setupKickoff(AI.onside(f));
      kickPlan = aiKickParams(P.onside ? 'onside' : 'kickoff');
      presnapTimer = 1.3; state = 'presnap';
      return;
    }
    if (f.phase === 'pat') {
      if (f.poss === user) return showPatChoice();
      const c = AI.patCall(f);
      if (c === 'xp') return setupFG('xp', aiKickParams('xp'));
      if (cfg.playMode === 'offense') return startSimDef();
      f.ballOn = 98;
      banner(`${f.teams[f.poss].name} going for two!`, 'info');
      return showPlayCall();
    }
    if (f.poss !== user && cfg.playMode === 'offense') return startSimDef();
    const t = AI.timeout(f);
    if (t != null && t !== user) { f.callTimeout(t); flushEvents(); }
    showPlayCall();
  }

  function flushEvents() {
    for (const ev of f.events) banner(ev.text, ev.kind);
    f.events = [];
    const last = f.pbp.slice(-4).map(x => x.text);
    tickerLines = last;
    updateHUD(true);
  }

  function startSimDef() {
    state = 'simdef';
    simTimer = 0.4;
    P = null;
    el('overlay').innerHTML = `<div class="ov-panel small"><h3>${U.esc(f.teams[f.poss === user && f.phase !== 'kickoff' ? 1 - user : f.poss].name)} possession</h3>
      <p class="muted">Simulating the opponent's plays…</p><button class="btn" id="skipsim">Skip ahead</button></div>`;
    el('skipsim').onclick = () => { simTimer = 0; fastSim = true; };
  }
  let fastSim = false;
  function simDefStep() {
    Sim.step(f);
    flushEvents();
    if (f.over) { fastSim = false; return gameOver(); }
    f.prepareNext();
    flushEvents();
    if (f.over) { fastSim = false; return gameOver(); }
    const userTurn = (f.phase === 'play' && f.poss === user) || (f.phase === 'kickoff' && f.kickTeam !== user) || (f.phase === 'pat' && f.poss === user);
    if (userTurn) { fastSim = false; el('overlay').innerHTML = ''; nextPlay(); }
    else simTimer = fastSim ? 0.02 : 0.55;
  }

  function finishPlay(res, text, kind = 'info') {
    if (state === 'post') return;
    pendingRes = res;
    state = 'post';
    postTimer = 1.9;
    aiming = false;
    if (text) banner(text, kind);
  }

  function commit() {
    if (!pendingRes) return;
    const res = pendingRes;
    pendingRes = null;
    if (P && P.endY != null) f.ballY = clampHash(P.endY);
    f.apply(res);
    // the play result banner already announced scores/turnovers/first downs
    f.events = f.events.filter(e => !['score', 'turnover', 'bad', 'fd'].includes(e.kind));
    if (P && P.onField) f.afterPlay(P.onField, 0.9);
    flushEvents();
    nextPlay();
  }

  function gameOver() {
    state = 'over';
    P = null;
    const [a, b] = [f.teams[0], f.teams[1]];
    const lead = (k) => {
      let best = null, v = 0;
      for (const pid in f.box) if ((f.box[pid][k] || 0) > v) { v = f.box[pid][k]; best = L.players[pid]; }
      return best ? `${Data.name(best)} (${best.pos}, ${L.teams[best.teamId] ? L.teams[best.teamId].abbr : ''}) ${v}` : '—';
    };
    const won = f.score[user] > f.score[1 - user], tie = f.score[0] === f.score[1];
    el('overlay').innerHTML = `<div class="ov-panel">
      <h2>${tie ? 'Tie Game' : won ? 'Victory!' : 'Defeat'}</h2>
      <div class="final-score"><span style="color:${b.c2}">${b.abbr}</span> ${f.score[1]} — ${f.score[0]} <span style="color:${a.c2}">${a.abbr}</span>${f.q > 4 ? ' (OT)' : ''}</div>
      <table class="mini"><tr><th></th><th>${b.abbr}</th><th>${a.abbr}</th></tr>
      ${['yds', 'passYds', 'rushYds', 'firstDowns', 'turnovers', 'penalties'].map(k => `<tr><td>${{ yds: 'Total yards', passYds: 'Passing', rushYds: 'Rushing', firstDowns: 'First downs', turnovers: 'Turnovers', penalties: 'Penalties' }[k]}</td><td>${f.ts[1][k] || 0}</td><td>${f.ts[0][k] || 0}</td></tr>`).join('')}
      </table>
      <p>Passing: ${lead('passYds')} yds<br>Rushing: ${lead('rushYds')} yds<br>Receiving: ${lead('recYds')} yds<br>Tackles: ${lead('tackles')}</p>
      <button class="btn primary" id="go-done">Continue</button></div>`;
    el('go-done').onclick = () => { cleanup(); onDone(f); };
  }

  function togglePause() {
    if (state === 'over' || state === 'idle' || state === 'simdef') return;
    if (state === 'paused') { state = prevState; el('overlay').innerHTML = prevOverlay; rebindOverlay(); return; }
    prevState = state; prevOverlay = el('overlay').innerHTML; prevBind = state === 'playcall' ? overlayBinder : null;
    state = 'paused';
    el('overlay').innerHTML = `<div class="ov-panel small"><h2>Paused</h2>
      <button class="btn primary" id="p-res">Resume</button>
      <button class="btn" id="p-sim">Sim rest of game</button>
      <p class="muted small-txt">Esc / P to resume · H toggles controls</p></div>`;
    el('p-res').onclick = togglePause;
    el('p-sim').onclick = () => simToEnd();
  }
  let prevOverlay = '', overlayBinder = null, prevBind = null;
  function rebindOverlay() { if (prevBind) prevBind(); }

  function simToEnd() {
    if (pendingRes) { const r = pendingRes; pendingRes = null; f.apply(r); flushEvents(); }
    else if (state === 'live' && P) { /* abandon live play: no result */ }
    P = null;
    Sim.run(f);
    flushEvents();
    gameOver();
  }

  // ---------- play calling ----------
  function showPlayCall() {
    state = 'playcall';
    P = null;
    frameTi = f.poss;
    const off = f.poss === user;
    const fgDist = 117 - f.ballOn;
    const rng = AI.fgRange(f, user);
    const canTmo = f.timeouts[user] > 0 && f.pendingRunoff > 0 && f.phase === 'play';
    let cards = '';
    const list = off ? OFF_PLAYS.filter(p => !(f.phase === 'pat' && p.id === 'hail_mary')) : DEF_PLAYS;
    list.forEach((p, i) => {
      cards += `<button class="play-card ${off ? (p.type === 'run' ? 'run' : 'pass') : 'def'}" data-id="${p.id}">
        <span class="pc-key">${i < 9 ? i + 1 : ''}</span><b>${p.name}</b><small>${p.desc || ''}</small></button>`;
    });
    let special = '';
    if (off && f.phase === 'play') {
      special += `<button class="play-card special" data-id="punt"><b>Punt</b><small>Flip the field</small></button>`;
      special += `<button class="play-card special ${fgDist > rng + 4 ? 'dim' : ''}" data-id="fg"><b>Field Goal</b><small>${fgDist} yds (range ~${Math.round(rng)})</small></button>`;
      special += `<button class="play-card special" data-id="kneel"><b>QB Kneel</b><small>Burn the clock</small></button>`;
      if (f.pendingRunoff > 0) special += `<button class="play-card special" data-id="spike"><b>Spike</b><small>Stop the clock, lose a down</small></button>`;
    }
    const sit = f.phase === 'pat' ? 'Two-point conversion' : `${f.downStr()} · ${f.spotStr()}`;
    el('overlay').innerHTML = `<div class="playcall">
      <div class="pc-head"><div><h3>${off ? 'Call your play' : 'Call your defense'}</h3><span class="muted">${sit}${f.pendingRunoff > 0 && f.phase === 'play' ? ' · clock running' : ''}</span></div>
      <div class="pc-actions">
        <button class="btn" id="tmo-btn" ${canTmo ? '' : 'disabled'}>Timeout (${f.timeouts[user]}) [T]</button>
        <button class="btn" id="simdrive-btn">Sim this play</button>
        <button class="btn" id="simend-btn">Sim to end</button>
      </div></div>
      <div class="pc-grid">${cards}</div>${special ? `<div class="pc-grid special-row">${special}</div>` : ''}</div>`;
    const bind = () => {
      armedId = null;
      document.querySelectorAll('#overlay .play-card').forEach(b => {
        b.onclick = () => {
          // on tablets: first tap previews the play, second tap calls it
          const isPlay = !b.classList.contains('special');
          if (touchMode && isPlay && armedId !== b.dataset.id) {
            armedId = b.dataset.id;
            document.querySelectorAll('#overlay .play-card').forEach(x => x.classList.toggle('armed', x === b));
            previewPlay(b.dataset.id);
            return;
          }
          choosePlay(b.dataset.id);
        };
        b.addEventListener('pointerdown', ev => { if (ev.pointerType === 'touch') setTouch(true); });
        b.onmouseenter = () => previewPlay(b.dataset.id);
        b.onfocus = () => previewPlay(b.dataset.id);
      });
      const tb = el('tmo-btn'); if (tb) tb.onclick = () => { if (f.callTimeout(user)) { flushEvents(); showPlayCall(); } };
      const sd = el('simdrive-btn'); if (sd) sd.onclick = () => simOnePlay();
      const se = el('simend-btn'); if (se) se.onclick = () => simToEnd();
    };
    overlayBinder = bind;
    bind();
    previewPlay(list[0].id);
    updateHUD(true);
  }

  // Show the hovered play's alignment and assignments on the field behind the menu
  function previewPlay(id) {
    if (state !== 'playcall') return;
    const off = f.poss === user;
    let op, dp;
    if (off) {
      op = PLAY_BY_ID[id];
      if (!op || (op.type !== 'run' && op.type !== 'pass')) return;
      dp = DEF_BY_ID.cover3;
    } else {
      dp = DEF_BY_ID[id];
      if (!dp) return;
      op = PLAY_BY_ID.curl_flat;
    }
    setupScrim(op, dp);
    P.preview = true;
    P.previewName = off ? op.name : dp.name;
    state = 'playcall';
  }

  let armedId = null;

  function simOnePlay() {
    el('overlay').innerHTML = '';
    Sim.step(f);
    flushEvents();
    nextPlay();
  }

  function choosePlay(id) {
    el('overlay').innerHTML = '';
    if (f.phase === 'play' && f.beforeSnap()) { flushEvents(); return nextPlay(); }
    flushEvents();
    const off = f.poss === user;
    if (off) {
      const op = PLAY_BY_ID[id];
      if (op.type === 'fg') return setupFG('fg', null);
      if (op.type === 'punt') return setupPunt(true);
      if (op.type === 'kneel' || op.type === 'spike') { const r = Sim.resolve(f, op, DEF_PLAYS[0]); P = null; return finishPlay(r, r.desc); }
      setupScrim(op, AI.defCall(f, op));
      state = 'presnap';
    } else {
      const dp = DEF_BY_ID[id];
      const op = f.phase === 'pat' ? AI.pickPlay(f, false) : AI.offCall(f);
      if (op.type === 'punt') return setupPunt(false);
      if (op.type === 'fg') return setupFG('fg', aiKickParams('fg'));
      if (op.type === 'kneel' || op.type === 'spike') { const r = Sim.resolve(f, op, dp); P = null; return finishPlay(r, r.desc); }
      setupScrim(op.id === 'hail_mary' && f.phase === 'pat' ? PLAY_BY_ID.slants : op, dp);
      state = 'presnap';
      presnapTimer = 1.6;
    }
  }

  function showPatChoice() {
    state = 'playcall';
    P = null;
    el('overlay').innerHTML = `<div class="ov-panel small"><h3>Touchdown! Conversion attempt</h3>
      <button class="btn primary" id="pat-xp">Kick extra point</button>
      <button class="btn" id="pat-2">Go for two</button></div>`;
    const bind = () => {
      el('pat-xp').onclick = () => { el('overlay').innerHTML = ''; setupFG('xp', null); };
      el('pat-2').onclick = () => { el('overlay').innerHTML = ''; f.ballOn = 98; showPlayCall(); };
    };
    overlayBinder = bind; bind();
  }

  function showKickoffChoice() {
    state = 'playcall';
    P = null;
    el('overlay').innerHTML = `<div class="ov-panel small"><h3>Kickoff</h3>
      <button class="btn primary" id="ko-n">Deep kickoff</button>
      <button class="btn" id="ko-o">Onside kick</button>
      <button class="btn" id="ko-s">Sim kickoff</button></div>`;
    const bind = () => {
      el('ko-n').onclick = () => { el('overlay').innerHTML = ''; setupKickoff(false); startMeter('kickoff', launchKick); };
      el('ko-o').onclick = () => { el('overlay').innerHTML = ''; setupKickoff(true); startMeter('onside', launchKick); };
      el('ko-s').onclick = () => { el('overlay').innerHTML = ''; Sim.step(f); flushEvents(); nextPlay(); };
    };
    overlayBinder = bind; bind();
  }

  // ---------- entities ----------
  function roleOf(slot) {
    if (slot === 'QB') return 'qb';
    if (slot === 'RB') return 'rb';
    if (slot.startsWith('WR')) return 'wr';
    if (slot === 'TE') return 'te';
    if (OL_SLOTS.includes(slot)) return 'ol';
    if (slot.startsWith('DE') || slot.startsWith('DT')) return 'dl';
    if (slot.startsWith('LB')) return 'lb';
    if (slot.startsWith('CB')) return 'cb';
    if (slot === 'FS' || slot === 'SS') return 's';
    return slot;
  }
  function newPlay(type, frameTi_, los, by) {
    frameTi = frameTi_;
    return { type, frameTi: frameTi_, los, by, t: 0, elapsed: 0, ents: [], ball: null, thrown: false, handed: false, open: false, openT: 0,
      onField: [], ended: false, kicked: false };
  }
  function addEnt(p, ti, side, slot, x, y) {
    if (!p) return null;
    const e = { p, ti, side, slot, role: roleOf(slot), x, y, vx: 0, vy: 0, eng: null, shed: 0, stun: 0, down: 0, tkCd: 0, blockCd: 0,
      assign: { type: 'none' }, route: null, ri: 0, sit: false, override: false, move: null, moveCd: 0, dive: 0, jump: 0, chase: false,
      react: 0.12 + (1 - p.attrs.awareness / 99) * 0.45, tgx: x, tgy: y, homeX: x, homeY: y, laneY: y, canThrow: false, sprint: false };
    P.ents.push(e);
    P.onField.push(p);
    return e;
  }
  const O = s => P.ents.find(e => e.side === 'O' && e.slot === s);
  const D = s => P.ents.find(e => e.side === 'D' && e.slot === s);

  function setupScrim(op, dp) {
    const o = f.poss, d = 1 - o;
    const los = 10 + f.ballOn, by = clampHash(f.ballY);
    P = newPlay('scrim', o, los, by);
    P.play = op; P.dplay = dp;
    P.fdX = 10 + Math.min(100, f.ballOn + f.toGo);
    P.twoPt = f.phase === 'pat';
    const Lo = f.lineup(o, 'off'), Ld = f.lineup(d, dp.pers);
    const form = FORMS[op.form || 'shotgun'];
    for (const s in Lo) { const [dx, dy] = form[s] || [-1, 0]; addEnt(Lo[s], o, 'O', s, los + dx, clampY(by + dy)); }
    for (const s in Ld) { const [x, y] = defAlign(s, dp, los, by); addEnt(Ld[s], d, 'D', s, x, clampY(y)); }
    P.qb = O('QB') || P.ents.find(e => e.side === 'O');
    assignOffense(op);
    assignDefense(dp);
    P.ball = { state: 'held', carrier: P.qb, x: P.qb.x, y: P.qb.y, z: 1 };
    P.qb.canThrow = op.type === 'pass';
    // choose controlled player
    if (o === user) setCtrl(op.type === 'run' && op.run !== 'sneak' && cfg.autoSwitch ? P.qb : P.qb);
    else setCtrl(D(P.lastDef || 'LB1') || D('LB2') || P.ents.find(e => e.side === 'D'));
    P.userOff = o === user;
    snapCam();
  }

  function defAlign(s, dp, los, by) {
    const goal = dp.id === 'goal', prev = dp.cov === 'prevent';
    const cbX = goal ? 3 : prev ? 10 : 6;
    const wy = sl => { const e = O(sl); return e ? e.y : by; };
    switch (s) {
      case 'DE1': return [los + 1.2, by - 5.6];
      case 'DT1': return [los + 1.1, by - 1.9];
      case 'DT2': return [los + 1.1, by + 1.9];
      case 'DE2': return [los + 1.2, by + 5.6];
      case 'LB1': return dp.pers === 'base' ? [los + 4.5, by - 4.5] : [los + 5, by - 3];
      case 'LB2': return dp.pers === 'base' ? [los + 4.5, by] : [los + 5, by + 3];
      case 'LB3': return [los + 4.5, by + 4.5];
      case 'CB1': return [los + cbX, wy('WR1')];
      case 'CB2': return [los + cbX, wy('WR2')];
      case 'CB3': return [los + cbX - 1, wy('WR3')];
      case 'FS': return [los + (prev ? 24 : goal ? 6 : 13), by - 7];
      case 'SS': return [los + (prev ? 22 : goal ? 5 : 11), by + 7];
    }
    return [los + 5, by];
  }

  function buildRoute(e, wps) {
    const sign = e.y < P.by ? -1 : 1;
    return wps.map(([fx, oy, sit]) => ({ x: e.x + fx, y: clampY(e.y + oy * sign), sit: !!sit }));
  }

  function assignOffense(op) {
    const los = P.los, by = P.by;
    for (const e of P.ents.filter(x => x.side === 'O')) {
      if (e.role === 'ol') e.assign = { type: op.type === 'run' ? 'runblock' : 'passpro' };
      else if (e.role === 'qb') e.assign = { type: 'qb' };
      else if (op.type === 'pass') {
        const rn = (op.routes || {})[e.slot] || 'block';
        if (rn === 'block') e.assign = { type: 'passpro' };
        else { e.assign = { type: 'route' }; e.route = buildRoute(e, ROUTES[rn]); }
      } else {
        if (e.role === 'wr') e.assign = { type: 'stalk' };
        else if (e.role === 'te') e.assign = { type: 'runblock' };
        else if (e.role === 'rb') e.assign = { type: 'runner' };
      }
    }
    const qb = P.qb;
    // QB drop / mesh
    if (op.type === 'pass') {
      P.dropX = op.form === 'shotgun' ? los - 6.8 : los - 7.2;
      P.mesh = { x: los - 3.2, y: by + 0.8 };
      P.readStart = { short: 0.85, mid: 1.3, deep: 1.85, screen: 1.15, hail: 2.4 }[op.depth] + (op.pa ? 0.5 : 0);
      if (op.pa) { const rb = O('RB'); if (rb) { rb.assign = { type: 'pafake' }; } }
    } else {
      const rb = O('RB');
      const side = U.chance(0.5) ? 1 : -1;
      P.runSide = side;
      if (op.run === 'sneak') { P.mesh = null; }
      else if (op.run === 'inside') {
        const gap = U.pick([-3.2, -1.1, 1.1, 3.2]);
        P.mesh = { x: los - 3.2, y: by + 0.7 };
        if (rb) rb.path = [{ x: los - 3.3, y: by + 0.7 }, { x: los + 1.5, y: by + gap }, { x: los + 6, y: by + gap * 1.3 }];
      } else if (op.run === 'outside') {
        P.mesh = { x: qb.x - 0.5, y: by };
        if (rb) rb.path = [{ x: los - 4.5, y: by + side * 3 }, { x: los - 2.5, y: by + side * 10.5 }, { x: los + 3, y: by + side * 14 }];
      } else {
        P.mesh = { x: qb.x, y: qb.y };
        const gap = U.pick([-2.2, 0, 2.2]);
        if (rb) rb.path = [{ x: qb.x + 0.6, y: qb.y + 0.6 }, { x: los + 1.2, y: by + gap }, { x: los + 6, y: by + gap }];
      }
      if (rb) rb.pi = 0;
    }
  }

  function assignDefense(dp) {
    const los = P.los, by = P.by;
    const zone = (ax, ay, r = 9, deep = false) => ({ type: 'zone', ax, ay: clampY(ay), r, deep });
    const man = sl => ({ type: 'man', tgt: O(sl) });
    const set = (s, a) => { const e = D(s); if (e) e.assign = a; };
    ['DE1', 'DT1', 'DT2', 'DE2'].forEach(s => set(s, { type: 'rush' }));
    const wr3y = (O('WR3') || { y: by - 10 }).y;
    if (dp.cov === 'man' || dp.cov === 'man0') {
      if (dp.pers === 'base') {
        set('CB1', man('WR1')); set('CB2', man('WR2')); set('SS', man('WR3')); set('LB2', man('TE')); set('LB3', man('RB'));
        set('LB1', zone(los + 5, by, 7)); set('FS', zone(los + 16, 26.67, 20, true));
      } else {
        set('CB1', man('WR1')); set('CB2', man('WR2')); set('CB3', man('WR3')); set('SS', man('TE'));
        if (dp.cov === 'man0') { set('LB1', { type: 'rush' }); set('LB2', { type: 'rush' }); set('FS', man('RB')); }
        else { set('LB1', man('RB')); set('LB2', zone(los + 6, by, 8)); set('FS', zone(los + 16, 26.67, 20, true)); }
      }
    } else if (dp.cov === 'zone3') {
      set('CB1', zone(los + 16, 9, 14, true)); set('CB2', zone(los + 16, FH - 9, 14, true)); set('FS', zone(los + 18, 26.67, 14, true));
      set('SS', zone(los + 7, by + 12, 9)); set('CB3', zone(los + 7, wr3y < by ? by - 12 : by + 12, 9));
      set('LB1', zone(los + 7, by - 4, 8)); set('LB2', zone(los + 7, by + 4, 8));
    } else if (dp.cov === 'zone2') {
      set('CB1', zone(los + 5, by - 15, 9)); set('CB2', zone(los + 5, by + 15, 9));
      set('FS', zone(los + 17, 13.3, 16, true)); set('SS', zone(los + 17, 40, 16, true));
      set('LB1', zone(los + 7, by - 5, 8)); set('LB2', zone(los + 7, by + 5, 8)); set('CB3', zone(los + 10, by, 9));
    } else if (dp.cov === 'prevent') {
      set('CB1', zone(los + 18, 9, 14, true)); set('CB2', zone(los + 18, FH - 9, 14, true));
      set('FS', zone(los + 26, 18, 16, true)); set('SS', zone(los + 26, 35, 16, true)); set('CB3', zone(los + 14, by, 12));
      set('LB1', zone(los + 9, by - 7, 10)); set('LB2', zone(los + 9, by + 7, 10)); set('DE2', zone(los + 6, by, 8));
    }
    // OL protection assignments
    const rushers = P.ents.filter(e => e.side === 'D' && e.assign.type === 'rush');
    const blockers = P.ents.filter(e => e.side === 'O' && (e.assign.type === 'passpro' || e.assign.type === 'runblock')).sort((a, b) => a.y - b.y);
    const taken = new Set();
    for (const b of blockers) {
      const pool = (P.play.type === 'run' ? P.ents.filter(e => e.side === 'D' && (e.role === 'dl' || e.role === 'lb')) : rushers);
      let best = null, bd = 1e9;
      for (const r of pool) { if (taken.has(r)) continue; const dd = Math.abs(r.y - b.y) + Math.abs(r.x - b.x) * 0.5; if (dd < bd) { bd = dd; best = r; } }
      if (best && bd < 9) { b.bt = best; taken.add(best); }
    }
  }

  // ---------- kick setups ----------
  function setupKickoff(onside) {
    const k = f.kickTeam, r = 1 - k;
    const los = 10 + f.ballOn;
    P = newPlay('kickoff', k, los, 26.67);
    P.onside = onside;
    const K = f.getK(k);
    P.kicker = addEnt(K, k, 'O', 'K', los - 1.5, 26.67);
    P.kicker.role = 'k';
    const cov = f.stUnit(k, 'cover', new Set([K.id]));
    const ys = [4, 9, 14, 19, 23, 30, 34, 39, 44, 49];
    cov.forEach((p, i) => { const e = addEnt(p, k, 'O', 'COV' + i, los - 1, ys[i]); e.role = 'cov'; e.laneY = ys[i]; });
    const KR = f.getKR(r);
    P.kr = addEnt(KR, r, 'D', 'KR', onside ? los + 25 : los + 66, 26.67);
    P.kr.role = 'kr';
    const blk = f.stUnit(r, 'block', new Set([KR.id]));
    blk.forEach((p, i) => {
      const row = i < 5 ? 0 : 1;
      const x = onside ? los + 11 + row * 4 : los + (row ? 26 : 12);
      const y = row ? 10 + (i - 5) * 8.3 : 6 + i * 10.3;
      const e = addEnt(p, r, 'D', 'BLK' + i, x, y);
      e.role = 'kblk'; e.laneY = y; e.row = row; e.assign = { type: 'kblk' };
    });
    P.ball = { state: 'held', carrier: P.kicker, x: los, y: 26.67, z: 0.3, tee: true };
    if (k === user) setCtrl(P.ents.find(e => e.slot === 'COV4') || P.kicker);
    else setCtrl(P.kr);
    snapCam();
  }

  function setupPunt(userPunting) {
    const o = f.poss, d = 1 - o;
    const los = 10 + f.ballOn, by = clampHash(f.ballY);
    P = newPlay('punt', o, los, by);
    const Pp = f.getP(o);
    P.punter = addEnt(Pp, o, 'O', 'P', los - 14, by); P.punter.role = 'p';
    const unit = f.stUnit(o, 'cover', new Set([Pp.id]));
    const line = [-6, -4, -2, 0, 2, 4, 6];
    unit.forEach((p, i) => {
      let e;
      if (i < 7) { e = addEnt(p, o, 'O', 'PL' + i, los - 0.8, clampY(by + line[i])); e.assign = { type: 'passpro' }; e.role = 'pl'; }
      else if (i < 9) { const y = i === 7 ? 4 : FH - 4; e = addEnt(p, o, 'O', 'GUN' + i, los - 0.8, y); e.role = 'gun'; e.laneY = y; }
      else { e = addEnt(p, o, 'O', 'PP', los - 6, by); e.assign = { type: 'passpro' }; e.role = 'pl'; }
    });
    const PR = f.getKR(d);
    const est = 40 + (Pp.attrs.kickPow - 60) * 0.25;
    P.kr = addEnt(PR, d, 'D', 'KR', Math.min(los + est, 118), by); P.kr.role = 'kr';
    const ru = f.stUnit(d, 'block', new Set([PR.id]));
    ru.forEach((p, i) => {
      let e;
      if (i < 6) { e = addEnt(p, d, 'D', 'R' + i, los + 1, clampY(by - 5 + i * 2)); e.role = 'rush'; e.assign = { type: 'rush' }; }
      else if (i < 8) { const y = i === 6 ? 5 : FH - 5; e = addEnt(p, d, 'D', 'J' + i, los + 1.5, y); e.role = 'jam'; e.laneY = y; }
      else { e = addEnt(p, d, 'D', 'M' + i, los + 18 + (i - 8) * 8, by + (i === 8 ? -8 : 8)); e.role = 'kblk'; e.laneY = e.y; e.row = 1; }
      e.assign = e.assign.type === 'none' ? { type: 'kblk' } : e.assign;
    });
    // punt protection assignments
    const rushers = P.ents.filter(e => e.role === 'rush');
    P.ents.filter(e => e.role === 'pl').forEach((b, i) => { b.bt = rushers[i % rushers.length]; });
    P.ball = { state: 'held', carrier: P.punter, x: P.punter.x, y: P.punter.y, z: 1 };
    P.kickAt = 0.9;
    if (o === user) { setCtrl(P.ents.find(e => e.role === 'gun') || P.punter); }
    else setCtrl(P.kr);
    snapCam();
    if (userPunting) startMeter('punt', params => { kickPlan = params; state = 'live'; });
    else { kickPlan = aiKickParams('punt'); presnapTimer = 1.2; state = 'presnap'; }
  }

  function setupFG(kind, params) {
    const o = f.poss;
    const los = 10 + f.ballOn, by = kind === 'xp' ? 26.67 : clampHash(f.ballY);
    P = newPlay('fg', o, los, by);
    P.kind = kind;
    const Lo = f.lineup(o, 'off'), Ld = f.lineup(1 - o, 'base');
    OL_SLOTS.forEach((s, i) => addEnt(Lo[s], o, 'O', s, los - 0.8, by - 4.2 + i * 2.1));
    if (Lo.TE) addEnt(Lo.TE, o, 'O', 'TE', los - 1, by + 6.3);
    const K = f.getK(o);
    P.kicker = addEnt(K, o, 'O', 'K', los - 9, by - 1.2); P.kicker.role = 'k';
    ['DE1', 'DT1', 'DT2', 'DE2', 'LB1', 'LB2', 'LB3'].forEach((s, i) => Ld[s] && addEnt(Ld[s], 1 - o, 'D', s, los + 1.1, by - 6 + i * 2));
    P.ball = { state: 'held', carrier: null, x: los - 7, y: by, z: 0.2 };
    P.spotX = los - 7;
    setCtrl(null);
    snapCam();
    if (params) { kickPlan = params; presnapTimer = 1.0; state = 'presnap'; }
    else startMeter(kind, launchFG);
  }

  function aiKickParams(kind) {
    const ti = kind === 'kickoff' || kind === 'onside' ? f.kickTeam : f.poss;
    const k = kind === 'punt' ? f.getP(ti) : f.getK(ti);
    const accN = U.gauss() * 0.27 * (1.35 - f.eff(k, 'kickAcc') / 99);
    if (kind === 'fg' || kind === 'xp') {
      const dist = kind === 'xp' ? 33 : 117 - f.ballOn;
      const range = 40 + f.eff(k, 'kickPow') * 0.24;
      return { power: U.clamp(dist / range * 1.0 + 0.05 + U.gauss() * 0.03, 0.3, 0.93), acc: accN, aim: 0 };
    }
    if (kind === 'punt') return { power: U.clamp(0.86 + U.rf(-0.06, 0.08), 0.5, 0.97), acc: accN, aim: 0 };
    if (kind === 'onside') return { power: U.rf(0.25, 0.6), acc: accN * 0.5, aim: U.pick([-0.45, 0.45]) };
    return { power: U.clamp(0.88 + U.rf(-0.08, 0.1), 0.6, 1), acc: accN, aim: 0 };
  }

  // ---------- kick meter ----------
  function startMeter(kind, cb) {
    const ti = kind === 'kickoff' || kind === 'onside' ? f.kickTeam : f.poss;
    const k = kind === 'punt' ? f.getP(ti) : f.getK(ti);
    meter = { kind, phase: 0, power: 0, dir: 1, acc: -1, aim: 0, cb, speed: 1.0 + (1 - f.eff(k, 'kickAcc') / 99) * 1.4, t: 0 };
    state = 'meter';
  }
  function updateMeter(dt) {
    const m = meter;
    if (!m) return;
    const aimMax = m.kind === 'fg' || m.kind === 'xp' ? 0.1 : 0.4;
    if (m.phase === 0) {
      const iv = inputVec();
      m.aim = U.clamp(m.aim + (keys.KeyW || keys.ArrowUp ? -1 : keys.KeyS || keys.ArrowDown ? 1 : 0) * dt * 0.5, -aimMax, aimMax);
      if (iv.x) { /* left/right not used for aim */ }
      if (pressed.Space) m.phase = 1;
    } else if (m.phase === 1) {
      m.power += m.dir * dt * 1.15;
      if (m.power >= 1) { m.power = 1; m.dir = -1; }
      if (m.power <= 0 && m.dir < 0) { m.power = 0; m.dir = 1; }
      if (pressed.Space) { m.phase = 2; m.acc = -1; }
    } else if (m.phase === 2) {
      m.acc += dt * m.speed * 1.6;
      if (pressed.Space || m.acc >= 1) {
        m.acc = U.clamp(m.acc, -1, 1);
        // the sweet spot is the centre (acc 0); overpowering adds hook
        let accOut = m.acc;
        if (m.power > 0.93) accOut += U.gauss() * (m.power - 0.93) * 5;
        meter = null;
        m.cb({ power: m.power, acc: accOut, aim: m.aim });
      }
    }
  }

  function launchKick(params) {
    const K = P.kicker;
    const kp = eff(K, 'kickPow');
    let distK, T, h;
    if (P.onside) { distK = 10.5 + params.power * 5; T = 1.05; h = 1.2; }
    else { distK = 40 + params.power * (30 + kp * 0.08); T = 3.4 + params.power * 0.9; h = distK * 0.32; }
    const ang = params.aim + params.acc * 10 * Math.PI / 180;
    const sx = P.ball.x, sy = P.ball.y;
    const tx = sx + Math.cos(ang) * distK, ty = sy + Math.sin(ang) * distK;
    P.ball = { state: 'air', kind: 'kick', sx, sy, tx, ty, x: sx, y: sy, z: 0, t: 0, T, h };
    P.kicked = true;
    P.kickLand = { x: tx, y: ty };
    f.mark(K.p);
    state = 'live';
  }

  function launchPunt() {
    const Pp = P.punter;
    const params = kickPlan || aiKickParams('punt');
    const kp = eff(Pp, 'kickPow');
    const distK = 28 + params.power * (18 + kp * 0.22);
    const ang = params.aim + params.acc * 12 * Math.PI / 180;
    const sx = Pp.x, sy = Pp.y;
    let tx = sx + Math.cos(ang) * distK, ty = sy + Math.sin(ang) * distK;
    const T = 3.0 + params.power * 1.4;
    P.ball = { state: 'air', kind: 'kick', sx, sy, tx, ty, x: sx, y: sy, z: 1, t: 0, T, h: distK * 0.45 };
    P.kicked = true;
    P.kickLand = { x: tx, y: ty };
    f.st(Pp.p, 'punts');
  }

  function launchFG(params) {
    const K = P.kicker;
    const kind = P.kind;
    const distK = kind === 'xp' ? 33 : 117 - f.ballOn;
    const range = 40 + eff(K, 'kickPow') * 0.24;
    const kd = params.power * range * 1.04;
    const maxDeg = 7 * (1.25 - eff(K, 'kickAcc') / 99 * 0.55);
    const sx = P.spotX, sy = P.by;
    const base = Math.atan2(26.67 - sy, 120 - sx);
    const err = params.aim + params.acc * maxDeg * Math.PI / 180;
    const lateral = distK * Math.tan(err);
    const blocked = Math.random() < 0.012;
    const good = !blocked && kd >= distK && Math.abs(lateral) <= 3.05;
    const flyDist = blocked ? 4 : Math.min(kd, distK + 8);
    const tx = sx + Math.cos(base + err) * flyDist, ty = sy + Math.sin(base + err) * flyDist;
    P.ball = { state: 'air', kind: 'fg', sx, sy, tx, ty, x: sx, y: sy, z: 0, t: 0, T: blocked ? 0.35 : 1.25, h: blocked ? 1 : 9 };
    P.fgRes = { good, blocked, dist: distK, short: kd < distK, lateral };
    state = 'fgflight';
  }

  function updateFG(dt) {
    const b = P.ball;
    b.t += dt;
    const s = Math.min(1, b.t / b.T);
    b.x = U.lerp(b.sx, b.tx, s); b.y = U.lerp(b.sy, b.ty, s); b.z = 4 * b.h * s * (1 - s) + s * (P.fgRes.blocked ? 0 : 3);
    if (s >= 1) {
      const r = P.fgRes, K = P.kicker.p;
      let res, txt;
      if (P.kind === 'xp') {
        f.st(K, 'xpa'); if (r.good) f.st(K, 'xpm');
        res = { kind: 'xp', good: r.good, desc: `${Data.name(K)} extra point ${r.good ? 'good' : 'NO GOOD'}.` };
        txt = r.good ? 'Extra point is GOOD' : r.blocked ? 'BLOCKED!' : 'Extra point NO GOOD';
      } else {
        f.st(K, 'fga'); if (r.good) { f.st(K, 'fgm'); f.st(K, 'fgLong', r.dist); }
        res = { kind: 'fg', good: r.good, blocked: r.blocked, dist: r.dist, time: 4, desc: `${Data.name(K)} ${r.dist}-yd field goal ${r.good ? 'is GOOD' : r.blocked ? 'BLOCKED' : 'is NO GOOD'}.` };
        txt = r.good ? `GOOD from ${r.dist}!` : r.blocked ? 'BLOCKED!' : r.short ? 'Short — no good' : `Wide ${r.lateral < 0 ? 'left' : 'right'} — no good`;
      }
      P.onField = [];
      finishPlay(res, txt, r.good ? 'score' : 'bad');
      postTimer = 1.2;
    }
  }

  // ---------- snap & live update ----------
  function updatePresnap(dt) {
    if (pressed.Tab) cycleCtrl();
    if (P.type === 'scrim') {
      if (P.userOff) { if (pressed.Space) snap(); }
      else { presnapTimer -= dt; if (pressed.Space || presnapTimer <= 0) snap(); }
    } else if (P.type === 'kickoff') {
      presnapTimer -= dt;
      if (presnapTimer <= 0) launchKick(kickPlan);
    } else if (P.type === 'punt') {
      presnapTimer -= dt;
      if (presnapTimer <= 0) state = 'live';
    } else if (P.type === 'fg') {
      presnapTimer -= dt;
      if (presnapTimer <= 0) launchFG(kickPlan);
    }
  }

  function snap() {
    // pre-snap penalties
    if (f.o.penalties && !P.twoPt) {
      const r = Math.random();
      if (r < 0.012) { P.onField = []; return finishPlay({ kind: 'scrim', penalty: { on: 'off', yards: 5, desc: `False start, ${f.teams[P.frameTi].abbr} (5 yds)` }, time: 0 }, 'FLAG — False start', 'flag'); }
      if (r < 0.024) { P.onField = []; return finishPlay({ kind: 'scrim', penalty: { on: 'def', yards: 5, desc: `Offside, ${f.teams[1 - P.frameTi].abbr} (5 yds)` }, time: 0 }, 'FLAG — Offside', 'flag'); }
    }
    if (P.play.type === 'run' && P.play.run === 'sneak') { P.open = true; P.openT = 0; P.rusher = P.qb; }
    state = 'live';
  }

  function updateLive(dt) {
    P.t += dt;
    P.elapsed += dt;
    if (pressed.Tab) cycleCtrl();
    handleActions();
    if (P.type === 'punt' && !P.kicked && P.t >= P.kickAt) {
      if (P.ball.state === 'held' && P.ball.carrier === P.punter) launchPunt();
    }
    updateBall(dt);
    if (state !== 'live') return;
    for (const e of P.ents) {
      e.tkCd -= dt; e.blockCd -= dt; e.moveCd -= dt; e.jump -= dt;
      if (e.move) { e.move.t -= dt; if (e.move.t <= 0) e.move = null; }
      if (e.down > 0) { e.down -= dt; e.vx *= 0.85; e.vy *= 0.85; continue; }
      if (e.dive > 0) {
        e.dive -= dt;
        e.vx = e.diveDx * 7.5; e.vy = e.diveDy * 7.5;
        if (e.dive <= 0) {
          if (P.ball.state === 'held' && P.ball.carrier === e) { P.endY = e.y; return endPlay('tackle', e.x, e.y, 'dove'); }
          e.down = 0.8;
        }
        continue;
      }
      if (e.stun > 0) { e.stun -= dt; e.vx *= 0.9; e.vy *= 0.9; continue; }
      if (e.eng) continue;
      think(e, dt);
    }
    updateEngagements(dt);
    for (const e of P.ents) { e.x += e.vx * dt; e.y += e.vy * dt; }
    tryEngage();
    collisions();
    if (P.ball.state === 'held' && P.ball.carrier) {
      const c = P.ball.carrier;
      P.ball.x = c.x + 0.35; P.ball.y = c.y; P.ball.z = 1;
      // QB crossing LOS can no longer throw
      if (P.type === 'scrim' && c.role === 'qb' && c.side === 'O' && c.x > P.los + 0.3 && !P.open) { P.open = true; P.openT = P.t; c.canThrow = false; P.rusher = c; }
    }
    // energy drain
    for (const e of P.ents) {
      const sp = Math.hypot(e.vx, e.vy);
      f.drain(e.p, dt * (0.12 + (e.sprint && sp > 5 ? 0.6 : 0)));
    }
    checkTackles();
    if (state !== 'live') return;
    checkBounds();
    if (P.t > 30 && state === 'live') endPlay('tackle', P.ball.x, P.ball.y);
  }

  function handleActions() {
    const c = ctrl;
    if (!c || c.down > 0) return;
    const carrier = P.ball.state === 'held' ? P.ball.carrier : null;
    const mv = inputVec();
    if (mv.x || mv.y) c.override = true;
    if (carrier === c && c.role !== 'k') {
      if (P.type !== 'scrim' || P.open || !(c.role === 'qb' && !P.thrown && P.play && P.play.type === 'pass')) {
        if (pressed.Space) doMove(c, 'juke');
        if (pressed.KeyE) doMove(c, 'spin');
        if (pressed.KeyQ) doMove(c, 'stiff');
        if (pressed.KeyR) doMove(c, 'truck');
        if (pressed.KeyC && c.dive <= 0) { const n = Math.hypot(c.vx, c.vy) || 1; c.diveDx = c.vx / n; c.diveDy = c.vy / n; if (n < 0.5) { c.diveDx = goalDir(c); c.diveDy = 0; } c.dive = 0.3; float(c, 'DIVE'); }
      }
      if (pressed.KeyF && P.kickRet && c === P.kr && P.ball.carrier === c && c.x >= 110 && P.t - (P.catchT || 0) < 2.5) { endKick('touchback', c.x); }
    } else if (carrier ? c.ti !== carrier.ti : (P.type === 'scrim' ? c.side === 'D' : c.side === 'O')) {
      // defending
      if (c.eng && pressed.Space && c.moveCd <= 0) { c.shed += 0.32; c.moveCd = 0.45; float(c, 'SWIM'); }
      else if (pressed.Space && c.dive <= 0 && !c.eng) {
        let dx = mv.x, dy = mv.y;
        if (!dx && !dy) { const t = carrier || P.ball; dx = t.x - c.x; dy = t.y - c.y; }
        const n = Math.hypot(dx, dy) || 1;
        c.diveDx = dx / n; c.diveDy = dy / n; c.dive = 0.35; c.override = true;
      }
      if (pressed.KeyE) { c.jump = 0.55; float(c, 'JUMP'); }
    } else {
      // offensive non-carrier
      if (pressed.Space && (c.role === 'wr' || c.role === 'te' || c.role === 'rb') && !P.thrown) { P.callFor = c; P.callT = P.t; float(c, "I'M OPEN!"); }
      if (pressed.KeyE) { c.jump = 0.55; float(c, 'JUMP'); }
    }
    // fair catch / kneel for returner while ball in air
    if (pressed.KeyF && P.kickRet === undefined && (P.type === 'kickoff' || P.type === 'punt') && P.ball.state === 'air' && P.kr && P.kr.ti === user) {
      P.fairCatch = !P.fairCatch; float(P.kr, P.fairCatch ? 'FAIR CATCH' : 'RETURN');
    }
  }

  function doMove(e, type) {
    if (e.moveCd > 0 || e.down > 0) return;
    const dur = { juke: 0.4, spin: 0.55, stiff: 0.5, truck: 0.45 }[type];
    const cd = { juke: 0.9, spin: 1.4, stiff: 1.1, truck: 1.2 }[type];
    e.move = { type, t: dur };
    e.moveCd = cd;
    f.drain(e.p, 1.5);
    if (type === 'juke') {
      const sp = Math.hypot(e.vx, e.vy) || 1;
      let px = -e.vy / sp, py = e.vx / sp;
      const iv = inputVec();
      let side = 1;
      if (e === ctrl && (iv.x || iv.y)) side = Math.sign(px * iv.x + py * iv.y) || 1;
      else {
        const th = nearestOpp(e);
        if (th) side = Math.sign(px * (e.x - th.x) + py * (e.y - th.y)) || 1;
      }
      const burst = 2.5 + 2.5 * eff(e, 'agility') / 99;
      e.vx += px * side * burst; e.vy += py * side * burst;
    }
    float(e, type.toUpperCase() + '!');
  }

  function nearestOpp(e, max = 99) {
    let best = null, bd = max;
    for (const o of P.ents) { if (o.ti === e.ti || o.down > 0) continue; const d = dist(o, e); if (d < bd) { bd = d; best = o; } }
    return best;
  }

  // ---------- movement primitives ----------
  function maxSpd(e) {
    let s = 3.8 + 6.2 * eff(e, 'speed') / 99;
    s *= e.sprint ? 1.1 : 0.93;
    if (e.move && e.move.type === 'spin') s *= 0.82;
    if (e.move && e.move.type === 'truck') s *= 0.9;
    if (P.ball.state === 'held' && P.ball.carrier === e) s *= 0.97;
    if (f.en(e.p.id) < 15) s *= 0.9;
    return s;
  }
  function accelOf(e) { return 9 + 9 * eff(e, 'agility') / 99; }
  function accelerate(e, dvx, dvy, dt) {
    const a = accelOf(e) * dt;
    let ax = dvx - e.vx, ay = dvy - e.vy;
    const m = Math.hypot(ax, ay);
    if (m > a) { ax = ax / m * a; ay = ay / m * a; }
    e.vx += ax; e.vy += ay;
  }
  function steer(e, tx, ty, scale, dt) {
    const dx = tx - e.x, dy = ty - e.y;
    const d = Math.hypot(dx, dy);
    let dvx = 0, dvy = 0;
    if (d > 0.05) { const sp = Math.min(maxSpd(e) * scale, d * 3.2); dvx = dx / d * sp; dvy = dy / d * sp; }
    accelerate(e, dvx, dvy, dt);
  }
  function steerDir(e, dx, dy, scale, dt) {
    const d = Math.hypot(dx, dy);
    let dvx = 0, dvy = 0;
    if (d > 0.01) { dvx = dx / d * maxSpd(e) * scale; dvy = dy / d * maxSpd(e) * scale; }
    accelerate(e, dvx, dvy, dt);
  }

  // ---------- AI brain ----------
  function think(e, dt) {
    e.sprint = false;
    if (e === ctrl && e.override) return userMove(e, dt);
    const b = P.ball;
    const c = b.state === 'held' ? b.carrier : null;
    if (b.state === 'loose') {
      if (dist(e, b) < 14) { e.sprint = true; return steer(e, b.x, b.y, 1, dt); }
      return steer(e, e.x, e.y, 0, dt);
    }
    if (P.open && c) {
      if (e === c) return carrierAI(e, dt);
      if (e.ti === c.ti) return escort(e, c, dt);
      if (P.t < P.openT + e.react) return preRole(e, dt);
      return pursue(e, c, dt);
    }
    return preRole(e, dt);
  }

  function preRole(e, dt) {
    if (P.type === 'scrim') {
      const b = P.ball;
      if (b.state === 'air' && b.kind === 'pass' && e.chase) { e.sprint = true; return steer(e, b.tx, b.ty, 1, dt); }
      switch (e.assign.type) {
        case 'qb': return qbAI(e, dt);
        case 'route': return routeAI(e, dt);
        case 'runner': return runnerAI(e, dt);
        case 'passpro': return passPro(e, dt);
        case 'pafake': return paFake(e, dt);
        case 'runblock': return runBlock(e, dt);
        case 'stalk': return stalk(e, dt);
        case 'rush': return rushAI(e, dt);
        case 'man': return manAI(e, dt);
        case 'zone': return zoneAI(e, dt);
      }
      return steer(e, e.x, e.y, 0, dt);
    }
    return kickRoles(e, dt);
  }

  function userMove(e, dt) {
    const iv = inputVec();
    e.sprint = !!sprintKey() && f.en(e.p.id) > 12;
    steerDir(e, iv.x, iv.y, 1, dt);
  }

  function qbAI(e, dt) {
    const play = P.play;
    if (play.type === 'run') {
      if (play.run === 'sneak') return;
      if (!P.handed) {
        steer(e, P.mesh.x, P.mesh.y, 0.55, dt);
        const rb = O('RB');
        if (rb) {
          const close = dist(e, rb) < 1.4;
          const ready = play.run === 'outside' ? P.t >= 0.32 : play.run === 'draw' ? P.t >= 0.9 && close : P.t >= 0.25 && close;
          if (ready) handoff(e, rb);
        }
        if (P.t > 2.0 && !P.handed) { P.handed = true; P.open = true; P.openT = P.t; P.rusher = e; }
      } else steer(e, P.los - 6, e.y, 0.3, dt);
      return;
    }
    if (P.ball.carrier !== e) return steer(e, e.x, e.y, 0, dt);
    if (play.pa && P.t < 0.6) steer(e, P.mesh.x, P.mesh.y, 0.55, dt);
    else if (e.x > P.dropX + 0.4 && !e.dropped) steer(e, P.dropX, P.by, 0.75, dt);
    else {
      e.dropped = true;
      // pocket movement: drift away from free rushers
      let vx = 0, vy = 0;
      for (const o of P.ents) {
        if (o.side !== 'D' || o.eng || o.down > 0) continue;
        const d = dist(o, e);
        if (d < 4) { vx += (e.x - o.x) / (d * d); vy += (e.y - o.y) / (d * d); }
      }
      if (vx || vy) steerDir(e, vx + 0.3, vy, 0.5, dt); else steer(e, e.x, e.y, 0, dt);
    }
    if (e === ctrl) return; // user throws
    aiQBDecide(e);
  }

  function handoff(qb, rb) {
    P.handed = true; P.open = true; P.openT = P.t;
    P.ball.carrier = rb; P.rusher = rb;
    if (P.userOff && cfg.autoSwitch && (ctrl === qb || ctrl === rb)) setCtrl(rb);
  }

  function eligibles() { return P.ents.filter(e => e.side === 'O' && (e.role === 'wr' || e.role === 'te' || e.role === 'rb') && e.assign.type === 'route' && e.down <= 0); }

  function leadPoint(qb, r) {
    const v = 14 + 14 * eff(qb, 'throwPow') / 99;
    let tx = r.x, ty = r.y, T = 0, d = 0;
    for (let i = 0; i < 3; i++) { d = Math.hypot(tx - qb.x, ty - qb.y); T = d / v + 0.1; tx = r.x + r.vx * T; ty = r.y + r.vy * T; }
    return { x: tx, y: ty, T, d };
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = U.clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function aiQBDecide(e) {
    if (P.thrown || !e.canThrow) return;
    if (P.t < P.readStart) return;
    if (P.t - (P.lastRead || 0) < 0.15) return;
    P.lastRead = P.t;
    const maxR = 25 + eff(e, 'throwPow') * 0.42;
    const pressured = P.ents.some(o => o.side === 'D' && !o.eng && o.down <= 0 && dist(o, e) < 2.4);
    let best = null;
    for (const r of eligibles()) {
      const tg = leadPoint(e, r);
      if (tg.d > maxR || tg.y < 1.2 || tg.y > FH - 1.2 || tg.x > 119.5) continue;
      let open = 99;
      for (const dd of P.ents) {
        if (dd.side !== 'D' || dd.down > 0) continue;
        const px = dd.x + dd.vx * tg.T * 0.6, py = dd.y + dd.vy * tg.T * 0.6;
        open = Math.min(open, Math.hypot(px - tg.x, py - tg.y));
        const sd = segDist(dd.x, dd.y, e.x, e.y, tg.x, tg.y);
        if (sd < 1.3 && Math.hypot(dd.x - e.x, dd.y - e.y) > 3) open = Math.min(open, sd * 1.4);
      }
      let sc = open + U.clamp(tg.x - P.los, -5, 15) * 0.08 + (f.down >= 3 && tg.x >= P.fdX ? 1.2 : 0);
      if (P.callFor === r && P.t - P.callT < 1.2) sc += 3;
      if (r.role === 'rb' && P.play.depth !== 'screen') sc -= 0.6;
      if (!best || sc > best.sc) best = { r, tg, open, sc };
    }
    let need = P.t > P.readStart + 1.6 ? 1.7 : 2.6;
    if (P.play.depth === 'screen') need = 1.1;
    if (P.play.depth === 'hail') need = 0.5;
    const called = best && P.callFor === best.r && P.t - P.callT < 1.2;
    if (best && (best.open >= need || (pressured && best.open >= 1.2) || (called && best.open >= 1.0))) {
      throwBall(e, best.tg.x, best.tg.y, best.tg.d > 32);
    } else if (pressured && P.t > P.readStart + 1.0 && Math.random() < 0.18) {
      throwBall(e, e.x + 10, e.y < FH / 2 ? -4 : FH + 4, false, true);
    } else if (P.t > P.readStart + 2.6) {
      const lane = !P.ents.some(o => o.side === 'D' && o.down <= 0 && o.x > e.x && o.x < e.x + 7 && Math.abs(o.y - e.y) < 3.5);
      if (lane || P.t > P.readStart + 3.6) { P.open = true; P.openT = P.t; e.canThrow = false; P.rusher = e; }
    }
  }

  function throwBall(qb, tx, ty, lob, away) {
    if (P.thrown) return;
    const pow = eff(qb, 'throwPow'), accA = eff(qb, 'throwAcc');
    let dx = tx - qb.x, dy = ty - qb.y;
    let d = Math.hypot(dx, dy) || 0.1;
    const maxD = 25 + pow * 0.42;
    if (d > maxD) { tx = qb.x + dx / d * maxD; ty = qb.y + dy / d * maxD; d = maxD; }
    const pressure = P.ents.some(o => o.side === 'D' && !o.eng && o.down <= 0 && dist(o, qb) < 2.5) ? 1 : 0;
    const moving = Math.hypot(qb.vx, qb.vy) > 3 ? 1 : 0;
    const sig = away ? 0 : 0.3 + (1 - accA / 99) * 2.0 * (d / 20 + 0.3) + pressure * 1.1 + moving * 0.45 + (1 - f.en(qb.p.id) / 100) * 0.8;
    const lx = tx + U.gauss() * sig * 0.75, ly = ty + U.gauss() * sig * 0.6;
    const v = (14 + 14 * pow / 99) * (lob ? 0.72 : 1);
    const T = Math.hypot(lx - qb.x, ly - qb.y) / v + (lob ? 0.3 : 0.1);
    P.ball = { state: 'air', kind: 'pass', sx: qb.x, sy: qb.y, tx: lx, ty: ly, x: qb.x, y: qb.y, z: 2, t: 0, T, h: d * (lob ? 0.3 : 0.12) + 0.6, lob };
    P.thrown = true; P.passer = qb; qb.canThrow = false;
    f.st(qb.p, 'passAtt');
    // intended target and reactions
    let it = null, itd = 1e9;
    for (const r of P.ents) if (r.side === 'O' && ['wr', 'te', 'rb'].includes(r.role)) { const dd = Math.hypot(r.x - lx, r.y - ly); if (dd < itd) { itd = dd; it = r; } }
    P.target = it;
    for (const e of P.ents) {
      e.chase = false;
      if (e === qb) continue;
      const dd = Math.hypot(e.x - lx, e.y - ly);
      if (e.side === 'D') e.chase = dd <= maxSpd(e) * Math.max(0, T - e.react) + 2.4;
      else if (e === it && !away) e.chase = dd <= maxSpd(e) * T + 4;
    }
    if (away) float(qb, 'THROWN AWAY');
  }

  function routeAI(e, dt) {
    if (P.play.type === 'pass' && P.ball.state === 'held' && P.ball.carrier !== P.qb && !P.open) return steer(e, e.x, e.y, 0, dt);
    if (!e.route || e.ri >= e.route.length) {
      if (e.sit || !e.route) return steer(e, e.x, e.y, 0, dt);
      const last = e.route[e.route.length - 1], prev = e.route[e.route.length - 2] || { x: e.homeX, y: e.homeY };
      const dx = last.x - prev.x, dy = last.y - prev.y;
      e.sprint = true;
      return steerDir(e, dx, dy, 1, dt);
    }
    const wp = e.route[e.ri];
    if (Math.hypot(wp.x - e.x, wp.y - e.y) < 0.9) { e.ri++; if (wp.sit) e.sit = true; return; }
    e.sprint = true;
    steer(e, wp.x, wp.y, 1, dt);
  }

  function runnerAI(e, dt) {
    // before handoff: head to mesh along path
    if (!e.path) return steer(e, e.x, e.y, 0, dt);
    const wp = e.path[e.pi || 0];
    if (!wp) return steer(e, e.x + 1, e.y, 0.6, dt);
    if (Math.hypot(wp.x - e.x, wp.y - e.y) < 0.9) e.pi++;
    const scale = P.play.run === 'draw' && P.t < 0.8 ? 0 : 0.8;
    steer(e, wp.x, wp.y, scale, dt);
  }

  function paFake(e, dt) {
    if (P.t < 0.7) return steer(e, P.mesh.x, P.mesh.y + 0.3, 0.6, dt);
    e.assign = { type: 'passpro' };
  }

  function passPro(e, dt) {
    const prot = P.type === 'punt' ? P.punter : P.qb;
    if (!prot) return;
    let t = e.bt;
    if (!t || t.down > 0 || (t.eng && t.eng !== e) || dist(t, prot) > 13) {
      t = null; let bd = 6;
      for (const o of P.ents) {
        if (o.ti === e.ti || o.eng || o.down > 0) continue;
        if (!(o.assign.type === 'rush' || o.role === 'rush')) continue;
        const d = dist(o, e); if (d < bd) { bd = d; t = o; }
      }
      e.bt = t;
    }
    if (t) {
      const dx = prot.x - t.x, dy = prot.y - t.y, n = Math.hypot(dx, dy) || 1;
      steer(e, t.x + dx / n * 1.0, t.y + dy / n * 1.0, 0.95, dt);
    } else steer(e, e.homeX - 1.5, e.homeY, 0.4, dt);
  }

  function runBlock(e, dt) {
    let t = e.bt;
    if (!t || t.down > 0 || (t.eng && t.eng !== e)) {
      t = null; let bd = 7;
      for (const o of P.ents) { if (o.ti === e.ti || o.eng || o.down > 0) continue; const d = dist(o, e); if (d < bd && o.x > e.x - 2) { bd = d; t = o; } }
      e.bt = t;
    }
    if (t) steer(e, t.x - 0.3, t.y, 1, dt);
    else steer(e, e.x + 3, e.y, 0.7, dt);
  }

  function stalk(e, dt) {
    let t = e.bt;
    if (!t || t.down > 0 || (t.eng && t.eng !== e)) {
      t = null; let bd = 14;
      for (const o of P.ents) { if (o.ti === e.ti || o.eng || o.down > 0 || (o.role !== 'cb' && o.role !== 's')) continue; const d = dist(o, e); if (d < bd) { bd = d; t = o; } }
      e.bt = t;
    }
    if (t) { const c = P.ball.carrier || P.qb; const dx = c.x - t.x, dy = c.y - t.y, n = Math.hypot(dx, dy) || 1; steer(e, t.x + dx / n * 0.8, t.y + dy / n * 0.8, 0.85, dt); }
    else steer(e, e.x + 2, e.y, 0.5, dt);
  }

  function rushAI(e, dt) {
    const tgt = P.type === 'punt' ? P.punter : (P.ball.state === 'held' && P.ball.carrier) ? P.ball.carrier : P.qb;
    if (!tgt) return;
    if (P.ball.state === 'air' && P.ball.kind === 'pass') return steer(e, U.lerp(e.x, P.ball.tx, 0.3), U.lerp(e.y, P.ball.ty, 0.3), 0.7, dt);
    e.sprint = true;
    steer(e, tgt.x, tgt.y, 1, dt);
  }

  function manAI(e, dt) {
    const r = e.assign.tgt;
    if (!r || r.assign.type === 'passpro' || r.assign.type === 'runblock' || r.assign.type === 'pafake') {
      const qb = P.qb;
      return steer(e, P.los + 4.5, U.lerp(e.y, qb ? qb.y : P.by, 0.08), 0.6, dt);
    }
    if (P.ball.state === 'air' && P.ball.kind === 'pass') return steer(e, U.lerp(r.x, P.ball.tx, 0.5), U.lerp(r.y, P.ball.ty, 0.5), 1, dt);
    const tx = r.x + r.vx * 0.25 + 1.0, ty = r.y + r.vy * 0.25 + (r.y < P.by ? 0.5 : -0.5);
    const k = 2.5 + eff(e, 'coverage') / 99 * 6;
    const a = 1 - Math.exp(-k * dt);
    e.tgx += (tx - e.tgx) * a; e.tgy += (ty - e.tgy) * a;
    e.sprint = dist(e, r) > 1.5;
    steer(e, e.tgx, e.tgy, 1, dt);
  }

  function zoneAI(e, dt) {
    const a = e.assign;
    let tx = a.ax, ty = a.ay;
    const recs = eligibles();
    if (a.deep) {
      let deepest = null;
      for (const r of recs) if (Math.abs(r.y - a.ay) < a.r && (!deepest || r.x > deepest.x)) deepest = r;
      if (deepest) { tx = Math.max(a.ax, deepest.x + 3); ty = U.lerp(a.ay, deepest.y, 0.55); }
    } else {
      let best = null, bd = a.r;
      for (const r of recs) { const d = Math.hypot(r.x - a.ax, r.y - a.ay); if (d < bd) { bd = d; best = r; } }
      if (best) { tx = U.lerp(a.ax, best.x, 0.7) + 1; ty = U.lerp(a.ay, best.y, 0.75); }
    }
    if (P.ball.state === 'air' && P.ball.kind === 'pass') { tx = U.lerp(tx, P.ball.tx, 0.5); ty = U.lerp(ty, P.ball.ty, 0.5); }
    e.sprint = Math.hypot(tx - e.x, ty - e.y) > 3;
    steer(e, tx, ty, 0.95, dt);
  }

  function carrierAI(e, dt) {
    const dir = goalDir(e);
    if (e.path && e.pi < e.path.length && e.role === 'rb') {
      const wp = e.path[e.pi];
      if (Math.hypot(wp.x - e.x, wp.y - e.y) < 1.0 || wp.x < e.x - 1) e.pi++;
      else { e.sprint = true; steer(e, wp.x, wp.y, 1, dt); maybeJuke(e); return; }
    }
    // in-endzone returner decision
    let vx = dir * 1.0, vy = 0;
    for (const o of P.ents) {
      if (o.ti === e.ti || o.down > 0 || o.stun > 0) continue;
      const dx = e.x - o.x, dy = e.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d > 9) continue;
      const ahead = (o.x - e.x) * dir;
      if (ahead < -2) continue;
      const w = (o.eng ? 0.4 : 1.6) / (d * d + 0.3);
      vx += dx / d * w * 0.6; vy += dy / d * w * 1.4;
    }
    if (e.y < 3) vy += (3 - e.y) * 0.4;
    if (e.y > FH - 3) vy -= (e.y - (FH - 3)) * 0.4;
    e.sprint = f.en(e.p.id) > 15;
    steerDir(e, vx, vy, 1, dt);
    maybeJuke(e);
  }

  function maybeJuke(e) {
    if (e.moveCd > 0 || e === ctrl) return;
    const th = nearestOpp(e, 2.0);
    if (!th || th.eng || th.stun > 0) return;
    if ((th.x - e.x) * goalDir(e) < -0.5) return;
    if (Math.random() < 0.05 * eff(e, 'agility') / 99) {
      const type = eff(e, 'strength') > eff(e, 'agility') + 5 ? U.pick(['stiff', 'truck']) : U.pick(['juke', 'juke', 'spin', 'stiff']);
      doMove(e, type);
    }
  }

  function pursue(e, c, dt) {
    const d = dist(e, c);
    const ms = maxSpd(e) || 1;
    const lead = U.clamp(d / ms, 0, 1.2) * 0.8;
    let tx = c.x + c.vx * lead, ty = c.y + c.vy * lead;
    tx += goalDir(c) * Math.min(2, d * 0.1);
    e.sprint = true;
    steer(e, tx, ty, 1, dt);
  }

  function escort(e, c, dt) {
    if (e.role === 'qb' && P.type === 'scrim') return steer(e, e.x, e.y, 0, dt);
    let best = null, bs = 1e9;
    for (const o of P.ents) {
      if (o.ti === e.ti || o.down > 0 || o.stun > 0 || o.eng) continue;
      const dc = dist(o, c); if (dc > 12) continue;
      const de = dist(o, e); if (de > 9) continue;
      const s = dc + de * 0.6;
      if (s < bs) { bs = s; best = o; }
    }
    if (best) {
      const nx = c.x - best.x, ny = c.y - best.y, n = Math.hypot(nx, ny) || 1;
      e.sprint = true;
      steer(e, best.x + nx / n * 0.7, best.y + ny / n * 0.7, 1, dt);
    } else steer(e, c.x + goalDir(c) * 5, c.y + (e.y > c.y ? 3 : -3), 0.85, dt);
  }

  function kickRoles(e, dt) {
    const b = P.ball;
    if (P.type === 'punt' && !P.kicked) {
      if (e.role === 'p' || e.role === 'kr') return steer(e, e.x, e.y, 0, dt);
      if (e.role === 'gun') { e.sprint = true; return steer(e, P.los + 38, e.laneY, 1, dt); }
      if (e.role === 'pl') return passPro(e, dt);
      if (e.role === 'rush') return rushAI(e, dt);
      if (e.role === 'jam') { const g = P.ents.filter(x => x.role === 'gun').sort((a, c) => dist(a, e) - dist(c, e))[0]; if (g) return steer(e, g.x + 1, g.y, 1, dt); }
      return steer(e, e.x, e.y, 0, dt);
    }
    if (!P.kicked || P.type === 'fg') return steer(e, e.x, e.y, 0, dt);
    const land = P.kickLand;
    if (e.side === 'O') {
      if (e.role === 'k' || e.role === 'p') return steer(e, land.x - 15, land.y, 0.6, dt);
      e.sprint = true;
      return steer(e, land.x - 3, U.lerp(e.laneY, land.y, 0.55), 1, dt);
    }
    if (e.role === 'kr') {
      if (b.state === 'air') { e.sprint = true; return steer(e, U.clamp(land.x, 0, 119), clampY(land.y), 1, dt); }
      return steer(e, e.x, e.y, 0, dt);
    }
    let best = null, bd = 8;
    for (const o of P.ents) { if (o.side !== 'O' || o.eng || o.down > 0) continue; const d = dist(o, e); if (d < bd) { bd = d; best = o; } }
    if (best) { e.sprint = true; return steer(e, best.x, best.y, 1, dt); }
    const tx = land.x - 9 - (e.row || 0) * 5;
    steer(e, U.clamp(tx, 12, 115), U.lerp(e.laneY, land.y, 0.4), 0.9, dt);
  }

  // ---------- blocking ----------
  function isBlocker(b, carrier) {
    if (b.down > 0 || b.stun > 0 || b.eng || b.blockCd > 0) return false;
    if (carrier === b) return false;
    const t = b.assign.type;
    if (P.open && carrier && b.ti === carrier.ti) return !(b.role === 'qb' && P.type === 'scrim');
    if (t === 'passpro' || t === 'runblock' || t === 'stalk' || t === 'kblk') return true;
    if (P.type !== 'scrim' && P.kicked && b.side === 'D' && b.role === 'kblk') return true;
    if (b === ctrl && b.override && b.side === (carrier ? carrier.side : 'O')) return true;
    return false;
  }
  function tryEngage() {
    const carrier = P.ball.state === 'held' ? P.ball.carrier : null;
    for (const b of P.ents) {
      if (!isBlocker(b, carrier)) continue;
      for (const d of P.ents) {
        if (d.ti === b.ti || d.eng || d === carrier || d.down > 0 || d.stun > 0) continue;
        if (b.lastShed === d && b.blockCd > -1.5) continue;
        if (P.type === 'scrim' && !P.open && b.assign.type === 'passpro' && d.assign.type !== 'rush') continue;
        if (Math.hypot(d.x - b.x, d.y - b.y) < 1.15) {
          b.eng = d; d.eng = b; b.engBlk = true; d.engBlk = false; d.shed = 0;
          break;
        }
      }
    }
  }
  function updateEngagements(dt) {
    const carrier = P.ball.state === 'held' ? P.ball.carrier : null;
    for (const b of P.ents) {
      if (!b.eng || !b.engBlk) continue;
      const d = b.eng;
      if (d.eng !== b || b.down > 0 || d.down > 0) { b.eng = null; if (d.eng === b) d.eng = null; continue; }
      const passing = P.type !== 'scrim' || (!P.open && P.play.type === 'pass');
      const dp = passing ? eff(d, 'passRush') * 0.75 + eff(d, 'strength') * 0.25 : eff(d, 'strength') * 0.5 + eff(d, 'tackling') * 0.3 + eff(d, 'passRush') * 0.2;
      const bp = eff(b, 'blocking') * 0.7 + eff(b, 'strength') * 0.3;
      d.shed += dt * U.clamp(0.33 + (dp - bp) / 55, 0.06, 1.3) * (0.7 + Math.random() * 0.6) * (P.open ? 1.4 : 1);
      // goal the defender wants
      const g = carrier || P.qb || P.punter || P.ball;
      let gx = g.x - d.x, gy = g.y - d.y;
      const n = Math.hypot(gx, gy) || 1; gx /= n; gy /= n;
      const net = U.clamp((dp - bp) / 60 + (passing ? 0.15 : -0.05), -0.6, 0.8);
      d.vx = gx * net * 1.6; d.vy = gy * net * 1.6;
      d.x += d.vx * dt; d.y += d.vy * dt;
      b.vx = d.vx; b.vy = d.vy;
      b.x = d.x + gx * 1.05; b.y = d.y + gy * 1.05;
      // user-controlled defender can swim; carrier passing by can be grabbed
      if (d.shed >= 1) {
        b.eng = null; d.eng = null; b.blockCd = 0.9; b.lastShed = d; b.stun = 0.3; d.shed = 0;
        if (d === ctrl || Math.random() < 0.2) float(d, 'SHED!');
      }
    }
  }

  function collisions() {
    const n = P.ents.length;
    for (let i = 0; i < n; i++) {
      const a = P.ents[i];
      if (a.down > 0) continue;
      for (let j = i + 1; j < n; j++) {
        const b = P.ents[j];
        if (b.down > 0 || a.eng === b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.9 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), push = (0.95 - d) / 2;
        const ux = dx / d, uy = dy / d;
        a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
      }
    }
  }

  // ---------- ball ----------
  function updateBall(dt) {
    const b = P.ball;
    if (b.state === 'air') {
      b.t += dt;
      const s = Math.min(1, b.t / b.T);
      b.x = U.lerp(b.sx, b.tx, s); b.y = U.lerp(b.sy, b.ty, s);
      b.z = 4 * b.h * s * (1 - s) + (b.kind === 'pass' ? 2 * (1 - s) + 1.2 * s : 0);
      if (s >= 1) { if (b.kind === 'pass') passArrive(); else kickArrive(); }
    } else if (b.state === 'loose') {
      P.looseT = (P.looseT || 0) + dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.vx *= Math.pow(0.12, dt); b.vy *= Math.pow(0.12, dt);
      b.z = Math.abs(Math.sin(P.looseT * 9)) * Math.hypot(b.vx, b.vy) * 0.12;
      if (b.y < 0 || b.y > FH || b.x < 0 || b.x > FW) return looseOut();
      const sp = Math.hypot(b.vx, b.vy);
      if (P.type !== 'scrim' && b.x >= 110 && sp < 0.6 && !P.muffed) return endKick('touchback', b.x);
      if (P.type === 'punt' && !P.muffed && sp < 0.4 && P.looseT > 1.0) return endKick('downed', b.x);
      let best = null, bd = 0.9;
      for (const e of P.ents) {
        if (e.down > 0 || (e === P.fumbler && P.looseT < 0.4)) continue;
        const d = Math.hypot(e.x - b.x, e.y - b.y);
        if (d < bd) { bd = d; best = e; }
      }
      if (!best && P.looseT > 3) best = P.ents.filter(e => e.down <= 0).sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y))[0];
      if (best) recoverLoose(best);
    }
  }

  function looseOut() {
    const b = P.ball;
    if (P.type === 'scrim') {
      // fumble out of bounds: last possessing team keeps it
      const c = P.fumbler || P.qb;
      P.ball = { state: 'held', carrier: c, x: b.x, y: b.y, z: 0 };
      P.endY = U.clamp(b.y, 0, FH);
      return endPlay('oob', U.clamp(b.x, 0, FW), b.y);
    }
    if (P.muffed) return endKick('downed', b.x);
    return endKick('oob', b.x);
  }

  function recoverLoose(e) {
    const b = P.ball;
    if (P.type === 'scrim') {
      P.ball = { state: 'held', carrier: e, x: e.x, y: e.y, z: 1 };
      f.st(e.p, 'fr');
      if (e.ti !== P.frameTi) { P.turnover = 'fumble'; if (P.fumbler) f.st(P.fumbler.p, 'fumLost'); float(e, 'RECOVERED!'); }
      else float(e, 'Recovered');
      P.open = true; P.openT = P.t;
      if (e.ti === user && cfg.autoSwitch) setCtrl(e);
      // instantly down if surrounded
      if (P.ents.some(o => o.ti !== e.ti && o.down <= 0 && dist(o, e) < 1.3)) endPlay('tackle', e.x, e.y);
      return;
    }
    // kick plays
    const traveled = b.x - P.los;
    if (e.side === 'O') {
      if (P.type === 'punt' && !P.muffed) return endKick('downed', b.x);
      if (P.type === 'kickoff' && traveled < 10 && !P.muffed) { return endKick('illegal', b.x); }
      return endKick('recovered', b.x);
    }
    P.ball = { state: 'held', carrier: e, x: e.x, y: e.y, z: 1 };
    P.open = true; P.openT = P.t; P.catchX = e.x; P.returner = e; P.kickRet = true;
    if (e.ti === user) setCtrl(e);
  }

  function passArrive() {
    const b = P.ball;
    const lx = b.tx, ly = b.ty;
    const offs = P.ents.filter(e => e.side === 'O' && ['wr', 'te', 'rb'].includes(e.role) && e.down <= 0);
    const defs = P.ents.filter(e => e.side === 'D' && e.down <= 0 && e.stun <= 0);
    const near = (arr, rad) => arr.map(e => ({ e, d: Math.hypot(e.x - lx, e.y - ly) - (e.jump > 0 ? 0.35 : 0) })).filter(o => o.d <= rad).sort((a, c) => a.d - c.d);
    const R = near(offs, 1.7)[0], Dd = near(defs, 1.7)[0];
    if (P.target) {
      f.st(P.target.p, 'targets');
      const cov = defs.slice().sort((a, c) => dist(a, P.target) - dist(c, P.target))[0];
      if (cov && dist(cov, P.target) < 4) { f.st(cov.p, 'tgtAllowed'); P.coverer = cov; }
    }
    const inb = ly >= 0 && ly <= FH && lx <= FW;
    if (!inb || (!R && !Dd)) return incomplete(!inb ? 'Incomplete — out of bounds' : 'Incomplete');
    if (Dd && (!R || Dd.d < R.d - 0.25)) {
      const dd = Dd.e;
      const pInt = 0.12 + eff(dd, 'catching') / 99 * 0.18 + eff(dd, 'coverage') / 99 * 0.15 + (dd.jump > 0 ? 0.12 : 0) - Dd.d * 0.08;
      if (Math.random() < pInt) return intercept(dd);
      f.st(dd.p, 'pd');
      float(dd, 'BROKEN UP');
      return incomplete('Pass broken up');
    }
    const rr = R.e;
    let pc = 0.5 + eff(rr, 'catching') / 99 * 0.45 - R.d * 0.12 + (rr.jump > 0 ? 0.06 : 0) + (b.lob ? 0.03 : 0);
    if (Dd && Dd.d < 1.6) pc -= eff(Dd.e, 'coverage') / 99 * 0.32 - Dd.d * 0.08 + (Dd.e.jump > 0 ? 0.1 : 0);
    pc = U.clamp(pc, 0.05, 0.97);
    if (Math.random() < pc && rr.y >= 0 && rr.y <= FH) return catchBall(rr);
    if (Dd && Dd.d < 1.6 && Math.random() < 0.12) return intercept(Dd.e);
    if (f.o.penalties && Dd && Dd.d < 1.0 && Math.random() < 0.18 && !P.twoPt) {
      const yds = Math.max(1, Math.round(lx - P.los));
      if (yds > 0 && P.los + yds < 110) {
        P.onField = P.ents.map(e => e.p);
        return finishPlay({ kind: 'scrim', penalty: { on: 'def', yards: yds, spot: true, auto: true, desc: `Pass interference, ${f.teams[1 - P.frameTi].abbr} (${yds} yds)` }, time: P.elapsed }, 'FLAG — Pass interference!', 'flag');
      }
    }
    if (Dd && Dd.d < 1.6) f.st(Dd.e.p, 'pd');
    return incomplete(Dd && Dd.d < 1.6 ? 'Incomplete — contested' : 'Dropped!');
  }

  function catchBall(r) {
    P.ball = { state: 'held', carrier: r, x: r.x, y: r.y, z: 1 };
    P.catcher = r; P.open = true; P.openT = P.t;
    f.st(P.passer.p, 'passCmp'); f.st(r.p, 'rec');
    if (P.coverer) f.st(P.coverer.p, 'cmpAllowed');
    float(r, 'CATCH');
    if (r.ti === user && cfg.autoSwitch) setCtrl(r);
  }

  function intercept(d) {
    P.ball = { state: 'held', carrier: d, x: d.x, y: d.y, z: 1 };
    P.turnover = 'int'; P.open = true; P.openT = P.t; P.interceptor = d;
    f.st(P.passer.p, 'passInt'); f.st(d.p, 'defInt'); f.st(d.p, 'pd');
    float(d, 'INTERCEPTION!');
    if (d.ti === user && cfg.autoSwitch) setCtrl(d);
    if (d.x >= 110 && d !== ctrl) { P.endY = d.y; endPlay('tackle', d.x, d.y); }
  }

  function incomplete(txt) {
    P.ball.state = 'dead';
    P.endY = P.by;
    const res = { kind: 'scrim', yards: 0, incomplete: true, clockStops: true, time: P.elapsed,
      desc: `${Data.name(P.passer.p)} pass${P.target ? ' to ' + Data.name(P.target.p) : ''} incomplete.` };
    if (P.twoPt) res.td = false;
    finishPlay(res, txt, 'info');
    postTimer = 1.4;
  }

  function kickArrive() {
    const b = P.ball;
    const lx = b.tx, ly = b.ty;
    P.landX = lx;
    if (ly < 0 || ly > FH) return endKick('oob', lx);
    if (lx >= FW) return endKick('touchback', lx);
    if (P.onside) { P.ball = { state: 'loose', x: lx, y: ly, vx: U.rf(1, 3), vy: U.rf(-2, 2), z: 0 }; P.looseT = 0; return; }
    const rcv = P.ents.filter(e => e.side === 'D' && e.down <= 0 && e.stun <= 0).sort((a, c) => Math.hypot(a.x - lx, a.y - ly) - Math.hypot(c.x - lx, c.y - ly));
    const r = rcv[0];
    if (r && Math.hypot(r.x - lx, r.y - ly) < 1.9) {
      if (P.fairCatch && r.ti === user) return endKick('fair', lx);
      if (r.ti !== user && P.type === 'punt' && P.ents.some(o => o.side === 'O' && dist(o, r) < 3.5) && Math.random() < 0.6) return endKick('fair', lx);
      if (Math.random() < 0.03 * (1.4 - eff(r, 'catching') / 99)) {
        P.muffed = true; float(r, 'MUFFED!');
        P.ball = { state: 'loose', x: lx, y: ly, vx: U.rf(-3, 3), vy: U.rf(-3, 3), z: 0 }; P.looseT = 0;
        return;
      }
      P.ball = { state: 'held', carrier: r, x: r.x, y: r.y, z: 1 };
      P.open = true; P.openT = P.t; P.catchX = lx; P.returner = r; P.kickRet = true; P.catchT = P.t;
      if (r.ti === user) setCtrl(r);
      if (lx >= 110) {
        if (r.ti !== user && (lx >= 112.5 || Math.random() < 0.5)) return endKick('touchback', lx);
        if (r.ti === user) float(r, 'F = take a knee');
      }
      return;
    }
    // bounces
    const dx = Math.cos(Math.atan2(ly - b.sy, lx - b.sx));
    P.ball = { state: 'loose', x: lx, y: ly, vx: dx * U.rf(4, 7), vy: U.rf(-2, 2), z: 0 };
    P.looseT = 0;
  }

  // ---------- tackles & boundaries ----------
  function qbInPocket(c) { return P.type === 'scrim' && c.role === 'qb' && c.side === 'O' && !P.thrown && P.play.type === 'pass' && c.x < P.los; }

  function checkTackles() {
    const c = P.ball.state === 'held' ? P.ball.carrier : null;
    if (!c || P.type === 'fg') return;
    if (P.type === 'kickoff' && !P.kicked) return;
    if (P.type === 'punt' && !P.kicked && c === P.punter) {
      if (P.ents.some(o => o.side === 'D' && !o.eng && o.down <= 0 && dist(o, c) < 1.0)) return endKick('blocked', c.x);
      return;
    }
    for (const d of P.ents) {
      if (d.ti === c.ti || d.stun > 0 || d.down > 0 || d.tkCd > 0) continue;
      const dd = dist(d, c);
      const reach = d.dive > 0 ? 1.75 : 1.05;
      if (dd > reach) continue;
      if (d.eng && dd > 0.8) continue;
      d.tkCd = 0.75;
      let p = 0.6 + (eff(d, 'tackling') - (eff(c, 'strength') * 0.45 + eff(c, 'agility') * 0.55)) / 110;
      if (d.dive > 0) p += 0.12;
      if (d.eng) p -= 0.25;
      if (qbInPocket(c)) p += 0.18;
      const gang = P.ents.filter(o => o !== d && o.ti === d.ti && o.down <= 0 && dist(o, c) < 2.0).length;
      p += 0.12 * gang;
      const m = c.move;
      if (m && m.t > 0) {
        const inFront = (d.x - c.x) * goalDir(c) > -0.3;
        if (m.type === 'juke') p -= 0.38 * eff(c, 'agility') / 99;
        if (m.type === 'spin') p -= 0.34 * (eff(c, 'agility') * 0.6 + eff(c, 'strength') * 0.4) / 99;
        if (m.type === 'stiff' && inFront) p -= 0.36 * eff(c, 'strength') / 99;
        if (m.type === 'truck' && inFront) p -= 0.22 + (eff(c, 'strength') - eff(d, 'strength')) / 200;
      }
      if (c === ctrl && isUserEnt(c) && f.o.difficulty === 'rookie') p -= 0.05;
      p = U.clamp(p, 0.06, 0.97);
      if (Math.random() < p) return tackled(c, d);
      d.stun = 0.55 + Math.random() * 0.4;
      c.vx *= 0.75; c.vy *= 0.75;
      float(c, m && m.t > 0 ? 'MISSED!' : 'Broken tackle!');
    }
  }

  function tackled(c, d) {
    P.tackler = d;
    let fp = 0.012 * (1.6 - eff(c, 'carrying') / 99) * (d.dive > 0 ? 1.3 : 1);
    if (qbInPocket(c)) fp = 0.05 * (1.5 - eff(c, 'carrying') / 99);
    if (c.move && c.move.type === 'truck') fp *= 1.4;
    f.injCheck(c.p, 1.15);
    f.injCheck(d.p, 0.75);
    if (Math.random() < fp && !(P.type !== 'scrim' && c.x >= 110)) {
      f.st(c.p, 'fumbles'); f.st(d.p, 'ff');
      P.fumbler = c; P.fumbleX = c.x;
      if (P.type === 'scrim' && c.side === 'O') P.offYdsAtFumble = Math.round(c.x - P.los);
      P.ball = { state: 'loose', x: c.x, y: c.y, vx: U.rf(-4, 4), vy: U.rf(-4, 4), z: 0.5 };
      P.looseT = 0;
      c.down = 1.0;
      float(c, 'FUMBLE!');
      if (P.type !== 'scrim') P.muffed = true;
      return;
    }
    const fwd = Math.hypot(c.vx, c.vy) > 3 && (c.vx * goalDir(c) > 0) ? goalDir(c) * 0.6 : 0;
    c.down = 1; d.down = 0.6;
    P.endY = c.y;
    endPlay('tackle', c.x + fwd, c.y);
  }

  function checkBounds() {
    const c = P.ball.state === 'held' ? P.ball.carrier : null;
    if (!c) return;
    if (P.type === 'kickoff' && !P.kicked) return;
    if (P.type === 'punt' && !P.kicked) return;
    if (c.y < 0 || c.y > FH) { P.endY = U.clamp(c.y, 0, FH); return endPlay('oob', U.clamp(c.x, 0, FW), c.y); }
    if (c.side === 'O' && c.x >= 110 && (P.type === 'scrim' || P.kicked)) { P.endY = c.y; return endPlay('td', 110, c.y); }
    if (c.side === 'D' && c.x <= 10) { P.endY = c.y; return endPlay('td', 10, c.y); }
    if (c.x < 0 || c.x > FW) { P.endY = c.y; return endPlay('oob', U.clamp(c.x, 0, FW), c.y); }
  }

  function endPlay(how, x, y) {
    if (state !== 'live') return;
    if (P.type === 'scrim') return endScrim(how, x);
    return endKick(how === 'td' ? 'td' : 'tackle', x);
  }

  function endScrim(how, x) {
    const c = P.ball.carrier;
    if (!c) return incomplete('Dead ball');
    const o = P.frameTi;
    const time = P.elapsed;
    const nmP = e => (e ? Data.name(e.p) : '');
    if (c.ti === o) {
      let yards = Math.round(x - P.los);
      let td = how === 'td';
      if (td) yards = 100 - f.ballOn;
      if (f.ballOn + yards >= 100) { td = true; yards = 100 - f.ballOn; }
      if (P.twoPt) { finishPlay({ kind: 'scrim', td, time: 0, desc: `Two-point try ${td ? 'GOOD' : 'fails'}.` }, td ? 'TWO-POINT CONVERSION GOOD!' : 'Stopped short!', td ? 'score' : 'bad'); return; }
      const safety = !td && f.ballOn + yards <= 0;
      if (safety) yards = -f.ballOn;
      const sack = qbInPocket(c) && !P.open || (c.role === 'qb' && !P.thrown && P.play.type === 'pass' && x < P.los && !P.rusher);
      // holding on runs
      if (f.o.penalties && !td && yards > 4 && !P.catcher && Math.random() < 0.025) {
        return finishPlay({ kind: 'scrim', penalty: { on: 'off', yards: 10, desc: `Holding, ${f.teams[o].abbr} (10 yds)` }, time }, 'FLAG — Holding on the offense', 'flag');
      }
      let desc;
      if (P.catcher) {
        f.st(P.passer.p, 'passYds', yards); f.st(P.catcher.p, 'recYds', yards); f.st(P.catcher.p, 'recLong', yards);
        f.tst(o, 'passYds', yards);
        if (td) { f.st(P.passer.p, 'passTD'); f.st(P.catcher.p, 'recTD'); }
        desc = `${nmP(P.passer)} complete to ${nmP(P.catcher)} for ${yards} yds${td ? ' — TOUCHDOWN!' : '.'}`;
      } else if (sack) {
        f.st(c.p, 'sacked');
        if (P.tackler) { f.st(P.tackler.p, 'sacks'); f.st(P.tackler.p, 'tfl'); }
        const ol = P.ents.filter(e => e.role === 'ol');
        if (ol.length) f.st(U.pick(ol).p, 'sacksAllowed');
        desc = `${nmP(c)} SACKED${P.tackler ? ' by ' + nmP(P.tackler) : ''} for ${-yards}.`;
      } else {
        const r = P.rusher || c;
        f.st(r.p, 'rushAtt'); f.st(r.p, 'rushYds', yards); f.st(r.p, 'rushLong', yards);
        f.tst(o, 'rushYds', yards);
        if (td) f.st(r.p, 'rushTD');
        if (P.play.type === 'run') P.ents.filter(e => e.role === 'ol').forEach(e => { f.st(e.p, 'olRushAtt'); f.st(e.p, 'olRushYds', yards); });
        desc = `${nmP(r)} runs for ${yards}${td ? ' — TOUCHDOWN!' : '.'}`;
      }
      if (P.tackler && how === 'tackle' && !td) { f.st(P.tackler.p, 'tackles'); if (yards < 0 && !sack) f.st(P.tackler.p, 'tfl'); }
      const res = { kind: 'scrim', yards, td, safety, sack, clockStops: how === 'oob', time, desc };
      let txt = td ? 'TOUCHDOWN!' : safety ? 'SAFETY!' : sack ? `SACK! Loss of ${-yards}` : how === 'oob' ? `Out of bounds · ${yards >= 0 ? '+' : ''}${yards}` : `${yards >= 0 ? '+' : ''}${yards} yards`;
      if (!td && !safety && f.ballOn + yards - f.ballOn >= f.toGo) txt += ' · FIRST DOWN';
      finishPlay(res, txt, td || safety ? 'score' : 'info');
    } else {
      // defense has it
      if (P.twoPt) return finishPlay({ kind: 'scrim', td: false, time: 0, desc: 'Two-point try fails.' }, 'Two-point try fails', 'bad');
      const defTD = how === 'td';
      let nb = Math.round(110 - x);
      if (x >= 110 && !defTD) nb = 20;
      nb = U.clamp(nb, 1, 99);
      if (P.offYdsAtFumble != null && P.fumbler && P.fumbler.side === 'O') {
        const y0 = P.offYdsAtFumble;
        if (P.catcher === P.fumbler) { f.st(P.passer.p, 'passYds', y0); f.st(P.catcher.p, 'recYds', y0); f.st(P.catcher.p, 'recLong', y0); }
        else { const r = P.rusher || P.fumbler; f.st(r.p, 'rushAtt'); f.st(r.p, 'rushYds', y0); }
      }
      if (P.tackler && how === 'tackle') f.st(P.tackler.p, 'tackles');
      if (defTD) f.st(c.p, 'defTD');
      const res = { kind: 'scrim', turnover: P.turnover || 'fumble', newBallOn: nb, defTD, clockStops: true, time,
        desc: `${P.turnover === 'int' ? 'Interception' : 'Fumble recovery'} by ${nmP(c)}${defTD ? ' returned for a TOUCHDOWN!' : '.'}` };
      finishPlay(res, defTD ? 'PICK SIX!' : P.turnover === 'int' ? 'INTERCEPTED!' : 'TURNOVER!', defTD ? 'score' : 'turnover');
    }
  }

  function endKick(how, x) {
    if (state !== 'live' && state !== 'presnap') return;
    const kickoff = P.type === 'kickoff';
    const c = P.ball.state === 'held' ? P.ball.carrier : null;
    let nb = 25, td = false, rec = false, desc = '', txt = '';
    const recvName = f.teams[1 - P.frameTi].abbr;
    switch (how) {
      case 'touchback': nb = kickoff ? 25 : 20; txt = 'Touchback'; desc = 'Touchback.'; break;
      case 'oob': nb = kickoff ? 40 : U.clamp(Math.round(110 - x), 1, 99); txt = kickoff ? 'Kickoff out of bounds — ball at the 40' : 'Punt out of bounds'; desc = txt + '.'; break;
      case 'fair': nb = kickoff ? Math.max(25, Math.round(110 - x)) : U.clamp(Math.round(110 - x), 1, 99); txt = 'Fair catch'; desc = 'Fair catch.'; break;
      case 'downed': nb = x >= 110 ? 20 : U.clamp(Math.round(110 - x), 1, 99); txt = 'Downed'; desc = 'Punt downed.'; break;
      case 'illegal': nb = U.clamp(Math.round(110 - x), 1, 99); txt = 'Illegal touch — receiving team ball'; desc = txt; break;
      case 'recovered': rec = true; nb = U.clamp(Math.round(x - 10), 1, 99); txt = kickoff ? 'ONSIDE KICK RECOVERED!' : 'MUFFED — kicking team recovers!'; desc = txt; break;
      case 'blocked': nb = U.clamp(Math.round(110 - x), 1, 99); txt = 'PUNT BLOCKED!'; desc = 'Punt blocked.'; break;
      case 'td':
        if (c && c.side === 'D') { td = true; nb = 99; txt = 'RETURN TOUCHDOWN!'; }
        else { rec = true; td = true; nb = 99; txt = 'TOUCHDOWN!'; }
        desc = `${c ? Data.name(c.p) : ''} ${txt}`;
        break;
      default: // tackle / out of bounds with carrier
        if (c && c.side === 'D') {
          nb = x >= 110 ? (kickoff ? 25 : 20) : U.clamp(Math.round(110 - x), 1, 99);
          txt = x >= 110 ? 'Touchback' : `Return to the ${nb <= 50 ? 'own ' + nb : 'opp ' + (100 - nb)}`;
        } else if (c) { rec = true; nb = U.clamp(Math.round(x - 10), 1, 99); txt = 'Recovered by the kicking team!'; }
        desc = `${c ? Data.name(c.p) : ''} ${txt}`;
    }
    if (P.returner && c === P.returner && P.catchX != null) {
      const ry = Math.max(0, Math.round(P.catchX - x));
      if (kickoff) { f.st(P.returner.p, 'kr'); f.st(P.returner.p, 'krYds', ry); }
      else { f.st(P.returner.p, 'pr'); f.st(P.returner.p, 'prYds', ry); }
      if (P.tackler && how !== 'td') f.st(P.tackler.p, 'tackles');
    }
    if (!kickoff && P.kicked) f.st(P.punter.p, 'puntYds', Math.max(0, Math.round(Math.min(P.landX ?? x, 110) - P.los)));
    if (!kickoff && how === 'blocked') {/* no punt yds */ }
    P.endY = 26.67;
    const res = { kind: kickoff ? 'kickoff' : 'punt', newBallOn: nb, td, recovered: rec, time: P.elapsed, desc: `${kickoff ? 'Kickoff' : 'Punt'}: ${desc}` };
    state = 'live';
    finishPlay(res, txt, td ? 'score' : rec ? 'turnover' : 'info');
  }

  // ---------- visuals ----------
  function banner(text, kind) {
    banners.push({ text, kind, t: kind === 'injury' ? 3.2 : 2.0 });
    if (banners.length > 4) banners.shift();
  }
  function updateBannerDom() {
    banners = banners.filter(b => b.t > 0);
    const html = banners.slice(-3).map(b => `<div class="bn bn-${b.kind}">${U.esc(b.text)}</div>`).join('');
    const bn = el('banner');
    if (bn._h !== html) { bn.innerHTML = html; bn._h = html; }
    updateHUD(false);
    updateTouchUI();
  }
  function float(e, text) { floats.push({ x: e.x, y: e.y - 1.2, text, t: 0.9 }); }

  function updateHUD(force) {
    const h = f.teams[0], a = f.teams[1];
    const poss = f.phase === 'kickoff' ? 1 - f.kickTeam : f.poss;
    const clk = (state === 'live' || (state === 'post' && pendingRes && pendingRes.kind !== 'xp' && pendingRes.kind !== '2pt' && f.phase !== 'pat')) && P && P.type !== 'fg' ? Math.max(0, f.clock - P.elapsed) : f.clock;
    const qn = f.q <= 4 ? U.ordinal(f.q) : 'OT' + (f.q > 5 ? f.q - 4 : '');
    const dots = n => '●'.repeat(n) + '○'.repeat(Math.max(0, 3 - n));
    const html = `<div class="sb-team" style="background:${a.c1};color:${U.textOn(a.c1)}">${poss === 1 ? '<i class="poss">◀</i>' : ''}<b>${a.abbr}</b><span class="sb-score">${f.score[1]}</span><small>${dots(f.timeouts[1])}</small></div>
      <div class="sb-team" style="background:${h.c1};color:${U.textOn(h.c1)}">${poss === 0 ? '<i class="poss">◀</i>' : ''}<b>${h.abbr}</b><span class="sb-score">${f.score[0]}</span><small>${dots(f.timeouts[0])}</small></div>
      <div class="sb-clock"><b>${qn}</b> ${U.clock(clk)}</div>
      <div class="sb-down">${f.phase === 'play' ? f.downStr() + ' · ' + f.spotStr() : f.downStr()}</div>`;
    if (force || html !== hudCache) { el('scorebug').innerHTML = html; hudCache = html; }
    // controlled player
    let ci = '';
    if (ctrl && P && (state === 'live' || state === 'presnap' || state === 'meter')) {
      const en = Math.round(f.en(ctrl.p.id));
      ci = `<div class="ci-name">#${ctrl.p.num} ${U.esc(Data.full(ctrl.p))} <span class="pos">${ctrl.p.pos}</span> <span class="ovr">${ctrl.p.ovr}</span></div>
        <div class="ci-bar"><div style="width:${en}%;background:${en > 60 ? '#4ade80' : en > 30 ? '#facc15' : '#f87171'}"></div></div><small>Energy ${en}%</small>`;
    }
    const cie = el('ctrl-info');
    if (cie._h !== ci) { cie.innerHTML = ci; cie._h = ci; cie.style.display = ci ? 'block' : 'none'; }
    const tk = tickerLines.map(t => `<div>${U.esc(t)}</div>`).join('');
    const te = el('ticker');
    if (te._h !== tk) { te.innerHTML = tk; te._h = tk; }
  }

  function drawHelp() {
    el('help').style.display = showHelp ? 'block' : 'none';
    el('help').onclick = () => { showHelp = false; drawHelp(); };
    if (touchMode) {
      el('help').innerHTML = `<b>Touch controls</b> <span class="muted">(tap to hide)</span><br>
        Left stick: move · <b>SPRINT</b>: hold to run faster<br>
        <b>QB:</b> drag a finger on the field to aim, lift to throw (<b>LOB</b> = soft toss)<br>
        Tap a teammate or <b>SWITCH</b> to control another player<br>
        Big button changes: SNAP · JUKE · DIVE · KICK · NEXT<br>
        Play calls: tap once to preview, tap again to call · ❚❚ pause`;
      return;
    }
    el('help').innerHTML = `<b>Controls</b> <span class="muted">(H to hide)</span><br>
      <kbd>WASD</kbd>/<kbd>Arrows</kbd> move · <kbd>Shift</kbd> sprint<br>
      <kbd>Space</kbd> snap · juke · dive tackle<br>
      <b>QB:</b> click + drag to aim, release to throw (hold <kbd>Shift</kbd> for lob)<br>
      <b>Ball carrier:</b> <kbd>Space</kbd> juke · <kbd>E</kbd> spin · <kbd>Q</kbd> stiff arm · <kbd>R</kbd> truck · <kbd>C</kbd> dive<br>
      <b>Receiver:</b> <kbd>Space</kbd> call for ball · <kbd>E</kbd> jump<br>
      <b>Defense:</b> <kbd>Space</kbd> dive / swim move · <kbd>E</kbd> jump to swat<br>
      <kbd>Tab</kbd> or click a teammate to switch player<br>
      <b>Kicks:</b> <kbd>Space</kbd> ×3 (start, power, accuracy) · <kbd>W</kbd>/<kbd>S</kbd> aim · <kbd>F</kbd> fair catch / kneel<br>
      <kbd>+</kbd>/<kbd>-</kbd> zoom · <kbd>Esc</kbd> pause`;
  }

  function camTarget() {
    if (!P) return { x: f.phase === 'kickoff' ? 50 : 10 + f.ballOn + 9, y: f.ballY };
    const b = P.ball;
    if (P.type === 'fg') return { x: (P.spotX + 120) / 2, y: P.by };
    if (state === 'playcall' && P.type === 'scrim') return { x: P.los + 6, y: P.by + (H / SC) * 0.22 };
    if (state === 'presnap' || state === 'meter') {
      if (P.type === 'scrim') return { x: P.los + 9, y: P.by };
      if (P.type === 'kickoff') return { x: P.los + 20, y: 26.67 };
      return { x: P.los + 10, y: P.by };
    }
    if (b.state === 'air') return { x: b.x, y: b.y };
    if (b.state === 'held' && b.carrier) {
      const c = b.carrier;
      if (P.type === 'scrim' && !P.open && c.role === 'qb') return { x: P.los + 9, y: (c.y + P.by) / 2 };
      return { x: c.x + goalDir(c) * 5, y: c.y };
    }
    return { x: b.x, y: b.y };
  }

  function render(dt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#0d2616';
    ctx.fillRect(0, 0, W, H);
    const t = camTarget();
    const tx = flip() ? FW - t.x : t.x;
    const k = Math.min(1, dt * 4);
    cam.x += (tx - cam.x) * k; cam.y += (t.y - cam.y) * k;
    const vh = H / SC;
    const lift = state === 'playcall' ? vh * 0.3 : 0;
    if (vh >= FH + 6 && !lift) cam.y = FH / 2; else cam.y = U.clamp(cam.y, Math.min(vh / 2 - 3, FH / 2), Math.max(FH - vh / 2 + 3, FH / 2) + lift);
    const vw = W / SC;
    cam.x = U.clamp(cam.x, vw / 2 - 6, FW - vw / 2 + 6);
    // play-call preview: fit the full field width into the space above the play menu
    let savedSC = null;
    if (state === 'playcall' && P && P.preview) {
      const pc = document.querySelector('#overlay .playcall');
      const top = 64, ph = pc ? pc.offsetHeight - 30 : H * 0.4;
      const avail = Math.max(140, H - ph - top);
      savedSC = SC;
      SC = Math.min(avail / (FH + 3), W / 58);
      const tx = P.los + 13;
      cam.x = flip() ? FW - tx : tx;
      cam.y = FH / 2 - (top + avail / 2 - H / 2) / SC;
    }
    drawField();
    if (P) { drawArt(); drawEnts(); drawBall(); drawAim(); }
    drawFloats();
    drawMeter();
    if (savedSC != null) SC = savedSC;
  }
  function snapCam() { const t = camTarget(); cam.x = flip() ? FW - t.x : t.x; cam.y = t.y; }

  function rect(x1, y1, x2, y2, color) {
    const [a, b] = w2s(x1, y1), [c, d] = w2s(x2, y2);
    ctx.fillStyle = color;
    ctx.fillRect(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b));
  }
  function line(x1, y1, x2, y2, color, w = 1, dash) {
    const [a, b] = w2s(x1, y1), [c, d] = w2s(x2, y2);
    ctx.strokeStyle = color; ctx.lineWidth = w;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
    if (dash) ctx.setLineDash([]);
  }

  function drawField() {
    const fr = P ? P.frameTi : (f ? f.poss : 0);
    rect(-10, -6, FW + 10, FH + 6, '#1f5a2e');
    for (let x = 10; x < 110; x += 5) rect(x, 0, x + 5, FH, ((x - 10) / 5) % 2 ? '#2e7d3e' : '#2a7439');
    const own = f.teams[fr], opp = f.teams[1 - fr];
    rect(0, 0, 10, FH, own.c1);
    rect(110, 0, 120, FH, opp.c1);
    // endzone text
    ctx.save();
    ctx.font = `bold ${Math.max(10, SC * 3.2)}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [x, tm] of [[5, own], [115, opp]]) {
      const [sx, sy] = w2s(x, FH / 2);
      ctx.save(); ctx.translate(sx, sy); ctx.rotate((x < 60) !== flip() ? -Math.PI / 2 : Math.PI / 2);
      ctx.fillStyle = tm.c2; ctx.globalAlpha = 0.85; ctx.fillText(tm.name.toUpperCase(), 0, 0); ctx.restore();
    }
    ctx.restore();
    // lines
    for (let x = 10; x <= 110; x += 5) line(x, 0, x, FH, 'rgba(255,255,255,0.75)', x % 10 === 0 ? 2 : 1);
    line(0, 0, FW, 0, '#fff', 2); line(0, FH, FW, FH, '#fff', 2); line(0, 0, 0, FH, '#fff', 2); line(FW, 0, FW, FH, '#fff', 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1;
    for (let x = 11; x < 110; x++) {
      if (x % 5 === 0) continue;
      for (const hy of [0.5, HASH[0], HASH[1], FH - 0.5]) {
        const [a, b] = w2s(x, hy - 0.35), [c, d] = w2s(x, hy + 0.35);
        ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
      }
    }
    // numbers
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = `bold ${Math.max(9, SC * 1.8)}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let n = 1; n <= 9; n++) {
      const x = 10 + n * 10, lab = String(n <= 5 ? n * 10 : 100 - n * 10);
      for (const ny of [7, FH - 7]) { const [sx, sy] = w2s(x, ny); ctx.fillText(lab, sx, sy); }
    }
    // goal posts
    for (const gx of [0, FW]) {
      line(gx, 26.67 - 3.08, gx, 26.67 + 3.08, '#facc15', 4);
    }
    // LOS / first down
    if (P && P.type === 'scrim' && state !== 'post') {
      line(P.los, 0, P.los, FH, '#60a5fa', 2.5);
      if (!P.twoPt && P.fdX < 110) line(P.fdX, 0, P.fdX, FH, '#facc15', 2.5);
    }
  }

  function drawArt() {
    const previewing = state === 'playcall' && P.preview;
    if (P.type !== 'scrim' || !(previewing || (state === 'presnap' && cfg.routeArt))) return;
    if (previewing) {
      const [sx, sy] = w2s(P.los, 0);
      ctx.font = '800 16px "Segoe UI", sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(`PREVIEW: ${P.previewName}`, sx + 1, Math.max(96, sy + 22) + 1);
      ctx.fillStyle = '#fde047'; ctx.fillText(`PREVIEW: ${P.previewName}`, sx, Math.max(96, sy + 22));
    }
    for (const e of P.ents) {
      if (e.ti !== user) continue;
      const col = f.teams[e.ti].c2;
      if (e.route) {
        let px = e.x, py = e.y;
        for (const w of e.route) { line(px, py, w.x, w.y, col, 2, [6, 4]); px = w.x; py = w.y; }
      }
      if (e.path) { let px = e.x, py = e.y; for (const w of e.path) { line(px, py, w.x, w.y, '#fde68a', 2, [3, 3]); px = w.x; py = w.y; } }
      if (e.assign.type === 'zone') {
        const [sx, sy] = w2s(e.assign.ax, e.assign.ay);
        ctx.fillStyle = e.assign.deep ? 'rgba(96,165,250,0.18)' : 'rgba(250,204,21,0.18)';
        ctx.beginPath(); ctx.ellipse(sx, sy, SC * (e.assign.deep ? 6 : 4), SC * (e.assign.deep ? 6 : 4), 0, 0, Math.PI * 2); ctx.fill();
        line(e.x, e.y, e.assign.ax, e.assign.ay, 'rgba(255,255,255,0.35)', 1, [2, 4]);
      } else if (e.assign.type === 'man' && e.assign.tgt) line(e.x, e.y, e.assign.tgt.x, e.assign.tgt.y, 'rgba(248,113,113,0.6)', 1.5, [2, 3]);
      else if (e.assign.type === 'rush' && e.side === 'D') line(e.x, e.y, e.x - 3, e.y, 'rgba(248,113,113,0.8)', 2);
    }
  }

  function drawEnts() {
    const r = Math.max(5, SC * 0.62);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.max(8, r * 0.95)}px "Segoe UI", sans-serif`;
    // draw defenders first, carrier last
    const order = P.ents.slice().sort((a, b) => (a === P.ball.carrier) - (b === P.ball.carrier));
    for (const e of order) {
      const tm = f.teams[e.ti];
      const [sx, sy] = w2s(e.x, e.y);
      ctx.globalAlpha = P.preview && state === 'playcall' && e.ti !== user ? 0.3 : e.down > 0 ? 0.45 : e.stun > 0 ? 0.7 : 1;
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(sx + 2, sy + 3, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
      if (e === ctrl) {
        ctx.strokeStyle = '#fde047'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(sx, sy, r + 5, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#fde047';
        ctx.beginPath(); ctx.moveTo(sx, sy - r - 9); ctx.lineTo(sx - 6, sy - r - 18); ctx.lineTo(sx + 6, sy - r - 18); ctx.fill();
      }
      ctx.fillStyle = tm.c1;
      ctx.strokeStyle = tm.c2; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // facing tick
      const sp = Math.hypot(e.vx, e.vy);
      if (sp > 0.5) {
        const dx = (flip() ? -e.vx : e.vx) / sp, dy = e.vy / sp;
        ctx.strokeStyle = tm.c2; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx + dx * r * 0.6, sy + dy * r * 0.6); ctx.lineTo(sx + dx * (r + 4), sy + dy * (r + 4)); ctx.stroke();
      }
      ctx.fillStyle = U.textOn(tm.c1);
      ctx.fillText(e.p.num, sx, sy + 0.5);
      if (e.move) { ctx.strokeStyle = '#f472b6'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, r + 2, 0, Math.PI * 2); ctx.stroke(); }
      if (e.eng && e.engBlk) { ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(sx, sy, r + 1.5, 0, Math.PI * 2); ctx.stroke(); }
      if (e === ctrl) {
        ctx.font = `600 ${Math.max(10, r * 0.85)}px "Segoe UI", sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.fillText(`${e.p.pos} ${Data.name(e.p)}`, sx, sy + r + 12);
        ctx.font = `bold ${Math.max(8, r * 0.95)}px "Segoe UI", sans-serif`;
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawBall() {
    const b = P.ball;
    if (!b || b.state === 'dead') return;
    if (b.state === 'held' && !b.carrier) { if (P.type === 'fg') { const [sx, sy] = w2s(b.x, b.y); drawFootball(sx, sy, 1); } return; }
    const x = b.state === 'held' ? b.carrier.x + (flip() ? -0.35 : 0.35) * (b.carrier.side === 'O' ? 1 : -1) : b.x;
    const y = b.state === 'held' ? b.carrier.y + 0.15 : b.y;
    const [sx, sy] = w2s(x, y);
    const z = b.z || 0;
    if (b.state !== 'held') {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(sx, sy, SC * 0.3, SC * 0.18, 0, 0, Math.PI * 2); ctx.fill();
    }
    drawFootball(sx, sy - z * SC * 0.45, 1 + z * 0.04);
    if (b.state === 'air' && b.kind === 'pass') {
      const [lx, ly] = w2s(b.tx, b.ty);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(lx, ly, SC * 0.7, 0, Math.PI * 2); ctx.stroke();
    }
  }
  function drawFootball(sx, sy, s) {
    ctx.fillStyle = '#7c3f12';
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(sx, sy, SC * 0.36 * s, SC * 0.22 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  function drawAim() {
    if (!aiming || !ctrl) return;
    const qb = ctrl;
    const maxD = 25 + eff(qb, 'throwPow') * 0.42;
    let tx = mouse.wx, ty = mouse.wy;
    const d = Math.hypot(tx - qb.x, ty - qb.y);
    const over = d > maxD;
    if (over) { tx = qb.x + (tx - qb.x) / d * maxD; ty = qb.y + (ty - qb.y) / d * maxD; }
    const pressure = P.ents.some(o => o.side === 'D' && !o.eng && o.down <= 0 && dist(o, qb) < 2.5) ? 1 : 0;
    const sig = 0.3 + (1 - eff(qb, 'throwAcc') / 99) * 2.0 * (Math.min(d, maxD) / 20 + 0.3) + pressure * 1.1;
    const lob = keys.ShiftLeft || keys.ShiftRight || lobOn;
    line(qb.x, qb.y, tx, ty, over ? '#f87171' : lob ? '#a5b4fc' : '#fde047', 2, [8, 6]);
    const [sx, sy] = w2s(tx, ty);
    ctx.strokeStyle = over ? '#f87171' : '#fde047'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, Math.max(6, sig * SC), 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '600 12px "Segoe UI", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(Math.min(d, maxD))} yds${lob ? ' · LOB' : ''}${over ? ' · OUT OF RANGE' : ''}${pressure ? ' · PRESSURE' : ''}`, sx, sy - Math.max(6, sig * SC) - 8);
  }

  function drawFloats() {
    if (!P) return;
    ctx.textAlign = 'center';
    ctx.font = `800 ${Math.max(11, SC * 0.7)}px "Segoe UI", sans-serif`;
    for (const fl of floats) {
      const [sx, sy] = w2s(fl.x, fl.y);
      ctx.globalAlpha = Math.min(1, fl.t * 2);
      ctx.fillStyle = '#000'; ctx.fillText(fl.text, sx + 1, sy + 1);
      ctx.fillStyle = '#fff'; ctx.fillText(fl.text, sx, sy);
    }
    ctx.globalAlpha = 1;
  }

  function drawMeter() {
    if (state !== 'meter' || !meter) return;
    const m = meter;
    const bw = Math.min(420, W - 40), bh = 26, x0 = (W - bw) / 2, y0 = H - 120;
    ctx.fillStyle = 'rgba(10,15,25,0.85)';
    ctx.fillRect(x0 - 16, y0 - 46, bw + 32, bh + 84);
    ctx.fillStyle = '#fff'; ctx.font = '700 15px "Segoe UI", sans-serif'; ctx.textAlign = 'center';
    const label = { fg: `Field goal · ${117 - f.ballOn} yds`, xp: 'Extra point', punt: 'Punt', kickoff: 'Kickoff', onside: 'Onside kick' }[m.kind];
    const K = touchMode ? 'Tap KICK' : 'SPACE';
    const instr = m.phase === 0 ? `${K} to start  ·  ${touchMode ? 'stick up/down' : 'W/S'} to aim` : m.phase === 1 ? `${K} to set POWER` : `${K} to set ACCURACY (center)`;
    ctx.fillText(`${label} — ${instr}`, W / 2, y0 - 22);
    ctx.fillStyle = '#1f2937'; ctx.fillRect(x0, y0, bw, bh);
    const grad = ctx.createLinearGradient(x0, 0, x0 + bw, 0);
    grad.addColorStop(0, '#22c55e'); grad.addColorStop(0.8, '#facc15'); grad.addColorStop(1, '#ef4444');
    ctx.fillStyle = grad; ctx.fillRect(x0, y0, bw * m.power, bh);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, bw, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x0 + bw * 0.93, y0, 2, bh);
    // accuracy bar
    const ay = y0 + bh + 10;
    ctx.fillStyle = '#1f2937'; ctx.fillRect(x0, ay, bw, 12);
    ctx.fillStyle = '#16a34a'; ctx.fillRect(x0 + bw / 2 - bw * 0.06, ay, bw * 0.12, 12);
    if (m.phase === 2) { ctx.fillStyle = '#fff'; ctx.fillRect(x0 + bw * (m.acc + 1) / 2 - 2, ay - 4, 4, 20); }
    // aim indicator
    ctx.fillStyle = '#93c5fd';
    ctx.fillText(`Aim ${m.aim >= 0 ? '+' : ''}${(m.aim * 57.3).toFixed(0)}°`, W / 2, ay + 32);
    if (P && P.type !== 'fg') {
      const sx0 = P.kicker || P.punter;
      if (sx0) {
        const L0 = m.kind === 'punt' ? 45 : 60;
        line(sx0.x, sx0.y, sx0.x + Math.cos(m.aim) * L0 * (m.phase ? Math.max(0.3, m.power) : 0.7), sx0.y + Math.sin(m.aim) * L0 * (m.phase ? Math.max(0.3, m.power) : 0.7), 'rgba(147,197,253,0.8)', 2, [6, 6]);
      }
    } else if (P) {
      line(P.spotX, P.by, 120, 26.67 + Math.tan(m.aim) * (120 - P.spotX), 'rgba(147,197,253,0.8)', 2, [6, 6]);
    }
  }

  return { start, drawHelp, isActive: () => state !== 'idle' };
})();
