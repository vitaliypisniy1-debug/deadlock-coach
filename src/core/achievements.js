'use strict';
// Достижения — только за реальные измерения из твоих матчей и целей тренера.
// Не выдаются за победы, заходы в приложение и время «в игре». Игра без данных по показателю
// не засчитывается и не прерывает серию (мы просто не знаем, что в ней было).
// Даты и матчи выводятся из истории игр, поэтому достижения не «пропадают» при пересчёте:
// открытые ранее хранятся (prevUnlocked) и объединяются с новыми.

const TIERS = ['бронза', 'серебро', 'золото'];
const finite = (v) => v !== null && v !== undefined && Number.isFinite(v);

// Серия подряд: pred(game) → true / false / null (нет данных — игра пропускается).
const RUNS = [
  { key: 'solo_free', title: 'Без смертей в одиночку', thresholds: [3, 5, 8], unit: 'игр подряд', cond: (n) => `${n} игр подряд без смертей в одиночку после 10:00`, pred: (g) => (g.f && finite(g.f.soloDeaths) ? g.f.soloDeaths === 0 : null) },
  { key: 'calm_lane', title: 'Спокойная линия', thresholds: [5, 10, 15], unit: 'игр подряд', cond: (n) => `${n} игр подряд — не больше 1 смерти до 10:00`, pred: (g) => (g.f && finite(g.f.d10) ? g.f.d10 <= 1 : null) },
];
// Накопительные: счётчик по играм.
const COUNTS = [
  { key: 'rest_after_loss', title: 'Пауза после поражения', thresholds: [5, 15, 30], cond: (n) => `${n} раз после поражения подождал 10 минут и больше`, hit: (g) => (g.afterLoss && finite(g.gapMin) ? g.gapMin >= 10 : null) },
];
const RECORD_KEYS = [['lh10', 'крипов к 10:00'], ['soulsMid', 'душ в минуту в середине'], ['dmgMin', 'урона по героям в минуту'], ['bdmgMin', 'урона по объектам в минуту']];

const tierOf = (value, thresholds) => thresholds.filter((t) => value >= t).length;

function scanRun(def, games) {
  let run = 0;
  let best = 0;
  const reached = []; // для каждой ступени: игра, на которой серия впервые достигла порога
  for (const g of games) {
    const v = def.pred(g);
    if (v === null) continue;
    run = v ? run + 1 : 0;
    if (run > best) {
      best = run;
      def.thresholds.forEach((th, i) => { if (!reached[i] && best >= th) reached[i] = { t: g.start_time, matchId: g.match_id }; });
    }
  }
  return { value: best, current: run, reached };
}

function scanCount(def, games) {
  let n = 0;
  const reached = [];
  for (const g of games) {
    if (def.hit(g) === true) {
      n += 1;
      def.thresholds.forEach((th, i) => { if (!reached[i] && n >= th) reached[i] = { t: g.start_time, matchId: g.match_id }; });
    }
  }
  return { value: n, reached };
}

function item(def, scan, prev, now, seen) {
  const tier = Math.max(tierOf(scan.value, def.thresholds), ...def.thresholds.map((_, i) => (prev[`${def.key}:${i + 1}`] ? i + 1 : 0)));
  const unlocked = [];
  const next = {};
  for (let i = 0; i < tier; i++) {
    const old = prev[`${def.key}:${i + 1}`];
    const at = scan.reached[i] || old || { t: now, matchId: null };
    unlocked.push({ tier: i + 1, tierName: TIERS[i], t: at.t, matchId: at.matchId || null, isNew: seen ? !seen[`${def.key}:${i + 1}`] : !old });
    next[`${def.key}:${i + 1}`] = { t: (old || at).t, matchId: (old || at).matchId || null };
  }
  const nextThreshold = tier < def.thresholds.length ? def.thresholds[tier] : null;
  return {
    item: {
      key: def.key,
      title: def.title,
      cond: def.cond(nextThreshold || def.thresholds[def.thresholds.length - 1]),
      tier,
      tierName: tier ? TIERS[tier - 1] : null,
      value: scan.value,
      current: scan.current !== undefined ? scan.current : null,
      next: nextThreshold,
      thresholds: def.thresholds,
      unlocked,
    },
    unlockedMap: next,
  };
}

// Личные рекорды: на герое, где уже ≥5 игр с этим показателем, новое значение лучше прежнего максимума на 10%+.
function personalRecords(games) {
  const best = new Map();
  const events = [];
  for (const g of games) {
    if (!g.f) continue;
    for (const [key, label] of RECORD_KEYS) {
      const v = g.f[key];
      if (!finite(v)) continue;
      const k = `${g.hero}:${key}`;
      const rec = best.get(k) || { n: 0, max: null };
      if (rec.n >= 5 && rec.max !== null && rec.max > 0 && v >= rec.max * 1.1) events.push({ key, label, hero: g.hero, value: Math.round(v), before: Math.round(rec.max), t: g.start_time, matchId: g.match_id });
      best.set(k, { n: rec.n + 1, max: rec.max === null ? v : Math.max(rec.max, v) });
    }
  }
  return events.slice(-6).reverse();
}

/**
 * games — по возрастанию времени: [{ match_id, start_time, hero, f, afterLoss, gapMin }];
 * finished — выполненные цели тренера [{ title, doneAt }]; progress — результат progressView или null;
 * prevUnlocked — сохранённые открытия { 'ключ:ступень': { t, matchId } }; seen — что игрок уже видел (null — всё прежнее считается увиденным).
 */
function achievementsView({ games, finished = [], progress = null, prevUnlocked = {}, seen = null, now = Math.floor(Date.now() / 1000) }) {
  const prev = prevUnlocked || {};
  const items = [];
  let unlockedMap = {};
  const add = (def, scan) => {
    const r = item(def, scan, prev, now, seen);
    items.push(r.item);
    unlockedMap = { ...unlockedMap, ...r.unlockedMap };
  };
  // цели тренера
  const doneSorted = finished.filter((f) => f.doneAt).slice().sort((a, b) => a.doneAt - b.doneAt);
  const goalsDef = { key: 'goals_done', title: 'Закрытые цели', thresholds: [1, 3, 10], cond: (n) => `Закрыто целей тренера: ${n}` };
  add(goalsDef, { value: finished.length, reached: goalsDef.thresholds.map((th) => (doneSorted[th - 1] ? { t: doneSorted[th - 1].doneAt, matchId: null } : null)) });
  for (const def of RUNS) add(def, scanRun(def, games));
  for (const def of COUNTS) add(def, scanCount(def, games));
  // рост показателей: одновременно заметно выросло N показателей (только если динамика посчитана)
  if (progress && progress.enough) {
    const growthDef = { key: 'growth', title: 'Рост показателей', thresholds: [1, 3, 5], cond: (n) => `Заметно выросло показателей одновременно: ${n} (сравнение последних 15 игр с предыдущими 15)` };
    add(growthDef, { value: progress.better, reached: [] });
  }
  return { items, records: personalRecords(games), unlocked: unlockedMap, anyNew: items.some((i) => i.unlocked.some((u) => u.isNew)) };
}

module.exports = { achievementsView, personalRecords, TIERS, RUNS, COUNTS };
