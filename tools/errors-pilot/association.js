'use strict';
// Связь правил с победой: поправка на ранг, число смертей и длину матча, кластерный бутстреп по матчам.
// Папка данных: первый аргумент или DC_PILOT_DIR (по умолчанию tools/errors-pilot/pilot-data). См. README.md.
const path = require('path');
const DATA = path.resolve(process.argv[2] || process.env.DC_PILOT_DIR || path.join(__dirname, 'pilot-data'));
const P = (f) => path.join(DATA, f);
const SRC = path.join(__dirname, '..', '..', 'src');
const fs = require('fs');
const readline = require('readline');
// Необязательно: таблицы героев (DC_ROOLS_FILE — hero-roles.json, DC_BENCH_FILE — hero-benchmarks.json) для разбивки по классам.
const readOpt = (f) => (f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const rolesDoc = readOpt(process.env.DC_ROLES_FILE);
const benchDoc = readOpt(process.env.DC_BENCH_FILE);
const rolesArr = rolesDoc ? (Array.isArray(rolesDoc.heroes) ? rolesDoc.heroes : Object.values(rolesDoc.heroes)) : [];
const nameById = {}; if (benchDoc) for (const [id, h] of Object.entries(benchDoc.heroes)) nameById[id] = h.name;
const info = {};
for (const r of rolesArr) info[r.name] = { cls: r.class || 'support?', mobile: !!(r.mobility && ((r.mobility.abilitiesWithDashOrTeleport || []).length || r.mobility.airborne)) };
const KEYS = ['lane_trades', 'farm_while_fight', 'map_timings', 'lost_souls', 'solo_deaths', 'died_rich', 'survivability_purchase', 'counter_missing'];

(async () => {
  const rows = [];
  const rl = readline.createInterface({ input: fs.createReadStream(P('rows.jsonl')), crlfDelay: Infinity });
  for await (const l of rl) if (l) rows.push(JSON.parse(l));
  const withRank = rows.filter((r) => r.tier !== null);
  console.log('rows', rows.length, 'with rank', withRank.length, 'win rate', (rows.reduce((s, r) => s + r.won, 0) / rows.length).toFixed(3));
  const td = {}; for (const r of withRank) td[r.tier] = (td[r.tier] || 0) + 1; console.log('tier counts', JSON.stringify(td));
  const band = (t) => (t <= 5 ? 0 : t <= 7 ? 1 : 2);
  const dB = (d) => (d <= 3 ? 0 : d <= 5 ? 1 : d <= 7 ? 2 : d <= 9 ? 3 : d <= 12 ? 4 : 5);
  const uB = (s) => (s < 1800 ? 0 : s < 2400 ? 1 : 2);
  const strat = (r) => band(r.tier) * 18 + dB(r.d) * 3 + uB(r.dur);
  // MH-разница долей побед «с флагом» минус «без» внутри страт
  const estimate = (sample, pred, elig) => {
    const st = new Map();
    for (const r of sample) {
      if (!elig(r)) continue;
      const k = strat(r); let o = st.get(k); if (!o) st.set(k, (o = [0, 0, 0, 0]));
      if (pred(r)) { o[0]++; o[1] += r.won; } else { o[2]++; o[3] += r.won; }
    }
    let num = 0, den = 0, nW = 0, nWo = 0, wW = 0, wWo = 0;
    for (const o of st.values()) {
      nW += o[0]; nWo += o[2]; wW += o[1]; wWo += o[3];
      if (o[0] < 5 || o[2] < 5) continue;
      const w = (o[0] * o[2]) / (o[0] + o[2]);
      num += w * (o[1] / o[0] - o[3] / o[2]); den += w;
    }
    return { diff: den ? num / den : null, nFlag: nW, nNo: nWo, rawWith: nW ? wW / nW : null, rawWithout: nWo ? wWo / nWo : null };
  };
  // кластерный бутстреп по матчам
  const byMatch = new Map(); for (const r of withRank) { let a = byMatch.get(r.mid); if (!a) byMatch.set(r.mid, (a = [])); a.push(r); }
  const mids = [...byMatch.keys()];
  const boot = (pred, elig, B = 40) => {
    const ds = [];
    for (let b = 0; b < B; b++) {
      const sample = [];
      for (let i = 0; i < mids.length; i++) for (const r of byMatch.get(mids[Math.floor(Math.random() * mids.length)])) sample.push(r);
      const e = estimate(sample, pred, elig); if (e.diff !== null) ds.push(e.diff);
    }
    ds.sort((a, b) => a - b);
    return ds.length ? [ds[Math.floor(ds.length * 0.05)], ds[Math.floor(ds.length * 0.95)]] : [null, null];
  };
  const pp = (v) => (v === null ? '  n/a' : (v * 100 >= 0 ? '+' : '') + (v * 100).toFixed(1));
  const fireOf = (k) => (r) => r.keys.includes(k);
  const eligOf = (k) => (r) => r.keys.includes(k) || r.checked.includes(k);
  console.log('\n=== Связь правил с победой (с поправкой на ранг, смерти, длину матча), 90% интервал по матчам ===');
  console.log('правило'.padEnd(24), 'срабатывает', 'из', 'в лоб(с/без)', 'с поправкой п.п.', '[90% ИИ]');
  const results = {};
  for (const k of KEYS) {
    const e = estimate(withRank, fireOf(k), eligOf(k));
    const ci = boot(fireOf(k), eligOf(k));
    results[k] = { ...e, ci };
    console.log(k.padEnd(24), String(e.nFlag).padStart(7), String(e.nFlag + e.nNo).padStart(8), `${(e.rawWith * 100).toFixed(0)}%/${(e.rawWithout * 100).toFixed(0)}%`.padStart(10), pp(e.diff).padStart(10), `[${pp(ci[0])}; ${pp(ci[1])}]`);
  }
  // solo deaths: по числу
  console.log('\n=== Смерти в одиночку: по числу (только игры с маршрутами), с поправкой ===');
  for (const [name, pred] of [['>=1', (r) => r.solo >= 1], ['>=2', (r) => r.solo >= 2], ['>=3', (r) => r.solo >= 3], ['>=4', (r) => r.solo >= 4], ['>=5', (r) => r.solo >= 5]]) {
    const el = (r) => r.solo !== null; const e = estimate(withRank, pred, el); const ci = boot(pred, el, 25);
    console.log(('solo ' + name).padEnd(10), 'игр с таким', String(e.nFlag).padStart(6), 'поправка', pp(e.diff), `[${pp(ci[0])}; ${pp(ci[1])}]`);
  }
  // по доле: solo/late
  for (const th of [0.3, 0.5, 0.7]) {
    const pred = (r) => r.late >= 3 && r.solo / r.late >= th; const el = (r) => r.solo !== null && r.late >= 3;
    const e = estimate(withRank, pred, el); const ci = boot(pred, el, 25);
    console.log(('доля>=' + th).padEnd(10), 'игр', String(e.nFlag).padStart(6), 'поправка', pp(e.diff), `[${pp(ci[0])}; ${pp(ci[1])}]`);
  }
  // по классу и мобильности героя
  console.log('\n=== Смерти в одиночку (>=2): по группам героев ===');
  const groups = { 'мобильные (рывок/полёт/телепорт)': (r) => (info[nameById[r.hero]] || {}).mobile === true, 'без мобильности': (r) => (info[nameById[r.hero]] || {}).mobile === false };
  for (const c of ['assassin', 'marksman', 'brawler', 'mystic', 'support?']) groups['класс ' + c] = (r) => (info[nameById[r.hero]] || {}).cls === c;
  for (const [g, f] of Object.entries(groups)) {
    const sample = withRank.filter(f); const pred = (r) => r.solo >= 2; const el = (r) => r.solo !== null;
    const e = estimate(sample, pred, el);
    console.log(g.padEnd(36), 'игроков', String(sample.length).padStart(6), 'срабатывает', ((e.nFlag / Math.max(1, e.nFlag + e.nNo)) * 100).toFixed(0).padStart(3) + '%', 'поправка', pp(e.diff));
  }
  // по рангу
  console.log('\n=== Правила по рангам (поправка, п.п.) ===');
  for (const [bn, bf] of [['Ранги 1-5', (r) => r.tier <= 5], ['Ранги 6-7', (r) => r.tier >= 6 && r.tier <= 7], ['Ранги 8+', (r) => r.tier >= 8]]) {
    const sample = withRank.filter(bf);
    console.log(bn.padEnd(10), 'игроков', sample.length, KEYS.slice(0, 7).map((k) => { const e = estimate(sample, fireOf(k), eligOf(k)); return k.split('_')[0] + ' ' + pp(e.diff); }).join(' | '));
  }
  fs.writeFileSync(P('a20.json'), JSON.stringify(results));
})();
