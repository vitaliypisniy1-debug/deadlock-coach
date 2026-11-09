'use strict';
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
