'use strict';
// ---------- AI play calling + statistical play resolution ----------
const nm = p => Data.name(p);

const AI = {
  fgRange(f, ti) { const k = f.getK(ti); return k ? 40 + k.attrs.kickPow * 0.22 : 44; },

  offCall(f) {
    const o = f.poss, sd = f.score[o] - f.score[1 - o], q = f.q, clk = f.clock;
    const late = (q >= 4 && clk <= 300) || q > 4;
    const fgDist = 117 - f.ballOn;
    const range = AI.fgRange(f, o);
    if (f.phase === 'play' && q === 4 && sd > 0 && clk <= 38 * (4 - f.down) + 3 && f.down < 4) return SPECIAL_PLAYS.kneel;
    if (f.phase === 'play' && q === 2 && clk <= 30 && f.ballOn < 40 && f.down < 4) return SPECIAL_PLAYS.kneel;
    if (f.down === 4) {
      const needTD = late && sd < -3;
      if (needTD || (late && sd < 0 && fgDist > range - 3)) return AI.pickPlay(f, true);
      if (fgDist <= range - 2) return SPECIAL_PLAYS.fg;
      if (f.toGo <= 1 && f.ballOn >= 45 && Math.random() < 0.45) return AI.pickPlay(f, false);
      if (f.toGo <= 3 && f.ballOn >= 55 && fgDist > range - 2 && Math.random() < 0.5) return AI.pickPlay(f, false);
      return SPECIAL_PLAYS.punt;
    }
    if ((q === 2 || q === 4) && clk <= 7 && fgDist <= range && (q === 2 || (sd >= -3 && sd <= 0))) return SPECIAL_PLAYS.fg;
    return AI.pickPlay(f, late && sd < 0);
  },

  pickPlay(f, hurry) {
    const o = f.poss, sd = f.score[o] - f.score[1 - o];
    const late = (f.q >= 4 && f.clock <= 300) || f.q > 4;
    let passP = f.down === 1 ? 0.46 : 0.52;
    if (f.toGo >= 8 && f.down > 1) passP = 0.68;
    if (f.toGo <= 2) passP = 0.3;
    if (f.down === 3 && f.toGo >= 4) passP = 0.84;
    if (hurry) passP = 0.86;
    if (late && sd > 0) passP = 0.28;
    if (f.q === 2 && f.clock <= 120) passP = Math.max(passP, 0.75);
    if (Math.random() < passP) {
      if (hurry && f.clock <= 8 && f.ballOn < 70) return PLAY_BY_ID.hail_mary;
      const long = f.toGo >= 12 || (hurry && sd < -8);
      const opts = long ? ['verts', 'pa_post', 'sail', 'dagger'] : f.toGo <= 4 ? ['slants', 'curl_flat', 'mesh', 'hb_screen', 'sail']
        : ['slants', 'curl_flat', 'mesh', 'sail', 'dagger', 'verts', 'pa_post', 'hb_screen'];
      return PLAY_BY_ID[U.pick(opts)];
    }
    if (f.toGo <= 1 && Math.random() < 0.3) return PLAY_BY_ID.qb_sneak;
    return PLAY_BY_ID[U.weighted(['hb_dive', 'hb_toss', 'hb_draw'], id => ({ hb_dive: 5, hb_toss: 3, hb_draw: f.toGo >= 6 ? 3 : 1.2 }[id]))];
  },

  defCall(f, play) {
    const o = f.poss, sd = f.score[o] - f.score[1 - o];
    if (f.ballOn >= 96 || (f.toGo <= 1 && f.down >= 3)) return Math.random() < 0.7 ? DEF_BY_ID.goal : DEF_BY_ID.man1;
    if (f.q >= 4 && f.clock <= 90 && sd < 0 && f.ballOn < 60) return Math.random() < 0.6 ? DEF_BY_ID.prevent : DEF_BY_ID.cover2;
    const w = { cover3: 30, cover2: 24, man1: 22, blitz: f.down === 3 && f.toGo >= 6 ? 22 : 11, prevent: 0, goal: f.toGo <= 2 ? 8 : 0 };
    return DEF_BY_ID[U.weighted(Object.keys(w), k => w[k])];
  },

  patCall(f) {
    const o = f.poss, lead = f.score[o] - f.score[1 - o];
    if ((f.q === 4 && f.clock < 600) || f.q > 4) if ([-10, -5, -2, 1, 5, 12].includes(lead)) return '2pt';
    return 'xp';
  },

  onside(f) {
    const k = f.kickTeam, diff = f.score[k] - f.score[1 - k];
    return f.q >= 4 && f.clock <= 200 && diff < 0 && diff >= -16;
  },

  timeout(f) {
    if (f.pendingRunoff <= 0 || f.phase !== 'play') return null;
    const o = f.poss, d = 1 - o, q = f.q, clk = f.clock;
    const sdO = f.score[o] - f.score[d];
    if (f.timeouts[o] > 0 && ((q === 2 && clk <= 110 && f.ballOn >= 35) || (q === 4 && clk <= 150 && sdO <= 0) || (q > 4 && clk <= 60))) return o;
    if (f.timeouts[d] > 0 && q === 4 && clk <= 170 && sdO > 0 && sdO <= 16) return d;
    return null;
  }
};

const Sim = {
  playGame(L, h, a, o) {
    const f = new GameFlow(L, h, a, o);
    Sim.run(f);
    return f;
  },
  run(f) {
    let g = 0;
    while (!f.over && g++ < 3000) Sim.step(f);
    if (!f.over) f.end();
  },
  step(f) {
    f.prepareNext();
    if (f.over) return;
    if (f.phase === 'kickoff') { f.apply(Sim.kickoff(f, AI.onside(f))); return; }
    if (f.phase === 'pat') { f.apply(AI.patCall(f) === '2pt' ? Sim.twoPt(f) : Sim.xp(f)); return; }
    const tmo = AI.timeout(f);
    if (tmo != null) f.callTimeout(tmo);
    if (f.beforeSnap()) return;
    const play = AI.offCall(f);
    const dp = AI.defCall(f, play);
    f.apply(Sim.resolve(f, play, dp));
  },

  onField(Lo, Ld) { return [...Object.values(Lo), ...Object.values(Ld)]; },

  resolve(f, play, dp) {
    const o = f.poss, d = 1 - o;
    if (play.type === 'punt') return Sim.punt(f);
    if (play.type === 'fg') return Sim.fg(f);
    const Lo = f.lineup(o, 'off');
    if (play.type === 'kneel') {
      const qb = Lo.QB;
      f.st(qb, 'rushAtt'); f.st(qb, 'rushYds', -1);
      f.afterPlay([qb], 0.3);
      return { kind: 'scrim', yards: -1, time: 2, runoff: 40, desc: `${nm(qb)} takes a knee.` };
    }
    if (play.type === 'spike') {
      const qb = Lo.QB;
      f.st(qb, 'passAtt');
      f.afterPlay([qb], 0.2);
      return { kind: 'scrim', yards: 0, incomplete: true, clockStops: true, time: 1, desc: `${nm(qb)} spikes the ball.` };
    }
    if (f.o.penalties && f.phase === 'play') {
      const r = Math.random();
      if (r < 0.012) return { kind: 'scrim', penalty: { on: 'off', yards: 5, desc: `False start, ${f.teams[o].abbr} (5 yds)` }, time: 0 };
      if (r < 0.024) return { kind: 'scrim', penalty: { on: 'def', yards: 5, desc: `Offside, ${f.teams[d].abbr} (5 yds)` }, time: 0 };
    }
    const Ld = f.lineup(d, dp.pers);
    return play.type === 'run' ? Sim.rush(f, play, dp, Lo, Ld) : Sim.pass(f, play, dp, Lo, Ld);
  },

  front(Ld) { return ['DE1', 'DT1', 'DT2', 'DE2', 'LB1', 'LB2', 'LB3'].map(s => Ld[s]).filter(Boolean); },
  backs(Ld) { return ['CB1', 'CB2', 'CB3', 'FS', 'SS', 'LB1', 'LB2'].map(s => Ld[s]).filter(Boolean); },

  rush(f, play, dp, Lo, Ld) {
    const o = f.poss;
    const bc = play.run === 'sneak' ? Lo.QB : (Lo.RB || Lo.QB);
    const ol = OL_SLOTS.map(s => Lo[s]).filter(Boolean);
    const blk = U.avg(ol, p => f.eff(p, 'blocking') * 0.65 + f.eff(p, 'strength') * 0.35) * 0.85 + (Lo.TE ? f.eff(Lo.TE, 'blocking') * 0.15 : 0);
    const front = Sim.front(Ld);
    const df = U.avg(front, p => f.eff(p, 'tackling') * 0.45 + f.eff(p, 'strength') * 0.35 + f.eff(p, 'awareness') * 0.2);
    const rr = f.eff(bc, 'speed') * 0.25 + f.eff(bc, 'agility') * 0.3 + f.eff(bc, 'strength') * 0.2 + f.eff(bc, 'carrying') * 0.1 + f.eff(bc, 'awareness') * 0.15;
    let mean = 3.6 + (blk - df) / 12 + (rr - 72) / 14, sdv = 3.3;
    if (play.run === 'outside') { mean += 0.2; sdv = 4.6; }
    if (play.run === 'draw') mean += dp.blitz ? 2 : dp.cov === 'prevent' ? 1.5 : -0.3;
    if (play.run === 'sneak') { mean = 1.3 + (blk - df) / 30; sdv = 1.4; }
    if (dp.id === 'goal') mean -= 1.3;
    if (dp.blitz) { mean += 0.3; sdv += 1.2; }
    if (dp.cov === 'prevent') mean += 1.4;
    if (dp.cov === 'zone2') mean += 0.3;
    let y = Math.round(mean + U.gauss() * sdv);
    if (play.run !== 'sneak' && Math.random() < 0.03 + (f.eff(bc, 'speed') - 70) / 900) y += U.ri(10, 50);
    if (y < -6) y = -6 + U.ri(0, 2);
    let td = false;
    if (f.ballOn + y >= 100) { y = 100 - f.ballOn; td = true; }
    const safety = f.ballOn + y <= 0;
    if (safety) y = -f.ballOn;
    const time = U.ri(4, 7);
    const all = Sim.onField(Lo, Ld);
    // holding
    if (f.o.penalties && y > 3 && Math.random() < 0.025) {
      f.afterPlay(all);
      return { kind: 'scrim', penalty: { on: 'off', yards: 10, desc: `Holding, ${f.teams[o].abbr} (10 yds)` }, time };
    }
    const tk = y <= 3 ? U.weighted(front, p => p.attrs.tackling) : U.pick(Sim.backs(Ld));
    f.st(bc, 'rushAtt'); f.st(bc, 'rushYds', y); f.st(bc, 'rushLong', y);
    ol.forEach(p => { f.st(p, 'olRushAtt'); f.st(p, 'olRushYds', y); });
    f.tst(o, 'rushYds', y);
    if (!td) { f.st(tk, 'tackles'); if (y < 0) f.st(tk, 'tfl'); }
    f.injCheck(bc, 1.1); f.injCheck(tk, 0.7);
    f.afterPlay(all, 2.0, { [bc.id]: 1.5 });
    if (!td && !safety && Math.random() < 0.011 * (1.65 - f.eff(bc, 'carrying') / 99)) {
      f.st(bc, 'fumbles'); f.st(tk, 'ff');
      if (Math.random() < 0.55) {
        const rec = U.pick(Object.values(Ld));
        f.st(bc, 'fumLost'); f.st(rec, 'fr');
        return { kind: 'scrim', turnover: 'fumble', newBallOn: U.clamp(100 - (f.ballOn + y), 1, 99), clockStops: true, time,
          desc: `${nm(bc)} FUMBLES after ${y} yds — recovered by ${nm(rec)}!` };
      }
    }
    if (td) f.st(bc, 'rushTD');
    const oob = play.run === 'outside' && Math.random() < 0.25;
    const desc = td ? `${nm(bc)} runs ${y} yds for a TOUCHDOWN!` : safety ? `${nm(bc)} is tackled in the end zone — SAFETY!` :
      `${nm(bc)} ${play.run === 'sneak' ? 'sneaks' : 'runs'} ${y > 0 ? 'for ' + y : y < 0 ? 'for a loss of ' + (-y) : 'for no gain'}${oob ? ', out of bounds' : ''}.`;
    return { kind: 'scrim', yards: y, td, safety, clockStops: oob, time, desc };
  },

  covFor(slot, Ld, dp) {
    const m = dp.pers === 'base' ? { WR1: 'CB1', WR2: 'CB2', WR3: 'SS', TE: 'LB2', RB: 'LB3' } : { WR1: 'CB1', WR2: 'CB2', WR3: 'CB3', TE: 'SS', RB: 'LB1' };
    return Ld[m[slot]] || Ld.FS || Object.values(Ld)[0];
  },

  pass(f, play, dp, Lo, Ld) {
    const o = f.poss, d = 1 - o;
    const qb = Lo.QB;
    const ol = OL_SLOTS.map(s => Lo[s]).filter(Boolean);
    const all = Sim.onField(Lo, Ld);
    const pb = U.avg(ol, p => f.eff(p, 'blocking') * 0.7 + f.eff(p, 'strength') * 0.3);
    const dls = ['DE1', 'DT1', 'DT2', 'DE2'].map(s => Ld[s]).filter(Boolean);
    const pr = U.avg(dls, p => f.eff(p, 'passRush') * 0.7 + f.eff(p, 'speed') * 0.3) + (dp.blitz ? 6 : 0);
    const sackP = U.clamp(0.062 + (pr - pb) / 300 + (dp.blitz ? 0.035 : 0) - (f.eff(qb, 'awareness') - 70) / 900 +
      (play.depth === 'deep' ? 0.02 : 0) - (play.depth === 'screen' ? 0.04 : 0) + (dp.cov === 'prevent' ? -0.03 : 0), 0.015, 0.18);
    const time = U.ri(5, 8);
    if (Math.random() < sackP) {
      let y = -U.ri(3, 9);
      if (f.ballOn + y <= 0) y = -f.ballOn;
      const rushers = dls.concat(dp.blitz ? [Ld.LB1, Ld.LB2].filter(Boolean) : []);
      const sk = U.weighted(rushers, p => p.attrs.passRush);
      f.st(sk, 'sacks'); f.st(sk, 'tackles'); f.st(sk, 'tfl'); f.st(qb, 'sacked');
      f.st(U.pick(ol), 'sacksAllowed');
      f.injCheck(qb, 1.3); f.afterPlay(all);
      if (Math.random() < 0.06 * (1.5 - f.eff(qb, 'carrying') / 99)) {
        f.st(qb, 'fumbles'); f.st(sk, 'ff');
        if (Math.random() < 0.5) {
          f.st(qb, 'fumLost'); f.st(sk, 'fr');
          return { kind: 'scrim', turnover: 'fumble', newBallOn: U.clamp(100 - (f.ballOn + y), 1, 99), clockStops: true, time,
            desc: `${nm(qb)} strip-sacked by ${nm(sk)} — FUMBLE recovered by the defense!` };
        }
      }
      const safety = f.ballOn + y <= 0;
      return { kind: 'scrim', yards: y, sack: true, safety, time, desc: `${nm(qb)} SACKED by ${nm(sk)} for a loss of ${-y}.` };
    }
    // scramble
    if (Math.random() < 0.035 + (f.eff(qb, 'speed') - 60) / 800 && play.depth !== 'screen') {
      let y = Math.max(-2, Math.round(4.5 + U.gauss() * 4 + (f.eff(qb, 'speed') - 70) / 8));
      let td = false;
      if (f.ballOn + y >= 100) { y = 100 - f.ballOn; td = true; }
      f.st(qb, 'rushAtt'); f.st(qb, 'rushYds', y); f.st(qb, 'rushLong', y); if (td) f.st(qb, 'rushTD');
      f.tst(o, 'rushYds', y);
      const tk = U.pick(Sim.backs(Ld)); if (!td) f.st(tk, 'tackles');
      f.afterPlay(all);
      return { kind: 'scrim', yards: y, td, time, clockStops: Math.random() < 0.3, desc: `${nm(qb)} scrambles for ${y}${td ? ' — TOUCHDOWN!' : '.'}` };
    }
    // choose target
    const slots = ['WR1', 'WR2', 'WR3', 'TE', 'RB'].filter(s => Lo[s] && (play.routes ? play.routes[s] !== 'block' : true));
    let tslot;
    if (play.depth === 'screen') tslot = 'RB';
    else tslot = U.weighted(slots, s => {
      const p = Lo[s];
      const r = f.eff(p, 'catching') * 0.5 + f.eff(p, 'speed') * 0.3 + f.eff(p, 'awareness') * 0.2;
      return Math.pow(r, 2) / 1000 * (s === 'RB' ? 0.55 : s === 'TE' ? 0.85 : 1);
    });
    const tgt = Lo[tslot] || Lo.WR1;
    const cov = Sim.covFor(tslot, Ld, dp);
    let depth = play.depth;
    const r0 = Math.random();
    if (depth === 'short') depth = r0 < 0.85 ? 'short' : 'mid';
    else if (depth === 'mid') depth = r0 < 0.25 ? 'short' : r0 < 0.85 ? 'mid' : 'deep';
    else if (depth === 'deep') depth = r0 < 0.15 ? 'short' : r0 < 0.5 ? 'mid' : 'deep';
    const base = { short: 0.69, mid: 0.55, deep: 0.36, screen: 0.8, hail: 0.1 }[depth];
    const qbAcc = f.eff(qb, 'throwAcc'), rc = f.eff(tgt, 'catching') * 0.6 + f.eff(tgt, 'speed') * 0.25 + f.eff(tgt, 'awareness') * 0.15;
    const cv = f.eff(cov, 'coverage') * 0.65 + f.eff(cov, 'speed') * 0.2 + f.eff(cov, 'awareness') * 0.15;
    let comp = base + (qbAcc - 72) / 180 + (rc - 72) / 260 - (cv - 72) / 220 - (pr - pb) / 450;
    const cmods = {
      zone2: { short: 0.02, mid: -0.02, deep: -0.08 }, zone3: { short: 0.01, mid: -0.05, deep: -0.04 }, man: { short: -0.02, mid: 0, deep: 0.02 },
      man0: { short: -0.05, mid: 0.02, deep: 0.06 }, prevent: { short: 0.08, mid: -0.06, deep: -0.15 }
    };
    comp += ((cmods[dp.cov] || {})[depth] || 0) + (dp.id === 'goal' ? 0.08 : 0);
    if (dp.cov === 'man' || dp.cov === 'man0') comp += (f.eff(tgt, 'speed') - f.eff(cov, 'speed')) / 300;
    comp = U.clamp(comp, 0.05, 0.92);
    let intP = { short: 0.02, mid: 0.03, deep: 0.055, screen: 0.01, hail: 0.18 }[depth] + (cv - qbAcc) / 1200 + (pr - pb) / 2000;
    intP = U.clamp(intP, 0.005, 0.25);
    const roll = Math.random();
    f.st(qb, 'passAtt'); f.st(tgt, 'targets'); f.st(cov, 'tgtAllowed');
    const room = 100 - f.ballOn;
    if (roll < intP) {
      const ret = Math.max(0, Math.round(U.gauss() * 8 + 6));
      const air = Math.min(room - 1, depth === 'deep' ? U.ri(18, 40) : depth === 'hail' ? U.ri(35, 50) : U.ri(5, 15));
      const intSpot = f.ballOn + air;
      let newBallOn = 100 - intSpot + ret;
      let defTD = false;
      if (intSpot >= 100) newBallOn = 20;
      if (newBallOn >= 100 || Math.random() < 0.025) { defTD = true; newBallOn = 99; }
      f.st(qb, 'passInt'); f.st(cov, 'defInt'); f.st(cov, 'pd');
      if (defTD) f.st(cov, 'defTD');
      f.afterPlay(all);
      return { kind: 'scrim', turnover: 'int', newBallOn: U.clamp(newBallOn, 1, 99), defTD, clockStops: true, time,
        desc: `${nm(qb)} pass INTERCEPTED by ${nm(cov)}${defTD ? ' — returned for a TOUCHDOWN!' : ', returned ' + ret + ' yds.'}` };
    }
    if (roll < intP + comp) {
      let air = { short: U.ri(0, 6), mid: U.ri(8, 16), deep: U.ri(18, 40), screen: U.ri(-3, 1), hail: U.ri(38, 55) }[depth];
      if (air >= room) air = room;
      const agil = (f.eff(tgt, 'speed') + f.eff(tgt, 'agility')) / 2;
      const yacMean = Math.max(0.8, { short: 3.0, mid: 2.4, deep: 3.2, screen: 5, hail: 1 }[depth] + (agil - 70) / 15 + (dp.blitz ? 1.2 : 0));
      let yac = air >= room ? 0 : Math.round(-yacMean * Math.log(Math.random() + 1e-6));
      if (Math.random() < 0.014) yac += U.ri(12, 40);
      let y = air + yac;
      let td = false;
      if (f.ballOn + y >= 100) { y = room; td = true; }
      if (f.ballOn + y <= 0) y = -f.ballOn + 1;
      f.st(qb, 'passCmp'); f.st(qb, 'passYds', y); f.st(tgt, 'rec'); f.st(tgt, 'recYds', y); f.st(tgt, 'recLong', y);
      f.st(cov, 'cmpAllowed');
      f.tst(o, 'passYds', y);
      if (td) { f.st(qb, 'passTD'); f.st(tgt, 'recTD'); }
      const tk = Math.random() < 0.55 ? cov : U.pick(Sim.backs(Ld));
      if (!td) f.st(tk, 'tackles');
      f.injCheck(tgt, 1); f.injCheck(tk, 0.6);
      f.afterPlay(all, 2.0, { [tgt.id]: 1 });
      if (!td && Math.random() < 0.008 * (1.6 - f.eff(tgt, 'carrying') / 99)) {
        f.st(tgt, 'fumbles'); f.st(tk, 'ff');
        if (Math.random() < 0.55) {
          f.st(tgt, 'fumLost'); f.st(tk, 'fr');
          return { kind: 'scrim', turnover: 'fumble', newBallOn: U.clamp(100 - (f.ballOn + y), 1, 99), clockStops: true, time,
            desc: `${nm(qb)} to ${nm(tgt)} for ${y}... FUMBLE! Recovered by ${nm(tk)}.` };
        }
      }
      const oob = !td && Math.random() < (depth === 'short' ? 0.18 : 0.28);
      return { kind: 'scrim', yards: y, td, time, clockStops: oob,
        desc: `${nm(qb)} complete to ${nm(tgt)} for ${y} yds${td ? ' — TOUCHDOWN!' : oob ? ', out of bounds.' : '.'}` };
    }
    // incomplete
    if (Math.random() < 0.35) f.st(cov, 'pd');
    f.afterPlay(all);
    if (f.o.penalties && (depth === 'mid' || depth === 'deep') && Math.random() < 0.06) {
      const yds = Math.min(depth === 'deep' ? U.ri(18, 35) : U.ri(9, 16), 99 - f.ballOn);
      return { kind: 'scrim', penalty: { on: 'def', yards: yds, spot: true, auto: true, desc: `Pass interference, ${f.teams[d].abbr} (${yds} yds)` }, time: 4 };
    }
    return { kind: 'scrim', yards: 0, incomplete: true, clockStops: true, time: 4, desc: `${nm(qb)} pass to ${nm(tgt)} incomplete.` };
  },

  punt(f) {
    const o = f.poss, d = 1 - o;
    const P = f.getP(o), kr = f.getKR(d);
    let dist = Math.round(36 + (f.eff(P, 'kickPow') - 50) * 0.25 + U.gauss() * 5);
    const land = f.ballOn + dist;
    f.st(P, 'punts');
    if (land >= 100) {
      f.st(P, 'puntYds', 100 - f.ballOn);
      return { kind: 'punt', newBallOn: 20, time: 5, desc: `${nm(P)} punts into the end zone. Touchback.` };
    }
    f.st(P, 'puntYds', dist);
    let ret = 0, td = false;
    const fair = Math.random() < 0.35;
    if (!fair) {
      ret = Math.max(0, Math.round(U.gauss() * 4 + 7 + (f.eff(kr, 'speed') - 75) / 5));
      if (Math.random() < 0.012) { ret = land; td = true; }
      f.st(kr, 'pr'); f.st(kr, 'prYds', ret);
      f.injCheck(kr, 0.8);
    }
    const nb = U.clamp(100 - land + ret, 1, 99);
    return { kind: 'punt', newBallOn: td ? 99 : nb, td, time: U.ri(5, 9),
      desc: `${nm(P)} punts ${dist} yds. ${fair ? nm(kr) + ' fair catch.' : td ? nm(kr) + ' returns it for a TOUCHDOWN!' : nm(kr) + ' returns ' + ret + '.'}` };
  },

  fgProb(f, k, dist) {
    const range = 40 + f.eff(k, 'kickPow') * 0.24;
    if (dist > range + 2) return 0.02;
    const x = Math.max(0, (dist - 18) / (range - 18));
    return U.clamp(0.99 - Math.pow(x, 2.2) * 0.55 * (1.35 - f.eff(k, 'kickAcc') / 99 * 0.7), 0.05, 0.99);
  },
  fg(f) {
    const o = f.poss;
    const k = f.getK(o);
    const dist = 117 - f.ballOn;
    const good = Math.random() < Sim.fgProb(f, k, dist);
    f.st(k, 'fga');
    if (good) { f.st(k, 'fgm'); f.st(k, 'fgLong', dist); }
    return { kind: 'fg', good, dist, time: 4, desc: `${nm(k)} ${dist}-yd field goal is ${good ? 'GOOD' : 'NO GOOD'}.` };
  },
  xp(f) {
    const k = f.getK(f.poss);
    const good = Math.random() < Sim.fgProb(f, k, 33);
    f.st(k, 'xpa'); if (good) f.st(k, 'xpm');
    return { kind: 'xp', good, desc: `${nm(k)} extra point ${good ? 'good' : 'NO GOOD'}.` };
  },
  twoPt(f) {
    const o = f.poss;
    const Lo = f.lineup(o, 'off'), Ld = f.lineup(1 - o, 'base');
    const off = U.avg(Object.values(Lo), p => p.ovr), def = U.avg(Object.values(Ld), p => p.ovr);
    const good = Math.random() < U.clamp(0.46 + (off - def) / 150, 0.25, 0.7);
    return { kind: '2pt', good, desc: `Two-point attempt ${good ? 'GOOD' : 'fails'}.` };
  },
  kickoff(f, onside) {
    const k = f.kickTeam, r = 1 - k;
    const K = f.getK(k), kr = f.getKR(r);
    if (onside) {
      const rec = Math.random() < 0.16;
      return rec ? { kind: 'kickoff', recovered: true, newBallOn: f.ballOn + 11, time: 3, desc: `Onside kick — RECOVERED by ${f.teams[k].abbr}!` }
        : { kind: 'kickoff', newBallOn: U.clamp(100 - (f.ballOn + 11), 1, 99), time: 3, desc: `Onside kick recovered by ${f.teams[r].abbr}.` };
    }
    const tbP = (0.32 + f.eff(K, 'kickPow') / 99 * 0.35) * (f.ballOn < 30 ? 0.3 : 1);
    if (Math.random() < tbP) return { kind: 'kickoff', newBallOn: 25, time: 0, desc: `${nm(K)} kicks off. Touchback.` };
    const catchAt = U.ri(-3, 6) + Math.round((35 - f.ballOn) * 0.8);
    let ret = Math.round(22 + U.gauss() * 6 + (f.eff(kr, 'speed') - 75) / 4 + (35 - f.ballOn) * 0.6);
    let td = false;
    if (Math.random() < 0.007 + (f.eff(kr, 'speed') - 75) / 6000) { td = true; ret = 100; }
    ret = U.clamp(ret, 5, 100);
    f.st(kr, 'kr'); f.st(kr, 'krYds', Math.max(0, ret - catchAt));
    f.injCheck(kr, 0.8);
    return { kind: 'kickoff', newBallOn: td ? 99 : ret, td, time: U.ri(4, 7),
      desc: `${nm(K)} kicks off. ${nm(kr)} returns it ${td ? 'all the way for a TOUCHDOWN!' : 'to the ' + (ret <= 50 ? 'own ' + ret : 'opp ' + (100 - ret)) + '.'}` };
  }
};
