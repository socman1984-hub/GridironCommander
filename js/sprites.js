'use strict';
// ---------- Retro pixel-art sprites, crowd and sound ----------
const Sprites = (() => {
  const cache = new Map();
  const SKINS = ['#f3c89b', '#e0ac69', '#c68642', '#8d5524', '#5c3a1e'];
  const HAIR = ['#2b1d12', '#5a3a1a', '#d6b25e', '#8a4b20', '#111111'];
  const DIG = {
    0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
    3: ['111', '001', '011', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
    6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'], 8: ['111', '101', '111', '101', '111'],
    9: ['111', '101', '111', '001', '111']
  };
  const lum = hex => {
    const h = hex.replace('#', '');
    return parseInt(h.substr(0, 2), 16) * 0.299 + parseInt(h.substr(2, 2), 16) * 0.587 + parseInt(h.substr(4, 2), 16) * 0.114;
  };
  const W = 14, H = 22;
  const DARK = '#1b1b1b', MASK = '#d9d9d9', BALL = '#7a3b12';

  function finish(raw) {
    // add a 1px dark outline so sprites pop on the grass
    const c = document.createElement('canvas');
    c.width = W + 2; c.height = H + 2;
    const g = c.getContext('2d');
    const sil = document.createElement('canvas');
    sil.width = W; sil.height = H;
    const sg = sil.getContext('2d');
    sg.drawImage(raw, 0, 0);
    sg.globalCompositeOperation = 'source-in';
    sg.fillStyle = 'rgba(10,10,15,0.85)';
    sg.fillRect(0, 0, W, H);
    for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2]]) g.drawImage(sil, dx, dy);
    g.drawImage(raw, 1, 1);
    return c;
  }
  function canvas() { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; }

  // ---------- football player ----------
  function buildPlayer(t, skin, num, pose, carry) {
    const c = canvas(), g = c.getContext('2d');
    const r = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    const c1 = t.c1, c2 = t.c2;
    const pants = lum(c2) > 150 ? c2 : '#e5e7eb';
    const numCol = lum(c1) > 150 ? '#111' : (lum(c2) > 90 ? c2 : '#ffffff');
    // legs
    const leg = (segs, shoe) => {
      segs.forEach(([x, y], i) => r(x, y, 2, 1, i === 0 ? pants : c1));
      r(shoe[0], shoe[1], 3, 1, DARK);
    };
    if (pose === 'run0' || pose === 'run2') {
      leg([[8, 17], [9, 18], [10, 19], [11, 20]], [11, 21]);
      leg([[5, 17], [4, 18], [3, 19], [2, 20]], [1, 21]);
    } else if (pose === 'run1' || pose === 'run3') {
      leg([[7, 17], [8, 18]], [8, 19]);
      leg([[5, 17], [5, 18], [5, 19], [5, 20]], [5, 21]);
    } else if (pose === 'reach') {
      leg([[8, 17], [9, 18], [9, 19], [9, 20]], [9, 21]);
      leg([[4, 17], [3, 18], [3, 19], [3, 20]], [2, 21]);
    } else {
      leg([[4, 17], [4, 18], [4, 19], [4, 20]], [4, 21]);
      leg([[8, 17], [8, 18], [8, 19], [8, 20]], [8, 21]);
    }
    // back arm (behind body)
    if (pose === 'run0' || pose === 'run3') { r(2, 9, 2, 2, c1); r(1, 11, 2, 1, skin); }
    if (pose === 'run2') { r(10, 9, 2, 2, c1); r(11, 11, 2, 1, skin); }
    // body
    r(3, 14, 8, 1, DARK);               // belt
    r(4, 15, 6, 2, pants);              // pants
    r(3, 7, 8, 2, c1);                  // shoulder pads
    r(3, 9, 8, 5, c1);                  // jersey
    r(6, 6, 3, 1, skin);                // neck
    // number
    const s = String(num || 0);
    const drawDigit = (d, ox) => DIG[d].forEach((row, yy) => [...row].forEach((b, xx) => { if (b === '1') r(ox + xx, 8 + yy, 1, 1, numCol); }));
    if (s.length === 1) drawDigit(s, 5); else { drawDigit(s[0], 3); drawDigit(s[1], 7); }
    // helmet
    r(4, 0, 6, 1, c1); r(3, 1, 8, 4, c1); r(4, 5, 5, 1, c1);
    r(4, 0, 5, 1, c2);                  // stripe
    r(5, 2, 2, 2, c2);                  // logo
    r(9, 2, 2, 3, skin); r(9, 2, 1, 1, DARK);
    r(11, 2, 1, 3, MASK); r(10, 4, 2, 1, MASK);
    // front arm
    switch (pose) {
      case 'run0': case 'run3': r(10, 8, 2, 2, c1); r(11, 10, 2, 1, c1); r(12, 10, 2, 1, skin); break;
      case 'run2': r(1, 9, 2, 2, c1); r(0, 11, 2, 1, skin); break;
      case 'up': r(1, 2, 2, 5, c1); r(1, 1, 2, 1, skin); r(11, 2, 2, 5, c1); r(11, 1, 2, 1, skin); break;
      case 'throw0': r(1, 4, 2, 5, c1); r(1, 3, 2, 1, skin); r(0, 1, 3, 2, BALL); break;
      case 'throw1': r(11, 3, 2, 5, c1); r(12, 2, 2, 1, skin); break;
      case 'stiff': r(10, 8, 4, 2, c1); r(13, 7, 1, 3, skin); break;
      case 'reach': r(10, 9, 4, 2, c1); r(10, 11, 3, 1, c1); r(13, 9, 1, 3, skin); break;
      default: r(10, 8, 2, 4, c1); r(10, 12, 2, 1, skin);
    }
    if (carry && pose !== 'throw0' && pose !== 'throw1') { r(8, 10, 4, 2, BALL); r(9, 10, 1, 1, '#fff'); r(11, 11, 1, 1, '#4a220a'); }
    return finish(c);
  }

  function buildCoach(t, skin) {
    const c = canvas(), g = c.getContext('2d');
    const r = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    r(4, 19, 3, 2, DARK); r(8, 19, 3, 2, DARK);
    r(4, 14, 6, 5, '#c8b48a'); r(4, 14, 6, 1, '#3a2e1d');
    r(3, 7, 8, 7, t.c1); r(5, 7, 4, 1, t.c2);
    r(10, 8, 2, 4, t.c1); r(11, 9, 3, 4, '#f5f5f5'); r(12, 10, 1, 2, '#999');
    r(5, 2, 5, 4, skin); r(8, 3, 1, 1, DARK);
    r(4, 0, 6, 2, t.c1); r(9, 2, 3, 1, t.c1);
    r(4, 2, 1, 3, DARK); r(8, 5, 2, 1, DARK);
    return finish(c);
  }

  function buildCheer(t, skin, hair, up) {
    const c = canvas(), g = c.getContext('2d');
    const r = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    r(5, 13, 1, 6, skin); r(8, 13, 1, 6, skin);
    r(4, 19, 3, 2, '#fff'); r(8, 19, 3, 2, '#fff');
    r(3, 10, 8, 3, t.c1);
    r(4, 6, 6, 4, t.c2);
    r(5, 2, 5, 4, skin); r(8, 3, 1, 1, DARK);
    r(4, 0, 6, 3, hair); r(3, 1, 2, 5, hair);
    if (up) { r(2, 2, 1, 4, skin); r(11, 2, 1, 4, skin); r(0, 0, 3, 3, t.c2); r(11, 0, 3, 3, t.c2); }
    else { r(3, 7, 1, 3, skin); r(10, 7, 1, 3, skin); r(1, 9, 3, 3, t.c2); r(10, 9, 3, 3, t.c2); }
    return finish(c);
  }

  function get(key, make) {
    let v = cache.get(key);
    if (!v) { v = make(); cache.set(key, v); }
    return v;
  }
  return {
    SKINS, HAIR, lum,
    skinOf: id => SKINS[(id * 7919) % SKINS.length],
    player: (t, p, pose, carry) => get(`p|${t.abbr}|${p.id}|${p.num}|${pose}|${carry ? 1 : 0}`, () => buildPlayer(t, Sprites.skinOf(p.id), p.num, pose, carry)),
    coach: t => get(`c|${t.abbr}`, () => buildCoach(t, SKINS[t.id % SKINS.length])),
    cheer: (t, i, up) => get(`h|${t.abbr}|${i}|${up ? 1 : 0}`, () => buildCheer(t, SKINS[(i * 3 + 1) % SKINS.length], HAIR[i % HAIR.length], up)),
    clear: () => cache.clear()
  };
})();

// ---------- Simple procedural sound: crowd roar + referee whistle ----------
const Sound = (() => {
  let ac = null, crowdGain = null, master = null, on = true;
  function init(enabled) {
    on = enabled !== false;
    if (ac || !on) return;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      const len = ac.sampleRate * 2;
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource();
      src.buffer = buf; src.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 850; bp.Q.value = 0.5;
      crowdGain = ac.createGain(); crowdGain.gain.value = 0.015;
      master = ac.createGain(); master.gain.value = 0.9;
      src.connect(bp); bp.connect(crowdGain); crowdGain.connect(master); master.connect(ac.destination);
      src.start();
    } catch (e) { ac = null; }
  }
  function roar(level) {
    if (!ac || !on) return;
    const t = ac.currentTime, g = crowdGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.015 + 0.2 * level, t + 0.15);
    g.setTargetAtTime(0.015, t + 0.6 + level * 1.5, 0.8);
  }
  function whistle() {
    if (!ac || !on) return;
    const t = ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
    o.type = 'square'; o.frequency.value = 2400;
    lfo.frequency.value = 32; lg.gain.value = 120;
    lfo.connect(lg); lg.connect(o.frequency);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.035, t + 0.02); g.gain.setValueAtTime(0.035, t + 0.28); g.gain.linearRampToValueAtTime(0, t + 0.36);
    o.connect(g); g.connect(master);
    o.start(t); lfo.start(t); o.stop(t + 0.4); lfo.stop(t + 0.4);
  }
  function setOn(v) {
    on = v;
    if (v && !ac) init(true);
    if (master) master.gain.value = v ? 0.9 : 0;
  }
  function stop() { if (ac) { try { ac.close(); } catch (e) { /* ignore */ } } ac = null; }
  return { init, roar, whistle, setOn, stop, isOn: () => on };
})();
