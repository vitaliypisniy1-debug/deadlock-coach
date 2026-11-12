'use strict';
// Справочник контрпиков и контрпредметов: «выбрал врага — кого взять и что купить».
//
// Переиспользует существующие данные, ничего не считает второй раз:
//  - контрпики: pm из buildPickMeta (готовая статистика deadlock-api, кэш 6 часов);
//    контрпик = дельта результата героя в матчапе против его обычного результата
//    в той же выборке (pairDelta из pick.js со стягиванием при малых выборках),
//    отдельно весь матч (pm.vs) и линия (pm.lane + души к 9-й минуте);
//  - контрпредметы: counterTable() из leaks.js — предметы, которые топы берут
//    против героя заметно чаще обычного (lift покупок в реальных матчах);
//  - механики: counterRules — проверенные взаимодействия из файлов игры.
//
// Честность: частота покупки или винрейт сами по себе ничего не доказывают —
// у каждой рекомендации указан источник (механика / статистика / покупки),
// при малой выборке строчка помечается, «лучшим» вариант не называется.

const { pairDelta, baseWr, laneSouls } = require('./pick');
const { RULES, threatLabel } = require('./counterRules');

// Пара с меньшим числом игр не показываем вовсе: стянутая дельта всё равно
// почти ноль, а «мало матчей» в каждой строке только шумит.
const MIN_PAIR_GAMES = 100;

// Контрпики против выбранного врага. pool — твои герои (hero_id[]), для тумблера.
function counterPicks(enemyId, { pm = null, pool = [] } = {}) {
  const X = Number(enemyId);
  const myPool = new Set((pool || []).map(Number));
  const rows = [];
  if (!pm || !pm.vs) return { rows, covered: false };
  for (const H of Object.keys(pm.base || {})) {
    const h = Number(H);
    if (h === X) continue;
    const m = pairDelta(pm, 'vs', h, X, -1);
    if (!m || m.n < MIN_PAIR_GAMES) continue;
    const base = baseWr(pm, h);
    const pair = pm.vs[h] && pm.vs[h][X];
    const wrVs = pair ? pair[0] / pair[1] : null;
    const lanePair = pm.lane && pm.lane[h] ? pm.lane[h][X] : null;
    const lane = pairDelta(pm, 'lane', h, X, -1);
    const souls = laneSouls(pm, h, X);
    const small = m.n < 300; // стянутая дельта надёжна, но выборка скромная
    rows.push({
      hero_id: h,
      d: m.d,                 // стянутая дельта (для сортировки и вердикта)
      pp: base !== null && wrVs !== null ? wrVs - base : null, // фактическая разница, п.п.
      wrVs,
      base,
      n: m.n,
      laneD: lane ? lane.d : null,
      laneN: lanePair ? lanePair[1] : 0,
      laneWr: lanePair ? lanePair[0] / lanePair[1] : null,
      soulsD: souls ? souls.d : null,
      soulsN: souls ? souls.n : null,
      inPool: myPool.has(h),
      small,
    });
  }
  rows.sort((a, b) => b.d - a.d);
  // показываем только фактическое преимущество: разница с обычным винрейтом
  // должна быть в плюс, иначе это не контрпик, а шум
  const only = rows.filter((r) => r.pp === null || r.pp > 0.0005);
  return { rows: only, covered: only.length > 0, pairsSeen: rows.length };
}

// Контрпредметы против выбранного врага.
// table — counterTable(): { hero: [{ id, lift, rateVs }] } из покупок топов.
// assets — каталог предметов (имя, цена, тир, слот).
function counterItemsFor(enemyId, { table = {}, assets = null } = {}) {
  const X = Number(enemyId);
  const item = (id) => (assets && assets.items && assets.items[id]) || null;
  const purchases = (table[X] || []).map((r) => {
    const a = item(r.id);
    const rule = a ? RULES.items[a.name] || null : null;
    return {
      id: r.id,
      lift: r.lift,
      rateVs: r.rateVs,
      name: a ? a.name : `Предмет ${r.id}`,
      cost: a ? a.cost : null,
      tier: a ? a.tier : null,
      slot: a ? a.slot : null,
      rule: rule ? { ...rule, threatLabel: threatLabel(rule.threat) } : null,
      source: 'purchases',
    };
  });
  // механические ответы из правил: показываем и те, что нет в покупках —
  // у них другой источник (файлы игры), смешивать нельзя.
  const known = new Set(purchases.map((p) => p.name));
  const hero = RULES.heroes[X];
  const mechanics = hero
    ? (hero.answers || [])
        .filter((a) => RULES.items[a.item] && !known.has(a.item))
        .map((a) => {
          const r = RULES.items[a.item];
          return {
            id: null,
            name: a.item,
            cost: null,
            tier: r.tier,
            slot: r.slot,
            lift: null,
            rateVs: null,
            rule: { ...r, threatLabel: threatLabel(r.threat) },
            why: a.why,
            confidence: a.confidence,
            source: 'mechanics',
          };
        })
    : [];
  return { purchases, mechanics, threats: hero ? hero.threats : null, heals: hero ? hero.heals : null };
}

// Полный ответ справочника по одному врагу. Результат всегда помечен enemy —
// при смене героя во время запроса интерфейс сверяет метку и не подменяет данные.
function counterCodex(enemyId, { pm = null, table = {}, assets = null, pool = [], stale = false } = {}) {
  const X = Number(enemyId);
  const picks = counterPicks(X, { pm, pool });
  const items = counterItemsFor(X, { table, assets });
  const age = pm && pm.at ? Math.round((Date.now() - pm.at) / 60000) : null;
  return {
    enemy: X,
    meta: {
      badge: pm ? pm.badge : null,
      since: pm ? pm.since : null,
      at: pm ? pm.at : null,
      ageMin: age,
      games: pm ? pm.games : null,
      stale,
      covered: picks.covered,
    },
    picks,
    items,
    rules: { patch: RULES.patch, build: RULES.build, source: RULES.source },
    heroRule: RULES.heroes[X] ? { name: RULES.heroes[X].name, threats: RULES.heroes[X].threats, heals: RULES.heroes[X].heals } : null,
  };
}

module.exports = { counterPicks, counterItemsFor, counterCodex, MIN_PAIR_GAMES };
