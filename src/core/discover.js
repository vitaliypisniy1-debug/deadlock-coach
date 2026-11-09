'use strict';
// Запасной способ найти топов, когда ладдер пуст (например, первые дни нового сезона:
// Valve обнуляет публичную таблицу лидеров). Берём свежие матчи с самым высоким
// средним рангом и собираем из них игроков. Разбор сделан "мягким": поля ответа
// API могут называться по-разному, поэтому пробуем несколько вариантов.

// Регион матча в игре (ECitadelRegionMode): 0 остальной мир, 1 Европа, 2 Юго-Вост. Азия,
// 3 Юж. Америка, 4 Россия, 5 Океания.
const REGION_MODES = { Europe: [1, 4], Asia: [2], SAmerica: [3], Oceania: [5], NAmerica: [0] };

function asList(r) {
  if (Array.isArray(r)) return r;
  if (r && typeof r === 'object') return r.matches || r.entries || r.data || [];
  return [];
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function matchBadge(m, team) {
  const t0 = num(m.average_badge_team0);
  const t1 = num(m.average_badge_team1);
  if (team === 0 && t0) return t0;
  if (team === 1 && t1) return t1;
  if (t0 && t1) return (t0 + t1) / 2;
  return num(m.average_badge) || t0 || t1 || null;
}

// Игроки из списка матчей: [{account_id, badge, regionMode}]
function playersFromMatches(list) {
  const out = [];
  for (const m of asList(list)) {
    if (!m || !Array.isArray(m.players)) continue;
    const regionMode = num(m.region_mode ?? m.regionMode);
    for (const p of m.players) {
      const id = num(p.account_id ?? p.accountId);
      if (!id) continue;
      const team = num(p.team);
      out.push({ account_id: id, badge: matchBadge(m, team), regionMode });
    }
  }
  return out;
}

// Сводим найденных игроков: лучший ранг матча, сколько раз встречался.
function mergeCandidates(rows, region) {
  const allowed = REGION_MODES[region];
  let pool = rows;
  let regionFiltered = false;
  if (allowed) {
    const inRegion = rows.filter((r) => r.regionMode !== null && allowed.includes(r.regionMode));
    if (inRegion.length >= 20) {
      pool = inRegion;
      regionFiltered = true;
    }
  }
  const by = new Map();
  for (const r of pool) {
    const e = by.get(r.account_id) || { account_id: r.account_id, matchBadge: 0, seen: 0 };
    e.seen += 1;
    if (r.badge && r.badge > e.matchBadge) e.matchBadge = r.badge;
    by.set(r.account_id, e);
  }
  const list = [...by.values()].sort((a, b) => b.matchBadge - a.matchBadge || b.seen - a.seen);
  return { list, regionFiltered };
}

// Ранг игрока из ответа /v1/players/rank (название поля может отличаться).
function rankOf(e) {
  if (!e || typeof e !== 'object') return null;
  return num(e.badge ?? e.rank ?? e.badge_level ?? e.ranked_badge_level ?? e.player_score);
}

module.exports = { playersFromMatches, mergeCandidates, rankOf, asList, REGION_MODES };
