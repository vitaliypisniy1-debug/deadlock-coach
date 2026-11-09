'use strict';
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
