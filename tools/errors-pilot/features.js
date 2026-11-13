'use strict';
// Для каждого игрока каждого матча: какие правила «Ошибок» сработали и контекст (rows.jsonl).
// Папка данных: первый аргумент или DC_PILOT_DIR (по умолчанию tools/errors-pilot/pilot-data). См. README.md.
const path = require('path');
const DATA = path.resolve(process.argv[2] || process.env.DC_PILOT_DIR || path.join(__dirname, 'pilot-data'));
const P = (f) => path.join(DATA, f);
const SRC = path.join(__dirname, '..', '..', 'src');
// По каждому игроку каждого матча: какие правила «Ошибок» сработали + контекст. Только чтение матчей пробы.
const fs = require('fs');
const readline = require('readline');
const { playerFeatures } = require(path.join(SRC, 'core', 'features'));
const L = require(path.join(SRC, 'core', 'leaks'));
const D = require(path.join(SRC, 'core', 'deaths'));
const assets = JSON.parse(fs.readFileSync((process.env.DC_ASSETS || P('assets.json')), 'utf8'));
const ranks = JSON.parse(fs.readFileSync(P('ranks.json'), 'utf8'));
(async () => {
  const rl = readline.createInterface({ input: fs.createReadStream(P('matches.jsonl')), crlfDelay: Infinity });
  const out = fs.createWriteStream(P('rows.jsonl'));
  let n = 0, rows = 0;
  for await (const line of rl) {
    if (!line) continue;
    const m = JSON.parse(line);
    n++;
    const rk = ranks[m.match_id] || {};
    for (const me of m.players) {
      if (me.abandoned || !me.stats || me.stats.length < 3) continue;
      const rank = rk[me.account_id];
      const tier = Number.isFinite(rank) ? Math.floor(rank / 10) : null;
      let f;
      try { f = playerFeatures(me, m, assets); } catch { continue; }
      const checked = new Set();
      let leaks = [];
      try { leaks = L.gameLeaks({ m, me, f, ref: null, tier, assets, counters: null, laneVs: null, checked }); } catch { continue; }
      const solo = D.soloDeathRows(m, me);
      const late = (me.deaths || []).filter((d) => d[0] >= 600).length;
      const keys = leaks.filter((l) => l.level !== 'good').map((l) => l.key);
      const team = m.players.filter((p) => p.team === me.team);
      const teamNw20 = team.reduce((s, p) => s + ((p.stats.find((x) => x.t >= 1200) || {}).nw || 0), 0);
      const foeNw20 = m.players.filter((p) => p.team !== me.team).reduce((s, p) => s + ((p.stats.find((x) => x.t >= 1200) || {}).nw || 0), 0);
      const row = { mid: m.match_id, hero: me.hero_id, rank, tier, won: me.won ? 1 : 0, d: me.d, k: me.k, a: me.a, dur: Math.round(m.duration_s), late, solo: solo === null ? null : solo.length,
        lane: me.lane, nwDiff20: Math.round(teamNw20 - foeNw20), nw10: f.nw10 === null ? null : Math.round(f.nw10), kp: f.kp, dmgShare: f.dmgShare,
        keys, checked: [...checked], lostPD: f.lostPerDeath === null ? null : Math.round(f.lostPerDeath), slots20: f.slots20 };
      out.write(JSON.stringify(row) + '\n'); rows++;
    }
    if (n % 500 === 0) console.log(n, 'matches', rows, 'rows');
  }
  out.end();
  console.log('DONE', n, rows);
})();
