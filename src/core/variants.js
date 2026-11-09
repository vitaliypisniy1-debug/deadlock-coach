'use strict';
// Варианты билдов. Топы на одном герое часто играют разные сборки
// (через оружие, через спирит, через живучесть). Если смешать все игры в кучу,
// получится "билд", который никто не собирает. Поэтому делим игры на группы
// с похожим набором предметов и считаем билд и винрейт для каждой группы отдельно.

const { wilson } = require('./stats');
const { heroBuild, firstPurchases, isUpgrade } = require('./meta');

const MAX_T = 1800; // предметы до 30:00 — по ним видно, какую сборку собирали

function itemSet(record, assets) {
  const s = new Set();
  for (const [id, t] of firstPurchases(record, assets)) if (t <= MAX_T) s.add(id);
  return s;
}

function jaccardDist(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return 1 - inter / (a.size + b.size - inter);
}

// Предметы, которые различают сборки: не берут все подряд и не берут единицы.
function distinctiveUniverse(sets) {
  const n = sets.length;
  const cnt = new Map();
  for (const s of sets) for (const id of s) cnt.set(id, (cnt.get(id) || 0) + 1);
  const u = new Set();
  for (const [id, c] of cnt) {
    const p = c / n;
    if (p >= 0.08 && p <= 0.85) u.add(id);
  }
  return u;
}

function restrict(set, universe) {
  const out = new Set();
  for (const x of set) if (universe.has(x)) out.add(x);
  return out;
}

// k-медоиды по расстоянию Жаккара. Детерминированный старт: самый "центральный"
// элемент, затем каждый следующий — самый далёкий от уже выбранных.
function kMedoids(D, k) {
  const n = D.length;
  const sums = D.map((row) => row.reduce((s, v) => s + v, 0));
  const medoids = [sums.indexOf(Math.min(...sums))];
  while (medoids.length < k) {
    let best = -1;
    let bestD = -1;
    for (let i = 0; i < n; i++) {
      if (medoids.includes(i)) continue;
      const d = Math.min(...medoids.map((m) => D[i][m]));
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    medoids.push(best);
  }
  let assign = new Array(n).fill(0);
  for (let iter = 0; iter < 25; iter++) {
    assign = D.map((row) => {
      let bi = 0;
      for (let c = 1; c < k; c++) if (row[medoids[c]] < row[medoids[bi]]) bi = c;
      return bi;
    });
    let changed = false;
    for (let c = 0; c < k; c++) {
      const members = [];
      for (let i = 0; i < n; i++) if (assign[i] === c) members.push(i);
      if (!members.length) continue;
      let best = medoids[c];
      let bestSum = Infinity;
      for (const i of members) {
        const s = members.reduce((acc, j) => acc + D[i][j], 0);
        if (s < bestSum) {
          bestSum = s;
          best = i;
        }
      }
      if (best !== medoids[c]) {
        medoids[c] = best;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return assign;
}

// Средний силуэт: насколько группы действительно отличаются (−1…1).
function silhouette(D, assign, k) {
  const n = D.length;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const own = [];
    const other = Array.from({ length: k }, () => []);
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (assign[j] === assign[i]) own.push(D[i][j]);
      else other[assign[j]].push(D[i][j]);
    }
    if (!own.length) continue;
    const a = own.reduce((s, v) => s + v, 0) / own.length;
    const b = Math.min(...other.filter((o) => o.length).map((o) => o.reduce((s, v) => s + v, 0) / o.length));
    total += (b - a) / Math.max(a, b, 1e-9);
  }
  return total / n;
}

const STYLE_NAMES = { weapon: 'через оружие', spirit: 'через спирит', vitality: 'через живучесть' };

// Стиль сборки по слотам предметов. Если вариантов несколько, считаем вес предмета
// по тому, насколько чаще его берут именно в этом варианте (общие предметы почти не влияют).
function styleOf(build, assets, diffs = null) {
  const w = { weapon: 0, spirit: 0, vitality: 0 };
  for (const it of build.core) {
    const slot = assets && assets.items && assets.items[it.id] ? assets.items[it.id].slot : null;
    const weight = diffs ? Math.max(0, diffs.get(it.id) || 0) + 0.1 * it.pick : it.pick;
    if (w[slot] !== undefined) w[slot] += weight;
  }
  const sorted = Object.entries(w).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, x) => s + x[1], 0);
  if (!total) return { key: 'mixed', name: 'смешанный' };
  if (sorted[0][1] - sorted[1][1] < total * 0.1) return { key: 'hybrid', name: `гибрид (${STYLE_NAMES[sorted[0][0]].replace('через ', '')} + ${STYLE_NAMES[sorted[1][0]].replace('через ', '')})` };
  return { key: sorted[0][0], name: STYLE_NAMES[sorted[0][0]] };
}

// Главное: делит записи на варианты сборок.
// records: [{ items, won, account_id? }]
function clusterBuilds(records, assets, { maxK = 3 } = {}) {
  const n = records.length;
  const sets = records.map((r) => itemSet(r, assets));
  let assign = new Array(n).fill(0);
  let k = 1;
  let sil = null;
  const universe = distinctiveUniverse(sets);
  if (n >= 10 && universe.size >= 3) {
    const rs = sets.map((s) => restrict(s, universe));
    const D = rs.map((a) => rs.map((b) => jaccardDist(a, b)));
    const minSize = Math.max(4, Math.ceil(n * 0.12));
    let best = { k: 1, sil: 0.12, assign };
    for (let kk = 2; kk <= maxK; kk++) {
      const a = kMedoids(D, kk);
      const sizes = Array.from({ length: kk }, (_, c) => a.filter((x) => x === c).length);
      if (Math.min(...sizes) < minSize) continue;
      const s = silhouette(D, a, kk);
      if (s > best.sil + 0.02) best = { k: kk, sil: s, assign: a };
    }
    k = best.k;
    assign = best.assign;
    sil = k > 1 ? best.sil : null;
  }

  const groups = Array.from({ length: k }, () => []);
  assign.forEach((c, i) => groups[c].push(i));
  const variants = groups
    .filter((g) => g.length)
    .map((idx) => {
      const recs = idx.map((i) => records[i]);
      const build = heroBuild(recs, assets);
      const wins = recs.filter((r) => r.won).length;
      const ci = wilson(wins, recs.length);
      const players = new Set(recs.map((r) => r.account_id).filter(Boolean));
      return { idx, recs, build, games: recs.length, wins, winrate: wins / recs.length, ci_lo: ci.lo, ci_hi: ci.hi, players: players.size, share: recs.length / n };
    })
    .sort((a, b) => b.games - a.games);

  // Чем вариант отличается от остальных: предметы, которые здесь берут заметно чаще.
  for (const v of variants) {
    const inside = new Map(v.build.items.map((it) => [it.id, it.pick]));
    const others = records.filter((_, i) => !v.idx.includes(i));
    const outCnt = new Map();
    for (const r of others) for (const id of itemSet(r, assets)) outCnt.set(id, (outCnt.get(id) || 0) + 1);
    const scored = [...inside.entries()].map(([id, p]) => ({ id, diff: p - (others.length ? (outCnt.get(id) || 0) / others.length : 0), p }));
    v.diffs = new Map(scored.map((x) => [x.id, x.diff]));
    v.signature = scored
      .filter((x) => x.p >= 0.45 && x.diff >= 0.25)
      .sort((a, b) => b.diff - a.diff)
      .slice(0, 3)
      .map((x) => x.id);
    v.style = styleOf(v.build, assets, variants.length > 1 ? v.diffs : null);
    v.sets = v.idx.map((i) => sets[i]);
  }
  return { variants, k: variants.length, silhouette: sil, universe };
}

// К какому варианту ближе всего твой набор предметов.
function closestVariant(clusters, record, assets) {
  if (!clusters.variants.length) return null;
  const mine = itemSet(record, assets);
  const u = clusters.universe && clusters.universe.size ? clusters.universe : null;
  const my = u ? restrict(mine, u) : mine;
  let best = null;
  clusters.variants.forEach((v, i) => {
    const ds = v.sets.map((s) => jaccardDist(my, u ? restrict(s, u) : s));
    const avg = ds.reduce((s, d) => s + d, 0) / Math.max(1, ds.length);
    if (!best || avg < best.dist) best = { index: i, dist: avg };
  });
  // сходство с основными предметами варианта (понятнее человеку, чем среднее расстояние)
  const v = clusters.variants[best.index];
  const core = v.build.core.map((it) => it.id);
  const have = core.filter((id) => mine.has(id)).length;
  return { index: best.index, similarity: core.length ? have / core.length : 0, haveCore: have, coreSize: core.length };
}

module.exports = { clusterBuilds, closestVariant, itemSet, jaccardDist, MAX_T, isUpgrade };
