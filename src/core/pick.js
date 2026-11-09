'use strict';
// Совет по пику в паузе перед игрой: из твоих героев выбираем лучших против
// стартового состава соперников.
//
// Для каждого твоего героя заранее посчитана таблица «соперник → насколько
// чаще обычного побеждают» (heroOutlook: твои игры ×2 + игры топового уровня,
// малые выборки стянуты к нулю). Итоговая оценка героя:
//   сумма матчапов против соперников (каждый ограничен ±15%, чтобы один
//   выброс не решал всё)
// + насколько ты сам сильнее обычного на этом герое (стянуто к нулю)
// + немного меты: винрейт героя у топов (стянут к 50%).

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

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
      return { hero_id: e, d: r ? clamp(r.delta, -0.15, 0.15) : 0, known: !!r, evidence: r ? r.evidence : 0 };
    });
    const vsScore = parts.reduce((s, x) => s + x.d, 0);
    const comfort = p.games ? (p.wins - p.games * myBase) / (p.games + 10) : -0.03;
    const m = meta[hid];
    const metaAdj = m && m.games ? ((m.winrate - 0.5) * m.games) / (m.games + 30) : 0;
    const score = vsScore + comfort + 0.5 * metaAdj;
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

module.exports = { heroPool, pickAdvice };
