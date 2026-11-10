'use strict';
// Личный тренер: превращает главные проблемы в 3–4 цели на неделю,
// проверяет каждую игру, показывает прогресс и закрывает выполненные цели.
//
// Цель: { key, title, short, cmp: 'ge'|'le', target, byHero: {heroId: target}, unit, area, tip }
// Проверка игры: value = metric(game); pass = cmp(value, targetFor(hero)).

const { median, mean } = require('./stats');
const { N, D1, P, T, plural } = require('./tipkit');

const DAY = 86400;
const WEEK = 7 * DAY;

const round = (v, step) => Math.round(v / step) * step;

// Каталог целей. ref — значение топов (или лобби), me — твоя медиана.
// make() возвращает { target, gap } или null, если по этой метрике у тебя всё хорошо.
// stretch() — запасная цель «дотянуться до уровня топов», когда явных проблем мало:
// берётся, только если ты хоть немного ниже топов.
// family — цели про одно и то же (крипы и души на линии) вместе не ставим.
const T_UP = (step) => (me, ref) => (me === null || ref === null || me >= ref ? null : { target: step ? Math.ceil(ref / step) * step : Math.ceil(ref), gap: ((ref - me) / Math.max(1e-9, Math.abs(ref))) * 0.5 });
const T_DOWN = (step) => (me, ref) => (me === null || ref === null || me <= ref ? null : { target: step ? Math.floor(ref / step) * step : Math.floor(ref), gap: ((me - ref) / Math.max(1, Math.abs(ref))) * 0.5 });

const CATALOG = [
  {
    key: 'd10', family: 'deaths', fmt: (v) => D1(v), area: 'Выживание', cmp: 'le', heroSpecific: false,
    metric: (g) => g.f && g.f.d10,
    title: (t) => (t === 0 ? 'Не умирать до 10:00' : `Не больше ${t} ${plural(t, 'смерти', 'смертей', 'смертей')} до 10:00`),
    short: 'смерти до 10:00',
    tip: 'На линии не начинай размен первым, а когда противник с соседней линии пропал с карты — отходи к своей башне.',
    make: (me, ref) => (me === null || me < 0.75 ? null : { target: Math.max(0, Math.floor(me) - 1), gap: me - (ref ?? 0.6) }),
  },
  {
    key: 'd', family: 'deaths', fmt: (v) => D1(v), area: 'Выживание', cmp: 'le', heroSpecific: false,
    metric: (g) => g.f && g.f.d,
    title: (t) => `Не больше ${t} ${plural(t, 'смерти', 'смертей', 'смертей')} за игру`,
    short: 'смерти за игру',
    tip: 'Перед каждым заходом в драку смотри на карту: где враги, которых не видно? Отступай при половине здоровья.',
    make: (me, ref) => (me === null || ref === null || me <= ref + 0.8 ? null : { target: Math.max(Math.round(ref), Math.floor(me - Math.max(1, (me - ref) / 2))), gap: (me - ref) / Math.max(1, ref) }),
    stretch: (me, ref) => (me === null || ref === null || me <= ref + 0.3 ? null : { target: Math.max(Math.round(ref), Math.ceil(me) - 1), gap: ((me - ref) / Math.max(1, ref)) * 0.5 }),
  },
  {
    key: 'nw10', family: 'laneFarm', fmt: N, area: 'Фарм', cmp: 'ge', heroSpecific: true, step: 100,
    metric: (g) => g.f && g.f.nw10,
    title: (t) => `К 10:00 — от ${N(t)} душ`,
    short: 'души к 10:00',
    tip: 'Добивай каждого крипа последним выстрелом и сразу забирай сферу души. В лес — только когда волна запушена.',
    make: (me, ref) => (me === null || ref === null || me >= ref * 0.93 ? null : { target: round(me + (ref - me) * 0.6, 100), gap: (ref - me) / ref }),
    stretch: T_UP(100),
  },
  {
    key: 'lh10', family: 'laneFarm', fmt: N, area: 'Фарм', cmp: 'ge', heroSpecific: true, step: 1,
    metric: (g) => g.f && g.f.lh10,
    title: (t) => `Добивать от ${t} крипов к 10:00`,
    short: 'крипы к 10:00',
    tip: 'Стой ближе к волне и бей крипа, когда у него мало здоровья. Полных крипов не трогай.',
    make: (me, ref) => (me === null || ref === null || ref < 15 || me >= ref * 0.9 ? null : { target: Math.round(me + (ref - me) * 0.6), gap: (ref - me) / ref }),
  },
  {
    key: 'soulsMid', family: 'midFarm', fmt: N, area: 'Фарм', cmp: 'ge', heroSpecific: true, step: 25,
    metric: (g) => g.f && g.f.soulsMid,
    title: (t) => `С 10 до 20 минуты — от ${N(t)} душ в минуту`,
    short: 'души/мин в середине',
    tip: 'Между драками чередуй: волна → лагерь в лесу → волна. Стоять и ждать нельзя.',
    make: (me, ref) => (me === null || ref === null || me >= ref * 0.9 ? null : { target: round(me + (ref - me) * 0.6, 25), gap: (ref - me) / ref }),
    stretch: T_UP(25),
  },
  {
    key: 'firstBigT', family: 'spike1', fmt: T, area: 'Паверспайки', cmp: 'le', heroSpecific: true, step: 30,
    metric: (g) => g.f && g.f.firstBigT,
    title: (t) => `Первый паверспайк (предмет за 3000+) — до ${T(t)}`,
    short: 'первый паверспайк',
    tip: 'Решай заранее, какой предмет главный, и копи на него, не покупая мелочь по дороге.',
    make: (me, ref) => (me === null || ref === null || me <= ref + 90 ? null : { target: round(me - (me - ref) * 0.6, 30), gap: (me - ref) / ref }),
    stretch: (me, ref) => (me === null || ref === null || me <= ref + 20 ? null : { target: Math.floor(ref / 30) * 30, gap: ((me - ref) / ref) * 0.5 }),
  },
  {
    key: 'firstHugeT', family: 'spike2', fmt: T, area: 'Паверспайки', cmp: 'le', heroSpecific: true, step: 30,
    metric: (g) => g.f && g.f.firstHugeT,
    title: (t) => `Большой паверспайк (предмет за 6000+) — до ${T(t)}`,
    short: 'большой паверспайк',
    tip: 'Предмет за 6000 — главный рывок середины игры. Между драками фарми лес и волны и копи на него, не распыляясь на мелочь.',
    make: (me, ref) => (me === null || ref === null || me <= ref + 120 ? null : { target: round(me - (me - ref) * 0.6, 30), gap: (me - ref) / ref }),
    stretch: (me, ref) => (me === null || ref === null || me <= ref + 30 ? null : { target: Math.floor(ref / 30) * 30, gap: ((me - ref) / ref) * 0.5 }),
  },
  {
    key: 'spikeFights', family: 'spikeUse', fmt: P, area: 'Паверспайки', cmp: 'ge', heroSpecific: false,
    metric: (g) => g.f && g.f.spikeFights,
    title: (t) => `Использовать паверспайк: драка в течение 3 минут после большого предмета — в ${P(t)} случаев`,
    short: 'драка после паверспайка',
    tip: 'Купил большой предмет — это твой момент силы. В ближайшие 3 минуты ищи драку или дави на линии, пока враг не докупился.',
    make: (me, ref) => (me === null || ref === null || me >= ref - 0.1 ? null : { target: Math.round((me + (ref - me) * 0.7) * 20) / 20, gap: ((ref - me) / Math.max(0.2, ref)) * 0.9 }),
    stretch: (me, ref) => (me === null || ref === null || me >= ref - 0.02 ? null : { target: Math.round(ref * 20) / 20, gap: ((ref - me) / Math.max(0.2, ref)) * 0.5 }),
  },
  {
    key: 'spikeDmg', family: 'spikeDmg', fmt: N, area: 'Паверспайки', cmp: 'ge', heroSpecific: true, step: 25,
    metric: (g) => g.f && g.f.spikeDmg,
    title: (t) => `Урон по героям после первого паверспайка — от ${N(t)} в минуту`,
    short: 'урон после паверспайка',
    tip: 'Первые 3 минуты после большого предмета — лучшее время для размена. Стреляй по героям, а не по крипам.',
    make: (me, ref) => (me === null || ref === null || me >= ref * 0.8 ? null : { target: round(me + (ref - me) * 0.6, 25), gap: ((ref - me) / ref) * 0.9 }),
    stretch: T_UP(25),
  },
  {
    key: 'pu10', family: 'statues', fmt: (v) => String(Math.round(v)), area: 'Тайминги', cmp: 'ge', heroSpecific: false,
    metric: (g) => g.f && g.f.pu10,
    title: (t) => `Статуи к 10:00 — от ${t}`,
    short: 'статуи к 10:00',
    tip: 'Каждая статуя — постоянный баф до конца игры. Волна ушла к врагу — ломай статую рядом с линией и возвращайся к следующей волне.',
    make: (me, ref) => (me === null || ref === null || me >= ref - 1 ? null : { target: Math.max(Math.ceil(me) + 1, Math.round(me + (ref - me) * 0.6)), gap: ((ref - me) / Math.max(1, ref)) * 0.8 }),
    stretch: (me, ref) => (me === null || ref === null || me >= ref ? null : { target: Math.ceil(ref), gap: ((ref - me) / Math.max(1, ref)) * 0.4 }),
  },
  {
    key: 'neu9', family: 'jungle', fmt: N, area: 'Тайминги', cmp: 'ge', heroSpecific: true, step: 50,
    metric: (g) => g.f && g.f.neu9,
    title: (t) => `Души с леса к 9:00 — от ${N(t)}`,
    short: 'лес к 9:00',
    tip: 'Лесной лагерь у твоей линии бери сразу, как появился: пока ждёшь волну, это бесплатные души.',
    make: (me, ref) => (me === null || ref === null || me >= ref * 0.75 ? null : { target: round(me + (ref - me) * 0.6, 50), gap: ((ref - me) / Math.max(1, ref)) * 0.8 }),
    stretch: T_UP(50),
  },
  {
    key: 'brk9', family: 'crates', fmt: N, area: 'Тайминги', cmp: 'ge', heroSpecific: false, step: 50,
    metric: (g) => g.f && g.f.brk9,
    title: (t) => `Души с коробок к 9:00 — от ${N(t)}`,
    short: 'коробки к 9:00',
    tip: 'Коробки у линии ломаются за пару выстрелов. Волна ушла — пройдись по ближайшим коробкам и обратно.',
    make: (me, ref) => (me === null || ref === null || me >= ref * 0.75 ? null : { target: round(me + (ref - me) * 0.6, 50), gap: ((ref - me) / Math.max(1, ref)) * 0.7 }),
    stretch: T_UP(50),
  },
  {
    key: 'kp', family: 'kp', fmt: P, area: 'Драки', cmp: 'ge', heroSpecific: false,
    metric: (g) => g.f && g.f.kp,
    title: (t) => `Участвовать в ${P(t)} убийств команды`,
    short: 'участие в убийствах',
    tip: 'Каждые несколько секунд смотри на карту и иди на ближайшую драку — помощь даёт почти столько же душ, сколько убийство.',
    make: (me, ref) => (me === null || ref === null || me >= ref - 0.05 ? null : { target: Math.round((me + (ref - me) * 0.7) * 20) / 20, gap: (ref - me) / ref }),
    stretch: (me, ref) => (me === null || ref === null || me >= ref - 0.01 ? null : { target: Math.round(ref * 20) / 20, gap: ((ref - me) / ref) * 0.5 }),
  },
  {
    key: 'dmgMin', family: 'dmg', fmt: N, area: 'Драки', cmp: 'ge', heroSpecific: true, step: 25,
    metric: (g) => g.f && g.f.dmgMin,
    title: (t) => `Урон по героям — от ${N(t)} в минуту`,
    short: 'урон по героям/мин',
    tip: 'Когда враг рядом — стреляй по нему, а не по крипам. После покупки ключевого предмета ищи драку.',
    make: (me, ref) => (me === null || ref === null || me >= ref * 0.88 ? null : { target: round(me + (ref - me) * 0.6, 25), gap: (ref - me) / ref }),
    stretch: T_UP(25),
  },
  {
    key: 'dn10', family: 'denies', fmt: N, area: 'Линия', cmp: 'ge', heroSpecific: false,
    metric: (g) => g.f && g.f.dn10,
    title: (t) => `Отбирать от ${t} сфер к 10:00`,
    short: 'отобранные сферы',
    tip: 'Когда враг добивает твоего крипа — стреляй по вылетевшей сфере раньше него.',
    make: (me, ref) => (me === null || ref === null || ref < 3 || me >= ref * 0.7 ? null : { target: Math.max(2, Math.round(me + (ref - me) * 0.6)), gap: ((ref - me) / ref) * 0.7 }),
    stretch: (me, ref) => (me === null || ref === null || ref < 2 || me >= ref - 0.5 ? null : { target: Math.max(2, Math.round(ref)), gap: ((ref - me) / ref) * 0.35 }),
  },
  {
    key: 'bdmgMin', family: 'objectives', fmt: N, area: 'Объекты', cmp: 'ge', heroSpecific: false, step: 10,
    metric: (g) => g.f && g.f.bdmgMin,
    title: (t) => `Урон по объектам — от ${N(t)} в минуту`,
    short: 'урон по объектам',
    tip: 'После выигранной драки сразу всей командой на стража или ходока.',
    make: (me, ref) => (me === null || ref === null || ref < 30 || me >= ref * 0.7 ? null : { target: round(me + (ref - me) * 0.6, 10), gap: ((ref - me) / ref) * 0.8 }),
    stretch: (me, ref) => (me === null || ref === null || ref < 30 || me >= ref * 0.95 ? null : { target: Math.ceil(ref / 10) * 10, gap: ((ref - me) / ref) * 0.4 }),
  },
  {
    key: 'session', family: 'session', fmt: (v) => `${v}-я`, area: 'Режим', cmp: 'le', heroSpecific: false, habit: true,
    metric: (g) => g.pos,
    title: () => 'Перерыв после 3 игр подряд',
    short: 'номер игры в сессии',
    tip: 'После третьей игры подряд встань хотя бы на 15 минут: усталость незаметно съедает реакцию и решения.',
    make: (me, ref, extra) => (!extra || !extra.fatigue ? null : { target: 3, gap: 0.25 }),
  },
  {
    key: 'tilt', family: 'tilt', fmt: (v) => `${Math.round(v)} мин`, area: 'Настрой', cmp: 'ge', heroSpecific: false, habit: true,
    metric: (g) => (g.afterLoss ? g.gapMin : null),
    title: () => 'После поражения — пауза хотя бы 10 минут',
    short: 'пауза после поражения',
    tip: 'Не жми «Найти игру» сразу после обидного поражения. Пара минут разбора в «Моих матчах» — и следующая игра пойдёт лучше.',
    make: (me, ref, extra) => (!extra || !extra.tilt ? null : { target: 10, gap: 0.22 }),
  },
];

const GOALS_MAX = 4; // сколько целей одновременно
const GOALS_MIN = 3; // меньше — добираем целями «до уровня топов»

const passOf = (cmp, value, target) => (value === null || value === undefined || !Number.isFinite(value) ? null : cmp === 'ge' ? value >= target : value <= target);

function targetFor(goal, hero) {
  if (goal.byHero && goal.byHero[hero] !== undefined) return goal.byHero[hero];
  return goal.target;
}

// Медианы признака: твоя (по играм) и топов (по герою — медиана по твоим героям, взвешенно).
function stats(key, games, topHero, lobby) {
  const mine = games.map((g) => g.f && g.f[key]).filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  const me = mine.length >= 3 ? median(mine) : null;
  const refs = [];
  for (const g of games) {
    const r = topHero && topHero.get(g.hero);
    if (r && r[key] && r[key].n >= 4 && r[key].med !== null) refs.push(r[key].med);
  }
  let ref = refs.length >= 3 ? median(refs) : null;
  if (ref === null && lobby && lobby[key] && lobby[key].n >= 8) ref = lobby[key].med;
  return { me, ref };
}

// Цели по героям: свой порог для каждого героя (фарм у героев разный).
function heroTargets(cat, games, topHero) {
  if (!cat.heroSpecific) return null;
  const out = {};
  const heroes = [...new Set(games.map((g) => g.hero))];
  for (const h of heroes) {
    const list = games.filter((g) => g.hero === h);
    const r = topHero && topHero.get(h);
    const vals = list.map((g) => g.f && g.f[cat.key]).filter((v) => v !== null && v !== undefined && Number.isFinite(v));
    if (!r || !r[cat.key] || r[cat.key].n < 4 || vals.length < 2) continue;
    const me = median(vals);
    const ref = r[cat.key].med;
    const k = cat.cmp === 'ge' ? me + (ref - me) * 0.6 : me - (me - ref) * 0.6;
    const t = cat.step ? round(k, cat.step) : Math.round(k);
    // цель не должна быть легче твоего обычного уровня
    out[h] = cat.cmp === 'ge' ? Math.max(t, cat.step ? round(me, cat.step) : Math.round(me)) : Math.min(t, me);
  }
  return out;
}

// Кандидаты в цели, по убыванию важности. stretch — только «дотянуться до топов».
function candidates({ games, topHero, lobby, extra, exclude = new Set(), stretch = false }) {
  const out = [];
  for (const cat of CATALOG) {
    if (exclude.has(cat.key)) continue;
    const { me, ref } = stats(cat.key, games, topHero, lobby);
    let g = stretch ? null : cat.make(me, ref, extra);
    let kind = 'fix';
    if (!g && stretch && cat.stretch) {
      g = cat.stretch(me, ref, extra);
      kind = 'stretch';
    }
    if (!g) continue;
    let byHero = heroTargets(cat, games, topHero);
    if (kind === 'stretch' && byHero) byHero = stretchHeroTargets(cat, games, topHero);
    out.push({
      key: cat.key,
      family: cat.family,
      area: cat.area,
      cmp: cat.cmp,
      habit: !!cat.habit,
      kind,
      title: cat.title(g.target),
      short: cat.short,
      tip: cat.tip,
      target: g.target,
      byHero,
      baseline: me,
      ref,
      gap: g.gap,
    });
  }
  return out.sort((a, b) => b.gap - a.gap);
}

// Для запасной цели по героям — уровень топов на этом герое (но не легче твоего обычного).
function stretchHeroTargets(cat, games, topHero) {
  const out = {};
  for (const h of new Set(games.map((g) => g.hero))) {
    const r = topHero && topHero.get(h);
    const vals = games.filter((g) => g.hero === h).map((g) => g.f && g.f[cat.key]).filter((v) => v !== null && v !== undefined && Number.isFinite(v));
    if (!r || !r[cat.key] || r[cat.key].n < 4 || vals.length < 2) continue;
    const me = median(vals);
    const ref = r[cat.key].med;
    const t = cat.step ? (cat.cmp === 'ge' ? Math.ceil(ref / cat.step) * cat.step : Math.floor(ref / cat.step) * cat.step) : Math.round(ref);
    out[h] = cat.cmp === 'ge' ? Math.max(t, cat.step ? round(me, cat.step) : Math.round(me)) : Math.min(t, me);
  }
  return out;
}

// Выбор целей: сначала по одной на раздел, потом добираем вторую в раздел.
// Никогда две цели про одно и то же (family) и не больше одной привычки.
function pickGoals(cands, n = GOALS_MAX, taken = []) {
  const res = [];
  const fam = new Set(taken.map((g) => g.family || g.key));
  const perArea = new Map();
  for (const g of taken) perArea.set(g.area, (perArea.get(g.area) || 0) + 1);
  let habit = taken.some((g) => g.habit);
  for (const maxPerArea of [1, 2]) {
    for (const c of cands) {
      if (res.length >= n) break;
      if (res.includes(c) || fam.has(c.family || c.key)) continue;
      if ((perArea.get(c.area) || 0) >= maxPerArea) continue;
      if (c.habit && habit) continue;
      if (c.habit) habit = true;
      fam.add(c.family || c.key);
      perArea.set(c.area, (perArea.get(c.area) || 0) + 1);
      res.push(c);
    }
  }
  return res;
}

// Полный набор: главные проблемы, а если их меньше GOALS_MIN — цели «до уровня топов».
function chooseGoals(data, games, exclude, taken = [], n = GOALS_MAX) {
  const base = { games, topHero: data.topHero, lobby: data.lobby, extra: data.extra, exclude };
  const main = pickGoals(candidates(base), n, taken);
  const have = taken.length + main.length;
  if (have >= GOALS_MIN || main.length >= n) return main;
  const more = pickGoals(candidates({ ...base, stretch: true }), Math.min(n - main.length, GOALS_MIN - have), taken.concat(main));
  return main.concat(more);
}

function fmtOf(key) {
  const c = CATALOG.find((x) => x.key === key);
  return (c && c.fmt) || ((v) => D1(v));
}

// Проверка одной игры по всем целям плана.
function checkGame(game, goals) {
  return goals.map((goal) => {
    const cat = CATALOG.find((c) => c.key === goal.key);
    const value = cat ? cat.metric(game) : null;
    const target = targetFor(goal, game.hero);
    const pass = passOf(goal.cmp, value, target);
    return { key: goal.key, short: goal.short, value, target, pass, text: value === null || value === undefined ? '—' : fmtOf(goal.key)(value), targetText: fmtOf(goal.key)(target) };
  });
}

/**
 * state — сохранённое состояние тренера ({ plan, archive, done }).
 * data  — { games (по возрастанию времени), topHero, lobby, extra, now, mainMistake(game) }.
 * Возвращает { state, view }.
 */
function updateCoach(state, data, { forceNew = false } = {}) {
  const now = data.now || Math.floor(Date.now() / 1000);
  const games = data.games;
  const loaded = games.filter((g) => g.f);
  const st = { plan: null, archive: [], log: [], ...(state || {}) };
  const events = [];
  const logEvent = (e) => {
    st.log = (st.log || []).concat([e]).slice(-40);
  };

  const makePlan = (reason) => {
    const recent = loaded.slice(-25);
    const recentlyDone = new Set((st.archive || []).filter((g) => g.status === 'done' && now - (g.doneAt || 0) < 14 * DAY).map((g) => g.key));
    const goals = chooseGoals(data, recent, recentlyDone);
    st.plan = { createdAt: now, reason, goals: goals.map((g) => ({ ...g, status: 'active', startedAt: now })) };
    const text = goals.length ? goals.map((g) => g.title).join(' · ') : 'Явных проблем не нашлось — продолжай в том же духе, а я слежу за каждой игрой.';
    // «Новый план» с теми же целями — не повторяем сообщение, а обновляем время старого
    const prev = (st.log || []).slice().reverse().find((e) => e.kind === 'plan' && e.title === 'Новый план на неделю');
    if (prev && prev.text === text && now - prev.t < DAY) prev.t = now;
    else logEvent({ t: now, kind: 'plan', title: 'Новый план на неделю', text });
  };

  if (!st.plan || forceNew || now - st.plan.createdAt > WEEK) {
    if (st.plan) st.archive = (st.archive || []).concat(st.plan.goals.map((g) => ({ ...g, status: g.status === 'done' ? 'done' : 'expired', endedAt: now }))).slice(-60);
    if (loaded.length >= 5) makePlan(forceNew ? 'manual' : st.plan ? 'week' : 'first');
  }
  const plan = st.plan;
  if (!plan) {
    return { state: st, view: { plan: null, cards: [], goals: [], events: st.log || [], need: Math.max(0, 5 - loaded.length) } };
  }

  // Игры: до плана — «как было», после — проверка целей
  const after = loaded.filter((g) => g.start_time >= plan.createdAt - 60);
  const before = loaded.filter((g) => g.start_time < plan.createdAt - 60).slice(-10);

  // Закрытие выполненных целей и выдача следующих
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 5) {
    changed = false;
    for (const goal of plan.goals) {
      if (goal.status !== 'active') continue;
      const res = after.filter((g) => g.start_time >= goal.startedAt - 60).map((g) => checkGame(g, [goal])[0]).filter((r) => r.pass !== null);
      const last = res.slice(-5);
      if (last.length >= 5 && last.filter((r) => r.pass).length >= 4) {
        goal.status = 'done';
        goal.doneAt = now;
        logEvent({ t: now, kind: 'done', title: 'Цель выполнена', text: `«${goal.title}» — ${last.filter((r) => r.pass).length} из 5 последних игр. Беру следующую.` });
        changed = true;
      }
    }
  }

  // Целей меньше, чем нужно (одна закрыта или план старой версии) — добираем.
  const activeNow = plan.goals.filter((g) => g.status === 'active');
  if (activeNow.length < GOALS_MAX) {
    const used = new Set(plan.goals.map((g) => g.key));
    const taken = activeNow.map((g) => ({ ...g, family: g.family || (CATALOG.find((c) => c.key === g.key) || {}).family }));
    const extra = chooseGoals(data, loaded.slice(-25), used, taken, GOALS_MAX - activeNow.length);
    for (const next of extra) {
      plan.goals.push({ ...next, status: 'active', startedAt: now });
      logEvent({ t: now, kind: 'plan', title: 'Новая цель', text: next.title });
    }
  }

  const goalsAll = plan.goals;
  const activeGoals = goalsAll.filter((g) => g.status === 'active');

  // Карточки игр (новые сверху)
  const cardGames = (after.length ? after : before).slice(-15);
  const cards = cardGames.map((g) => {
    const checks = checkGame(g, goalsAll.filter((x) => x.startedAt - 60 <= g.start_time || !after.length));
    const passed = checks.filter((c) => c.pass === true).length;
    const counted = checks.filter((c) => c.pass !== null).length;
    return {
      match_id: g.match_id,
      start_time: g.start_time,
      duration_s: g.duration_s,
      hero: g.hero,
      won: g.won,
      k: g.k,
      d: g.d,
      a: g.a,
      nw: g.nw,
      checks,
      passed,
      counted,
      mistake: data.mainMistake ? data.mainMistake(g) : null,
      good: data.mainGood ? data.mainGood(g) : null,
      beforePlan: !after.length,
    };
  }).reverse();

  // Прогресс по целям: значения по играм (последние 15) + доля выполнения
  const goals = goalsAll.map((goal) => {
    const rows = loaded.slice(-20).map((g) => {
      const c = checkGame(g, [goal])[0];
      return { match_id: g.match_id, t: g.start_time, hero: g.hero, value: c.value, target: c.target, pass: c.pass, afterStart: g.start_time >= goal.startedAt - 60 };
    }).filter((r) => r.value !== null && r.value !== undefined);
    const since = rows.filter((r) => r.afterStart && r.pass !== null);
    const prior = rows.filter((r) => !r.afterStart && r.pass !== null);
    return {
      ...goal,
      byHero: goal.byHero,
      rows,
      games: since.length,
      passed: since.filter((r) => r.pass).length,
      rate: since.length ? since.filter((r) => r.pass).length / since.length : null,
      priorRate: prior.length ? prior.filter((r) => r.pass).length / prior.length : null,
      streak: (() => {
        let s = 0;
        for (let i = since.length - 1; i >= 0 && since[i].pass; i--) s += 1;
        return s;
      })(),
      targetText: fmtOf(goal.key)(goal.target),
      baselineText: goal.baseline === null || goal.baseline === undefined ? '—' : fmtOf(goal.key)(goal.baseline),
    };
  });

  // Сообщения тренера по играм
  for (const c of cards.slice(0, 10)) {
    if (c.beforePlan) continue;
    const parts = [];
    if (c.counted) parts.push(`${c.passed} из ${c.counted} ${plural(c.counted, 'цели', 'целей', 'целей')} выполнено`);
    if (c.mistake) parts.push(`главное: ${c.mistake.title.toLowerCase()}`);
    events.push({ t: c.start_time + (c.duration_s || 0), kind: 'game', match_id: c.match_id, hero: c.hero, won: c.won, title: `${c.won ? 'Победа' : 'Поражение'} — разбор`, text: parts.join('; ') || 'Игра учтена.' });
  }
  for (const g of goals) {
    if (g.status === 'active' && g.streak >= 3) events.push({ t: now, kind: 'streak', title: 'Серия', text: `«${g.title}» — ${g.streak} ${plural(g.streak, 'игра', 'игры', 'игр')} подряд.` });
  }

  // Общий прогресс: доля выполненных проверок за последние 10 игр после плана
  const lastChecks = cards.filter((c) => !c.beforePlan).slice(0, 10).flatMap((c) => c.checks.filter((x) => x.pass !== null));
  const score = lastChecks.length ? lastChecks.filter((x) => x.pass).length / lastChecks.length : null;

  return {
    state: st,
    view: {
      plan: { createdAt: plan.createdAt, endsAt: plan.createdAt + WEEK, reason: plan.reason },
      goals,
      active: activeGoals.length,
      done: goalsAll.filter((g) => g.status === 'done').length + (st.archive || []).filter((g) => g.status === 'done').length,
      cards,
      events: (st.log || []).concat(events).sort((a, b) => b.t - a.t).slice(0, 30),
      score,
      gamesSince: after.length,
      archive: (st.archive || []).slice(-12).reverse(),
    },
  };
}

module.exports = { updateCoach, checkGame, candidates, pickGoals, chooseGoals, CATALOG, GOALS_MAX, GOALS_MIN };
