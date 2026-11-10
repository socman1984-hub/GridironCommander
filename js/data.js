'use strict';
// ---------- Static data, player generation and rating formulas ----------
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P'];
const ROSTER_TEMPLATE = { QB: 2, RB: 3, WR: 5, TE: 2, OL: 7, DL: 6, LB: 5, CB: 4, S: 3, K: 1, P: 1 }; // 39
const STARTERS = { QB: 1, RB: 1, WR: 3, TE: 1, OL: 5, DL: 4, LB: 3, CB: 3, S: 2, K: 1, P: 1 };
const ROSTER_MAX = 46, ROSTER_MIN = 34;

const ATTRS = ['speed', 'strength', 'agility', 'awareness', 'stamina', 'toughness', 'throwPow', 'throwAcc',
  'catching', 'carrying', 'blocking', 'tackling', 'coverage', 'passRush', 'kickPow', 'kickAcc'];
const ATTR_LABEL = { speed: 'Speed', strength: 'Strength', agility: 'Agility', awareness: 'Awareness', stamina: 'Stamina',
  toughness: 'Toughness', throwPow: 'Throw Power', throwAcc: 'Throw Accuracy', catching: 'Catching', carrying: 'Carrying',
  blocking: 'Blocking', tackling: 'Tackling', coverage: 'Coverage', passRush: 'Pass Rush', kickPow: 'Kick Power', kickAcc: 'Kick Accuracy' };
const ATTR_SHORT = { speed: 'SPD', strength: 'STR', agility: 'AGI', awareness: 'AWR', stamina: 'STA', toughness: 'TGH',
  throwPow: 'THP', throwAcc: 'THA', catching: 'CTH', carrying: 'CAR', blocking: 'BLK', tackling: 'TAK', coverage: 'COV',
  passRush: 'PRS', kickPow: 'KPW', kickAcc: 'KAC' };

// How relevant each attribute is when generating a player of a given position (0..1)
const PROFILE = {
  QB: { throwPow: 1, throwAcc: 1, awareness: 1, speed: .55, agility: .6, strength: .45, carrying: .6, catching: .25, blocking: .1, tackling: .1, coverage: .1, passRush: .1, kickPow: .15, kickAcc: .15 },
  RB: { speed: 1, agility: 1, carrying: 1, strength: .8, catching: .7, awareness: .75, blocking: .45, throwPow: .3, throwAcc: .25, tackling: .25, coverage: .2, passRush: .15, kickPow: .1, kickAcc: .1 },
  WR: { speed: 1, catching: 1, agility: .95, awareness: .8, strength: .55, carrying: .7, blocking: .35, throwPow: .25, throwAcc: .2, tackling: .2, coverage: .3, passRush: .1, kickPow: .1, kickAcc: .1 },
  TE: { catching: .92, blocking: .92, strength: .9, speed: .78, agility: .7, awareness: .8, carrying: .6, tackling: .3, coverage: .2, passRush: .2, throwPow: .2, throwAcc: .15, kickPow: .1, kickAcc: .1 },
  OL: { blocking: 1, strength: 1, awareness: .8, speed: .4, agility: .45, tackling: .3, passRush: .35, catching: .15, carrying: .15, coverage: .1, throwPow: .1, throwAcc: .1, kickPow: .1, kickAcc: .1 },
  DL: { passRush: 1, strength: 1, tackling: .95, speed: .7, agility: .65, awareness: .75, blocking: .4, coverage: .2, catching: .2, carrying: .2, throwPow: .1, throwAcc: .1, kickPow: .1, kickAcc: .1 },
  LB: { tackling: 1, coverage: .82, speed: .85, awareness: .9, strength: .8, passRush: .75, agility: .75, catching: .4, blocking: .3, carrying: .3, throwPow: .1, throwAcc: .1, kickPow: .1, kickAcc: .1 },
  CB: { coverage: 1, speed: 1, agility: .95, awareness: .8, catching: .6, tackling: .6, strength: .45, carrying: .5, blocking: .2, passRush: .2, throwPow: .1, throwAcc: .1, kickPow: .1, kickAcc: .1 },
  S: { coverage: .92, tackling: .92, speed: .92, awareness: .9, agility: .8, strength: .6, catching: .55, passRush: .4, carrying: .4, blocking: .25, throwPow: .1, throwAcc: .1, kickPow: .1, kickAcc: .1 },
  K: { kickPow: 1, kickAcc: 1, awareness: .5, speed: .3, strength: .35, agility: .35, catching: .2, throwPow: .2, throwAcc: .2, carrying: .1, blocking: .1, tackling: .1, coverage: .1, passRush: .1 },
  P: { kickPow: 1, kickAcc: .95, awareness: .5, speed: .3, strength: .35, agility: .35, catching: .3, throwPow: .25, throwAcc: .2, carrying: .1, blocking: .1, tackling: .1, coverage: .1, passRush: .1 }
};

// Weights used to turn attributes into an attribute rating
const OVR_W = {
  QB: { throwAcc: .33, throwPow: .22, awareness: .27, speed: .06, agility: .06, carrying: .06 },
  RB: { speed: .24, agility: .22, carrying: .18, strength: .14, catching: .1, awareness: .12 },
  WR: { speed: .28, catching: .32, agility: .18, awareness: .14, strength: .08 },
  TE: { catching: .28, blocking: .28, strength: .14, speed: .14, awareness: .12, agility: .04 },
  OL: { blocking: .55, strength: .33, awareness: .12 },
  DL: { passRush: .38, strength: .3, tackling: .2, speed: .08, awareness: .04 },
  LB: { tackling: .32, coverage: .2, speed: .18, awareness: .16, passRush: .08, strength: .06 },
  CB: { coverage: .4, speed: .32, agility: .16, awareness: .12 },
  S: { coverage: .3, tackling: .24, speed: .24, awareness: .22 },
  K: { kickPow: .5, kickAcc: .5 },
  P: { kickPow: .55, kickAcc: .45 }
};

const POS_SALARY = { QB: 1.8, RB: .75, WR: 1.1, TE: .8, OL: .95, DL: 1.1, LB: .85, CB: 1.0, S: .85, K: .3, P: .25 };
const POS_TRADE = { QB: 1.5, RB: .8, WR: 1.05, TE: .8, OL: .9, DL: 1.05, LB: .85, CB: 1.0, S: .85, K: .35, P: .3 };
const NUM_RANGES = { QB: [1, 19], RB: [20, 49], WR: [10, 19, 80, 89], TE: [80, 89, 40, 49], OL: [60, 79], DL: [90, 99, 50, 79],
  LB: [40, 59], CB: [20, 39], S: [20, 49], K: [1, 19], P: [1, 19] };

const TEAM_DEFS = [
  { city: 'Bay City', name: 'Breakers', abbr: 'BAY', c1: '#123b6d', c2: '#2ec4b6' },
  { city: 'Iron Ridge', name: 'Miners', abbr: 'IRM', c1: '#262626', c2: '#f28c28' },
  { city: 'Sunvale', name: 'Scorpions', abbr: 'SUN', c1: '#7a1f2b', c2: '#f2c14e' },
  { city: 'Northport', name: 'Wolves', abbr: 'NPW', c1: '#4a5568', c2: '#90cdf4' },
  { city: 'Redwood', name: 'Lumberjacks', abbr: 'RWD', c1: '#1e5631', c2: '#e9c46a' },
  { city: 'Capital', name: 'Sentinels', abbr: 'CAP', c1: '#b91c1c', c2: '#f5f5f5' },
  { city: 'Mesa', name: 'Vipers', abbr: 'MSA', c1: '#5b2a86', c2: '#a3e635' },
  { city: 'Lakeshore', name: 'Storm', abbr: 'LKS', c1: '#0284c7', c2: '#facc15' }
];

const FIRST_NAMES = ['James', 'Marcus', 'Tyler', 'Jalen', 'DeShawn', 'Brandon', 'Chris', 'Michael', 'Derrick', 'Antonio', 'Jordan', 'Kevin',
  'Andre', 'Cameron', 'Isaiah', 'Trevor', 'Darius', 'Malik', 'Caleb', 'Nathan', 'Ryan', 'Josh', 'Zach', 'Austin', 'Cole', 'Brett', 'Logan',
  'Tre', 'Xavier', 'Elijah', 'Devin', 'Corey', 'Jamal', 'Terrell', 'Kyle', 'Dylan', 'Mason', 'Hunter', 'Bryce', 'Garrett', 'Lamar', 'Rashad',
  'Quentin', 'Desmond', 'Omar', 'Victor', 'Luis', 'Mateo', 'Diego', 'Kai', 'Noah', 'Liam', 'Owen', 'Ethan', 'Aaron', 'Patrick', 'Sean',
  'Grant', 'Reggie', 'Curtis', 'Damon', 'Jerome', 'Keith', 'Lance', 'Marvin', 'Nick', 'Shane', 'Troy', 'Wade', 'Zeke', 'Ty', 'Bo', 'Jace',
  'Kendrick', 'Trey', 'Miles', 'Donovan', 'Chase', 'Blake', 'Reid', 'Tavon', 'Jaylen', 'Amari', 'Keenan', 'Cedric', 'Rodney', 'Silas'];
const LAST_NAMES = ['Johnson', 'Williams', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor', 'Anderson', 'Thomas', 'Jackson', 'White',
  'Harris', 'Martin', 'Thompson', 'Robinson', 'Clark', 'Lewis', 'Walker', 'Hall', 'Allen', 'Young', 'King', 'Wright', 'Scott', 'Green',
  'Baker', 'Adams', 'Nelson', 'Carter', 'Mitchell', 'Roberts', 'Turner', 'Phillips', 'Campbell', 'Parker', 'Evans', 'Edwards', 'Collins',
  'Stewart', 'Morris', 'Rogers', 'Reed', 'Cook', 'Morgan', 'Bell', 'Murphy', 'Bailey', 'Cooper', 'Richardson', 'Cox', 'Howard', 'Ward',
  'Peterson', 'Gray', 'Watson', 'Brooks', 'Kelly', 'Sanders', 'Price', 'Bennett', 'Wood', 'Barnes', 'Ross', 'Henderson', 'Coleman',
  'Jenkins', 'Perry', 'Powell', 'Long', 'Patterson', 'Hughes', 'Washington', 'Butler', 'Simmons', 'Foster', 'Bryant', 'Alexander',
  'Russell', 'Griffin', 'Hayes', 'Myers', 'Ford', 'Graham', 'Wallace', 'Woods', 'Cole', 'West', 'Owens', 'Reynolds', 'Fisher', 'Ellis',
  'Harrison', 'Gibson', 'McDonald', 'Cruz', 'Marshall', 'Gomez', 'Murray', 'Freeman', 'Wells', 'Webb', 'Simpson', 'Stevens', 'Tucker',
  'Porter', 'Hicks', 'Crawford', 'Boyd', 'Kennedy', 'Warren', 'Dixon', 'Burns', 'Gordon', 'Shaw', 'Holmes', 'Rice', 'Hunt', 'Black',
  'Daniels', 'Palmer', 'Mills', 'Knight', 'Ferguson', 'Stone', 'Hawkins', 'Dunn', 'Perkins', 'Hudson', 'Spencer', 'Pierce', 'Hansen',
  'Wagner', 'Banks', 'Okafor', 'Mensah', 'Tagaloa', 'Fuimaono', 'Delgado', 'Navarro', 'Castillo', 'Vega', 'Odom', 'Pruitt', 'Lockett'];

const INJURY_TYPES = {
  game: ['Bruised ribs', 'Cramps', 'Stinger', 'Hip pointer', 'Jammed finger', 'Shaken up'],
  short: ['Ankle sprain', 'Hamstring strain', 'Groin pull', 'Shoulder sprain', 'Concussion', 'Turf toe', 'Knee bruise'],
  mid: ['High ankle sprain', 'MCL sprain', 'Broken hand', 'Back strain', 'Pectoral strain', 'Broken ribs'],
  long: ['Torn ACL', 'Broken leg', 'Achilles tear', 'Torn labrum', 'Lisfranc injury']
};

// ---------- Playbook ----------
const OFF_PLAYS = [
  { id: 'hb_dive', name: 'HB Dive', type: 'run', run: 'inside', form: 'singleback', desc: 'Handoff between the tackles' },
  { id: 'hb_toss', name: 'HB Toss', type: 'run', run: 'outside', form: 'singleback', desc: 'Pitch it to the edge' },
  { id: 'hb_draw', name: 'HB Draw', type: 'run', run: 'draw', form: 'shotgun', desc: 'Delayed handoff vs. the rush' },
  { id: 'qb_sneak', name: 'QB Sneak', type: 'run', run: 'sneak', form: 'under', desc: 'Push for a yard' },
  { id: 'slants', name: 'Slants', type: 'pass', depth: 'short', form: 'shotgun', desc: 'Quick inside breaks',
    routes: { WR1: 'slant', WR2: 'slant', WR3: 'flat', TE: 'curl', RB: 'block' } },
  { id: 'curl_flat', name: 'Curl Flat', type: 'pass', depth: 'short', form: 'shotgun', desc: 'Curls outside, flats underneath',
    routes: { WR1: 'curl', WR2: 'curl', WR3: 'out', TE: 'flat', RB: 'block' } },
  { id: 'mesh', name: 'Mesh', type: 'pass', depth: 'short', form: 'shotgun', desc: 'Crossing drags beat man coverage',
    routes: { WR1: 'go', WR2: 'drag', WR3: 'drag2', TE: 'curl', RB: 'flat' } },
  { id: 'sail', name: 'Sail', type: 'pass', depth: 'mid', form: 'shotgun', desc: 'Flood one sideline at 3 levels',
    routes: { WR1: 'go', WR2: 'out', WR3: 'corner', TE: 'flat', RB: 'block' } },
  { id: 'dagger', name: 'Dagger', type: 'pass', depth: 'mid', form: 'shotgun', desc: 'Seam clears for the dig',
    routes: { WR1: 'dig', WR2: 'go', WR3: 'seam', TE: 'curl', RB: 'flat' } },
  { id: 'verts', name: 'Four Verticals', type: 'pass', depth: 'deep', form: 'shotgun', desc: 'Stretch the defense deep',
    routes: { WR1: 'go', WR2: 'go', WR3: 'seam', TE: 'seam', RB: 'block' } },
  { id: 'pa_post', name: 'PA Deep Post', type: 'pass', depth: 'deep', form: 'singleback', pa: true, desc: 'Fake the run, take a shot',
    routes: { WR1: 'post', WR2: 'corner', WR3: 'curl', TE: 'block', RB: 'block' } },
  { id: 'hb_screen', name: 'HB Screen', type: 'pass', depth: 'screen', form: 'shotgun', desc: 'Let them rush, dump it off',
    routes: { WR1: 'go', WR2: 'go', WR3: 'curl', TE: 'block', RB: 'screen' } },
  { id: 'hail_mary', name: 'Hail Mary', type: 'pass', depth: 'hail', form: 'shotgun', desc: 'Everybody deep. Pray.',
    routes: { WR1: 'go', WR2: 'go', WR3: 'go', TE: 'go', RB: 'block' } }
];
const SPECIAL_PLAYS = {
  fg: { id: 'fg', name: 'Field Goal', type: 'fg' },
  punt: { id: 'punt', name: 'Punt', type: 'punt' },
  kneel: { id: 'kneel', name: 'QB Kneel', type: 'kneel' },
  spike: { id: 'spike', name: 'Spike Ball', type: 'spike' }
};
const DEF_PLAYS = [
  { id: 'cover3', name: 'Cover 3', cov: 'zone3', pers: 'nickel', desc: '3 deep, 4 underneath' },
  { id: 'cover2', name: 'Cover 2', cov: 'zone2', pers: 'nickel', desc: '2 deep safeties, squat corners' },
  { id: 'man1', name: 'Cover 1 Man', cov: 'man', pers: 'nickel', desc: 'Man-to-man, free safety deep' },
  { id: 'blitz', name: 'Zero Blitz', cov: 'man0', pers: 'nickel', blitz: 2, desc: 'Send both LBs, no deep help' },
  { id: 'prevent', name: 'Prevent', cov: 'prevent', pers: 'nickel', desc: 'Give up short, protect deep' },
  { id: 'goal', name: 'Goal Line', cov: 'man', pers: 'base', desc: 'Load the box vs. the run' }
];
const PLAY_BY_ID = {};
OFF_PLAYS.forEach(p => PLAY_BY_ID[p.id] = p);
Object.values(SPECIAL_PLAYS).forEach(p => PLAY_BY_ID[p.id] = p);
const DEF_BY_ID = {};
DEF_PLAYS.forEach(p => DEF_BY_ID[p.id] = p);

// Route waypoints: [forward yards, outward yards (+ = toward nearest sideline), sit flag]
const ROUTES = {
  go: [[40, 0]], seam: [[40, 0]], slant: [[2, 0], [12, -9]], curl: [[12, 0], [10.5, -1.5, 1]], out: [[7, 0], [7.5, 12]],
  corner: [[10, 0], [24, 11]], post: [[11, 0], [34, -13]], dig: [[11, 0], [11.5, -20]], drag: [[1.5, 0], [4, -32]],
  drag2: [[4, 0], [6, -32]], flat: [[1.5, 2], [3, 11], [3.5, 13, 1]], screen: [[-2, 3], [-1.5, 6, 1]]
};

// Formation alignment: [x offset from LOS (negative = backfield), y offset from ball]
const FORMS = {
  shotgun: { QB: [-5, 0], RB: [-5, 2.2], WR1: [-0.8, -19], WR2: [-1.2, 19], WR3: [-1.2, -10.5], TE: [-1.2, 6.2],
    LT: [-0.9, -4.2], LG: [-0.8, -2.1], C: [-0.6, 0], RG: [-0.8, 2.1], RT: [-0.9, 4.2] },
  singleback: { QB: [-1.1, 0], RB: [-6.5, 0], WR1: [-0.8, -19], WR2: [-1.2, 19], WR3: [-1.2, -10.5], TE: [-1.2, 6.2],
    LT: [-0.9, -4.2], LG: [-0.8, -2.1], C: [-0.6, 0], RG: [-0.8, 2.1], RT: [-0.9, 4.2] }
};
FORMS.under = FORMS.singleback;

// ---------- Player helpers ----------
const Data = {
  name(p) { return p ? p.first[0] + '. ' + p.last : '???'; },
  full(p) { return p ? p.first + ' ' + p.last : '???'; },

  attrOvr(p) {
    const w = OVR_W[p.pos];
    let s = 0;
    for (const k in w) s += w[k] * p.attrs[k];
    return Math.round(s);
  },

  genPlayer(L, pos, q, age) {
    const a = {};
    const prof = PROFILE[pos];
    for (const k of ATTRS) {
      if (k === 'stamina' || k === 'toughness') {
        a[k] = U.clamp(Math.round(55 + U.rf(0, 35) + (q - 70) * 0.2), 40, 99);
        continue;
      }
      const rel = prof[k] || 0;
      a[k] = U.clamp(Math.round(28 + rel * (q - 28) + U.gauss() * 4.5 + (rel > 0.8 ? U.gauss() * 2 : 0)), 12, 99);
    }
    if (!age) age = U.clamp(Math.round(26 + U.gauss() * 3.2), 21, 35);
    const p = {
      id: L.nextPid++, first: U.pick(FIRST_NAMES), last: U.pick(LAST_NAMES), pos, age, num: 0, attrs: a,
      pot: 0, stats: {}, lastStats: null, career: {}, prodLast: null, prod: null, ovr: 0, attrOvr: 0,
      contract: { salary: 1, years: 1 }, injury: null, teamId: null, history: [], faWeeks: 0, mood: Math.random()
    };
    p.attrOvr = Data.attrOvr(p);
    p.ovr = p.attrOvr;
    const growth = age <= 23 ? U.ri(3, 15) : age <= 25 ? U.ri(1, 9) : age <= 27 ? U.ri(0, 4) : 0;
    p.pot = U.clamp(p.attrOvr + growth, p.attrOvr, 99);
    return p;
  },

  potLabel(p) {
    const d = p.pot - p.attrOvr;
    if (p.age >= 29) return '—';
    if (d >= 10) return 'High';
    if (d >= 5) return 'Good';
    if (d >= 2) return 'Some';
    return 'Low';
  },

  addStats(into, s) {
    for (const k in s) {
      if (k.endsWith('Long')) into[k] = Math.max(into[k] || 0, s[k]);
      else into[k] = (into[k] || 0) + s[k];
    }
  },

  // Production score (25..99) derived from a stat line. single=true uses lower volume thresholds for a single game.
  prodScore(pos, s, single) {
    if (!s) return null;
    const gp = Math.max(1, s.gp || 0);
    const g = k => s[k] || 0;
    let v = null;
    switch (pos) {
      case 'QB': {
        const att = g('passAtt');
        if (att < (single ? 8 : 25)) return null;
        const a = U.clamp((g('passCmp') / att - 0.3) * 5, 0, 2.375), b = U.clamp((g('passYds') / att - 3) * 0.25, 0, 2.375);
        const c = U.clamp(g('passTD') / att * 20, 0, 2.375), d = U.clamp(2.375 - g('passInt') / att * 25, 0, 2.375);
        const rate = (a + b + c + d) / 6 * 100;
        v = 55 + (rate - 75) * 0.75 + (g('passYds') / gp - 200) / 25 + (g('rushYds') / gp) / 15;
        break;
      }
      case 'RB': {
        const att = g('rushAtt');
        if (att < (single ? 5 : 20)) return null;
        const ypc = g('rushYds') / att;
        v = 58 + (ypc - 3.8) * 11 + (g('rushYds') / gp - 55) / 5 + (g('rushTD') / gp) * 7 + (g('recYds') / gp) / 8 - (g('fumLost') / gp) * 12;
        break;
      }
      case 'WR': case 'TE': {
        const tg = g('targets');
        if (tg < (single ? 3 : 10)) return null;
        const ypg = g('recYds') / gp;
        v = (pos === 'WR' ? 42 : 50) + ypg * (pos === 'WR' ? 0.5 : 0.6) + (g('rec') / tg - 0.6) * 45 + (g('recTD') / gp) * 8;
        break;
      }
      case 'OL': {
        const ra = g('olRushAtt');
        if (ra < (single ? 8 : 30)) return null;
        v = 66 + (g('olRushYds') / ra - 4.2) * 11 - (g('sacksAllowed') / gp) * 14;
        break;
      }
      case 'DL':
        if (!s.gp) return null;
        v = 52 + (g('sacks') / gp) * 30 + (g('tackles') / gp) * 4 + (g('tfl') / gp) * 8 + (g('ff') / gp) * 10;
        break;
      case 'LB':
        if (!s.gp) return null;
        v = 46 + (g('tackles') / gp) * 4 + (g('sacks') / gp) * 20 + ((g('defInt') + g('pd') * 0.4) / gp) * 18 + (g('tfl') / gp) * 5;
        break;
      case 'CB': {
        const tg = g('tgtAllowed');
        if (tg < (single ? 2 : 8)) return null;
        v = 62 + (0.62 - g('cmpAllowed') / tg) * 70 + (g('defInt') / gp) * 35 + (g('pd') / gp) * 9 + (g('tackles') / gp) * 1.5;
        break;
      }
      case 'S': {
        if (!s.gp) return null;
        const tg = g('tgtAllowed');
        v = 52 + (g('tackles') / gp) * 3 + (g('defInt') / gp) * 35 + (g('pd') / gp) * 9 + (tg >= 3 ? (0.62 - g('cmpAllowed') / tg) * 35 : 0);
        break;
      }
      case 'K': {
        const fa = g('fga');
        if (fa < (single ? 1 : 4)) return null;
        v = 35 + (g('fgm') / fa) * 58 + (g('fgLong') >= 50 ? 4 : 0);
        break;
      }
      case 'P': {
        const n = g('punts');
        if (n < (single ? 2 : 6)) return null;
        v = 50 + (g('puntYds') / n - 41) * 3.5;
        break;
      }
    }
    return v == null ? null : U.clamp(Math.round(v), 25, 99);
  },

  makeInjury() {
    const r = Math.random();
    let tier, weeks;
    if (r < 0.45) { tier = 'game'; weeks = 0; }
    else if (r < 0.77) { tier = 'short'; weeks = U.ri(1, 2); }
    else if (r < 0.94) { tier = 'mid'; weeks = U.ri(3, 6); }
    else { tier = 'long'; weeks = U.ri(8, 16); }
    return { type: U.pick(INJURY_TYPES[tier]), weeks, tier };
  },

  // Key stat line summary for tables
  statLine(p, s) {
    s = s || {};
    const g = k => s[k] || 0;
    switch (p.pos) {
      case 'QB': return `${g('passCmp')}/${g('passAtt')}, ${g('passYds')} yds, ${g('passTD')} TD, ${g('passInt')} INT`;
      case 'RB': return `${g('rushAtt')} car, ${g('rushYds')} yds, ${g('rushTD')} TD · ${g('rec')} rec ${g('recYds')} yds`;
      case 'WR': case 'TE': return `${g('rec')} rec, ${g('recYds')} yds, ${g('recTD')} TD (${g('targets')} tgt)`;
      case 'OL': return `${g('gp')} GP, ${g('sacksAllowed')} sacks allowed, ${g('olRushAtt') ? (g('olRushYds') / g('olRushAtt')).toFixed(1) : '0.0'} team YPC`;
      case 'DL': case 'LB': return `${g('tackles')} tkl, ${g('sacks')} sck, ${g('tfl')} TFL, ${g('defInt')} INT, ${g('ff')} FF`;
      case 'CB': case 'S': return `${g('tackles')} tkl, ${g('defInt')} INT, ${g('pd')} PD, ${g('cmpAllowed')}/${g('tgtAllowed')} allowed`;
      case 'K': return `${g('fgm')}/${g('fga')} FG (long ${g('fgLong')}), ${g('xpm')}/${g('xpa')} XP`;
      case 'P': return `${g('punts')} punts, ${g('punts') ? (g('puntYds') / g('punts')).toFixed(1) : '0.0'} avg`;
    }
    return '';
  }
};
