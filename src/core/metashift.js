'use strict';
// Мета героев по готовой статистике Deadlock API: окно данных, порог выборки,
// сдвиг к прошлому окну, баны, последние игры топа по герою.
// Чистые расчёты без сети и файлов: данные приходят готовыми строками API.
//
// Что здесь измеряется (и чем не является):
//  - винрейт и пикрейт — статистика выборки матчей, а не «сила героя»;
//  - сдвиг — разница двух окон; причину (патч, баны, мода) из статистики не вывести;
//  - тир-листа нет: у героя есть статус выборки и интервал.

const { wilson } = require('./stats');

const DAY = 86400;

const THRESHOLDS = {
  windowDays: 14,
  // игр героя в окне: меньше low — «мало данных», до ok — «ориентир», от ok — «достаточно»
  low: 300,
  ok: 1000,
  // сдвиг винрейта: интервал разницы на уровне 99% не включает 0 и разница не меньше 1 п.п.
  z: 2.576,
  shiftWr: 0.01,
  // сдвиг пикрейта: значимая разница и герой берётся чаще/реже минимум на четверть (доли в сумме дают 100%, мелкие
  // перекосы есть у десятков героев сразу — они не показатель)
  shiftPickRel: 0.25,
  // баны
  banCoverageMin: 0.3,
  banMinDays: 3,
  banDayMinMatches: 200,
  banRuleTolerance: 0.05,
  banShift: 0.02,
};

function sampleStatus(n, t = THRESHOLDS) {
  if (!(n >= t.low)) return 'low';
  if (n < t.ok) return 'orient';
  return 'ok';
}

const dayStart = (ts) => Math.floor(ts / DAY) * DAY;

// Окна — полные сутки по UTC, текущие сутки не берём (они неполные и занижают выборку).
// `to` не включается.
function windows(nowSec, days = THRESHOLDS.windowDays) {
  const end = dayStart(nowSec);
  return {
    days,
    cur: { from: end - days * DAY, to: end },
    prev: { from: end - 2 * days * DAY, to: end - days * DAY },
  };
}

// Разница двух долей и её интервал на уровне z.
function diffInterval(w1, n1, w0, n0, z = THRESHOLDS.z) {
  const p1 = w1 / n1;
  const p0 = w0 / n0;
  const se = Math.sqrt((p1 * (1 - p1)) / n1 + (p0 * (1 - p0)) / n0);
  const d = p1 - p0;
  return { d, se, lo: d - z * se, hi: d + z * se, z: se > 0 ? d / se : 0 };
}

function verdictOf(iv, minAbs) {
  if (iv.lo > 0 && iv.d >= minAbs) return 'up';
  if (iv.hi < 0 && iv.d <= -minAbs) return 'down';
  return 'noise';
}

// Суммы по героям за окно из строк API с суточными корзинами.
function sumByHero(rows, win) {
  const m = new Map();
  for (const r of rows || []) {
    if (r.bucket < win.from || r.bucket >= win.to) continue;
    const e = m.get(r.hero_id) || { wins: 0, matches: 0 };
    e.wins += Number(r.wins) || 0;
    e.matches += Number(r.matches) || 0;
    m.set(r.hero_id, e);
  }
  return m;
}

function perDayTotals(rows, win) {
  const m = new Map();
  for (const r of rows || []) {
    if (r.bucket < win.from || r.bucket >= win.to) continue;
    m.set(r.bucket, (m.get(r.bucket) || 0) + (Number(r.matches) || 0));
  }
  return m; // сутки → игр героев (матчей ≈ /12)
}

// Баны по суткам. Число банов на матч менялось (3 → 4 в Beta Season 2), поэтому берём только
// последнюю непрерывную серию суток с тем же числом банов на матч, что и у самых свежих суток.
function banDays(rows, win, t = THRESHOLDS) {
  const days = new Map();
  for (const r of rows || []) {
    if (r.bucket < win.from || r.bucket >= win.to) continue;
    const d = days.get(r.bucket) || { bucket: r.bucket, bans: 0, matches: 0, byHero: new Map() };
    d.matches = Math.max(d.matches, Number(r.matches) || 0);
    d.bans += Number(r.bans) || 0;
    d.byHero.set(r.hero_id, (d.byHero.get(r.hero_id) || 0) + (Number(r.bans) || 0));
    days.set(r.bucket, d);
  }
  const list = [...days.values()].filter((d) => d.matches >= t.banDayMinMatches).sort((a, b) => b.bucket - a.bucket);
  for (const d of list) d.perMatch = d.bans / d.matches;
  return list; // от свежих к старым
}

function banRun(list, refPerMatch, t = THRESHOLDS) {
  const run = [];
  let expect = null;
  for (const d of list) {
    if (Math.abs(d.perMatch - refPerMatch) > t.banRuleTolerance * refPerMatch) break;
    if (expect !== null && expect - d.bucket !== DAY) break; // пропуск суток — серия кончилась
    run.push(d);
    expect = d.bucket;
  }
  return run;
}

function sumBans(run) {
  const byHero = new Map();
  let matches = 0;
  let bans = 0;
  for (const d of run) {
    matches += d.matches;
    bans += d.bans;
    for (const [h, b] of d.byHero) byHero.set(h, (byHero.get(h) || 0) + b);
  }
  return { byHero, matches, bans, perMatch: matches ? bans / matches : 0 };
}

function banBlock({ banRows, heroRows, win, thr }) {
  if (!banRows || !banRows.length) return { available: false, reason: 'Deadlock API не вернул статистику банов.' };
  const curList = banDays(banRows, win.cur, thr);
  if (!curList.length) return { available: false, reason: 'За окно нет суток с достаточным числом матчей с данными о банах.' };
  const ref = curList[0].perMatch;
  const run = banRun(curList, ref, thr);
  if (run.length < thr.banMinDays) {
    return { available: false, reason: `Правило банов менялось недавно: меньше ${thr.banMinDays} суток подряд с одинаковым числом банов на матч.` };
  }
  const cur = sumBans(run);
  const totals = perDayTotals(heroRows, win.cur);
  const heroMatches = run.reduce((s, d) => s + (totals.get(d.bucket) || 0) / 12, 0);
  const coverage = heroMatches ? Math.min(1, cur.matches / heroMatches) : null;
  if (coverage !== null && coverage < thr.banCoverageMin) {
    return { available: false, reason: `Данные о банах есть только у ${Math.round(coverage * 100)}% матчей — меньше порога ${Math.round(thr.banCoverageMin * 100)}%.`, coverage };
  }
  // прошлое окно: берём сутки с тем же числом банов на матч
  const prevList = banDays(banRows, win.prev, thr).filter((d) => Math.abs(d.perMatch - ref) <= thr.banRuleTolerance * ref);
  const prev = prevList.length >= thr.banMinDays ? sumBans(prevList) : null;
  return {
    available: true,
    from: run[run.length - 1].bucket,
    to: run[0].bucket + DAY,
    days: run.length,
    matches: cur.matches,
    perMatch: cur.perMatch,
    coverage,
    shiftAvailable: !!prev,
    shiftReason: prev ? null : 'В прошлом окне другое число банов на матч (правило поменялось) — сравнивать доли нельзя.',
    byHero: cur.byHero,
    prev,
  };
}

// Главный расчёт. heroRows — строки hero-stats с корзинами по суткам (за оба окна),
// banRows — строки hero-ban-stats по суткам, patches — [{pub_date, title}].
function buildHeroMeta({ heroRows, banRows = null, patches = [], now, thresholds = THRESHOLDS }) {
  const thr = thresholds;
  const win = windows(now, thr.windowDays);
  const cur = sumByHero(heroRows, win.cur);
  const prev = sumByHero(heroRows, win.prev);
  const sum = (m) => [...m.values()].reduce((s, e) => s + e.matches, 0);
  const curPicks = sum(cur);
  const prevPicks = sum(prev);
  const bans = banBlock({ banRows, heroRows, win, thr });

  const heroes = [];
  for (const [hero_id, e] of cur) {
    if (!e.matches) continue;
    const ci = wilson(e.wins, e.matches);
    const p = prev.get(hero_id) || null;
    const pickShare = e.matches / curPicks;
    const row = {
      hero_id,
      games: e.matches,
      wins: e.wins,
      winrate: e.wins / e.matches,
      ci_lo: ci.lo,
      ci_hi: ci.hi,
      pick_share: pickShare,
      status: sampleStatus(e.matches, thr),
      prev: p ? { games: p.matches, winrate: p.matches ? p.wins / p.matches : null, pick_share: prevPicks ? p.matches / prevPicks : null } : null,
      wrShift: { verdict: 'nodata' },
      pickShift: { verdict: 'nodata' },
      ban: null,
    };
    const both = p && e.matches >= thr.ok && p.matches >= thr.ok;
    if (both) {
      const iv = diffInterval(e.wins, e.matches, p.wins, p.matches, thr.z);
      row.wrShift = { d: iv.d, lo: iv.lo, hi: iv.hi, verdict: verdictOf(iv, thr.shiftWr) };
      // доля пиков: сколько всех выбранных героев приходилось на этого
      const iv2 = diffInterval(e.matches, curPicks, p.matches, prevPicks, thr.z);
      const rel = p.matches / prevPicks > 0 ? iv2.d / (p.matches / prevPicks) : null;
      let v = 'noise';
      if (iv2.lo > 0 && rel !== null && rel >= thr.shiftPickRel) v = 'up';
      else if (iv2.hi < 0 && rel !== null && rel <= -thr.shiftPickRel) v = 'down';
      row.pickShift = { d: iv2.d, rel, verdict: v };
    }
    if (bans.available) {
      const b = bans.byHero.get(hero_id) || 0;
      const bci = wilson(b, bans.matches);
      const ban = { bans: b, rate: b / bans.matches, ci_lo: bci.lo, ci_hi: bci.hi, shift: null };
      if (bans.shiftAvailable) {
        const pb = bans.prev.byHero.get(hero_id) || 0;
        const iv3 = diffInterval(b, bans.matches, pb, bans.prev.matches, thr.z);
        ban.shift = { d: iv3.d, lo: iv3.lo, hi: iv3.hi, verdict: verdictOf(iv3, thr.banShift) };
      }
      row.ban = ban;
    }
    heroes.push(row);
  }
  heroes.sort((a, b) => b.games - a.games);

  const inWindow = (patches || [])
    .map((p) => ({ ts: Math.floor(Date.parse(p.pub_date) / 1000), title: String(p.title || '').trim() }))
    .filter((p) => p.ts >= win.prev.from && p.ts < now + DAY && p.title)
    .map((p) => ({ ts: p.ts, title: p.title, window: p.ts >= win.cur.from ? 'cur' : 'prev' }))
    .sort((a, b) => a.ts - b.ts);

  const lowCount = heroes.filter((h) => h.status === 'low').length;
  return {
    v: 1,
    windows: win,
    thresholds: { low: thr.low, ok: thr.ok, z: thr.z, shiftWr: thr.shiftWr, shiftPickRel: thr.shiftPickRel },
    matches: { cur: Math.round(curPicks / 12), prev: Math.round(prevPicks / 12) },
    picks: { cur: curPicks, prev: prevPicks },
    heroes,
    lowCount,
    bans: bans.available
      ? { available: true, from: bans.from, to: bans.to, days: bans.days, matches: bans.matches, perMatch: bans.perMatch, coverage: bans.coverage, shiftAvailable: bans.shiftAvailable, shiftReason: bans.shiftReason }
      : { available: false, reason: bans.reason, coverage: bans.coverage === undefined ? null : bans.coverage },
    patches: inWindow,
  };
}

// ---------- последние игры топа по герою ----------

function parseStart(v) {
  if (typeof v === 'number') return v;
  const t = Date.parse(String(v).includes('T') ? String(v) : `${String(v).replace(' ', 'T')}Z`);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

// matches — ответ /v1/matches/metadata c only_filtered_players; accounts — Map(accountId → {name, rank}).
function topHeroGames({ matches, accounts, heroId, now, days = 14 }) {
  const since = now - days * DAY;
  const games = [];
  for (const m of matches || []) {
    const start = parseStart(m.start_time);
    if (start === null || start < since) continue;
    for (const p of m.players || []) {
      if (p.hero_id !== heroId || !accounts.has(p.account_id)) continue;
      const a = accounts.get(p.account_id);
      games.push({
        match_id: m.match_id,
        start_time: start,
        duration_s: m.duration_s || null,
        account_id: p.account_id,
        name: a.name,
        rank: a.rank,
        hero_id: p.hero_id,
        won: !!m.winning_team && p.team === m.winning_team,
        k: p.kills ?? null,
        d: p.deaths ?? null,
        a: p.assists ?? null,
        nw: p.net_worth ?? null,
        avg_badge: m.average_badge || null,
        match_mode: m.match_mode || null,
      });
    }
  }
  games.sort((x, y) => y.start_time - x.start_time);
  const wins = games.filter((g) => g.won).length;
  const ci = wilson(wins, games.length);
  return {
    heroId,
    days,
    games,
    summary: {
      games: games.length,
      wins,
      winrate: games.length ? wins / games.length : null,
      ci_lo: ci.lo,
      ci_hi: ci.hi,
      players: new Set(games.map((g) => g.account_id)).size,
      status: sampleStatus(games.length),
    },
  };
}

// Игроки топ-ладдера, чей аккаунт определяется однозначно (один возможный аккаунт
// или ручная привязка). Остальных не берём: чужие игры нельзя выдавать за игры топа.
function ladderAccounts(entries, overrides = {}, cap = 300) {
  const list = (entries || [])
    .map((e, i) => ({ ...e, rank: Number(e.rank) || i + 1 }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, cap);
  const accounts = new Map();
  for (const e of list) {
    const name = e.account_name || e.name || `#${e.rank}`;
    const ids = (e.possible_account_ids || (e.account_id ? [e.account_id] : [])).map(Number).filter(Boolean);
    const id = overrides[name] ? Number(overrides[name]) : ids.length === 1 ? ids[0] : null;
    if (id && !accounts.has(id)) accounts.set(id, { name, rank: e.rank });
  }
  return { accounts, entries: list.length, resolved: accounts.size, cap };
}

module.exports = { THRESHOLDS, DAY, sampleStatus, windows, diffInterval, buildHeroMeta, banDays, banRun, topHeroGames, ladderAccounts, parseStart };
