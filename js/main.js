'use strict';
// ---------- Boot ----------
window.addEventListener('DOMContentLoaded', () => {
  const L = League.load();
  if (L) { UI.L = L; UI.hub('home'); }
  else UI.title();
});
window.addEventListener('beforeunload', () => { if (UI.L && !Live.isActive()) League.save(UI.L); });
