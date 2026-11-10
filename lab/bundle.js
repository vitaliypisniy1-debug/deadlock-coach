(()=>{const M={};const req=(n)=>{n=n.replace(/^\.\//,"").replace(/\.js$/,"");if(!M[n])throw new Error("no "+n);if(!M[n].done){M[n].done=true;M[n].fn(M[n].mod,M[n].mod.exports);}return M[n].mod.exports;};M["stats"]={mod:{exports:{}},fn:function(module,exports){const require=req;'use strict';
// Небольшие статистические помощники. Без зависимостей.

function sortNum(arr) {
  return arr.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
}

// Квантиль по отсортированному массиву (линейная интерполяция).
function quantileSorted(sorted, q) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function quantile(arr, q) {
  return quantileSorted(sortNum(arr), q);
}

function median(arr) {
  return quantile(arr, 0.5);
}

function mean(arr) {
  const a = arr.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!a.length) return null;
  return a.reduce((s, v) => s + v, 0) / a.length;
}

// Интервал Уилсона для винрейта: честно показывает, насколько можно доверять проценту
// при малом числе игр (2 победы из 2 игр — это не "100%").
function wilson(wins, n, z = 1.96) {
  if (!n) return { lo: 0, hi: 1 };
  const p = wins / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { lo: Math.max(0, (centre - margin) / denom), hi: Math.min(1, (centre + margin) / denom) };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

module.exports = { sortNum, quantileSorted, quantile, median, mean, wilson, clamp };

}};M["timeline"]={mod:{exports:{}},fn:function(module,exports){const require=req;'use strict';
// Работа со снимками статистики: значение поля в любую секунду матча
// (линейная интерполяция между снимками), поминутные ряды.

// g_treasure — урна душ (команде), g_brk — коробки (есть в матчах, сохранённых с версии 0.11)
const SOURCE_FIELDS = ['g_lane', 'g_neutral', 'g_player', 'g_boss', 'g_brk', 'g_treasure'];

// Производные поля, которых нет в снимке напрямую.
const DERIVED = {
  ka: (s) => s.k + s.a,
  farm: (s) => s.lh + s.nk,
};

function fieldOf(s, field) {
  if (DERIVED[field]) return DERIVED[field](s);
  return s[field];
}

// Стартовое значение поля в 0:00. Для накопительных счётчиков — 0.
function startValue(stats, field) {
  if (field === 'lvl') return 1;
  if (field === 'nw') return stats.length ? Math.min(fieldOf(stats[0], 'nw'), 0) : 0;
  return 0;
}

// Значение поля в секунду t. После последнего снимка — null (не выдумываем данные).
function valueAt(stats, field, t) {
  if (!stats || !stats.length) return null;
  const last = stats[stats.length - 1];
  if (fieldOf(last, field) === undefined) return null; // поля нет в матче, сохранённом старой версией
  if (t > last.t + 5) return null;
  if (t >= last.t) return fieldOf(last, field);
  let prevT = 0;
  let prevV = startValue(stats, field);
  for (const s of stats) {
    const v = fieldOf(s, field);
    if (s.t >= t) {
      if (s.t === prevT) return v;
      const f = (t - prevT) / (s.t - prevT);
      return prevV + (v - prevV) * f;
    }
    prevT = s.t;
    prevV = v;
  }
  return fieldOf(last, field);
}

// Ряд по минутам: [значение в 0:00, 1:00, 2:00, ...] до maxMinute.
function minuteSeries(stats, field, maxMinute) {
  const out = [];
  for (let m = 0; m <= maxMinute; m++) out.push(valueAt(stats, field, m * 60));
  return out;
}

function lastMinute(stats) {
  if (!stats || !stats.length) return 0;
  return Math.floor(stats[stats.length - 1].t / 60);
}

// Темп поля на отрезке [t1, t2] в единицах в минуту.
function rate(stats, field, t1, t2) {
  const a = valueAt(stats, field, t1);
  const b = valueAt(stats, field, t2);
  if (a === null || b === null || t2 <= t1) return null;
  return ((b - a) * 60) / (t2 - t1);
}

function sourcesAt(stats, t) {
  const out = {};
  for (const f of SOURCE_FIELDS) out[f] = valueAt(stats, f, t);
  return out;
}

module.exports = { SOURCE_FIELDS, valueAt, minuteSeries, lastMinute, rate, sourcesAt, fieldOf };

}};M["tipkit"]={mod:{exports:{}},fn:function(module,exports){const require=req;'use strict';
// Общие помощники для библиотеки советов: форматирование и сборка совета.

const N = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('ru-RU'));
const D1 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : (Math.round(v * 10) / 10).toString().replace('.', ','));
const P = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${Math.round(v * 100)}%`);
const T = (sec) => {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const times = (n) => {
  if (!Number.isInteger(Math.round(n * 10) / 10)) return 'раза';
  const a = Math.abs(Math.round(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'раз';
  if (b >= 2 && b <= 4) return 'раза';
  return 'раз';
};
const plural = (n, one, few, many) => {
  const r = Math.round(n * 10) / 10;
  if (!Number.isInteger(r)) return few; // 1,5 раза, 2,3 смерти
  const a = Math.abs(Math.round(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
};
const ok = (...vals) => vals.every((v) => v !== null && v !== undefined && Number.isFinite(v));
const ratio = (a, b) => (ok(a, b) && b > 0 ? a / b : null);
const xTimes = (r) => (r >= 1.95 ? `в ${D1(r)} раза` : `на ${Math.round((r - 1) * 100)}%`);

// Совет: id — уникальный шаблон, family — тема (из одной темы показываем один совет).
function tip(id, family, area, level, score, title, text, advice, extra = {}) {
  return { id, family, area, level, score, title, text, tip: advice || null, ...extra };
}

// Выбор советов: по убыванию важности, одна тема — один совет, не больше maxPerArea на раздел.
function selectTips(list, { max = 12, maxPerArea = 2 } = {}) {
  const order = { bad: 0, warn: 1, info: 2, good: 3 };
  const sorted = list.filter(Boolean).sort((a, b) => b.score - a.score || order[a.level] - order[b.level]);
  const fam = new Set();
  const areas = new Map();
  const out = [];
  for (const t of sorted) {
    if (out.length >= max) break;
    if (fam.has(t.family)) continue;
    const n = areas.get(t.area) || 0;
    if (n >= maxPerArea) continue;
    fam.add(t.family);
    areas.set(t.area, n + 1);
    out.push(t);
  }
  return out;
}

module.exports = { N, D1, P, T, times, plural, ok, ratio, xTimes, tip, selectTips };

}};M["meta"]={mod:{exports:{}},fn:function(module,exports){const require=req;'use strict';
// Режим 1: статистика топ-игроков — пики, винрейты, частые билды.

const { median, wilson } = require('./stats');

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

function isUpgrade(assets, id) {
  const items = assets && assets.items;
  if (!items || !Object.keys(items).length) return true; // справочник не загружен — не выкидываем
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
      lowSample: list.length < 10,
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

}};M["extract"]={mod:{exports:{}},fn:function(module,exports){const require=req;'use strict';
// Превращает полный ответ /v1/matches/{id}/metadata в компактную запись.
// Полные метаданные весят сотни КБ; нам нужна только малая часть, поэтому
// храним выжимку (~10–20 КБ на матч) — так база на сотни матчей остаётся лёгкой.

// Версия выжимки: 2 — коробки, командный бонус, статуи, урон по врагам, режим боя в маршрутах.
const EXTRACT_V = 2;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// Короткие имена полей для снимков статистики (накопительные значения "на момент t").
function compactStat(s) {
  return {
    t: num(s.time_stamp_s),
    nw: num(s.net_worth),
    lvl: num(s.level),
    k: num(s.kills),
    d: num(s.deaths),
    a: num(s.assists),
    lh: num(s.creep_kills),
    nk: num(s.neutral_kills),
    dn: num(s.denies),
    pdmg: num(s.player_damage),
    pdmgT: num(s.player_damage_taken),
    bdmg: num(s.boss_damage),
    heal: num(s.player_healing),
    g_lane: num(s.gold_lane_creep) + num(s.gold_lane_creep_orbs),
    g_neutral: num(s.gold_neutral_creep) + num(s.gold_neutral_creep_orbs),
    g_player: num(s.gold_player) + num(s.gold_player_orbs),
    g_boss: num(s.gold_boss) + num(s.gold_boss_orb),
    g_treasure: num(s.gold_treasure),
    g_lost: num(s.gold_death_loss),
    // источники душ из списка gold_sources: 12 — коробки (ломаемые ящики), 8 — командный бонус
    g_brk: goldSource(s, 12),
    g_bonus: goldSource(s, 8),
    hit: num(s.shots_hit),
    miss: num(s.shots_missed),
    hhit: num(s.hero_bullets_hit),
    hcrit: num(s.hero_bullets_hit_crit),
  };
}

// Души из конкретного источника (EGoldSource): 1 герои, 2 крипы, 3 лес, 4 боссы,
// 5 сокровища, 6 помощь, 7 отбор, 8 командный бонус, 12 коробки.
function goldSource(s, id) {
  const list = Array.isArray(s.gold_sources) ? s.gold_sources : null;
  if (list) {
    const e = list.find((x) => x && x.source === id);
    return e ? num(e.gold) + num(e.gold_orbs) : 0;
  }
  // плоские поля (как в SQL-таблице deadlock-api); нет и их — данных нет (undefined, а не 0)
  if (id === 12 && typeof s.gold_source_breakable_gold === 'number') return s.gold_source_breakable_gold;
  if (id === 8 && typeof s.gold_source_team_bonus_gold === 'number') return s.gold_source_team_bonus_gold;
  return undefined;
}

// Постоянные бафы со статуй: [время, тип] по возрастанию времени.
function powerUps(p) {
  if (!Array.isArray(p.power_up_buffs)) return null; // нет данных — не «ноль статуй»
  const out = [];
  for (const b of p.power_up_buffs || []) {
    if (!b || !b.is_permanent) continue;
    const type = String(b.type || '').replace(/_permanent_pickup/, '').replace(/_pickup$/, '');
    for (const t of b.pickup_times_s || []) if (typeof t === 'number') out.push([t, type]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

// Урон между игроками по времени: { t: [секунды снимков], d: { "кто>кого": [накопленный урон] } }.
// В матрице каждый урон записан дважды: по конкретному оружию/способности и по общей
// категории (Bullet, Ability, Melee). Берём только stat_type 0 (урон) и общие категории —
// их сумма ровно совпадает с player_damage игрока (проверено на матче).
function extractDamage(mi) {
  const dm = mi.damage_matrix;
  if (!dm || !Array.isArray(dm.damage_dealers) || !Array.isArray(dm.sample_time_s)) return null;
  const sd = dm.source_details || {};
  const types = Array.isArray(sd.stat_type) ? sd.stat_type : null;
  const names = Array.isArray(sd.source_name) ? sd.source_name : null;
  const counts = (i) => {
    if (!types || !names) return true;
    return types[i] === 0 && /^[A-Z][A-Za-z]*$/.test(String(names[i] || ''));
  };
  const n = dm.sample_time_s.length;
  const teamOf = new Map((mi.players || []).map((p) => [p.player_slot, p.team]));
  const d = {};
  for (const dealer of dm.damage_dealers) {
    for (const src of dealer.damage_sources || []) {
      if (!counts(src.source_details_index)) continue;
      for (const tp of src.damage_to_players || []) {
        // только урон по врагам: так запись остаётся маленькой (~4 КБ на матч)
        const ta = teamOf.get(dealer.dealer_player_slot);
        const tb = teamOf.get(tp.target_player_slot);
        if (ta === undefined || tb === undefined || ta === tb) continue;
        const key = `${dealer.dealer_player_slot}>${tp.target_player_slot}`;
        const arr = d[key] || (d[key] = new Array(n).fill(0));
        const vals = tp.damage || [];
        // массив может быть короче: последние значения — без изменений
        for (let i = 0; i < n; i++) arr[i] += num(vals[Math.min(i, vals.length - 1)] ?? 0);
      }
    }
  }
  return { t: dm.sample_time_s.slice(), d };
}

// Позиция {x, y} из разных возможных форм ответа API.
function posOf(v) {
  if (!v || typeof v !== 'object') return null;
  const x = v.x ?? v[0];
  const y = v.y ?? v[1];
  return typeof x === 'number' && typeof y === 'number' ? [Math.round(x), Math.round(y)] : null;
}

// Смерти с координатами: [время, x, y, слот убийцы, x убийцы, y убийцы]
function deathRows(p) {
  return (p.death_details || [])
    .map((d) => {
      const t = deathTime(d);
      const pos = posOf(d.death_pos || d.position || d.pos);
      const kp = posOf(d.killer_pos);
      const killer = d.killer_player_slot ?? d.killer_slot ?? null;
      return t === null ? null : [t, pos ? pos[0] : null, pos ? pos[1] : null, typeof killer === 'number' ? killer : null, kp ? kp[0] : null, kp ? kp[1] : null];
    })
    .filter(Boolean);
}

// Маршруты героев (match_paths): позиции раз в step секунд в мировых координатах.
// Ответ API: { interval_s, x_resolution, y_resolution, paths: [{ player_slot, x_min, x_max, y_min, y_max, x_pos[], y_pos[], health[], combat_type[] }] }
// Точка: [x, y, жив, с кем бился за эти step секунд (биты: 1 герои, 2 крипы линии, 4 лес), здоровье %].
// combat_type в данных: 0 — нет боя, 1 — с героями, 2 — с крипами линии, 3 — с лесными крипами
// (проверено на матче: доля секунд «3» совпадает с убитыми лесными крипами, корреляция 0,9).
function extractPaths(mi, step = 5) {
  const mp = mi.match_paths || mi.paths;
  if (!mp || !Array.isArray(mp.paths) || !mp.paths.length) return null;
  const interval = mp.interval_s || mp.interval || 1;
  const xr = mp.x_resolution || null;
  const yr = mp.y_resolution || null;
  const every = Math.max(1, Math.round(step / interval));
  const out = {};
  for (const p of mp.paths) {
    const xs = p.x_pos || p.x || [];
    const ys = p.y_pos || p.y || [];
    if (!xs.length || xs.length !== ys.length) continue;
    const scaleX = xr && typeof p.x_min === 'number' && typeof p.x_max === 'number' ? (v) => p.x_min + (v / xr) * (p.x_max - p.x_min) : (v) => v;
    const scaleY = yr && typeof p.y_min === 'number' && typeof p.y_max === 'number' ? (v) => p.y_min + (v / yr) * (p.y_max - p.y_min) : (v) => v;
    const pts = [];
    const hp = Array.isArray(p.health) ? p.health : null;
    const ct = Array.isArray(p.combat_type) ? p.combat_type : null;
    for (let i = 0; i < xs.length; i += every) {
      let alive = Array.isArray(p.alive) ? (p.alive[i] ? 1 : 0) : 1;
      if (!Array.isArray(p.alive) && hp) alive = hp[i] > 0 ? 1 : 0;
      let mask = 0;
      if (ct) {
        for (let j = i; j < Math.min(i + every, ct.length); j++) {
          if (ct[j] === 1) mask |= 1;
          else if (ct[j] === 2) mask |= 2;
          else if (ct[j] === 3) mask |= 4;
        }
      }
      pts.push([Math.round(scaleX(xs[i])), Math.round(scaleY(ys[i])), alive, mask, hp ? Math.round(hp[i]) : null]);
    }
    out[p.player_slot] = pts;
  }
  return Object.keys(out).length ? { step: every * interval, players: out } : null;
}

function deathTime(d) {
  if (!d || typeof d !== 'object') return null;
  const t = d.game_time_s ?? d.time_s ?? d.death_time_s ?? d.game_time;
  return typeof t === 'number' ? t : null;
}

function extractMatch(raw, { paths = false } = {}) {
  const mi = (raw && raw.match_info) || raw;
  if (!mi || !Array.isArray(mi.players)) throw new Error('Неожиданный формат метаданных матча');
  const winning = typeof mi.winning_team === 'number' ? mi.winning_team : null;
  const players = mi.players.map((p) => {
    const stats = (p.stats || [])
      .map(compactStat)
      .filter((s) => s.t > 0)
      .sort((x, y) => x.t - y.t);
    const items = (p.items || [])
      .filter((i) => i && i.item_id)
      .map((i) => [Number(i.item_id), num(i.game_time_s), num(i.sold_time_s), num(i.upgrade_id)]);
    return {
      account_id: Number(p.account_id),
      hero_id: Number(p.hero_id),
      team: typeof p.team === 'number' ? p.team : null,
      slot: p.player_slot,
      lane: typeof p.assigned_lane === 'number' ? p.assigned_lane : null,
      won: winning !== null && p.team === winning,
      k: num(p.kills),
      d: num(p.deaths),
      a: num(p.assists),
      nw: num(p.net_worth),
      lh: num(p.last_hits),
      lvl: num(p.level),
      abandoned: num(p.abandon_match_time_s) > 0,
      items,
      deaths_t: (p.death_details || []).map(deathTime).filter((t) => t !== null),
      deaths: deathRows(p),
      pu: powerUps(p),
      stats,
    };
  });
  const objectives = (mi.objectives || [])
    .filter((o) => o && typeof o.destroyed_time_s === 'number' && o.destroyed_time_s > 0)
    .map((o) => [teamNum(o.team), o.team_objective_id ?? o.team_objective ?? null, o.destroyed_time_s]);
  const midBoss = (mi.mid_boss || [])
    .filter((b) => b && typeof b.destroyed_time_s === 'number')
    .map((b) => [teamNum(b.team_killed), teamNum(b.team_claimed), b.destroyed_time_s]);
  return {
    v: EXTRACT_V,
    match_id: Number(mi.match_id),
    start_time: num(mi.start_time),
    duration_s: num(mi.duration_s),
    winning_team: winning,
    game_mode: mi.game_mode ?? null,
    match_mode: mi.match_mode ?? null,
    badge: [mi.average_badge_team0 ?? null, mi.average_badge_team1 ?? null],
    players,
    paths: paths ? extractPaths(mi) : null,
    dmg: extractDamage(mi),
    objectives,
    midBoss,
  };
}

// Команда в ответе бывает числом (0/1) или строкой ("Team0"/"k_ECitadelLobbyTeam_Team1").
function teamNum(v) {
  if (typeof v === 'number') return v;
  const m = /([01])\s*$/.exec(String(v || ''));
  return m ? Number(m[1]) : null;
}

module.exports = { EXTRACT_V, extractMatch, compactStat, extractPaths, extractDamage, goldSource, powerUps };

}};M["features"]={mod:{exports:{}},fn:function(module,exports){const require=req;'use strict';
// Признаки игрока в матче: всё, по чему библиотека советов понимает ситуацию.
// Считается одинаково для тебя, для топов и для игроков лобби — чтобы сравнивать честно.

const { valueAt } = require('./timeline');
const { median, quantile } = require('./stats');
const { isUpgrade, itemFates } = require('./meta');

const at = (stats, field, min) => valueAt(stats, field, min * 60);
const lastOf = (stats) => (stats && stats.length ? stats[stats.length - 1] : null);
const safeDiv = (a, b) => (a === null || b === null || !b ? null : a / b);
const sub = (a, b) => (a === null || b === null ? null : a - b);
const rnd = (v) => (v === null || v === undefined ? null : Math.round(v));

// Сумма поля по команде в момент времени (для разницы душ между командами).
function teamSumAt(match, team, field, min) {
  let s = 0;
  for (const p of match.players) {
    if (p.team !== team) continue;
    const v = at(p.stats, field, min);
    if (v === null) return null;
    s += v;
  }
  return s;
}

// Время смертей: из списка смертей, а если его нет — по снимкам (с точностью до снимка).
function deathTimes(p) {
  if (p.deaths_t && p.deaths_t.length) return p.deaths_t.slice().sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const s of p.stats || []) {
    for (let i = prev; i < s.d; i++) out.push(s.t);
    prev = s.d;
  }
  return out;
}

function playerFeatures(p, match, assets = null) {
  const st = p.stats || [];
  const last = lastOf(st);
  const dur = Math.max(1, (match.duration_s || (last ? last.t : 60)) / 60);
  const endMin = last ? last.t / 60 : dur;
  const team = match.players.filter((x) => x.team === p.team);
  const enemies = match.players.filter((x) => x.team !== p.team);
  const teamK = team.reduce((s, x) => s + (x.k || 0), 0);
  const teamDmg = team.reduce((s, x) => s + (lastOf(x.stats) ? lastOf(x.stats).pdmg : 0), 0);
  const teamNw = team.reduce((s, x) => s + (x.nw || 0), 0);
  const nwRank = team.slice().sort((a, b) => b.nw - a.nw).findIndex((x) => x === p) + 1;
  const dts = deathTimes(p);

  // Предметы: стоимость, слот, продажи, «непотраченные» души (оценка снизу).
  const items = (p.items || []).filter(([id]) => isUpgrade(assets, id));
  const cost = (id) => (assets && assets.items && assets.items[id] && assets.items[id].cost) || null;
  const slot = (id) => (assets && assets.items && assets.items[id] && assets.items[id].slot) || null;
  const bought = items.slice().sort((a, b) => a[1] - b[1]);
  const big = bought.find(([id]) => (cost(id) || 0) >= 3000);
  const huge = bought.find(([id]) => (cost(id) || 0) >= 6000);
  const slotsBy = (min) => {
    const c = { weapon: 0, vitality: 0, spirit: 0 };
    for (const [id, t] of bought) if (t <= min * 60 && c[slot(id)] !== undefined) c[slot(id)] += 1;
    return c;
  };
  let unspentPeak = null;
  let unspentPeakT = null;
  if (assets && assets.items && Object.keys(assets.items).length && bought.every(([id]) => cost(id) !== null)) {
    for (const s of st) {
      if (s.t < 300) continue;
      const spent = bought.filter(([, t]) => t <= s.t).reduce((sum, [id]) => sum + cost(id), 0);
      const free = s.nw - spent;
      if (unspentPeak === null || free > unspentPeak) {
        unspentPeak = free;
        unspentPeakT = s.t;
      }
    }
  }

  // Паверспайки: после покупки большого предмета (3000+) — была ли драка за 3 минуты
  // (выросли убийства + помощи) и насколько вырос урон по героям.
  const endS = match.duration_s || endMin * 60;
  const spikeBuys = bought.filter(([id, t]) => (cost(id) || 0) >= 3000 && t + 180 <= endS);
  let spikeN = 0;
  let spikeFought = 0;
  for (const [, t] of spikeBuys) {
    const k0 = valueAt(st, 'ka', t);
    const k1 = valueAt(st, 'ka', t + 180);
    if (k0 === null || k1 === null) continue;
    spikeN += 1;
    if (k1 > k0) spikeFought += 1;
  }
  let spikeDmg = null; // урон по героям в минуту за 3 минуты после первого большого предмета
  if (big && big[1] + 180 <= endS) {
    const d0 = valueAt(st, 'pdmg', big[1]);
    const d1 = valueAt(st, 'pdmg', big[1] + 180);
    if (d0 !== null && d1 !== null) spikeDmg = (d1 - d0) / 3;
  }

  // Тайминги карты (только в матчах, скачанных с версии 0.11: в старых этих полей нет)
  const has = (f) => st.length > 0 && st[0][f] !== undefined;
  const atS = (f, t) => (has(f) && t <= endS + 5 ? valueAt(st, f, t) : null);
  const pu = Array.isArray(p.pu) ? p.pu : null;
  const puBy = (t) => (pu && endS >= t ? pu.filter(([pt]) => pt <= t).length : null);

  // Противники по линии (если API отдал назначенную линию)
  const laneFoes = p.lane !== null && p.lane !== undefined ? enemies.filter((x) => x.lane === p.lane) : [];
  const laneFoeNw10 = laneFoes.length ? median(laneFoes.map((x) => at(x.stats, 'nw', 10)).filter((v) => v !== null)) : null;

  const nw10 = at(st, 'nw', 10);
  const nw20 = at(st, 'nw', 20);
  const lh10 = at(st, 'lh', 10);
  const lane10 = at(st, 'g_lane', 10);
  const myT = p.team;
  const otherT = myT === 0 ? 1 : 0;
  const tdiff = (min) => sub(teamSumAt(match, myT, 'nw', min), teamSumAt(match, otherT, 'nw', min));
  const rate = (field, a, b) => {
    const x = at(st, field, a);
    const y = at(st, field, Math.min(b, endMin));
    if (x === null || y === null || Math.min(b, endMin) - a < 2) return null;
    return (y - x) / (Math.min(b, endMin) - a);
  };
  const shots = last ? last.hit + last.miss : 0;

  return {
    hero: p.hero_id,
    account: p.account_id,
    team: p.team,
    won: p.won,
    dur,
    endMin,
    k: p.k,
    d: p.d,
    a: p.a,
    nw: p.nw,
    soulsMin: p.nw / dur,
    nw10,
    nw20,
    lh10: rnd(lh10),
    nk10: rnd(at(st, 'nk', 10)),
    dn10: rnd(at(st, 'dn', 10)),
    lane10,
    neu10: at(st, 'g_neutral', 10),
    neu20: at(st, 'g_neutral', 20),
    boss10: at(st, 'g_boss', 10),
    bossEnd: last ? last.g_boss : null,
    treasureEnd: last ? last.g_treasure : null,
    lostEnd: last ? last.g_lost : null,
    soulsPerCreep10: lh10 && lh10 >= 10 ? lane10 / lh10 : null,
    pdmg10: at(st, 'pdmg', 10),
    pdmgT10: at(st, 'pdmgT', 10),
    dmgMin: last ? last.pdmg / dur : null,
    dmgTMin: last ? last.pdmgT / dur : null,
    healMin: last ? last.heal / dur : null,
    bdmgMin: last ? last.bdmg / dur : null,
    bdmg1020: rate('bdmg', 10, 20),
    dmgLane: rate('pdmg', 0, 10),
    dmgMid: rate('pdmg', 10, 20),
    dmgLate: rate('pdmg', 20, 60),
    soulsLane: rate('nw', 0, 10),
    soulsMid: rate('nw', 10, 20),
    soulsLate: rate('nw', 20, 60),
    ka10: rnd(at(st, 'ka', 10)),
    kaMid: rnd(sub(at(st, 'ka', 20), at(st, 'ka', 10))),
    d10: rnd(at(st, 'd', 10)),
    dMid: rnd(sub(at(st, 'd', 20), at(st, 'd', 10))),
    dLate: endMin > 22 ? rnd(sub(p.d, at(st, 'd', 20))) : null,
    deathTimes: dts,
    firstDeath: dts.length ? dts[0] : null,
    deathBurst: maxInWindow(dts, 300),
    lastMinutesDeaths: dts.filter((t) => t >= (match.duration_s || 0) - 180).length,
    acc: shots >= 80 ? last.hit / shots : null,
    hsRate: last && last.hhit >= 40 ? last.hcrit / last.hhit : null,
    heroShotShare: last && last.hit >= 80 ? last.hhit / last.hit : null,
    kp: teamK > 0 ? Math.min(1, (p.k + p.a) / teamK) : null,
    dmgShare: teamDmg > 0 && last ? last.pdmg / teamDmg : null,
    nwShare: teamNw > 0 ? p.nw / teamNw : null,
    nwRank,
    teamDiff10: tdiff(10),
    teamDiff20: tdiff(20),
    teamDiff25: tdiff(25),
    firstBigT: big ? big[1] : null,
    firstBigId: big ? big[0] : null,
    firstHugeT: huge ? huge[1] : null,
    brkEnd: last && has('g_brk') ? last.g_brk : null,
    brk9: atS('g_brk', 540),
    brk20: atS('g_brk', 1200),
    neu9: atS('g_neutral', 540),
    pu10: puBy(600),
    pu20: puBy(1200),
    tre20: atS('g_treasure', 1200),
    lost20: atS('g_lost', 1200),
    lostPerDeath: p.d >= 2 && last && has('g_lost') ? last.g_lost / p.d : null,
    spikeFights: spikeN ? spikeFought / spikeN : null,
    spikeDmg,
    itemsSold: itemFates(p.items, assets).filter((f) => f.fate === 'sold').length,
    cheapLate: bought.filter(([id, t]) => t >= 1200 && (cost(id) || 9999) <= 800).length,
    slots20: slotsBy(20),
    unspentPeak,
    unspentPeakT,
    lane: p.lane ?? null,
    laneFoes: laneFoes.map((x) => x.hero_id),
    laneFoeNw10,
    abandoned: !!p.abandoned,
  };
}

function maxInWindow(times, win) {
  let best = 0;
  for (let i = 0; i < times.length; i++) {
    let j = i;
    while (j < times.length && times[j] - times[i] <= win) j++;
    best = Math.max(best, j - i);
  }
  return best;
}

// Медиана и квартили признака по списку признаков.
function refOf(list, key) {
  const vals = list.map((f) => f[key]).filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  if (!vals.length) return { med: null, p25: null, p75: null, n: 0 };
  return { med: median(vals), p25: quantile(vals, 0.25), p75: quantile(vals, 0.75), n: vals.length };
}

function refAll(list) {
  const keys = list.length ? Object.keys(list[0]).filter((k) => typeof list[0][k] === 'number' || list[0][k] === null) : [];
  const out = {};
  for (const k of keys) out[k] = refOf(list, k);
  return out;
}

module.exports = { playerFeatures, refOf, refAll, deathTimes, teamSumAt };

}};M["leaks"]={mod:{exports:{}},fn:function(module,exports){const require=req;'use strict';
// Разбор ошибок по одной игре с конкретными моментами («где и когда») и общая
// картина по последним играм: что чаще всего мешает побеждать и сколько это стоит.
//
// Опирается на данные, которые есть в матче с версии 0.11 (см. extract.js):
//   - маршруты героев по 5 секунд: позиция, жив ли, с кем бился (1 герои, 2 крипы линии, 4 лес), здоровье;
//   - урон между игроками по времени (раз в 3 минуты);
//   - души по источникам: коробки, лес, потери при смерти (урна душ — командная, в ошибки не идёт);
//   - время получения постоянных бафов (контейнеры с бафами — бывшие золотые статуи — и джекпот Sinner's).
//
// Тайминги карты (патч 30.10.2026, deadlockhandbook.com и senseos.gg; проверено по данным матчей):
//   коробки и контейнеры с бафами — с 3:00, снова через 3 мин после поломки (в туннелях 5 мин);
//   лес: малый лагерь 2:00 (снова через 1:25), средний 5:00 (4:50), большой 8:00 (5:35);
//   Sinner's Sacrifice — с 8:00, снова через 5 мин после поломки; ~340 душ, джекпот тяжёлым ударом — 4 бафа.
//
// Цифры для сравнения: топы на твоём герое (ref) или, если их данных ещё нет,
// медианы по рангам из 640 тыс. рейтинговых игр (RANK_BENCH, deadlock-api, ноябрь 2026).

const { valueAt } = require('./timeline');
const { N, T, plural } = require('./tipkit');

const souls = (n) => `${N(n)} ${plural(n, 'душа', 'души', 'душ')}`;
// винительный падеж: «потерял 1 551 душу»
const soulsAcc = (n) => `${N(n)} ${plural(n, 'душу', 'души', 'душ')}`;

// Медианы по рангу (average_badge // 10). Рейтинг, игры от 25 минут, 2 дня, 640 тыс. игроко-игр.
// d10 — смерти до 9–10 минуты (медиана 1 на всех рангах: высокие ранги умирают рано не реже),
// brk — души с коробок, neu — души с леса, pu — постоянные бафы (контейнеры и джекпот Sinner's), nw — души всего.
const RANK_BENCH = {
  1: { d10: 1, brk9: 161, brk20: 886, neu9: 144, neu20: 1239, pu10: 1, pu20: 6, nw9: 5671, nw20: 16825 },
  2: { d10: 1, brk9: 232, brk20: 1145, neu9: 232, neu20: 1556, pu10: 1, pu20: 7, nw9: 5805, nw20: 17079 },
  3: { d10: 1, brk9: 301, brk20: 1412, neu9: 282, neu20: 1976, pu10: 2, pu20: 9, nw9: 5927, nw20: 17498 },
  4: { d10: 1, brk9: 382, brk20: 1701, neu9: 349, neu20: 2355, pu10: 3, pu20: 11, nw9: 6083, nw20: 18039 },
  5: { d10: 1, brk9: 459, brk20: 1921, neu9: 409, neu20: 2619, pu10: 3, pu20: 13, nw9: 6225, nw20: 18471 },
  6: { d10: 1, brk9: 515, brk20: 2057, neu9: 443, neu20: 2773, pu10: 4, pu20: 14, nw9: 6324, nw20: 18739 },
  7: { d10: 1, brk9: 546, brk20: 2114, neu9: 471, neu20: 2878, pu10: 4, pu20: 14, nw9: 6401, nw20: 18923 },
  8: { d10: 1, brk9: 579, brk20: 2158, neu9: 496, neu20: 2960, pu10: 5, pu20: 15, nw9: 6499, nw20: 19136 },
  9: { d10: 1, brk9: 617, brk20: 2211, neu9: 537, neu20: 3050, pu10: 5, pu20: 15, nw9: 6635, nw20: 19365 },
  10: { d10: 1, brk9: 669, brk20: 2225, neu9: 585, neu20: 3068, pu10: 6, pu20: 16, nw9: 6831, nw20: 19580 },
};
const TOP_TIER = 10;

// Как привычки до 10:00 связаны с победой у игроков рангов 4–6 (бейдж 40–66, 366 тыс. игроко-игр).
// Это не «причина → следствие», но хорошо показывает, что важно.
const WIN_LINKS = {
  d9: [[0, 0.543], [1, 0.505], [2, 0.473], [3, 0.443], [4, 0.414]],
  pu10: [[0, 0.477], [3, 0.492], [6, 0.519], [8, 0.531]],
  neu9: [[0, 0.487], [600, 0.507], [1050, 0.536]],
  brk9: [[0, 0.479], [450, 0.507], [900, 0.516]],
};

const SPEED = 320; // средняя скорость героя, единиц карты в секунду (медиана по маршрутам)
const FIGHT_FAR = 3000; // дальше этого — не участвовал в драке (≈10 секунд бега)
const FIGHT_REACH = 9000; // дальше этого — не успел бы добежать (≈28 секунд)
const LANE_END = 600; // до 10:00 — стадия линий

const clampTier = (t) => (t ? Math.max(1, Math.min(TOP_TIER, t)) : null);

// Ориентир: топы на этом герое, иначе — высокий ранг; плюс медиана твоего ранга.
function benchFor(key, ref, tier) {
  const r = ref && ref[key] && ref[key].n >= 4 && ref[key].med !== null ? ref[key].med : null;
  const top = RANK_BENCH[TOP_TIER][key] ?? null;
  const mine = tier ? RANK_BENCH[clampTier(tier)][key] ?? null : null;
  return { target: r ?? top, fromTops: r !== null, rankMed: mine, topRank: top };
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Точки маршрута игрока в промежутке [a, b] секунд.
function pathPoints(m, slot, a, b) {
  const pp = m.paths && m.paths.players && m.paths.players[slot];
  if (!pp) return null;
  const step = m.paths.step || 5;
  const out = [];
  for (let i = Math.max(0, Math.floor(a / step)); i <= Math.min(pp.length - 1, Math.ceil(b / step)); i++) out.push({ t: i * step, p: pp[i] });
  return out;
}

// Драки: смерти героев, близкие по времени (≤15 с между соседними) и по месту (≤4000).
function findFights(m) {
  const ev = [];
  for (const p of m.players) {
    for (const d of p.deaths || []) {
      const [t, x, y] = d;
      if (typeof t !== 'number') continue;
      ev.push({ t, x, y, team: p.team, slot: p.slot, hero: p.hero_id });
    }
  }
  ev.sort((a, b) => a.t - b.t);
  const fights = [];
  for (const e of ev) {
    const f = fights[fights.length - 1];
    const near = f && e.t - f.t1 <= 15 && (e.x === null || f.x === null || Math.hypot(e.x - f.x, e.y - f.y) <= 4000);
    if (near) {
      f.deaths.push(e);
      f.t1 = e.t;
      const pos = f.deaths.filter((d) => d.x !== null);
      if (pos.length) {
        f.x = pos.reduce((s, d) => s + d.x, 0) / pos.length;
        f.y = pos.reduce((s, d) => s + d.y, 0) / pos.length;
      }
    } else {
      fights.push({ t0: e.t, t1: e.t, x: e.x, y: e.y, deaths: [e] });
    }
  }
  return fights;
}

// Души, потерянные в каждой смерти: по снимкам статистики, где между снимками ровно одна смерть.
function lossPerDeath(me) {
  const st = me.stats || [];
  if (!st.length || st[0].g_lost === undefined) return [];
  const out = [];
  let prev = { t: 0, g_lost: 0, d: 0 };
  for (const s of st) {
    const dd = s.d - prev.d;
    const lost = s.g_lost - prev.g_lost;
    if (dd === 1) {
      const t = (me.deaths_t || []).find((x) => x > prev.t && x <= s.t);
      if (t !== undefined) out.push({ t, lost });
    }
    prev = s;
  }
  return out;
}

// Души в кармане в момент t: накопленные минус потраченные на предметы.
function unspentAt(me, t, assets) {
  const cost = (id) => (assets && assets.items && assets.items[id] && assets.items[id].cost) || null;
  const items = (me.items || []).filter(([id]) => cost(id));
  if (!items.length || !assets || !assets.items) return null;
  const nw = valueAt(me.stats || [], 'nw', t);
  if (nw === null) return null;
  const spent = items.filter(([, bt]) => bt <= t).reduce((s, [id]) => s + cost(id), 0);
  return nw - spent;
}

/**
 * Ошибки в одной игре.
 * c = { m, me, f, ref, tier, assets, counters, laneVs, heroName, itemName }
 *   f       — признаки игры (features.js)
 *   ref     — признаки топов на этом герое (refAll), может быть пустым
 *   tier    — твой ранг (1–11), для сравнения с игроками твоего уровня
 *   counters— { [enemyHeroId]: [{ id, lift, rateVs }] } — что топы чаще берут против героя
 *   laneVs  — { [enemyHeroId]: delta } — насколько твой герой хуже/лучше против героя (по топам)
 */
function gameLeaks(c) {
  const { m, me, f } = c;
  const heroName = c.heroName || ((id) => `#${id}`);
  const itemName = c.itemName || ((id) => `#${id}`);
  const out = [];
  if (!m || !me || !f) return out;
  const endS = m.duration_s || 0;
  const bySlot = new Map(m.players.map((p) => [p.slot, p]));
  const enemies = m.players.filter((p) => p.team !== me.team);
  const allies = m.players.filter((p) => p.team === me.team && p !== me);

  // ---------- 1. Линия: размены в пользу врага ----------
  const foes = me.lane !== null && me.lane !== undefined ? enemies.filter((p) => p.lane === me.lane) : [];
  if (foes.length && m.dmg && Array.isArray(m.dmg.t)) {
    let idx = -1;
    m.dmg.t.forEach((t, i) => {
      if (t <= LANE_END) idx = i;
    });
    if (idx >= 0) {
      const sum = (keys) => keys.reduce((s, k) => s + ((m.dmg.d[k] || [])[idx] || 0), 0);
      const out9 = sum(foes.map((e) => `${me.slot}>${e.slot}`));
      const in9 = sum(foes.map((e) => `${e.slot}>${me.slot}`));
      const foeSlots = new Set(foes.map((e) => e.slot));
      const laneDeaths = (me.deaths || []).filter((d) => d[0] <= LANE_END && foeSlots.has(d[3]));
      const tAt = m.dmg.t[idx];
      const worstFoe = foes.slice().sort((a, b) => ((m.dmg.d[`${b.slot}>${me.slot}`] || [])[idx] || 0) - ((m.dmg.d[`${a.slot}>${me.slot}`] || [])[idx] || 0))[0];
      const vs = c.laneVs && worstFoe ? c.laneVs[worstFoe.hero_id] : null;
      if (in9 >= out9 * 1.5 && in9 - out9 >= 800 && laneDeaths.length >= 1) {
        const hard = typeof vs === 'number' && vs <= -0.02;
        out.push({
          key: 'lane_trades',
          area: 'Линия',
          level: 'bad',
          score: 70 + laneDeaths.length * 8,
          title: hard ? `Тяжёлый матчап с ${heroName(worstFoe.hero_id)} — и ты пошёл в размены` : 'Размены на линии шли в пользу врага',
          groupTitle: 'Размены на линии шли в пользу врага',
          text: `К ${T(tAt)} ты нанёс противникам по линии ${N(out9)} урона, а получил ${N(in9)} — в ${(in9 / Math.max(1, out9)).toFixed(1).replace('.', ',')} раза больше. ` +
            `Итог — ${laneDeaths.length} ${plural(laneDeaths.length, 'смерть', 'смерти', 'смертей')} на линии.` +
            (hard ? ` У топов ${heroName(me.hero_id)} против ${heroName(worstFoe.hero_id)} выигрывает на ${Math.round(-vs * 100)}% реже обычного — в такой линии размены не твоя сила.` : ''),
          fix: [
            'В слабой линии играй от крипов: добивай волну у своей башни, а не на середине.',
            'Разменивайся только когда враг потратил главную способность или пошёл добивать крипа.',
            'Ушёл в минус по здоровью — не стой на линии: отойди, восстановись, вернись к следующей волне.',
          ],
          moments: laneDeaths.map((d) => ({ t: d[0], x: d[1], y: d[2], text: `умер от ${heroName((bySlot.get(d[3]) || {}).hero_id)}` })),
          cost: { deaths: laneDeaths.length },
          facts: { out9, in9, vs },
        });
      } else if (typeof vs === 'number' && vs <= -0.03 && laneDeaths.length === 0 && f.lh10 !== null) {
        out.push({
          key: 'lane_hard_ok',
          area: 'Линия',
          level: 'good',
          score: 20,
          title: `Пережил тяжёлую линию против ${heroName(worstFoe.hero_id)}`,
          text: `Матчап в пользу врага (у топов −${Math.round(-vs * 100)}%), но ты ни разу не умер до 10:00. Так и надо: в слабой линии главное — не отдать смерти.`,
          fix: [],
          moments: [],
          cost: {},
        });
      }
    }
  }

  // ---------- 2. Бил лес (или крипов), пока команда дралась ----------
  if (m.paths && m.paths.players && m.paths.players[me.slot]) {
    const missed = [];
    for (const fight of findFights(m)) {
      if (fight.t0 < LANE_END || fight.x === null) continue;
      const allyDeaths = fight.deaths.filter((d) => d.team === me.team).length;
      const enemyDeaths = fight.deaths.length - allyDeaths;
      // только настоящие драки, которые команда проиграла
      if (fight.deaths.length < 2 || allyDeaths <= enemyDeaths || fight.deaths.some((d) => d.slot === me.slot)) continue;
      const pts = pathPoints(m, me.slot, fight.t0 - 15, fight.t1);
      if (!pts || !pts.length) continue;
      if (pts.some((q) => !q.p[2])) continue; // был мёртв — не в счёт
      const mask = pts.reduce((s, q) => s | (q.p[3] || 0), 0);
      if (mask & 1) continue; // дрался с героями — значит, участвовал
      const start = pts[0].p;
      const far = dist([start[0], start[1]], [fight.x, fight.y]);
      if (far < FIGHT_FAR || far > FIGHT_REACH) continue;
      const farming = mask & 6;
      if (!farming) continue;
      missed.push({ t: fight.t0, x: fight.x, y: fight.y, allyDeaths, enemyDeaths, far, jungle: !!(mask & 4), sec: Math.round(far / SPEED) });
    }
    const lostOnes = missed;
    const allyDeathsTotal = missed.reduce((s, x) => s + x.allyDeaths, 0);
    if (lostOnes.length >= 2) {
      const jungle = missed.filter((x) => x.jungle).length;
      out.push({
        key: 'farm_while_fight',
        area: 'Драки',
        level: lostOnes.length >= 3 ? 'bad' : 'warn',
        score: 55 + lostOnes.length * 10 + allyDeathsTotal * 2,
        title: jungle >= missed.length / 2 ? 'Бил лес, пока команда дралась' : 'Фармил, пока команда дралась',
        groupTitle: 'Фармил, пока команда проигрывала драки',
        text: `${missed.length} ${plural(missed.length, 'раз', 'раза', 'раз')} после 10:00 команда проиграла драку без тебя, а ты в это время фармил ${jungle ? 'лес' : 'крипов'} в 10–28 секундах бега от неё. ` +
          `В этих драках погибло ${allyDeathsTotal} ${plural(allyDeathsTotal, 'союзник', 'союзника', 'союзников')}.`,
        fix: [
          'Каждые 5–10 секунд смотри на миникарту: союзники собираются вместе — иди к ним, лагерь подождёт.',
          'Фарми лес на своей половине карты рядом с командой, а не на другом конце.',
          'Драка уже началась далеко от тебя (больше 10 секунд бега) — не беги в неё по одному, а дави волну на другой линии.',
        ],
        moments: missed.map((x) => ({ t: x.t, x: x.x, y: x.y, text: `драка ${x.allyDeaths}:${x.enemyDeaths} (наши потери : их), ты в ${x.sec} с бега${x.jungle ? ', в лесу' : ''}` })),
        cost: { allyDeaths: allyDeathsTotal, fightsLost: lostOnes.length },
      });
    }
  }

  // ---------- 3. Тайминги карты: лес, коробки, контейнеры с бафами, казино ----------
  const timing = [];
  if (f.neu9 !== null && f.neu9 !== undefined && endS >= 600) {
    const b = benchFor('neu9', c.ref, c.tier);
    if (b.target && f.neu9 < b.target * 0.5 && b.target - f.neu9 >= 300) timing.push({ k: 'neu9', what: 'лес к 9:00', me: f.neu9, ...b, souls: b.target - f.neu9 });
  }
  if (f.brk20 !== null && f.brk20 !== undefined) {
    const b = benchFor('brk20', c.ref, c.tier);
    if (b.target && f.brk20 < b.target * 0.65 && b.target - f.brk20 >= 600) timing.push({ k: 'brk20', what: 'коробки к 20:00', me: f.brk20, ...b, souls: b.target - f.brk20 });
  } else if (f.brk9 !== null && f.brk9 !== undefined && endS >= 600) {
    const b = benchFor('brk9', c.ref, c.tier);
    if (b.target && f.brk9 < b.target * 0.5 && b.target - f.brk9 >= 250) timing.push({ k: 'brk9', what: 'коробки к 9:00', me: f.brk9, ...b, souls: b.target - f.brk9 });
  }
  if (f.pu10 !== null && f.pu10 !== undefined) {
    const b = benchFor('pu10', c.ref, c.tier);
    if (b.target && f.pu10 <= b.target - 4) timing.push({ k: 'pu10', what: 'постоянных бафов к 10:00', me: f.pu10, ...b, souls: 0, statues: b.target - f.pu10 });
  }
  if (f.pu20 !== null && f.pu20 !== undefined) {
    const b = benchFor('pu20', c.ref, c.tier);
    if (b.target && f.pu20 <= b.target - 6) timing.push({ k: 'pu20', what: 'постоянных бафов к 20:00', me: f.pu20, ...b, souls: 0, statues: b.target - f.pu20 });
  }
  if (timing.length) {
    const lostSouls = timing.reduce((s, x) => s + x.souls, 0);
    const statues = Math.max(0, ...timing.map((x) => x.statues || 0));
    const who = timing.some((x) => x.fromTops) ? 'у топов на этом герое' : 'у игроков Ascendant+';
    const fmt = (x) => (x.k.startsWith('pu') ? `${x.what} — ${x.me}, ${who} — ${x.target}` : `${x.what} — ${souls(x.me)}, ${who} — ${N(x.target)}`);
    out.push({
      key: 'map_timings',
      area: 'Тайминги',
      level: lostSouls >= 900 || statues >= 4 ? 'bad' : 'warn',
      score: 40 + Math.min(40, lostSouls / 40) + statues * 4,
      title: 'Не забираешь то, что лежит на карте',
      text: timing.map((x) => fmt(x)).map((t, i) => (i === 0 ? t[0].toUpperCase() + t.slice(1) : t)).join('; ') + '.' +
        (lostSouls ? ` Это ${souls(lostSouls)}, которые просто остались на карте.` : '') +
        (statues ? ` И ${statues} ${plural(statues, 'постоянный баф', 'постоянных бафа', 'постоянных бафов')} мимо — это здоровье, урон и скорость стрельбы до конца игры.` : ''),
      fix: [
        'Коробки и контейнеры с бафами (бывшие золотые статуи) появляются на 3:00 и восстанавливаются через 3 минуты после поломки. Волна ушла к врагу — ломай те, что у твоей линии, и возвращайся к следующей волне.',
        'Малый лесной лагерь появляется на 2:00 и восстанавливается через 1:25 — бери его каждый раз, пока ждёшь волну. Средний — с 5:00, большой — с 8:00.',
        'Идёшь с базы или на другую линию — веди маршрут через коробки и контейнеры по пути.',
      ],
      moments: [],
      cost: { souls: lostSouls, statues },
      facts: timing,
    });
  }
  // gold_treasure — это урна душ: её души получает вся команда разом (проверено на матчах:
  // шесть игроков получают одинаковую сумму в одну минуту). Личной ошибкой «не взял» не считаем.

  // ---------- 4. Души, потерянные при смерти ----------
  const losses = lossPerDeath(me).filter((x) => x.lost >= 600);
  if (losses.length) {
    const total = losses.reduce((s, x) => s + x.lost, 0);
    const ref = c.ref && c.ref.lostPerDeath && c.ref.lostPerDeath.n >= 4 ? c.ref.lostPerDeath.med : null;
    if (total >= 1200 || losses.length >= 2) {
      out.push({
        key: 'lost_souls',
        area: 'Выживание',
        level: total >= 2000 ? 'bad' : 'warn',
        score: 35 + Math.min(40, total / 60),
        title: 'Умирал с несохранёнными душами',
        text: `${losses.length} ${plural(losses.length, 'смерть стоила', 'смерти стоили', 'смертей стоили')} тебе ${soulsAcc(total)} — их ты не успел сохранить.` +
          (ref ? ` У топов на этом герое одна смерть в среднем стоит ${soulsAcc(ref)}.` : ''),
        fix: [
          'Свежие души сначала «несохранённые»: умрёшь — часть пропадёт. После крупного фарма не лезь сразу в рискованную драку.',
          'Накопил на предмет — вернись и купи, а потом иди драться: потраченные души потерять нельзя.',
          'Видишь, что драка проиграна, — отступай раньше: смерть с полным карманом стоит вдвое дороже.',
        ],
        moments: losses.map((x) => ({ t: x.t, text: `умер и потерял ${soulsAcc(x.lost)}` })),
        cost: { souls: total },
      });
    }
  }

  // ---------- 5. Смерть с непотраченными душами ----------
  const rich = (me.deaths || [])
    .filter((d) => d[0] >= LANE_END)
    .map((d) => ({ t: d[0], x: d[1], y: d[2], free: unspentAt(me, d[0], c.assets) }))
    .filter((d) => d.free !== null && d.free >= 3000);
  if (rich.length) {
    out.push({
      key: 'died_rich',
      area: 'Предметы',
      level: rich.length >= 2 ? 'bad' : 'warn',
      score: 30 + rich.length * 10,
      title: 'Умирал с душами на целый предмет',
      text: `${rich.length} ${plural(rich.length, 'раз', 'раза', 'раз')} ты погиб, имея в кармане до ${souls(Math.max(...rich.map((d) => d.free)))} — это готовый предмет, который не участвовал в драке.`,
      fix: ['Перед дракой или объектом проверь души: хватает на предмет — купи (магазин у линии ближе, чем кажется).'],
      moments: rich.map((d) => ({ t: d.t, x: d.x, y: d.y, text: `умер с ${souls(d.free)} в кармане` })),
      cost: { souls: 0 },
    });
  }

  // ---------- 6. Не собрал предмет против опасного героя ----------
  if (c.counters && endS >= 1200) {
    const taken = {};
    if (m.dmg && m.dmg.d) {
      const last = m.dmg.t.length - 1;
      for (const e of enemies) taken[e.slot] = ((m.dmg.d[`${e.slot}>${me.slot}`] || [])[last] || 0);
    }
    const totalTaken = Object.values(taken).reduce((s, v) => s + v, 0);
    const kills = {};
    for (const d of me.deaths || []) if (d[3] !== null) kills[d[3]] = (kills[d[3]] || 0) + 1;
    const myItems = new Set((me.items || []).map(([id]) => id));
    const misses = [];
    for (const e of enemies) {
      const share = totalTaken ? taken[e.slot] / totalTaken : 0;
      const k = kills[e.slot] || 0;
      if (k < 2 && share < 0.3) continue;
      const list = (c.counters[e.hero_id] || []).slice(0, 3);
      if (!list.length || list.some((x) => myItems.has(x.id))) continue;
      misses.push({ hero: e.hero_id, kills: k, share, items: list });
    }
    if (misses.length) {
      const top = misses.sort((a, b) => b.kills - a.kills || b.share - a.share)[0];
      const what = [top.kills ? `убил тебя ${top.kills} ${plural(top.kills, 'раз', 'раза', 'раз')}` : '', top.share >= 0.3 ? `нанёс ${Math.round(top.share * 100)}% всего урона по тебе` : ''].filter(Boolean).join(' и ');
      out.push({
        key: 'counter_missing',
        area: 'Предметы',
        level: 'warn',
        score: 38 + top.kills * 5,
        title: `Не было ответа на ${heroName(top.hero)}`,
        groupTitle: 'Не собираешь ответ на героя, который тебя убивает',
        text: `${heroName(top.hero)} ${what}. Против него топы заметно чаще берут: ${top.items.map((x) => `${itemName(x.id)} (в ${x.lift.toFixed(1).replace('.', ',')} раза чаще)`).join(', ')}. У тебя этого не было.`,
        fix: [
          `Видишь ${heroName(top.hero)} у соперников — заранее впиши в сборку ${top.items.length > 1 ? 'один из этих предметов' : 'этот предмет'}: ${top.items.map((x) => itemName(x.id)).join(', ')}.`,
          'Ответ не обязательно брать первым: купи его, как только этот герой начал тебя убивать, — обычно к 15–20 минуте.',
        ],
        groupFix: [
          'Посмотри в примерах ниже, кто тебя убивал и что против него берут топы. Видишь этого героя у соперников — впиши предмет в сборку заранее.',
          'Ответ не обязательно брать первым: купи его, как только этот герой начал тебя убивать, — обычно к 15–20 минуте.',
        ],
        extra: { hero: top.hero, kills: top.kills, share: Math.round(top.share * 100) / 100, items: top.items },
        moments: [],
        cost: {},
        facts: misses,
      });
    }
  }

  return out.sort((a, b) => b.score - a.score);
}

/**
 * Сильные моменты игры — что получилось и что стоит повторять. Те же данные, что у gameLeaks.
 * Каждый пункт: что сделал (с цифрами и временем), что это дало, как закрепить.
 */
function gameHighlights(c) {
  const { m, me, f } = c;
  const heroName = c.heroName || ((id) => `#${id}`);
  const itemName = c.itemName || ((id) => `#${id}`);
  const out = [];
  if (!m || !me || !f) return out;
  const endS = m.duration_s || 0;
  const enemies = m.players.filter((p) => p.team !== me.team);
  const bySlot = new Map(m.players.map((p) => [p.slot, p]));
  // мои убийства: смерти соперников, где убийца — я
  const myKills = [];
  for (const e of enemies) for (const d of e.deaths || []) if (d[3] === me.slot) myKills.push({ t: d[0], x: d[1], y: d[2], hero: e.hero_id, slot: e.slot });
  myKills.sort((a, b) => a.t - b.t);
  const push = (o) => out.push({ level: 'good', fix: [], moments: [], cost: {}, ...o });

  // ---------- 1. Линия ----------
  const foes = me.lane !== null && me.lane !== undefined ? enemies.filter((p) => p.lane === me.lane) : [];
  const foeSlots = new Set(foes.map((e) => e.slot));
  const laneDeaths = (me.deaths || []).filter((d) => d[0] <= LANE_END).length;
  if (foes.length && m.dmg && Array.isArray(m.dmg.t)) {
    let idx = -1;
    m.dmg.t.forEach((t, i) => {
      if (t <= LANE_END) idx = i;
    });
    if (idx >= 0) {
      const sum = (keys) => keys.reduce((a, k) => a + ((m.dmg.d[k] || [])[idx] || 0), 0);
      const out9 = sum(foes.map((e) => `${me.slot}>${e.slot}`));
      const in9 = sum(foes.map((e) => `${e.slot}>${me.slot}`));
      const laneKills = myKills.filter((k) => k.t <= LANE_END && foeSlots.has(k.slot));
      if (out9 >= in9 * 1.4 && out9 - in9 >= 600 && laneDeaths <= 1) {
        push({
          key: 'lane_won', area: 'Линия', score: 60 + laneKills.length * 8,
          title: 'Выиграл размены на линии',
          text: `К ${T(m.dmg.t[idx])} ты нанёс противникам по линии ${N(out9)} урона, а получил ${N(in9)} — в ${(out9 / Math.max(1, in9)).toFixed(1).replace('.', ',')} раза меньше.` +
            (laneKills.length ? ` И забрал ${laneKills.length} ${plural(laneKills.length, 'убийство', 'убийства', 'убийств')}.` : '') +
            (laneDeaths === 0 ? ' Сам ни разу не умер.' : ''),
          keep: 'Так и разменивайся: бей, когда враг добивает крипа или потратил способность, и отходи раньше, чем он ответит.',
          moments: laneKills.map((k) => ({ t: k.t, x: k.x, y: k.y, text: `убил ${heroName(k.hero)}` })),
        });
      }
    }
  }
  if (laneDeaths === 0 && endS >= LANE_END && !out.some((x) => x.key === 'lane_won')) {
    push({
      key: 'lane_clean', area: 'Линия', score: 34,
      title: 'Ни одной смерти до 10:00',
      text: 'Ты прошёл линию без смертей. У игроков твоего уровня это 54% побед против 47% при двух смертях.',
      keep: 'Держи это правило: на линии лучше недобрать крипа, чем отдать смерть.',
    });
  }

  // ---------- 2. Карта: лес, коробки, бафы на уровне топов ----------
  const done = [];
  for (const [k, label] of [['neu9', 'лес к 9:00'], ['brk9', 'коробки к 9:00'], ['pu10', 'постоянных бафов к 10:00'], ['brk20', 'коробки к 20:00'], ['pu20', 'постоянных бафов к 20:00']]) {
    const v = f[k];
    if (v === null || v === undefined) continue;
    const b = benchFor(k, c.ref, c.tier);
    if (b.target && v >= b.target) done.push({ k, label, v, target: b.target, fromTops: b.fromTops });
  }
  if (done.length >= 2) {
    const who = done.some((x) => x.fromTops) ? 'у топов на этом герое' : 'у игроков Ascendant+';
    push({
      key: 'map_good', area: 'Тайминги', score: 40 + done.length * 6,
      title: 'Забирал карту на уровне топов',
      text: done.map((x) => (x.k.startsWith('pu') ? `${x.label} — ${x.v} (${who} ${x.target})` : `${x.label} — ${souls(Math.round(x.v))} (${who} ${N(x.target)})`)).map((t, i) => (i === 0 ? t[0].toUpperCase() + t.slice(1) : t)).join('; ') + '.',
      keep: 'Это бесплатные души и бафы — продолжай собирать их между волнами, как в этой игре.',
    });
  }

  // ---------- 3. Драки: был там, где команда выиграла ----------
  if (m.paths && m.paths.players && m.paths.players[me.slot]) {
    const won = [];
    for (const fight of findFights(m)) {
      if (fight.t0 < LANE_END || fight.x === null || fight.deaths.length < 3) continue;
      const allyD = fight.deaths.filter((d) => d.team === me.team).length;
      const enemyD = fight.deaths.length - allyD;
      if (enemyD <= allyD) continue;
      const pts = pathPoints(m, me.slot, fight.t0 - 10, fight.t1);
      if (!pts || !pts.length) continue;
      const near = pts.some((q) => q.p[2] && (q.p[3] & 1) && dist([q.p[0], q.p[1]], [fight.x, fight.y]) <= 3500);
      if (!near) continue;
      const kills = myKills.filter((k) => k.t >= fight.t0 - 2 && k.t <= fight.t1 + 2).length;
      const died = fight.deaths.some((d) => d.slot === me.slot);
      won.push({ t: fight.t0, x: fight.x, y: fight.y, allyD, enemyD, kills, died });
    }
    if (won.length >= 2) {
      const kills = won.reduce((a, x) => a + x.kills, 0);
      push({
        key: 'fights_won', area: 'Драки', score: 45 + won.length * 6 + kills * 3,
        title: 'Был в драках, которые команда выиграла',
        text: `После 10:00 ты участвовал в ${won.length} ${plural(won.length, 'выигранной драке', 'выигранных драках', 'выигранных драках')}` +
          (kills ? ` и сам забрал в них ${kills} ${plural(kills, 'убийство', 'убийства', 'убийств')}.` : '.') +
          (won.every((x) => !x.died) ? ' И ни в одной не умер.' : ''),
        keep: 'Командные драки решают игру после линии. Продолжай приходить на них вовремя.',
        moments: won.slice(0, 5).map((x) => ({ t: x.t, x: x.x, y: x.y, text: `драка ${x.enemyD}:${x.allyD} в нашу пользу${x.kills ? `, твоих убийств: ${x.kills}` : ''}` })),
      });
    }
  }

  // ---------- 4. Серии убийств ----------
  const streaks = [];
  let cur = [];
  for (const k of myKills) {
    if (cur.length && k.t - cur[cur.length - 1].t > 15) {
      if (cur.length >= 2) streaks.push(cur);
      cur = [];
    }
    cur.push(k);
  }
  if (cur.length >= 2) streaks.push(cur);
  if (streaks.length) {
    const best = streaks.slice().sort((a, b) => b.length - a.length)[0];
    const word = (n) => (n >= 4 ? 'Четыре убийства подряд' : n === 3 ? 'Тройное убийство' : 'Двойное убийство');
    push({
      key: 'multikill', area: 'Драки', score: 38 + best.length * 10,
      title: streaks.length > 1 ? `${word(best.length)} и ещё ${streaks.length - 1} ${plural(streaks.length - 1, 'серия', 'серии', 'серий')}` : word(best.length),
      text: `На ${T(best[0].t)} ты за ${Math.max(1, best[best.length - 1].t - best[0].t)} с убил ${best.map((k) => heroName(k.hero)).join(', ')}.`,
      keep: 'Посмотри этот момент на карте: где ты стоял и откуда зашёл — такую позицию стоит искать снова.',
      moments: streaks.slice(0, 4).map((st) => ({ t: st[0].t, x: st[0].x, y: st[0].y, text: `${st.length} ${plural(st.length, 'убийство', 'убийства', 'убийств')}: ${st.map((k) => heroName(k.hero)).join(', ')}` })),
    });
  }

  // ---------- 5. Убийство на последних процентах здоровья ----------
  if (m.paths && m.paths.players && m.paths.players[me.slot]) {
    const clutch = [];
    for (const k of myKills) {
      const pts = pathPoints(m, me.slot, k.t - 5, k.t + 10);
      if (!pts || pts.length < 2) continue;
      const hp = pts.filter((q) => q.t <= k.t).map((q) => q.p[4]).filter((v) => v !== null && v !== undefined);
      const low = hp.length ? Math.min(...hp) : null;
      const survived = pts.filter((q) => q.t > k.t).every((q) => q.p[2]);
      if (low !== null && low > 0 && low <= 20 && survived) clutch.push({ ...k, low });
    }
    if (clutch.length) {
      push({
        key: 'clutch', area: 'Драки', score: 36 + clutch.length * 6,
        title: clutch.length > 1 ? `${clutch.length} убийства на последних процентах здоровья` : 'Убийство на последних процентах здоровья',
        text: `${clutch.map((k) => `на ${T(k.t)} убил ${heroName(k.hero)} с ${k.low}% здоровья`).join('; ')} — и выжил.`.replace(/^./, (ch) => ch.toUpperCase()),
        keep: 'Хладнокровно доиграл размен. Но помни: с таким здоровьем чаще стоит отойти — в этот раз расчёт оправдался.',
        moments: clutch.slice(0, 4).map((k) => ({ t: k.t, x: k.x, y: k.y, text: `убил ${heroName(k.hero)} с ${k.low}% здоровья` })),
      });
    }
  }

  // ---------- 6. Выживание и души ----------
  const longGame = endS >= 1500;
  const refD = c.ref && c.ref.d && c.ref.d.n >= 4 ? c.ref.d.med : null;
  if (longGame && me.d <= Math.min(3, refD !== null ? refD : 3)) {
    push({
      key: 'few_deaths', area: 'Выживание', score: 42,
      title: me.d === 0 ? 'Ни одной смерти за игру' : `Всего ${me.d} ${plural(me.d, 'смерть', 'смерти', 'смертей')} за игру`,
      text: `Игра шла ${Math.round(endS / 60)} минут, а ты умер ${me.d === 0 ? 'ноль раз' : `${me.d} ${plural(me.d, 'раз', 'раза', 'раз')}`}${refD !== null ? ` — у топов на этом герое обычно ${String(Math.round(refD * 10) / 10).replace('.', ',')}` : ''}.`,
      keep: 'Меньше смертей — больше времени на карте и души при тебе. Это твоя сильная сторона в этой игре.',
    });
  }
  const st = me.stats || [];
  const lostTotal = st.length && st[st.length - 1].g_lost !== undefined ? st[st.length - 1].g_lost : null;
  if (lostTotal !== null && me.d >= 4 && lostTotal <= me.d * 60) {
    push({
      key: 'souls_safe', area: 'Выживание', score: 30,
      title: 'Умирал «пустым» — души были сохранены',
      text: `За ${me.d} ${plural(me.d, 'смерть', 'смерти', 'смертей')} ты потерял всего ${souls(lostTotal)}: перед драками души были потрачены или сохранены.`,
      keep: 'Правильная привычка: сначала магазин, потом драка.',
    });
  }

  // ---------- 7. Собрал ответ на самого опасного героя ----------
  if (c.counters && m.dmg && m.dmg.d && endS >= 1200) {
    const last = m.dmg.t.length - 1;
    const taken = enemies.map((e) => ({ e, v: (m.dmg.d[`${e.slot}>${me.slot}`] || [])[last] || 0 })).sort((a, b) => b.v - a.v);
    const total = taken.reduce((a, x) => a + x.v, 0);
    const top = taken[0];
    if (top && total && top.v / total >= 0.25) {
      const mine = new Set((me.items || []).map(([id]) => id));
      const hit = (c.counters[top.e.hero_id] || []).find((x) => mine.has(x.id));
      if (hit) {
        push({
          key: 'counter_ok', area: 'Предметы', score: 40,
          title: `Собрал ответ на ${heroName(top.e.hero_id)}`,
          text: `${heroName(top.e.hero_id)} нанёс ${Math.round((top.v / total) * 100)}% всего урона по тебе, и у тебя был ${itemName(hit.id)} — топы берут его против этого героя в ${hit.lift.toFixed(1).replace('.', ',')} раза чаще обычного.`,
          keep: 'Ты подстроил сборку под соперника — так делают сильные игроки.',
        });
      }
    }
  }

  // ---------- 8. Паверспайк использован ----------
  if (f.spikeFights !== null && f.spikeFights !== undefined && f.spikeFights >= 0.99 && f.firstBigT) {
    push({
      key: 'spike_used', area: 'Паверспайки', score: 28,
      title: 'Каждый большой предмет сразу шёл в дело',
      text: 'После каждой покупки предмета за 3000+ ты в течение 3 минут участвовал в убийстве.',
      keep: 'Купил — используй, пока враг не докупился. Ты так и делал.',
    });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

// Что топы чаще берут против каждого героя. records: [{ match, player }] — игры топового уровня.
// lift = доля игр с предметом, когда герой у соперников / доля без него.
function counterItems(records, { minBuys = 12, minRate = 0.1, minLift = 1.5, perHero = 4, isItem = () => true } = {}) {
  const N0 = records.length;
  if (N0 < 200) return {};
  const total = new Map();
  const withE = new Map(); // hero -> { n, items: Map }
  for (const { match, player } of records) {
    const items = new Set((player.items || []).map(([id]) => id).filter(isItem));
    for (const id of items) total.set(id, (total.get(id) || 0) + 1);
    for (const e of match.players) {
      if (e.team === player.team) continue;
      let w = withE.get(e.hero_id);
      if (!w) withE.set(e.hero_id, (w = { n: 0, items: new Map() }));
      w.n += 1;
      for (const id of items) w.items.set(id, (w.items.get(id) || 0) + 1);
    }
  }
  const out = {};
  for (const [hero, w] of withE) {
    if (w.n < 60 || N0 - w.n < 60) continue;
    const rows = [];
    for (const [id, b] of w.items) {
      if (b < minBuys) continue;
      const rateVs = b / w.n;
      const rateElse = ((total.get(id) || 0) - b) / (N0 - w.n);
      if (rateVs < minRate || rateElse <= 0) continue;
      const lift = rateVs / rateElse;
      if (lift >= minLift) rows.push({ id, lift: Math.round(lift * 100) / 100, rateVs: Math.round(rateVs * 1000) / 1000 });
    }
    rows.sort((a, b) => b.lift * Math.sqrt(b.rateVs) - a.lift * Math.sqrt(a.rateVs));
    if (rows.length) out[hero] = rows.slice(0, perHero);
  }
  return out;
}

function wrFactor(a, b) {
  if (a === null || b === null) return 1;
  return Math.max(0.6, Math.min(1.6, 1 + (b - a) * 2));
}

// Общая картина по играм: что повторяется, сколько стоит, как связано с победой.
// games: [{ match_id, start_time, won, hero, leaks: [...] }]
function leakProfile(games) {
  const by = new Map();
  const counted = games.filter((g) => Array.isArray(g.leaks));
  for (const g of counted) {
    for (const l of g.leaks) {
      if (l.level === 'good') continue;
      let e = by.get(l.key);
      if (!e) by.set(l.key, (e = { key: l.key, area: l.area, title: l.groupTitle || l.title, fix: l.groupFix || l.fix, games: [], souls: 0, deaths: 0, allyDeaths: 0, statues: 0, score: 0 }));
      e.games.push({ match_id: g.match_id, start_time: g.start_time, won: g.won, hero: g.hero, title: l.title, text: l.text, extra: l.extra || null, moments: (l.moments || []).slice(0, 4), score: l.score });
      e.souls += (l.cost && l.cost.souls) || 0;
      e.deaths += (l.cost && l.cost.deaths) || 0;
      e.allyDeaths += (l.cost && l.cost.allyDeaths) || 0;
      e.statues += (l.cost && l.cost.statues) || 0;
      e.score += l.score;
      if (!l.groupFix && l.fix && l.fix.length > (e.fix || []).length) e.fix = l.fix;
    }
  }
  const n = counted.length;
  const wr = (list) => {
    const d = list.filter((g) => g.won === true || g.won === false);
    return d.length ? d.filter((g) => g.won).length / d.length : null;
  };
  const rows = [...by.values()].map((e) => {
    const ids = new Set(e.games.map((g) => g.match_id));
    const withL = counted.filter((g) => ids.has(g.match_id));
    const without = counted.filter((g) => !ids.has(g.match_id));
    return {
      ...e,
      count: e.games.length,
      share: n ? e.games.length / n : 0,
      wrWith: withL.length >= 3 ? wr(withL) : null,
      wrWithout: without.length >= 3 ? wr(without) : null,
      // важность: как часто × насколько серьёзно × бьёт ли по победам именно в твоих играх
      // (с ошибкой выигрываешь реже — важнее; не реже — менее важно; мало игр — без поправки)
      impact: (e.games.length / Math.max(1, n)) * (e.score / e.games.length) * wrFactor(withL.length >= 3 ? wr(withL) : null, without.length >= 3 ? wr(without) : null),
      examples: e.games.slice().sort((a, b) => b.score - a.score).slice(0, 3),
    };
  });
  return { games: n, rows: rows.sort((a, b) => b.impact - a.impact) };
}

// Связь привычки с победой у игроков твоего уровня: значение → доля побед.
function winLink(key, value) {
  const list = WIN_LINKS[key];
  if (!list || value === null || value === undefined) return null;
  let cur = list[0];
  for (const row of list) if (value >= row[0]) cur = row;
  return { wr: cur[1], best: list[list.length - 1] };
}

module.exports = { souls, gameLeaks, gameHighlights, leakProfile, counterItems, findFights, lossPerDeath, unspentAt, winLink, benchFor, RANK_BENCH, WIN_LINKS, FIGHT_FAR, FIGHT_REACH, SPEED };

}};M["portraits"]={mod:{exports:{}},fn:function(module,exports){const require=req;'use strict';
// Распознавание героев по портретам на верхней панели Deadlock.
// Работает с «сырыми» картинками: { w, h, data: RGBA (Uint8 / Buffer) }.
// Ничего не знает про Electron — его можно проверить и в браузере, и в Node.
//
// 1) findSlots: под каждым портретом есть плашка душ цвета команды (янтарная или
//    сапфировая) на одной высоте. Ищем эти плашки в верхней части экрана — они
//    дают число игроков, центр каждого портрета и команду.
// 2) slotFeature: вырезаем портрет над плашкой, берём центр (по краям значки «!»)
//    и сжимаем в маленькую сетку цветов.
// 3) Сравнение с образцами: картинки героев из справочника (с прозрачностью,
//    подбираем масштаб и сдвиг), встроенные образцы (герои, чей портрет в игре
//    не совпадает с картинкой справочника) и портреты, которые пользователь подтвердил сам.
//    Фон за портретом всё время разный (цвет команды, карта сквозь полупрозрачную
//    плашку), поэтому сравниваем двумя способами и складываем:
//    — цвет только в овале лица (углы с фоном не считаем);
//    — контуры (перепады яркости) — форма головы и деталей от фона почти не зависит.
//    Каждую оценку переводим в «насколько этот герой выделяется среди всех» (z-оценка),
//    так две шкалы складываются честно, а уверенность — это отрыв от второго места.

const GW = 24; // сетка признаков
const GH = 30;

function px(img, x, y) {
  const i = (y * img.w + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

// Цвета команд на плашках душ (на скриншотах 2560×1600 янтарь ≈ (212,135,12), сапфир ≈ (78,118,196)).
// Плашки бывают полупрозрачными (соперники, которых ещё не видно, — например, в начале матча
// с ботами): тогда цвет смешан с фоном — (106,71,33), (169,129,92), (146,110,87). Поэтому кроме
// ярких цветов узнаём и тусклые по оттенку: янтарь — r > g > b, g посередине между r и b.
function brightTeamColor(r, g, b) {
  if (r > 185 && g > 95 && g < 180 && b < 80 && r - b > 130) return 'amber';
  if (b > 165 && r < 140 && g > 85 && g < 175 && b - r > 60) return 'sapphire';
  return null;
}

function teamColor(r, g, b) {
  const bright = brightTeamColor(r, g, b);
  if (bright) return bright;
  const dimAmber = r >= 90 && r > g && g > b && r - b >= 50 && (r - b) / r >= 0.38 && (g - b) / (r - b) >= 0.3 && (g - b) / (r - b) <= 0.72;
  if (dimAmber) return 'amber';
  const dimSapphire = b >= 110 && b > g && g > r && b - r >= 45 && (b - r) / b >= 0.33 && (g - r) / (b - r) >= 0.25 && (g - r) / (b - r) <= 0.7;
  if (dimSapphire) return 'sapphire';
  return null;
}

// Поиск плашек: строки в полосе 8–13% высоты, отрезки одного цвета шириной ≈ 3% высоты.
function findSlots(img) {
  const H = img.h;
  const W = img.w;
  const minW = Math.round(H * 0.022);
  const maxW = Math.round(H * 0.045);
  const found = [];
  for (let y = Math.round(H * 0.08); y <= Math.round(H * 0.13); y += Math.max(1, Math.round(H / 400))) {
    let cur = null;
    const segs = [];
    for (let x = Math.round(W * 0.1); x < Math.round(W * 0.9); x++) {
      const [r, g, b] = px(img, x, y);
      const t = teamColor(r, g, b);
      if (t && cur && cur.t === t && x - cur.b <= 2) cur.b = x;
      else {
        if (cur) segs.push(cur);
        cur = t ? { t, a: x, b: x } : null;
      }
    }
    if (cur) segs.push(cur);
    for (const s of segs) {
      const w = s.b - s.a + 1;
      if (w >= minW && w <= maxW) found.push({ y, team: s.t, cx: (s.a + s.b) / 2, w });
    }
  }
  // объединяем одинаковые плашки с разных строк
  const slots = [];
  for (const f of found) {
    const s = slots.find((o) => o.team === f.team && Math.abs(o.cxSum / o.n - f.cx) < H * 0.012);
    if (s) {
      s.n += 1;
      s.cxSum += f.cx;
      s.yMin = Math.min(s.yMin, f.y);
    } else slots.push({ team: f.team, cxSum: f.cx, n: 1, yMin: f.y });
  }
  const out = slots
    .filter((s) => s.n >= 2)
    .map((s) => ({ team: s.team, cx: s.cxSum / s.n, labelTop: s.yMin }));
  return mirrorFill(out, W, H).sort((a, b) => a.cx - b.cx);
}

// Панель симметрична относительно центра экрана: портрет соперника стоит зеркально портрету
// союзника. Если на одной стороне плашка не нашлась (тусклая, перекрыта фоном), а хотя бы две
// там есть — достраиваем недостающие зеркально. Заодно выравниваем найденные неточно.
function mirrorFill(slots, W, H) {
  const mid = W / 2;
  const left = slots.filter((s) => s.cx < mid);
  const right = slots.filter((s) => s.cx >= mid);
  const tol = H * 0.02;
  const fill = (from, to) => {
    if (from.length < 3 || to.length < 2 || to.length >= from.length) return to;
    const team = to[0].team;
    const top = Math.round(to.reduce((a, s) => a + s.labelTop, 0) / to.length);
    return from.map((s) => {
      const cx = 2 * mid - s.cx;
      const hit = to.find((o) => Math.abs(o.cx - cx) < tol);
      return hit ? { ...hit, cx } : { team, cx, labelTop: top, guessed: true };
    });
  };
  if (left.length > right.length) return left.concat(fill(left, right));
  if (right.length > left.length) return fill(right, left).concat(right);
  return slots;
}

// Портреты стоят на фиксированных местах: 6 слева и 6 справа от центра экрана,
// первый — в 0,137 высоты экрана от центра, шаг — 0,0813 высоты (измерено на скриншотах
// 2560×1600 в матче и в паузе перед матчем). В паузе перед рейтинговой игрой плашек душ ещё нет
// (вместо них значки линий), поэтому там места берём из этой раскладки.
function layoutSlots(img) {
  const H = img.h;
  const mid = img.w / 2;
  const out = [];
  for (let i = 0; i < 6; i++) {
    const d = H * (0.137 + 0.0813 * i);
    out.push({ team: 'left', cx: mid - d, labelTop: Math.round(H * 0.09), layout: true });
    out.push({ team: 'right', cx: mid + d, labelTop: Math.round(H * 0.09), layout: true });
  }
  return out.sort((a, b) => a.cx - b.cx);
}

// Прямоугольник портрета над плашкой.
function slotBox(img, slot) {
  const H = img.h;
  const w = Math.round(H * 0.07);
  const h = Math.round(Math.min(slot.labelTop, H * 0.088));
  return { x: Math.round(slot.cx - w / 2), y: 0, w, h };
}

// Средний цвет области (x0..x1, y0..y1) в долях — для «моей» квадратной подложки.
function meanColor(img, box, fx0, fy0, fx1, fy1) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = Math.round(box.y + box.h * fy0); y < Math.round(box.y + box.h * fy1); y++) {
    for (let x = Math.round(box.x + box.w * fx0); x < Math.round(box.x + box.w * fx1); x++) {
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
      const p = px(img, x, y);
      r += p[0];
      g += p[1];
      b += p[2];
      n += 1;
    }
  }
  return n ? [r / n, g / n, b / n] : [0, 0, 0];
}

// Свой портрет стоит на квадратной подложке цвета команды: верхние углы окрашены.
function isOwnSlot(img, slot) {
  const box = slotBox(img, slot);
  const tl = meanColor(img, box, 0.62, 0.02, 0.98, 0.12);
  return !!brightTeamColor(...tl); // только яркий цвет: тусклые плашки соперников — не «я»
}

// Сетка GW×GH из центральной части портрета (по краям — значки «!»).
const INNER = { x0: 0.22, x1: 0.78, y0: 0.1, y1: 0.98 };

function gridFrom(img, box) {
  const out = new Float32Array(GW * GH * 3);
  const bx = box.x + box.w * INNER.x0;
  const by = box.y + box.h * INNER.y0;
  const bw = box.w * (INNER.x1 - INNER.x0);
  const bh = box.h * (INNER.y1 - INNER.y0);
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      const x0 = Math.floor(bx + (gx * bw) / GW);
      const x1 = Math.max(x0 + 1, Math.floor(bx + ((gx + 1) * bw) / GW));
      const y0 = Math.floor(by + (gy * bh) / GH);
      const y1 = Math.max(y0 + 1, Math.floor(by + ((gy + 1) * bh) / GH));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
          const i = (y * img.w + x) * 4;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          n += 1;
        }
      }
      const k = (gy * GW + gx) * 3;
      out[k] = n ? r / n : 0;
      out[k + 1] = n ? g / n : 0;
      out[k + 2] = n ? b / n : 0;
    }
  }
  return out;
}

// Признаки слота: сетка цветов центральной части портрета.
function slotFeature(img, slot) {
  return gridFrom(img, slotBox(img, slot));
}

// Контуры: перепады яркости по горизонтали и вертикали в каждой клетке сетки.
function gradGrid(g) {
  const L = new Float32Array(GW * GH);
  for (let i = 0; i < GW * GH; i++) L[i] = 0.3 * g[i * 3] + 0.59 * g[i * 3 + 1] + 0.11 * g[i * 3 + 2];
  const out = new Float32Array(GW * GH * 3);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      const xl = Math.max(0, x - 1);
      const xr = Math.min(GW - 1, x + 1);
      const yu = Math.max(0, y - 1);
      const yd = Math.min(GH - 1, y + 1);
      out[i * 3] = L[y * GW + xr] - L[y * GW + xl];
      out[i * 3 + 1] = L[yd * GW + x] - L[yu * GW + x];
    }
  }
  return out;
}

// Овал лица: цвет сравниваем только внутри него (по углам — фон).
const FACE = (() => {
  const m = new Uint8Array(GW * GH);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const u = ((x + 0.5) / GW - 0.5) / 0.5;
      const v = ((y + 0.5) / GH - 0.52) / 0.42;
      m[y * GW + x] = u * u + v * v <= 1 ? 1 : 0;
    }
  }
  return m;
})();

function andMask(a, b) {
  if (!a) return b;
  const m = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) m[i] = a[i] && b[i] ? 1 : 0;
  return m;
}

// Образец для сравнения из готовой сетки (выученный или встроенный портрет).
function sampleVariant(grid) {
  const g = grid instanceof Float32Array ? grid : Float32Array.from(grid);
  return { grid: g, mask: null, face: FACE, gr: gradGrid(g) };
}

// Нормированная корреляция двух сеток (по маске, если она есть). 1 — одинаковые.
function ncc(a, b, mask = null) {
  let n = 0;
  const ma = [0, 0, 0];
  const mb = [0, 0, 0];
  for (let i = 0; i < GW * GH; i++) {
    if (mask && !mask[i]) continue;
    n += 1;
    for (let c = 0; c < 3; c++) {
      ma[c] += a[i * 3 + c];
      mb[c] += b[i * 3 + c];
    }
  }
  if (n < GW * GH * 0.2) return -1;
  for (let c = 0; c < 3; c++) {
    ma[c] /= n;
    mb[c] /= n;
  }
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < GW * GH; i++) {
    if (mask && !mask[i]) continue;
    for (let c = 0; c < 3; c++) {
      const x = a[i * 3 + c] - ma[c];
      const y = b[i * 3 + c] - mb[c];
      sab += x * y;
      saa += x * x;
      sbb += y * y;
    }
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : -1;
}

// Образцы из картинки справочника (RGBA с прозрачностью): набор вариантов
// масштаба и сдвига, каждый — сетка + маска непрозрачных клеток.
function refVariants(ref, { scales = [0.85, 1, 1.15, 1.3], shifts = [-0.08, 0, 0.08], vshifts = [-0.1, 0, 0.1] } = {}) {
  const out = [];
  // «виртуальный слот» с соотношением сторон как у портрета в игре (0.07 : 0.088)
  const aspect = 0.07 / 0.088;
  for (const s of scales) {
    for (const dx of shifts) {
      for (const dy of vshifts) {
        // размер слота в пикселях картинки-образца: подгоняем ширину образца под s ширин слота
        const bw = ref.w / s;
        const bh = bw / aspect;
        const box = { x: (ref.w - bw) / 2 + dx * bw, y: (ref.h - bh) / 2 + dy * bh, w: bw, h: bh };
        const grid = new Float32Array(GW * GH * 3);
        const mask = new Uint8Array(GW * GH);
        const bx = box.x + box.w * INNER.x0;
        const by = box.y + box.h * INNER.y0;
        const iw = box.w * (INNER.x1 - INNER.x0);
        const ih = box.h * (INNER.y1 - INNER.y0);
        for (let gy = 0; gy < GH; gy++) {
          for (let gx = 0; gx < GW; gx++) {
            let r = 0;
            let g = 0;
            let b = 0;
            let n = 0;
            let opaque = 0;
            const x0 = Math.floor(bx + (gx * iw) / GW);
            const x1 = Math.max(x0 + 1, Math.floor(bx + ((gx + 1) * iw) / GW));
            const y0 = Math.floor(by + (gy * ih) / GH);
            const y1 = Math.max(y0 + 1, Math.floor(by + ((gy + 1) * ih) / GH));
            for (let y = y0; y < y1; y++) {
              for (let x = x0; x < x1; x++) {
                n += 1;
                if (x < 0 || y < 0 || x >= ref.w || y >= ref.h) continue;
                const i = (y * ref.w + x) * 4;
                if (ref.data[i + 3] < 200) continue;
                r += ref.data[i];
                g += ref.data[i + 1];
                b += ref.data[i + 2];
                opaque += 1;
              }
            }
            const k = gy * GW + gx;
            if (n && opaque / n > 0.8) {
              mask[k] = 1;
              grid[k * 3] = r / opaque;
              grid[k * 3 + 1] = g / opaque;
              grid[k * 3 + 2] = b / opaque;
            }
          }
        }
        out.push({ grid, mask, face: andMask(mask, FACE), gr: gradGrid(grid) });
      }
    }
  }
  return out;
}

// Признаки слота для сравнения: сетка цветов и контуры.
function slotFeatures(img, slot) {
  const g = slotFeature(img, slot);
  return { g, gr: gradGrid(g) };
}

function ensureVariant(v) {
  if (!v.gr) v.gr = gradGrid(v.grid);
  if (!v.face) v.face = andMask(v.mask, FACE);
  return v;
}

// Сырые оценки героя: лучший образец по цвету (в овале) и лучший по контурам.
function rawScores(f, hero) {
  let c = -1;
  let e = -1;
  // выученные портреты (сетки) — превращаем в образцы один раз
  if (hero.learned && hero.learned.length && (!hero._learnedV || hero._learnedV.src !== hero.learned)) {
    hero._learnedV = hero.learned.map(sampleVariant);
    hero._learnedV.src = hero.learned;
  }
  const all = (hero.variants || []).concat(hero.samples || [], (hero.learned && hero._learnedV) || []);
  for (const v0 of all) {
    const v = ensureVariant(v0);
    c = Math.max(c, ncc(f.g, v.grid, v.face));
    e = Math.max(e, ncc(f.gr, v.gr, v.mask));
  }
  return { c, e };
}

function zs(arr) {
  const m = arr.reduce((a, x) => a + x, 0) / arr.length;
  const sd = Math.sqrt(arr.reduce((a, x) => a + (x - m) ** 2, 0) / arr.length) || 1;
  return arr.map((x) => (x - m) / sd);
}

// Оценки всех героев для одного слота: среднее z-оценок по цвету и по контурам.
function slotScores(f, heroes) {
  const raw = heroes.map((h) => rawScores(f, h));
  const zc = zs(raw.map((r) => r.c));
  const ze = zs(raw.map((r) => r.e));
  return heroes.map((_, i) => (zc[i] + ze[i]) / 2);
}

// Совместимость: оценка одного героя (z-оценка среди всех не нужна — для отладки).
function scoreHero(f, hero) {
  const ff = f.g ? f : { g: f, gr: gradGrid(f) };
  const r = rawScores(ff, hero);
  return (r.c + r.e) / 2;
}

// Распределяем героев по слотам: каждый герой — не больше одного раза (жадно по уверенности).
// scores — для каждого слота массив оценок в порядке heroes (можно усреднить по нескольким кадрам).
function assignFromScores(scores, heroes) {
  const cand = [];
  scores.forEach((arr, si) => arr.forEach((s, hi) => cand.push({ si, id: heroes[hi].id, s })));
  const bySlot = scores.map((_, si) => cand.filter((c) => c.si === si).sort((a, b) => b.s - a.s));
  cand.sort((a, b) => b.s - a.s);
  const usedS = new Set();
  const usedH = new Set();
  const res = scores.map(() => null);
  for (const c of cand) {
    if (usedS.has(c.si) || usedH.has(c.id)) continue;
    usedS.add(c.si);
    usedH.add(c.id);
    const top = bySlot[c.si];
    const second = top.find((x) => x.id !== c.id);
    res[c.si] = { id: c.id, score: c.s, margin: second ? c.s - second.s : 9, top3: top.slice(0, 3).map((x) => ({ id: x.id, s: Math.round(x.s * 100) / 100 })) };
  }
  return res;
}

// features — признаки слотов (slotFeatures) или старые сетки.
function assignHeroes(features, heroes) {
  const fs = features.map((f) => (f && f.g ? f : { g: f, gr: gradGrid(f) }));
  return assignFromScores(fs.map((f) => slotScores(f, heroes)), heroes);
}

// Уверенность: насколько герой выделяется среди всех (z) и отрыв от второго места.
// Проверка на 24 портретах (пауза перед игрой и матч с полупрозрачными соперниками):
// верные — z 2,0–5,4 с отрывом 0,86–4,3; герои, которых нет в образцах, — отрыв до 0,6.
function confident(r) {
  return !!r && r.score >= 1.8 && r.margin >= 0.75;
}

module.exports = { GW, GH, teamColor, findSlots, layoutSlots, slotBox, isOwnSlot, slotFeature, slotFeatures, gridFrom, gradGrid, ncc, refVariants, sampleVariant, scoreHero, slotScores, assignFromScores, assignHeroes, confident };

}};M["pick"]={mod:{exports:{}},fn:function(module,exports){const require=req;'use strict';
// Совет по пику в паузе перед игрой: из твоих героев выбираем лучших против
// состава соперников, с учётом линии, союзников и того, кого не хватает команде.
//
// Оценка героя — это ожидаемый шанс победы:
//   50%
// + сила героя в патче (винрейт в матчах топового уровня за 2 недели, все игры deadlock-api) — 80%
// + твоя форма на этом герое (насколько ты на нём выигрываешь чаще своего обычного) — 20%
// + каждый соперник и союзник: поправка за конкретную пару сверх силы самих героев
// + состав: команде без танка или с перебором стрелков выигрывать тяжелее
//
// Проверено на ~2,5 млн пар за 2 недели (Фантом+): если учесть силу самих героев, конкретный
// матчап меняет шанс победы всего на ±0,5% (разброс), связка с союзником — ещё меньше,
// а «на одной линии» — практически не меняет. Поэтому пары стянуты к нулю очень сильно
// (по их реальному разбросу), а линия считается отдельно — по душам на 9-й минуте.

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

const MY_SHARE = 0.2; // доля твоих игр в совете
const META_SHARE = 1 - MY_SHARE;
// Сколько «нулевых» игр добавляем к паре: 0,25 / (реальный разброс эффекта пары)².
// Разброс измерен на данных: соперник ≈ 0,45%, напарник по линии ≈ 0,5%, союзник вообще ≈ 0.
const PAIR_PRIOR = { vs: 12000, lane: 12000, with: 20000, duo: 9000 };
const BASE_PRIOR = 300;
const COMFORT_PRIOR = 30; // твоя форма на герое: 30 «обычных» игр
const VS_CAP = 0.03; // один соперник — не больше ±3% к шансу
const ALLY_CAP = 0.02;
const WEAK_WR = 0.48; // ниже — «слабый в патче»
const STALE_DAYS = 30;
const LANE_SOULS = 250; // заметная разница душ на линии к 9-й минуте

// ---------- роли ----------
// Из справочника героев: brawler — танк, без типа или с меткой Support — поддержка,
// mystic — урон способностями, marksman/assassin — урон пулями.
function heroRole(asset) {
  if (!asset) return null;
  const tags = (asset.tags || []).map((t) => String(t).toLowerCase());
  if (asset.type === 'brawler') return 'tank';
  if (!asset.type || tags.includes('support')) return 'support';
  if (asset.type === 'mystic') return 'spirit';
  return 'gun';
}

const ROLE_NAMES = { tank: 'танк', support: 'поддержка', spirit: 'урон способностями', gun: 'урон пулями' };

// Состав команды и чего не хватает. Цифры — из 470 тыс. рейтинговых команд за неделю
// (с поправкой на силу самих героев): без танка −2%, четыре и больше стрелков −1,5%.
function teamComp(roles) {
  const c = { tank: 0, support: 0, spirit: 0, gun: 0 };
  for (const r of roles) if (r && r in c) c[r] += 1;
  const missing = [];
  if (!c.tank) missing.push('tank');
  if (!c.support) missing.push('support');
  return { counts: c, known: roles.filter(Boolean).length, missing, gunHeavy: c.gun >= 3 };
}

function compAdj(allyRoles, role) {
  const known = allyRoles.filter(Boolean);
  if (known.length < 3 || !role) return { d: 0, why: null };
  const c = teamComp(known).counts;
  if (!c.tank && role === 'tank') return { d: 0.02, why: 'tank' };
  if (c.gun >= 3 && role === 'gun') return { d: -0.015, why: 'gunHeavy' };
  return { d: 0, why: null };
}

// ---------- мета из deadlock-api ----------
// Сжимаем ответы /v1/analytics в таблицы { герой: { другой: [побед, игр] } }.
// laneSouls — строки { h, e, n, d }: на сколько душ герой h опережает соперника e на той же линии к 9-й минуте.
function buildPickMeta({ stats = [], counters = [], laneCounters = [], synergy = [], laneSynergy = [], laneSouls = [], badge = null, since = null } = {}) {
  const base = {};
  for (const r of stats) {
    const n = Number(r.matches) || 0;
    if (r.hero_id && n) base[r.hero_id] = [Number(r.wins) || 0, n];
  }
  const pairs = (rows) => {
    const out = {};
    for (const r of rows) {
      const n = Number(r.matches_played) || 0;
      if (!n) continue;
      (out[r.hero_id] = out[r.hero_id] || {})[r.enemy_hero_id] = [Number(r.wins) || 0, n];
    }
    return out;
  };
  const duo = (rows) => {
    const out = {};
    for (const r of rows) {
      const n = Number(r.matches_played) || 0;
      if (!n) continue;
      const v = [Number(r.wins) || 0, n];
      (out[r.hero_id1] = out[r.hero_id1] || {})[r.hero_id2] = v;
      (out[r.hero_id2] = out[r.hero_id2] || {})[r.hero_id1] = v;
    }
    return out;
  };
  const games = Object.values(base).reduce((s, x) => s + x[1], 0) / 12;
  const souls = {};
  for (const r of laneSouls || []) {
    const n = Number(r.n) || 0;
    if (n < 30 || !r.h || !r.e) continue;
    (souls[r.h] = souls[r.h] || {})[r.e] = [Math.round(Number(r.d) || 0), n];
  }
  return { v: 1, badge, since, games: Math.round(games), base, vs: pairs(counters), lane: pairs(laneCounters), with: duo(synergy), duo: duo(laneSynergy), souls };
}

// Души на линии против соперника к 9-й минуте (стянуто к нулю при малой выборке).
function laneSouls(pm, h, e) {
  const r = pm && pm.souls && pm.souls[h] && pm.souls[h][e];
  if (!r) return null;
  return { d: Math.round((r[0] * r[1]) / (r[1] + 60)), n: r[1] };
}

function baseWr(pm, id) {
  const b = pm && pm.base && pm.base[id];
  if (!b) return null;
  return (b[0] + 0.5 * BASE_PRIOR) / (b[1] + BASE_PRIOR);
}

// Насколько пара отличается от ожидаемого по силе двух героев.
// sign −1 — соперник (сильный соперник снижает ожидание), +1 — союзник.
function pairDelta(pm, table, a, b, sign) {
  const t = pm && pm[table] && pm[table][a];
  const r = t && t[b];
  if (!r) return null;
  const ba = baseWr(pm, a);
  const bb = baseWr(pm, b);
  if (ba === null || bb === null) return null;
  const exp = ba + sign * (bb - 0.5);
  return { d: (r[0] - r[1] * exp) / (r[1] + (PAIR_PRIOR[table] || 12000)), n: r[1] };
}

// Матчап против одного соперника: 80% мета + 20% твои игры.
function mixMatchup(r) {
  if (!r) return null;
  const hasPro = typeof r.pro === 'number';
  const hasMine = typeof r.mine === 'number';
  if (hasPro && hasMine) return META_SHARE * r.pro + MY_SHARE * r.mine;
  if (hasPro) return r.pro;
  if (hasMine) return MY_SHARE * r.mine; // меты нет — твоим играм всё равно не больше 20%
  return typeof r.delta === 'number' ? r.delta : null; // старые таблицы
}

// ---------- твои герои ----------
// Рейтинг пускает на героев с 15 победами в обычном режиме. История из API неполная
// (старые игры обрезаются), поэтому героя, на котором ты уже играл рейтинг, тоже считаем
// доступным. Из доступных показываем тех, на ком ты играешь последние 2 месяца.
const isRankedRow = (r) => r.match_mode === 4 || r.match_mode === 'Ranked';

function heroPool(historyRows, { minWins = 15, manual = null, now = Date.now() / 1000, activeDays = 60 } = {}) {
  const by = new Map();
  for (const r of historyRows || []) {
    const id = Number(r.hero_id);
    if (!id) continue;
    if (!by.has(id)) by.set(id, { hero_id: id, games: 0, wins: 0, stdWins: 0, ranked: 0, last: 0, recent: 0, recentWins: 0 });
    const x = by.get(id);
    x.games += 1;
    const won = typeof r.won === 'boolean' ? r.won : typeof r.match_result === 'number' ? r.match_result === r.player_team : false;
    if (won) x.wins += 1;
    if (isRankedRow(r)) x.ranked += 1;
    else if (won) x.stdWins += 1;
    const t = r.start_time || 0;
    x.last = Math.max(x.last, t);
    if (now - t < activeDays * 86400) {
      x.recent += 1;
      if (won) x.recentWins += 1;
    }
  }
  for (const x of by.values()) x.lastDays = x.last ? Math.floor((now - x.last) / 86400) : null;
  const all = [...by.values()].sort((a, b) => b.recent - a.recent || b.games - a.games);
  let pool;
  let inactive = [];
  if (Array.isArray(manual) && manual.length) {
    pool = manual.map((id) => by.get(Number(id)) || { hero_id: Number(id), games: 0, wins: 0, recent: 0, recentWins: 0, last: 0, lastDays: null });
  } else {
    // старые записи без режима: считаем победы всех игр
    const hasModes = all.some((x) => x.ranked > 0) || (historyRows || []).some((r) => r.match_mode !== undefined);
    const eligible = all.filter((x) => (hasModes ? x.stdWins : x.wins) >= minWins || x.ranked > 0);
    const active = eligible.filter((x) => x.recent >= 3);
    pool = active.length >= 3 ? active : eligible;
    inactive = eligible.filter((x) => !pool.includes(x));
    if (!pool.length) pool = all.filter((x) => x.games >= 5).slice(0, 8);
  }
  return { pool, all, inactive, manual: Array.isArray(manual) && manual.length > 0 };
}

// ---------- совет ----------
// pool — твои герои; tables — твои матчапы ({ vs, with } из heroOutlook, оттуда берём «mine»);
// pm — мета из buildPickMeta; roles — { heroId: роль }.
function pickAdvice({ pool, tables = {}, pm = null, enemies = [], allies = [], laneEnemies = [], partner = null, current = null, roles = {}, meta = {}, take = 5 }) {
  enemies = enemies.map(Number);
  allies = allies.map(Number);
  laneEnemies = laneEnemies.map(Number).filter((e) => enemies.includes(e));
  partner = partner && allies.includes(Number(partner)) ? Number(partner) : null;
  const taken = new Set([...enemies, ...allies]);
  const totalGames = pool.reduce((s, p) => s + (p.recent || p.games || 0), 0);
  const myBase = totalGames ? pool.reduce((s, p) => s + (p.recent ? p.recentWins : p.wins || 0), 0) / totalGames : 0.5;
  const allyRoles = allies.map((a) => roles[a] || null);
  const rows = [];
  for (const p of pool) {
    const hid = p.hero_id;
    const t = tables && tables[hid];
    // сила героя: мета 80% + твоя форма на нём 20%
    let metaWr = baseWr(pm, hid);
    if (metaWr === null && meta[hid] && meta[hid].games) metaWr = 0.5 + ((meta[hid].winrate - 0.5) * meta[hid].games) / (meta[hid].games + 30);
    const strength = metaWr === null ? 0 : metaWr - 0.5;
    const g = p.recent >= 5 ? p.recent : p.games || 0;
    const w = p.recent >= 5 ? p.recentWins : p.wins || 0;
    const comfort = g ? (w - g * myBase) / (g + COMFORT_PRIOR) : -0.01;
    const baseScore = META_SHARE * strength + MY_SHARE * comfort;
    // соперники
    // Твоих игр против одного соперника слишком мало, чтобы отличить эффект от случайности,
    // поэтому пары считаем по мете; твои 20% — это форма на герое (выше).
    const parts = enemies.map((e) => {
      const onLane = laneEnemies.includes(e);
      const m = pairDelta(pm, onLane ? 'lane' : 'vs', hid, e, -1) || pairDelta(pm, 'vs', hid, e, -1);
      const old = !pm && t && t.vs ? t.vs[e] : null; // нет меты — старые таблицы по скачанным матчам
      const d = m ? m.d : mixMatchup(old);
      const ls = laneSouls(pm, hid, e);
      return {
        hero_id: e,
        d: d === null ? 0 : clamp(d, -VS_CAP, VS_CAP),
        known: d !== null,
        lane: onLane,
        souls: ls ? ls.d : null,
        evidence: m ? m.n : old ? old.evidence : 0,
      };
    });
    const vsScore = parts.reduce((s, x) => s + x.d, 0);
    // союзники
    const mates = allies.filter((a) => a !== hid).map((a) => {
      const isPartner = a === partner;
      const m = (isPartner && pairDelta(pm, 'duo', hid, a, 1)) || pairDelta(pm, 'with', hid, a, 1);
      const d = m ? m.d : !pm && t && t.with ? mixMatchup(t.with[a]) : null;
      return { hero_id: a, d: d === null ? 0 : clamp(d, -ALLY_CAP, ALLY_CAP), known: d !== null, partner: isPartner };
    });
    const allyScore = mates.reduce((s, x) => s + x.d, 0);
    const role = roles[hid] || null;
    const comp = compAdj(allyRoles, role);
    const score = baseScore + vsScore + allyScore + comp.d;
    const chance = clamp(0.5 + score, 0.2, 0.8);
    const sorted = parts.filter((x) => x.known && Math.abs(x.d) >= 0.002).sort((a, b) => b.d - a.d);
    rows.push({
      hero_id: hid,
      score,
      chance,
      vsScore,
      allyScore,
      compD: comp.d,
      compWhy: comp.why,
      strength,
      metaWr,
      comfort,
      role,
      weak: metaWr !== null && metaWr < WEAK_WR,
      stale: p.lastDays !== null && p.lastDays !== undefined && p.lastDays > STALE_DAYS ? p.lastDays : null,
      games: p.games || 0,
      wins: p.wins || 0,
      recent: p.recent || 0,
      taken: taken.has(hid),
      known: parts.filter((x) => x.known).length,
      parts,
      mates: mates.filter((x) => x.known && x.d >= 0.002).sort((a, b) => b.d - a.d).slice(0, 2),
      matesBad: mates.filter((x) => x.known && x.d <= -0.002).sort((a, b) => a.d - b.d).slice(0, 1),
      lanes: parts.filter((x) => x.lane && x.souls !== null).map((x) => ({ hero_id: x.hero_id, souls: x.souls })),
      pros: sorted.filter((x) => x.d > 0).slice(0, 2),
      cons: sorted.filter((x) => x.d < 0).reverse().slice(0, 2),
      noTable: !t && !pm,
    });
  }
  rows.sort((a, b) => b.score - a.score);
  const free = rows.filter((r) => !r.taken);
  const best = free[0] || null;
  let verdict = null;
  const cur = current ? rows.find((r) => r.hero_id === Number(current)) : null;
  if (best && cur) {
    const gap = best.score - cur.score;
    if (best.hero_id === cur.hero_id || gap < 0.01) verdict = { keep: true, hero_id: cur.hero_id, gap: Math.max(0, gap) };
    else verdict = { keep: false, hero_id: best.hero_id, from: cur.hero_id, gap };
  }
  const comp = teamComp(allyRoles);
  return { rows: free.slice(0, take), all: rows, verdict, enemies: enemies.length, myBase, comp, laneEnemies, partner };
}

// План на игру для выбранного героя: кого опасаться, кто удобен, линия, предметы, связки.
// row — строка из pickAdvice; counters — { [enemyHeroId]: [{ id, lift }] }; leak — главная повторяющаяся ошибка.
function gamePlan({ row, counters = {}, leak = null, laneEnemies = [] }) {
  if (!row) return null;
  const known = (row.parts || []).filter((x) => x.known);
  const hard = known.filter((x) => x.d <= -0.003).sort((a, b) => a.d - b.d).slice(0, 2);
  const easy = known.filter((x) => x.d >= 0.003).sort((a, b) => b.d - a.d).slice(0, 2);
  // линия — по душам к 9-й минуте: отмечены соперники по линии — про них; иначе «если попадётся»
  const withLane = (row.parts || []).filter((x) => x.souls !== null && x.souls !== undefined);
  const laneSet = new Set(laneEnemies.map(Number));
  const pick = (x) => ({ hero_id: x.hero_id, souls: x.souls });
  const lane = laneSet.size
    ? { known: true, list: withLane.filter((x) => laneSet.has(x.hero_id)).map(pick) }
    : {
        known: false,
        hard: withLane.filter((x) => x.souls <= -LANE_SOULS).sort((a, b) => a.souls - b.souls).slice(0, 2).map(pick),
        easy: withLane.filter((x) => x.souls >= LANE_SOULS).sort((a, b) => b.souls - a.souls).slice(0, 2).map(pick),
      };
  // предметы-ответы: сначала против тяжёлых соперников, потом против остальных; без повторов
  const items = [];
  const seen = new Set();
  const order = hard.concat(known.filter((x) => !hard.includes(x)).sort((a, b) => a.d - b.d));
  for (const e of order) {
    for (const it of counters[e.hero_id] || []) {
      if (seen.has(it.id) || items.length >= 3) continue;
      seen.add(it.id);
      items.push({ id: it.id, lift: it.lift, vs: e.hero_id });
      break; // по одному предмету на соперника
    }
  }
  return { hero_id: row.hero_id, hard, easy, lane, items, mates: row.mates || [], matesBad: row.matesBad || [], leak };
}

module.exports = { heroPool, pickAdvice, gamePlan, mixMatchup, buildPickMeta, pairDelta, baseWr, laneSouls, heroRole, teamComp, compAdj, ROLE_NAMES, MY_SHARE, LANE_SOULS };

}};window.DC={};for(const m of ["stats","timeline","tipkit","meta","extract","features","leaks","portraits","pick"])window.DC[m]=req(m);return Object.keys(window.DC);})()