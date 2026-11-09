'use strict';
// Поиск опубликованного в игре билда, который ближе всего к билду топов.
// Сторонняя программа не может записать билд в игру напрямую: билды хранятся
// на серверах Valve. Поэтому ищем похожий публичный билд — его можно найти
// в игре по названию (B → Browse Builds → Public) и добавить в избранное.

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

// Ответ /v1/builds приходит как список; каждый элемент либо {hero_build: {...}, num_favorites},
// либо сам билд. Разбираем оба варианта.
function normalizeBuild(entry) {
  const hb = entry && (entry.hero_build || entry);
  if (!hb) return null;
  const details = hb.details || {};
  const itemIds = [];
  const categories = [];
  for (const cat of asArray(details.mod_categories)) {
    const ids = asArray(cat.mods).map((m) => Number(m.ability_id ?? m.item_id ?? m.id)).filter(Boolean);
    categories.push({ name: cat.name || '', ids });
    itemIds.push(...ids);
  }
  return {
    id: hb.hero_build_id ?? hb.build_id ?? null,
    hero_id: hb.hero_id ?? null,
    name: hb.name || '(без названия)',
    author: hb.author_account_id ?? null,
    language: hb.language ?? null,
    version: hb.version ?? null,
    updated: hb.last_updated_timestamp ?? hb.publish_timestamp ?? null,
    favorites: entry.num_favorites ?? entry.num_weekly_favorites ?? 0,
    weeklyFavorites: entry.num_weekly_favorites ?? null,
    itemIds: [...new Set(itemIds)],
    categories,
  };
}

// Похожесть: какая доля ключевых предметов топов есть в билде (взвешено по частоте),
// со штрафом за лишние предметы, чтобы огромные "всё подряд" билды не выигрывали.
function similarity(coreItems, buildIds) {
  if (!coreItems.length || !buildIds.length) return 0;
  const set = new Set(buildIds);
  let hit = 0;
  let total = 0;
  for (const it of coreItems) {
    total += it.pick;
    if (set.has(it.id)) hit += it.pick;
  }
  const coverage = total ? hit / total : 0;
  const coreSet = new Set(coreItems.map((i) => i.id));
  const extra = buildIds.filter((id) => !coreSet.has(id)).length;
  const bloat = Math.max(0, extra - 8) / 30; // до ~8 запасных предметов не штрафуем
  return Math.max(0, coverage - bloat);
}

function rankBuilds(rawList, coreItems, { limit = 5 } = {}) {
  const builds = asArray(rawList).map(normalizeBuild).filter((b) => b && b.itemIds.length);
  for (const b of builds) b.score = similarity(coreItems, b.itemIds);
  builds.sort((a, b) => b.score - a.score || (b.favorites || 0) - (a.favorites || 0));
  return builds.slice(0, limit);
}

module.exports = { normalizeBuild, similarity, rankBuilds };
