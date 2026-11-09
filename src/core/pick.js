'use strict';
// Совет по пику в паузе перед игрой: из твоих героев выбираем лучших против
// стартового состава соперников.
//
// Вес данных: 80% — игры топового уровня (мета), 20% — твои собственные игры.
//
// Для каждого твоего героя заранее посчитана таблица «соперник → насколько
// чаще обычного побеждают» отдельно по играм топового уровня и по твоим играм
// (малые выборки стянуты к нулю). Итоговая оценка героя:
//   сумма матчапов против соперников, каждый = 80% топы + 20% твои
//   (нет твоих игр против этого героя — только топы; каждый ограничен ±15%)
// + герой сам по себе: 80% — винрейт у топов, 20% — насколько ты на нём
//   сильнее своего обычного.

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

const MY_SHARE = 0.2; // доля твоих игр в совете
const META_SHARE = 1 - MY_SHARE;

// Матчап против одного соперника: 80% топы + 20% твои.
function mixMatchup(r) {
  if (!r) return null;
  const hasPro = typeof r.pro === 'number';
  const hasMine = typeof r.mine === 'number';
  if (hasPro && hasMine) return META_SHARE * r.pro + MY_SHARE * r.mine;
  if (hasPro) return r.pro;
  if (hasMine) return MY_SHARE * r.mine; // игр топов нет — твоим играм всё равно не больше 20%
  return typeof r.delta === 'number' ? r.delta : null; // старые таблицы
}

// Твои герои для рейтинга. Правило игры: в рейтинге можно играть героями,
// на которых выиграно 15 обычных игр. Историю по режимам не различаем, поэтому
// берём все победы; список можно поправить вручную.
function heroPool(historyRows, { minWins = 15, manual = null } = {}) {
  const by = new Map();
  for (const r of historyRows || []) {
    const id = Number(r.hero_id);
    if (!id) continue;
    if (!by.has(id)) by.set(id, { hero_id: id, games: 0, wins: 0, last: 0 });
    const x = by.get(id);
    x.games += 1;
    const won = typeof r.won === 'boolean' ? r.won : typeof r.match_result === 'number' ? r.match_result === r.player_team : false;
    if (won) x.wins += 1;
    x.last = Math.max(x.last, r.start_time || 0);
  }
  const all = [...by.values()].sort((a, b) => b.games - a.games);
  let pool;
  if (Array.isArray(manual) && manual.length) {
    pool = manual.map((id) => by.get(Number(id)) || { hero_id: Number(id), games: 0, wins: 0, last: 0 });
  } else {
    pool = all.filter((x) => x.wins >= minWins);
    if (!pool.length) pool = all.filter((x) => x.games >= 5).slice(0, 8);
  }
  return { pool, all, manual: Array.isArray(manual) && manual.length > 0 };
}

// tables: { [heroId]: { vs: { [enemyId]: { delta, evidence } } } }
// meta: { [heroId]: { winrate, games } }
function pickAdvice({ pool, tables, enemies = [], allies = [], current = null, meta = {}, take = 5 }) {
  const taken = new Set([...enemies, ...allies].map(Number));
  const totalGames = pool.reduce((s, p) => s + p.games, 0);
  const myBase = totalGames ? pool.reduce((s, p) => s + p.wins, 0) / totalGames : 0.5;
  const rows = [];
  for (const p of pool) {
    const hid = p.hero_id;
    const t = tables && tables[hid];
    const parts = enemies.map((e) => {
      const r = t && t.vs ? t.vs[e] : null;
      const d = mixMatchup(r);
      return { hero_id: e, d: d === null ? 0 : clamp(d, -0.15, 0.15), known: d !== null, evidence: r ? r.evidence : 0 };
    });
    const vsScore = parts.reduce((s, x) => s + x.d, 0);
    const comfort = p.games ? (p.wins - p.games * myBase) / (p.games + 10) : -0.03;
    const m = meta[hid];
    const metaAdj = m && m.games ? ((m.winrate - 0.5) * m.games) / (m.games + 30) : 0;
    const score = vsScore + META_SHARE * metaAdj + MY_SHARE * comfort;
    const sorted = parts.filter((x) => x.known && Math.abs(x.d) >= 0.01).sort((a, b) => b.d - a.d);
    rows.push({
      hero_id: hid,
      score,
      vsScore,
      comfort,
      metaAdj,
      games: p.games,
      wins: p.wins,
      taken: taken.has(hid),
      known: parts.filter((x) => x.known).length,
      pros: sorted.filter((x) => x.d > 0).slice(0, 2),
      cons: sorted.filter((x) => x.d < 0).reverse().slice(0, 2),
      noTable: !t,
    });
  }
  rows.sort((a, b) => b.score - a.score);
  const free = rows.filter((r) => !r.taken);
  const best = free[0] || null;
  let verdict = null;
  const cur = current ? rows.find((r) => r.hero_id === Number(current)) : null;
  if (best && cur) {
    const gap = best.score - cur.score;
    if (best.hero_id === cur.hero_id || gap < 0.03) verdict = { keep: true, hero_id: cur.hero_id, gap: Math.max(0, gap) };
    else verdict = { keep: false, hero_id: best.hero_id, from: cur.hero_id, gap };
  }
  return { rows: free.slice(0, take), all: rows, verdict, enemies: enemies.length, myBase };
}

module.exports = { heroPool, pickAdvice, mixMatchup, MY_SHARE };
