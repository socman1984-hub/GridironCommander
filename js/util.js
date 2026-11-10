'use strict';
// ---------- Generic helpers ----------
const U = {
  ri: (a, b) => Math.floor(Math.random() * (b - a + 1)) + a,
  rf: (a, b) => Math.random() * (b - a) + a,
  pick: a => a[Math.floor(Math.random() * a.length)],
  chance: p => Math.random() < p,
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  gauss() {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  },
  shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },
  dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
  sum: (a, f = x => x) => a.reduce((s, x) => s + f(x), 0),
  avg: (a, f = x => x) => (a.length ? a.reduce((s, x) => s + f(x), 0) / a.length : 0),
  round1: v => Math.round(v * 10) / 10,
  money: v => '$' + (Math.round(v * 10) / 10).toFixed(1) + 'M',
  clock(s) {
    s = Math.max(0, Math.ceil(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  },
  esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  },
  weighted(items, wf) {
    const ws = items.map(wf);
    let t = ws.reduce((a, b) => a + b, 0);
    if (t <= 0) return items[0];
    let r = Math.random() * t;
    for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  },
  // relative luminance-based text color for a hex background
  textOn(hex) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#111' : '#fff';
  }
};
