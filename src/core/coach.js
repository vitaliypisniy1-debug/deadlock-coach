'use strict';
// Личный тренер: превращает главные проблемы в 3–4 цели на неделю,
// проверяет каждую игру, показывает прогресс и закрывает выполненные цели.
//
// Цель: { key, title, short, cmp: 'ge'|'le', target, byHero: {heroId: target}, unit, area, tip }
// Проверка игры: value = metric(game); pass = cmp(value, targetFor(hero)).

const { median, mean } = require('./stats');
const { N, D1, P, T, plural } = require('./tipkit');
const { majorSoulLosses, SOUL_LOSS_THRESHOLD, winLink } = require('./leaks');

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
    title: (t) => `Участие в убийстве за 3 минуты после дорогой покупки — в ${P(t)} окон с доступными данными`,
    short: 'убийство или помощь после покупки',
    tip: 'При просмотре повтора проверь, была ли у команды безопасная возможность для драки после покупки.',
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
    title: (t) => `Постоянных бафов к 10:00 — от ${t}`,
    short: 'бафы к 10:00',
    tip: 'Контейнеры с бафами (бывшие золотые статуи) появляются на 3:00 и снова через 3 минуты после поломки. Волна ушла к врагу — ломай ближайший и возвращайся к следующей волне.',
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
    tip: 'После 3:00 проверь, есть ли безопасный путь к ближайшим коробкам между волнами. Сравни доход и пропущенные добивания в повторе.',
    make: (me, ref) => (me === null || ref === null || me >= ref * 0.75 ? null : { target: round(me + (ref - me) * 0.6, 50), gap: ((ref - me) / Math.max(1, ref)) * 0.7 }),
    stretch: T_UP(50),
  },
  {
    key: 'lost_souls', family: 'soulRisk', fmt: N, area: 'Выживание', cmp: 'le', heroSpecific: false,
    metric: (g) => g.match && g.me ? majorSoulLosses(g.me, g.match.duration_s) : null,
    title: () => `Ни одной смерти с потерей ${N(SOUL_LOSS_THRESHOLD)} душ или больше`,
    short: 'смерти с крупной потерей душ',
    tip: 'Перед рискованным пушем Walker проверь размер мешка и возможность безопасно отойти или купить предмет.',
    make: () => null,
  },
  {
    // field — где лежит значение в признаках: ключ цели не совпадает с именем поля,
    // потому что цель должна находить эпизоды «Ошибок» по тому же ключу (solo_deaths).
    key: 'solo_deaths', family: 'soloDeaths', field: 'soloDeaths', fmt: N, area: 'Выживание', cmp: 'le', heroSpecific: false,
    metric: (g) => g.f && g.f.soloDeaths,
    title: (t) => `Смертей в одиночку после 10:00 — не больше ${t}`,
    short: 'смерти в одиночку',
    tip: 'Не заходи на чужую половину и к объектам без напарника: фарми рядом с командой или на своей половине. Соперники пропали с миникарты — отходи к своим, даже если лагерь не добит.',
    make: (me) => (me === null || me <= 1.5 ? null : { target: Math.max(1, Math.round(me) - 1), gap: Math.min(0.6, (me - 1.5) / 3) }),
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

const GOALS_MAX = 3; // одновременно: 1 главная + до 2 запасных
const GOALS_MIN = 2; // меньше — добираем целями «до уровня топов»
const EASY_RATE = 0.7; // цель уже выполняется почти всегда — тренировать нечего
const HARD_RATE = 0.15; // цель почти никогда не выполнялась — ставим ступени
const CAL_MIN = 5; // меньше проверенных игр — честность цели не оцениваем
const STUCK_GAMES = 10; // столько игр без заметного сдвига — предложим сменить цель

// Что делать — одной фразой (карточка цели). Нет записи — показываем совет из каталога.
const ACT = {
  d10: 'На линии не начинай размен первым и отходи к башне, когда соперник пропал с карты.',
  d: 'Перед каждой дракой смотри на карту и отступай при половине здоровья.',
  nw10: 'Добивай крипов и сразу забирай сферы душ.',
  lh10: 'Бей крипа, когда у него мало здоровья, и стой ближе к волне.',
  soulsMid: 'Между драками чередуй волну и лес, не стой без дела.',
  firstBigT: 'Заранее выбери главный предмет и копи на него без мелких покупок.',
  firstHugeT: 'Копи на предмет за 6000 между драками, не распыляйся.',
  spikeFights: 'После дорогой покупки ищи безопасную драку.',
  spikeDmg: 'Первые минуты после большого предмета бей по героям, а не по крипам.',
  pu10: 'Ломай контейнеры с бафами, пока волна у врага.',
  neu9: 'Бери ближний лесной лагерь сразу, как он появился.',
  brk9: 'Между волнами заходи за коробками там, где безопасно.',
  lost_souls: 'Перед рискованным пушем проверь мешок душ — потрать или отойди.',
  solo_deaths: 'Не ходи один на чужую половину и к объектам — держись рядом с командой.',
  kp: 'Смотри на карту и иди на ближайшую драку.',
  dmgMin: 'Когда враг рядом — стреляй по нему, а не по крипам.',
  dn10: 'Стреляй по сфере душ, когда враг добивает твоего крипа.',
  bdmgMin: 'После выигранной драки идите всей командой на объект.',
  session: 'После третьей игры подряд сделай перерыв.',
  tilt: 'После поражения подожди хотя бы 10 минут.',
};
// Как проверяем (если общий текст не подходит).
const HOW = {
  solo_deaths: 'После каждой игры считаем смерти после 10:00, когда ближайший живой союзник был дальше ~8 секунд бега.',
  lost_souls: 'После каждой игры смотрим, сколько душ потеряно при каждой смерти.',
  d10: 'После каждой игры считаем твои смерти до 10:00.',
};
// Какое правило «Ошибок» стоит за целью (для основания «в N из M игр»).
const LEAK_OF = { d10: 'lane_trades', solo_deaths: 'solo_deaths', lost_souls: 'lost_souls' };
// Ключ связи с победой у игроков твоего уровня (WIN_LINKS).
const WINLINK_OF = { d10: 'd9', pu10: 'pu10', neu9: 'neu9', brk9: 'brk9' };

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

// ---- честность цели ----
// Доля твоих последних игр, где цель с такой планкой уже выполнялась.
function passRate(goal, games) {
  const res = games.map((g) => checkGame(g, [goal])[0]).filter((r) => r.pass !== null);
  return { n: res.length, rate: res.length ? res.filter((r) => r.pass).length / res.length : null };
}

const grainOf = (cat) => cat.step || (cat.fmt === P ? 0.05 : 1);

// Ступень полегче: на полпути между твоим обычным уровнем и нужной планкой.
function relaxStep(cat, cmp, step, games) {
  const grain = grainOf(cat);
  const med = (hero) => {
    const vals = games.filter((g) => hero === null || g.hero === hero).map((g) => cat.metric(g)).filter((v) => v !== null && v !== undefined && Number.isFinite(v));
    return vals.length >= 2 ? median(vals) : null;
  };
  const easier = (a, b) => (cmp === 'ge' ? a < b : a > b);
  const mid = (target, me) => {
    if (me === null) return null;
    const raw = cmp === 'ge' ? me + (target - me) / 2 : me - (me - target) / 2;
    const v = cmp === 'ge' ? Math.floor(raw / grain + 1e-9) * grain : Math.ceil(raw / grain - 1e-9) * grain;
    return Math.round(v * 1000) / 1000;
  };
  const target = mid(step.target, med(null));
  if (target === null || !easier(target, step.target)) return null;
  let byHero = null;
  if (step.byHero) {
    byHero = {};
    for (const [h, t] of Object.entries(step.byHero)) {
      const v = mid(t, med(Number(h)));
      byHero[h] = v !== null && easier(v, t) ? v : t;
    }
  }
  return { target, byHero };
}

// Проверка цели на реальность по твоим последним играм:
//  — уже выполнялась в 70%+ игр → тренировать нечего (null);
//  — выполнялась в 15% и реже → делаем ступени: сначала полегче, потом нужная планка;
//  — мало проверенных игр → оставляем как есть, но говорим об этом (calib.n).
function calibrate(cand, cat, games) {
  if (cand.habit) return cand;
  const recent = games.slice(-20);
  const base = passRate(cand, recent);
  cand.calib = { n: base.n, rate: base.rate };
  if (base.n < CAL_MIN) return cand;
  if (base.rate >= EASY_RATE) return null;
  if (base.rate > HARD_RATE) return cand;
  const steps = [{ target: cand.target, byHero: cand.byHero }];
  for (let i = 0; i < 2; i++) {
    const relaxed = relaxStep(cat, cand.cmp, steps[0], recent);
    if (!relaxed) break;
    const r = passRate({ ...cand, ...relaxed }, recent);
    if (r.rate !== null && r.rate >= EASY_RATE) break;
    steps.unshift(relaxed);
    if (r.rate === null || r.rate > HARD_RATE) break;
  }
  if (steps.length < 2) return cand;
  const final = steps[steps.length - 1];
  cand.ladder = { i: 0, steps, finalTitle: cat.title(final.target) };
  cand.target = steps[0].target;
  cand.byHero = steps[0].byHero;
  cand.title = cat.title(steps[0].target);
  return cand;
}

// Кандидаты в цели, по убыванию важности. stretch — только «дотянуться до топов».
function candidates({ games, topHero, lobby, extra, exclude = new Set(), stretch = false }) {
  const out = [];
  for (const cat of CATALOG) {
    if (exclude.has(cat.key)) continue;
    const { me, ref } = stats(cat.field || cat.key, games, topHero, lobby);
    let g = stretch ? null : cat.make(me, ref, extra);
    let kind = 'fix';
    if (!g && stretch && cat.stretch) {
      g = cat.stretch(me, ref, extra);
      kind = 'stretch';
    }
    if (!g) continue;
    let byHero = heroTargets(cat, games, topHero);
    if (kind === 'stretch' && byHero) byHero = stretchHeroTargets(cat, games, topHero);
    const cand = calibrate({
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
    }, cat, games);
    if (cand) out.push(cand);
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
    return { key: goal.key, short: goal.short, cmp: goal.cmp, value, target, pass, text: value === null || value === undefined ? '—' : fmtOf(goal.key)(value), targetText: fmtOf(goal.key)(target) };
  });
}

// «Почему именно эта цель»: только то, что реально измерено. Каждая строка помечена видом:
// 'episode' — эпизод из игры, 'stat' — доля игр с ошибкой и победы, 'compare' — сравнение с топами,
// 'link' — связь с победой у игроков твоего уровня (не доказанная причина).
const WHY_MIN_GAMES = 10; // меньше проверенных игр — доли и победы не показываем
function whyOf(goal, data, cat, fmt) {
  const lines = [];
  if (goal.evidence) lines.push({ kind: 'episode', text: goal.evidence.text || goal.evidence.title || 'Эпизод из твоей игры' });
  const ls = data.leakStats && data.leakStats[LEAK_OF[goal.key]];
  if (ls && ls.eligible >= WHY_MIN_GAMES) {
    lines.push({ kind: 'stat', text: `${ls.title ? `«${ls.title}» — ` : 'Замечание — '}в ${ls.count} из ${ls.eligible} проверенных игр.` });
    const without = ls.eligible - ls.count;
    if (ls.count >= 5 && without >= 5 && ls.wrWith !== null && ls.wrWith !== undefined && ls.wrWithout !== null && ls.wrWithout !== undefined) {
      lines.push({ kind: 'link', text: `Побед в этих играх ${P(ls.wrWith)}, в играх без этого замечания — ${P(ls.wrWithout)}.` });
    }
  }
  if (goal.ref !== null && goal.ref !== undefined && goal.baseline !== null && goal.baseline !== undefined && cat && !cat.habit && fmt(goal.baseline) !== fmt(goal.ref)) {
    lines.push({ kind: 'compare', text: `У тебя обычно ${fmt(goal.baseline)}, у топов на твоих героях — ${fmt(goal.ref)}.` });
  }
  const wl = WINLINK_OF[goal.key] && goal.baseline !== null && goal.baseline !== undefined ? winLink(WINLINK_OF[goal.key], goal.baseline) : null;
  if (wl && !lines.some((l) => l.kind === 'link')) {
    lines.push({ kind: 'link', text: `У игроков рангов 4–6 при таком значении побед около ${P(wl.wr)}, у лучших по этому показателю — около ${P(wl.best[1])}.` });
  }
  return { lines, note: lines.some((l) => l.kind === 'link' || l.kind === 'stat') ? 'Это связь, а не доказанная причина поражений.' : null };
}

/**
 * state — сохранённое состояние тренера ({ plan, archive, done }).
 * data  — { games (по возрастанию времени), topHero, lobby, extra, now, mainMistake(game) }.
 * Возвращает { state, view }.
 */
function updateCoach(state, data, { forceNew = false, focusEvidence = null, replaceKey = null } = {}) {
  const now = data.now || Math.floor(Date.now() / 1000);
  const games = [...new Map(data.games.map((g) => [g.match_id, g])).values()];
  const loaded = games.filter((g) => g.f);
  const st = { plan: null, archive: [], log: [], ...(state || {}) };
  const events = [];
  const logEvent = (e) => {
    st.log = (st.log || []).concat([e]).slice(-40);
  };

  const makePlan = (reason) => {
    const recent = loaded.slice(-25);
    const recentlyDone = new Set((st.archive || []).filter((g) => (g.status === 'done' && now - (g.doneAt || 0) < 14 * DAY) || (g.userReplaced && now - (g.endedAt || 0) < 14 * DAY)).map((g) => g.key));
    const goals = chooseGoals(data, recent, recentlyDone);
    st.plan = { createdAt: now, reason, goals: goals.map((g) => ({ ...g, status: 'active', startedAt: now })) };
    const text = goals.length ? goals.map((g) => g.title).join(' · ') : 'Явных проблем не нашлось — продолжай в том же духе, а я слежу за каждой игрой.';
    // «Новый план» с теми же целями — не повторяем сообщение, а обновляем время старого
    const prev = (st.log || []).slice().reverse().find((e) => e.kind === 'plan' && e.title === 'Новый план на неделю');
    if (prev && prev.text === text && now - prev.t < DAY) prev.t = now;
    else logEvent({ t: now, kind: 'plan', title: 'Новый план на неделю', text });
  };

  // План не истекает по календарю: цель живёт, пока не выполнена или пока ты её не сменил.
  if (!st.plan || forceNew) {
    if (st.plan) st.archive = (st.archive || []).concat(st.plan.goals.map((g) => ({ ...g, status: g.status === 'done' ? 'done' : 'replaced', endedAt: now }))).slice(-60);
    if (loaded.length >= 5) makePlan(forceNew ? 'manual' : 'first');
  }
  // Сменить одну цель: старая уходит в архив, на её место берётся другая.
  if (replaceKey && st.plan) {
    const old = st.plan.goals.find((g) => g.key === replaceKey && g.status === 'active');
    if (old) {
      old.status = 'replaced';
      old.userReplaced = true;
      old.endedAt = now;
      logEvent({ t: now, kind: 'plan', title: 'Цель заменена', text: old.title });
    }
  }
  let plan = st.plan;
  if (!plan) {
    if (focusEvidence && loaded.length) {
      // План из одного эпизода: цель появляется сразу, даже если игр меньше пяти.
      // Остальные цели доберутся, когда наберётся статистика. Прогресс считается
      // только по играм после этого момента — момент виден игроку в ленте.
      plan = { createdAt: now, reason: 'episode', goals: [] };
      st.plan = plan;
      logEvent({ t: now, kind: 'plan', title: 'Новый план на неделю', text: 'Цель из эпизода. Прогресс считается по играм после этого момента.' });
    } else {
      return { state: st, view: { plan: null, cards: [], goals: [], events: st.log || [], need: Math.max(0, 5 - loaded.length) } };
    }
  }

  if (focusEvidence && (plan.focusEvidence?.matchId !== focusEvidence.matchId || plan.focusEvidence?.t !== focusEvidence.t
    || plan.focusEvidence?.key !== focusEvidence.key)) {
    const soulGoal = focusEvidence.key === 'lost_souls';
    const soloGoal = focusEvidence.key === 'solo_deaths';
    const key = soulGoal ? 'lost_souls' : soloGoal ? 'solo_deaths' : 'd10';
    const target = soulGoal ? 0 : 1;
    const current = plan.goals.find((g) => g.key === key && g.status === 'active');
    const catalog = CATALOG.find((g) => g.key === key);
    const prior = loaded.filter((g) => g.start_time < now).slice(-20).map(catalog.metric).filter(Number.isFinite);
    const focus = { ...current, key, family: catalog.family, area: catalog.area, short: catalog.short, cmp: catalog.cmp,
      title: catalog.title(target), target, byHero: null, tip: soulGoal || soloGoal ? catalog.tip : 'После неудачного размена отойди и восстанови здоровье.',
      baseline: prior.length ? median(prior) : null, status: 'active', startedAt: now, evidence: focusEvidence };
    plan.goals = [focus, ...plan.goals.filter((g) => g.key !== key)];
    plan.focusEvidence = focusEvidence;
  }
  const goalStart = (goal) => goal.startedAt - (goal.evidence ? 0 : 60);

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
      const res = after.filter((g) => g.start_time >= goalStart(goal)).map((g) => checkGame(g, [goal])[0]).filter((r) => r.pass !== null);
      const last = res.slice(-5);
      if (last.length >= 5 && last.filter((r) => r.pass).length >= 4) {
        const ladder = goal.ladder;
        if (ladder && ladder.i < ladder.steps.length - 1) {
          // Ступень пройдена: планка становится выше, счёт игр начинается заново.
          const cat = CATALOG.find((c) => c.key === goal.key);
          const prevTitle = goal.title;
          ladder.i += 1;
          goal.target = ladder.steps[ladder.i].target;
          goal.byHero = ladder.steps[ladder.i].byHero;
          goal.title = cat ? cat.title(goal.target) : goal.title;
          goal.startedAt = now;
          logEvent({ t: now, kind: 'step', title: 'Ступень пройдена', text: `«${prevTitle}» — ${last.filter((r) => r.pass).length} из 5 последних игр. Дальше: «${goal.title}».` });
          changed = true;
          continue;
        }
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
  const playedAfter = games.filter((g) => g.start_time >= plan.createdAt - 60);
  const cardGames = (playedAfter.length ? playedAfter : before).slice(-15);
  const cards = cardGames.map((g) => {
    const checks = checkGame(g, goalsAll.filter((x) => goalStart(x) <= g.start_time || !playedAfter.length));
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
      beforePlan: !playedAfter.length,
    };
  }).reverse();

  // Прогресс по целям: значения по играм (последние 15) + доля выполнения
  const goals = goalsAll.map((goal) => {
    const rows = loaded.slice(-20).map((g) => {
      const c = checkGame(g, [goal])[0];
      return { match_id: g.match_id, t: g.start_time, hero: g.hero, value: c.value, text: c.text, target: c.target, pass: c.pass, afterStart: g.start_time >= goalStart(goal) };
    }).filter((r) => r.value !== null && r.value !== undefined);
    const since = rows.filter((r) => r.afterStart && r.pass !== null);
    const prior = rows.filter((r) => !r.afterStart && r.pass !== null);
    const fmt = fmtOf(goal.key);
    const passedN = since.filter((r) => r.pass).length;
    let streak = 0;
    for (let i = since.length - 1; i >= 0 && since[i].pass; i--) streak += 1;
    let best = 0;
    let run = 0;
    for (const r of since) {
      run = r.pass ? run + 1 : 0;
      best = Math.max(best, run);
    }
    const last5 = since.slice(-5);
    const medOf = (list) => {
      const vals = list.map((r) => r.value).filter((v) => Number.isFinite(v));
      return vals.length >= 3 ? median(vals) : null;
    };
    const valBefore = prior.length >= 3 ? medOf(prior) : null;
    const valNow = medOf(last5);
    const cat = CATALOG.find((c) => c.key === goal.key);
    return {
      ...goal,
      byHero: goal.byHero,
      rows,
      games: since.length,
      passed: passedN,
      rate: since.length ? passedN / since.length : null,
      priorRate: prior.length ? prior.filter((r) => r.pass).length / prior.length : null,
      priorGames: prior.length,
      streak,
      bestStreak: best,
      // До закрытия: нужно 4 из 5 последних игр после старта (или после старта ступени).
      close: { passed: last5.filter((r) => r.pass).length, of: last5.length, needGames: Math.max(0, 5 - last5.length) },
      stuck: goal.status === 'active' && since.length >= STUCK_GAMES && passedN / since.length < 0.2 && streak === 0,
      act: ACT[goal.key] || goal.tip || null,
      how: HOW[goal.key] || `После каждой игры смотрим «${goal.short}» по данным матча. Игра без данных не считается.`,
      why: whyOf(goal, data, cat, fmt),
      ladderInfo: goal.ladder ? { step: goal.ladder.i + 1, of: goal.ladder.steps.length, finalTitle: goal.ladder.finalTitle } : null,
      beforeText: valBefore === null ? null : fmt(valBefore),
      nowText: valNow === null || last5.length < 3 ? null : fmt(valNow),
      targetText: fmt(goal.target),
      baselineText: goal.baseline === null || goal.baseline === undefined ? '—' : fmt(goal.baseline),
    };
  });

  // Выполненные цели без повторов: цель из плана и из архива; одинаковые (ключ + название) склеены.
  const finished = [];
  const seenDone = new Set();
  const doneRaw = goals.filter((g) => g.status === 'done').concat((st.archive || []).filter((g) => g.status === 'done').slice().reverse());
  for (const g of doneRaw) {
    const id = `${g.key}|${g.title}`;
    if (seenDone.has(id)) continue;
    seenDone.add(id);
    finished.push({ key: g.key, title: g.title, area: g.area, doneAt: g.doneAt || g.endedAt || null, beforeText: g.beforeText || null, nowText: g.nowText || null, games: g.games || null, passed: g.passed || null });
  }

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
      plan: { createdAt: plan.createdAt, reason: plan.reason },
      goals,
      active: activeGoals.length,
      done: finished.length,
      finished,
      cards,
      events: (st.log || []).concat(events).sort((a, b) => b.t - a.t).slice(0, 30),
      score,
      gamesSince: after.length,
      archive: (st.archive || []).slice(-12).reverse(),
    },
  };
}

module.exports = { updateCoach, checkGame, candidates, pickGoals, chooseGoals, calibrate, CATALOG, GOALS_MAX, GOALS_MIN };
