'use strict';
// Профиль героя по тому, что на нём обычно собирают.
//
// Идея: чтобы понять, что собирать против героя, надо знать, что собирают на нём.
// Из покупок игроков (Deadlock API /v1/analytics/item-stats, игры normal, ранг и окно
// фиксированы вызывающим) считаем: какие предметы берут чаще 25% игр, доли покупок по
// слотам (предметы тиров II–IV) и признаки сборки: ближний бой, вампиризм.
// Доля покупок — это вложение героя, а не доля нанесённого урона; в выводе так и пишем.

const TOP_SHARE = 0.25;
const TOP_LIMIT = 10;
const SMALL_GAMES = 1000;

// Предметы ближнего боя и вампиризма (имена из текущего патча; нет такого предмета — пропускаем).
const MELEE_ITEMS = ['Melee Charge', 'Melee Lifesteal', 'Lifestrike', 'Crushing Fists'];
const LIFESTEAL_ITEMS = ['Melee Lifesteal', 'Lifestrike', 'Bullet Lifesteal', 'Spirit Lifesteal', 'Infuser', 'Vampiric Burst', 'Leech', 'Siphon Bullets'];

// rows — строки item-stats ({ item_id, matches, bucket? }); codex — данные codexData.json;
// games — число матчей героя за то же окно (для долей покупок).
function buildHeroProfile(rows, { codex, games = 0 } = {}) {
  if (!codex || !Array.isArray(rows) || !rows.length) return null;
  const byId = new Map(Object.values(codex.items || {}).map((i) => [i.id, i]));
  const mine = rows.filter((r) => r && (r.bucket === 0 || r.bucket === undefined));
  const total = games || Math.max(0, ...mine.map((r) => Number(r.matches) || 0));
  if (!total) return null;
  const share = new Map();
  const slot = { weapon: 0, spirit: 0, vitality: 0 };
  let all = 0;
  for (const r of mine) {
    const it = byId.get(r.item_id);
    if (!it) continue;
    const m = Number(r.matches) || 0;
    share.set(it.name, m / total);
    if (it.tier >= 2 && it.tier <= 4 && slot[it.slot] !== undefined) {
      slot[it.slot] += m;
      all += m;
    }
  }
  const top = [...share.entries()]
    .filter(([, s]) => s >= TOP_SHARE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_LIMIT)
    .map(([name, s]) => {
      const it = codex.items[name];
      return { name, slot: it.slot, tier: it.tier, share: Math.round(s * 100) / 100 };
    });
  const slotShare = all ? Object.fromEntries(Object.entries(slot).map(([k, v]) => [k, Math.round((100 * v) / all) / 100])) : null;
  const known = (names) => names.map((n) => share.get(n)).filter((v) => v !== undefined);
  const melee = known(MELEE_ITEMS);
  const meleeShare = melee.length ? melee.reduce((s, v) => s + v, 0) / MELEE_ITEMS.length : 0;
  const lifeShare = Math.max(0, ...known(LIFESTEAL_ITEMS));
  return {
    games: total,
    small: total < SMALL_GAMES,
    top,
    slotShare,
    melee: Math.round(meleeShare * 100) / 100,
    lifesteal: Math.round(lifeShare * 100) / 100,
  };
}

module.exports = { buildHeroProfile, TOP_SHARE, SMALL_GAMES, MELEE_ITEMS, LIFESTEAL_ITEMS };
