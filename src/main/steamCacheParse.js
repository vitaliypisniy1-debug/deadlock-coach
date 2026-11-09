'use strict';
// Поиск ссылок на реплеи/метаданные Deadlock в файлах кэша Steam.
// Так же работает официальная утилита deadlock-api-ingest: в кэше лежат
// адреса вида http://replay404.valve.net/1422450/<match_id>_<salt>.meta.bz2.

const RE = /replay(\d+)\.[a-z0-9.-]+\/1422450\/(\d+)_(\d+)\.(meta|dem)\.bz2/gi;

function parseReplayUrls(text) {
  const out = [];
  let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(text)) !== null) {
    out.push({ cluster_id: Number(m[1]), match_id: Number(m[2]), salt: Number(m[3]), kind: m[4] });
  }
  return out;
}

// Склеивает находки в записи для POST /v1/matches/salts.
function toSaltRecords(found) {
  const by = new Map();
  for (const f of found) {
    if (!by.has(f.match_id)) by.set(f.match_id, { match_id: f.match_id, cluster_id: f.cluster_id });
    const r = by.get(f.match_id);
    if (f.kind === 'meta') r.metadata_salt = f.salt;
    else r.replay_salt = f.salt;
  }
  return [...by.values()];
}

module.exports = { parseReplayUrls, toSaltRecords };
