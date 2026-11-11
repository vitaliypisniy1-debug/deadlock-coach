'use strict';
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
// Ranked Beta Season 2: анонс Valve от 05.11.2026, границы из ranked_seasons.vdata (билд 6860).
const RANKED_HERO_RULE = { threshold: 35, from: 1793908800, until: 1804802400 };

function heroPool(historyRows, { manual = null, now = Date.now() / 1000, activeDays = 60 } = {}) {
  const by = new Map();
  const seen = new Set();
  const empty = (hero_id) => ({ hero_id, games: 0, wins: 0, unlockPoints: 0, ranked: 0, last: 0, recent: 0, recentWins: 0, lastDays: null, rankedEvidence: 'unknown' });
  for (const r of historyRows || []) {
    const id = Number(r.hero_id);
    if (!id) continue;
    const matchId = Number(r.match_id);
    const identified = Number.isSafeInteger(matchId) && matchId > 0;
    if (identified) {
      if (seen.has(matchId)) continue;
      seen.add(matchId);
    }
    if (!by.has(id)) by.set(id, empty(id));
    const x = by.get(id);
    x.games += 1;
    const knownTeams = (r.match_result === 0 || r.match_result === 1) && (r.player_team === 0 || r.player_team === 1);
    const won = typeof r.won === 'boolean' ? r.won : knownTeams ? r.match_result === r.player_team : null;
    if (won === true) x.wins += 1;
    const t = Number(r.start_time) || 0;
    const normal = r.game_mode === 1 || r.game_mode === 'normal';
    if (identified && normal) {
      if (r.match_mode === 4 || r.match_mode === 'Ranked') x.ranked += 1;
      if ((r.match_mode === 1 || r.match_mode === 'Unranked') && t >= RANKED_HERO_RULE.from && t < RANKED_HERO_RULE.until && t <= now && won !== null) {
        x.unlockPoints += won ? 2 : 1;
      }
    }
    x.last = Math.max(x.last, t);
    if (t > 0 && t <= now && now - t < activeDays * 86400) {
      x.recent += 1;
      if (won === true) x.recentWins += 1;
    }
  }
  for (const x of by.values()) {
    x.lastDays = x.last ? Math.max(0, Math.floor((now - x.last) / 86400)) : null;
    if (x.unlockPoints >= RANKED_HERO_RULE.threshold) x.rankedEvidence = 'points';
    else if (x.ranked) x.rankedEvidence = 'played';
  }
  const all = [...by.values()].sort((a, b) => b.recent - a.recent || b.games - a.games);
  let pool;
  let inactive = [];
  if (Array.isArray(manual) && manual.length) {
    pool = manual.map((id) => by.get(Number(id)) || empty(Number(id)));
  } else {
    const candidates = all.filter((x) => x.rankedEvidence !== 'unknown');
    const active = candidates.filter((x) => x.recent >= 3);
    pool = active.length >= 3 ? active : candidates;
    inactive = candidates.filter((x) => !pool.includes(x));
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
  const hard = known.filter((x) => x.d <= -0.004).sort((a, b) => a.d - b.d).slice(0, 2);
  const easy = known.filter((x) => x.d >= 0.004).sort((a, b) => b.d - a.d).slice(0, 2);
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

module.exports = { heroPool, pickAdvice, gamePlan, mixMatchup, buildPickMeta, pairDelta, baseWr, laneSouls, heroRole, teamComp, compAdj, ROLE_NAMES, MY_SHARE, LANE_SOULS, RANKED_HERO_RULE };
