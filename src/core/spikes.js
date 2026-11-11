'use strict';
// Паверспайки: после каких предметов игрок резко поднимает урон по героям.

const { median } = require('./stats');
const { rate } = require('./timeline');
const { firstPurchases } = require('./meta');

const WINDOW = 180; // 3 минуты до и после покупки

// Насколько вырос темп урона после момента t относительно темпа до t.
// +50 к обеим частям, чтобы не делить на ноль в тихие минуты.
function dmgRatio(stats, t) {
  const before = rate(stats, 'pdmg', t - WINDOW, t);
  const after = rate(stats, 'pdmg', t, t + WINDOW);
  if (!Number.isFinite(before) || !Number.isFinite(after) || before < 0 || after < 0) return null;
  return (after + 50) / (before + 50);
}

// Скачок темпа урона в момент t относительно обычного роста у этого же игрока.
// Урон по героям и так растёт по ходу игры, поэтому сравниваем рост в момент t
// с ростом за 3 минуты до и через 3 минуты после (местный тренд игрока).
// Сравнивать с другими игроками в ту же минуту нельзя: ключевой предмет
// топы покупают почти одновременно, и всплеск спрятался бы в "норме".
function localLift(stats, t) {
  const r = dmgRatio(stats, t);
  if (r === null) return null;
  const prev = dmgRatio(stats, t - WINDOW);
  const next = dmgRatio(stats, t + WINDOW);
  const around = [prev, next].filter((v) => v !== null);
  if (!around.length) return null;
  const trend = Math.exp(around.reduce((s, v) => s + Math.log(v), 0) / around.length);
  return r / trend;
}

function participationAfter(stats, t) {
  const end = t + WINDOW;
  const innerStart = stats.find((s) => s.t >= t);
  const innerEnd = stats.findLast((s) => s.t <= end);
  const outerStart = stats.findLast((s) => s.t <= t);
  const outerEnd = stats.find((s) => s.t >= end);
  const delta = (a, b) => a && b && a.t <= b.t ? (b.k + b.a) - (a.k + a.a) : NaN;
  // Только целые снимки подтверждают событие. Изменение на границе
  // окна могло произойти с любой стороны границы.
  if (delta(innerStart, innerEnd) > 0) return true;
  return delta(outerStart, outerEnd) === 0 ? false : null;
}

// Что происходило у игрока вокруг покупки в момент t.
function aroundPurchase(stats, t) {
  if (!Number.isFinite(t) || t < WINDOW) return null;
  const before = rate(stats, 'pdmg', t - WINDOW, t);
  const after = rate(stats, 'pdmg', t, t + WINDOW);
  if (!Number.isFinite(before) || !Number.isFinite(after) || before < 0 || after < 0) return null;
  return {
    before,
    after,
    lift: localLift(stats, t),
    participated: participationAfter(stats, t),
  };
}

// players: [{ player }] — игроки на одном герое; coreItems: [{id, medianT, pick}]
function findSpikes(players, coreItems, { minLift = 1.15, limit = 4 } = {}) {
  const spikes = [];
  for (const it of coreItems) {
    const lifts = [];
    const befores = [];
    const afters = [];
    let participated = 0;
    let knownParticipation = 0;
    for (const b of players) {
      const first = firstPurchases(b.player, null).get(it.id);
      const a = aroundPurchase(b.player.stats, first);
      if (!a || a.lift === null) continue;
      lifts.push(a.lift);
      befores.push(a.before);
      afters.push(a.after);
      if (a.participated !== null) knownParticipation += 1;
      if (a.participated === true) participated += 1;
    }
    if (lifts.length < 3) continue;
    spikes.push({
      id: it.id,
      lift: median(lifts),
      samples: lifts.length,
      participated,
      knownParticipation,
      rateBefore: median(befores),
      rateAfter: median(afters),
      topT: it.medianT,
      pick: it.pick,
    });
  }
  return spikes.filter((s) => s.lift >= minLift).sort((a, b) => b.lift - a.lift).slice(0, limit);
}

module.exports = { WINDOW, dmgRatio, localLift, participationAfter, aroundPurchase, findSpikes };
