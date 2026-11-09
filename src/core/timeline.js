'use strict';
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
