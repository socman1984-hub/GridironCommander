'use strict';
// ---------- League: creation, rosters, schedule, standings, week flow, offseason ----------
const SAVE_KEY = 'gridiron_commander_save_v1';

const DEFAULT_GAME_SETTINGS = {
  quarterLen: 5, difficulty: 'pro', playMode: 'full', runoff: 20, injuries: 'normal', fatigue: 'normal',
  penalties: true, ot: true, autoSwitch: true, subThreshold: 55, speed: 1, zoom: 'normal', routeArt: true
};

const League = {
  create(o) {
    const L = {
      version: 1, name: o.name || 'Gridiron League', season: 1, week: 0, phase: 'regular', nextPid: 1, nextGid: 1,
      teams: [], players: {}, fa: [], schedule: [], playoffs: null, news: [], offers: [], history: [], lastResult: null,
      settings: {
        schedMode: o.schedMode || 'each', timesEach: o.timesEach || 2, totalGames: o.totalGames || 14,
        playoffTeams: o.playoffTeams ?? 4, tradeDeadline: o.tradeDeadline ?? 0, injuryRate: o.injuryRate ?? 1,
        tradeAI: o.tradeAI || 'balanced', cap: 0, capOn: o.capOn !== false
      },
      gameSettings: Object.assign({}, DEFAULT_GAME_SETTINGS),
      userTeam: o.userTeam
    };
    TEAM_DEFS.forEach((d, i) => L.teams.push({ id: i, ...d, roster: [], depth: {}, rec: League.blankRec() }));
    for (const t of L.teams) {
      const off = U.rf(-5, 5);
      for (const pos of POSITIONS) {
        for (let k = 0; k < ROSTER_TEMPLATE[pos]; k++) {
          const starter = k < STARTERS[pos];
          let q = starter ? 72 + off + U.gauss() * 6 : 60 + off * 0.5 + U.gauss() * 5;
          if (pos === 'QB' && k === 0) q = 74 + off + U.gauss() * 7;
          q = U.clamp(q, 48, 94);
          const p = Data.genPlayer(L, pos, q);
          League.addToTeam(L, p, t.id);
        }
      }
    }
    for (let i = 0; i < 40; i++) {
      const pos = U.weighted(POSITIONS, ps => ROSTER_TEMPLATE[ps]);
      const q = U.clamp(57 + U.gauss() * 7, 45, 82);
      const p = Data.genPlayer(L, pos, q);
      L.players[p.id] = p;
      L.fa.push(p.id);
    }
    L.teams.forEach(t => League.autoDepth(L, t));
    League.preseason(L);
    // contracts based on rating
    for (const id in L.players) {
      const p = L.players[id];
      p.contract = { salary: U.round1(Math.max(0.6, League.marketSalary(p) * U.rf(0.8, 1.15))), years: League.contractYears(p) };
    }
    const maxPay = Math.max(...L.teams.map(t => League.payroll(L, t.id)));
    L.settings.cap = Math.ceil((maxPay + 14) / 5) * 5;
    L.teams.forEach(t => League.autoDepth(L, t));
    League.buildSchedule(L);
    League.news(L, `Welcome to the ${L.name}! You are the GM of the ${League.tname(L, L.userTeam)}.`, 'info');
    return L;
  },

  blankRec() { return { w: 0, l: 0, t: 0, pf: 0, pa: 0, streak: 0 }; },
  tname(L, id) { const t = L.teams[id]; return t ? t.city + ' ' + t.name : 'Free Agent'; },
  team(L, id) { return L.teams[id]; },
  roster(L, tid) { return L.teams[tid].roster.map(id => L.players[id]).filter(Boolean); },
  payroll(L, tid) { return U.round1(U.sum(League.roster(L, tid), p => p.contract.salary)); },
  capSpace(L, tid) { return L.settings.capOn ? U.round1(L.settings.cap - League.payroll(L, tid)) : 999; },

  contractYears(p) { return p.age >= 32 ? U.ri(1, 2) : p.age >= 28 ? U.ri(1, 4) : U.ri(2, 5); },

  marketSalary(p) {
    const x = Math.max(0, p.ovr - 48) / 10;
    let s = Math.pow(x, 2.3) * 0.75 * POS_SALARY[p.pos];
    if (p.age >= 31) s *= 0.82;
    if (p.age >= 33) s *= 0.75;
    if (p.age <= 24) s *= 1 + Math.max(0, p.pot - p.ovr) / 80;
    return Math.max(0.6, U.round1(s));
  },

  addToTeam(L, p, tid) {
    const t = L.teams[tid];
    L.players[p.id] = p;
    p.teamId = tid;
    if (!t.roster.includes(p.id)) t.roster.push(p.id);
    const used = new Set(t.roster.filter(id => id !== p.id).map(id => L.players[id] && L.players[id].num));
    if (!p.num || used.has(p.num)) {
      const r = NUM_RANGES[p.pos];
      const opts = [];
      for (let i = 0; i < r.length; i += 2) for (let n = r[i]; n <= r[i + 1]; n++) if (!used.has(n)) opts.push(n);
      if (!opts.length) for (let n = 1; n <= 99; n++) if (!used.has(n)) opts.push(n);
      p.num = U.pick(opts);
    }
    if (t.depth[p.pos] && !t.depth[p.pos].includes(p.id)) t.depth[p.pos].push(p.id);
  },

  removeFromTeam(L, p) {
    const t = L.teams[p.teamId];
    if (t) {
      t.roster = t.roster.filter(id => id !== p.id);
      for (const pos in t.depth) t.depth[pos] = t.depth[pos].filter(id => id !== p.id);
    }
    p.teamId = null;
  },

  autoDepth(L, t) {
    t.depth = {};
    for (const pos of POSITIONS) {
      t.depth[pos] = League.roster(L, t.id).filter(p => p.pos === pos)
        .sort((a, b) => (b.ovr - (b.injury && b.injury.weeks > 0 ? 50 : 0)) - (a.ovr - (a.injury && a.injury.weeks > 0 ? 50 : 0)))
        .map(p => p.id);
    }
  },

  fixDepth(L, t) {
    if (t.id !== L.userTeam) return League.autoDepth(L, t);
    for (const pos of POSITIONS) {
      const cur = (t.depth[pos] || []).filter(id => t.roster.includes(id) && L.players[id].pos === pos);
      const extra = League.roster(L, t.id).filter(p => p.pos === pos && !cur.includes(p.id)).sort((a, b) => b.ovr - a.ovr).map(p => p.id);
      t.depth[pos] = cur.concat(extra);
    }
  },

  updateOvr(p) {
    p.attrOvr = Data.attrOvr(p);
    const cur = Data.prodScore(p.pos, p.stats);
    const gp = p.stats.gp || 0;
    let prod = null;
    if (cur != null && p.prodLast != null) { const w = Math.min(1, gp / 8); prod = cur * w + p.prodLast * (1 - w); }
    else if (cur != null) { const w = Math.min(1, gp / 4); prod = cur * w + p.attrOvr * (1 - w); }
    else if (p.prodLast != null) prod = p.prodLast;
    p.prod = prod == null ? null : Math.round(prod);
    p.ovr = U.clamp(Math.round(prod == null ? p.attrOvr : p.attrOvr * 0.7 + prod * 0.3), 20, 99);
    if (p.pot < p.attrOvr) p.pot = p.attrOvr;
  },

  // A full silent "last season" so every player starts with real production numbers
  preseason(L) {
    const ids = L.teams.map(t => t.id);
    const acc = {};
    for (const h of ids) for (const a of ids) {
      if (h === a) continue;
      const f = Sim.playGame(L, h, a, { injuries: false, quarterLen: 15, runoff: 38 });
      for (const pid in f.box) Data.addStats(acc[pid] || (acc[pid] = {}), f.box[pid]);
    }
    for (const id in L.players) {
      const p = L.players[id];
      if (p.teamId == null) { p.lastStats = {}; p.prodLast = U.clamp(Math.round(p.attrOvr + U.gauss() * 5), 30, 95); }
      else { p.lastStats = acc[id] || {}; p.prodLast = Data.prodScore(p.pos, p.lastStats); }
      p.history.push({ season: 0, team: p.teamId == null ? 'FA' : L.teams[p.teamId].abbr, stats: p.lastStats });
      League.updateOvr(p);
    }
  },

  // ---------- Schedule ----------
  roundRobin(ids) {
    const n = ids.length, arr = ids.slice(), out = [];
    for (let r = 0; r < n - 1; r++) {
      const wk = [];
      for (let i = 0; i < n / 2; i++) {
        const a = arr[i], b = arr[n - 1 - i];
        wk.push((r + i) % 2 ? [a, b] : [b, a]);
      }
      out.push(wk);
      arr.splice(1, 0, arr.pop());
    }
    return out;
  },

  buildSchedule(L) {
    const s = L.settings;
    const ids = U.shuffle(L.teams.map(t => t.id));
    const base = League.roundRobin(ids);
    const per = ids.length - 1;
    const total = s.schedMode === 'each' ? s.timesEach * per : s.totalGames;
    const cycles = Math.ceil(total / per);
    const weeks = [];
    for (let c = 0; c < cycles; c++) {
      const order = U.shuffle(base.map((_, i) => i));
      for (const wi of order) weeks.push(base[wi].map(([h, a]) => (c % 2 ? [a, h] : [h, a])));
    }
    L.schedule = weeks.slice(0, total).map((wk, wi) => wk.map(([h, a]) => ({ id: L.nextGid++, week: wi, home: h, away: a, played: false })));
  },

  currentGames(L) {
    if (L.phase === 'regular') return L.schedule[L.week] || [];
    if (L.phase === 'playoffs' && L.playoffs) return L.playoffs.rounds[L.playoffs.round] || [];
    return [];
  },
  userGame(L) { return League.currentGames(L).find(g => g.home === L.userTeam || g.away === L.userTeam) || null; },
  weekLabel(L) {
    if (L.phase === 'regular') return `Week ${L.week + 1} of ${L.schedule.length}`;
    if (L.phase === 'playoffs') return League.roundName(L, L.playoffs.round);
    return 'Offseason';
  },
  roundName(L, r) {
    const n = L.playoffs ? L.playoffs.seeds.length : 0;
    const names = n === 2 ? ['Championship'] : n === 4 ? ['Semifinals', 'Championship'] : ['Wild Card', 'Semifinals', 'Championship'];
    return names[r] || 'Playoffs';
  },

  standings(L) {
    return L.teams.slice().sort((a, b) => {
      const pa = League.pct(a.rec), pb = League.pct(b.rec);
      if (pb !== pa) return pb - pa;
      const da = a.rec.pf - a.rec.pa, db = b.rec.pf - b.rec.pa;
      if (db !== da) return db - da;
      return b.rec.pf - a.rec.pf;
    });
  },
  pct(r) { const g = r.w + r.l + r.t; return g ? (r.w + 0.5 * r.t) / g : 0; },
  recStr(r) { return r.w + '-' + r.l + (r.t ? '-' + r.t : ''); },

  teamOvr(L, tid) {
    const t = L.teams[tid];
    const parts = [];
    for (const pos of POSITIONS) {
      const ids = (t.depth[pos] || []).slice(0, STARTERS[pos]);
      ids.forEach(id => { const p = L.players[id]; if (p) parts.push(p.ovr * (pos === 'QB' ? 3 : pos === 'K' || pos === 'P' ? 0.4 : 1)); });
    }
    const w = 3 + 0.4 * 2 + (Object.values(STARTERS).reduce((a, b) => a + b, 0) - 3);
    return Math.round(U.sum(parts) / w);
  },
  unitOvr(L, tid, positions) {
    const t = L.teams[tid];
    const arr = [];
    positions.forEach(pos => (t.depth[pos] || []).slice(0, STARTERS[pos]).forEach(id => L.players[id] && arr.push(L.players[id].ovr)));
    return Math.round(U.avg(arr));
  },

  // ---------- Games ----------
  simOpts(L, g) {
    return { injuries: L.settings.injuryRate > 0, injuryRate: L.settings.injuryRate, quarterLen: 15, runoff: 38, playoff: !!g.playoff };
  },
  simGame(L, g) {
    const f = Sim.playGame(L, g.home, g.away, League.simOpts(L, g));
    League.recordGame(L, f, g);
    return f;
  },

  recordGame(L, f, g) {
    const hs = f.score[0], as = f.score[1];
    g.played = true; g.hs = hs; g.as = as; g.ot = f.q > 4;
    g.winner = hs > as ? g.home : as > hs ? g.away : (g.playoff ? g.home : null);
    const isUser = g.home === L.userTeam || g.away === L.userTeam;
    if (!g.playoff) {
      const H = L.teams[g.home].rec, A = L.teams[g.away].rec;
      H.pf += hs; H.pa += as; A.pf += as; A.pa += hs;
      if (hs > as) { H.w++; A.l++; H.streak = H.streak > 0 ? H.streak + 1 : 1; A.streak = A.streak < 0 ? A.streak - 1 : -1; }
      else if (as > hs) { A.w++; H.l++; A.streak = A.streak > 0 ? A.streak + 1 : 1; H.streak = H.streak < 0 ? H.streak - 1 : -1; }
      else { H.t++; A.t++; H.streak = 0; A.streak = 0; }
    }
    for (const pid in f.box) {
      const p = L.players[pid];
      if (!p) continue;
      Data.addStats(p.stats, f.box[pid]);
      Data.addStats(p.career, f.box[pid]);
    }
    // injuries
    for (const pid in f.inj) {
      const p = L.players[pid];
      if (!p || !p.injury) continue;
      if (p.injury.weeks <= 0) p.injury = null;
      else if (p.teamId === L.userTeam || p.ovr >= 76)
        League.news(L, `${League.abbr(L, p.teamId)} ${p.pos} ${Data.full(p)} injured (${p.injury.type}) — out ${p.injury.weeks} wk${p.injury.weeks > 1 ? 's' : ''}.`, p.teamId === L.userTeam ? 'bad' : 'info');
    }
    // development + rating refresh
    for (const pid in f.box) {
      const p = L.players[pid];
      if (!p) continue;
      League.gameDev(p, f.box[pid]);
      League.updateOvr(p);
    }
    g.leaders = League.leaders(L, f);
    if (isUser) {
      g.box = {};
      for (const pid in f.box) g.box[pid] = Object.assign({ __t: L.players[pid] ? L.players[pid].teamId : null }, f.box[pid]);
      g.ts = f.ts;
    }
    // notable performances
    for (const pid in f.box) {
      const s = f.box[pid], p = L.players[pid];
      if (!p) continue;
      const msg = (s.passYds >= 330 && `threw for ${s.passYds} yards`) || (s.rushYds >= 140 && `ran for ${s.rushYds} yards`) ||
        (s.recYds >= 140 && `had ${s.recYds} receiving yards`) || ((s.sacks || 0) >= 3 && `recorded ${s.sacks} sacks`) ||
        ((s.defInt || 0) >= 2 && `picked off ${s.defInt} passes`);
      if (msg) League.news(L, `${League.abbr(L, p.teamId)} ${p.pos} ${Data.full(p)} ${msg}.`, 'stat');
    }
    if (isUser) {
      const us = g.home === L.userTeam ? hs : as, them = g.home === L.userTeam ? as : hs;
      const opp = g.home === L.userTeam ? g.away : g.home;
      L.lastResult = { gid: g.id, text: `${us > them ? 'W' : us < them ? 'L' : 'T'} ${us}-${them} vs ${L.teams[opp].abbr}` };
    }
  },

  abbr(L, tid) { return tid == null ? 'FA' : L.teams[tid].abbr; },

  leaders(L, f) {
    const best = (k) => {
      let b = null, v = 0;
      for (const pid in f.box) if ((f.box[pid][k] || 0) > v) { v = f.box[pid][k]; b = pid; }
      return b ? { pid: +b, v, name: Data.name(L.players[b]), team: f.tid[L.players[b] && L.players[b].teamId === f.tid[0] ? 0 : 1] } : null;
    };
    return { pass: best('passYds'), rush: best('rushYds'), rec: best('recYds'), tkl: best('tackles') };
  },

  // Players who outperform their attributes slowly improve during the season
  gameDev(p, box) {
    const gp = Data.prodScore(p.pos, Object.assign({ gp: 1 }, box), true);
    if (gp == null) return;
    const keys = Object.keys(OVR_W[p.pos]);
    const youth = p.age <= 25 ? 1.3 : p.age <= 29 ? 1 : 0.6;
    if (gp - p.attrOvr > 8 && Math.random() < 0.22 * youth) {
      const k = U.pick(keys);
      if (p.attrs[k] < 99 && p.attrOvr < p.pot + 3) p.attrs[k]++;
    } else if (gp - p.attrOvr < -14 && p.age >= 29 && Math.random() < 0.12) {
      const k = U.pick(keys);
      p.attrs[k] = Math.max(20, p.attrs[k] - 1);
    }
  },

  // Sim all unplayed games this week (optionally excluding one)
  simOthers(L, exceptId) {
    for (const g of League.currentGames(L)) if (!g.played && g.id !== exceptId) League.simGame(L, g);
  },
  weekDone(L) { return League.currentGames(L).every(g => g.played); },

  weeklyUpkeep(L) {
    for (const id in L.players) {
      const p = L.players[id];
      if (!p.injury) continue;
      if (p.injury.fresh) p.injury.fresh = false;
      else p.injury.weeks--;
      if (p.injury.weeks <= 0) {
        if (p.teamId === L.userTeam) League.news(L, `${Data.full(p)} has returned from injury.`, 'good');
        p.injury = null;
      }
    }
    FA.weekly(L);
    L.offers = L.offers.filter(o => L.week - o.week < 1 && o.status === 'pending');
    if (Trade.allowed(L)) { Trade.aiTrades(L); Trade.generateOffers(L); }
    L.teams.forEach(t => { if (t.id !== L.userTeam) League.autoDepth(L, t); else League.fixDepth(L, t); });
  },

  endWeek(L) {
    if (L.phase === 'regular') {
      League.weeklyUpkeep(L);
      L.week++;
      if (L.week >= L.schedule.length) League.endRegular(L);
    } else if (L.phase === 'playoffs') {
      League.weeklyUpkeep(L);
      L.playoffs.round++;
      League.buildPlayoffRound(L);
    }
    League.save(L);
  },

  endRegular(L) {
    const n = L.settings.playoffTeams;
    const st = League.standings(L);
    if (!n) { League.crown(L, st[0].id); return; }
    L.phase = 'playoffs';
    L.playoffs = { seeds: st.slice(0, n).map(t => t.id), round: 0, rounds: [], champion: null };
    League.news(L, `Regular season complete! Playoff field: ${L.playoffs.seeds.map((id, i) => `#${i + 1} ${L.teams[id].abbr}`).join(', ')}.`, 'info');
    League.buildPlayoffRound(L);
  },

  buildPlayoffRound(L) {
    const P = L.playoffs, s = P.seeds;
    let pairs = [];
    if (P.round === 0) {
      if (s.length === 2) pairs = [[s[0], s[1]]];
      else if (s.length === 4) pairs = [[s[0], s[3]], [s[1], s[2]]];
      else pairs = [[s[2], s[5]], [s[3], s[4]]];
    } else {
      const winners = P.rounds[P.round - 1].map(g => g.winner);
      let alive = (s.length === 6 && P.round === 1) ? [s[0], s[1], ...winners] : winners;
      alive.sort((a, b) => s.indexOf(a) - s.indexOf(b));
      if (alive.length === 1) { League.crown(L, alive[0]); return; }
      if (alive.length === 2) pairs = [[alive[0], alive[1]]];
      else pairs = [[alive[0], alive[3]], [alive[1], alive[2]]];
    }
    P.rounds.push(pairs.map(([h, a]) => ({ id: L.nextGid++, home: h, away: a, played: false, playoff: true, round: P.round })));
  },

  crown(L, tid) {
    L.phase = 'offseason';
    if (L.playoffs) L.playoffs.champion = tid;
    L.champion = tid;
    const ut = L.teams[L.userTeam];
    L.history.push({ season: L.season, champ: tid, user: League.recStr(ut.rec) });
    League.news(L, `🏆 The ${League.tname(L, tid)} are Season ${L.season} champions!`, tid === L.userTeam ? 'good' : 'info');
    League.save(L);
  },

  // ---------- Offseason ----------
  expiring(L) {
    return League.roster(L, L.userTeam).filter(p => p.contract.years <= 1 && !p.contract.fresh);
  },

  nextSeason(L, sched) {
    // 1) contracts
    for (const t of L.teams) {
      for (const p of League.roster(L, t.id)) {
        if (p.contract.fresh) { delete p.contract.fresh; continue; }
        p.contract.years--;
        if (p.contract.years > 0) continue;
        if (t.id !== L.userTeam && p.ovr >= 64 && p.age <= 32 && Math.random() < 0.72) {
          p.contract = { salary: League.marketSalary(p), years: League.contractYears(p) };
        } else {
          League.removeFromTeam(L, p);
          p.faWeeks = 0;
          L.fa.push(p.id);
          if (t.id === L.userTeam) League.news(L, `${Data.full(p)} (${p.pos}) left in free agency.`, 'info');
        }
      }
    }
    for (const id of L.fa) { const p = L.players[id]; if (p.contract.fresh) delete p.contract.fresh; }
    // 2) stats rollover, aging, progression, retirement
    const retired = [];
    for (const id in L.players) {
      const p = L.players[id];
      const sp = Data.prodScore(p.pos, p.stats);
      p.history.push({ season: L.season, team: League.abbr(L, p.teamId), stats: p.stats });
      if (p.history.length > 12) p.history.shift();
      p.lastStats = p.stats;
      p.prodLast = sp != null ? sp : (p.prodLast != null ? Math.round((p.prodLast + p.attrOvr) / 2) : null);
      p.stats = {};
      p.age++;
      let d = p.age <= 23 ? U.ri(1, 5) : p.age <= 26 ? U.ri(0, 4) : p.age <= 29 ? U.ri(-1, 2) : p.age <= 31 ? U.ri(-3, 1) : U.ri(-5, 0);
      if (p.age <= 26 && p.pot - p.attrOvr > 8) d += 1;
      if (p.prod != null) d += Math.round(U.clamp((p.prod - p.attrOvr) / 12, -2, 2));
      for (const k of Object.keys(OVR_W[p.pos])) {
        let dd = d + U.ri(-1, 1);
        if (k === 'speed' && p.age >= 30) dd -= 1;
        p.attrs[k] = U.clamp(p.attrs[k] + dd, 15, 99);
      }
      if (p.age >= 30) p.attrs.stamina = U.clamp(p.attrs.stamina - U.ri(0, 2), 30, 99);
      p.injury = null;
      League.updateOvr(p);
      const retire = (p.age >= 36) || (p.age >= 34 && Math.random() < 0.45) || (p.age >= 31 && p.ovr < 55 && Math.random() < 0.5);
      if (retire) retired.push(p);
    }
    for (const p of retired) {
      if (p.ovr >= 75 || p.teamId === L.userTeam) League.news(L, `${League.abbr(L, p.teamId)} ${p.pos} ${Data.full(p)} has retired at age ${p.age}.`, 'info');
      if (p.teamId != null) League.removeFromTeam(L, p);
      L.fa = L.fa.filter(id => id !== p.id);
      delete L.players[p.id];
    }
    // 3) rookies + FA reset
    for (let i = 0; i < 30; i++) {
      const pos = U.weighted(POSITIONS, ps => ROSTER_TEMPLATE[ps]);
      const q = U.clamp(54 + U.gauss() * 7, 42, 80);
      const p = Data.genPlayer(L, pos, q, U.ri(21, 23));
      p.pot = U.clamp(p.attrOvr + U.ri(6, 20), p.attrOvr, 99);
      p.prodLast = null;
      p.lastStats = {};
      League.updateOvr(p);
      p.contract = { salary: League.marketSalary(p), years: 1 };
      L.players[p.id] = p;
      L.fa.push(p.id);
    }
    L.fa.forEach(id => { L.players[id].faWeeks = 0; });
    // 4) new season state
    L.season++;
    L.week = 0;
    L.phase = 'regular';
    L.playoffs = null;
    L.champion = null;
    L.offers = [];
    L.lastResult = null;
    L.settings.cap = U.round1(L.settings.cap * 1.03);
    L.teams.forEach(t => { t.rec = League.blankRec(); });
    Object.assign(L.settings, sched || {});
    // AI fills rosters; the league also fills your roster up to the minimum if needed
    FA.aiSign(L, true);
    League.fillUserMinimum(L);
    L.teams.forEach(t => League.fixDepth(L, t));
    League.buildSchedule(L);
    League.news(L, `Season ${L.season} begins! Rookies and veterans are available in free agency.`, 'info');
    League.save(L);
  },

  fillUserMinimum(L) {
    const t = L.teams[L.userTeam];
    const signed = [];
    while (t.roster.length < ROSTER_MIN) {
      // position with the biggest shortfall vs. the roster template
      const pos = POSITIONS.slice().sort((a, b) => (League.roster(L, t.id).filter(p => p.pos === a).length - ROSTER_TEMPLATE[a]) -
        (League.roster(L, t.id).filter(p => p.pos === b).length - ROSTER_TEMPLATE[b]))[0];
      const cand = L.fa.map(id => L.players[id]).filter(p => p.pos === pos).sort((a, b) => b.ovr - a.ovr)[0]
        || L.fa.map(id => L.players[id]).sort((a, b) => b.ovr - a.ovr)[0];
      if (!cand) break;
      FA.sign(L, cand, t.id, Math.min(FA.asking(L, cand).salary, 1.0), 1);
      signed.push(`${cand.pos} ${Data.full(cand)}`);
    }
    if (signed.length) League.news(L, `The league filled your roster to the ${ROSTER_MIN}-player minimum with 1-year deals: ${signed.join(', ')}.`, 'bad');
  },

  news(L, text, type = 'info') {
    L.news.unshift({ s: L.season, w: L.phase === 'regular' ? L.week + 1 : L.phase, text, type });
    if (L.news.length > 120) L.news.length = 120;
  },

  // ---------- Persistence ----------
  save(L) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(L)); return true; }
    catch (e) { console.error('Save failed', e); return false; }
  },
  load() {
    try {
      const s = localStorage.getItem(SAVE_KEY);
      if (!s) return null;
      const L = JSON.parse(s);
      L.gameSettings = Object.assign({}, DEFAULT_GAME_SETTINGS, L.gameSettings || {});
      return L;
    } catch (e) { console.error('Load failed', e); return null; }
  },
  wipe() { localStorage.removeItem(SAVE_KEY); }
};
