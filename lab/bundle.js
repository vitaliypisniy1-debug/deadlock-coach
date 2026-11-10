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

const SOURCE_FIELDS = ['g_lane', 'g_neutral', 'g_player', 'g_boss', 'g_treasure'];

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
  if (id === 12) return num(s.gold_source_breakable_gold);
  if (id === 8) return num(s.gold_source_team_bonus_gold);
  return 0;
}

// Постоянные бафы со статуй: [время, тип] по возрастанию времени.
function powerUps(p) {
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
    v: 2,
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

module.exports = { extractMatch, compactStat, extractPaths, extractDamage, goldSource, powerUps };

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
//   - души по источникам: коробки, лес, казино (Sinner's Sacrifice), потери при смерти;
//   - время подбора постоянных бафов со статуй.
//
// Цифры для сравнения: топы на твоём герое (ref) или, если их данных ещё нет,
// медианы по рангам из 640 тыс. рейтинговых игр (RANK_BENCH, deadlock-api, ноябрь 2026).

const { valueAt } = require('./timeline');
const { N, T, plural } = require('./tipkit');

// Медианы по рангу (average_badge // 10). Рейтинг, игры от 25 минут, 2 дня, 640 тыс. игроко-игр.
// brk — души с коробок, neu — души с леса, pu — статуи (постоянные бафы), nw — души всего.
const RANK_BENCH = {
  1: { brk9: 161, brk20: 886, neu9: 144, neu20: 1239, pu10: 1, pu20: 6, nw9: 5671, nw20: 16825 },
  2: { brk9: 232, brk20: 1145, neu9: 232, neu20: 1556, pu10: 1, pu20: 7, nw9: 5805, nw20: 17079 },
  3: { brk9: 301, brk20: 1412, neu9: 282, neu20: 1976, pu10: 2, pu20: 9, nw9: 5927, nw20: 17498 },
  4: { brk9: 382, brk20: 1701, neu9: 349, neu20: 2355, pu10: 3, pu20: 11, nw9: 6083, nw20: 18039 },
  5: { brk9: 459, brk20: 1921, neu9: 409, neu20: 2619, pu10: 3, pu20: 13, nw9: 6225, nw20: 18471 },
  6: { brk9: 515, brk20: 2057, neu9: 443, neu20: 2773, pu10: 4, pu20: 14, nw9: 6324, nw20: 18739 },
  7: { brk9: 546, brk20: 2114, neu9: 471, neu20: 2878, pu10: 4, pu20: 14, nw9: 6401, nw20: 18923 },
  8: { brk9: 579, brk20: 2158, neu9: 496, neu20: 2960, pu10: 5, pu20: 15, nw9: 6499, nw20: 19136 },
  9: { brk9: 617, brk20: 2211, neu9: 537, neu20: 3050, pu10: 5, pu20: 15, nw9: 6635, nw20: 19365 },
  10: { brk9: 669, brk20: 2225, neu9: 585, neu20: 3068, pu10: 6, pu20: 16, nw9: 6831, nw20: 19580 },
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
      if (allyDeaths < 1 || fight.deaths.some((d) => d.slot === me.slot)) continue;
      const pts = pathPoints(m, me.slot, fight.t0 - 15, fight.t1);
      if (!pts || !pts.length) continue;
      if (pts.some((q) => !q.p[2])) continue; // был мёртв — не в счёт
      const mask = pts.reduce((s, q) => s | (q.p[3] || 0), 0);
      if (mask & 1) continue; // дрался с героями — значит, участвовал
      const start = pts[0].p;
      const far = dist([start[0], start[1]], [fight.x, fight.y]);
      if (far < FIGHT_FAR) continue;
      const farming = mask & 6;
      if (!farming) continue;
      missed.push({ t: fight.t0, x: fight.x, y: fight.y, allyDeaths, enemyDeaths, far, jungle: !!(mask & 4), sec: Math.round(far / SPEED) });
    }
    const lostOnes = missed.filter((x) => x.allyDeaths > x.enemyDeaths);
    const allyDeathsTotal = missed.reduce((s, x) => s + x.allyDeaths, 0);
    if (lostOnes.length >= 2 || allyDeathsTotal >= 3) {
      const jungle = missed.filter((x) => x.jungle).length;
      out.push({
        key: 'farm_while_fight',
        area: 'Драки',
        level: lostOnes.length >= 2 ? 'bad' : 'warn',
        score: 55 + lostOnes.length * 10 + allyDeathsTotal * 2,
        title: jungle >= missed.length / 2 ? 'Бил лес, пока команда дралась' : 'Фармил, пока команда дралась',
        text: `${missed.length} ${plural(missed.length, 'раз', 'раза', 'раз')} после 10:00 команда дралась без тебя, а ты в это время фармил ${jungle ? 'лес' : 'крипов'}. ` +
          `В этих драках погибло ${allyDeathsTotal} ${plural(allyDeathsTotal, 'союзник', 'союзника', 'союзников')}, ${lostOnes.length} ${plural(lostOnes.length, 'драка проиграна', 'драки проиграны', 'драк проиграно')}.`,
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

  // ---------- 3. Тайминги карты: лес, коробки, статуи, казино ----------
  const timing = [];
  if (f.neu9 !== null && f.neu9 !== undefined && endS >= 600) {
    const b = benchFor('neu9', c.ref, c.tier);
    if (b.target && f.neu9 < b.target * 0.6 && b.target - f.neu9 >= 250) timing.push({ k: 'neu9', what: 'лес к 9:00', me: f.neu9, ...b, souls: b.target - f.neu9 });
  }
  if (f.brk20 !== null && f.brk20 !== undefined) {
    const b = benchFor('brk20', c.ref, c.tier);
    if (b.target && f.brk20 < b.target * 0.7 && b.target - f.brk20 >= 400) timing.push({ k: 'brk20', what: 'коробки к 20:00', me: f.brk20, ...b, souls: b.target - f.brk20 });
  } else if (f.brk9 !== null && f.brk9 !== undefined && endS >= 600) {
    const b = benchFor('brk9', c.ref, c.tier);
    if (b.target && f.brk9 < b.target * 0.6 && b.target - f.brk9 >= 200) timing.push({ k: 'brk9', what: 'коробки к 9:00', me: f.brk9, ...b, souls: b.target - f.brk9 });
  }
  if (f.pu10 !== null && f.pu10 !== undefined) {
    const b = benchFor('pu10', c.ref, c.tier);
    if (b.target && f.pu10 <= b.target - 3) timing.push({ k: 'pu10', what: 'статуй к 10:00', me: f.pu10, ...b, souls: 0, statues: b.target - f.pu10 });
  }
  if (f.pu20 !== null && f.pu20 !== undefined) {
    const b = benchFor('pu20', c.ref, c.tier);
    if (b.target && f.pu20 <= b.target - 5) timing.push({ k: 'pu20', what: 'статуй к 20:00', me: f.pu20, ...b, souls: 0, statues: b.target - f.pu20 });
  }
  if (timing.length) {
    const souls = timing.reduce((s, x) => s + x.souls, 0);
    const statues = Math.max(0, ...timing.map((x) => x.statues || 0));
    const fmt = (x) => (x.k.startsWith('pu') ? `${x.me} из ${x.target}` : `${N(x.me)} из ${N(x.target)} душ`);
    out.push({
      key: 'map_timings',
      area: 'Тайминги',
      level: souls >= 900 || statues >= 4 ? 'bad' : 'warn',
      score: 40 + Math.min(40, souls / 40) + statues * 4,
      title: 'Не забираешь то, что лежит на карте',
      text: timing.map((x) => `${x.what}: ${fmt(x)}`).join('; ') + `. Ориентир — ${timing.some((x) => x.fromTops) ? 'топы на этом герое' : 'игроки высокого ранга'}.` +
        (souls ? ` Это ${N(souls)} душ, которые просто остались на карте.` : '') +
        (statues ? ` И ${statues} ${plural(statues, 'постоянный баф', 'постоянных бафа', 'постоянных бафов')} со статуй — это здоровье, урон и скорость стрельбы до конца игры.` : ''),
      fix: [
        'Когда волна ушла к врагу и до следующей есть время — ломай коробки и статуи рядом с линией, а не стой у башни.',
        'Лесной лагерь рядом с линией бери, как только он появился: пока ждёшь волну, это бесплатные души.',
        'Идёшь с базы или на другую линию — веди маршрут через коробки и статуи по пути.',
      ],
      moments: [],
      cost: { souls, statues },
      facts: timing,
    });
  }
  if (f.tre20 === 0 && endS >= 1500) {
    out.push({
      key: 'sinner',
      area: 'Тайминги',
      level: 'warn',
      score: 22,
      title: 'Не брал казино (Sinner’s Sacrifice)',
      text: 'За первые 20 минут ты ни разу не забрал Sinner’s Sacrifice. Он появляется на 10:00 и потом каждые 5 минут, даёт около 330 душ и золотую урну с постоянным бафом.',
      fix: ['На 10:00, 15:00 и 20:00 смотри, не стоит ли машина рядом с тобой: бить можно только ближним боем, это занимает несколько секунд.'],
      moments: [],
      cost: { souls: 330 },
    });
  }

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
        text: `${losses.length} ${plural(losses.length, 'смерть стоила', 'смерти стоили', 'смертей стоили')} тебе ${N(total)} душ — их ты не успел сохранить.` +
          (ref ? ` У топов на этом герое одна смерть в среднем стоит ${N(ref)} душ.` : ''),
        fix: [
          'Свежие души сначала «несохранённые»: умрёшь — часть пропадёт. После крупного фарма не лезь сразу в рискованную драку.',
          'Накопил на предмет — вернись и купи, а потом иди драться: потраченные души потерять нельзя.',
          'Видишь, что драка проиграна, — отступай раньше: смерть с полным карманом стоит вдвое дороже.',
        ],
        moments: losses.map((x) => ({ t: x.t, text: `умер и потерял ${N(x.lost)} душ` })),
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
      text: `${rich.length} ${plural(rich.length, 'раз', 'раза', 'раз')} ты погиб, имея в кармане ${N(Math.max(...rich.map((d) => d.free)))}+ непотраченных душ — это готовый предмет, который не участвовал в драке.`,
      fix: ['Перед дракой или объектом проверь души: хватает на предмет — купи (магазин у линии ближе, чем кажется).'],
      moments: rich.map((d) => ({ t: d.t, x: d.x, y: d.y, text: `умер с ${N(d.free)} душ в кармане` })),
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
      out.push({
        key: 'counter_missing',
        area: 'Предметы',
        level: 'warn',
        score: 38 + top.kills * 5,
        title: `Не было ответа на ${heroName(top.hero)}`,
        text: `${heroName(top.hero)} ${top.kills ? `убил тебя ${top.kills} ${plural(top.kills, 'раз', 'раза', 'раз')}` : ''}${top.kills && top.share >= 0.3 ? ' и ' : ''}${top.share >= 0.3 ? `нанёс ${Math.round(top.share * 100)}% всего урона по тебе` : ''}. ` +
          `Против него топы заметно чаще берут: ${top.items.map((x) => `${itemName(x.id)} (в ${x.lift.toFixed(1).replace('.', ',')} раза чаще)`).join(', ')}. У тебя этого не было.`,
        fix: [`Когда видишь ${heroName(top.hero)} у соперников — заранее впиши в сборку один из этих предметов.`],
        moments: [],
        cost: {},
        facts: misses,
      });
    }
  }

  return out.sort((a, b) => b.score - a.score);
}

// Что топы чаще берут против каждого героя. records: [{ match, player }] — игры топового уровня.
// lift = доля игр с предметом, когда герой у соперников / доля без него.
function counterItems(records, { minBuys = 12, minRate = 0.1, minLift = 1.35, perHero = 4, isItem = () => true } = {}) {
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

// Общая картина по играм: что повторяется, сколько стоит, как связано с победой.
// games: [{ match_id, start_time, won, hero, leaks: [...] }]
function leakProfile(games) {
  const by = new Map();
  const counted = games.filter((g) => Array.isArray(g.leaks));
  for (const g of counted) {
    for (const l of g.leaks) {
      if (l.level === 'good') continue;
      let e = by.get(l.key);
      if (!e) by.set(l.key, (e = { key: l.key, area: l.area, title: l.title, fix: l.fix, games: [], souls: 0, deaths: 0, allyDeaths: 0, statues: 0, score: 0 }));
      e.games.push({ match_id: g.match_id, start_time: g.start_time, won: g.won, hero: g.hero, title: l.title, text: l.text, moments: (l.moments || []).slice(0, 4), score: l.score });
      e.souls += (l.cost && l.cost.souls) || 0;
      e.deaths += (l.cost && l.cost.deaths) || 0;
      e.allyDeaths += (l.cost && l.cost.allyDeaths) || 0;
      e.statues += (l.cost && l.cost.statues) || 0;
      e.score += l.score;
      if (l.fix && l.fix.length > (e.fix || []).length) e.fix = l.fix;
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
      // важность: как часто × насколько серьёзно
      impact: (e.games.length / Math.max(1, n)) * (e.score / e.games.length),
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

module.exports = { gameLeaks, leakProfile, counterItems, findFights, lossPerDeath, unspentAt, winLink, benchFor, RANK_BENCH, WIN_LINKS, FIGHT_FAR, SPEED };

}};window.DC={};for(const m of ["stats","timeline","tipkit","meta","extract","features","leaks"])window.DC[m]=req(m);return Object.keys(window.DC);})()