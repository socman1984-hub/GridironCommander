'use strict';
// ---------- GameFlow: rules, clock, downs, scoring, lineups, fatigue, injuries ----------
// Shared by the quick simulator and the playable engine.
const OFF_SLOTS = [['QB', 'QB'], ['RB', 'RB'], ['WR1', 'WR'], ['WR2', 'WR'], ['WR3', 'WR'], ['TE', 'TE'],
  ['LT', 'OL'], ['LG', 'OL'], ['C', 'OL'], ['RG', 'OL'], ['RT', 'OL']];
const OL_SLOTS = ['LT', 'LG', 'C', 'RG', 'RT'];
const DEF_SLOTS = {
  nickel: [['DE1', 'DL'], ['DT1', 'DL'], ['DT2', 'DL'], ['DE2', 'DL'], ['LB1', 'LB'], ['LB2', 'LB'],
    ['CB1', 'CB'], ['CB2', 'CB'], ['CB3', 'CB'], ['FS', 'S'], ['SS', 'S']],
  base: [['DE1', 'DL'], ['DT1', 'DL'], ['DT2', 'DL'], ['DE2', 'DL'], ['LB1', 'LB'], ['LB2', 'LB'], ['LB3', 'LB'],
    ['CB1', 'CB'], ['CB2', 'CB'], ['FS', 'S'], ['SS', 'S']]
};
const FALLBACK = { QB: ['RB', 'WR', 'TE'], RB: ['WR', 'TE', 'CB', 'QB'], WR: ['TE', 'RB', 'CB', 'S'], TE: ['OL', 'WR', 'DL', 'RB'],
  OL: ['DL', 'TE', 'LB'], DL: ['OL', 'LB', 'TE'], LB: ['S', 'DL', 'CB'], CB: ['S', 'WR', 'LB'], S: ['CB', 'LB', 'WR'],
  K: ['P', 'QB', 'WR'], P: ['K', 'QB', 'WR'] };
const PHYS = new Set(['speed', 'strength', 'agility', 'tackling', 'blocking', 'passRush', 'kickPow', 'throwPow']);
const DIFF = { rookie: { cpu: 0.88, user: 1.06 }, pro: { cpu: 1, user: 1 }, allpro: { cpu: 1.05, user: 0.98 }, legend: { cpu: 1.1, user: 0.95 } };

class GameFlow {
  constructor(L, homeId, awayId, o = {}) {
    this.L = L;
    this.tid = [homeId, awayId];
    this.teams = [L.teams[homeId], L.teams[awayId]];
    this.o = Object.assign({ quarterLen: 15, ot: true, injuries: true, injuryRate: 1, fatigue: true, fatigueRate: 1, penalties: true,
      runoff: 28, playoff: false, subThreshold: 58, difficulty: 'pro', userTeam: null }, o);
    const d = DIFF[this.o.difficulty] || DIFF.pro;
    this.cpuMult = d.cpu; this.userMult = d.user;
    this.userTi = this.o.userTeam == null ? -1 : (homeId === this.o.userTeam ? 0 : awayId === this.o.userTeam ? 1 : -1);
    this.score = [0, 0];
    this.q = 1;
    this.qLen = this.o.quarterLen * 60;
    this.clock = this.qLen;
    this.timeouts = [3, 3];
    this.box = {}; this.ts = [{}, {}]; this.energy = {}; this.inj = {}; this.pbp = []; this.events = [];
    this.playNo = 0; this.tmw = { 2: false, 4: false }; this.pendingRunoff = 0; this.over = false; this.ballY = 26.67;
    this.recvFirst = U.ri(0, 1);
    this.setKickoff(1 - this.recvFirst, 35);
    this.poss = this.recvFirst;
    this.down = 1; this.toGo = 10;
    this.scoreByQ = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
  }

  tiOf(p) { return p.teamId === this.tid[0] ? 0 : 1; }
  en(pid) { return this.o.fatigue ? (this.energy[pid] ?? 100) : 100; }
  isAvail(p) { return p && !this.inj[p.id] && !(p.injury && p.injury.weeks > 0); }

  eff(p, a) {
    if (!p) return 45;
    let v = p.attrs[a];
    const e = this.en(p.id);
    v *= PHYS.has(a) ? (0.7 + 0.3 * e / 100) : (0.9 + 0.1 * e / 100);
    if (this.userTi >= 0) v *= this.tiOf(p) === this.userTi ? this.userMult : this.cpuMult;
    return v;
  }

  // ---------- stats ----------
  st(p, k, n = 1) {
    if (!p) return;
    const b = this.box[p.id] || (this.box[p.id] = { gp: 1 });
    if (k.endsWith('Long')) b[k] = Math.max(b[k] || 0, n);
    else b[k] = (b[k] || 0) + n;
  }
  mark(p) { if (p && !this.box[p.id]) this.box[p.id] = { gp: 1 }; }
  tst(ti, k, n = 1) { this.ts[ti][k] = (this.ts[ti][k] || 0) + n; }
  log(text) { this.pbp.push({ q: this.q, clock: this.clock, text, s: this.score.slice(), poss: this.poss }); }
  ev(text, kind = 'info') { this.events.push({ text, kind }); }

  // ---------- lineups ----------
  lineup(ti, unit) {
    const team = this.teams[ti];
    const used = new Set();
    const out = {};
    const slots = unit === 'off' ? OFF_SLOTS : DEF_SLOTS[unit] || DEF_SLOTS.nickel;
    const byPos = {};
    for (const [s, pos] of slots) (byPos[pos] = byPos[pos] || []).push(s);
    const thr = this.o.subThreshold;
    for (const pos in byPos) {
      const list = (team.depth[pos] || []).map(id => this.L.players[id]).filter(p => p && p.teamId === team.id && this.isAvail(p));
      for (const s of byPos[pos]) {
        let c = list.find(p => !used.has(p.id) && this.en(p.id) >= thr);
        if (!c) c = list.filter(p => !used.has(p.id)).sort((a, b) => this.en(b.id) - this.en(a.id))[0];
        if (!c) c = this.fallback(ti, pos, used);
        if (c) { used.add(c.id); out[s] = c; this.mark(c); }
      }
    }
    return out;
  }

  fallback(ti, pos, used) {
    const roster = this.teams[ti].roster.map(id => this.L.players[id]).filter(p => p && this.isAvail(p) && !used.has(p.id));
    for (const fp of FALLBACK[pos] || []) {
      const c = roster.filter(p => p.pos === fp).sort((a, b) => this.en(b.id) - this.en(a.id))[0];
      if (c) return c;
    }
    return roster.filter(p => p.pos !== 'QB' && p.pos !== 'K' && p.pos !== 'P')[0] || roster[0] || null;
  }

  single(ti, pos) {
    const team = this.teams[ti];
    const list = (team.depth[pos] || []).map(id => this.L.players[id]).filter(p => p && p.teamId === team.id && this.isAvail(p));
    const c = list[0] || this.fallback(ti, pos, new Set());
    this.mark(c);
    return c;
  }
  getK(ti) { return this.single(ti, 'K'); }
  getP(ti) { return this.single(ti, 'P'); }
  getKR(ti, exclude = new Set()) {
    const r = this.teams[ti].roster.map(id => this.L.players[id])
      .filter(p => p && this.isAvail(p) && !exclude.has(p.id) && ['RB', 'WR', 'CB'].includes(p.pos) && this.en(p.id) > 35);
    r.sort((a, b) => (b.attrs.speed + b.attrs.agility + b.attrs.catching * 0.5) - (a.attrs.speed + a.attrs.agility + a.attrs.catching * 0.5));
    const c = r[1] || r[0] || this.fallback(ti, 'WR', exclude);
    this.mark(c);
    return c;
  }
  // special teams units (10 players besides kicker/returner)
  stUnit(ti, kind, exclude = new Set()) {
    const pool = this.teams[ti].roster.map(id => this.L.players[id]).filter(p => p && this.isAvail(p) && !exclude.has(p.id));
    let cand;
    if (kind === 'cover') {
      cand = pool.filter(p => ['LB', 'S', 'CB', 'TE', 'RB', 'WR'].includes(p.pos));
      cand.sort((a, b) => (b.attrs.speed + b.attrs.tackling) - (a.attrs.speed + a.attrs.tackling));
    } else {
      cand = pool.filter(p => ['TE', 'LB', 'RB', 'WR', 'S', 'DL', 'OL'].includes(p.pos));
      cand.sort((a, b) => (b.attrs.blocking + b.attrs.strength + b.attrs.speed * 0.5) - (a.attrs.blocking + a.attrs.strength + a.attrs.speed * 0.5));
    }
    // prefer rested players
    cand.sort((a, b) => (this.en(b.id) > 50) - (this.en(a.id) > 50));
    const out = cand.slice(0, 10);
    for (const p of pool) { if (out.length >= 10) break; if (!out.includes(p) && p.pos !== 'K' && p.pos !== 'P') out.push(p); }
    out.forEach(p => this.mark(p));
    return out;
  }

  // ---------- fatigue & injuries ----------
  drain(p, amt) {
    if (!this.o.fatigue || !p) return;
    const st = p.attrs.stamina;
    this.energy[p.id] = U.clamp(this.en(p.id) - amt * (1.55 - st / 99) * this.o.fatigueRate, 0, 100);
  }
  afterPlay(onField, load = 2.0, extra = {}) {
    this.playNo++;
    if (!this.o.fatigue) return;
    const on = new Set((onField || []).map(p => p.id));
    for (const t of this.teams) for (const id of t.roster) {
      if (on.has(id)) continue;
      if (this.energy[id] != null && this.energy[id] < 100) this.energy[id] = Math.min(100, this.energy[id] + 3.4);
    }
    for (const p of onField || []) this.drain(p, load + (extra[p.id] || 0));
  }
  rest(amount) { for (const id in this.energy) this.energy[id] = Math.min(100, this.energy[id] + amount); }

  injCheck(p, mult = 1) {
    if (!this.o.injuries || !p || this.inj[p.id]) return false;
    const r = 0.0042 * this.o.injuryRate * mult * (1.45 - p.attrs.toughness / 99 * 0.8) * (1 + (100 - this.en(p.id)) / 110);
    if (Math.random() >= r) return false;
    const inj = Data.makeInjury();
    p.injury = { type: inj.type, weeks: inj.weeks, fresh: true };
    this.inj[p.id] = true;
    const txt = `INJURY: ${this.teams[this.tiOf(p)].abbr} ${p.pos} ${Data.name(p)} (${inj.type})` + (inj.weeks ? ` — out ${inj.weeks} wk${inj.weeks > 1 ? 's' : ''}` : ' — out for the game');
    this.ev(txt, 'injury');
    this.log(txt);
    return true;
  }

  // ---------- clock ----------
  callTimeout(ti) {
    if (this.timeouts[ti] > 0 && this.pendingRunoff > 0 && this.phase === 'play') {
      this.timeouts[ti]--;
      this.pendingRunoff = 0;
      this.ev(`Timeout — ${this.teams[ti].name} (${this.timeouts[ti]} left)`, 'info');
      this.log(`Timeout ${this.teams[ti].abbr}`);
      return true;
    }
    return false;
  }
  // Apply the between-play runoff. Returns true if the period ended because of it.
  beforeSnap() {
    const r = this.pendingRunoff;
    this.pendingRunoff = 0;
    if (r <= 0 || this.phase !== 'play') return false;
    const before = this.clock;
    if ((this.q === 2 || this.q === 4) && !this.tmw[this.q] && before > 120 && before - r <= 120 && this.qLen > 180) {
      this.clock = 120; this.tmw[this.q] = true; this.ev('Two-minute warning', 'info'); this.log('Two-minute warning');
      return false;
    }
    this.clock = Math.max(0, this.clock - r);
    return this.clock <= 0;
  }
  prepareNext() {
    if (this.over) return;
    if (this.phase !== 'pat' && this.clock <= 0) this.endPeriod();
  }
  endPeriod() {
    const q = this.q;
    this.pendingRunoff = 0;
    if (q === 1 || q === 3) {
      this.q++; this.clock = this.qLen; this.ev(`End of ${U.ordinal(q)} quarter`, 'info'); this.log(`End of ${U.ordinal(q)} quarter`);
      this.rest(8);
      return;
    }
    if (q === 2) {
      this.q = 3; this.clock = this.qLen; this.timeouts = [3, 3];
      this.setKickoff(this.recvFirst, 35);
      this.ev('Halftime', 'info'); this.log('Halftime');
      this.rest(40);
      return;
    }
    if (this.score[0] === this.score[1] && (this.o.playoff || (this.o.ot && q === 4))) {
      this.q++; this.clock = Math.min(600, this.qLen); this.timeouts = [2, 2];
      this.setKickoff(U.ri(0, 1), 35);
      this.ev('OVERTIME — next score wins!', 'info'); this.log('Overtime');
      this.rest(25);
      return;
    }
    this.end();
  }
  end() { this.over = true; this.phase = 'over'; this.log('Final'); }

  addScore(ti, n) {
    this.score[ti] += n;
    this.scoreByQ[ti][Math.min(4, this.q - 1)] += n;
  }
  setKickoff(kt, from = 35) {
    this.phase = 'kickoff'; this.kickTeam = kt; this.ballOn = from; this.ballY = 26.67; this.pendingRunoff = 0;
  }
  firstDown() { this.down = 1; this.toGo = Math.min(10, 100 - this.ballOn); }
  td(ti) {
    this.addScore(ti, 6);
    this.ev(`TOUCHDOWN ${this.teams[ti].name.toUpperCase()}!`, 'score');
    this.poss = ti; this.phase = 'pat'; this.ballOn = 85; this.ballY = 26.67; this.pendingRunoff = 0;
  }

  // ---------- apply a play result ----------
  apply(res) {
    const o = this.poss, d = 1 - o;
    const before = this.clock;
    if (this.phase !== 'pat') this.clock = Math.max(0, this.clock - (res.time || 0));
    let tmwHit = false;
    if ((this.q === 2 || this.q === 4) && !this.tmw[this.q] && before > 120 && this.clock <= 120 && this.clock > 0 && this.qLen > 180) {
      this.tmw[this.q] = true; tmwHit = true;
    }
    if (res.desc) this.log(res.desc);
    this.pendingRunoff = 0;
    switch (res.kind) {
      case 'kickoff': {
        const k = this.kickTeam, r = 1 - k;
        this.poss = res.recovered ? k : r;
        this.ballOn = U.clamp(res.newBallOn, 1, 99);
        this.phase = 'play'; this.firstDown(); this.ballY = 26.67;
        if (res.recovered) this.ev('Onside kick RECOVERED!', 'turnover');
        if (res.td) this.td(this.poss);
        break;
      }
      case 'punt': {
        if (res.recovered) { this.poss = o; this.ev('Muffed punt — recovered by the kicking team!', 'turnover'); }
        else this.poss = d;
        this.ballOn = U.clamp(res.newBallOn, 1, 99); this.firstDown(); this.ballY = 26.67;
        if (res.td) this.td(this.poss);
        break;
      }
      case 'fg':
        if (res.good) { this.addScore(o, 3); this.ev(`Field goal GOOD from ${res.dist} yards!`, 'score'); this.setKickoff(o); }
        else if (res.blocked) { this.ev('Field goal BLOCKED!', 'bad'); this.poss = d; this.ballOn = U.clamp(100 - this.ballOn, 1, 99); this.firstDown(); }
        else { this.ev(`Field goal from ${res.dist} is NO GOOD`, 'bad'); this.poss = d; this.ballOn = Math.max(20, 100 - (this.ballOn - 7)); this.firstDown(); }
        break;
      case 'xp':
        if (res.good) { this.addScore(o, 1); this.ev('Extra point is good', 'info'); } else this.ev('Extra point NO GOOD', 'bad');
        this.setKickoff(o);
        break;
      case '2pt':
        if (res.good) { this.addScore(o, 2); this.ev('Two-point conversion GOOD!', 'score'); } else this.ev('Two-point try fails', 'bad');
        this.setKickoff(o);
        break;
      case 'scrim':
        this.scrim(res);
        break;
    }
    if (tmwHit && this.phase === 'play') { this.pendingRunoff = 0; this.ev('Two-minute warning', 'info'); this.log('Two-minute warning'); }
    if (this.q > 4 && this.score[0] !== this.score[1]) this.end();
  }

  scrim(res) {
    const o = this.poss, d = 1 - o;
    if (res.penalty) { this.penalty(res.penalty); return; }
    if (this.phase === 'pat') {
      if (res.td) { this.addScore(o, 2); this.ev('Two-point conversion GOOD!', 'score'); } else this.ev('Two-point try fails', 'bad');
      this.setKickoff(o);
      return;
    }
    if (res.turnover) {
      this.tst(o, 'turnovers');
      this.poss = d;
      this.ev(res.turnover === 'int' ? 'INTERCEPTED!' : 'FUMBLE — turnover!', 'turnover');
      if (res.defTD) { this.td(d); return; }
      this.ballOn = U.clamp(res.newBallOn, 1, 99); this.firstDown();
      return;
    }
    if (res.safety) { this.addScore(d, 2); this.ev('SAFETY!', 'score'); this.setKickoff(o, 20); return; }
    const y = res.yards || 0;
    this.tst(o, 'plays');
    this.tst(o, 'yds', y);
    if (res.td || this.ballOn + y >= 100) { this.tst(o, 'firstDowns'); this.td(o); return; }
    this.ballOn += y;
    if (y >= this.toGo) { this.firstDown(); this.tst(o, 'firstDowns'); this.ev('First down!', 'fd'); }
    else {
      this.down++; this.toGo -= y;
      if (this.down > 4) {
        this.ev('Turnover on downs', 'info');
        this.poss = d; this.ballOn = U.clamp(100 - this.ballOn, 1, 99); this.firstDown();
        return;
      }
    }
    if (!res.clockStops) this.pendingRunoff = res.runoff ?? this.o.runoff;
  }

  penalty(p) {
    const o = this.poss, d = 1 - o;
    this.ev('FLAG: ' + p.desc, 'flag');
    this.tst(p.on === 'off' ? o : d, 'penalties');
    if (p.on === 'off') {
      const y = Math.min(p.yards, Math.floor(this.ballOn / 2));
      this.ballOn -= y; this.toGo += y;
    } else {
      let y = Math.min(p.yards, p.spot ? 99 - this.ballOn : Math.floor((100 - this.ballOn) / 2));
      if (!p.spot) y = Math.min(p.yards, Math.max(1, Math.floor((100 - this.ballOn) / 2)));
      this.ballOn = Math.min(99, this.ballOn + y);
      this.toGo -= y;
      if (this.toGo <= 0 || p.auto) this.firstDown();
    }
    this.toGo = Math.min(this.toGo, 100 - this.ballOn);
  }

  // Human-readable situation
  downStr() {
    if (this.phase === 'kickoff') return 'Kickoff';
    if (this.phase === 'pat') return 'Extra Point / 2-PT';
    const goal = this.ballOn + this.toGo >= 100;
    return `${U.ordinal(this.down)} & ${goal ? 'Goal' : this.toGo}`;
  }
  spotStr(ti = this.poss) {
    const b = this.ballOn;
    if (b === 50) return 'Midfield';
    return b < 50 ? `Own ${b}` : `Opp ${100 - b}`;
  }
}
