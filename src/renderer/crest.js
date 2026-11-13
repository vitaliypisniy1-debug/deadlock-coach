'use strict';
// Гербы героев: для каждого героя рисуется свой знак (форма по классу, цвет героя, узор и буква).
// Нужны для списков и таблиц, где портрет из арта «съезжает» и плохо читается. Всё рисуется кодом.
(function () {
  const SHAPES = {
    mystic: 'M32 2 L43 21 L62 32 L43 43 L32 62 L21 43 L2 32 L21 21Z',
    marksman: 'M32 4a28 28 0 1 0 0.01 0Z',
    brawler: 'M32 3 L57 11 V32 C57 47 46 57 32 62 C18 57 7 47 7 32 V11Z',
    assassin: 'M32 2 L59 17 L59 47 L32 62 L5 47 L5 17Z',
  };
  const DEFAULT_SHAPE = 'M14 4h36a10 10 0 0 1 10 10v36a10 10 0 0 1-10 10H14A10 10 0 0 1 4 50V14A10 10 0 0 1 14 4Z';

  function mix(c, k) { return c.map((v) => Math.max(0, Math.min(255, Math.round(v + (k > 0 ? (255 - v) * k : v * k))))); }
  const rgb = (c) => `rgb(${c.join(',')})`;
  function rand(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  let counter = 0;
  function HeroCrest(hero) {
    const id = hero.id || 0;
    const CLASS_COLOR = { mystic: [150, 110, 235], marksman: [70, 175, 215], brawler: [235, 130, 70], assassin: [225, 90, 95] };
    let base = Array.isArray(hero.color) && hero.color.length === 3 ? hero.color : (CLASS_COLOR[hero.type] || [255, 122, 69]);
    const mxc = Math.max(...base);
    if (mxc < 120) base = CLASS_COLOR[hero.type] || [255, 122, 69]; // у тёмных героев цвет почти чёрный — берём цвет класса
    else if (mxc < 190) base = base.map((v) => Math.min(255, Math.round(v * 190 / mxc)));
    const light = mix(base, 0.35), dark = mix(base, -0.62), mid = mix(base, -0.2);
    const shape = SHAPES[hero.type] || DEFAULT_SHAPE;
    const r = rand(id * 7919 + 13);
    let lines = '';
    for (let i = 0; i < 4; i++) {
      const x = -10 + r() * 84, w = 1 + r() * 2.5;
      lines += `<line x1="${x.toFixed(1)}" y1="-4" x2="${(x - 30 - r() * 20).toFixed(1)}" y2="68" stroke="#fff" stroke-opacity="${(0.07 + r() * 0.1).toFixed(2)}" stroke-width="${w.toFixed(1)}"/>`;
    }
    const dots = Array.from({ length: 5 }, () => `<circle cx="${(10 + r() * 44).toFixed(1)}" cy="${(8 + r() * 48).toFixed(1)}" r="${(0.8 + r() * 1.4).toFixed(1)}" fill="#fff" fill-opacity="${(0.2 + r() * 0.3).toFixed(2)}"/>`).join('');
    const letter = (hero.name || '?').trim().charAt(0).toUpperCase();
    const uid = ++counter;
    const g = `cg${uid}`, c = `cc${uid}`;
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><defs>
<radialGradient id="${g}" cx="35%" cy="20%" r="95%"><stop offset="0" stop-color="${rgb(light)}"/><stop offset="0.55" stop-color="${rgb(mid)}"/><stop offset="1" stop-color="${rgb(dark)}"/></radialGradient>
<clipPath id="${c}"><path d="${shape}"/></clipPath></defs>
<path d="${shape}" fill="url(#${g})"/>
<g clip-path="url(#${c})">${lines}${dots}<ellipse cx="32" cy="2" rx="40" ry="22" fill="#fff" fill-opacity="0.12"/></g>
<path d="${shape}" fill="none" stroke="${rgb(light)}" stroke-opacity="0.9" stroke-width="2"/>
<path d="${shape}" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="1" transform="translate(32 32) scale(0.82) translate(-32 -32)"/>
<text x="32" y="43" text-anchor="middle" font-family="'Alegreya SC', Georgia, serif" font-weight="800" font-size="30" fill="#fff" stroke="${rgb(dark)}" stroke-width="2.4" paint-order="stroke">${letter}</text></svg>`;
  }
  window.HeroCrest = HeroCrest;
})();
