'use strict';
// Сцены для шапок экранов. У каждого раздела своя композиция, общая только палитра.
// Запуск: node tools/make-scenes.js (сначала отрабатывает make-art.js)
const { rng, f, save, C, skylineLayer } = require('./make-art.js');
const W = 1400, H = 240;

const defs = (tint = C.orange) => `<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070f13"/><stop offset="0.55" stop-color="#0b1c23"/><stop offset="1" stop-color="${tint}" stop-opacity="0.38"/></linearGradient>
<linearGradient id="beam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${C.sky}" stop-opacity="0.34"/><stop offset="1" stop-color="${C.sky}" stop-opacity="0"/></linearGradient>
<linearGradient id="beamw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.32"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="barg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.sky}" stop-opacity="0.85"/><stop offset="1" stop-color="${C.teal2}" stop-opacity="0.2"/></linearGradient>
<linearGradient id="og" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.orange2}"/><stop offset="1" stop-color="${C.orange}"/></linearGradient>
<radialGradient id="halo"><stop offset="0" stop-color="${C.sun}" stop-opacity="0.55"/><stop offset="1" stop-color="${C.sun}" stop-opacity="0"/></radialGradient>
<radialGradient id="ohalo"><stop offset="0" stop-color="${C.orange}" stop-opacity="0.5"/><stop offset="1" stop-color="${C.orange}" stop-opacity="0"/></radialGradient>
<filter id="gl" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
const wrap = (name, tint, body) => save(name, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMaxYMid slice">${defs(tint)}<rect width="${W}" height="${H}" fill="url(#bg)"/>${body}</svg>`);
const city = (seed, a = 0.9) => `<g opacity="${a}">${skylineLayer(seed, W, H, 40, 120, '#12303a', false, 0)}</g>${skylineLayer(seed + 3, W, H, 50, 160, '#0b1d24', true, 0.14)}`;
const hex = (x, y, R, rot = 0) => [0, 1, 2, 3, 4, 5].map((k) => { const a = Math.PI / 3 * k + rot; return f(x + R * Math.cos(a)) + ',' + f(y + R * Math.sin(a)); }).join(' ');

// 1. Главная: Таймс-сквер с рекламными щитами и прожекторами
{
  const r = rng(3); let s = '';
  s += `<circle cx="1180" cy="58" r="90" fill="url(#halo)"/><circle cx="1180" cy="58" r="30" fill="${C.cream}" opacity="0.92"/><circle cx="1170" cy="52" r="6" fill="#d9cdb2" opacity="0.6"/><circle cx="1190" cy="68" r="4" fill="#d9cdb2" opacity="0.5"/>`;
  s += `<polygon points="860,${H} 900,${H} 1010,-20 960,-20" fill="url(#beam)"/><polygon points="1280,${H} 1330,${H} 1230,-20 1170,-20" fill="url(#beam)"/>`;
  s += city(31);
  const boards = [[640, 96, 70, 46, 'og'], [760, 70, 52, 62, 'barg'], [900, 110, 84, 40, 'og'], [1060, 84, 60, 54, 'barg'], [1210, 100, 78, 44, 'og']];
  for (const [x, y, w, h, g] of boards) {
    s += `<g filter="url(#gl)"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="url(#${g})" opacity="0.9"/></g><rect x="${x + 5}" y="${y + 6}" width="${w * 0.6}" height="5" fill="#fff" opacity="0.7"/><rect x="${x + 5}" y="${y + 16}" width="${w * 0.4}" height="3" fill="#fff" opacity="0.5"/>`;
    for (let i = 0; i < 4; i++) s += `<rect x="${x + 8 + i * 12}" y="${y + h - 12}" width="8" height="${f(4 + r() * 8)}" fill="#fff" opacity="0.35"/>`;
    s += `<rect x="${x + w / 2 - 1}" y="${y + h}" width="2" height="${H - y - h}" fill="#08161b"/>`;
  }
  wrap('scene-home.svg', C.orange, s);
}

// 2. Тренер: тренировочный полигон, перспективная сетка и мишень
{
  let s = '';
  const vx = 930, hy = 150;
  s += `<rect y="${hy}" width="${W}" height="${H - hy}" fill="#071217"/>`;
  for (let i = -14; i <= 14; i++) s += `<line x1="${vx}" y1="${hy}" x2="${vx + i * 90}" y2="${H}" stroke="${C.sky}" stroke-opacity="0.28" stroke-width="1"/>`;
  for (let k = 1; k < 9; k++) { const y = hy + Math.pow(k / 8, 2) * (H - hy); s += `<line x1="0" y1="${f(y)}" x2="${W}" y2="${f(y)}" stroke="${C.sky}" stroke-opacity="${f(0.1 + k * 0.03)}"/>`; }
  s += `<line x1="0" y1="${hy}" x2="${W}" y2="${hy}" stroke="${C.orange2}" stroke-opacity="0.7"/><circle cx="${vx}" cy="${hy}" r="140" fill="url(#ohalo)"/>`;
  s += `<rect x="${vx - 2}" y="104" width="4" height="${hy - 104}" fill="#0d2229"/>`;
  s += `<g filter="url(#gl)" fill="none"><circle cx="${vx}" cy="104" r="62" stroke="${C.sky}" stroke-width="2.5"/><circle cx="${vx}" cy="104" r="46" stroke="${C.orange2}" stroke-width="3"/><circle cx="${vx}" cy="104" r="30" stroke="${C.sky}" stroke-width="2.5"/><circle cx="${vx}" cy="104" r="14" fill="${C.orange}" stroke="none"/></g>`;
  s += `<path d="M${vx} 36v-18M${vx} 172v-6M${vx - 76} 104h-18M${vx + 76} 104h18" stroke="${C.sky}" stroke-width="2"/>`;
  const arrows = [[500, 200, 760, 70, 880, 98], [380, 130, 700, 20, 888, 110], [640, 214, 800, 120, 896, 112]];
  for (const [x0, y0, cx, cy, x1, y1] of arrows) s += `<path d="M${x0} ${y0} Q${cx} ${cy} ${x1} ${y1}" fill="none" stroke="${C.orange2}" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round" opacity="0.8"/><circle cx="${x1}" cy="${y1}" r="3.5" fill="${C.sun}"/>`;
  wrap('scene-coach.svg', C.sky, s);
}

// 3. Ошибки: город с битой картинкой, трещины и предупреждение
{
  const r = rng(9); let s = `<g id="cty">${city(44, 1)}</g>`;
  const bands = [[30, 14, 22], [66, 8, -30], [98, 20, 18], [140, 10, -16], [172, 16, 34], [205, 8, -22]];
  bands.forEach(([y, h, dx], i) => { s += `<clipPath id="c${i}"><rect y="${y}" width="${W}" height="${h}"/></clipPath><g clip-path="url(#c${i})"><rect y="${y}" width="${W}" height="${h}" fill="#070f13"/><use href="#cty" x="${dx}"/></g><g clip-path="url(#c${i})" opacity="0.45"><use href="#cty" x="${dx + 6}" style="filter:hue-rotate(160deg) saturate(3)"/></g>`; });
  const cx = 1060, cy = 86;
  s += `<circle cx="${cx}" cy="${cy}" r="120" fill="url(#ohalo)" opacity="0.6"/><g stroke="#ffd9d4" fill="none" stroke-linecap="round" filter="url(#gl)">`;
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + r() * 0.4; let x = cx, y = cy, d = `M${cx} ${cy}`; const len = 60 + r() * 120;
    for (let t = 0; t < len; t += 18) { x += Math.cos(a + (r() - 0.5) * 0.7) * 18; y += Math.sin(a + (r() - 0.5) * 0.7) * 18; d += `L${f(x)} ${f(y)}`; }
    s += `<path d="${d}" stroke-width="${f(1 + r() * 1.5)}" opacity="${f(0.45 + r() * 0.5)}"/>`;
  }
  s += `</g><g filter="url(#gl)"><polygon points="${cx},${cy - 30} ${cx + 28},${cy + 20} ${cx - 28},${cy + 20}" fill="#0b1c23" stroke="#ff7b7b" stroke-width="3" stroke-linejoin="round"/><rect x="${cx - 1.5}" y="${cy - 12}" width="3" height="16" fill="#ff7b7b"/><circle cx="${cx}" cy="${cy + 11}" r="2.2" fill="#ff7b7b"/></g>`;
  for (let i = 0; i < 16; i++) { const x = cx - 150 + r() * 300, y = cy - 80 + r() * 160, z = 4 + r() * 12; s += `<polygon points="${f(x)},${f(y)} ${f(x + z)},${f(y + z * 0.4)} ${f(x + z * 0.3)},${f(y + z)}" fill="#ff7b7b" opacity="${f(0.15 + r() * 0.4)}"/>`; }
  wrap('scene-growth.svg', '#ff7b7b', s);
}

// 4. Мои матчи: киноплёнка с кадрами-матчами
{
  const r = rng(12); let s = `<circle cx="1000" cy="160" r="230" fill="url(#ohalo)" opacity="0.45"/><g transform="rotate(-5 800 120)">`;
  s += `<rect x="360" y="52" width="1200" height="132" fill="#050d10" stroke="${C.teal2}" stroke-width="2"/>`;
  for (let x = 372; x < 1550; x += 22) s += `<rect x="${x}" y="60" width="12" height="9" rx="2" fill="${C.teal2}" opacity="0.7"/><rect x="${x}" y="167" width="12" height="9" rx="2" fill="${C.teal2}" opacity="0.7"/>`;
  for (let i = 0; i < 8; i++) {
    const x = 380 + i * 148, win = r() < 0.5, c = win ? C.sky : '#ff7b7b';
    s += `<rect x="${x}" y="78" width="136" height="86" fill="#0a1a20" stroke="${c}" stroke-opacity="0.6"/><rect x="${x}" y="78" width="136" height="86" fill="${c}" opacity="0.08"/>`;
    let bx = x + 6; while (bx < x + 128) { const w = 10 + r() * 16, h = 14 + r() * 40; s += `<rect x="${f(bx)}" y="${f(164 - h)}" width="${f(w)}" height="${f(h)}" fill="#12303a"/>`; bx += w + 2; }
    s += `<circle cx="${x + 106}" cy="100" r="${f(8 + r() * 6)}" fill="${c}" opacity="0.55" filter="url(#gl)"/><rect x="${x + 10}" y="86" width="${f(20 + r() * 30)}" height="5" fill="${C.cream}" opacity="0.6"/><rect x="${x + 10}" y="95" width="26" height="3" fill="${C.cream}" opacity="0.3"/>`;
  }
  s += `</g>`;
  for (let i = 0; i < 40; i++) s += `<rect x="${i * 36}" y="${H - 8 - (i % 5 === 0 ? 8 : 0)}" width="1.5" height="${i % 5 === 0 ? 14 : 8}" fill="${C.sky}" opacity="0.35"/>`;
  wrap('scene-matches.svg', C.orange2, s);
}

// 5. Мои герои: музей с арками, лучами света и силуэтами
{
  let s = ''; const hues = [C.orange, C.sky, '#ff7b7b', '#8fe3a8', '#b79cff'];
  for (let i = 0; i < 5; i++) {
    const x = 560 + i * 160, c = hues[i];
    s += `<polygon points="${x + 20},0 ${x + 100},0 ${x + 130},${H} ${x - 10},${H}" fill="url(#beamw)" opacity="0.16"/>`;
    s += `<path d="M${x} ${H} V92 a60 60 0 0 1 120 0 V${H}Z" fill="#06121a" stroke="${c}" stroke-opacity="0.55" stroke-width="2"/>`;
    s += `<path d="M${x + 12} ${H} V96 a48 48 0 0 1 96 0 V${H}Z" fill="${c}" opacity="0.08"/>`;
    s += `<g filter="url(#gl)"><circle cx="${x + 60}" cy="112" r="17" fill="#0b1c23" stroke="${c}" stroke-width="2.5"/><path d="M${x + 24} ${H - 24} C${x + 28} 154 ${x + 46} 140 ${x + 60} 140 S${x + 92} 154 ${x + 96} ${H - 24}Z" fill="#0b1c23" stroke="${c}" stroke-width="2.5"/></g>`;
    s += `<rect x="${x + 8}" y="${H - 24}" width="104" height="24" fill="#10262e" stroke="${c}" stroke-opacity="0.4"/><circle cx="${x + 60}" cy="${H - 12}" r="3" fill="${c}"/>`;
  }
  wrap('scene-myheroes.svg', C.sky, s);
}

// 6. Мета: биржа, столбцы как небоскрёбы и линия тренда
{
  const r = rng(6); let s = '';
  for (let k = 1; k < 5; k++) s += `<line x1="0" y1="${k * 46}" x2="${W}" y2="${k * 46}" stroke="${C.sky}" stroke-opacity="0.1" stroke-dasharray="3 6"/>`;
  let v = 70; const pts = [];
  for (let i = 0; i < 34; i++) {
    v += (r() - 0.38) * 26; v = Math.max(40, Math.min(190, v)); const x = 420 + i * 28, h = v;
    s += `<rect x="${x}" y="${f(H - h)}" width="20" height="${f(h)}" fill="url(#barg)"/><rect x="${x + 8}" y="${f(H - h - 10)}" width="2" height="10" fill="${C.sky}" opacity="0.6"/>`;
    for (let wy = H - h + 8; wy < H - 6; wy += 11) if (r() < 0.35) s += `<rect x="${x + 5}" y="${f(wy)}" width="4" height="5" fill="${C.sun}" opacity="0.6"/>`;
    pts.push([x + 10, H - h - 18 - r() * 6]);
  }
  const d = pts.map((p, i) => (i ? 'L' : 'M') + f(p[0]) + ' ' + f(p[1])).join('');
  s += `<path d="${d}" fill="none" stroke="url(#og)" stroke-width="3" stroke-linejoin="round" filter="url(#gl)"/>`;
  pts.filter((_, i) => i % 5 === 0).forEach(([x, y]) => { s += `<circle cx="${f(x)}" cy="${f(y)}" r="4.5" fill="#0b1c23" stroke="${C.orange2}" stroke-width="2.5"/>`; });
  s += `<g font-family="monospace" font-size="10" fill="${C.cream}" opacity="0.5"><text x="420" y="18">+2.4%</text><text x="700" y="30">+0.8%</text><text x="980" y="14">+5.1%</text></g>`;
  wrap('scene-meta.svg', C.sky, s);
}

// 7. Перед игрой: штабная карта, маршруты, радар
{
  let s = `<g stroke="${C.sky}" stroke-opacity="0.12" fill="none">`;
  for (let row = 0; row < 8; row++) for (let col = 0; col < 18; col++) { const x = 480 + col * 46 + (row % 2 ? 23 : 0), y = row * 40 - 6; s += `<polygon points="${hex(x, y, 24, Math.PI / 6)}"/>`; }
  s += `</g>`;
  s += `<circle cx="1120" cy="120" r="170" fill="none" stroke="${C.sky}" stroke-opacity="0.2"/><circle cx="1120" cy="120" r="110" fill="none" stroke="${C.sky}" stroke-opacity="0.2"/><circle cx="1120" cy="120" r="50" fill="none" stroke="${C.sky}" stroke-opacity="0.3"/>`;
  s += `<path d="M1120 120 L1120 -50 A170 170 0 0 1 1260 24Z" fill="${C.sky}" opacity="0.16"/><line x1="1120" y1="120" x2="1260" y2="24" stroke="${C.sky}" stroke-width="2" opacity="0.8"/>`;
  s += `<path d="M520 190 C640 120 700 200 820 130 S1000 70 1090 118" fill="none" stroke="${C.orange2}" stroke-width="3" stroke-dasharray="9 7" filter="url(#gl)"/>`;
  [[520, 190], [700, 168], [820, 130], [960, 92]].forEach(([x, y], i) => { s += `<circle cx="${x}" cy="${y}" r="9" fill="#0b1c23" stroke="${C.orange2}" stroke-width="2.5"/><text x="${x - 3.5}" y="${y + 4}" font-size="11" font-family="sans-serif" fill="${C.orange2}">${i + 1}</text>`; });
  [[1010, 60], [1180, 170], [1230, 80]].forEach(([x, y]) => { s += `<g stroke="#ff7b7b" stroke-width="3" stroke-linecap="round" filter="url(#gl)"><path d="M${x - 7} ${y - 7}l14 14M${x + 7} ${y - 7}l-14 14"/></g>`; });
  s += `<g transform="translate(1330 190)" stroke="${C.cream}" stroke-opacity="0.7" fill="none"><circle r="26"/><path d="M0 -34V34M-34 0H34" stroke-width="1"/><polygon points="0,-26 6,0 0,26 -6,0" fill="${C.orange}" stroke="none"/></g>`;
  wrap('scene-prep.svg', C.orange, s);
}

// 8. Справочник: библиотека и парящая руна
{
  const r = rng(8); let s = '';
  const tints = [C.teal2, '#2a5b69', '#7a3f2c', '#3b4f7a', '#58456f', '#8a5a2b'];
  for (let row = 0; row < 3; row++) {
    const y = 56 + row * 64; let x = 380;
    s += `<rect x="360" y="${y + 52}" width="1040" height="6" fill="#10262e"/>`;
    while (x < 1400) { const w = 8 + r() * 14, h = 34 + r() * 18, c = tints[Math.floor(r() * tints.length)]; s += `<rect x="${f(x)}" y="${f(y + 52 - h)}" width="${f(w)}" height="${f(h)}" fill="${c}"/><rect x="${f(x + 2)}" y="${f(y + 52 - h + 6)}" width="${f(w - 4)}" height="2" fill="${C.cream}" opacity="0.4"/>`; x += w + 1; }
  }
  const star = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => { const a = Math.PI / 4 * k - Math.PI / 2, rr = k % 2 ? 22 : 46; return f(980 + rr * Math.cos(a)) + ',' + f(104 + rr * Math.sin(a)); }).join(' ');
  s += `<circle cx="980" cy="104" r="120" fill="url(#ohalo)"/><g filter="url(#gl)" fill="none" stroke="${C.orange2}" stroke-width="2"><circle cx="980" cy="104" r="62"/><circle cx="980" cy="104" r="46" stroke="${C.sky}"/><polygon points="${star}"/>`;
  for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; s += `<line x1="${f(980 + 62 * Math.cos(a))}" y1="${f(104 + 62 * Math.sin(a))}" x2="${f(980 + 70 * Math.cos(a))}" y2="${f(104 + 70 * Math.sin(a))}"/>`; }
  s += `</g>`;
  for (let i = 0; i < 6; i++) { const x = 760 + r() * 460, y = 20 + r() * 150; s += `<polygon points="${f(x)},${f(y)} ${f(x + 18)},${f(y - 4)} ${f(x + 20)},${f(y + 16)} ${f(x + 2)},${f(y + 20)}" fill="${C.cream}" opacity="${f(0.15 + r() * 0.3)}"/>`; }
  wrap('scene-codex.svg', C.orange2, s);
}

// 9. Про-игроки: сцена, прожекторы, подиум, зрители
{
  const r = rng(19); let s = '';
  [600, 760, 940, 1100, 1260].forEach((x, i) => { s += `<polygon points="${x - 4},0 ${x + 4},0 ${1010 + (i - 2) * 46},${H - 60} ${1010 + (i - 2) * 46 - 90},${H - 60}" fill="url(#beamw)" opacity="0.2"/>`; });
  s += `<ellipse cx="1010" cy="${H - 60}" rx="190" ry="18" fill="${C.sun}" opacity="0.18"/>`;
  s += `<rect x="930" y="${H - 84}" width="80" height="24" fill="#12303a" stroke="${C.sky}" stroke-opacity="0.6"/><rect x="1010" y="${H - 104}" width="80" height="44" fill="#16404b" stroke="${C.orange2}" stroke-opacity="0.8"/><rect x="850" y="${H - 70}" width="80" height="10" fill="#0e262e" stroke="${C.sky}" stroke-opacity="0.4"/>`;
  s += `<g filter="url(#gl)" fill="url(#og)"><path d="M1038 ${H - 104} h24 l-3 -20 q-3 -10 -9 -10 q-6 0 -9 10z"/></g><path d="M1036 ${H - 124} h28v8h-28z" fill="${C.sun}"/>`;
  s += `<text x="1046" y="${H - 72}" font-size="22" font-family="serif" font-weight="700" fill="${C.cream}" opacity="0.8">1</text>`;
  for (let i = 0; i < 70; i++) { const x = 520 + r() * 880, y = H - 38 + r() * 40, rr = 9 + r() * 7; s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(rr)}" fill="#050d10"/>`; }
  for (let i = 0; i < 50; i++) { const c = [C.orange2, C.sky, C.cream, '#ff7b7b'][i % 4], x = f(640 + r() * 700), y = f(r() * 160); s += `<rect x="${x}" y="${y}" width="4" height="8" fill="${c}" opacity="${f(0.3 + r() * 0.6)}" transform="rotate(${f(r() * 180)} ${x} ${y})"/>`; }
  wrap('scene-players.svg', C.orange2, s);
}

// 10. Настройки: мастерская, шестерни и ползунки
{
  const gear = (cx, cy, R, n, c, w = 3) => {
    const pts = []; for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * Math.PI * 2, rr = i % 2 ? R : R * 1.16; pts.push([cx + rr * Math.cos(a - 0.08), cy + rr * Math.sin(a - 0.08)], [cx + rr * Math.cos(a + 0.08), cy + rr * Math.sin(a + 0.08)]); }
    return `<g filter="url(#gl)"><polygon points="${pts.map((p) => f(p[0]) + ',' + f(p[1])).join(' ')}" fill="${c}" fill-opacity="0.1" stroke="${c}" stroke-width="${w}" stroke-linejoin="round"/><circle cx="${cx}" cy="${cy}" r="${f(R * 0.42)}" fill="none" stroke="${c}" stroke-width="${w}"/><circle cx="${cx}" cy="${cy}" r="${f(R * 0.14)}" fill="${c}"/></g>`;
  };
  let s = '';
  for (let x = 400; x < W; x += 40) s += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${C.sky}" stroke-opacity="0.07"/>`;
  for (let y = 20; y < H; y += 40) s += `<line x1="400" y1="${y}" x2="${W}" y2="${y}" stroke="${C.sky}" stroke-opacity="0.07"/>`;
  s += gear(900, 110, 74, 14, C.sky) + gear(1040, 56, 46, 10, C.orange2) + gear(1052, 188, 38, 9, C.sky, 2.5) + gear(780, 214, 30, 8, C.orange2, 2.5);
  [[560, 190, 0.7], [560, 160, 0.3], [560, 130, 0.5]].forEach(([x, y, v]) => { s += `<rect x="${x}" y="${y}" width="200" height="4" rx="2" fill="#10262e" stroke="${C.sky}" stroke-opacity="0.4"/><rect x="${x}" y="${y}" width="${200 * v}" height="4" rx="2" fill="url(#og)"/><circle cx="${x + 200 * v}" cy="${y + 2}" r="8" fill="#0b1c23" stroke="${C.orange2}" stroke-width="2.5"/>`; });
  [[1290, 40], [1330, 200], [470, 40]].forEach(([x, y]) => { s += `<polygon points="${hex(x, y, 9)}" fill="none" stroke="${C.cream}" stroke-opacity="0.5" stroke-width="2"/>`; });
  wrap('scene-settings.svg', C.sky, s);
}

// значки классов героев
{
  const ic = (name, color, body) => save('class-' + name + '.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>');
  ic('mystic', '#b79cff', '<path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z"/>');
  ic('marksman', '#5fd4ee', '<circle cx="12" cy="12" r="6"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>');
  ic('brawler', '#ff9966', '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/>');
  ic('assassin', '#ff7b7b', '<path d="M5 19L17 7M14 5l5 0 0 5M5 19l3-1M5 19l1-3"/>');
}
// иллюстрации пустых состояний (320x200)
{
  const EW = 320, EH = 200;
  const ed = `<defs><radialGradient id="h"><stop offset="0" stop-color="${C.sun}" stop-opacity="0.7"/><stop offset="1" stop-color="${C.sun}" stop-opacity="0"/></radialGradient><radialGradient id="o"><stop offset="0" stop-color="${C.orange}" stop-opacity="0.45"/><stop offset="1" stop-color="${C.orange}" stop-opacity="0"/></radialGradient><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.sky}"/><stop offset="1" stop-color="${C.orange2}"/></linearGradient><filter id="gl" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  const ew = (name, body) => save(name, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${EW} ${EH}">${ed}${body}</svg>`);
  const ground = `<ellipse cx="160" cy="176" rx="130" ry="10" fill="#000" opacity="0.35"/>`;
  // generic: фонарь и два окна
  { const r = rng(2); let s = ground + `<circle cx="226" cy="40" r="12" fill="${C.cream}" opacity="0.9"/><circle cx="231" cy="37" r="11" fill="#081216"/>`;
    for (let i = 0; i < 14; i++) s += `<circle cx="${f(20 + r() * 280)}" cy="${f(10 + r() * 80)}" r="${f(0.6 + r() * 1.2)}" fill="${C.cream}" opacity="${f(0.2 + r() * 0.5)}"/>`;
    s += `<rect x="40" y="90" width="64" height="86" fill="#0c1d23" stroke="${C.teal2}"/><rect x="214" y="70" width="70" height="106" fill="#0c1d23" stroke="${C.teal2}"/>`;
    [[52, 102], [76, 102], [52, 130], [76, 150], [226, 84], [252, 84], [252, 118], [226, 148]].forEach(([x, y], i) => { s += `<rect x="${x}" y="${y}" width="14" height="18" fill="${i % 3 === 0 ? C.sun : '#12303a'}" opacity="${i % 3 === 0 ? 0.85 : 1}"/>`; });
    s += `<circle cx="160" cy="76" r="46" fill="url(#h)"/><g stroke="${C.teal2}" stroke-width="4" fill="none" stroke-linecap="round"><path d="M160 176V84"/><path d="M160 84c0-14 14-14 22-6"/></g><circle cx="182" cy="78" r="6" fill="${C.sun}" filter="url(#gl)"/><path d="M148 176h24" stroke="${C.teal2}" stroke-width="5" stroke-linecap="round"/>`;
    ew('empty-generic.svg', s); }
  // Выбери матч: плёнка и «плей»
  ew('empty-matches.svg', ground + `<circle cx="160" cy="92" r="70" fill="url(#o)"/><g filter="url(#gl)" fill="none" stroke="url(#g)" stroke-width="4" stroke-linejoin="round"><circle cx="160" cy="92" r="46"/><path d="M148 72l30 20-30 20z" fill="${C.orange}" fill-opacity="0.35"/></g><g fill="#12303a" stroke="${C.teal2}"><rect x="40" y="150" width="240" height="22" rx="3"/></g>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => `<rect x="${48 + i * 20}" y="155" width="10" height="5" rx="1.5" fill="#081216"/><rect x="${48 + i * 20}" y="164" width="10" height="5" rx="1.5" fill="#081216"/>`).join('')}<path d="M70 60l-26 16 26 16" fill="none" stroke="${C.orange2}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" filter="url(#gl)"/>`);
  // Выбери соперника: контур героя и лупа
  ew('empty-codex.svg', ground + `<circle cx="160" cy="96" r="72" fill="url(#o)"/><g filter="url(#gl)" fill="#0c1d23" stroke="${C.sky}" stroke-width="3.5" stroke-dasharray="7 6" stroke-linecap="round"><circle cx="160" cy="78" r="26"/><path d="M104 172c4-40 26-58 56-58s52 18 56 58z"/></g><g filter="url(#gl)" fill="none" stroke="${C.orange2}" stroke-width="5" stroke-linecap="round"><circle cx="210" cy="64" r="22" fill="#081216" fill-opacity="0.7"/><path d="M226 80l26 26"/></g><text x="203" y="73" font-family="serif" font-weight="700" font-size="26" fill="${C.orange2}">?</text>`);
  // Тренер: цель ждёт
  ew('empty-coach.svg', ground + `<circle cx="160" cy="92" r="76" fill="url(#o)"/><g filter="url(#gl)" fill="none" stroke-width="4"><circle cx="160" cy="92" r="58" stroke="${C.sky}"/><circle cx="160" cy="92" r="38" stroke="${C.orange2}"/><circle cx="160" cy="92" r="18" stroke="${C.sky}"/><circle cx="160" cy="92" r="6" fill="${C.orange}" stroke="none"/></g><path d="M58 150C100 120 130 100 154 94" stroke="${C.orange2}" stroke-width="3" stroke-dasharray="3 8" stroke-linecap="round" fill="none"/>`);
  // Игроки: пустой подиум и прожектор
  ew('empty-players.svg', `<polygon points="150,0 170,0 230,170 100,170" fill="#fff" opacity="0.08"/>` + ground + `<ellipse cx="160" cy="170" rx="80" ry="9" fill="${C.sun}" opacity="0.25"/><g fill="#12303a" stroke="${C.teal2}"><rect x="96" y="132" width="60" height="38"/><rect x="156" y="112" width="60" height="58"/><rect x="216" y="146" width="40" height="24"/></g><g font-family="serif" font-weight="700" font-size="22" fill="${C.cream}" opacity="0.6"><text x="120" y="158">2</text><text x="180" y="146">1</text><text x="230" y="166" font-size="16">3</text></g><g filter="url(#gl)" fill="none" stroke="${C.orange2}" stroke-width="3.5" stroke-linejoin="round"><path d="M172 112c-1-14 2-22 14-22s15 8 14 22z" stroke-dasharray="5 5"/></g>`);
  // Данные: радар
  ew('empty-meta.svg', ground + `<circle cx="160" cy="92" r="80" fill="url(#o)"/><g fill="none" stroke="${C.sky}" stroke-opacity="0.45" stroke-width="1.5"><circle cx="160" cy="92" r="64"/><circle cx="160" cy="92" r="42"/><circle cx="160" cy="92" r="20"/><path d="M160 28v128M96 92h128"/></g><path d="M160 92L160 28A64 64 0 0 1 218 62Z" fill="${C.sky}" opacity="0.22"/><line x1="160" y1="92" x2="218" y2="62" stroke="${C.sky}" stroke-width="2.5" filter="url(#gl)"/><circle cx="120" cy="120" r="4" fill="${C.orange2}" filter="url(#gl)"/><circle cx="190" cy="124" r="3" fill="${C.orange2}" opacity="0.6"/>`);
}

console.log('Сцены готовы');
