'use strict';
// Ранги игроков (player_rank_initial_display_rank) из публичного SQL API для скачанных матчей. Лимит SQL — 2 запроса в минуту.
// Папка данных: первый аргумент или DC_PILOT_DIR (по умолчанию tools/errors-pilot/pilot-data). См. README.md.
const path = require('path');
const DATA = path.resolve(process.argv[2] || process.env.DC_PILOT_DIR || path.join(__dirname, 'pilot-data'));
const P = (f) => path.join(DATA, f);
const SRC = path.join(__dirname, '..', '..', 'src');
const fs = require('fs');
const ids = new Set(JSON.parse(fs.readFileSync(P('ids.json'), 'utf8')));
const t0 = Date.UTC(2026, 10, 11, 14, 0) / 1000, t1 = Date.UTC(2026, 10, 13, 11, 30) / 1000;
const windows = 8; const step = Math.ceil((t1 - t0) / windows);
const out = fs.existsSync(P('ranks.json')) ? JSON.parse(fs.readFileSync(P('ranks.json'), 'utf8')) : {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  for (let w = 0; w < windows; w++) {
    const a = t0 + w * step, b = a + step;
    const q = `SELECT match_id, account_id, player_rank_initial_display_rank AS r FROM match_player WHERE start_time >= to_timestamp(${a}) AND start_time < to_timestamp(${b}) AND match_mode = 'Ranked' AND duration_s >= 1500 AND player_rank_initial_display_rank IS NOT NULL`;
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch('https://api.deadlock-api.com/v1/sql?query=' + encodeURIComponent(q));
      if (res.status === 429) { await wait(40000); continue; }
      const rows = await res.json();
      if (!Array.isArray(rows)) { console.log('window', w, 'bad', JSON.stringify(rows).slice(0, 200)); await wait(40000); continue; }
      let kept = 0;
      for (const r of rows) if (ids.has(Number(r.match_id))) { (out[r.match_id] = out[r.match_id] || {})[r.account_id] = r.r; kept++; }
      console.log('window', w, 'rows', rows.length, 'kept', kept);
      break;
    }
    fs.writeFileSync(P('ranks.json'), JSON.stringify(out));
    await wait(35000);
  }
  console.log('matches with ranks', Object.keys(out).length);
})();
