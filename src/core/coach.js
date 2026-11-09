'use strict';
// Личный тренер: превращает главные проблемы в 2–3 цели на неделю,
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
// make() возвращает цель или null, если по этой метрике у тебя всё хорошо.
const CATALOG = [
  {
    key: 'd10', fmt: (v) => D1(v), area: 'Выживание', cmp: 'le', heroSpecific: false,
    metric: (g) => g.f && g.f.d10,
    make: (me, ref) => {
      if (me === null || me < 0.75) return null;
      const target = Math.max(0, Math.floor(me) - 1);
      return { target, gap: me - (ref ?? 0.6), title: target === 0 ? 'Не умирать до 10:00' : `Не больше ${target} ${plural(target, 'смерти', 'смертей', 'смертей')} до 10:00`, short: 'смерти до 10:00', fmt: (v) => D1(v), tip: 'На линии не начинай размен первым, а когда противник с соседней линии пропал с карты — отходи к своей башне.' };
    },
  },
  {
    key: 'd', fmt: (v) => D1(v), area: 'Выживание', cmp: 'le', heroSpecific: false,
    metric: (g) => g.f && g.f.d,
    make: (me, ref) => {
      if (me === null || ref === null || me <= ref + 0.8) return null;
      const target = Math.max(Math.round(ref), Math.floor(me - Math.max(1, (me - ref) / 2)));
      return { target, gap: (me - ref) / Math.max(1, ref), title: `Не больше ${target} ${plural(target, 'смерти', 'смертей', 'смертей')} за игру`, short: 'смерти за игру', fmt: (v) => D1(v), tip: 'Перед каждым заходом в драку смотри на карту: где враги, которых не видно? Отступай при половине здоровья.' };
    },
  },
  {
    key: 'nw10', fmt: N, area: 'Фарм', cmp: 'ge', heroSpecific: true, step: 100,
    metric: (g) => g.f && g.f.nw10,
    make: (me, ref) => {
      if (me === null || ref === null || me >= ref * 0.93) return null;
      const target = round(me + (ref - me) * 0.6, 100);
      return { target, gap: (ref - me) / ref, title: `К 10:00 — от ${N(target)} душ`, short: 'души к 10:00', fmt: N, tip: 'Добивай каждого крипа последним выстрелом и сразу забирай сферу души. В лес — только когда волна запушена.' };
    },
  },
  {
    key: 'lh10', fmt: N, area: 'Фарм', cmp: 'ge', heroSpecific: true, step: 1,
    metric: (g) => g.f && g.f.lh10,
    make: (me, ref) => {
      if (me === null || ref === null || ref < 15 || me >= ref * 0.9) return null;
      const target = Math.round(me + (ref - me) * 0.6);
      return { target, gap: (ref - me) / ref, title: `Добивать от ${target} крипов к 10:00`, short: 'крипы к 10:00', fmt: N, tip: 'Стой ближе к волне и бей крипа, когда у него мало здоровья. Полных крипов не трогай.' };
    },
  },
  {
    key: 'soulsMid', fmt: N, area: 'Фарм', cmp: 'ge', heroSpecific: true, step: 25,
    metric: (g) => g.f && g.f.soulsMid,
    make: (me, ref) => {
      if (me === null || ref === null || me >= ref * 0.9) return null;
      const target = round(me + (ref - me) * 0.6, 25);
      return { target, gap: (ref - me) / ref, title: `С 10 до 20 минуты — от ${N(target)} душ в минуту`, short: 'души/мин в середине', fmt: N, tip: 'Между драками чередуй: волна → лагерь в лесу → волна. Стоять и ждать нельзя.' };
    },
  },
  {
    key: 'firstBigT', fmt: T, area: 'Предметы', cmp: 'le', heroSpecific: true, step: 30,
    metric: (g) => g.f && g.f.firstBigT,
    make: (me, ref) => {
      if (me === null || ref === null || me <= ref + 90) return null;
      const target = round(me - (me - ref) * 0.6, 30);
      return { target, gap: (me - ref) / ref, title: `Первый предмет за 3000+ — до ${T(target)}`, short: 'первый дорогой предмет', fmt: T, tip: 'Решай заранее, какой предмет главный, и копи на него, не покупая мелочь по дороге.' };
    },
  },
  {
    key: 'kp', fmt: P, area: 'Драки', cmp: 'ge', heroSpecific: false,
    metric: (g) => g.f && g.f.kp,
    make: (me, ref) => {
      if (me === null || ref === null || me >= ref - 0.05) return null;
      const target = Math.round((me + (ref - me) * 0.7) * 20) / 20;
      return { target, gap: (ref - me) / ref, title: `Участвовать в ${P(target)} убийств команды`, short: 'участие в убийствах', fmt: P, tip: 'Каждые несколько секунд смотри на карту и иди на ближайшую драку — помощь даёт почти столько же душ, сколько убийство.' };
    },
  },
  {
    key: 'dmgMin', fmt: N, area: 'Драки', cmp: 'ge', heroSpecific: true, step: 25,
    metric: (g) => g.f && g.f.dmgMin,
    make: (me, ref) => {
      if (me === null || ref === null || me >= ref * 0.88) return null;
      const target = round(me + (ref - me) * 0.6, 25);
      return { target, gap: (ref - me) / ref, title: `Урон по героям — от ${N(target)} в минуту`, short: 'урон по героям/мин', fmt: N, tip: 'Когда враг рядом — стреляй по нему, а не по крипам. После покупки ключевого предмета ищи драку.' };
    },
  },
  {
    key: 'dn10', fmt: N, area: 'Линия', cmp: 'ge', heroSpecific: false,
    metric: (g) => g.f && g.f.dn10,
    make: (me, ref) => {
      if (me === null || ref === null || ref < 3 || me >= ref * 0.7) return null;
      const target = Math.max(2, Math.round(me + (ref - me) * 0.6));
      return { target, gap: (ref - me) / ref * 0.7, title: `Отбирать от ${target} сфер к 10:00`, short: 'отобранные сферы', fmt: N, tip: 'Когда враг добивает твоего крипа — стреляй по вылетевшей сфере раньше него.' };
    },
  },
  {
    key: 'bdmgMin', fmt: N, area: 'Объекты', cmp: 'ge', heroSpecific: false, step: 10,
    metric: (g) => g.f && g.f.bdmgMin,
    make: (me, ref) => {
      if (me === null || ref === null || ref < 30 || me >= ref * 0.7) return null;
      const target = round(me + (ref - me) * 0.6, 10);
      return { target, gap: (ref - me) / ref * 0.8, title: `Урон по объектам — от ${N(target)} в минуту`, short: 'урон по объектам', fmt: N, tip: 'После выигранной драки сразу всей командой на стража или ходока.' };
    },
  },
  {
    key: 'session', fmt: (v) => `${v}-я`, area: 'Режим', cmp: 'le', heroSpecific: false, habit: true,
    metric: (g) => g.pos,
    make: (me, ref, extra) => {
      if (!extra || !extra.fatigue) return null;
      return { target: 3, gap: 0.25, title: 'Перерыв после 3 игр подряд', short: 'номер игры в сессии', fmt: (v) => `${v}-я`, tip: 'После третьей игры подряд встань хотя бы на 15 минут: усталость незаметно съедает реакцию и решения.' };
    },
  },
  {
    key: 'tilt', fmt: (v) => `${Math.round(v)} мин`, area: 'Настрой', cmp: 'ge', heroSpecific: false, habit: true,
    metric: (g) => (g.afterLoss ? g.gapMin : null),
    make: (me, ref, extra) => {
      if (!extra || !extra.tilt) return null;
      return { target: 10, gap: 0.22, title: 'После поражения — пауза хотя бы 10 минут', short: 'пауза после поражения', fmt: (v) => `${Math.round(v)} мин`, tip: 'Не жми «Найти игру» сразу после обидного поражения. Пара минут разбора в «Моих матчах» — и следующая игра пойдёт лучше.' };
    },
  },
];

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

// Кандидаты в цели, по убыванию важности.
function candidates({ games, topHero, lobby, extra, exclude = new Set() }) {
  const out = [];
  for (const cat of CATALOG) {
    if (exclude.has(cat.key)) continue;
    const { me, ref } = stats(cat.key, games, topHero, lobby);
    const g = cat.make(me, ref, extra);
    if (!g) continue;
    out.push({
      key: cat.key,
      area: cat.area,
      cmp: cat.cmp,
      habit: !!cat.habit,
      title: g.title,
      short: g.short,
      tip: g.tip,
      target: g.target,
      byHero: heroTargets(cat, games, topHero),
      baseline: me,
      ref,
      gap: g.gap,
    });
  }
  return out.sort((a, b) => b.gap - a.gap);
}

function pickGoals(cands, n = 3) {
  const res = [];
  const areas = new Set();
  // не больше одной привычки и не больше одной цели на раздел
  let habit = false;
  for (const c of cands) {
    if (res.length >= n) break;
    if (areas.has(c.area)) continue;
    if (c.habit && habit) continue;
    if (c.habit) habit = true;
    areas.add(c.area);
    res.push(c);
  }
  return res;
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
    const goals = pickGoals(candidates({ games: recent, topHero: data.topHero, lobby: data.lobby, extra: data.extra, exclude: recentlyDone }));
    st.plan = { createdAt: now, reason, goals: goals.map((g) => ({ ...g, status: 'active', startedAt: now })) };
    logEvent({ t: now, kind: 'plan', title: 'Новый план на неделю', text: goals.length ? goals.map((g) => g.title).join(' · ') : 'Явных проблем не нашлось — продолжай в том же духе, а я слежу за каждой игрой.' });
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
        const active = new Set(plan.goals.map((g) => g.key));
        const next = pickGoals(candidates({ games: loaded.slice(-25), topHero: data.topHero, lobby: data.lobby, extra: data.extra, exclude: active }).filter((c) => !plan.goals.some((g) => g.status === 'active' && g.area === c.area)), 1)[0];
        if (next) {
          plan.goals.push({ ...next, status: 'active', startedAt: now });
          logEvent({ t: now, kind: 'plan', title: 'Новая цель', text: next.title });
        }
        changed = true;
      }
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

module.exports = { updateCoach, checkGame, candidates, pickGoals, CATALOG };
