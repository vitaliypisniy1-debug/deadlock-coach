'use strict';
// Генератор библиотеки артов «Ночной город». Все картинки нарисованы кодом, чужих ассетов нет.
// Запуск: node tools/make-art.js  → файлы в src/renderer/assets/art/*.svg
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'art');
fs.mkdirSync(OUT, { recursive: true });

// ---------- вспомогательное ----------
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const f = (n) => Math.round(n * 10) / 10;
const save = (name, svg) => fs.writeFileSync(path.join(OUT, name), svg);
const C = { night: '#081216', deep: '#0c1d23', teal: '#12303a', teal2: '#1c4a56', sky: '#5fd4ee', orange: '#ff7a45', orange2: '#ff9966', sun: '#ffd98a', cream: '#f1e6cd' };

// ---------- небоскрёбы ----------
function building(r, x, w, h, baseY, fill, win, litP) {
  let s = '';
  const tiers = r() < 0.55 ? 1 + Math.floor(r() * 3) : 0; // ступенчатый ар-деко
  let cx = x, cw = w, top = baseY - h;
  s += `<rect x="${f(x)}" y="${f(top)}" width="${f(w)}" height="${f(h)}" fill="${fill}"/>`;
  for (let t = 0; t < tiers; t++) {
    const nw = cw * (0.72 - t * 0.08), nh = h * (0.12 + r() * 0.1);
    cx += (cw - nw) / 2; cw = nw; top -= nh;
    s += `<rect x="${f(cx)}" y="${f(top)}" width="${f(cw)}" height="${f(nh + 1)}" fill="${fill}"/>`;
  }
  const kind = r();
  if (kind < 0.35) s += `<rect x="${f(cx + cw / 2 - 1)}" y="${f(top - 26 - r() * 40)}" width="2" height="${f(30 + r() * 40)}" fill="${fill}"/>`; // шпиль
  else if (kind < 0.5) s += `<path d="M${f(cx)} ${f(top)} Q${f(cx + cw / 2)} ${f(top - cw * 0.9)} ${f(cx + cw)} ${f(top)}Z" fill="${fill}"/>`; // арочная корона
  else if (kind < 0.62) { // водонапорная башня
    const tx = cx + cw * 0.25;
    s += `<rect x="${f(tx)}" y="${f(top - 16)}" width="${f(cw * 0.5)}" height="14" fill="${fill}"/><path d="M${f(tx)} ${f(top - 16)}l${f(cw * 0.25)} -8 l${f(cw * 0.25)} 8z" fill="${fill}"/><rect x="${f(tx + 3)}" y="${f(top - 2)}" width="2" height="4" fill="${fill}"/>`;
  }
  if (win) {
    for (let wy = top + 14; wy < baseY - 10; wy += 12) {
      for (let wx = x + 6; wx < x + w - 8; wx += 10) {
        if (r() < litP) s += `<rect x="${f(wx)}" y="${f(wy)}" width="4" height="6" fill="${r() < 0.8 ? C.sun : C.sky}" opacity="${f(0.25 + r() * 0.6)}"/>`;
      }
    }
  }
  return s;
}
function skylineLayer(seed, W, baseY, hMin, hMax, fill, win, litP, wMin = 24, wMax = 70) {
  const r = rng(seed); let x = -10, s = '';
  while (x < W) {
    const w = wMin + r() * (wMax - wMin), h = hMin + Math.pow(r(), 1.6) * (hMax - hMin);
    s += building(r, x, w, h, baseY, fill, win, litP);
    x += w + (r() < 0.3 ? 4 + r() * 14 : 0);
  }
  return s;
}
function skyline(name, seed, { tint = '#12303a', glow = C.orange, W = 1600, H = 380 } = {}) {
  const defs = `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.night}" stop-opacity="0"/><stop offset="0.7" stop-color="${glow}" stop-opacity="0.16"/><stop offset="1" stop-color="${glow}" stop-opacity="0.34"/></linearGradient>
<linearGradient id="fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.night}" stop-opacity="0"/><stop offset="1" stop-color="${C.night}" stop-opacity="0.95"/></linearGradient></defs>`;
  const body = `<rect width="${W}" height="${H}" fill="url(#sky)"/>
<g>${skylineLayer(seed, W, H, 60, 190, tint, false, 0, 30, 90)}</g>
<g opacity="0.9">${skylineLayer(seed + 7, W, H, 80, 250, '#0e2830', true, 0.16)}</g>
<g>${skylineLayer(seed + 13, W, H, 70, 300, '#08161b', true, 0.3, 34, 80)}</g>
<rect y="${H - 90}" width="${W}" height="90" fill="url(#fog)"/>`;
  save(name, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice">${defs}${body}</svg>`);
}

// ---------- лучи ар-деко ----------
function rays(name, color, n = 28) {
  let s = '';
  const W = 1200, H = 600, cx = 600, cy = H + 40;
  for (let i = 0; i < n; i++) {
    const a0 = Math.PI + (i / n) * Math.PI, a1 = Math.PI + ((i + 0.45) / n) * Math.PI, R = 900;
    s += `<path d="M${cx} ${cy} L${f(cx + Math.cos(a0) * R)} ${f(cy + Math.sin(a0) * R)} L${f(cx + Math.cos(a1) * R)} ${f(cy + Math.sin(a1) * R)}Z" fill="url(#g)"/>`;
  }
  save(name, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice"><defs><radialGradient id="g" cx="600" cy="${cy}" r="900" gradientUnits="userSpaceOnUse"><stop offset="0.1" stop-color="${color}" stop-opacity="0.34"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient></defs>${s}</svg>`);
}

// ---------- шестиугольная сетка и осколки (подложки героев) ----------
function hexGrid(name) {
  const r = 26, w = Math.sqrt(3) * r, h = 2 * r; let s = '';
  for (let row = 0; row < 12; row++) for (let col = 0; col < 14; col++) {
    const x = col * w + (row % 2 ? w / 2 : 0), y = row * h * 0.75;
    const pts = [0, 1, 2, 3, 4, 5].map((k) => { const a = Math.PI / 3 * k + Math.PI / 6; return `${f(x + r * 0.92 * Math.cos(a))},${f(y + r * 0.92 * Math.sin(a))}`; }).join(' ');
    s += `<polygon points="${pts}"/>`;
  }
  save(name, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(14 * w)} ${f(12 * h * 0.75 + r)}"><g fill="none" stroke="#fff" stroke-opacity="0.07" stroke-width="1">${s}</g></svg>`);
}
function shards(name) {
  const r = rng(11); let s = '';
  for (let i = 0; i < 9; i++) {
    const x = r() * 300, w = 20 + r() * 60, sk = 40 + r() * 80;
    s += `<polygon points="${f(x)},400 ${f(x + w)},400 ${f(x + w + sk)},0 ${f(x + sk)},0" fill="#fff" fill-opacity="${f(0.03 + r() * 0.07)}"/>`;
  }
  save(name, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice">${s}</svg>`);
}

// ---------- эмблемы разделов ----------
const emblemDefs = `<defs>
<linearGradient id="st" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.sky}"/><stop offset="1" stop-color="${C.orange2}"/></linearGradient>
<linearGradient id="fl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.sky}" stop-opacity="0.28"/><stop offset="1" stop-color="${C.orange}" stop-opacity="0.12"/></linearGradient>
<radialGradient id="halo" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${C.orange}" stop-opacity="0.42"/><stop offset="1" stop-color="${C.orange}" stop-opacity="0"/></radialGradient>
<filter id="gl" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
const hexPts = (cx, cy, R) => [0, 1, 2, 3, 4, 5].map((k) => { const a = Math.PI / 3 * k - Math.PI / 2; return `${f(cx + R * Math.cos(a))},${f(cy + R * Math.sin(a))}`; }).join(' ');
function emblem(name, inner) {
  const body = `<circle cx="120" cy="120" r="118" fill="url(#halo)"/>
<polygon points="${hexPts(120, 120, 104)}" fill="${C.deep}" fill-opacity="0.75" stroke="url(#st)" stroke-width="2.5"/>
<polygon points="${hexPts(120, 120, 92)}" fill="none" stroke="${C.sky}" stroke-opacity="0.25" stroke-width="1" stroke-dasharray="3 5"/>
<g filter="url(#gl)" stroke="url(#st)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none">${inner}</g>`;
  save(name, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">${emblemDefs}${body}</svg>`);
}
const E = {
  home: `<path d="M120 52v-14M120 52l-10 26h20z" /><path d="M96 150V98l24-20 24 20v52" fill="url(#fl)"/><path d="M82 168V122l14-10M158 168V122l-14-10"/><path d="M70 168h100"/><path d="M110 168v-24a10 10 0 0 1 20 0v24"/><path d="M104 108h32M104 124h32" stroke-width="2.5" opacity="0.7"/>`,
  coach: `<circle cx="120" cy="120" r="52"/><circle cx="120" cy="120" r="32" fill="url(#fl)"/><circle cx="120" cy="120" r="9" fill="${C.orange}" stroke="none"/><path d="M120 56v18M120 166v18M56 120h18M166 120h18"/><path d="M172 68l-40 40" stroke="${C.orange2}"/><path d="M160 66l14-2-2 14" stroke="${C.orange2}"/>`,
  growth: `<polygon points="${hexPts(120, 124, 54)}" fill="url(#fl)"/><path d="M104 96l14 22-12 14 18 20"/><circle cx="154" cy="152" r="24" fill="${C.deep}"/><path d="M172 170l22 22" stroke-width="6"/><path d="M154 142v14" stroke="${C.orange}"/><circle cx="154" cy="164" r="2.5" fill="${C.orange}" stroke="${C.orange}"/>`,
  matches: `<circle cx="120" cy="118" r="50" fill="url(#fl)"/><circle cx="120" cy="118" r="12"/><circle cx="120" cy="86" r="8"/><circle cx="148" cy="102" r="8"/><circle cx="148" cy="134" r="8"/><circle cx="120" cy="150" r="8"/><circle cx="92" cy="134" r="8"/><circle cx="92" cy="102" r="8"/><path d="M76 176h88M92 190h56" stroke-width="3" opacity="0.7"/>`,
  myheroes: `<path d="M120 52l52 18v42c0 32-22 52-52 66-30-14-52-34-52-66V70z" fill="url(#fl)"/><path d="M98 108c6-6 14-6 22-2 8-4 16-4 22 2 0 14-8 24-22 24s-22-10-22-24z"/><circle cx="109" cy="114" r="3.5" fill="${C.orange}" stroke="none"/><circle cx="131" cy="114" r="3.5" fill="${C.orange}" stroke="none"/><path d="M110 128c6 4 14 4 20 0"/>`,
  meta: `<path d="M64 170h112"/><path d="M78 170V132h20v38M104 170V104h20v66M130 170V88h20v66" fill="url(#fl)"/><path d="M154 170v-48h18v48" fill="url(#fl)"/><path d="M70 120l30-26 28-12 44-24" stroke="${C.orange2}"/><path d="M160 56h12v12" stroke="${C.orange2}"/>`,
  prep: `<path d="M74 74l92 92M166 74l-92 92" stroke-width="5"/><path d="M62 62l18 6-8 12zM178 62l-18 6 8 12z" fill="${C.orange}" stroke="none"/><path d="M150 168l18 6M90 168l-18 6" /><circle cx="120" cy="120" r="14" fill="${C.deep}"/><circle cx="120" cy="120" r="4" fill="${C.orange}" stroke="none"/>`,
  codex: `<path d="M120 84v84M120 84c-14-10-34-12-54-6v84c20-6 40-4 54 6 14-10 34-12 54-6V78c-20-6-40-4-54 6z" fill="url(#fl)"/><path d="M84 100c8-2 18-2 28 2M84 118c8-2 18-2 28 2M128 102c10-4 20-4 28-2M128 120c10-4 20-4 28-2" stroke-width="2.5" opacity="0.7"/><path d="M104 56c10-10 22-10 32 0-10 10-22 10-32 0z"/><circle cx="120" cy="56" r="3" fill="${C.orange}" stroke="none"/>`,
  players: `<path d="M86 66h68v30c0 22-14 36-34 36s-34-14-34-36z" fill="url(#fl)"/><path d="M86 74H66c0 18 8 30 24 34M154 74h20c0 18-8 30-24 34"/><path d="M120 132v22M96 170h48M104 154h32"/><path d="M120 82l5 10 11 2-8 8 2 11-10-6-10 6 2-11-8-8 11-2z" fill="${C.orange}" stroke="none"/>`,
  settings: `<circle cx="120" cy="120" r="22" fill="url(#fl)"/><path d="M120 62v14M120 164v14M62 120h14M164 120h14M79 79l10 10M151 151l10 10M161 79l-10 10M89 151l-10 10"/><circle cx="120" cy="120" r="44"/><path d="M120 108v24M108 120h24" stroke="${C.orange2}" stroke-width="3" opacity="0.8"/>`,
};

// ---------- ранги и орнамент ----------
function divider(name) {
  save(name, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 24"><defs><linearGradient id="d" x1="0" x2="1"><stop offset="0" stop-color="${C.sky}" stop-opacity="0"/><stop offset="0.5" stop-color="${C.orange2}"/><stop offset="1" stop-color="${C.sky}" stop-opacity="0"/></linearGradient></defs><path d="M0 12h260M340 12h260" stroke="url(#d)" stroke-width="1.5"/><polygon points="300,2 312,12 300,22 288,12" fill="none" stroke="${C.orange2}" stroke-width="2"/><polygon points="300,7 306,12 300,17 294,12" fill="${C.orange}"/></svg>`);
}
function noise(name) {
  save(name, `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.06 0"/></filter><rect width="200" height="200" filter="url(#n)"/></svg>`);
}

skyline('skyline-night.svg', 21, { tint: '#17404c', glow: C.orange });
skyline('skyline-dawn.svg', 5, { tint: '#1d4a58', glow: C.orange2 });
skyline('skyline-teal.svg', 77, { tint: '#16424f', glow: C.sky });
rays('rays-orange.svg', C.orange);
rays('rays-sky.svg', C.sky, 22);
hexGrid('hex-grid.svg');
shards('hero-shards.svg');
divider('divider-deco.svg');
noise('noise.svg');
for (const [k, v] of Object.entries(E)) emblem(`emblem-${k}.svg`, v);
console.log('Готово:', fs.readdirSync(OUT).length, 'файлов в', OUT);
