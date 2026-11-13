'use strict';
// Нормы по герою и рангу для раздела «Ошибки»: квантили «сколько смертей в одиночку / эпизодов фарма при драке /
// отставания на линии за игру» у игроков того же героя и ранга. Читает pilot-data/matches.jsonl и ranks.json
// (см. README.md), пишет src/core/data/errorNorms.json — только агрегаты, без личных данных.
//
// Запуск: node tools/errors-pilot/norms.js [папка_данных]
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const DATA = path.resolve(process.argv[2] || process.env.DC_PILOT_DIR || path.join(__dirname, 'pilot-data'));
const SRC = path.join(__dirname, '..', '..', 'src', 'core');
const { playerFeatures } = require(path.join(SRC, 'features'));
const L = require(path.join(SRC, 'leaks'));
const D = require(path.join(SRC, 'deaths'));
const assets = JSON.parse(fs.readFileSync(process.env.DC_ASSETS || path.join(DATA, 'assets.json'), 'utf8'));
const ranks = JSON.parse(fs.readFileSync(path.join(DATA, 'ranks.json'), 'utf8'));
const BAND = (t) => (t <= 5 ? 0 : t <= 7 ? 1 : 2);
const MIN_N = 60;

const q = (a, p) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) * p)] : null; };
const summarize = (a) => ({ n: a.filter(Number.isFinite).length, p25: q(a, 0.25), p50: q(a, 0.5), p75: q(a, 0.75), p90: q(a, 0.9) });

(async () => {
  const cells = new Map(); // `${hero}|${band}` -> метрики
  const get = (k) => { let c = cells.get(k); if (!c) cells.set(k, (c = { solo: [], farm: [], late: [], laneGap: [], lostPD: [], d10: [], n: 0 })); return c; };
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(DATA, 'matches.jsonl')), crlfDelay: Infinity });
  let nm = 0;
  for await (const line of rl) {
    if (!line) continue;
    const m = JSON.parse(line);
    nm++;
    const rk = ranks[m.match_id] || {};
    for (const me of m.players) {
      if (me.abandoned || !me.stats || me.stats.length < 3) continue;
      const rank = rk[me.account_id];
      if (!Number.isFinite(rank)) continue;
      const band = BAND(Math.floor(rank / 10));
      let f;
      try { f = playerFeatures(me, m, assets); } catch { continue; }
      const solo = D.soloDeathRows(m, me);
      const fe = L.farmEpisodes(m, me);
      const late = (me.deaths || []).filter((d) => d[0] >= 600).length;
      const rec = {
        solo: solo !== null && D.soloDeathsVerifiable(m, me) ? solo.length : null,
        farm: fe.fightChecks && !fe.incompleteFights ? fe.missed.length : null,
        late,
        laneGap: Number.isFinite(f.nw10) && Number.isFinite(f.laneFoeNw10) ? f.nw10 - f.laneFoeNw10 : null,
        lostPD: f.lostPerDeath,
        d10: f.d10,
      };
      for (const key of [`${me.hero_id}|${band}`, `${me.hero_id}|any`, `all|${band}`, 'all|any']) {
        const c = get(key); c.n++;
        for (const k of Object.keys(rec)) c[k].push(rec[k]);
      }
    }
    if (nm % 1000 === 0) console.log(nm);
  }
  const out = { v: 1, generated: new Date().toISOString().slice(0, 10), source: 'рейтинговые матчи 11–13.11.2026 (deadlock-api), от 25 минут, ранг игрока из SQL; считается tools/errors-pilot/norms.js', bands: ['ранги 1–5', 'ранги 6–7', 'ранги 8+'], minN: MIN_N, cells: {} };
  for (const [k, c] of cells) {
    if (c.n < MIN_N && !k.startsWith('all')) continue;
    out.cells[k] = { n: c.n, solo: summarize(c.solo), farm: summarize(c.farm), late: summarize(c.late), laneGap: summarize(c.laneGap), lostPD: summarize(c.lostPD), d10: summarize(c.d10) };
  }
  const target = path.join(SRC, 'data', 'errorNorms.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(out));
  console.log('cells', Object.keys(out.cells).length, '->', target, (fs.statSync(target).size / 1024).toFixed(0) + ' KB');
})();
