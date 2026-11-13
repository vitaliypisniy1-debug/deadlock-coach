'use strict';
// Загрузка N недавних рейтинговых матчей с маршрутами (deadlock-api). Пишет только в папку данных, профиль приложения не трогает.
// Папка данных: первый аргумент или DC_PILOT_DIR (по умолчанию tools/errors-pilot/pilot-data). См. README.md.
const path = require('path');
const DATA = path.resolve(process.argv[2] || process.env.DC_PILOT_DIR || path.join(__dirname, 'pilot-data'));
const P = (f) => path.join(DATA, f);
const SRC = path.join(__dirname, '..', '..', 'src');
// Проба загрузки: N недавних рейтинговых матчей с маршрутами. Пишет только в папку данных.
// Профиль приложения не трогает.
const fs = require('fs');
const { Api } = require(path.join(SRC, 'main', 'api'));
const { extractMatch } = require(path.join(SRC, 'core', 'extract'));
const N = Number(process.env.N || 500);
const OUT = DATA;
fs.mkdirSync(OUT, { recursive: true });
const log = (s) => { const line = `${new Date().toISOString().slice(11, 19)} ${s}`; console.log(line); fs.appendFileSync(path.join(OUT, 'probe.log'), line + '\n'); };

(async () => {
  const api = new Api({ concurrency: 2, minGapMs: 300 });
  // 1) список матчей одним SQL-запросом (лимит SQL — 2 запроса в минуту)
  let ids = [];
  const idFile = path.join(OUT, 'ids.json');
  if (fs.existsSync(idFile)) ids = JSON.parse(fs.readFileSync(idFile, 'utf8'));
  if (ids.length < N) {
    const sql = `SELECT DISTINCT match_id FROM match_player WHERE start_time > now() - INTERVAL 2 DAY AND match_mode = 'Ranked' AND duration_s >= 1500 ORDER BY hash(match_id) LIMIT ${N + 100}`;
    const rows = await api.sql(sql);
    ids = (Array.isArray(rows) ? rows : []).map((r) => Number(r.match_id ?? r[0])).filter(Boolean);
    fs.writeFileSync(idFile, JSON.stringify(ids));
  }
  log(`ids: ${ids.length}`);
  // 2) метаданные с маршрутами
  const outFile = path.join(OUT, 'matches.jsonl');
  const done = new Set();
  if (fs.existsSync(outFile)) for (const l of fs.readFileSync(outFile, 'utf8').split('\n')) if (l) done.add(JSON.parse(l).match_id);
  let ok = 0, fail = 0, noPaths = 0, bytes = 0, rawBytes = 0;
  const t0 = Date.now();
  const stats = { codes: {} };
  const todo = ids.filter((id) => !done.has(id)).slice(0, N);
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const id = todo[i++];
      const t = Date.now();
      try {
        const raw = await api.matchMetadataOnce(id);
        const m = extractMatch(raw, { paths: true });
        rawBytes += JSON.stringify(raw).length;
        if (!m.paths) noPaths++;
        const line = JSON.stringify(m);
        bytes += line.length;
        fs.appendFileSync(outFile, line + '\n');
        ok++;
      } catch (e) {
        fail++;
        const c = e.code || 'err';
        stats.codes[c] = (stats.codes[c] || 0) + 1;
        if (e.code === 429) await new Promise((r) => setTimeout(r, (e.retryAfter || 5) * 1000));
      }
      if ((ok + fail) % 25 === 0) log(`${ok + fail}/${todo.length} ok ${ok} fail ${fail} nopaths ${noPaths} avg ${((Date.now() - t0) / (ok + fail) / 1000).toFixed(2)} s/req, compact ${(bytes / Math.max(1, ok) / 1024).toFixed(1)} KB, raw ${(rawBytes / Math.max(1, ok) / 1024).toFixed(0)} KB, codes ${JSON.stringify(stats.codes)}`);
      if (fail >= 40 && fail > ok) { log('слишком много ошибок, останавливаюсь'); return; }
    }
  };
  await Promise.all([worker(), worker()]);
  log(`ГОТОВО: ok ${ok} fail ${fail} nopaths ${noPaths}, ${((Date.now() - t0) / 1000).toFixed(0)} с, ${(bytes / Math.max(1, ok) / 1024).toFixed(1)} КБ на матч (сжато), ${(rawBytes / Math.max(1, ok) / 1024).toFixed(0)} КБ сырых; коды ${JSON.stringify(stats.codes)}`);
})().catch((e) => { log('FATAL ' + (e.stack || e)); process.exit(1); });
