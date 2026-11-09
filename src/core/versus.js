'use strict';
// «Бок о бок»: твой матч против матча топа на том же герое.

const { firstPurchases, itemFates } = require('./meta');
const { valueAt, minuteSeries, lastMinute } = require('./timeline');
const { deathTimes } = require('./features');
const { SOURCES } = require('./sources');

function itemSet(p, assets) {
  return new Set([...firstPurchases(p, assets).entries()].filter(([, t]) => t <= 1800).map(([id]) => id));
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

// Подбор матчей топов для сравнения: та же сборка, предпочтительно победы, свежие.
function proCandidates({ me, bench, assets, nameOf = (id) => String(id), limit = 12 }) {
  const mine = itemSet(me, assets);
  return bench
    .filter((b) => b.match && b.player && b.player.stats && b.player.stats.length >= 3)
    .map((b) => {
      const sim = jaccard(mine, itemSet(b.player, assets));
      return {
        match_id: b.match.match_id,
        account_id: b.player.account_id,
        name: nameOf(b.player.account_id),
        won: b.player.won,
        k: b.player.k,
        d: b.player.d,
        a: b.player.a,
        nw: b.player.nw,
        duration_s: b.match.duration_s,
        start_time: b.match.start_time,
        similarity: sim,
        score: sim + (b.player.won ? 0.15 : 0) + Math.min(0.1, (b.match.start_time || 0) / 1e10),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

const PH = [
  { key: 'lane', name: 'Линия', from: 0, to: 10 },
  { key: 'mid', name: 'Середина', from: 10, to: 20 },
  { key: 'late', name: 'Поздняя', from: 20, to: 60 },
];

function side(match, p, assets) {
  const maxM = Math.min(60, lastMinute(p.stats));
  const delta = (f, a, b) => {
    const to = Math.min(b, maxM);
    if (to - a < 2) return null;
    const x = valueAt(p.stats, f, a * 60);
    const y = valueAt(p.stats, f, to * 60);
    return x === null || y === null ? null : y - x;
  };
  const fates = new Map(itemFates(p.items, assets).map((f) => [`${f.id}:${f.t}`, f]));
  return {
    account_id: p.account_id,
    slot: p.slot,
    hero: p.hero_id,
    team: p.team,
    won: p.won,
    k: p.k,
    d: p.d,
    a: p.a,
    nw: p.nw,
    duration_s: match.duration_s,
    curves: { nw: minuteSeries(p.stats, 'nw', maxM), pdmg: minuteSeries(p.stats, 'pdmg', maxM), farm: minuteSeries(p.stats, 'farm', maxM), ka: minuteSeries(p.stats, 'ka', maxM) },
    items: [...firstPurchases(p, assets).entries()].sort((a, b) => a[1] - b[1]).map(([id, t]) => ({ id, t, fate: (fates.get(`${id}:${t}`) || {}).fate || 'kept' })),
    phases: PH.map((ph) => ({ ...ph, nw: delta('nw', ph.from, ph.to), pdmg: delta('pdmg', ph.from, ph.to), d: delta('d', ph.from, ph.to), ka: delta('ka', ph.from, ph.to) })),
    sources: PH.map((ph) => ({ key: ph.key, rows: SOURCES.map((s) => ({ field: s.field, short: s.short, v: delta(s.field, ph.from, ph.to) })) })),
    deaths: deathTimes(p),
  };
}

function versus({ myMatch, me, proMatch, pro, assets }) {
  return { me: side(myMatch, me, assets), pro: side(proMatch, pro, assets) };
}

module.exports = { proCandidates, versus, jaccard };
