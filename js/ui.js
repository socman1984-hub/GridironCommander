'use strict';
// ---------- Menus / management UI ----------
const $ = s => document.querySelector(s);
const badge = (t, cls = '') => `<span class="badge ${cls}" style="background:${t.c1};color:${U.textOn(t.c1)};border-color:${t.c2}">${t.abbr}</span>`;
const rc = v => (v >= 85 ? 'r-elite' : v >= 75 ? 'r-good' : v >= 65 ? 'r-avg' : 'r-low');
const ovrPill = v => `<span class="ovr ${rc(v)}">${v}</span>`;
const pLink = p => `<a class="plink" onclick="UI.player(${p.id})">${U.esc(Data.full(p))}</a>`;
const injTag = p => (p.injury && p.injury.weeks > 0 ? `<span class="inj" title="${U.esc(p.injury.type)}">INJ ${p.injury.weeks}w</span>` : '');

const STAT_CATS = {
  passing: { label: 'Passing', cols: [['passCmp', 'CMP'], ['passAtt', 'ATT'], ['passYds', 'YDS'], ['passTD', 'TD'], ['passInt', 'INT'], ['sacked', 'SCK']], sort: 'passYds' },
  rushing: { label: 'Rushing', cols: [['rushAtt', 'ATT'], ['rushYds', 'YDS'], ['rushTD', 'TD'], ['rushLong', 'LNG'], ['fumLost', 'FUM']], sort: 'rushYds' },
  receiving: { label: 'Receiving', cols: [['targets', 'TGT'], ['rec', 'REC'], ['recYds', 'YDS'], ['recTD', 'TD'], ['recLong', 'LNG']], sort: 'recYds' },
  defense: { label: 'Defense', cols: [['tackles', 'TKL'], ['tfl', 'TFL'], ['sacks', 'SCK'], ['defInt', 'INT'], ['pd', 'PD'], ['ff', 'FF'], ['fr', 'FR']], sort: 'tackles' },
  kicking: { label: 'Kicking', cols: [['fgm', 'FGM'], ['fga', 'FGA'], ['fgLong', 'LNG'], ['xpm', 'XPM'], ['xpa', 'XPA'], ['punts', 'PUNTS'], ['puntYds', 'P.YDS']], sort: 'fgm' },
  returns: { label: 'Returns', cols: [['kr', 'KR'], ['krYds', 'KR YDS'], ['pr', 'PR'], ['prYds', 'PR YDS']], sort: 'krYds' }
};

const UI = {
  L: null, tab: 'home',
  trade: { team: null, give: [], get: [], note: '' },
  rosterPos: 'ALL', rosterSort: 'pos', faPos: 'ALL', statsCat: 'passing', statsScope: 'stats', statsTeam: 'all', shopResults: null,

  // ---------- generic ----------
  modal(html, cls = '') {
    $('#modal-root').innerHTML = `<div class="modal-bg" onclick="if(event.target===this)UI.closeModal()"><div class="modal ${cls}">${html}</div></div>`;
  },
  closeModal() { $('#modal-root').innerHTML = ''; },
  toast(msg, kind = 'info') {
    const t = document.createElement('div');
    t.className = 'toast toast-' + kind;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3200);
  },
  save() { if (UI.L) League.save(UI.L); },

  // ---------- title & setup ----------
  title() {
    const has = !!localStorage.getItem(SAVE_KEY);
    $('#app').innerHTML = `<div class="title-screen">
      <div class="title-card">
        <div class="logo-ball">🏈</div>
        <h1>GRIDIRON <span>COMMANDER</span></h1>
        <p class="tag">Build a dynasty. Call the plays. Take the snap yourself.</p>
        <div class="title-btns">
          ${has ? `<button class="btn primary big" onclick="UI.continueGame()">Continue League</button>` : ''}
          <button class="btn ${has ? '' : 'primary'} big" onclick="UI.startNew()">New League</button>
        </div>
        <ul class="features">
          <li>8-team league with a schedule you design</li><li>Control any player on the field</li>
          <li>Drag-to-throw passing, jukes, spins, stiff arms</li><li>Fatigue, injuries, penalties, overtime</li>
          <li>Ratings driven by real production</li><li>Trades, free agency, multi-season dynasty</li>
        </ul>
      </div></div>`;
  },
  continueGame() {
    const L = League.load();
    if (!L) { UI.toast('No saved league found', 'bad'); return UI.title(); }
    UI.L = L;
    UI.hub('home');
  },
  startNew() {
    if (localStorage.getItem(SAVE_KEY) && !confirm('Start a new league? Your current saved league will be replaced.')) return;
    $('#app').innerHTML = `<div class="title-screen"><div class="title-card"><h2>Building your league…</h2><p class="muted">Generating players and simulating last season so every rating is backed by real stats.</p><div class="spinner"></div></div></div>`;
    setTimeout(() => {
      UI.draft = League.create({ userTeam: 0 });
      UI.setupScreen();
    }, 50);
  },
  setupScreen() {
    const L = UI.draft;
    const cards = L.teams.map(t => {
      const qb = L.players[t.depth.QB[0]];
      return `<label class="team-card" style="--c1:${t.c1};--c2:${t.c2}">
        <input type="radio" name="team" value="${t.id}" ${t.id === 0 ? 'checked' : ''}>
        <div class="tc-inner">${badge(t, 'lg')}<div><b>${t.city}</b><div class="tc-name">${t.name}</div></div>
        <div class="tc-stats"><div>OVR ${ovrPill(League.teamOvr(L, t.id))}</div>
        <div class="muted">OFF ${League.unitOvr(L, t.id, ['QB', 'RB', 'WR', 'TE', 'OL'])} · DEF ${League.unitOvr(L, t.id, ['DL', 'LB', 'CB', 'S'])}</div>
        <div class="muted">QB ${U.esc(Data.name(qb))} (${qb.ovr})</div></div></div></label>`;
    }).join('');
    $('#app').innerHTML = `<div class="setup">
      <h1>New League</h1>
      <div class="setup-grid">
        <section class="panel"><h3>1 · Pick your team</h3><div class="team-cards">${cards}</div></section>
        <section class="panel">
          <h3>2 · League settings</h3>
          <label class="field">League name <input id="s-name" value="Gridiron League"></label>
          ${UI.schedFields(L.settings)}
          <label class="field">Trade AI
            <select id="s-tradeai"><option value="lenient">Lenient — easier trades</option><option value="balanced" selected>Balanced</option><option value="tough">Tough negotiators</option></select></label>
          <label class="field">Injury frequency (simulated games)
            <select id="s-inj"><option value="0">Off</option><option value="0.5">Low</option><option value="1" selected>Normal</option><option value="1.7">High</option></select></label>
          <label class="field check"><input type="checkbox" id="s-cap" checked> Salary cap (${U.money(L.settings.cap)})</label>
          <button class="btn primary big" onclick="UI.finishSetup()">Start League</button>
        </section>
      </div></div>`;
    UI.updateSchedPreview();
  },
  schedFields(s) {
    const deadlineOpts = n => { let o = '<option value="0">No deadline</option>'; for (let w = 2; w <= n; w++) o += `<option value="${w}" ${w === s.tradeDeadline ? 'selected' : ''}>Before week ${w}</option>`; return o; };
    return `<div class="field"><span>Schedule</span>
      <label class="radio"><input type="radio" name="s-mode" value="each" ${s.schedMode === 'each' ? 'checked' : ''} onchange="UI.updateSchedPreview()"> Face each opponent
        <select id="s-times" onchange="UI.updateSchedPreview()">${[1, 2, 3, 4].map(n => `<option ${n === s.timesEach ? 'selected' : ''}>${n}</option>`).join('')}</select> time(s)</label>
      <label class="radio"><input type="radio" name="s-mode" value="games" ${s.schedMode === 'games' ? 'checked' : ''} onchange="UI.updateSchedPreview()"> Custom season length
        <input id="s-games" type="number" min="1" max="40" value="${s.totalGames}" style="width:64px" oninput="UI.updateSchedPreview()"> games</label>
      <div class="muted" id="s-preview"></div></div>
      <label class="field">Playoffs
        <select id="s-playoffs">${[[0, 'None — best record wins'], [2, 'Top 2 — championship game'], [4, 'Top 4 — semis + final'], [6, 'Top 6 — byes for top 2']].map(([v, l]) => `<option value="${v}" ${v === s.playoffTeams ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field">Trade deadline <select id="s-deadline">${deadlineOpts(40)}</select></label>`;
  },
  readSched() {
    const mode = document.querySelector('input[name="s-mode"]:checked').value;
    return {
      schedMode: mode, timesEach: +$('#s-times').value, totalGames: U.clamp(+$('#s-games').value || 14, 1, 40),
      playoffTeams: +$('#s-playoffs').value, tradeDeadline: +$('#s-deadline').value
    };
  },
  updateSchedPreview() {
    const s = UI.readSched();
    const n = s.schedMode === 'each' ? s.timesEach * 7 : s.totalGames;
    const el = $('#s-preview');
    if (el) el.textContent = `${n} regular-season games per team (${n} weeks).` + (s.schedMode === 'games' ? ' Opponents rotate as evenly as possible.' : '');
  },
  finishSetup() {
    const L = UI.draft;
    L.userTeam = +document.querySelector('input[name="team"]:checked').value;
    L.name = $('#s-name').value.trim() || 'Gridiron League';
    Object.assign(L.settings, UI.readSched());
    L.settings.tradeAI = $('#s-tradeai').value;
    L.settings.injuryRate = +$('#s-inj').value;
    L.settings.capOn = $('#s-cap').checked;
    League.buildSchedule(L);
    L.news = [];
    League.news(L, `Welcome to the ${L.name}! You are the GM of the ${League.tname(L, L.userTeam)}.`, 'info');
    UI.L = L;
    UI.draft = null;
    League.save(L);
    UI.hub('home');
  },

  // ---------- hub ----------
  hub(tab) {
    if (tab) UI.tab = tab;
    const L = UI.L, t = L.teams[L.userTeam];
    const pending = L.offers.filter(o => o.status === 'pending').length;
    const tabs = [['home', 'Home'], ['roster', 'Roster'], ['depth', 'Depth Chart'], ['schedule', 'Schedule'], ['standings', 'Standings'],
      ['stats', 'Stats'], ['trade', 'Trades'], ['offers', 'Offers' + (pending ? ` <i class="dot">${pending}</i>` : '')], ['fa', 'Free Agents'], ['settings', 'Settings']];
    $('#app').innerHTML = `<header class="topbar" style="--c1:${t.c1};--c2:${t.c2}">
        <div class="tb-left">${badge(t, 'lg')}<div><div class="tb-team">${t.city} ${t.name}</div>
        <div class="muted">${League.recStr(t.rec)} · ${U.esc(L.name)} · Season ${L.season} · ${League.weekLabel(L)}</div></div></div>
        <div class="tb-right"><div><small class="muted">Cap space</small><b>${L.settings.capOn ? U.money(League.capSpace(L, t.id)) : 'No cap'}</b></div>
        <div><small class="muted">Roster</small><b>${t.roster.length}/${ROSTER_MAX}</b></div>
        <div><small class="muted">Team OVR</small><b>${League.teamOvr(L, t.id)}</b></div></div>
      </header>
      <nav class="tabs">${tabs.map(([k, l]) => `<button class="${UI.tab === k ? 'active' : ''}" onclick="UI.hub('${k}')">${l}</button>`).join('')}</nav>
      <main id="view"></main>`;
    const fn = { home: UI.vHome, roster: UI.vRoster, depth: UI.vDepth, schedule: UI.vSchedule, standings: UI.vStandings, stats: UI.vStats,
      trade: UI.vTrade, offers: UI.vOffers, fa: UI.vFA, settings: UI.vSettings }[UI.tab];
    $('#view').innerHTML = fn();
    if (UI.tab === 'trade') UI.tradeSummary();
  },

  vHome() {
    const L = UI.L, uid = L.userTeam, t = L.teams[uid];
    if (L.phase === 'offseason') return UI.vOffseason();
    const g = League.userGame(L);
    let next;
    if (g && !g.played) {
      const opp = L.teams[g.home === uid ? g.away : g.home];
      const home = g.home === uid;
      next = `<div class="next-game">
        <div class="ng-label">${g.playoff ? '🏆 ' + League.roundName(L, L.playoffs.round) : 'Week ' + (L.week + 1)} · ${home ? 'Home' : 'Away'}</div>
        <div class="ng-teams">
          <div class="ng-t">${badge(home ? L.teams[g.away] : t, 'xl')}<b>${(home ? L.teams[g.away] : t).name}</b><span class="muted">${League.recStr((home ? L.teams[g.away] : t).rec)} · OVR ${League.teamOvr(L, home ? g.away : uid)}</span></div>
          <div class="ng-at">@</div>
          <div class="ng-t">${badge(home ? t : L.teams[g.home], 'xl')}<b>${(home ? t : L.teams[g.home]).name}</b><span class="muted">${League.recStr((home ? t : L.teams[g.home]).rec)} · OVR ${League.teamOvr(L, home ? uid : g.home)}</span></div>
        </div>
        <div class="ng-btns">
          <button class="btn primary big" onclick="UI.gameSetup()">▶ Play Game</button>
          <button class="btn" onclick="UI.simUserGame()">Sim Game</button>
          ${L.phase === 'regular' ? `<button class="btn" onclick="UI.simSeason()">Sim to end of regular season</button>` : ''}
        </div>
        <div class="muted small-txt">Opponent: ${U.esc(opp.city)} ${U.esc(opp.name)}</div></div>`;
    } else if (L.phase === 'playoffs') {
      next = `<div class="next-game"><div class="ng-label">🏆 ${League.roundName(L, L.playoffs.round)}</div>
        <p>Your season is over. Watch the rest of the playoffs.</p>
        <button class="btn primary" onclick="UI.simRound()">Sim ${League.roundName(L, L.playoffs.round)}</button></div>`;
    } else next = `<div class="next-game"><p>No game this week.</p><button class="btn primary" onclick="UI.simRound()">Advance</button></div>`;
    const st = League.standings(L);
    const po = L.settings.playoffTeams;
    const stand = `<table class="tbl"><tr><th>#</th><th>Team</th><th>W-L-T</th><th>PF</th><th>PA</th></tr>${st.map((x, i) => `<tr class="${x.id === uid ? 'me' : ''} ${po && i === po - 1 ? 'cutline' : ''}"><td>${i + 1}</td><td>${badge(x, 'sm')} ${x.name}</td><td>${League.recStr(x.rec)}</td><td>${x.rec.pf}</td><td>${x.rec.pa}</td></tr>`).join('')}</table>`;
    const ros = League.roster(L, uid);
    const leaders = [['passYds', 'Passing'], ['rushYds', 'Rushing'], ['recYds', 'Receiving'], ['tackles', 'Tackles'], ['sacks', 'Sacks']].map(([k, lab]) => {
      const p = ros.slice().sort((a, b) => (b.stats[k] || 0) - (a.stats[k] || 0))[0];
      return p && p.stats[k] ? `<div class="leader"><small>${lab}</small>${pLink(p)} <b>${p.stats[k]}</b></div>` : '';
    }).join('');
    const inj = ros.filter(p => p.injury && p.injury.weeks > 0);
    const news = L.news.slice(0, 16).map(n => `<li class="nw-${n.type}"><small>S${n.s} ${typeof n.w === 'number' ? 'W' + n.w : n.w}</small> ${U.esc(n.text)}</li>`).join('');
    const pend = L.offers.filter(o => o.status === 'pending').length;
    return `<div class="home-grid">
      <div class="col">${next}
        ${L.lastResult ? `<div class="panel"><h3>Last game</h3><p class="big-txt">${L.lastResult.text} <button class="btn sm" onclick="UI.boxScore(${L.lastResult.gid})">Box score</button></p></div>` : ''}
        ${pend ? `<div class="panel alert" onclick="UI.hub('offers')">📨 You have ${pend} trade offer${pend > 1 ? 's' : ''} waiting.</div>` : ''}
        <div class="panel"><h3>Team leaders</h3><div class="leaders">${leaders || '<span class="muted">No stats yet</span>'}</div></div>
        <div class="panel"><h3>Injury report</h3>${inj.length ? inj.map(p => `<div>${p.pos} ${pLink(p)} — ${U.esc(p.injury.type)}, ${p.injury.weeks} wk</div>`).join('') : '<span class="muted">Everyone is healthy.</span>'}</div>
      </div>
      <div class="col"><div class="panel"><h3>Standings</h3>${stand}${po ? `<small class="muted">Top ${po} make the playoffs</small>` : ''}</div>
        ${L.phase === 'playoffs' ? UI.bracket() : ''}</div>
      <div class="col"><div class="panel"><h3>League news</h3><ul class="news">${news}</ul></div></div>
    </div>`;
  },

  bracket() {
    const L = UI.L, P = L.playoffs;
    if (!P) return '';
    return `<div class="panel"><h3>Playoffs</h3>${P.rounds.map((r, i) => `<div class="bk-round"><b>${League.roundName(L, i)}</b>${r.map(g => `<div class="bk-game">
      <span class="${g.played && g.winner === g.away ? 'win' : ''}">#${P.seeds.indexOf(g.away) + 1} ${L.teams[g.away].abbr} ${g.played ? g.as : ''}</span> @
      <span class="${g.played && g.winner === g.home ? 'win' : ''}">#${P.seeds.indexOf(g.home) + 1} ${L.teams[g.home].abbr} ${g.played ? g.hs : ''}</span></div>`).join('')}</div>`).join('')}</div>`;
  },

  // ---------- game day ----------
  gameSetup(saveOnly) {
    const s = UI.L.gameSettings;
    const opt = (id, label, opts, val) => `<label class="field">${label}<select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    UI.modal(`<h2>Game settings</h2><div class="gs-grid">
      ${opt('g-q', 'Quarter length', [1, 2, 3, 4, 5, 6, 8, 10, 12, 15].map(n => [n, n + ' min']), s.quarterLen)}
      ${opt('g-diff', 'Difficulty', [['rookie', 'Rookie'], ['pro', 'Pro'], ['allpro', 'All-Pro'], ['legend', 'Legend']], s.difficulty)}
      ${opt('g-mode', 'You play', [['full', 'Offense & defense'], ['offense', 'Offense only (sim defense)']], s.playMode)}
      ${opt('g-run', 'Accelerated clock (runoff between plays)', [[0, 'Off (real stoppage only)'], [10, '10 sec'], [20, '20 sec'], [30, '30 sec'], [40, '40 sec (real)']], s.runoff)}
      ${opt('g-inj', 'Injuries', [['off', 'Off'], ['low', 'Low'], ['normal', 'Normal'], ['high', 'High']], s.injuries)}
      ${opt('g-fat', 'Fatigue', [['off', 'Off'], ['normal', 'Normal'], ['high', 'High']], s.fatigue)}
      ${opt('g-sub', 'Auto-sub when energy below', [[40, '40%'], [50, '50%'], [55, '55%'], [65, '65%'], [75, '75%']], s.subThreshold)}
      ${opt('g-pen', 'Penalties', [[true, 'On'], [false, 'Off']], s.penalties)}
      ${opt('g-ot', 'Overtime', [[true, 'On'], [false, 'Off (ties allowed)']], s.ot)}
      ${opt('g-auto', 'Auto-switch to ball carrier', [[true, 'On'], [false, 'Off']], s.autoSwitch)}
      ${opt('g-speed', 'Game speed', [[0.75, 'Slow'], [1, 'Normal'], [1.25, 'Fast']], s.speed)}
      ${opt('g-zoom', 'Camera', [['close', 'Close'], ['normal', 'Normal'], ['far', 'Wide']], s.zoom)}
      ${opt('g-art', 'Show play art', [[true, 'On'], [false, 'Off']], s.routeArt)}
      ${opt('g-snd', 'Crowd & whistle sound', [[true, 'On'], [false, 'Off']], s.sound !== false)}
      </div><p class="muted small-txt">Playoff games always use overtime until there is a winner.</p>
      <div class="modal-btns"><button class="btn" onclick="UI.closeModal()">Cancel</button>${saveOnly ? `<button class="btn primary" onclick="UI.readGameSettings();UI.save();UI.closeModal();UI.toast('Game settings saved','good')">Save defaults</button>` : `<button class="btn primary big" onclick="UI.startGame()">Kick off ▶</button>`}</div>`, 'wide');
  },
  readGameSettings() {
    const L = UI.L;
    const v = id => $(id).value;
    L.gameSettings = {
      quarterLen: +v('#g-q'), difficulty: v('#g-diff'), playMode: v('#g-mode'), runoff: +v('#g-run'), injuries: v('#g-inj'), fatigue: v('#g-fat'),
      subThreshold: +v('#g-sub'), penalties: v('#g-pen') === 'true', ot: v('#g-ot') === 'true', autoSwitch: v('#g-auto') === 'true',
      speed: +v('#g-speed'), zoom: v('#g-zoom'), routeArt: v('#g-art') === 'true', sound: v('#g-snd') === 'true'
    };
  },
  startGame() {
    const L = UI.L;
    UI.readGameSettings();
    UI.save();
    UI.closeModal();
    const g = League.userGame(L);
    $('#app').classList.add('hidden');
    Live.start(L, g, L.gameSettings, f => {
      $('#app').classList.remove('hidden');
      League.recordGame(L, f, g);
      g.scoring = f.pbp.filter(x => /TOUCHDOWN|field goal is GOOD|field goal GOOD|SAFETY|Two-point|extra point good|\d+-yd field goal is GOOD/i.test(x.text)).map(x => `Q${x.q > 4 ? 'OT' : x.q} ${U.clock(x.clock)} — ${x.text}`);
      UI.finishWeek(g);
    });
  },
  simUserGame() {
    const L = UI.L, g = League.userGame(L);
    if (!g) return;
    League.simGame(L, g);
    UI.finishWeek(g);
  },
  finishWeek(g) {
    const L = UI.L;
    League.simOthers(L, g ? g.id : null);
    League.endWeek(L);
    UI.hub('home');
    if (g) UI.boxScore(g.id);
  },
  simRound() {
    const L = UI.L;
    League.simOthers(L, null);
    League.endWeek(L);
    UI.hub('home');
  },
  simSeason() {
    const L = UI.L;
    if (!confirm('Simulate the rest of the regular season (including your games)?')) return;
    let guard = 0;
    while (L.phase === 'regular' && guard++ < 60) { League.simOthers(L, null); League.endWeek(L); }
    UI.hub('home');
    UI.toast('Regular season complete!');
  },

  findGame(gid) {
    const L = UI.L;
    for (const wk of L.schedule) for (const g of wk) if (g.id === gid) return g;
    if (L.playoffs) for (const r of L.playoffs.rounds) for (const g of r) if (g.id === gid) return g;
    return null;
  },
  boxScore(gid) {
    const L = UI.L, g = UI.findGame(gid);
    if (!g || !g.played) return;
    const H = L.teams[g.home], A = L.teams[g.away];
    let body = '';
    if (g.box) {
      const side = tid => Object.keys(g.box).map(id => L.players[id]).filter(p => p && g.box[p.id] && UI.wasOn(p, tid, g));
      const tbl = (title, rows, cols) => rows.length ? `<h4>${title}</h4><table class="tbl compact"><tr><th>Player</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr>${rows.map(p => `<tr><td>${p.pos} ${pLink(p)}</td>${cols.map(c => `<td>${g.box[p.id][c[0]] || 0}</td>`).join('')}</tr>`).join('')}</table>` : '';
      const teamBox = tid => {
        const ps = side(tid);
        const by = k => ps.filter(p => g.box[p.id][k]).sort((a, b) => (g.box[b.id][k] || 0) - (g.box[a.id][k] || 0));
        return tbl('Passing', by('passAtt'), STAT_CATS.passing.cols) + tbl('Rushing', by('rushAtt'), STAT_CATS.rushing.cols) +
          tbl('Receiving', by('targets'), STAT_CATS.receiving.cols) + tbl('Defense', by('tackles').concat(by('defInt').filter(p => !g.box[p.id].tackles)).slice(0, 10), STAT_CATS.defense.cols) +
          tbl('Kicking', by('fga').concat(by('punts')).concat(by('xpa')).filter((p, i, a) => a.indexOf(p) === i), STAT_CATS.kicking.cols);
      };
      const ts = g.ts || [{}, {}];
      body = `${g.scoring && g.scoring.length ? `<h4>Scoring</h4><ul class="scoring">${g.scoring.map(s => `<li>${U.esc(s)}</li>`).join('')}</ul>` : ''}
        <table class="tbl compact"><tr><th></th><th>${A.abbr}</th><th>${H.abbr}</th></tr>
        ${[['yds', 'Total yards'], ['passYds', 'Passing'], ['rushYds', 'Rushing'], ['firstDowns', 'First downs'], ['turnovers', 'Turnovers'], ['penalties', 'Penalties']].map(([k, l]) => `<tr><td>${l}</td><td>${ts[1][k] || 0}</td><td>${ts[0][k] || 0}</td></tr>`).join('')}</table>
        <div class="box-cols"><div><h3>${badge(A, 'sm')} ${A.name}</h3>${teamBox(g.away)}</div><div><h3>${badge(H, 'sm')} ${H.name}</h3>${teamBox(g.home)}</div></div>`;
    } else {
      const ld = g.leaders || {};
      body = `<p>${['pass', 'rush', 'rec', 'tkl'].map(k => ld[k] ? `${{ pass: 'Passing', rush: 'Rushing', rec: 'Receiving', tkl: 'Tackles' }[k]}: ${U.esc(ld[k].name)} ${ld[k].v}` : '').filter(Boolean).join('<br>')}</p>`;
    }
    UI.modal(`<h2>${badge(A)} ${A.name} ${g.as} — ${g.hs} ${H.name} ${badge(H)}${g.ot ? ' <small>(OT)</small>' : ''}</h2>${body}
      <div class="modal-btns"><button class="btn primary" onclick="UI.closeModal()">Close</button></div>`, 'wide');
  },
  wasOn(p, tid, g) { const b = g.box[p.id]; return b.__t != null ? b.__t === tid : p.teamId === tid; },

  // ---------- roster ----------
  vRoster() {
    const L = UI.L;
    let ros = League.roster(L, L.userTeam);
    if (UI.rosterPos !== 'ALL') ros = ros.filter(p => p.pos === UI.rosterPos);
    const s = UI.rosterSort;
    ros.sort((a, b) => s === 'pos' ? (POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos) || b.ovr - a.ovr) : s === 'ovr' ? b.ovr - a.ovr : s === 'age' ? a.age - b.age : s === 'sal' ? b.contract.salary - a.contract.salary : 0);
    const posBtns = ['ALL', ...POSITIONS].map(p => `<button class="chip ${UI.rosterPos === p ? 'active' : ''}" onclick="UI.rosterPos='${p}';UI.hub()">${p}</button>`).join('');
    const sortBtn = (k, l) => `<th class="sortable ${s === k ? 'sorted' : ''}" onclick="UI.rosterSort='${k}';UI.hub()">${l}</th>`;
    const rows = ros.map(p => {
      const keys = Object.entries(OVR_W[p.pos]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => `<span class="attr"><small>${ATTR_SHORT[k]}</small>${p.attrs[k]}</span>`).join('');
      return `<tr><td>${p.num}</td><td>${pLink(p)} ${injTag(p)}</td><td>${p.pos}</td><td>${p.age}</td><td>${ovrPill(p.ovr)}</td>
        <td class="muted">${p.attrOvr} / ${p.prod ?? '—'}</td><td>${Data.potLabel(p)}</td><td>${keys}</td>
        <td class="small-txt">${Data.statLine(p, p.stats)}</td><td>${U.money(p.contract.salary)}</td><td>${p.contract.years}</td></tr>`;
    }).join('');
    return `<div class="panel"><div class="row-between"><h3>Roster (${League.roster(L, L.userTeam).length})</h3><div class="chips">${posBtns}</div></div>
      <p class="muted small-txt">OVR blends attributes (70%) with on-field production (30%). Columns show ATR / PRD (production score from stats).</p>
      <table class="tbl"><tr><th>#</th><th>Name</th>${sortBtn('pos', 'Pos')}${sortBtn('age', 'Age')}${sortBtn('ovr', 'OVR')}<th>ATR / PRD</th><th>Pot</th><th>Key attributes</th><th>Season</th>${sortBtn('sal', 'Salary')}<th>Yrs</th></tr>${rows}</table></div>`;
  },

  // ---------- depth chart ----------
  vDepth() {
    const L = UI.L, t = L.teams[L.userTeam];
    League.fixDepth(L, t);
    const sec = POSITIONS.map(pos => {
      const ids = t.depth[pos] || [];
      return `<div class="depth-pos"><h4>${pos} <small class="muted">${STARTERS[pos]} starter${STARTERS[pos] > 1 ? 's' : ''}</small></h4>${ids.map((id, i) => {
        const p = L.players[id];
        return `<div class="depth-row ${i < STARTERS[pos] ? 'starter' : ''}"><span class="dn">${i + 1}</span>${ovrPill(p.ovr)} ${pLink(p)} ${injTag(p)}
          <span class="spacer"></span><button class="btn xs" ${i === 0 ? 'disabled' : ''} onclick="UI.moveDepth('${pos}',${i},-1)">▲</button><button class="btn xs" ${i === ids.length - 1 ? 'disabled' : ''} onclick="UI.moveDepth('${pos}',${i},1)">▼</button></div>`;
      }).join('')}</div>`;
    }).join('');
    return `<div class="panel"><div class="row-between"><h3>Depth chart</h3><button class="btn" onclick="UI.autoDepth()">Auto-sort by rating</button></div>
      <p class="muted small-txt">Starters are highlighted. In games, tired players (below your auto-sub energy setting) rotate out for the next player on this list, and injured players are skipped. Base defense uses 3 LBs; nickel uses 3 CBs.</p>
      <div class="depth-grid">${sec}</div></div>`;
  },
  moveDepth(pos, i, d) {
    const t = UI.L.teams[UI.L.userTeam];
    const a = t.depth[pos];
    const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    UI.save(); UI.hub();
  },
  autoDepth() { League.autoDepth(UI.L, UI.L.teams[UI.L.userTeam]); UI.save(); UI.hub(); },

  // ---------- schedule / standings ----------
  vSchedule() {
    const L = UI.L, uid = L.userTeam;
    const weeks = L.schedule.map((wk, i) => `<div class="sched-week ${i === L.week && L.phase === 'regular' ? 'current' : ''}"><h4>Week ${i + 1}</h4>${wk.map(g => {
      const mine = g.home === uid || g.away === uid;
      const res = g.played ? `${g.as}–${g.hs}${g.ot ? ' OT' : ''}` : '';
      let tag = '';
      if (g.played && mine) { const us = g.home === uid ? g.hs : g.as, them = g.home === uid ? g.as : g.hs; tag = `<b class="${us > them ? 'win' : us < them ? 'loss' : ''}">${us > them ? 'W' : us < them ? 'L' : 'T'}</b>`; }
      return `<div class="sched-game ${mine ? 'me' : ''}" ${g.played ? `onclick="UI.boxScore(${g.id})"` : ''}>${badge(L.teams[g.away], 'sm')} @ ${badge(L.teams[g.home], 'sm')} <span class="res">${res}</span> ${tag}</div>`;
    }).join('')}</div>`).join('');
    return `<div class="panel"><h3>Season ${L.season} schedule</h3><p class="muted small-txt">${L.settings.schedMode === 'each' ? `Each team faces every opponent ${L.settings.timesEach}×.` : `${L.settings.totalGames}-game season.`} ${L.settings.tradeDeadline ? `Trade deadline: before week ${L.settings.tradeDeadline}.` : 'No trade deadline.'} Click a result for the box score.</p>
      <div class="sched-grid">${weeks}</div>${L.playoffs ? UI.bracket() : ''}</div>`;
  },
  vStandings() {
    const L = UI.L, st = League.standings(L), po = L.settings.playoffTeams;
    return `<div class="panel"><h3>Standings</h3><table class="tbl"><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>T</th><th>PCT</th><th>PF</th><th>PA</th><th>DIFF</th><th>STRK</th><th>OVR</th><th>OFF</th><th>DEF</th></tr>
      ${st.map((t, i) => `<tr class="${t.id === L.userTeam ? 'me' : ''} ${po && i === po - 1 ? 'cutline' : ''}"><td>${i + 1}</td><td>${badge(t, 'sm')} ${t.city} ${t.name}</td><td>${t.rec.w}</td><td>${t.rec.l}</td><td>${t.rec.t}</td>
      <td>${League.pct(t.rec).toFixed(3).replace(/^0/, '')}</td><td>${t.rec.pf}</td><td>${t.rec.pa}</td><td>${t.rec.pf - t.rec.pa > 0 ? '+' : ''}${t.rec.pf - t.rec.pa}</td>
      <td>${t.rec.streak > 0 ? 'W' + t.rec.streak : t.rec.streak < 0 ? 'L' + (-t.rec.streak) : '—'}</td><td>${League.teamOvr(L, t.id)}</td>
      <td>${League.unitOvr(L, t.id, ['QB', 'RB', 'WR', 'TE', 'OL'])}</td><td>${League.unitOvr(L, t.id, ['DL', 'LB', 'CB', 'S'])}</td></tr>`).join('')}</table>
      ${po ? `<small class="muted">Line marks the playoff cut (top ${po}).</small>` : ''}
      ${L.history.length ? `<h3>Champions</h3>${L.history.map(h => `<div>Season ${h.season}: ${badge(L.teams[h.champ], 'sm')} ${L.teams[h.champ].name} <span class="muted">(your record ${h.user})</span></div>`).join('')}` : ''}
      </div>${L.playoffs ? UI.bracket() : ''}`;
  },

  // ---------- stats ----------
  vStats() {
    const L = UI.L, cat = STAT_CATS[UI.statsCat], key = UI.statsScope;
    let ps = Object.values(L.players);
    if (UI.statsTeam !== 'all') ps = ps.filter(p => String(p.teamId) === UI.statsTeam);
    ps = ps.filter(p => p[key] && cat.cols.some(c => p[key][c[0]])).sort((a, b) => (b[key][cat.sort] || 0) - (a[key][cat.sort] || 0)).slice(0, 50);
    const extra = UI.statsCat === 'passing' ? ['CMP%', 'Y/A'] : UI.statsCat === 'rushing' ? ['YPC'] : UI.statsCat === 'receiving' ? ['Y/R'] : UI.statsCat === 'kicking' ? ['FG%'] : [];
    const ex = (s) => {
      const g = k => s[k] || 0;
      if (UI.statsCat === 'passing') return [g('passAtt') ? (g('passCmp') / g('passAtt') * 100).toFixed(1) : '-', g('passAtt') ? (g('passYds') / g('passAtt')).toFixed(1) : '-'];
      if (UI.statsCat === 'rushing') return [g('rushAtt') ? (g('rushYds') / g('rushAtt')).toFixed(1) : '-'];
      if (UI.statsCat === 'receiving') return [g('rec') ? (g('recYds') / g('rec')).toFixed(1) : '-'];
      if (UI.statsCat === 'kicking') return [g('fga') ? Math.round(g('fgm') / g('fga') * 100) + '%' : '-'];
      return [];
    };
    return `<div class="panel"><div class="row-between"><h3>League stats</h3><div class="chips">
      ${Object.entries(STAT_CATS).map(([k, c]) => `<button class="chip ${UI.statsCat === k ? 'active' : ''}" onclick="UI.statsCat='${k}';UI.hub()">${c.label}</button>`).join('')}</div></div>
      <div class="chips">${[['stats', 'This season'], ['lastStats', 'Last season'], ['career', 'Career']].map(([k, l]) => `<button class="chip ${UI.statsScope === k ? 'active' : ''}" onclick="UI.statsScope='${k}';UI.hub()">${l}</button>`).join('')}
      <select onchange="UI.statsTeam=this.value;UI.hub()"><option value="all">All teams</option>${L.teams.map(t => `<option value="${t.id}" ${UI.statsTeam === String(t.id) ? 'selected' : ''}>${t.city} ${t.name}</option>`).join('')}</select></div>
      <table class="tbl"><tr><th>#</th><th>Player</th><th>Team</th><th>OVR</th><th>GP</th>${cat.cols.map(c => `<th>${c[1]}</th>`).join('')}${extra.map(x => `<th>${x}</th>`).join('')}</tr>
      ${ps.map((p, i) => `<tr class="${p.teamId === L.userTeam ? 'me' : ''}"><td>${i + 1}</td><td>${p.pos} ${pLink(p)}</td><td>${League.abbr(L, p.teamId)}</td><td>${ovrPill(p.ovr)}</td><td>${p[key].gp || 0}</td>
      ${cat.cols.map(c => `<td>${p[key][c[0]] || 0}</td>`).join('')}${ex(p[key]).map(x => `<td>${x}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="12" class="muted">No stats yet.</td></tr>`}</table></div>`;
  },

  // ---------- player card ----------
  player(pid) {
    const L = UI.L, p = L.players[pid];
    if (!p) return;
    const t = p.teamId != null ? L.teams[p.teamId] : null;
    const mine = p.teamId === L.userTeam;
    const isFA = p.teamId == null;
    const relevant = Object.keys(OVR_W[p.pos]);
    const attrs = ATTRS.map(k => `<div class="attr-row ${relevant.includes(k) ? 'key' : ''}"><span>${ATTR_LABEL[k]}</span><div class="bar"><div class="${rc(p.attrs[k])}" style="width:${p.attrs[k]}%"></div></div><b>${p.attrs[k]}</b></div>`).join('');
    const statRow = (lab, s) => s && Object.keys(s).length ? `<tr><td>${lab}</td><td>${s.gp || 0}</td><td>${Data.statLine(p, s)}</td><td>${Data.prodScore(p.pos, s) ?? '—'}</td></tr>` : '';
    const hist = p.history.slice().reverse().map(h => statRow(`S${h.season || 'Pre'} ${h.team}`, h.stats)).join('');
    const ask = isFA ? FA.asking(L, p) : null;
    const val = Trade.value(L, p);
    const expiring = mine && L.phase === 'offseason' && p.contract.years <= 1 && !p.contract.fresh;
    UI.modal(`<div class="pc-header" style="--c1:${t ? t.c1 : '#334'};--c2:${t ? t.c2 : '#99a'}">
        <div class="pc-num">#${p.num}</div><div><h2>${U.esc(Data.full(p))}</h2><div>${p.pos} · Age ${p.age} · ${t ? t.city + ' ' + t.name : 'Free agent'}</div>
        <div class="muted">Potential: ${Data.potLabel(p)} · Trade value ${val.toFixed(1)}</div></div>
        <div class="pc-ovr"><div class="ovr big ${rc(p.ovr)}">${p.ovr}</div><small>Attributes ${p.attrOvr} · Production ${p.prod ?? '—'}</small></div></div>
      ${p.injury && p.injury.weeks > 0 ? `<div class="panel alert bad">Injured: ${U.esc(p.injury.type)} — out ${p.injury.weeks} week(s)</div>` : ''}
      <div class="pc-body"><div><h4>Attributes</h4>${attrs}</div>
      <div><h4>Contract</h4><p>${U.money(p.contract.salary)} / yr · ${p.contract.years} yr${p.contract.years > 1 ? 's' : ''} left${p.contract.fresh ? ' (new deal)' : ''}<br><span class="muted">Market value ${U.money(League.marketSalary(p))}</span>
      ${ask ? `<br>Asking: <b>${U.money(ask.salary)}</b> × ${ask.years} yr` : ''}</p>
      <h4>Stats</h4><table class="tbl compact"><tr><th>Season</th><th>GP</th><th>Line</th><th>PRD</th></tr>${statRow('This season', p.stats)}${hist}${statRow('Career', p.career)}</table>
      <p class="muted small-txt">Rating = 70% attributes + 30% production. Production is graded from stats (passer rating, yards per carry, catch rate, coverage allowed, sacks, FG%, etc.), blending last season with this season as games are played. Strong games can also raise attributes.</p>
      <div class="modal-btns">
        ${mine ? `<button class="btn danger" onclick="UI.release(${p.id})">Release</button><button class="btn" onclick="UI.shop(${p.id})">Shop to league</button><button class="btn" onclick="UI.tradeWith(null,${p.id})">Add to trade</button>` : ''}
        ${expiring ? `<button class="btn primary" onclick="UI.offer(${p.id},true)">Re-sign</button>` : ''}
        ${!mine && !isFA ? `<button class="btn primary" onclick="UI.tradeWith(${p.teamId},${p.id})">Trade for him</button>` : ''}
        ${isFA ? `<button class="btn primary" onclick="UI.offer(${p.id})">Offer contract</button>` : ''}
        <button class="btn" onclick="UI.closeModal()">Close</button></div></div></div>`, 'wide');
  },

  release(pid) {
    const L = UI.L, p = L.players[pid];
    if (L.teams[L.userTeam].roster.length <= ROSTER_MIN) return UI.toast(`You need at least ${ROSTER_MIN} players`, 'bad');
    if (!confirm(`Release ${Data.full(p)}? He becomes a free agent (no dead money).`)) return;
    FA.release(L, pid);
    League.fixDepth(L, L.teams[L.userTeam]);
    UI.save(); UI.closeModal(); UI.hub(); UI.toast(`${Data.full(p)} released`);
  },

  // ---------- trades ----------
  tradeWith(teamId, pid) {
    const L = UI.L;
    UI.closeModal();
    if (!Trade.allowed(L)) return UI.toast('Trades are closed (deadline passed / playoffs)', 'bad');
    if (teamId != null) { UI.trade = { team: teamId, give: [], get: [pid], note: '' }; }
    else { if (UI.trade.team == null) UI.trade.team = L.teams.find(t => t.id !== L.userTeam).id; if (!UI.trade.give.includes(pid)) UI.trade.give.push(pid); }
    UI.hub('trade');
  },
  vTrade() {
    const L = UI.L, uid = L.userTeam;
    if (UI.trade.team == null || UI.trade.team === uid) UI.trade.team = L.teams.find(t => t.id !== uid).id;
    const T = UI.trade, them = L.teams[T.team];
    T.give = T.give.filter(id => L.players[id] && L.players[id].teamId === uid);
    T.get = T.get.filter(id => L.players[id] && L.players[id].teamId === T.team);
    const list = (tid, sel, side) => League.roster(L, tid).sort((a, b) => POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos) || b.ovr - a.ovr).map(p =>
      `<label class="trow ${sel.includes(p.id) ? 'sel' : ''}"><input type="checkbox" ${sel.includes(p.id) ? 'checked' : ''} onchange="UI.toggleTrade('${side}',${p.id},this.checked)">
      <span class="tp">${p.pos}</span>${ovrPill(p.ovr)}<span class="tn">${U.esc(Data.full(p))} ${injTag(p)}</span><span class="muted">${p.age}y</span><span class="muted">${U.money(p.contract.salary)}×${p.contract.years}</span>
      <span class="val" title="Trade value"><i style="width:${Math.min(100, Trade.value(L, p) * 3)}%"></i></span></label>`).join('');
    const allowed = Trade.allowed(L);
    return `${allowed ? '' : `<div class="panel alert bad">The trade deadline has passed. Trades reopen in the offseason.</div>`}
      <div class="trade-top panel"><div>Trade partner: <select onchange="UI.trade={team:+this.value,give:[],get:[],note:''};UI.hub()">${L.teams.filter(t => t.id !== uid).map(t => `<option value="${t.id}" ${t.id === T.team ? 'selected' : ''}>${t.city} ${t.name} (${League.recStr(t.rec)})</option>`).join('')}</select>
        <span class="muted">Their cap space: ${L.settings.capOn ? U.money(League.capSpace(L, T.team)) : '—'}</span></div>
        <div>Shop a player: <select id="shop-sel"><option value="">— choose —</option>${League.roster(L, uid).sort((a, b) => b.ovr - a.ovr).map(p => `<option value="${p.id}">${p.pos} ${U.esc(Data.full(p))} (${p.ovr})</option>`).join('')}</select>
        <button class="btn sm" onclick="UI.shop(+$('#shop-sel').value)">Get offers</button></div></div>
      ${UI.shopResults ? UI.shopHtml() : ''}
      <div class="trade-grid">
        <div class="panel"><h3>You give</h3><div class="tlist">${list(uid, T.give, 'give')}</div></div>
        <div class="panel trade-mid" id="trade-summary"></div>
        <div class="panel"><h3>${badge(them, 'sm')} You get</h3><div class="tlist">${list(T.team, T.get, 'get')}</div></div>
      </div>`;
  },
  toggleTrade(side, id, on) {
    const a = UI.trade[side];
    const i = a.indexOf(id);
    if (on && i < 0) a.push(id);
    if (!on && i >= 0) a.splice(i, 1);
    UI.trade.note = '';
    document.querySelectorAll('.trow').forEach(r => r.classList.toggle('sel', r.querySelector('input').checked));
    UI.tradeSummary();
  },
  tradeSummary() {
    const L = UI.L, T = UI.trade, uid = L.userTeam;
    const box = $('#trade-summary');
    if (!box) return;
    const ev = Trade.aiEval(L, T.team, T.give, T.get);
    const [lab, cls] = Trade.interestLabel(ev.ratio);
    const sal = ids => U.sum(ids, id => L.players[id].contract.salary);
    const myPay = League.payroll(L, uid) - sal(T.give) + sal(T.get);
    const names = ids => ids.map(id => { const p = L.players[id]; return `<div>${p.pos} ${U.esc(Data.full(p))} ${ovrPill(p.ovr)}</div>`; }).join('') || '<span class="muted">nothing</span>';
    const pct = Math.round(U.clamp(ev.ratio, 0, 1.3) / 1.3 * 100);
    box.innerHTML = `<h3>Deal summary</h3>
      <div class="ts-cols"><div><small class="muted">You send</small>${names(T.give)}</div><div><small class="muted">You receive</small>${names(T.get)}</div></div>
      <div class="interest"><div class="meter"><div class="${cls}" style="width:${pct}%"></div><span class="mark"></span></div><b class="${cls}">${T.give.length || T.get.length ? lab : 'Select players'}</b></div>
      <div class="small-txt muted">Your payroll after: ${U.money(myPay)} ${L.settings.capOn ? '/ ' + U.money(L.settings.cap) : ''} · Roster after: ${L.teams[uid].roster.length - T.give.length + T.get.length}</div>
      ${ev.errors.length && (T.give.length || T.get.length) ? `<div class="errs">${ev.errors.map(e => `<div>⚠ ${U.esc(e)}</div>`).join('')}</div>` : ''}
      ${T.note ? `<div class="note">${U.esc(T.note)}</div>` : ''}
      <div class="modal-btns col">
        <button class="btn primary" onclick="UI.proposeTrade()" ${Trade.allowed(L) ? '' : 'disabled'}>Propose trade</button>
        <button class="btn" onclick="UI.suggestTrade()">What would it take?</button>
        <button class="btn" onclick="UI.trade.give=[];UI.trade.get=[];UI.trade.note='';UI.hub()">Clear</button></div>
      <p class="muted small-txt">AI teams value rating, age, potential, contract value and positional need. Piling on depth players has diminishing returns — they want quality, not quantity.</p>`;
  },
  proposeTrade() {
    const L = UI.L, T = UI.trade;
    const ev = Trade.aiEval(L, T.team, T.give, T.get);
    if (ev.errors.length) return UI.toast(ev.errors[0], 'bad');
    if (!ev.ok) { T.note = `${L.teams[T.team].name}: "${Trade.interestLabel(ev.ratio)[0]}. We'd need more value."`; return UI.tradeSummary(); }
    Trade.execute(L, L.userTeam, T.team, T.give, T.get);
    UI.trade = { team: T.team, give: [], get: [], note: '' };
    UI.save(); UI.hub(); UI.toast('Trade accepted!', 'good');
  },
  suggestTrade() {
    const L = UI.L, T = UI.trade;
    if (!T.give.length && !T.get.length) { T.note = 'Pick at least one player first.'; return UI.tradeSummary(); }
    const s = Trade.suggest(L, T.team, T.give, T.get);
    if (!s) { T.note = `${L.teams[T.team].name}: "We can't find a way to make this work."`; return UI.tradeSummary(); }
    T.give = s.gives; T.get = s.gets; T.note = s.note;
    UI.hub();
  },
  shop(pid) {
    const L = UI.L;
    if (!pid) return;
    if (!Trade.allowed(L)) { UI.closeModal(); return UI.toast('Trades are closed right now', 'bad'); }
    UI.closeModal();
    UI.shopResults = { pid, offers: Trade.shop(L, pid) };
    UI.hub('trade');
  },
  shopHtml() {
    const L = UI.L, S = UI.shopResults, p = L.players[S.pid];
    if (!p) return '';
    return `<div class="panel"><div class="row-between"><h3>Offers for ${p.pos} ${U.esc(Data.full(p))} (${p.ovr})</h3><button class="btn sm" onclick="UI.shopResults=null;UI.hub()">✕</button></div>
      ${S.offers.length ? S.offers.map((o, i) => `<div class="offer-row">${badge(L.teams[o.from], 'sm')} offers ${o.give.map(id => { const x = L.players[id]; return `${x.pos} ${pLink(x)} ${ovrPill(x.ovr)}`; }).join(' + ')}
        <button class="btn sm primary" onclick="UI.acceptShop(${i})">Accept</button></div>`).join('') : '<p class="muted">No team made an offer.</p>'}</div>`;
  },
  acceptShop(i) {
    const L = UI.L, o = UI.shopResults.offers[i];
    const errs = Trade.acceptOffer(L, { ...o, status: 'pending' });
    if (errs.length) return UI.toast(errs[0], 'bad');
    UI.shopResults = null;
    UI.save(); UI.hub(); UI.toast('Trade completed!', 'good');
  },

  vOffers() {
    const L = UI.L;
    const pend = L.offers.filter(o => o.status === 'pending');
    const row = o => {
      const from = L.teams[o.from];
      const pl = ids => ids.map(id => { const p = L.players[id]; return p ? `<div>${p.pos} ${pLink(p)} ${ovrPill(p.ovr)} <span class="muted">${p.age}y · ${U.money(p.contract.salary)}×${p.contract.years}</span></div>` : ''; }).join('');
      return `<div class="panel offer"><h3>${badge(from)} ${from.city} ${from.name}</h3><div class="ts-cols"><div><small class="muted">They want</small>${pl(o.get)}</div><div><small class="muted">They give</small>${pl(o.give)}</div></div>
        <div class="modal-btns"><button class="btn primary" onclick="UI.acceptOffer('${o.id}')">Accept</button><button class="btn" onclick="UI.counterOffer('${o.id}')">Counter in trade screen</button><button class="btn danger" onclick="UI.declineOffer('${o.id}')">Decline</button></div></div>`;
    };
    return `<div class="panel"><h3>Trade offers</h3><p class="muted small-txt">AI teams send offers when they need a player you have. Offers expire after a week. ${Trade.allowed(L) ? '' : '<b>Trading is currently closed.</b>'}</p></div>${pend.map(row).join('') || '<div class="panel muted">No pending offers.</div>'}`;
  },
  acceptOffer(id) {
    const L = UI.L, o = L.offers.find(x => String(x.id) === id);
    if (!o) return;
    const errs = Trade.acceptOffer(L, o);
    if (errs.length) { o.status = 'void'; UI.toast(errs[0], 'bad'); }
    else UI.toast('Trade accepted!', 'good');
    UI.save(); UI.hub();
  },
  declineOffer(id) { const o = UI.L.offers.find(x => String(x.id) === id); if (o) o.status = 'declined'; UI.save(); UI.hub(); },
  counterOffer(id) {
    const o = UI.L.offers.find(x => String(x.id) === id);
    if (!o) return;
    UI.trade = { team: o.from, give: o.get.slice(), get: o.give.slice(), note: 'Adjust the deal and propose your counter.' };
    o.status = 'declined';
    UI.hub('trade');
  },

  // ---------- free agency ----------
  vFA() {
    const L = UI.L;
    let list = L.fa.map(id => L.players[id]).filter(Boolean);
    if (UI.faPos !== 'ALL') list = list.filter(p => p.pos === UI.faPos);
    list.sort((a, b) => b.ovr - a.ovr);
    const posBtns = ['ALL', ...POSITIONS].map(p => `<button class="chip ${UI.faPos === p ? 'active' : ''}" onclick="UI.faPos='${p}';UI.hub()">${p}</button>`).join('');
    return `<div class="panel"><div class="row-between"><h3>Free agents (${L.fa.length})</h3><div class="chips">${posBtns}</div></div>
      <p class="muted small-txt">Asking prices drop the longer a player goes unsigned. Players prefer winning teams and a chance to start. Cap space: <b>${L.settings.capOn ? U.money(League.capSpace(L, L.userTeam)) : 'no cap'}</b> · Roster ${L.teams[L.userTeam].roster.length}/${ROSTER_MAX}</p>
      <table class="tbl"><tr><th>Name</th><th>Pos</th><th>Age</th><th>OVR</th><th>Pot</th><th>Last season</th><th>Asking</th><th>Wks</th><th></th></tr>
      ${list.map(p => { const a = FA.asking(L, p); return `<tr><td>${pLink(p)}</td><td>${p.pos}</td><td>${p.age}</td><td>${ovrPill(p.ovr)}</td><td>${Data.potLabel(p)}</td>
        <td class="small-txt">${p.lastStats && p.lastStats.gp ? Data.statLine(p, p.lastStats) : '<span class="muted">—</span>'}</td><td>${U.money(a.salary)} × ${a.years}</td><td>${p.faWeeks || 0}</td>
        <td><button class="btn sm primary" onclick="UI.offer(${p.id})">Offer</button></td></tr>`; }).join('') || '<tr><td colspan="9" class="muted">Nobody available at this position.</td></tr>'}</table></div>`;
  },
  offer(pid, resign) {
    const L = UI.L, p = L.players[pid];
    const a = FA.asking(L, p);
    const startSal = resign ? U.round1(League.marketSalary(p)) : a.salary;
    UI.offerState = { pid, resign: !!resign };
    UI.modal(`<h2>${resign ? 'Re-sign' : 'Offer contract'}: ${p.pos} ${U.esc(Data.full(p))} ${ovrPill(p.ovr)}</h2>
      <p class="muted">${resign ? 'Market value' : 'Asking'}: ${U.money(resign ? League.marketSalary(p) : a.salary)} × ${a.years} yr · Age ${p.age}</p>
      <label class="field">Salary per year ($M)
        <div class="row"><input type="range" id="o-sal-r" min="0.5" max="${Math.max(5, Math.ceil(startSal * 1.8))}" step="0.1" value="${startSal}" oninput="$('#o-sal').value=this.value;UI.offerEval()">
        <input type="number" id="o-sal" step="0.1" min="0.5" value="${startSal}" style="width:80px" oninput="$('#o-sal-r').value=this.value;UI.offerEval()"></div></label>
      <label class="field">Years <select id="o-yrs" onchange="UI.offerEval()">${[1, 2, 3, 4, 5].map(y => `<option ${y === a.years ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
      <div class="interest"><div class="meter"><div id="o-meter"></div><span class="mark"></span></div><b id="o-lab"></b></div>
      <div id="o-err" class="errs"></div>
      <div class="modal-btns"><button class="btn" onclick="UI.closeModal()">Cancel</button><button class="btn primary" onclick="UI.submitOffer()">Submit offer</button></div>`);
    UI.offerEval();
  },
  offerCalc() {
    const L = UI.L, S = UI.offerState, p = L.players[S.pid];
    const sal = +$('#o-sal').value, yrs = +$('#o-yrs').value;
    const ev = FA.evaluate(L, p, L.userTeam, sal, yrs);
    if (S.resign) {
      // own players: compare to market value, a little hometown discount, cap check excludes their current salary
      const mv = League.marketSalary(p);
      ev.score = sal / (mv * 0.95) * (1 - Math.abs(yrs - ev.ask.years) * 0.03);
      ev.errors = ev.errors.filter(e => !e.startsWith('Roster'));
      const space = League.capSpace(L, L.userTeam) + p.contract.salary;
      ev.errors = ev.errors.filter(e => !e.startsWith('Not enough'));
      if (L.settings.capOn && sal > space + 0.001) ev.errors.push(`Not enough cap space (${U.money(space)})`);
      ev.need = U.round1(Math.ceil(sal / ev.score * 10) / 10);
      ev.accept = ev.score >= 1 && !ev.errors.length;
    }
    return { ev, sal, yrs, p };
  },
  offerEval() {
    const { ev } = UI.offerCalc();
    const pct = Math.round(U.clamp(ev.score, 0, 1.3) / 1.3 * 100);
    const cls = ev.score >= 1 ? 'good' : ev.score >= 0.9 ? 'warm' : ev.score >= 0.75 ? 'cold' : 'bad';
    $('#o-meter').style.width = pct + '%';
    $('#o-meter').className = cls;
    $('#o-lab').className = cls;
    $('#o-lab').textContent = ev.score >= 1 ? 'He will sign' : ev.score >= 0.9 ? 'Close — needs a bit more' : ev.score >= 0.75 ? 'Not interested yet' : 'Insulting offer';
    $('#o-err').innerHTML = ev.errors.map(e => `<div>⚠ ${U.esc(e)}</div>`).join('');
  },
  submitOffer() {
    const L = UI.L, S = UI.offerState;
    const { ev, sal, yrs, p } = UI.offerCalc();
    if (ev.errors.length) return UI.toast(ev.errors[0], 'bad');
    if (!ev.accept) { $('#o-err').innerHTML = `<div>${U.esc(Data.name(p))} rejects the offer. He'd want about ${U.money(ev.need)} × ${yrs}.</div>`; return; }
    if (S.resign) {
      p.contract = { salary: U.round1(sal), years: yrs, fresh: true };
      League.news(L, `RE-SIGNED: ${Data.full(p)} (${p.pos}) — ${yrs} yr, ${U.money(sal)}/yr.`, 'good');
    } else FA.sign(L, p, L.userTeam, sal, yrs);
    UI.save(); UI.closeModal(); UI.hub(); UI.toast(`${Data.full(p)} signed!`, 'good');
  },

  // ---------- offseason ----------
  vOffseason() {
    const L = UI.L;
    const champ = L.champion != null ? L.teams[L.champion] : null;
    const exp = League.expiring(L);
    const resigned = League.roster(L, L.userTeam).filter(p => p.contract.fresh);
    return `<div class="home-grid"><div class="col wide">
      <div class="next-game">${champ ? `<div class="ng-label">Season ${L.season} Champion</div><div class="champ">${badge(champ, 'xl')} <h2>${champ.city} ${champ.name}</h2></div>` : ''}
      <p class="muted">Offseason: re-sign your players, make trades, sign free agents, then start the next season. Players will age, develop (young + productive players improve) and some veterans will retire.</p></div>
      <div class="panel"><h3>Expiring contracts (${exp.length})</h3>
      ${exp.length ? `<table class="tbl"><tr><th>Player</th><th>Pos</th><th>Age</th><th>OVR</th><th>Current</th><th>Market</th><th></th></tr>${exp.map(p => `<tr><td>${pLink(p)}</td><td>${p.pos}</td><td>${p.age}</td><td>${ovrPill(p.ovr)}</td><td>${U.money(p.contract.salary)}</td><td>${U.money(League.marketSalary(p))}</td>
        <td><button class="btn sm primary" onclick="UI.offer(${p.id},true)">Re-sign</button> <button class="btn sm" onclick="UI.letGo(${p.id})">Let go</button></td></tr>`).join('')}</table>` : '<p class="muted">No expiring contracts left to decide.</p>'}
      ${resigned.length ? `<p class="small-txt">Re-signed: ${resigned.map(p => U.esc(Data.name(p))).join(', ')}</p>` : ''}
      <p class="muted small-txt">Unsigned expiring players leave in free agency when the new season starts.</p></div>
      <div class="panel"><h3>Next season schedule</h3>${UI.schedFields(L.settings)}
        <button class="btn primary big" onclick="UI.nextSeason()">Start Season ${L.season + 1} ▶</button></div>
      </div><div class="col"><div class="panel"><h3>League news</h3><ul class="news">${L.news.slice(0, 20).map(n => `<li class="nw-${n.type}">${U.esc(n.text)}</li>`).join('')}</ul></div></div></div>`;
  },
  letGo(pid) {
    const L = UI.L;
    FA.release(L, pid);
    League.fixDepth(L, L.teams[L.userTeam]);
    UI.save(); UI.hub();
  },
  nextSeason() {
    const L = UI.L;
    const exp = League.expiring(L);
    if (exp.length && !confirm(`${exp.length} player(s) with expiring contracts will leave. Continue?`)) return;
    const s = UI.readSched();
    League.nextSeason(L, s);
    UI.hub('home');
    UI.toast(`Season ${L.season} is here!`, 'good');
  },

  // ---------- settings ----------
  vSettings() {
    const L = UI.L, s = L.settings;
    return `<div class="panel"><h3>League</h3>
      <p>${U.esc(L.name)} · Season ${L.season} · Cap ${s.capOn ? U.money(s.cap) : 'off'} · Trade AI: ${s.tradeAI} · Injury rate (sims): ${s.injuryRate}× · Playoffs: ${s.playoffTeams || 'none'}</p>
      <div class="modal-btns"><button class="btn primary" onclick="UI.save();UI.toast('Saved','good')">Save now</button>
      <button class="btn" onclick="UI.exportSave()">Export save file</button>
      <label class="btn">Import save file<input type="file" accept=".json" style="display:none" onchange="UI.importSave(this.files[0])"></label>
      <button class="btn" onclick="UI.gameSetup(true)">Default game settings</button>
      <button class="btn danger" onclick="UI.wipe()">Delete league</button></div>
      <p class="muted small-txt">The league auto-saves to this browser after every game and transaction.</p></div>
      <div class="panel"><h3>How to play</h3>
      <ul class="howto"><li><b>Play Game</b> lets you control the action. Pick a play from the play-call screen, then press <kbd>Space</kbd> to snap.</li>
      <li><b>Passing:</b> as QB, click and drag on the field to aim and release to throw. The circle shows how accurate the throw will be; pressure, distance, fatigue and the QB's accuracy make it bigger. Hold <kbd>Shift</kbd> on release for a lob.</li>
      <li><b>Running:</b> <kbd>WASD</kbd>/arrows to move, <kbd>Shift</kbd> to sprint (burns energy), <kbd>Space</kbd> juke, <kbd>E</kbd> spin, <kbd>Q</kbd> stiff arm, <kbd>R</kbd> truck, <kbd>C</kbd> dive. Moves work best timed just before contact.</li>
      <li><b>Any player:</b> press <kbd>Tab</kbd> or click a teammate to take control. Until you move, he follows his assignment. Control a receiver and press <kbd>Space</kbd> to call for the ball.</li>
      <li><b>Defense:</b> <kbd>Space</kbd> dive tackle (or swim move while blocked), <kbd>E</kbd> jump to swat passes.</li>
      <li><b>Kicking:</b> <kbd>Space</kbd> to start, again to lock power, again to lock accuracy (center of the bar). <kbd>W</kbd>/<kbd>S</kbd> aims. Overpowering a kick makes it hook. Press <kbd>F</kbd> on returns for a fair catch or to kneel in the end zone.</li>
      <li><b>Fatigue & injuries:</b> energy drops every play (more when sprinting) and tired players are slower and weaker. Starters auto-rotate out below your threshold. Injured players miss the rest of the game or several weeks.</li></ul></div>`;
  },
  exportSave() {
    const blob = new Blob([JSON.stringify(UI.L)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gridiron-${UI.L.name.replace(/\W+/g, '_')}-S${UI.L.season}.json`;
    a.click();
  },
  importSave(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const L = JSON.parse(r.result);
        if (!L.teams || !L.players) throw new Error('bad file');
        L.gameSettings = Object.assign({}, DEFAULT_GAME_SETTINGS, L.gameSettings || {});
        UI.L = L; League.save(L); UI.hub('home'); UI.toast('League imported', 'good');
      } catch (e) { UI.toast('Could not read that file', 'bad'); }
    };
    r.readAsText(file);
  },
  wipe() {
    if (!confirm('Delete this league permanently? This cannot be undone.')) return;
    League.wipe(); UI.L = null; UI.title();
  }
};
