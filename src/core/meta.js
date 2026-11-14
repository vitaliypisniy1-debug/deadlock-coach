'use strict';
// Режим 1: статистика топ-игроков — пики, винрейты, частые билды.

const { median, wilson } = require('./stats');
const { sampleStatus } = require('./metashift');

// Режимы матча в игре (ECitadelMatchMode): 1 обычный, 4 рейтинговый,
// 2 приватное лобби, 3 боты, 5 тест, 6 обучение, 7 лаборатория героев.
const EXCLUDED_MATCH_MODES = new Set([2, 3, 5, 6, 7]);
const RANKED_MATCH_MODES = new Set([4]);

function isStandardMatch(m, { onlyRanked = false } = {}) {
  if (m.game_mode !== null && m.game_mode !== undefined && m.game_mode !== 1) return false;
  const mm = m.match_mode;
  if (mm !== null && mm !== undefined && EXCLUDED_MATCH_MODES.has(mm)) return false;
  if (onlyRanked && !RANKED_MATCH_MODES.has(mm)) return false;
  return true;
}

// Справочник заполняется до передачи в расчёты и заменяется при обновлении.
const hasCatalogItems = new WeakMap();

function isUpgrade(assets, id) {
  const items = assets && assets.items;
  if (!items) return true;
  let hasItems = hasCatalogItems.get(items);
  if (hasItems === undefined) {
    hasItems = Object.keys(items).length > 0;
    hasCatalogItems.set(items, hasItems);
  }
  if (!hasItems) return true; // справочник не загружен — не выкидываем
  const it = items[id];
  if (!it) return false; // нет в списке предметов магазина — это способность или служебная запись
  return !it.type || it.type === 'upgrade';
}

// Список "записей": один топ-игрок в одном матче.
function collectRecords({ matches, topAccounts, sinceTs = 0, onlyRanked = false }) {
  const accounts = topAccounts instanceof Set ? topAccounts : new Set(topAccounts);
  const out = [];
  for (const m of matches) {
    if (!m || m.start_time < sinceTs) continue;
    if (!isStandardMatch(m, { onlyRanked })) continue;
    for (const p of m.players) {
      if (!accounts.has(p.account_id) || !p.hero_id) continue;
      out.push({
        match_id: m.match_id,
        start_time: m.start_time,
        duration_s: m.duration_s,
        account_id: p.account_id,
        hero_id: p.hero_id,
        won: p.won,
        k: p.k,
        d: p.d,
        a: p.a,
        nw: p.nw,
        items: p.items,
      });
    }
  }
  return out;
}

function heroTable(records) {
  const by = new Map();
  for (const r of records) {
    if (!by.has(r.hero_id)) by.set(r.hero_id, []);
    by.get(r.hero_id).push(r);
  }
  const total = records.length || 1;
  const rows = [];
  for (const [hero_id, list] of by) {
    const wins = list.filter((r) => r.won).length;
    const ci = wilson(wins, list.length);
    const players = new Set(list.map((r) => r.account_id));
    const kda = list.reduce((s, r) => s + (r.k + r.a) / Math.max(1, r.d), 0) / list.length;
    rows.push({
      hero_id,
      games: list.length,
      wins,
      winrate: wins / list.length,
      ci_lo: ci.lo,
      ci_hi: ci.hi,
      pick_share: list.length / total,
      players: players.size,
      kda,
      // единый порог выборки с мета-таблицей по API: меньше 300 игр — «мало данных»
      status: sampleStatus(list.length),
      lowSample: sampleStatus(list.length) === 'low',
    });
  }
  rows.sort((a, b) => b.games - a.games);
  return rows;
}

// Время первой покупки каждого предмета в записи.
function firstPurchases(record, assets) {
  const first = new Map();
  for (const [id, t] of record.items) {
    if (!isUpgrade(assets, id)) continue;
    if (!first.has(id) || t < first.get(id)) first.set(id, t);
  }
  return first;
}

// Что стало с каждым купленным предметом: остался, продан или улучшен.
// В данных у «пропавшего» предмета есть время, но оно бывает и при улучшении:
// компонент исчезает в ту же секунду, когда покупается улучшенный предмет.
function itemFates(items, assets) {
  const info = (id) => (assets && assets.items && assets.items[id]) || null;
  const list = (items || []).filter(([id]) => isUpgrade(assets, id));
  const haveComponents = !!(assets && assets.items && Object.values(assets.items).some((x) => Array.isArray(x.components) && x.components.length));
  return list.map(([id, t, sold, upgradeId]) => {
    if (!sold) return { id, t, fate: 'kept', soldT: null, into: null };
    if (upgradeId && upgradeId !== id) return { id, t, fate: 'upgraded', soldT: sold, into: upgradeId };
    const me = info(id);
    const near = list.filter(([x, bt]) => x !== id && Math.abs(bt - sold) <= 3);
    const viaComponents = near.find(([x]) => {
      const it = info(x);
      return it && Array.isArray(it.components) && it.components.includes(id);
    });
    if (viaComponents) return { id, t, fate: 'upgraded', soldT: sold, into: viaComponents[0] };
    // справочник без компонентов: дороже, тот же слот и в ту же секунду — почти наверняка улучшение
    const likely = !haveComponents && near.find(([x]) => {
      const it = info(x);
      return it && me && it.slot && it.slot === me.slot && (it.cost || 0) > (me.cost || 0);
    });
    if (likely) return { id, t, fate: 'upgraded', soldT: sold, into: likely[0] };
    return { id, t, fate: 'sold', soldT: sold, into: null };
  });
}

function phaseOf(t) {
  if (t < 600) return 'early';
  if (t < 1200) return 'mid';
  return 'late';
}

// Частый билд на героя: какие предметы берут, когда и что с ними по винрейту.
function heroBuild(records, assets, { coreThreshold = 0.35, situationalThreshold = 0.12 } = {}) {
  const n = records.length;
  if (!n) return { n: 0, items: [], core: [], situational: [], phases: { early: [], mid: [], late: [] }, openers: [] };
  const per = new Map();
  const totalWins = records.filter((r) => r.won).length;
  const openerCounts = new Map();
  for (const r of records) {
    const first = firstPurchases(r, assets);
    for (const [id, t] of first) {
      if (!per.has(id)) per.set(id, { id, times: [], buyers: 0, wins: 0 });
      const e = per.get(id);
      e.times.push(t);
      e.buyers += 1;
      if (r.won) e.wins += 1;
    }
    const opener = [...first.entries()].sort((a, b) => a[1] - b[1]).slice(0, 4).map((x) => x[0]);
    if (opener.length === 4) {
      const key = opener.join(',');
      openerCounts.set(key, (openerCounts.get(key) || 0) + 1);
    }
  }
  const items = [...per.values()].map((e) => {
    const nonBuyers = n - e.buyers;
    const winsWithout = totalWins - e.wins;
    return {
      id: e.id,
      pick: e.buyers / n,
      buyers: e.buyers,
      medianT: median(e.times),
      winWith: e.buyers ? e.wins / e.buyers : null,
      winWithout: nonBuyers ? winsWithout / nonBuyers : null,
    };
  });
  items.sort((a, b) => a.medianT - b.medianT);
  const core = items.filter((i) => i.pick >= coreThreshold);
  const situational = items
    .filter((i) => i.pick >= situationalThreshold && i.pick < coreThreshold)
    .sort((a, b) => b.pick - a.pick);
  const phases = { early: [], mid: [], late: [] };
  for (const it of core) phases[phaseOf(it.medianT)].push(it);
  const openers = [...openerCounts.entries()]
    .map(([key, count]) => ({ items: key.split(',').map(Number), count, share: count / n }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  return { n, items, core, situational, phases, openers };
}

function playerTable(records, topList) {
  const by = new Map();
  for (const r of records) {
    if (!by.has(r.account_id)) by.set(r.account_id, []);
    by.get(r.account_id).push(r);
  }
  return topList.map((p) => {
    const list = by.get(p.accountId) || [];
    const heroes = new Map();
    for (const r of list) heroes.set(r.hero_id, (heroes.get(r.hero_id) || 0) + 1);
    return {
      rank: p.rank,
      name: p.name,
      accountId: p.accountId,
      games: list.length,
      wins: list.filter((r) => r.won).length,
      heroes: [...heroes.entries()].sort((a, b) => b[1] - a[1]).map(([hero_id, games]) => ({ hero_id, games })),
    };
  });
}

function buildMeta({ matches, topList, sinceTs, onlyRanked, assets }) {
  const topAccounts = new Set(topList.filter((p) => p.accountId).map((p) => p.accountId));
  const records = collectRecords({ matches, topAccounts, sinceTs, onlyRanked });
  const heroes = heroTable(records);
  const matchIds = new Set(records.map((r) => r.match_id));
  return {
    generatedAt: Math.floor(Date.now() / 1000),
    sinceTs,
    totalMatches: matchIds.size,
    totalRecords: records.length,
    heroes,
    players: playerTable(records, topList),
    // билд считаем по запросу (heroBuild), чтобы не держать всё в памяти UI
    _assetsLoaded: !!(assets && assets.items),
  };
}

module.exports = { isStandardMatch, collectRecords, heroTable, heroBuild, playerTable, buildMeta, isUpgrade, firstPurchases, itemFates };
