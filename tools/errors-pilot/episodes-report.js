'use strict';
// Итог эпизодной оценки по накопителям episodes-permatch.json.
// Папка данных: первый аргумент или DC_PILOT_DIR (по умолчанию tools/errors-pilot/pilot-data). См. README.md.
const path = require('path');
const DATA = path.resolve(process.argv[2] || process.env.DC_PILOT_DIR || path.join(__dirname, 'pilot-data'));
const P = (f) => path.join(DATA, f);
const SRC = path.join(__dirname, '..', '..', 'src');
const fs = require('fs');
const pm = JSON.parse(fs.readFileSync(P('episodes-permatch.json'), 'utf8'));
console.log('matches', pm.length);
const merge = (list, field) => { const acc = new Map(); for (const mm of list) for (const [k, v] of mm[field]) { let o = acc.get(k); if (!o) acc.set(k, (o = [0, 0, 0, 0, 0, 0])); for (let i = 0; i < 6; i++) o[i] += v[i]; } return acc; };
const est = (acc, exposedIdx, minN = 5) => { // exposed vs unexposed standardised to exposed distribution
  let num = 0, w = 0, nExp = 0, nCtl = 0, mExp = 0, mCtl = 0;
  for (const o of acc.values()) {
    const ne = exposedIdx.reduce((s, i) => s + o[i * 2], 0), se = exposedIdx.reduce((s, i) => s + o[i * 2 + 1], 0);
    const nc = o[0] * (exposedIdx.includes(0) ? 0 : 1), sc = o[1] * (exposedIdx.includes(0) ? 0 : 1);
    if (ne < minN || nc < minN) continue;
    num += ne * (se / ne - sc / nc); w += ne; nExp += ne; nCtl += nc; mExp += se; mCtl += sc;
  }
  return { diff: w ? num / w : null, nExp, nCtl, meanExp: nExp ? mExp / nExp : null, meanCtl: nCtl ? mCtl / nCtl : null };
};
const boot = (field, exposedIdx, B = 40) => {
  const ds = [];
  for (let b = 0; b < B; b++) { const s = []; for (let i = 0; i < pm.length; i++) s.push(pm[Math.floor(Math.random() * pm.length)]); const e = est(merge(s, field), exposedIdx); if (e.diff !== null) ds.push(e.diff); }
  ds.sort((a, b) => a - b); return [ds[Math.floor(ds.length * 0.05)], ds[Math.floor(ds.length * 0.95)]];
};
const f2 = (v) => (v === null ? 'n/a' : (v >= 0 ? '+' : '') + v.toFixed(3));
const A = merge(pm, 'solo'); const e1 = est(A, [1]); const c1 = boot('solo', [1]);
console.log('\nA. Смерть в одиночку vs смерть рядом с союзником (в стратах: фаза×живые союзники×живые соперники×ранг)');
console.log('   событий в одиночку', e1.nExp, 'не в одиночку', e1.nCtl, '| среднее (убитые соперники − убитые союзники) за 75 с после: одиночные', f2(e1.meanExp), 'прочие', f2(e1.meanCtl));
console.log('   разница при одинаковой обстановке:', f2(e1.diff), '[90%', f2(c1[0]), f2(c1[1]) + ']  (отрицательно = команда теряет больше после одиночной смерти)');
const Bf = merge(pm, 'fight');
const e2 = est(Bf, [1, 2]); const c2 = boot('fight', [1, 2]);
console.log('\nB. Драка (≥3 смертей после 10:00): есть союзник «фармит вдали» vs нет (в стратах: фаза×размер драки×число присутствующих×ранг)');
console.log('   команд-эпизодов с таким союзником', e2.nExp, 'без', e2.nCtl, '| средний итог драки (убитые соперники − убитые союзники): с фармящим', f2(e2.meanExp), 'без', f2(e2.meanCtl));
console.log('   разница при одинаковой обстановке:', f2(e2.diff), '[90%', f2(c2[0]), f2(c2[1]) + ']');
const e3 = est(Bf, [2]); const c3 = boot('fight', [2]);
console.log('   (двое и больше фармящих вдали vs нет):', f2(e3.diff), '[90%', f2(c3[0]), f2(c3[1]) + ']', 'n', e3.nExp);
