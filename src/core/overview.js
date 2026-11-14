'use strict';
// Общий обзор игрока за период (3/7/14 дней): форма, главные цифры,
// сравнение с игроками твоего уровня и с топ-50, сессии, длина игр,
// герои, источники душ по фазам и советы.

const { median, quantile, mean, wilson } = require('./stats');
const { phaseSources, summarizePhase, averageRows, PHASES, TIPS } = require('./sources');
const { playerFeatures, refAll } = require('./features');
const { periodTips, basicsFor } = require('./tipsPeriod');
const { selectTips } = require('./tipkit');
const { isStandardMatch } = require('./meta');
const { RANKED_HERO_RULE } = require('./pick');
const { gameBadge } = require('./rank');

const DAY = 86400;
const SESSION_GAP = 60 * 60; // больше часа между играми — новая сессия

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fmt = (v) => (v === null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('ru-RU'));
const fmt1 = (v) => (v === null || !Number.isFinite(v) ? '—' : (Math.round(v * 10) / 10).toString().replace('.', ','));
const pctS = (v) => `${Math.round(v * 100)}%`;

// Строка истории матчей → компактная игра.
function gameFromHistory(m) {
  const won = typeof m.match_result === 'number' && typeof m.player_team === 'number' ? m.match_result === m.player_team : null;
  return {
    match_id: Number(m.match_id),
    start_time: Number(m.start_time) || 0,
    duration_s: num(m.match_duration_s) || 0,
    hero_id: Number(m.hero_id),
    won,
    k: num(m.player_kills) || 0,
    d: num(m.player_deaths) || 0,
    a: num(m.player_assists) || 0,
    nw: num(m.net_worth) || 0,
    lh: num(m.last_hits) || 0,
    dn: num(m.denies) || 0,
    team: typeof m.player_team === 'number' ? m.player_team : null,
    match_mode: m.match_mode ?? null,
    abandoned: !!(m.team_abandoned || m.abandoned_time_s),
    badge: Number(m.ranked_display_badge) || null,
    // в записи есть все три числа счёта (иначе 0/0/0 выглядело бы как настоящий счёт)
    kda_known: ['player_kills', 'player_deaths', 'player_assists'].every((k) => typeof m[k] === 'number' && Number.isFinite(m[k])),
  };
}

// Последний сыгранный матч для карточки на Главной: герой, результат и K/D/A берутся из ОДНОЙ записи.
// Ничего не выдумываем: нет записи — null; результат неизвестен — result: null; счёт неизвестен — kda: null.
function lastMatchSummary(games) {
  const ok = (g) => g && Number.isInteger(g.match_id) && g.match_id > 0 && Number.isFinite(g.start_time) && g.start_time > 0 && Number.isInteger(g.hero_id) && g.hero_id > 0;
  const g = (Array.isArray(games) ? games : []).filter(ok).sort((a, b) => a.start_time - b.start_time || a.match_id - b.match_id).at(-1);
  if (!g) return null;
  return {
    matchId: g.match_id, heroId: g.hero_id, startTime: g.start_time,
    result: g.won === true ? 'win' : g.won === false ? 'loss' : null,
    kda: g.kda_known ? { k: g.k, d: g.d, a: g.a } : null,
  };
}

function dashboardStats(history, now = Math.floor(Date.now() / 1000)) {
  const dayStart = (offset) => {
    const day = new Date(now * 1000);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + offset);
    return day.getTime() / 1000;
  };
  const byId = new Map();
  for (const row of history) {
    const g = gameFromHistory(row);
    if (!g.match_id || !g.start_time || g.start_time > now || !isStandardMatch(row)) continue;
    byId.set(g.match_id, { ...g, badge: Number(row.ranked_display_badge) || null });
  }
  const games = [...byId.values()].sort((a, b) => a.start_time - b.start_time || a.match_id - b.match_id);
  const from = dayStart(-6);
  const week = games.filter((g) => g.start_time >= from);
  const earlier = games.filter((g) => g.start_time >= dayStart(-36) && g.start_time < from);
  const counts = (rows) => {
    const wins = rows.filter((g) => g.won === true).length;
    const losses = rows.filter((g) => g.won === false).length;
    return { games: rows.length, wins, losses, unknown: rows.length - wins - losses, wr: wins + losses ? wins / (wins + losses) : null };
  };
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = dayStart(i - 6);
    const end = dayStart(i - 5);
    return { start, ...counts(week.filter((g) => g.start_time >= start && g.start_time < end)) };
  });
  const byHero = new Map();
  for (const g of week) {
    if (!g.hero_id) continue;
    if (!byHero.has(g.hero_id)) byHero.set(g.hero_id, []);
    byHero.get(g.hero_id).push(g);
  }
  const heroes = [...byHero].map(([heroId, rows]) => ({
    heroId, ...counts(rows),
    kda: median(rows.map((g) => (g.k + g.a) / Math.max(1, g.d))),
  })).sort((a, b) => b.games - a.games);
  const season = now >= RANKED_HERO_RULE.from && now < RANKED_HERO_RULE.until;
  const rankSince = season ? RANKED_HERO_RULE.from : now - 30 * DAY;
  const rank = games.filter((g) => g.start_time >= rankSince && g.match_mode === 4
    && Number.isInteger(g.badge) && g.badge >= 10 && g.badge < 120)
    .map(({ badge, start_time, match_id }) => ({ badge, time: start_time, matchId: match_id }));
  return { days, week: counts(week), baseline: counts(earlier), heroes, rank, season,
    latest: games.at(-1) || null, lastMatch: lastMatchSummary(games), hours: week.reduce((sum, g) => sum + g.duration_s, 0) / 3600 };
}

// Показатели одного игрока в одном матче (по подробным данным).
function playerMetrics(p, match) {
  const min = Math.max(1, (match.duration_s || 0) / 60);
  const last = p.stats && p.stats.length ? p.stats[p.stats.length - 1] : null;
  const teamKills = match.players.filter((x) => x.team === p.team).reduce((s, x) => s + (x.k || 0), 0);
  const shots = last ? last.hit + last.miss : 0;
  return {
    dmgMin: last ? last.pdmg / min : null,
    soulsMin: p.nw / min,
    acc: shots >= 80 ? last.hit / shots : null,
    kda: (p.k + p.a) / Math.max(1, p.d),
    kp: teamKills > 0 ? Math.min(1, (p.k + p.a) / teamKills) : null,
    lhMin: last ? (last.lh + last.nk) / min : p.lh / min,
    deaths: p.d,
  };
}

const METRICS = [
  { key: 'dmgMin', label: 'Урон по героям / мин', fmt },
  { key: 'soulsMin', label: 'Души / мин', fmt },
  { key: 'acc', label: 'Точность', fmt: (v) => (v === null ? '—' : pctS(v)) },
  { key: 'kda', label: 'KDA', fmt: fmt1 },
  { key: 'kp', label: 'Участие в убийствах', fmt: (v) => (v === null ? '—' : pctS(v)) },
  { key: 'lhMin', label: 'Крипы / мин', fmt: fmt1 },
  { key: 'deaths', label: 'Смерти за игру', fmt: fmt1, lowBetter: true },
];

// Где ты среди пула: доля пула, которая лучше тебя.
function placeAmong(me, pool, lowBetter) {
  const vals = pool.filter((v) => v !== null && Number.isFinite(v));
  if (me === null || vals.length < 8) return null;
  const better = vals.filter((v) => (lowBetter ? v < me : v > me)).length / vals.length;
  const worse = vals.filter((v) => (lowBetter ? v > me : v < me)).length / vals.length;
  // «Топ X%»: X — доля тех, кто не хуже (включая тебя). «Низ X%» — если ниже медианы.
  const top = better < 0.5;
  return {
    top,
    value: top ? Math.max(1, Math.round((better + (1 - better - worse) / 2) * 100)) : Math.max(1, Math.round((worse + (1 - better - worse) / 2) * 100)),
    better,
  };
}

function compareBlock(myRows, poolRows) {
  return METRICS.map((m) => {
    const mine = myRows.map((r) => r[m.key]).filter((v) => v !== null);
    const pool = poolRows.map((r) => r[m.key]).filter((v) => v !== null);
    const me = mine.length ? median(mine) : null;
    return {
      key: m.key,
      label: m.label,
      lowBetter: !!m.lowBetter,
      me,
      median: pool.length ? median(pool) : null,
      p25: pool.length ? quantile(pool, 0.25) : null,
      p75: pool.length ? quantile(pool, 0.75) : null,
      p05: pool.length ? quantile(pool, 0.05) : null,
      p95: pool.length ? quantile(pool, 0.95) : null,
      n: pool.length,
      place: placeAmong(me, pool, m.lowBetter),
      meText: m.fmt(me),
      medianText: m.fmt(pool.length ? median(pool) : null),
    };
  });
}

function summary(games) {
  const n = games.length;
  const decided = games.filter((g) => g.won !== null);
  const wins = decided.filter((g) => g.won).length;
  let best = 0;
  let cur = 0;
  for (const g of games) {
    if (g.won) {
      cur += 1;
      best = Math.max(best, cur);
    } else cur = 0;
  }
  // текущая серия (с конца)
  let streak = null;
  for (let i = games.length - 1; i >= 0; i--) {
    const g = games[i];
    if (g.won === null) continue;
    if (!streak) streak = { win: g.won, n: 1 };
    else if (g.won === streak.win) streak.n += 1;
    else break;
  }
  const minutes = games.reduce((s, g) => s + g.duration_s / 60, 0);
  const K = games.reduce((s, g) => s + g.k, 0);
  const D = games.reduce((s, g) => s + g.d, 0);
  const A = games.reduce((s, g) => s + g.a, 0);
  return {
    n,
    wins,
    losses: decided.length - wins,
    wr: decided.length ? wins / decided.length : null,
    hours: minutes / 60,
    heroes: new Set(games.map((g) => g.hero_id)).size,
    bestStreak: best,
    streak,
    kda: n ? (K + A) / Math.max(1, D) : null,
    soulsMin: minutes ? games.reduce((s, g) => s + g.nw, 0) / minutes : null,
    lhMin: minutes ? games.reduce((s, g) => s + g.lh, 0) / minutes : null,
    deaths: n ? D / n : null,
    avgMin: n ? minutes / n : null,
    lastPlayed: n ? games[games.length - 1].start_time + games[games.length - 1].duration_s : null,
  };
}

// Сессии: игры подряд с перерывом меньше часа. Позиция игры в сессии → винрейт.
function sessionStats(games) {
  const pos = [];
  let prevEnd = null;
  let p = 0;
  const sessions = [];
  for (const g of games) {
    if (prevEnd === null || g.start_time - prevEnd > SESSION_GAP) {
      p = 1;
      sessions.push(0);
    } else p += 1;
    sessions[sessions.length - 1] += 1;
    pos.push({ g, p });
    prevEnd = g.start_time + g.duration_s;
  }
  const buckets = [1, 2, 3, 4, 5, 6].map((k) => {
    const list = pos.filter((x) => (k === 6 ? x.p >= 6 : x.p === k) && x.g.won !== null);
    const w = list.filter((x) => x.g.won).length;
    return { pos: k, label: k === 6 ? '6+' : String(k), games: list.length, wins: w, wr: list.length ? w / list.length : null };
  });
  return { buckets, sessions: sessions.length, avgLen: sessions.length ? sessions.reduce((s, v) => s + v, 0) / sessions.length : 0 };
}

function durationStats(games) {
  const B = [
    { label: 'до 25 мин', from: 0, to: 25 },
    { label: '25–35', from: 25, to: 35 },
    { label: '35–45', from: 35, to: 45 },
    { label: '45+', from: 45, to: 999 },
  ];
  return B.map((b) => {
    const list = games.filter((g) => g.won !== null && g.duration_s / 60 >= b.from && g.duration_s / 60 < b.to);
    const w = list.filter((g) => g.won).length;
    return { ...b, games: list.length, wins: w, wr: list.length ? w / list.length : null };
  });
}

// Как ты играешь после поражения: винрейт следующей игры в той же сессии.
function afterLoss(games) {
  let afterL = 0;
  let afterLW = 0;
  let afterW = 0;
  let afterWW = 0;
  for (let i = 1; i < games.length; i++) {
    const a = games[i - 1];
    const b = games[i];
    if (a.won === null || b.won === null) continue;
    if (b.start_time - (a.start_time + a.duration_s) > SESSION_GAP) continue;
    if (a.won) {
      afterW += 1;
      if (b.won) afterWW += 1;
    } else {
      afterL += 1;
      if (b.won) afterLW += 1;
    }
  }
  return { afterLoss: afterL, afterLossWr: afterL ? afterLW / afterL : null, afterWin: afterW, afterWinWr: afterW ? afterWW / afterW : null };
}

function heroTable(games, details) {
  const by = new Map();
  for (const g of games) {
    if (!by.has(g.hero_id)) by.set(g.hero_id, []);
    by.get(g.hero_id).push(g);
  }
  return [...by.entries()]
    .map(([hero_id, list]) => {
      const s = summary(list);
      const dm = list.map((g) => details.get(g.match_id)).filter(Boolean).map((x) => x.metrics.dmgMin).filter((v) => v !== null);
      const ci = wilson(s.wins, s.wins + s.losses);
      return { hero_id, games: list.length, wins: s.wins, losses: s.losses, wr: s.wr, ci_lo: ci.lo, kda: s.kda, soulsMin: s.soulsMin, dmgMin: dm.length ? mean(dm) : null, last: Math.max(...list.map((g) => g.start_time)) };
    })
    .sort((a, b) => b.games - a.games || b.last - a.last);
}

// Ранг: средний значок команды в твоих матчах (badge = уровень*10 + ступень).
function rankFromBadges(badges) {
  const vals = badges.filter((b) => typeof b === 'number' && b > 0);
  if (!vals.length) return null;
  const avg = mean(vals);
  // переводим в «ступени», усредняем и обратно
  const steps = vals.map((b) => Math.floor(b / 10) * 6 + ((b % 10) - 1));
  const s = Math.round(mean(steps));
  const tier = Math.floor(s / 6);
  const sub = (s % 6) + 1;
  return { badge: tier * 10 + sub, tier, sub, avgRaw: avg, n: vals.length };
}

/**
 * history — строки /match-history (все), matches — Map(match_id → компактный матч),
 * accountId — твой аккаунт, topAccounts — Set аккаунтов топ-50, topMatches — матчи топов.
 */
function buildOverview({ history, matches, accountId, days = 7, now = Math.floor(Date.now() / 1000), topAccounts = new Set(), topMatches = [], assets = null }) {
  const all = history.map(gameFromHistory).filter((g) => g.start_time > 0).sort((a, b) => a.start_time - b.start_time);
  const from = now - days * DAY;
  const games = all.filter((g) => g.start_time >= from);
  const prevGames = all.filter((g) => g.start_time >= from - days * DAY && g.start_time < from);

  // Подробности по загруженным матчам
  const details = new Map();
  const lobbyRows = [];
  const lobbyFeat = [];
  const badges = [];
  for (const g of games) {
    const m = matches.get(g.match_id);
    if (!m) continue;
    const me = m.players.find((p) => p.account_id === accountId);
    if (!me) continue;
    const metrics = playerMetrics(me, m);
    const feat = { ...playerFeatures(me, m, assets), start: g.start_time, match_mode: g.match_mode };
    details.set(g.match_id, { match: m, me, metrics, feat });
    // значок команды из матча (в свежих рейтинговых матчах он 0), иначе собственный значок игрока из истории
    const rankBadge = gameBadge(m, me, g.badge);
    if (rankBadge) badges.push(rankBadge);
    for (const p of m.players) {
      if (p.account_id === accountId || p.abandoned) continue;
      lobbyRows.push(playerMetrics(p, m));
      lobbyFeat.push(playerFeatures(p, m, assets));
    }
  }
  const myRows = [...details.values()].map((d) => d.metrics);

  // Пул топ-50: их игры из сохранённых матчей топов
  const topRows = [];
  const topByHero = new Map();
  const topFeatByHero = new Map();
  for (const m of topMatches) {
    for (const p of m.players) {
      if (!topAccounts.has(p.account_id) || p.abandoned || !p.stats || p.stats.length < 3) continue;
      topRows.push(playerMetrics(p, m));
      if (!topByHero.has(p.hero_id)) topByHero.set(p.hero_id, []);
      topByHero.get(p.hero_id).push(p.stats);
      if (!topFeatByHero.has(p.hero_id)) topFeatByHero.set(p.hero_id, []);
      topFeatByHero.get(p.hero_id).push(playerFeatures(p, m, assets));
    }
  }

  // Источники душ по фазам: против лобби (все остальные в твоих матчах) и против топов на твоих героях
  const perPhase = { lobby: PHASES.map(() => []), top: PHASES.map(() => []) };
  for (const { match, me } of details.values()) {
    if (!me.stats || me.stats.length < 3) continue;
    const endMin = Math.floor(me.stats[me.stats.length - 1].t / 60);
    const others = match.players.filter((p) => p.account_id !== accountId && !p.abandoned && p.stats && p.stats.length >= 3).map((p) => p.stats);
    const tops = topByHero.get(me.hero_id) || [];
    PHASES.forEach((ph, i) => {
      const to = Math.min(ph.to, endMin);
      if (to - ph.from < 4) return;
      perPhase.lobby[i].push(phaseSources(me.stats, others, ph.from, to, { perTen: true, agg: mean }));
      if (tops.length >= 3) perPhase.top[i].push(phaseSources(me.stats, tops, ph.from, to, { perTen: true }));
    });
  }
  const sourcesFor = (key) =>
    PHASES.map((ph, i) => {
      const rows = averageRows(perPhase[key][i]);
      if (!rows) return { key: ph.key, name: ph.name, from: ph.from, to: ph.to, games: 0, rows: null };
      return { key: ph.key, name: ph.name, from: ph.from, to: ph.to, games: perPhase[key][i].length, rows, ...summarizePhase(rows, ph.key) };
    });
  const sources = { lobby: sourcesFor('lobby'), top: sourcesFor('top') };

  const sum = summary(games);
  const prev = prevGames.length ? summary(prevGames) : null;
  const sessions = sessionStats(games);
  const durations = durationStats(games);
  const tilt = afterLoss(games);
  const heroes = heroTable(games, details);
  const compare = { lobby: compareBlock(myRows, lobbyRows), top: compareBlock(myRows, topRows) };

  // Ряды по играм для плиток
  const series = {
    kda: games.map((g) => (g.k + g.a) / Math.max(1, g.d)),
    soulsMin: games.map((g) => (g.duration_s ? g.nw / (g.duration_s / 60) : null)),
    lhMin: games.map((g) => (g.duration_s ? g.lh / (g.duration_s / 60) : null)),
    deaths: games.map((g) => g.d),
  };
  const lobbyMed = (key) => {
    const v = lobbyRows.map((r) => r[key]).filter((x) => x !== null);
    return v.length >= 8 ? median(v) : null;
  };

  // Форма: скользящий винрейт
  const decided = games.filter((g) => g.won !== null);
  const w = decided.length >= 40 ? 10 : decided.length >= 16 ? 6 : decided.length >= 6 ? 4 : Math.max(1, decided.length);
  const form = {
    window: w,
    results: decided.map((g) => ({ won: g.won, hero_id: g.hero_id, match_id: g.match_id, t: g.start_time })),
    rolling: decided.map((_, i) => {
      const part = decided.slice(Math.max(0, i - w + 1), i + 1);
      return part.filter((g) => g.won).length / part.length;
    }),
    overall: sum.wr,
  };

  const out = {
    days,
    from,
    now,
    games: games.slice().reverse(),
    summary: sum,
    prev,
    form,
    series,
    lobbyMedian: { kda: lobbyMed('kda'), soulsMin: lobbyMed('soulsMin'), lhMin: null, deaths: lobbyMed('deaths') },
    rank: rankFromBadges(badges),
    loaded: details.size,
    missing: games.length - details.size,
    compare,
    lobbyN: lobbyRows.length,
    topN: topRows.length,
    sessions,
    durations,
    tilt,
    heroes,
    sources,
  };
  const srcMode = sources.top.some((p) => p.rows) ? 'top' : 'lobby';
  const topHero = new Map([...topFeatByHero.entries()].map(([h, list]) => [h, refAll(list)]));
  const ctx = {
    games,
    mine: [...details.values()].map((d) => d.feat),
    lobbyList: lobbyFeat,
    topHero,
    summary: sum,
    sessions,
    durations,
    tilt,
    heroes,
    compare: compare.lobby,
    sources: sources[srcMode],
    srcLabel: srcMode === 'top' ? 'топов на твоих героях' : 'игроков твоих матчей',
    days,
    heroName: (id) => (assets && assets.heroes && assets.heroes[id] ? assets.heroes[id].name : `герой ${id}`),
  };
  const found = selectTips(periodTips(ctx), { max: 10, maxPerArea: 2 });
  out.tips = found.concat(basicsFor(ctx, found));
  return out;
}

module.exports = { buildOverview, dashboardStats, lastMatchSummary, gameFromHistory, playerMetrics, METRICS, rankFromBadges, TIPS };
