'use strict';
// Динамика показателей и сравнение с топами на твоих героях.
//
// Зачем не «ранг по показателям»: проверка на сохранённых матчах с известным рангом показала, что единая оценка
// ранга ненадёжна (на одном из трёх аккаунтов результат обратный), а таблица медиан по рангам (RANK_BENCH)
// не совпадает с нашими же матчами. Поэтому здесь только то, что считается одним конвейером и честно проверяемо:
//   — твои последние игры против предыдущих (заметно ли изменение: критерий Манна — Уитни, ≥8 игр в каждом окне);
//   — твои показатели против топов на ТВОИХ героях (медианы тем же конвейером; топы — не «твой ранг»);
//   — число замечаний «Ошибок» на проверяемую игру, тоже в динамике.

const { median } = require('./stats');
const { CATALOG, fmtOf } = require('./coach');

const WINDOW = 15; // игр в окне «сейчас» и в окне «до»
const MIN_EACH = 8; // меньше проверенных игр в окне — вывода о динамике нет
const Z_SIGNIFICANT = 1.64; // ≈ 90% по нормальному приближению

// Показатели, которые игрок может сдвинуть (привычки и разовые правила не входят).
const KEYS = ['lh10', 'nw10', 'dn10', 'soulsMid', 'neu9', 'brk9', 'pu10', 'dmgMin', 'kp', 'bdmgMin', 'firstBigT', 'spikeDmg', 'd', 'd10', 'solo_deaths'];

const finite = (v) => v !== null && v !== undefined && Number.isFinite(v);

// z-оценка критерия Манна — Уитни: больше ли значения в b, чем в a (с поправкой на совпадения).
function mannWhitneyZ(a, b) {
  const n1 = a.length;
  const n2 = b.length;
  if (!n1 || !n2) return 0;
  const all = a.map((v) => ({ v, g: 0 })).concat(b.map((v) => ({ v, g: 1 }))).sort((x, y) => x.v - y.v);
  const ranks = new Array(all.length);
  let tieTerm = 0;
  for (let i = 0; i < all.length;) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = avg;
    const t = j - i + 1;
    tieTerm += t * t * t - t;
    i = j + 1;
  }
  let r2 = 0;
  all.forEach((x, i) => { if (x.g === 1) r2 += ranks[i]; });
  const u2 = r2 - (n2 * (n2 + 1)) / 2;
  const n = n1 + n2;
  const varU = (n1 * n2 / 12) * (n + 1 - tieTerm / (n * (n - 1)));
  return varU > 0 ? (u2 - (n1 * n2) / 2) / Math.sqrt(varU) : 0;
}

// Динамика по списку значений в порядке времени: окна «до» и «сейчас» по WINDOW игр.
function trendOf(valuesByGame, cmp) {
  const perGame = valuesByGame;
  const recentGames = perGame.slice(-WINDOW);
  const prevGames = perGame.slice(-2 * WINDOW, -WINDOW);
  const recent = recentGames.filter(finite);
  const prev = prevGames.filter(finite);
  const out = { recentN: recent.length, prevN: prev.length, recent: recent.length ? median(recent) : null, prev: prev.length ? median(prev) : null, trend: 'few', z: null };
  if (recent.length < MIN_EACH || prev.length < MIN_EACH) return out;
  const z = mannWhitneyZ(prev, recent);
  out.z = z;
  if (Math.abs(z) < Z_SIGNIFICANT) out.trend = 'same';
  else out.trend = (z > 0) === (cmp === 'ge') ? 'better' : 'worse';
  return out;
}

// Топы на твоих героях: медиана референсов по героям из окна «сейчас» (как в целях тренера).
function topRef(key, games, topHero) {
  if (!topHero) return null;
  const refs = [];
  for (const g of games.slice(-WINDOW)) {
    const r = topHero.get(g.hero);
    if (r && r[key] && r[key].n >= 4 && finite(r[key].med)) refs.push(r[key].med);
  }
  return refs.length >= 3 ? median(refs) : null;
}

// Где ты относительно топов: 'top' — на их уровне или лучше, 'near' — немного хуже, 'below' — заметно хуже.
function levelVsTop(recent, ref, cmp) {
  if (!finite(recent) || !finite(ref)) return null;
  const rel = cmp === 'ge' ? (recent + 0.5) / (ref + 0.5) : (ref + 0.5) / (recent + 0.5);
  return rel >= 1 ? 'top' : rel >= 0.85 ? 'near' : 'below';
}

/**
 * games — загруженные игры по возрастанию времени: [{ match_id, hero, start_time, f }];
 * topHero — Map героя → медианы топов; errors — [{ match_id, n }] (число замечаний на проверяемую игру) или null.
 */
function progressView({ games, topHero = null, errors = null }) {
  const list = games.filter((g) => g.f);
  const indicators = [];
  for (const key of KEYS) {
    const cat = CATALOG.find((c) => c.key === key);
    if (!cat) continue;
    const values = list.map((g) => cat.metric(g));
    const t = trendOf(values, cat.cmp);
    if (t.recentN < 3) continue;
    const fmt = fmtOf(key);
    const ref = topRef(cat.field || cat.key, list, topHero);
    indicators.push({
      key,
      label: cat.short,
      area: cat.area,
      cmp: cat.cmp,
      recent: t.recent,
      prev: t.prev,
      recentText: fmt(t.recent),
      prevText: t.prev === null ? null : fmt(t.prev),
      recentN: t.recentN,
      prevN: t.prevN,
      trend: t.trend,
      top: ref,
      topText: ref === null ? null : fmt(ref),
      vsTop: levelVsTop(t.recent, ref, cat.cmp),
    });
  }
  const order = { worse: 0, better: 1, same: 2, few: 3 };
  indicators.sort((a, b) => order[a.trend] - order[b.trend]);
  let errs = null;
  if (errors && errors.length) {
    const t = trendOf(errors.map((e) => e.n), 'le');
    errs = { recent: t.recent, prev: t.prev, recentN: t.recentN, prevN: t.prevN, trend: t.trend };
  }
  return {
    games: list.length,
    window: WINDOW,
    minEach: MIN_EACH,
    enough: list.length >= WINDOW + MIN_EACH,
    indicators,
    errors: errs,
    better: indicators.filter((i) => i.trend === 'better').length,
    worse: indicators.filter((i) => i.trend === 'worse').length,
    belowTop: indicators.filter((i) => i.vsTop === 'below').length,
    note: 'Сравнение с топами показывает, как играют лучшие на тех же героях, а не твой ранг. Изменение считается заметным только при 8+ играх в каждом окне.',
  };
}

module.exports = { progressView, trendOf, mannWhitneyZ, levelVsTop, KEYS, WINDOW, MIN_EACH };
