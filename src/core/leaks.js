'use strict';
// Разбор ошибок по одной игре с конкретными моментами («где и когда») и общая
// картина по последним играм: что чаще всего мешает побеждать и сколько это стоит.
//
// Опирается на данные, которые есть в матче с версии 0.11 (см. extract.js):
//   - маршруты героев по 5 секунд: позиция, жив ли, с кем бился (1 герои, 2 крипы линии, 4 лес), здоровье;
//   - урон между игроками по времени (раз в 3 минуты);
//   - души по источникам: коробки, лес, потери при смерти (урна душ — командная, в ошибки не идёт);
//   - время получения постоянных бафов (контейнеры с бафами — бывшие золотые статуи — и джекпот Sinner's).
//
// Тайминги карты (патч 30.10.2026, deadlockhandbook.com и senseos.gg; проверено по данным матчей):
//   коробки и контейнеры с бафами — с 3:00, снова через 3 мин после поломки (в туннелях 5 мин);
//   лес: малый лагерь 2:00 (снова через 1:25), средний 5:00 (4:50), большой 8:00 (5:35);
//   Sinner's Sacrifice — с 8:00, снова через 5 мин после поломки; ~340 душ, джекпот тяжёлым ударом — 4 бафа.
//
// Цифры для сравнения: топы на твоём герое (ref) или, если их данных ещё нет,
// медианы по рангам из 640 тыс. рейтинговых игр (RANK_BENCH, deadlock-api, ноябрь 2026).

const { valueAt } = require('./timeline');
const { N, T, plural } = require('./tipkit');
const { soloDeathRows, soloDeathsVerifiable, lateDeathCount } = require('./deaths');

// Души всегда целые: медианы и расчётные остатки бывают дробными («379 души» вместо «380 душ»).
const souls = (n) => `${N(Math.round(n))} ${plural(Math.round(n), 'душа', 'души', 'душ')}`;
// винительный падеж: «потерял 1 551 душу»
const soulsAcc = (n) => `${N(Math.round(n))} ${plural(Math.round(n), 'душу', 'души', 'душ')}`;

// Медианы по рангу (average_badge // 10). Рейтинг, игры от 25 минут, 2 дня, 640 тыс. игроко-игр.
// d10 — смерти до 9–10 минуты (медиана 1 на всех рангах: высокие ранги умирают рано не реже),
// brk — души с коробок, neu — души с леса, pu — постоянные бафы (контейнеры и джекпот Sinner's), nw — души всего.
const RANK_BENCH = {
  1: { d10: 1, brk9: 161, brk20: 886, neu9: 144, neu20: 1239, pu10: 1, pu20: 6, nw9: 5671, nw20: 16825 },
  2: { d10: 1, brk9: 232, brk20: 1145, neu9: 232, neu20: 1556, pu10: 1, pu20: 7, nw9: 5805, nw20: 17079 },
  3: { d10: 1, brk9: 301, brk20: 1412, neu9: 282, neu20: 1976, pu10: 2, pu20: 9, nw9: 5927, nw20: 17498 },
  4: { d10: 1, brk9: 382, brk20: 1701, neu9: 349, neu20: 2355, pu10: 3, pu20: 11, nw9: 6083, nw20: 18039 },
  5: { d10: 1, brk9: 459, brk20: 1921, neu9: 409, neu20: 2619, pu10: 3, pu20: 13, nw9: 6225, nw20: 18471 },
  6: { d10: 1, brk9: 515, brk20: 2057, neu9: 443, neu20: 2773, pu10: 4, pu20: 14, nw9: 6324, nw20: 18739 },
  7: { d10: 1, brk9: 546, brk20: 2114, neu9: 471, neu20: 2878, pu10: 4, pu20: 14, nw9: 6401, nw20: 18923 },
  8: { d10: 1, brk9: 579, brk20: 2158, neu9: 496, neu20: 2960, pu10: 5, pu20: 15, nw9: 6499, nw20: 19136 },
  9: { d10: 1, brk9: 617, brk20: 2211, neu9: 537, neu20: 3050, pu10: 5, pu20: 15, nw9: 6635, nw20: 19365 },
  10: { d10: 1, brk9: 669, brk20: 2225, neu9: 585, neu20: 3068, pu10: 6, pu20: 16, nw9: 6831, nw20: 19580 },
};
const TOP_TIER = 10;

// Как привычки до 10:00 связаны с победой у игроков рангов 4–6 (бейдж 40–66, 366 тыс. игроко-игр).
// Это не «причина → следствие», но хорошо показывает, что важно.
const WIN_LINKS = {
  d9: [[0, 0.543], [1, 0.505], [2, 0.473], [3, 0.443], [4, 0.414]],
  pu10: [[0, 0.477], [3, 0.492], [6, 0.519], [8, 0.531]],
  neu9: [[0, 0.487], [600, 0.507], [1050, 0.536]],
  brk9: [[0, 0.479], [450, 0.507], [900, 0.516]],
};

const SPEED = 320; // средняя скорость героя, единиц карты в секунду (медиана по маршрутам)
const FIGHT_FAR = 3000; // дальше этого — не участвовал в драке (≈10 секунд бега)
const FIGHT_REACH = 9000; // дальше этого — не успел бы добежать (≈28 секунд)
const LANE_END = 600; // до 10:00 — стадия линий

// Серия смертей: 3+ смерти после 10:00, между соседними не больше этого
const STREAK_GAP = 240;
// предмет живучести считается заметной покупкой от этой цены (душ)
const VITALITY_COST = 1250;
// после последней смерти серии должно остаться столько секунд игры,
// чтобы покупка успела случиться, — иначе серия не проверяется
const REACT_SECS = 90;
const SOUL_LOSS_THRESHOLD = 1000;
// доля побед показывается, только если в каждой из сравниваемых групп не меньше стольких игр (на 3 играх «100%» — шум)
const MIN_WR_GAMES = 5;
// «богатая» смерть: расчётный остаток (нижняя оценка) от этой суммы
const RICH = 3000;

const clampTier = (t) => (t ? Math.max(1, Math.min(TOP_TIER, t)) : null);

// Ориентир: топы на этом герое, иначе — высокий ранг; плюс медиана твоего ранга.
function benchFor(key, ref, tier) {
  const r = ref && ref[key] && ref[key].n >= 4 && ref[key].med !== null ? ref[key].med : null;
  const top = RANK_BENCH[TOP_TIER][key] ?? null;
  const mine = tier ? RANK_BENCH[clampTier(tier)][key] ?? null : null;
  return { target: r ?? top, fromTops: r !== null, rankMed: mine, topRank: top };
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Точки маршрута игрока в промежутке [a, b] секунд.
function pathPoints(m, slot, a, b) {
  const pp = m.paths && m.paths.players && m.paths.players[slot];
  if (!pp) return null;
  const step = m.paths.step || 5;
  const out = [];
  for (let i = Math.max(0, Math.floor(a / step)); i <= Math.min(pp.length - 1, Math.ceil(b / step)); i++) out.push({ t: i * step, p: pp[i] });
  return out;
}

// Драки: смерти героев, близкие по времени (≤15 с между соседними) и по месту (≤4000).
function findFights(m) {
  const ev = [];
  for (const p of m.players) {
    for (const d of p.deaths || []) {
      const [t, x, y, killer] = d;
      if (typeof t !== 'number') continue;
      ev.push({ t, x, y, killer, team: p.team, slot: p.slot, hero: p.hero_id });
    }
  }
  ev.sort((a, b) => a.t - b.t);
  const fights = [];
  for (const e of ev) {
    const f = fights[fights.length - 1];
    const near = f && e.t - f.t1 <= 15 && (e.x === null || f.x === null || Math.hypot(e.x - f.x, e.y - f.y) <= 4000);
    if (near) {
      f.deaths.push(e);
      f.t1 = e.t;
      const pos = f.deaths.filter((d) => d.x !== null);
      if (pos.length) {
        f.x = pos.reduce((s, d) => s + d.x, 0) / pos.length;
        f.y = pos.reduce((s, d) => s + d.y, 0) / pos.length;
      }
    } else {
      fights.push({ t0: e.t, t1: e.t, x: e.x, y: e.y, deaths: [e] });
    }
  }
  return fights;
}

// Души, потерянные в каждой смерти: по снимкам статистики, где между снимками ровно одна смерть.
function lossPerDeath(me) {
  const st = me.stats || [];
  if (!st.length || st[0].g_lost === undefined) return [];
  const out = [];
  let prev = { t: 0, g_lost: 0, d: 0 };
  for (const s of st) {
    const dd = s.d - prev.d;
    const lost = s.g_lost - prev.g_lost;
    if (dd === 1) {
      const events = (me.deaths_t || []).filter((x) => x > prev.t && x <= s.t);
      if (events.length === 1 && Number.isFinite(lost) && lost >= 0) out.push({ t: events[0], lost });
    }
    prev = s;
  }
  return out;
}

// В части старых матчей API не отдаёт потери душ вообще: у всех игроков ноль, хотя смертей много.
// Такой «ноль» — отсутствие данных, а не «ни одной потери»; иначе игра выглядела бы чистой.
function lostTracked(m) {
  return !!m && (m.players || []).some((p) => (p.stats?.at(-1)?.g_lost || 0) > 0);
}

function majorSoulLosses(me, endS, losses = lossPerDeath(me), m = null) {
  const last = me.stats?.at(-1);
  if (m && !lostTracked(m)) return null;
  if (!last || !Number.isFinite(endS) || last.t < endS - 65
    || !me.stats.every((s, i) => Number.isFinite(s.g_lost) && s.g_lost >= (me.stats[i - 1]?.g_lost ?? 0))
    || !Number.isInteger(me.d) || last.d !== me.d || losses.length !== me.d) return null;
  return losses.filter((x) => x.lost >= SOUL_LOSS_THRESHOLD).length;
}

// Души в кармане в момент t: накопленные минус потраченные на предметы.
function unspentAt(me, t, assets) {
  const cost = (id) => (assets && assets.items && assets.items[id] && assets.items[id].cost) || null;
  const items = (me.items || []).filter(([id]) => cost(id));
  if (!items.length || !assets || !assets.items) return null;
  const nw = valueAt(me.stats || [], 'nw', t);
  if (nw === null) return null;
  const spent = items.filter(([, bt]) => bt <= t).reduce((s, [id]) => s + cost(id), 0);
  return nw - spent;
}

/**
 * Ошибки в одной игре.
 * c = { m, me, f, ref, tier, assets, counters, laneVs, heroName, itemName }
 *   f       — признаки игры (features.js)
 *   ref     — признаки топов на этом герое (refAll), может быть пустым
 *   tier    — твой ранг (1–11), для сравнения с игроками твоего уровня
 *   counters— { [enemyHeroId]: [{ id, lift, rateVs }] } — что топы чаще берут против героя
 *   laneVs  — { [enemyHeroId]: delta } — насколько твой герой хуже/лучше против героя (по топам)
 */
function gameLeaks(c) {
  const { m, me, f } = c;
  const heroName = c.heroName || ((id) => `#${id}`);
  const itemName = c.itemName || ((id) => `#${id}`);
  const out = [];
  if (!m || !me || !f) return out;
  const endS = m.duration_s || 0;
  const bySlot = new Map(m.players.map((p) => [p.slot, p]));
  const enemies = m.players.filter((p) => p.team !== me.team);
  const allies = m.players.filter((p) => p.team === me.team && p !== me);
  const checked = (key) => c.checked?.add(key);

  // ---------- 1. Линия: размены в пользу врага ----------
  const foes = me.lane !== null && me.lane !== undefined ? enemies.filter((p) => p.lane === me.lane) : [];
  if (foes.length && m.dmg && Array.isArray(m.dmg.t)) {
    let idx = -1;
    m.dmg.t.forEach((t, i) => {
      if (t <= LANE_END) idx = i;
    });
    if (idx >= 0) {
      const sum = (keys) => keys.reduce((s, k) => s + ((m.dmg.d[k] || [])[idx] || 0), 0);
      const out9 = sum(foes.map((e) => `${me.slot}>${e.slot}`));
      const in9 = sum(foes.map((e) => `${e.slot}>${me.slot}`));
      const foeSlots = new Set(foes.map((e) => e.slot));
      const laneDeaths = (me.deaths || []).filter((d) => d[0] <= LANE_END && foeSlots.has(d[3]));
      const tAt = m.dmg.t[idx];
      if (tAt >= Math.min(endS, LANE_END) - 65 && Number.isFinite(me.d10 ?? f.d10)) checked('lane_trades');
      const worstFoe = foes.slice().sort((a, b) => ((m.dmg.d[`${b.slot}>${me.slot}`] || [])[idx] || 0) - ((m.dmg.d[`${a.slot}>${me.slot}`] || [])[idx] || 0))[0];
      const vs = c.laneVs && worstFoe ? c.laneVs[worstFoe.hero_id] : null;
      if (in9 >= out9 * 1.5 && in9 - out9 >= 800 && laneDeaths.length >= 1) {
        const hard = typeof vs === 'number' && vs <= -0.02;
        out.push({
          key: 'lane_trades',
          area: 'Линия',
          level: 'bad',
          score: 70 + laneDeaths.length * 8,
          title: 'Получил больше урона от соперников по линии',
          groupTitle: 'Размены на линии шли в пользу врага',
          text: `К ${T(tAt)} ты нанёс соперникам по линии ${N(out9)} урона и получил от них ${N(in9)}. До ${T(LANE_END)} погибал от них ${laneDeaths.length} ${plural(laneDeaths.length, 'раз', 'раза', 'раз')}.`,
          context: hard ? `В сохранённой выборке ${heroName(me.hero_id)} реже выигрывал против ${heroName(worstFoe.hero_id)}. Причину отдельной смерти лучше проверить по эпизоду.`
            : 'Чтобы оценить решение, посмотри в эпизоде, с каким здоровьем и из какой позиции ты начал размен.',
          fix: ['Если перед следующим разменом у тебя мало здоровья, отойди и восстановись.'],
          moments: laneDeaths.map((d) => ({ t: d[0], x: d[1], y: d[2], text: `умер от ${heroName((bySlot.get(d[3]) || {}).hero_id)}` })),
          cost: { deaths: laneDeaths.length },
          facts: { out9, in9, vs },
        });
      } else if (typeof vs === 'number' && vs <= -0.03 && laneDeaths.length === 0 && f.lh10 !== null) {
        out.push({
          key: 'lane_hard_ok',
          area: 'Линия',
          level: 'good',
          score: 20,
          title: `Пережил тяжёлую линию против ${heroName(worstFoe.hero_id)}`,
          text: `Матчап в пользу врага (у топов −${Math.round(-vs * 100)}%), но ты ни разу не умер до 10:00. Так и надо: в слабой линии главное — не отдать смерти.`,
          fix: [],
          moments: [],
          cost: {},
        });
      }
    }
  }

  // ---------- 2. Бил лес (или крипов), пока команда дралась ----------
  if (m.paths && m.paths.players && m.paths.players[me.slot]) {
    const missed = [];
    let fightChecks = 0;
    let incompleteFights = false;
    for (const fight of findFights(m)) {
      if (fight.t0 < LANE_END) continue;
      const allyDeaths = fight.deaths.filter((d) => d.team === me.team).length;
      const enemyDeaths = fight.deaths.length - allyDeaths;
      // только настоящие драки, которые команда проиграла
      if (fight.deaths.length < 2 || allyDeaths <= enemyDeaths || fight.deaths.some((d) => d.slot === me.slot)) continue;
      if (!fight.deaths.every((d) => Number.isFinite(d.x) && Number.isFinite(d.y))) {
        incompleteFights = true;
        continue;
      }
      const pts = pathPoints(m, me.slot, fight.t0 - 15, fight.t1);
      const step = m.paths.step || 5;
      if (!pts?.length || pts.at(-1).t < fight.t1 - step || pts.some(({ p }) =>
        !Number.isFinite(p?.[0]) || !Number.isFinite(p?.[1]) || !Number.isFinite(p?.[3]))) {
        incompleteFights = true;
        continue;
      }
      if (pts.some((q) => !q.p[2])) continue; // был мёртв — не в счёт
      fightChecks += 1;
      // смотрим только на время самой драки (шаг маршрута до первой смерти и после последней): что игрок делал
      // за 15 секунд до неё, к этой драке не относится, а подход к месту драки означает, что он успевал
      const during = pts.filter((q) => q.t >= fight.t0 - step && q.t <= fight.t1 + step);
      const mask = during.reduce((s, q) => s | (q.p[3] || 0), 0);
      if (mask & 1) continue; // дрался с героями — значит, участвовал
      // ближайшая точка к драке за её время: если он подошёл ближе FIGHT_FAR — был рядом, а не «фармил вдали»
      const far = Math.min(...during.map((q) => dist([q.p[0], q.p[1]], [fight.x, fight.y])));
      if (far < FIGHT_FAR || far > FIGHT_REACH) continue;
      const farming = mask & 6;
      if (!farming) continue;
      missed.push({ t: fight.t0, x: fight.x, y: fight.y, allyDeaths, enemyDeaths, far, jungle: !!(mask & 4), sec: Math.round(far / SPEED) });
    }
    const lostOnes = missed;
    if (fightChecks && !incompleteFights) checked('farm_while_fight');
    const allyDeathsTotal = missed.reduce((s, x) => s + x.allyDeaths, 0);
    if (lostOnes.length >= 2) {
      const jungle = missed.filter((x) => x.jungle).length;
      out.push({
        key: 'farm_while_fight',
        area: 'Драки',
        level: 'warn',
        score: 55 + lostOnes.length * 10 + allyDeathsTotal * 2,
        title: jungle >= missed.length / 2 ? 'Бил лес, пока команда дралась' : 'Фармил, пока команда дралась',
        groupTitle: 'Фармил, пока команда проигрывала драки',
        text: `После 10:00 найдено ${missed.length} ${plural(missed.length, 'эпизод', 'эпизода', 'эпизодов')}, где ты фармил, а команда потеряла больше героев. Всего в этих эпизодах погибло ${allyDeathsTotal} ${plural(allyDeathsTotal, 'союзник', 'союзника', 'союзников')}.`,
        context: 'Расстояние по карте даёт приблизительную оценку. Из этих данных нельзя понять, успевал ли ты подойти и что команда получала на другой стороне карты.',
        fix: ['На карте проверь, когда можно было заметить драку и был ли безопасный путь к команде.'],
        moments: missed.map((x) => ({ t: x.t, x: x.x, y: x.y, text: `потери ${x.allyDeaths}:${x.enemyDeaths} · ближе всего к драке — около ${x.sec} с по прямой${x.jungle ? ' · ты в лесу' : ''}` })),
        cost: { allyDeaths: allyDeathsTotal, fightsLost: lostOnes.length },
      });
    }
  }

  // ---------- 3. Тайминги карты: лес, коробки, контейнеры с бафами, казино ----------
  const timing = [];
  if (endS >= 1200 && [f.neu9, f.brk20, f.pu10, f.pu20].every(Number.isFinite)) checked('map_timings');
  if (f.neu9 !== null && f.neu9 !== undefined && endS >= 600) {
    const b = benchFor('neu9', c.ref, c.tier);
    if (b.target && f.neu9 < b.target * 0.5 && b.target - f.neu9 >= 300) timing.push({ k: 'neu9', what: 'лес к 9:00', me: f.neu9, ...b, souls: b.target - f.neu9 });
  }
  if (Number.isFinite(f.brk9) && endS >= 600) {
    const b = benchFor('brk9', c.ref, c.tier);
    if (b.target && f.brk9 < b.target * 0.5 && b.target - f.brk9 >= 250) timing.push({ k: 'brk9', what: 'души с коробок к 9:00', me: f.brk9, ...b, souls: b.target - f.brk9 });
  }
  if (!timing.some((x) => x.k === 'brk9') && Number.isFinite(f.brk20)) {
    const b = benchFor('brk20', c.ref, c.tier);
    if (b.target && f.brk20 < b.target * 0.65 && b.target - f.brk20 >= 600) timing.push({ k: 'brk20', what: 'коробки к 20:00', me: f.brk20, ...b, souls: b.target - f.brk20 });
  }
  if (f.pu10 !== null && f.pu10 !== undefined) {
    const b = benchFor('pu10', c.ref, c.tier);
    if (b.target && f.pu10 <= b.target - 4) timing.push({ k: 'pu10', what: 'постоянных бафов к 10:00', me: f.pu10, ...b, souls: 0, statues: b.target - f.pu10 });
  }
  if (f.pu20 !== null && f.pu20 !== undefined) {
    const b = benchFor('pu20', c.ref, c.tier);
    if (b.target && f.pu20 <= b.target - 6) timing.push({ k: 'pu20', what: 'постоянных бафов к 20:00', me: f.pu20, ...b, souls: 0, statues: b.target - f.pu20 });
  }
  if (timing.length) {
    const lostSouls = timing.reduce((s, x) => s + x.souls, 0);
    const statues = Math.max(0, ...timing.map((x) => x.statues || 0));
    const fmt = (x) => `${x.what} — ${N(x.me)}, ${x.fromTops ? 'у топов на этом герое' : 'у игроков Ascendant+'} — ${N(x.target)}`;
    out.push({
      key: 'map_timings',
      area: 'Тайминги',
      // Не «bad»: у игроков 4–6 рангов разница в доле побед между малым и большим значением этих показателей
      // всего 3–5 п.п. (WIN_LINKS), а у смертей — до 13; в твоих матчах связи с поражениями тоже нет.
      level: 'warn',
      score: 25 + Math.min(25, lostSouls / 50) + statues * 2,
      title: 'Меньше ресурсов карты, чем в сравнении',
      text: timing.map((x) => fmt(x)).map((t, i) => (i === 0 ? t[0].toUpperCase() + t.slice(1) : t)).join('; ') + '.',
      context: 'Сравнение показывает разницу в собранных ресурсах, а не причину поражения: у игроков 4–6 рангов разница в доле побед между малым и большим значением этих показателей — 3–5 п.п., заметно меньше, чем у смертей. Доступность лагеря или контейнера в конкретный момент проверяется по карте.',
      fix: [
        'Посмотри свой маршрут между волнами и проверь, были ли рядом доступные ресурсы, которые можно забрать без риска пропустить волну.',
      ],
      moments: [],
      cost: {},
      facts: timing,
    });
  }
  // gold_treasure — это урна душ: её души получает вся команда разом (проверено на матчах:
  // шесть игроков получают одинаковую сумму в одну минуту). Личной ошибкой «не взял» не считаем.

  // ---------- 4. Души, потерянные при смерти ----------
  // если API не отдал потери душ ни одному игроку матча — это «нет данных», а не «потерь не было»
  const observedLosses = lostTracked(m) ? lossPerDeath(me) : [];
  if (majorSoulLosses(me, endS, observedLosses, m) !== null) checked('lost_souls');
  const losses = observedLosses.filter((x) => x.lost >= 600);
  const total = losses.reduce((s, x) => s + x.lost, 0);
  if (total >= 1200 || losses.length >= 2 || losses.some((x) => x.lost >= SOUL_LOSS_THRESHOLD)) {
    const ref = c.ref && c.ref.lostPerDeath && c.ref.lostPerDeath.n >= 4 ? c.ref.lostPerDeath.med : null;
    out.push({
      key: 'lost_souls',
      area: 'Выживание',
      level: total >= 2000 ? 'bad' : 'warn',
      score: 35 + Math.min(40, total / 60),
      title: 'Умирал с несохранёнными душами',
      text: `${losses.length} ${plural(losses.length, 'смерть стоила', 'смерти стоили', 'смертей стоили')} тебе ${soulsAcc(total)}.` +
        // сравниваем среднее со средним: сравнивать самые дорогие смерти со средней потерей топов было бы подбором
        (ref && Number.isFinite(f.lostPerDeath) ? ` В среднем за игру ты терял ${souls(f.lostPerDeath)} за смерть, у топов на этом герое медиана — ${souls(ref)}.` : ''),
      fix: ['Перед рискованным пушем Walker или дракой проверь размер мешка. Если можно безопасно купить полезный предмет или сохранить души, сравни этот вариант с продолжением пуша.'],
      moments: losses.map((x) => ({ t: x.t, lost: x.lost, text: `умер и потерял ${soulsAcc(x.lost)}` })),
      cost: { souls: total },
    });
  }

  // ---------- 4a. Смерти в одиночку ----------
  // По маршрутам: в момент смерти ни один живой союзник не был ближе 2500 единиц.
  const solo = soloDeathRows(m, me);
  if (solo !== null && soloDeathsVerifiable(m, me)) checked('solo_deaths');
  if (solo && solo.length >= 2) {
    const lostBy = new Map(observedLosses.map((x) => [x.t, x.lost]));
    const rows = solo.map((r) => ({ ...r, lost: lostBy.get(r.t) }));
    const lostKnown = rows.length > 0 && rows.every((r) => Number.isFinite(r.lost));
    const lostSum = rows.reduce((s, r) => s + (r.lost || 0), 0);
    const killCount = new Map();
    for (const r of rows) {
      const kp = bySlot.get(r.killerSlot);
      if (kp) killCount.set(kp.hero_id, (killCount.get(kp.hero_id) || 0) + 1);
    }
    const lateTotal = Math.max(solo.length, lateDeathCount(me));
    const killerNames = [...killCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([hid, n]) => `${heroName(hid)}${n > 1 ? ` (${n})` : ''}`);
    out.push({
      key: 'solo_deaths',
      area: 'Выживание',
      // «серьёзно» — только если одиночные смерти составляют заметную долю всех поздних смертей
      level: solo.length >= 3 && solo.length / lateTotal >= 0.5 ? 'bad' : 'warn',
      score: 48 + solo.length * 10 + (lostSum >= 1500 ? 12 : 0),
      title: 'Гиб вдали от команды',
      groupTitle: 'Гибнешь в одиночку, когда команда далеко',
      text: `После 10:00 ${solo.length} из ${lateTotal} твоих смертей случились, когда рядом не было ни одного живого союзника (ближе ~8 секунд бега) и никто из союзников не погиб рядом за 10 секунд до этого.`
        + (lostKnown && lostSum >= 400 ? ` Эти смерти стоили тебе ${soulsAcc(lostSum)}.` : '')
        + (killerNames.length ? ` Убивали: ${killerNames.join(', ')}.` : ''),
      context: '«В одиночку» — расчёт по маршрутам героев: в момент смерти ни один живой союзник не был ближе 2 500 единиц карты (≈8 с бега по прямой), и никто из союзников не погиб рядом за 10 с до этого (тогда это командная драка, а не заход в одиночку). Порог 2 500 — условность, а не граница, найденная в данных. Из этих данных не видно, был ли заход осознанным (сплит-пуш, отвлечение) и успевала ли помощь дойти — проверь в эпизоде.',
      fix: [
        'Не заходи на чужую половину и к Walker без напарника: пока враги живы, фарми рядом с командой или на своей половине.',
        'Фарми вдали от команды — поглядывай на миникарту: соперники пропали — отходи к своим, даже если лагерь не добит.',
      ],
      groupFix: [
        'Держись напарника, когда идёшь пушить или фармить на чужой половине: в примерах ниже помощь не успевала.',
        'Соперники пропали с миникарты — отходи к своим, даже если лагерь не добит.',
      ],
      moments: rows.map((r) => {
        const kp = bySlot.get(r.killerSlot);
        const parts = ['один'];
        if (kp) parts.push(`убил ${heroName(kp.hero_id)}`);
        if (r.allyDist === null) parts.push('все союзники были мертвы');
        else parts.push(`до союзников ${Math.max(1, Math.round(r.allyDist / SPEED))} с бега`);
        if (r.foes >= 2) parts.push(`соперников рядом: ${r.foes}`);
        return { t: r.t, x: r.x, y: r.y, lost: Number.isFinite(r.lost) ? r.lost : undefined, text: parts.join(' · ') };
      }),
      cost: { deaths: solo.length, souls: lostKnown ? lostSum : 0 },
    });
  }

  // ---------- 5. Смерть с непотраченными душами ----------
  const lateDeaths = (me.deaths || [])
    .filter((d) => d[0] >= LANE_END)
    .map((d) => ({ t: d[0], x: d[1], y: d[2], free: unspentAt(me, d[0], c.assets) }));
  if (lateDeaths.length && lateDeaths.every((d) => Number.isFinite(d.free))) checked('died_rich');
  const rich = lateDeaths.filter((d) => Number.isFinite(d.free) && d.free >= RICH);
  if (rich.length) {
    out.push({
      key: 'died_rich',
      area: 'Предметы',
      // связи с победой в реальных матчах нет (доля побед с замечанием и без — одинаковая), поэтому не «bad»
      level: 'warn',
      score: 30 + rich.length * 10,
      title: 'Возможна покупка перед дракой',
      text: rich.length > 1 ? `В ${rich.length} ${plural(rich.length, 'смерти', 'смертях', 'смертях')} после 10:00 по расчёту в кармане было не меньше ${souls(RICH)} (максимум — не меньше ${souls(Math.max(...rich.map((d) => d.free)))}).` : `По расчёту перед смертью в кармане было не меньше ${souls(rich[0].free)}.`,
      context: 'Остаток считается как накопленные души минус цена купленных предметов, без учёта продаж, поэтому реальная сумма обычно больше названной. Мог ли ты дойти до магазина перед боем и стоило ли тратить, из данных не видно — это гипотеза, проверь в эпизоде. В реальных матчах эта привычка не отличает победы от поражений.',
      fix: ['Перед ближайшей дракой проверь, хватает ли на полезный предмет и можно ли безопасно купить его.'],
      moments: rich.map((d) => ({ t: d.t, x: d.x, y: d.y, text: `по расчёту в кармане не меньше ${souls(d.free)}` })),
      cost: { souls: 0 },
    });
  }

  // ---------- 5a. Серия смертей без покупки живучести ----------
  // Факт из данных: после 10:00 серия из 3+ смертей (между соседними не больше
  // 4 минут), и с начала серии не куплено ни одного предмета живучести от 1 250
  // душ. Что этот предмет дал бы — гипотеза: проверяется в повторе.
  const vit = (id) => c.assets && c.assets.items && c.assets.items[id] && c.assets.items[id].slot === 'vitality';
  const vitCost = (id) => (c.assets && c.assets.items && c.assets.items[id] && c.assets.items[id].cost) || null;
  const vitalPurchases = (me.items || []).filter(([id]) => vit(id) && (vitCost(id) || 0) >= VITALITY_COST);
  const myDeaths = (me.deaths || [])
    .filter((d) => Number.isFinite(d[0]) && d[0] >= LANE_END)
    .map((d) => ({ t: d[0], x: d[1], y: d[2], killer: d[3] }));
  if (c.assets && c.assets.items && Object.keys(c.assets.items).length && (me.items || []).length && myDeaths.length >= 3) checked('survivability_purchase');

  // серии: 3+ смертей после 10:00 подряд, между соседними не больше 4 минут
  const streaks = [];
  let run = [];
  for (const d of myDeaths) {
    if (run.length && d.t - run[run.length - 1].t > STREAK_GAP) {
      if (run.length >= 3) streaks.push(run);
      run = [];
    }
    run.push(d);
  }
  if (run.length >= 3) streaks.push(run);
  // без каталога предметов проверка невозможна: «нет покупок живучести»
  // не отличить от «не знаем, что это за предметы»
  const catalog = !!(c.assets && c.assets.items && Object.keys(c.assets.items).length);
  // серия считается проверенной, если после её последней смерти оставалось
  // минимум 90 секунд игры — время дойти до магазина и купить
  const candidates = catalog ? streaks.filter((s) => endS - s[s.length - 1].t >= REACT_SECS
    && !vitalPurchases.some(([, bt]) => bt >= s[0].t)
    // живучесть уже была собрана (2+ предмета к началу серии) — «купи ещё» из
    // данных не следует, совет не показываем
    && vitalPurchases.filter(([, bt]) => bt <= s[0].t).length < 2) : [];
  if (candidates.length) {
    // худая серия — с наибольшими потерями душ (при равенстве — длиннее)
    const lostByT = new Map(observedLosses.map((x) => [x.t, x.lost]));
    const worst = candidates.map((s) => ({
      deaths: s,
      lost: s.reduce((acc, d) => acc + (lostByT.get(d.t) || 0), 0),
    })).sort((a, b) => b.lost - a.lost || b.deaths.length - a.deaths.length)[0];
    const s0 = worst.deaths[0].t;
    const hadVitality = vitalPurchases.filter(([, bt]) => bt <= s0).length;
    const spanText = (ds) => {
      const mins = Math.max(1, Math.round((ds[ds.length - 1].t - ds[0].t) / 60));
      return `${mins} ${plural(mins, 'минуту', 'минуты', 'минут')}`;
    };
    const spent = (me.items || [])
      .filter(([id, bt]) => bt >= s0 && bt <= endS && c.assets && c.assets.items && c.assets.items[id] && (c.assets.items[id].cost || 0) >= VITALITY_COST && !vit(id))
      .map(([id, bt]) => ({ id, t: bt }))
      .sort((a, b) => a.t - b.t);
    const spentText = spent.length
      ? `после начала серии ${plural(spent.length, 'покупка дороже', 'покупки дороже', 'покупок дороже')} ${N(VITALITY_COST)} ${plural(spent.length, 'шла', 'шли', 'шли')} не в живучесть: ${spent.slice(0, 3).map((x) => `${itemName(x.id)} (${N(c.assets.items[x.id].cost)} душ, ${T(x.t)})`).join(', ')}`
      : `крупных покупок (${N(VITALITY_COST)}+ душ) после начала серии не было`;
    out.push({
      key: 'survivability_purchase',
      area: 'Предметы',
      level: 'warn',
      score: 34 + worst.deaths.length * 6,
      title: 'После серии смертей — без живучести',
      groupTitle: 'Не докупаешь живучесть после серии смертей',
      text: `С ${T(s0)} за ${spanText(worst.deaths)} ты погиб ${worst.deaths.length} ${plural(worst.deaths.length, 'раз', 'раза', 'раз')} и до конца игры не купил ни одного предмета живучести от ${N(VITALITY_COST)} душ (${hadVitality ? `к началу серии ${plural(hadVitality, 'такой предмет уже был', 'таких предметов уже было', 'таких предметов уже было')}` : 'таких предметов не было и до серии'}). ${spentText[0].toUpperCase()}${spentText.slice(1)}.`
        + (worst.lost >= 400 ? ` Смерти в серии стоили ${soulsAcc(worst.lost)}.` : ''),
      context: 'Серия смертей и список покупок — факты из данных. Помогла бы живучесть — гипотеза: в повторе проверь, от какого урона умирал (оружие или способности) и было ли окно дойти до магазина. Предмет живучести не предотвращает смерть сам по себе.',
      fix: [
        'После двух смертей подряд остановись и проверь остаток душ: предмет живучести (здоровье, сопротивление, барьер) покупают до следующей драки, а не после неё.',
        'Если копишь на дорогой урон — сравни в повторе цену ожидания: каждая смерть в серии отдаёт соперникам души, карту и время.',
      ],
      groupFix: [
        'После серии смертей меняй план закупки: предмет живучести покупают до следующей драки, а не после неё.',
        'Копишь на дорогой урон в плохой игре — сравни в повторе, сколько душ и карты стоило ожидание.',
      ],
      moments: worst.deaths.map((d) => {
        const kp = bySlot.get(d.killer);
        const parts = [kp ? `убил ${heroName(kp.hero_id)}` : 'смерть'];
        const lost = lostByT.get(d.t);
        if (Number.isFinite(lost) && lost >= 100) parts.push(`−${N(lost)} душ`);
        return { t: d.t, x: d.x, y: d.y, lost: Number.isFinite(lost) ? lost : undefined, text: parts.join(' · ') };
      }),
      cost: { deaths: worst.deaths.length, souls: worst.lost },
      facts: { streakStart: s0, streakDeaths: worst.deaths.length, hadVitality, spent: spent.slice(0, 5).map((x) => ({ id: x.id, t: x.t })) },
    });
  }

  // ---------- 6. Не собрал предмет против опасного героя ----------
  if (c.counters && endS >= 1200) {
    if (me.items?.length && m.dmg?.t?.at(-1) >= endS - 65 && enemies.some((e) => c.counters[e.hero_id]?.length)) checked('counter_missing');
    const taken = {};
    if (m.dmg && m.dmg.d) {
      const last = m.dmg.t.length - 1;
      for (const e of enemies) taken[e.slot] = ((m.dmg.d[`${e.slot}>${me.slot}`] || [])[last] || 0);
    }
    const totalTaken = Object.values(taken).reduce((s, v) => s + v, 0);
    const kills = {};
    for (const d of me.deaths || []) if (d[3] !== null) kills[d[3]] = (kills[d[3]] || 0) + 1;
    const myItems = new Set((me.items || []).map(([id]) => id));
    const misses = [];
    for (const e of enemies) {
      const share = totalTaken ? taken[e.slot] / totalTaken : 0;
      const k = kills[e.slot] || 0;
      if (k < 2 && share < 0.3) continue;
      const list = (c.counters[e.hero_id] || []).slice(0, 3);
      if (!list.length || list.some((x) => myItems.has(x.id))) continue;
      misses.push({ hero: e.hero_id, slot: e.slot, kills: k, share, items: list });
    }
    if (misses.length) {
      const top = misses.sort((a, b) => b.kills - a.kills || b.share - a.share)[0];
      const what = [top.kills ? `убил тебя ${top.kills} ${plural(top.kills, 'раз', 'раза', 'раз')}` : '', top.share >= 0.3 ? `нанёс ${Math.round(top.share * 100)}% всего урона по тебе` : ''].filter(Boolean).join(' и ');
      out.push({
        key: 'counter_missing',
        area: 'Предметы',
        level: 'warn',
        score: 38 + top.kills * 5,
        title: `Не было ответа на ${heroName(top.hero)}`,
        groupTitle: 'Не собираешь ответ на героя, который тебя убивает',
        text: `${heroName(top.hero)} ${what}. Против него топы заметно чаще берут: ${top.items.map((x) => `${itemName(x.id)} (в ${x.lift.toFixed(1).replace('.', ',')} раза чаще)`).join(', ')}. У тебя этого не было.`,
        fix: [
          `Видишь ${heroName(top.hero)} у соперников — заранее впиши в сборку ${top.items.length > 1 ? 'один из этих предметов' : 'этот предмет'}: ${top.items.map((x) => itemName(x.id)).join(', ')}.`,
          'Ответ не обязательно брать первым: купи его, как только этот герой начал тебя убивать, — обычно к 15–20 минуте.',
        ],
        groupFix: [
          'Посмотри в примерах ниже, кто тебя убивал и что против него берут топы. Видишь этого героя у соперников — впиши предмет в сборку заранее.',
          'Ответ не обязательно брать первым: купи его, как только этот герой начал тебя убивать, — обычно к 15–20 минуте.',
        ],
        context: 'Это статистика покупок игроков топового уровня против этого героя, а не доказанный ответ: из неё не видно, чем именно тебя убивали и успевал ли предмет изменить исход. Проверь в эпизодах, от какого урона ты умирал.',
        extra: { hero: top.hero, kills: top.kills, share: Math.round(top.share * 100) / 100, items: top.items },
        // эпизоды: смерти от этого героя
        moments: (me.deaths || []).filter((d) => d[3] === top.slot && Number.isFinite(d[0])).map((d) => ({ t: d[0], x: d[1], y: d[2], text: `умер от ${heroName(top.hero)}` })),
        cost: {},
        facts: misses,
      });
    }
  }

  return out.sort((a, b) => b.score - a.score);
}

/**
 * Сильные моменты игры — что получилось и что стоит повторять. Те же данные, что у gameLeaks.
 * Каждый пункт: что сделал (с цифрами и временем), что это дало, как закрепить.
 */
function gameHighlights(c) {
  const { m, me, f } = c;
  const heroName = c.heroName || ((id) => `#${id}`);
  const itemName = c.itemName || ((id) => `#${id}`);
  const out = [];
  if (!m || !me || !f) return out;
  const endS = m.duration_s || 0;
  const enemies = m.players.filter((p) => p.team !== me.team);
  const bySlot = new Map(m.players.map((p) => [p.slot, p]));
  // мои убийства: смерти соперников, где убийца — я
  const myKills = [];
  for (const e of enemies) for (const d of e.deaths || []) if (d[3] === me.slot) myKills.push({ t: d[0], x: d[1], y: d[2], hero: e.hero_id, slot: e.slot });
  myKills.sort((a, b) => a.t - b.t);
  const push = (o) => out.push({ level: 'good', fix: [], moments: [], cost: {}, ...o });

  // ---------- 1. Линия ----------
  const foes = me.lane !== null && me.lane !== undefined ? enemies.filter((p) => p.lane === me.lane) : [];
  const foeSlots = new Set(foes.map((e) => e.slot));
  const laneDeaths = (me.deaths || []).filter((d) => d[0] <= LANE_END).length;
  if (foes.length && m.dmg && Array.isArray(m.dmg.t)) {
    let idx = -1;
    m.dmg.t.forEach((t, i) => {
      if (t <= LANE_END) idx = i;
    });
    if (idx >= 0) {
      const sum = (keys) => keys.reduce((a, k) => a + ((m.dmg.d[k] || [])[idx] || 0), 0);
      const out9 = sum(foes.map((e) => `${me.slot}>${e.slot}`));
      const in9 = sum(foes.map((e) => `${e.slot}>${me.slot}`));
      const laneKills = myKills.filter((k) => k.t <= LANE_END && foeSlots.has(k.slot));
      if (out9 >= in9 * 1.4 && out9 - in9 >= 600 && laneDeaths <= 1) {
        push({
          key: 'lane_won', area: 'Линия', score: 60 + laneKills.length * 8,
          title: 'Выиграл размены на линии',
          text: `К ${T(m.dmg.t[idx])} ты нанёс противникам по линии ${N(out9)} урона, а получил ${N(in9)} — в ${(out9 / Math.max(1, in9)).toFixed(1).replace('.', ',')} раза меньше.` +
            (laneKills.length ? ` И забрал ${laneKills.length} ${plural(laneKills.length, 'убийство', 'убийства', 'убийств')}.` : '') +
            (laneDeaths === 0 ? ' Сам ни разу не умер.' : ''),
          keep: 'Так и разменивайся: бей, когда враг добивает крипа или потратил способность, и отходи раньше, чем он ответит.',
          moments: laneKills.map((k) => ({ t: k.t, x: k.x, y: k.y, text: `убил ${heroName(k.hero)}` })),
        });
      }
    }
  }
  if (laneDeaths === 0 && endS >= LANE_END && !out.some((x) => x.key === 'lane_won')) {
    push({
      key: 'lane_clean', area: 'Линия', score: 34,
      title: 'Ни одной смерти до 10:00',
      text: 'Ты прошёл линию без смертей. У игроков твоего уровня это 54% побед против 47% при двух смертях.',
      keep: 'Держи это правило: на линии лучше недобрать крипа, чем отдать смерть.',
    });
  }

  // ---------- 2. Карта: лес, коробки, бафы на уровне топов ----------
  const done = [];
  for (const [k, label] of [['neu9', 'лес к 9:00'], ['brk9', 'коробки к 9:00'], ['pu10', 'постоянных бафов к 10:00'], ['brk20', 'коробки к 20:00'], ['pu20', 'постоянных бафов к 20:00']]) {
    const v = f[k];
    if (v === null || v === undefined) continue;
    const b = benchFor(k, c.ref, c.tier);
    if (b.target && v >= b.target) done.push({ k, label, v, target: b.target, fromTops: b.fromTops });
  }
  if (done.length >= 2) {
    const who = done.some((x) => x.fromTops) ? 'у топов на этом герое' : 'у игроков Ascendant+';
    push({
      key: 'map_good', area: 'Тайминги', score: 40 + done.length * 6,
      title: 'Забирал карту на уровне топов',
      text: done.map((x) => (x.k.startsWith('pu') ? `${x.label} — ${x.v} (${who} ${x.target})` : `${x.label} — ${souls(Math.round(x.v))} (${who} ${N(x.target)})`)).map((t, i) => (i === 0 ? t[0].toUpperCase() + t.slice(1) : t)).join('; ') + '.',
      keep: 'Это бесплатные души и бафы — продолжай собирать их между волнами, как в этой игре.',
    });
  }

  // ---------- 3. Драки: был там, где команда выиграла ----------
  if (m.paths && m.paths.players && m.paths.players[me.slot]) {
    const won = [];
    for (const fight of findFights(m)) {
      if (fight.t0 < LANE_END || fight.x === null || fight.deaths.length < 3) continue;
      const allyD = fight.deaths.filter((d) => d.team === me.team).length;
      const enemyD = fight.deaths.length - allyD;
      if (enemyD <= allyD) continue;
      const pts = pathPoints(m, me.slot, fight.t0 - 10, fight.t1);
      if (!pts || !pts.length) continue;
      const near = pts.some((q) => q.p[2] && (q.p[3] & 1) && dist([q.p[0], q.p[1]], [fight.x, fight.y]) <= 3500);
      if (!near) continue;
      const kills = myKills.filter((k) => k.t >= fight.t0 - 2 && k.t <= fight.t1 + 2).length;
      const died = fight.deaths.some((d) => d.slot === me.slot);
      won.push({ t: fight.t0, x: fight.x, y: fight.y, allyD, enemyD, kills, died });
    }
    if (won.length >= 2) {
      const kills = won.reduce((a, x) => a + x.kills, 0);
      push({
        key: 'fights_won', area: 'Драки', score: 45 + won.length * 6 + kills * 3,
        title: 'Был в драках, которые команда выиграла',
        text: `После 10:00 ты участвовал в ${won.length} ${plural(won.length, 'выигранной драке', 'выигранных драках', 'выигранных драках')}` +
          (kills ? ` и сам забрал в них ${kills} ${plural(kills, 'убийство', 'убийства', 'убийств')}.` : '.') +
          (won.every((x) => !x.died) ? ' И ни в одной не умер.' : ''),
        keep: 'Командные драки решают игру после линии. Продолжай приходить на них вовремя.',
        moments: won.slice(0, 5).map((x) => ({ t: x.t, x: x.x, y: x.y, text: `драка ${x.enemyD}:${x.allyD} в нашу пользу${x.kills ? `, твоих убийств: ${x.kills}` : ''}` })),
      });
    }
  }

  // ---------- 4. Серии убийств ----------
  const streaks = [];
  let cur = [];
  for (const k of myKills) {
    if (cur.length && k.t - cur[cur.length - 1].t > 15) {
      if (cur.length >= 2) streaks.push(cur);
      cur = [];
    }
    cur.push(k);
  }
  if (cur.length >= 2) streaks.push(cur);
  if (streaks.length) {
    const best = streaks.slice().sort((a, b) => b.length - a.length)[0];
    const word = (n) => (n >= 4 ? 'Четыре убийства подряд' : n === 3 ? 'Тройное убийство' : 'Двойное убийство');
    push({
      key: 'multikill', area: 'Драки', score: 38 + best.length * 10,
      title: streaks.length > 1 ? `${word(best.length)} и ещё ${streaks.length - 1} ${plural(streaks.length - 1, 'серия', 'серии', 'серий')}` : word(best.length),
      text: `На ${T(best[0].t)} ты за ${Math.max(1, best[best.length - 1].t - best[0].t)} с убил ${best.map((k) => heroName(k.hero)).join(', ')}.`,
      keep: 'Посмотри этот момент на карте: где ты стоял и откуда зашёл — такую позицию стоит искать снова.',
      moments: streaks.slice(0, 4).map((st) => ({ t: st[0].t, x: st[0].x, y: st[0].y, text: `${st.length} ${plural(st.length, 'убийство', 'убийства', 'убийств')}: ${st.map((k) => heroName(k.hero)).join(', ')}` })),
    });
  }

  // ---------- 5. Убийство на последних процентах здоровья ----------
  if (m.paths && m.paths.players && m.paths.players[me.slot]) {
    const clutch = [];
    for (const k of myKills) {
      const pts = pathPoints(m, me.slot, k.t - 5, k.t + 10);
      if (!pts || pts.length < 2) continue;
      const hp = pts.filter((q) => q.t <= k.t).map((q) => q.p[4]).filter((v) => v !== null && v !== undefined);
      const low = hp.length ? Math.min(...hp) : null;
      const survived = pts.filter((q) => q.t > k.t).every((q) => q.p[2]);
      if (low !== null && low > 0 && low <= 20 && survived) clutch.push({ ...k, low });
    }
    if (clutch.length) {
      push({
        key: 'clutch', area: 'Драки', score: 36 + clutch.length * 6,
        title: clutch.length > 1 ? `${clutch.length} убийства на последних процентах здоровья` : 'Убийство на последних процентах здоровья',
        text: `${clutch.map((k) => `на ${T(k.t)} убил ${heroName(k.hero)} с ${k.low}% здоровья`).join('; ')} — и выжил.`.replace(/^./, (ch) => ch.toUpperCase()),
        keep: 'Хладнокровно доиграл размен. Но помни: с таким здоровьем чаще стоит отойти — в этот раз расчёт оправдался.',
        moments: clutch.slice(0, 4).map((k) => ({ t: k.t, x: k.x, y: k.y, text: `убил ${heroName(k.hero)} с ${k.low}% здоровья` })),
      });
    }
  }

  // ---------- 6. Выживание и души ----------
  const longGame = endS >= 1500;
  const refD = c.ref && c.ref.d && c.ref.d.n >= 4 ? c.ref.d.med : null;
  if (longGame && me.d <= Math.min(3, refD !== null ? refD : 3)) {
    push({
      key: 'few_deaths', area: 'Выживание', score: 42,
      title: me.d === 0 ? 'Ни одной смерти за игру' : `Всего ${me.d} ${plural(me.d, 'смерть', 'смерти', 'смертей')} за игру`,
      text: `Игра шла ${Math.round(endS / 60)} минут, а ты умер ${me.d === 0 ? 'ноль раз' : `${me.d} ${plural(me.d, 'раз', 'раза', 'раз')}`}${refD !== null ? ` — у топов на этом герое обычно ${String(Math.round(refD * 10) / 10).replace('.', ',')}` : ''}.`,
      keep: 'Меньше смертей — больше времени на карте и души при тебе. Это твоя сильная сторона в этой игре.',
    });
  }
  const st = me.stats || [];
  const lostTotal = st.length && st[st.length - 1].g_lost !== undefined ? st[st.length - 1].g_lost : null;
  if (lostTotal !== null && lostTracked(m) && me.d >= 4 && lostTotal <= me.d * 60) {
    push({
      key: 'souls_safe', area: 'Выживание', score: 30,
      title: 'Умирал «пустым» — души были сохранены',
      text: `За ${me.d} ${plural(me.d, 'смерть', 'смерти', 'смертей')} ты потерял всего ${souls(lostTotal)}: перед драками души были потрачены или сохранены.`,
      keep: 'Правильная привычка: сначала магазин, потом драка.',
    });
  }

  // ---------- 7. Собрал ответ на самого опасного героя ----------
  if (c.counters && m.dmg && m.dmg.d && endS >= 1200) {
    const last = m.dmg.t.length - 1;
    const taken = enemies.map((e) => ({ e, v: (m.dmg.d[`${e.slot}>${me.slot}`] || [])[last] || 0 })).sort((a, b) => b.v - a.v);
    const total = taken.reduce((a, x) => a + x.v, 0);
    const top = taken[0];
    if (top && total && top.v / total >= 0.25) {
      const mine = new Set((me.items || []).map(([id]) => id));
      const hit = (c.counters[top.e.hero_id] || []).find((x) => mine.has(x.id));
      if (hit) {
        push({
          key: 'counter_ok', area: 'Предметы', score: 40,
          title: `Собрал ответ на ${heroName(top.e.hero_id)}`,
          text: `${heroName(top.e.hero_id)} нанёс ${Math.round((top.v / total) * 100)}% всего урона по тебе, и у тебя был ${itemName(hit.id)} — топы берут его против этого героя в ${hit.lift.toFixed(1).replace('.', ',')} раза чаще обычного.`,
          keep: 'Ты подстроил сборку под соперника — так делают сильные игроки.',
        });
      }
    }
  }

  // ---------- 8. Паверспайк использован ----------
  if (f.spikeFights === 1 && f.spikeWindows >= 2) {
    push({
      key: 'spike_used', area: 'Паверспайки', score: 28,
      title: 'Участие в убийствах после дорогих покупок',
      text: `В проверенных окнах после покупки участие в убийстве за 3 минуты подтверждено в ${f.spikeWindows} из ${f.spikeWindows} случаев.`,
    });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

// Что топы чаще берут против каждого героя. records: [{ match, player }] — игры топового уровня.
// lift = доля игр с предметом, когда герой у соперников / доля без него.
function counterItems(records, { minBuys = 12, minRate = 0.1, minLift = 1.5, perHero = 4, isItem = () => true } = {}) {
  const N0 = records.length;
  if (N0 < 200) return {};
  const total = new Map();
  const withE = new Map(); // hero -> { n, items: Map }
  for (const { match, player } of records) {
    const items = new Set((player.items || []).map(([id]) => id).filter(isItem));
    for (const id of items) total.set(id, (total.get(id) || 0) + 1);
    for (const e of match.players) {
      if (e.team === player.team) continue;
      let w = withE.get(e.hero_id);
      if (!w) withE.set(e.hero_id, (w = { n: 0, items: new Map() }));
      w.n += 1;
      for (const id of items) w.items.set(id, (w.items.get(id) || 0) + 1);
    }
  }
  const out = {};
  for (const [hero, w] of withE) {
    if (w.n < 60 || N0 - w.n < 60) continue;
    const rows = [];
    for (const [id, b] of w.items) {
      if (b < minBuys) continue;
      const rateVs = b / w.n;
      const rateElse = ((total.get(id) || 0) - b) / (N0 - w.n);
      if (rateVs < minRate || rateElse <= 0) continue;
      const lift = rateVs / rateElse;
      if (lift >= minLift) rows.push({ id, lift: Math.round(lift * 100) / 100, rateVs: Math.round(rateVs * 1000) / 1000 });
    }
    rows.sort((a, b) => b.lift * Math.sqrt(b.rateVs) - a.lift * Math.sqrt(a.rateVs));
    if (rows.length) out[hero] = rows.slice(0, perHero);
  }
  return out;
}

// Доля побед с замечанием и без него «в лоб» обманывает: чем больше смертей в матче, тем чаще и
// поражение, и любое замечание про смерти. Поэтому сравниваем игры с похожим числом смертей
// (три группы по числу смертей в матче) и усредняем разницу долей побед по группам (веса как у
// Mantel–Haenszel). Возвращает { diff, n } — разница «с замечанием минус без» (0.1 = +10 п.п.),
// n — число игр в сравнимых группах; null, если игр мало или число смертей неизвестно.
function adjustedWrDiff(withL, without, all) {
  const deaths = all.map((g) => g.d).filter(Number.isFinite).sort((a, b) => a - b);
  if (deaths.length < 9) return null;
  const q1 = deaths[Math.floor((deaths.length - 1) / 3)];
  const q2 = deaths[Math.floor(((deaths.length - 1) * 2) / 3)];
  const stratum = (g) => (g.d <= q1 ? 0 : g.d <= q2 ? 1 : 2);
  let num = 0;
  let den = 0;
  let used = 0;
  for (let k = 0; k < 3; k++) {
    const a = withL.filter((g) => Number.isFinite(g.d) && stratum(g) === k && (g.won === true || g.won === false));
    const b = without.filter((g) => Number.isFinite(g.d) && stratum(g) === k && (g.won === true || g.won === false));
    if (a.length < 3 || b.length < 3) continue;
    const w = (a.length * b.length) / (a.length + b.length);
    num += w * (a.filter((g) => g.won).length / a.length - b.filter((g) => g.won).length / b.length);
    den += w;
    used += a.length + b.length;
  }
  return den > 0 && used >= 20 ? { diff: num / den, n: used } : null;
}

// Общая картина по играм: что повторяется, сколько стоит, как связано с победой.
// games: [{ match_id, start_time, won, hero, leaks: [...] }]
function leakProfile(games) {
  const by = new Map();
  const counted = games.filter((g) => Array.isArray(g.leaks));
  for (const g of counted) {
    for (const l of g.leaks) {
      if (l.level === 'good') continue;
      let e = by.get(l.key);
      if (!e) by.set(l.key, (e = { key: l.key, area: l.area, title: l.groupTitle || l.title, fix: l.groupFix || l.fix, games: [], souls: 0, deaths: 0, allyDeaths: 0, statues: 0, score: 0 }));
      e.games.push({ match_id: g.match_id, start_time: g.start_time, won: g.won, hero: g.hero, title: l.title, text: l.text, context: l.context || null, extra: l.extra || null, moments: (l.moments || []).slice(0, 4), score: l.score });
      e.souls += (l.cost && l.cost.souls) || 0;
      e.deaths += (l.cost && l.cost.deaths) || 0;
      e.allyDeaths += (l.cost && l.cost.allyDeaths) || 0;
      e.statues += (l.cost && l.cost.statues) || 0;
      e.score += l.score;
      if (!l.groupFix && l.fix && l.fix.length > (e.fix || []).length) e.fix = l.fix;
    }
  }
  const n = counted.length;
  const wr = (list) => {
    const d = list.filter((g) => g.won === true || g.won === false);
    return d.length >= MIN_WR_GAMES ? d.filter((g) => g.won).length / d.length : null;
  };
  const rows = [...by.values()].map((e) => {
    const ids = new Set(e.games.map((g) => g.match_id));
    const withL = counted.filter((g) => ids.has(g.match_id));
    const without = counted.filter((g) => !ids.has(g.match_id) && (!g.checked || g.checked.includes(e.key)));
    const eligible = withL.length + without.length;
    const wrAdj = adjustedWrDiff(withL, without, counted);
    // влияние на победы берём с поправкой на число смертей; нет поправки — только «в лоб», если игр достаточно
    const wrRaw = withL.length >= MIN_WR_GAMES && without.length >= MIN_WR_GAMES ? (wr(without) ?? 0) - (wr(withL) ?? 0) : null;
    const lossLink = wrAdj ? -wrAdj.diff : wrRaw;
    return {
      ...e,
      count: e.games.length,
      eligible,
      unknown: n - eligible,
      share: eligible ? e.games.length / eligible : 0,
      wrWith: withL.length >= MIN_WR_GAMES ? wr(withL) : null,
      wrWithout: without.length >= MIN_WR_GAMES ? wr(without) : null,
      wrAdj,
      // важность: как часто × насколько серьёзно × бьёт ли по победам именно в твоих играх
      // (с ошибкой выигрываешь реже — важнее; не реже — менее важно; мало игр — без поправки)
      impact: (e.games.length / Math.max(1, n)) * (e.score / e.games.length) * (lossLink === null ? 1 : Math.max(0.6, Math.min(1.6, 1 + lossLink * 2))),
      examples: e.games.slice().sort((a, b) => b.score - a.score).slice(0, 3),
    };
  });
  rows.sort((a, b) => b.impact - a.impact);
  const goals = {
    lane_trades: { title: 'Не больше одной смерти до 10:00', action: 'После неудачного размена отойди и восстанови здоровье перед следующим.', check: 'После матча посчитай смерти до 10-й минуты.' },
    lost_souls: { title: `Ни одной смерти с потерей ${N(SOUL_LOSS_THRESHOLD)} душ или больше`, action: 'Перед рискованной дракой или пушем Walker проверь, можно ли сохранить души или безопасно купить предмет.', check: 'После матча проверь потерю душ в эпизодах своих смертей, если для них есть данные.' },
    solo_deaths: { title: 'Не больше одной смерти в одиночку после 10:00', action: 'Не заходи на чужую половину и к объектам без напарника: фарми рядом с командой или на своей половине.', check: 'После матча проверь смерти после 10:00: рядом (ближе ~8 секунд бега) должны быть живые союзники.' },
    survivability_purchase: { title: 'После серии из трёх смертей — покупка живучести', action: 'После двух смертей подряд проверь остаток душ и купи предмет живучести до следующей драки, а не после неё.', check: 'После матча проверь: была ли серия смертей и куплен ли предмет живучести от 1 250 душ после её начала.' },
  };
  let goal = null;
  for (const row of rows) {
    if (!Object.hasOwn(goals, row.key)) continue;
    const evidence = row.games.flatMap((game) => {
      const moment = game.moments.find((point) => Number.isFinite(point.t) && point.t >= 0
        && (row.key !== 'lost_souls' || point.lost >= SOUL_LOSS_THRESHOLD));
      return moment ? [{ matchId: game.match_id, startTime: game.start_time, title: game.title, context: game.context, ...moment }] : [];
    });
    if (new Set(evidence.map((episode) => episode.matchId)).size < 2) continue;
    const episode = evidence.sort((a, b) => b.startTime - a.startTime)[0];
    goal = { ...goals[row.key], key: row.key, reason: row.title, count: row.count, eligible: row.eligible, episode };
    break;
  }
  return { games: n, rows, goal };
}

// Связь привычки с победой у игроков твоего уровня: значение → доля побед.
function winLink(key, value) {
  const list = WIN_LINKS[key];
  if (!list || value === null || value === undefined) return null;
  let cur = list[0];
  for (const row of list) if (value >= row[0]) cur = row;
  return { wr: cur[1], best: list[list.length - 1] };
}

module.exports = { souls, lostTracked, gameLeaks, gameHighlights, leakProfile, counterItems, findFights, lossPerDeath, majorSoulLosses, unspentAt, winLink, benchFor, RANK_BENCH, WIN_LINKS, FIGHT_FAR, FIGHT_REACH, SPEED, SOUL_LOSS_THRESHOLD };
