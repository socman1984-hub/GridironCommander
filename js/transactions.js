'use strict';
// ---------- Trades ----------
const TRADE_MARGIN = { lenient: 0.95, balanced: 1.07, tough: 1.2 };

const Trade = {
  allowed(L) {
    if (L.phase === 'offseason') return true;
    if (L.phase !== 'regular') return false;
    const d = L.settings.tradeDeadline;
    return !d || L.week < d;
  },

  // Base, team-agnostic value of a player
  value(L, p) {
    let v = POS_TRADE[p.pos] * Math.exp((p.ovr - 60) / 9);
    const a = p.age;
    v *= a <= 23 ? 1.2 : a <= 26 ? 1.1 : a <= 29 ? 1.0 : a <= 31 ? 0.8 : a <= 33 ? 0.6 : 0.4;
    if (a <= 25) v *= 1 + Math.max(0, p.pot - p.ovr) / 60;
    const mkt = League.marketSalary(p);
    v *= U.clamp(1 + (mkt - p.contract.salary) / (mkt + 6) * 0.35, 0.7, 1.3);
    if (p.injury && p.injury.weeks > 0) v *= p.injury.weeks > 6 ? 0.6 : 0.85;
    return v;
  },

  // How much a specific team needs this player, given the roster after the trade
  need(L, tid, p, incoming, outgoing) {
    const out = new Set(outgoing);
    const group = League.roster(L, tid).filter(x => x.pos === p.pos && !out.has(x.id));
    incoming.forEach(id => { const x = L.players[id]; if (x.pos === p.pos && !group.includes(x)) group.push(x); });
    group.sort((a, b) => b.ovr - a.ovr);
    const rank = group.indexOf(p);
    const S = STARTERS[p.pos];
    let f = rank < S ? 1.15 : rank < S + 1 ? 0.85 : 0.55;
    if (group.length > ROSTER_TEMPLATE[p.pos] + 2) f *= 0.8;
    return f;
  },

  isStarter(L, tid, p) {
    const d = L.teams[tid].depth[p.pos] || [];
    return d.indexOf(p.id) > -1 && d.indexOf(p.id) < STARTERS[p.pos];
  },

  // AI evaluation: aiRecv = players coming to AI, aiGive = players AI sends away
  aiEval(L, aiId, aiRecv, aiGive, otherId = L.userTeam) {
    const recvVals = aiRecv.map(id => { const p = L.players[id]; return Trade.value(L, p) * Trade.need(L, aiId, p, aiRecv, aiGive); }).sort((a, b) => b - a);
    const wIn = [1, 0.75, 0.55, 0.4, 0.3, 0.25, 0.2];
    const recv = U.sum(recvVals.map((v, i) => v * (wIn[i] ?? 0.15)));
    const bestQB = (L.teams[aiId].depth.QB || [])[0];
    const giveVals = aiGive.map(id => {
      const p = L.players[id];
      let v = Trade.value(L, p);
      if (Trade.isStarter(L, aiId, p)) v *= 1.12;
      if (id === bestQB) v *= 1.4;
      return v;
    }).sort((a, b) => b - a);
    const wOut = [1, 0.9, 0.8, 0.7, 0.6, 0.55, 0.5];
    const give = U.sum(giveVals.map((v, i) => v * (wOut[i] ?? 0.45)));
    const margin = TRADE_MARGIN[L.settings.tradeAI] || 1.07;
    const errors = Trade.validate(L, otherId, aiId, aiRecv, aiGive);
    const ratio = give <= 0.001 ? (recv > 0 ? 5 : 0) : recv / (give * margin);
    return { ratio, ok: ratio >= 1 && !errors.length, recv, give, errors };
  },

  // aGives go from team A to B; bGives from B to A
  validate(L, aId, bId, aGives, bGives) {
    const e = [];
    if (!Trade.allowed(L)) e.push('Trade deadline has passed');
    if (!aGives.length && !bGives.length) e.push('Add players to the trade');
    const aSize = L.teams[aId].roster.length - aGives.length + bGives.length;
    const bSize = L.teams[bId].roster.length - bGives.length + aGives.length;
    if (aSize > ROSTER_MAX) e.push(`${L.teams[aId].abbr} would exceed ${ROSTER_MAX} players`);
    if (bSize > ROSTER_MAX) e.push(`${L.teams[bId].abbr} would exceed ${ROSTER_MAX} players`);
    if (aSize < ROSTER_MIN) e.push(`${L.teams[aId].abbr} would drop below ${ROSTER_MIN} players`);
    if (bSize < ROSTER_MIN) e.push(`${L.teams[bId].abbr} would drop below ${ROSTER_MIN} players`);
    if (L.settings.capOn) {
      const sal = ids => U.sum(ids, id => L.players[id].contract.salary);
      const aPay = League.payroll(L, aId) - sal(aGives) + sal(bGives);
      const bPay = League.payroll(L, bId) - sal(bGives) + sal(aGives);
      if (aPay > L.settings.cap + 0.05 && sal(bGives) > sal(aGives)) e.push(`${L.teams[aId].abbr} would be over the cap (${U.money(aPay)})`);
      if (bPay > L.settings.cap + 0.05 && sal(aGives) > sal(bGives)) e.push(`${L.teams[bId].abbr} would be over the cap (${U.money(bPay)})`);
    }
    return e;
  },

  execute(L, aId, bId, aGives, bGives, silent) {
    aGives.forEach(id => { const p = L.players[id]; League.removeFromTeam(L, p); League.addToTeam(L, p, bId); });
    bGives.forEach(id => { const p = L.players[id]; League.removeFromTeam(L, p); League.addToTeam(L, p, aId); });
    League.fixDepth(L, L.teams[aId]);
    League.fixDepth(L, L.teams[bId]);
    if (!silent) {
      const list = ids => ids.map(id => `${L.players[id].pos} ${Data.full(L.players[id])}`).join(', ') || 'nothing';
      League.news(L, `TRADE: ${L.teams[aId].abbr} send ${list(aGives)} to ${L.teams[bId].abbr} for ${list(bGives)}.`,
        aId === L.userTeam || bId === L.userTeam ? 'trade' : 'info');
    }
  },

  interestLabel(r) {
    if (r >= 1) return ['Deal!', 'good'];
    if (r >= 0.9) return ['Very close', 'warm'];
    if (r >= 0.75) return ['Getting warmer', 'warm'];
    if (r >= 0.5) return ['Not close', 'cold'];
    return ['Insulting', 'bad'];
  },

  // Try to make a user proposal acceptable: add user players or remove AI players
  suggest(L, aiId, userGives, userGets) {
    const base = Trade.aiEval(L, aiId, userGives, userGets);
    if (base.ok) return { gives: userGives, gets: userGets, note: 'They already like this deal.' };
    const uid = L.userTeam;
    const cands = League.roster(L, uid).filter(p => !userGives.includes(p.id)).sort((a, b) => Trade.value(L, a) - Trade.value(L, b));
    // one extra player
    for (const p of cands) {
      const g = userGives.concat(p.id);
      if (Trade.aiEval(L, aiId, g, userGets).ok) return { gives: g, gets: userGets, note: `Add ${p.pos} ${Data.full(p)} and they'll accept.` };
    }
    // two extra players
    const top = cands.slice(-14);
    for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
      const g = userGives.concat(top[i].id, top[j].id);
      if (Trade.aiEval(L, aiId, g, userGets).ok)
        return { gives: g, gets: userGets, note: `Add ${top[i].pos} ${Data.full(top[i])} and ${top[j].pos} ${Data.full(top[j])}.` };
    }
    // remove AI players from the ask
    if (userGets.length > 1) {
      const sorted = userGets.slice().sort((a, b) => Trade.value(L, L.players[a]) - Trade.value(L, L.players[b]));
      for (const id of sorted) {
        const gets = userGets.filter(x => x !== id);
        if (Trade.aiEval(L, aiId, userGives, gets).ok) return { gives: userGives, gets, note: `They'd do it without ${Data.full(L.players[id])}.` };
      }
    }
    return null;
  },

  // Build a package from AI team `aiId` for target player (owned by another team)
  buildPackage(L, aiId, targetId) {
    const target = L.players[targetId];
    const ownerId = target.teamId;
    const tv = Trade.value(L, target);
    const pool = League.roster(L, aiId).filter(p => !(p.injury && p.injury.weeks > 2));
    const starterQB = (L.teams[aiId].depth.QB || [])[0];
    const cand = pool.filter(p => p.id !== starterQB).map(p => ({ p, v: Trade.value(L, p) })).sort((a, b) => a.v - b.v);
    const fits = (give) => {
      const ev = Trade.aiEval(L, aiId, [targetId], give, ownerId);
      if (!ev.ok) return false;
      return Trade.validate(L, ownerId, aiId, [targetId], give).length === 0;
    };
    // single player around target value
    const singles = cand.filter(c => c.v >= tv * 0.8 && c.v <= tv * 1.25 && c.p.pos !== target.pos || c.v >= tv * 0.8 && c.v <= tv * 1.25 && Math.random() < 0.3);
    U.shuffle(singles);
    for (const c of singles) if (fits([c.p.id])) return [c.p.id];
    // two-player combos
    const mid = cand.filter(c => c.v >= tv * 0.25 && c.v <= tv * 0.95);
    for (let tries = 0; tries < 40 && mid.length >= 2; tries++) {
      const a = U.pick(mid), b = U.pick(mid);
      if (a === b) continue;
      const s = a.v + b.v * 0.9;
      if (s >= tv * 0.85 && s <= tv * 1.4 && fits([a.p.id, b.p.id])) return [a.p.id, b.p.id];
    }
    return null;
  },

  generateOffers(L) {
    if (Math.random() > 0.4) return;
    const ai = U.pick(L.teams.filter(t => t.id !== L.userTeam));
    const mine = League.roster(L, L.userTeam).filter(p => !(p.injury && p.injury.weeks > 0) && p.ovr >= 66);
    if (!mine.length) return;
    const scored = mine.map(p => ({ p, s: Trade.value(L, p) * Trade.need(L, ai.id, p, [p.id], []) * U.rf(0.7, 1.3) })).sort((a, b) => b.s - a.s);
    for (const { p } of scored.slice(0, 5)) {
      const pkg = Trade.buildPackage(L, ai.id, p.id);
      if (pkg) {
        L.offers.push({ id: Date.now() + Math.random(), from: ai.id, give: pkg, get: [p.id], week: L.week, status: 'pending' });
        League.news(L, `📨 The ${ai.name} have sent you a trade offer for ${p.pos} ${Data.full(p)}.`, 'trade');
        return;
      }
    }
  },

  // Ask every AI team what they'd give for one of your players
  shop(L, pid) {
    const out = [];
    for (const t of L.teams) {
      if (t.id === L.userTeam) continue;
      const pkg = Trade.buildPackage(L, t.id, pid);
      if (pkg) out.push({ from: t.id, give: pkg, get: [pid] });
    }
    return out;
  },

  aiTrades(L) {
    if (Math.random() > 0.12) return;
    const ais = L.teams.filter(t => t.id !== L.userTeam);
    const a = U.pick(ais), b = U.pick(ais.filter(t => t !== a));
    const targets = League.roster(L, b.id).filter(p => p.ovr >= 65 && Trade.need(L, a.id, p, [p.id], []) >= 1.1);
    if (!targets.length) return;
    const tgt = U.pick(targets);
    const pkg = Trade.buildPackage(L, a.id, tgt.id);
    if (!pkg) return;
    if (!Trade.aiEval(L, b.id, pkg, [tgt.id], a.id).ok) return;
    Trade.execute(L, a.id, b.id, pkg, [tgt.id]);
  },

  acceptOffer(L, offer) {
    const errs = Trade.validate(L, L.userTeam, offer.from, offer.get, offer.give);
    if (errs.length) return errs;
    if (offer.give.some(id => L.players[id].teamId !== offer.from) || offer.get.some(id => L.players[id].teamId !== L.userTeam)) return ['Players are no longer available'];
    Trade.execute(L, L.userTeam, offer.from, offer.get, offer.give);
    offer.status = 'accepted';
    return [];
  }
};

// ---------- Free agency ----------
const FA = {
  asking(L, p) {
    const base = League.marketSalary(p);
    const decay = Math.max(0.55, 1 - 0.06 * (p.faWeeks || 0));
    return {
      salary: Math.max(0.5, U.round1(base * decay * (0.95 + p.mood * 0.15))),
      years: p.age >= 31 ? 1 : p.age >= 28 ? 2 : p.age <= 23 ? 3 : 2
    };
  },

  depthRank(L, tid, p) {
    const group = League.roster(L, tid).filter(x => x.pos === p.pos && x.id !== p.id).concat([p]).sort((a, b) => b.ovr - a.ovr);
    return group.indexOf(p);
  },

  evaluate(L, p, tid, salary, years) {
    const ask = FA.asking(L, p);
    const t = L.teams[tid];
    let k = 1;
    const g = t.rec.w + t.rec.l + t.rec.t;
    const wp = g ? (t.rec.w + 0.5 * t.rec.t) / g : 0.5;
    k *= 1 + (wp - 0.5) * 0.15;
    k *= FA.depthRank(L, tid, p) < STARTERS[p.pos] ? 1.06 : 0.96;
    k *= 1 - Math.abs(years - ask.years) * 0.03;
    const score = (salary / ask.salary) * k;
    const errors = [];
    if (t.roster.length >= ROSTER_MAX) errors.push(`Roster is full (${ROSTER_MAX})`);
    if (L.settings.capOn && salary > League.capSpace(L, tid) + 0.001) errors.push(`Not enough cap space (${U.money(League.capSpace(L, tid))})`);
    const need = U.round1(Math.ceil((salary / score) * 10) / 10 + 0.05);
    return { score, accept: score >= 1 && !errors.length, ask, errors, need };
  },

  sign(L, p, tid, salary, years) {
    L.fa = L.fa.filter(id => id !== p.id);
    p.contract = { salary: U.round1(salary), years };
    if (L.phase === 'offseason') p.contract.fresh = true;
    p.faWeeks = 0;
    League.addToTeam(L, p, tid);
    League.fixDepth(L, L.teams[tid]);
    if (tid === L.userTeam || p.ovr >= 70)
      League.news(L, `SIGNED: ${L.teams[tid].abbr} sign ${p.pos} ${Data.full(p)} — ${years} yr, ${U.money(salary)}/yr.`, tid === L.userTeam ? 'good' : 'info');
  },

  release(L, pid) {
    const p = L.players[pid];
    const tid = p.teamId;
    League.removeFromTeam(L, p);
    p.faWeeks = 0;
    p.mood = Math.random();
    L.fa.push(pid);
    if (tid != null) League.news(L, `RELEASED: ${L.teams[tid].abbr} release ${p.pos} ${Data.full(p)}.`, tid === L.userTeam ? 'bad' : 'info');
  },

  weekly(L) {
    L.fa.forEach(id => { L.players[id].faWeeks = (L.players[id].faWeeks || 0) + 1; });
    FA.aiSign(L, false);
    // very old, long-unsigned players retire quietly
    L.fa = L.fa.filter(id => {
      const p = L.players[id];
      if (p.faWeeks > 8 && (p.age >= 33 || p.ovr < 48) && Math.random() < 0.3) { delete L.players[id]; return false; }
      return true;
    });
  },

  aiSign(L, force) {
    for (const t of L.teams) {
      if (t.id === L.userTeam) continue;
      // trim over-full rosters
      while (t.roster.length > ROSTER_MAX) {
        const worst = League.roster(L, t.id).sort((a, b) => a.ovr - b.ovr)[0];
        FA.release(L, worst.id);
      }
      for (const pos of POSITIONS) {
        const healthy = League.roster(L, t.id).filter(p => p.pos === pos && !(p.injury && p.injury.weeks > 0)).length;
        const want = STARTERS[pos] + (['OL', 'DL', 'WR', 'CB', 'LB'].includes(pos) ? 1 : 0);
        let short = want - healthy;
        if (t.roster.length < ROSTER_MIN + 3) short = Math.max(short, ROSTER_TEMPLATE[pos] - League.roster(L, t.id).filter(p => p.pos === pos).length);
        while (short > 0 && t.roster.length < ROSTER_MAX) {
          if (!force && Math.random() > 0.7) break;
          const cand = L.fa.map(id => L.players[id]).filter(p => p.pos === pos)
            .filter(p => FA.asking(L, p).salary <= League.capSpace(L, t.id)).sort((a, b) => b.ovr - a.ovr)[0];
          if (!cand) break;
          const a = FA.asking(L, cand);
          FA.sign(L, cand, t.id, a.salary, a.years);
          short--;
        }
      }
      League.autoDepth(L, t);
    }
  }
};
