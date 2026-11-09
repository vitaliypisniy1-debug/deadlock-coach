'use strict';
// Советы по ПЕРИОДУ (3–14 дней): ищем закономерности в твоих играх —
// где ты обычно умираешь, на каком отрезке теряешь фарм, как играешь после
// поражений, ночью, в рейтинге, на каком герое и т.д.
//
// p = { games, mine, lobbyList, topHero, summary, sessions, durations, tilt, heroes,
//       compare, sources, days, heroName, itemName }

const { median, mean } = require('./stats');
const { N, D1, P, T, plural, ok, ratio, tip } = require('./tipkit');

const RULES = [];
const rule = (fn) => RULES.push(fn);
const avg = (list, k) => mean(list.map((f) => f[k]).filter((v) => v !== null && v !== undefined && Number.isFinite(v)));
const med = (list, k) => {
  const v = list.map((f) => f[k]).filter((x) => x !== null && x !== undefined && Number.isFinite(x));
  return v.length ? median(v) : null;
};
const wrOf = (list) => {
  const d = list.filter((g) => g.won !== null && g.won !== undefined);
  return d.length ? d.filter((g) => g.won).length / d.length : null;
};
const enough = (p, n = 5) => p.mine.length >= n;

// ======================= СМЕРТИ =======================
rule((p) => {
  if (!enough(p)) return null;
  const phases = [
    { k: 'd10', min: 0.7, id: 'p_death_lane', name: 'на линии (до 10:00)', tip: 'На линии чаще всего умирают из-за помощи врагу с соседних линий. Когда противник с другой линии пропадает с карты — отходи к своей башне.' },
    { k: 'dMid', min: 0.8, id: 'p_death_mid', name: 'в середине игры (10–20 мин)', tip: 'В середине игры смерти почти всегда случаются в одиночку в лесу. Фарми лагеря ближе к своей команде и смотри, сколько врагов видно на карте.' },
    { k: 'dLate', min: 1.0, id: 'p_death_late', name: 'в поздней игре (после 20:00)', tip: 'После 20:00 возрождение долгое. Не ходи вперёд команды на разведку — пусть первым заходит тот, кто лучше выдерживает урон.' },
  ].map((x) => ({ ...x, me: avg(p.mine, x.k), lob: avg(p.lobbyList, x.k) })).filter((x) => ok(x.me, x.lob) && x.me - x.lob >= x.min);
  if (!phases.length) return null;
  const w = phases.sort((a, b) => b.me - b.lob - (a.me - a.lob))[0];
  return tip(w.id, 'p_death_phase', 'Выживание', 'bad', 82, `Больше всего лишних смертей — ${w.name}`,
    `За игру ты умираешь ${w.name} в среднем ${D1(w.me)} ${plural(w.me, 'раз', 'раза', 'раз')}, а игроки твоего уровня — ${D1(w.lob)}.`, w.tip);
});

rule((p) => {
  const wins = p.mine.filter((f) => f.won);
  const losses = p.mine.filter((f) => !f.won);
  if (wins.length < 3 || losses.length < 3) return null;
  const dw = avg(wins, 'd');
  const dl = avg(losses, 'd');
  if (!ok(dw, dl) || dw < 1 || dl / dw < 1.6) return null;
  return tip('p_death_losses', 'p_death_shape', 'Выживание', 'warn', 60, `В поражениях ты умираешь в ${D1(dl / dw)} раза чаще`,
    `В победах в среднем ${D1(dw)} ${plural(dw, 'смерть', 'смерти', 'смертей')} за игру, в поражениях — ${D1(dl)}.`,
    'Когда игра идёт плохо, хочется всё исправить одной дракой — и это заканчивается смертью. В проигрываемой игре играй от обороны и жди ошибки врага.');
});

rule((p) => {
  if (!enough(p)) return null;
  const me = med(p.mine, 'firstDeath');
  const lob = med(p.lobbyList, 'firstDeath');
  if (!ok(me, lob) || me >= 300 || lob - me < 120) return null;
  return tip('p_first_death', 'p_death_shape', 'Выживание', 'warn', 58, `Обычно первая смерть уже к ${T(me)}`,
    `Игроки твоего уровня в среднем впервые умирают на ${T(lob)}. Ранняя смерть отдаёт противнику по линии фору на всю линию.`,
    'Первые 5 минут играй на добивание крипов, а не на убийство. Начинай размены только когда у врага уже потрачены способности.');
});

rule((p) => {
  if (!enough(p, 6)) return null;
  const m = med(p.mine, 'd');
  const bad = p.mine.filter((f) => f.d >= Math.max(10, (m || 0) * 2));
  if (bad.length < 2) return null;
  return tip('p_disaster', 'p_death_shape', 'Выживание', 'warn', 55, `${bad.length} ${plural(bad.length, 'игра-катастрофа', 'игры-катастрофы', 'игр-катастроф')}`,
    `В ${bad.length} из ${p.mine.length} игр ты умер ${Math.min(...bad.map((f) => f.d))} и больше раз, хотя обычно — около ${D1(m)}. Такие игры почти всегда проигрываются.`,
    'Правило трёх смертей: если умер 3 раза за 5 минут — останавливайся. Следующие пару минут только фарм рядом со своей командой.');
});

rule((p) => {
  if (!enough(p, 6)) return null;
  const share = p.mine.filter((f) => f.deathBurst >= 3).length / p.mine.length;
  if (share < 0.3) return null;
  return tip('p_bursts', 'p_death_shape', 'Выживание', 'warn', 52, 'Часто умираешь сериями',
    `В ${P(share)} игр у тебя есть 3 смерти и больше за 5 минут подряд.`,
    'После смерти ты возвращаешься туда же, где тебя ждут. Сначала найди свою команду на карте и иди с ней.');
});

rule((p) => {
  if (!enough(p)) return null;
  const me = avg(p.mine, 'd');
  const lob = avg(p.lobbyList, 'd');
  if (!ok(me, lob) || me > lob * 0.7) return null;
  return tip('p_death_low', 'p_death_good', 'Выживание', 'good', 14, 'Ты умираешь реже своего уровня',
    `${D1(me)} ${plural(me, 'смерть', 'смерти', 'смертей')} за игру против ${D1(lob)} у игроков твоих матчей. Выживание — твоя сильная сторона.`);
});

rule((p) => {
  if (!enough(p, 6)) return null;
  const lob = avg(p.lobbyList, 'd');
  const list = p.mine.filter((f) => f.nwRank <= 2 && ok(lob) && f.d >= lob + 3);
  if (list.length / p.mine.length < 0.3) return null;
  return tip('p_rich_deaths', 'p_death_rich', 'Выживание', 'warn', 50, 'Умираешь, когда ты главный по фарму',
    `В ${list.length} играх ты был в двух самых богатых в команде — и умирал на 3+ раза больше обычного игрока.`,
    'Когда у тебя больше всех душ, враги охотятся именно за тобой. Пусть первым в драку заходит союзник, а ты добавляй урон вторым.');
});

// ======================= ФАРМ =======================
rule((p) => {
  if (!enough(p)) return null;
  const ph = [
    { k: 'soulsLane', id: 'p_farm_lane', name: 'на линии', tip: 'Главный доход до 10:00 — добивание крипов и сферы. Стреляй по сфере сразу после добивания и не уходи с линии без причины.' },
    { k: 'soulsMid', id: 'p_farm_mid', name: 'в середине игры', tip: 'С 10 до 20 минуты топы чередуют: волна на линии → лагерь в лесу → снова волна. Если ты стоишь и ждёшь драку — ты теряешь души.' },
    { k: 'soulsLate', id: 'p_farm_late', name: 'в поздней игре', tip: 'После 20:00 волны крипов становятся дорогими. Забирай их по дороге к месту драки, а не только убивай героев.' },
  ].map((x) => ({ ...x, r: ratio(avg(p.mine, x.k), avg(p.lobbyList, x.k)), me: avg(p.mine, x.k), lob: avg(p.lobbyList, x.k) })).filter((x) => ok(x.r) && x.r < 0.85);
  if (!ph.length) return null;
  const w = ph.sort((a, b) => a.r - b.r)[0];
  return tip(w.id, 'p_farm_phase', 'Фарм', 'warn', 66, `Сильнее всего отстаёшь по душам ${w.name}`,
    `${w.name[0].toUpperCase() + w.name.slice(1)} ты набираешь ${N(w.me)} душ в минуту, а игроки твоего уровня — ${N(w.lob)} (${P(w.r)}).`, w.tip);
});

rule((p) => {
  const src = p.sources;
  if (!src) return null;
  const gaps = src.filter((x) => x.rows && x.worst).sort((a, b) => b.worst.loss - a.worst.loss);
  if (!gaps.length) return null;
  const g = gaps[0];
  return tip(`p_src_${g.key}_${g.worst.field}`, 'p_farm_source', 'Фарм', g.worst.loss > 500 ? 'bad' : 'warn', 64,
    `Главный недобор душ — ${g.worst.name.toLowerCase()} (${g.name.toLowerCase()})`,
    `В фазе «${g.name.toLowerCase()}» на источнике «${g.worst.name.toLowerCase()}» ты в среднем теряешь ${N(g.worst.loss)} душ за каждые 10 минут против ${p.srcLabel}.`,
    g.worst.tip);
});

rule((p) => {
  if (!enough(p)) return null;
  const r = ratio(avg(p.mine, 'soulsPerCreep10'), avg(p.lobbyList, 'soulsPerCreep10'));
  if (!ok(r) || r >= 0.9) return null;
  return tip('p_orbs', 'p_orbs', 'Фарм', 'warn', 54, 'Теряешь сферы душ на линии',
    `С одного добитого крипа у тебя выходит ${P(r)} от того, что получает обычный игрок твоего уровня.`,
    'Из каждого добитого крипа вылетает сфера — её нужно подстрелить, иначе души достанутся врагу или пропадут. Сделай это привычкой на каждом крипе.');
});

rule((p) => {
  if (!enough(p)) return null;
  const me = avg(p.mine, 'dn10');
  const lob = avg(p.lobbyList, 'dn10');
  if (!ok(me, lob) || lob < 3 || me >= lob * 0.6) return null;
  return tip('p_denies', 'p_denies', 'Фарм', 'info', 36, 'Редко отбираешь сферы у противника',
    `К 10:00 у тебя в среднем ${D1(me)} отобранных сфер, у игроков твоего уровня — ${D1(lob)}.`,
    'Когда противник добивает твоего крипа, стреляй по сфере раньше него. Отобранная сфера — это минус души сопернику.');
});

rule((p) => {
  if (!enough(p)) return null;
  const nr = ratio(avg(p.mine, 'neu10'), avg(p.lobbyList, 'neu10'));
  const lr = ratio(avg(p.mine, 'lane10'), avg(p.lobbyList, 'lane10'));
  if (!ok(nr, lr)) return null;
  if (nr < 0.5 && lr >= 0.9) {
    return tip('p_jungle_none', 'p_jungle', 'Фарм', 'info', 38, 'В первые 10 минут не заходишь в лес',
      `С линии ты фармишь как надо, но лесных душ к 10:00 у тебя ${P(nr)} от обычного игрока твоего уровня.`,
      'Когда волна дошла до вражеского стража, у тебя есть 20–30 секунд — как раз на малый лагерь рядом с линией.');
  }
  if (nr > 1.5 && lr < 0.85) {
    return tip('p_jungle_early', 'p_jungle', 'Фарм', 'warn', 46, 'Слишком рано уходишь с линии в лес',
      `Лесных душ к 10:00 у тебя в ${D1(nr)} раза больше обычного, а с линии — только ${P(lr)}.`,
      'Пока идёт линия, волны дают больше леса. Оставайся на линии, а в лес заходи только когда волна запушена.');
  }
  return null;
});

rule((p) => {
  if (!enough(p)) return null;
  const list = p.mine.filter((f) => ok(f.unspentPeak) && f.unspentPeak >= 3500);
  if (list.length / p.mine.length < 0.4) return null;
  return tip('p_unspent', 'p_unspent', 'Предметы', 'warn', 44, 'Часто носишь много непотраченных душ',
    `В ${list.length} из ${p.mine.length} игр в какой-то момент у тебя было 3500+ душ, которые не превратились в предметы.`,
    'Заранее выбирай следующий предмет. Как только душ хватает — сразу в магазин, особенно перед большой дракой.');
});

rule((p) => {
  if (!enough(p)) return null;
  const r = ratio(avg(p.mine, 'treasureEnd'), avg(p.lobbyList, 'treasureEnd'));
  if (!ok(r) || r >= 0.5) return null;
  return tip('p_treasure', 'p_treasure', 'Фарм', 'info', 24, 'Пропускаешь ящики по дороге',
    `С ящиков и находок у тебя в среднем ${P(r)} от того, что берут игроки твоего уровня.`,
    'Ящики — бесплатные души. Разбивай их по пути с базы и между линиями, это пара секунд.');
});

rule((p) => {
  if (!enough(p)) return null;
  const r = ratio(avg(p.mine, 'bdmgMin'), avg(p.lobbyList, 'bdmgMin'));
  if (!ok(r) || r >= 0.6) return null;
  return tip('p_objectives', 'p_objectives', 'Объекты', 'warn', 48, 'Мало урона по стражам и боссам',
    `По объектам ты наносишь ${P(r)} от обычного игрока твоего уровня.`,
    'Игру выигрывают объекты, а не убийства. После выигранной драки сразу иди на ближайшего стража или ходока, пока враги возрождаются.');
});

rule((p) => {
  const h = p.heroes.find((x) => x.games >= 3 && p.topHero.get(x.hero_id) && p.topHero.get(x.hero_id).nw10.n >= 5);
  if (!h) return null;
  const ref = p.topHero.get(h.hero_id);
  const list = p.mine.filter((f) => f.hero === h.hero_id);
  if (list.length < 3) return null;
  const name = p.heroName(h.hero_id);
  const r10 = ratio(avg(list, 'nw10'), ref.nw10.med);
  const rMid = ratio(avg(list, 'soulsMid'), ref.soulsMid.med);
  const rDmg = ratio(avg(list, 'dmgMin'), ref.dmgMin.med);
  if (ok(r10) && r10 < 0.85) {
    return tip('p_hero_lane', 'p_hero_vs_top', 'Герои', 'warn', 50, `На ${name} отстаёшь от топов уже на линии`,
      `К 10:00 на ${name} у тебя в среднем ${N(avg(list, 'nw10'))} душ, у топов — ${N(ref.nw10.med)} (${P(r10)}).`,
      `Открой в «Про-игроках» пару матчей топов на ${name} и посмотри первые 10 минут: когда они добивают, когда дерутся, когда уходят в лес.`);
  }
  if (ok(rMid) && rMid < 0.85) {
    return tip('p_hero_mid', 'p_hero_vs_top', 'Герои', 'warn', 48, `На ${name} теряешь темп после линии`,
      `Линия на ${name} у тебя нормальная, но с 10 до 20 минуты ты набираешь ${P(rMid)} душ от топов.`,
      `Посмотри, куда топы на ${name} идут после 10:00 — обычно у героя есть свой «маршрут» фарма между линиями и лесом.`);
  }
  if (ok(rDmg) && rDmg < 0.8) {
    return tip('p_hero_dmg', 'p_hero_vs_top', 'Герои', 'warn', 46, `На ${name} мало урона по сравнению с топами`,
      `Урона по героям в минуту на ${name} у тебя ${P(rDmg)} от топов.`,
      `Проверь сборку ${name} на странице героя: какие предметы дают топам основной урон и к какой минуте они их собирают.`);
  }
  return null;
});

// ======================= ДРАКИ =======================
rule((p) => {
  if (!enough(p)) return null;
  const dr = ratio(avg(p.mine, 'dmgMin'), avg(p.lobbyList, 'dmgMin'));
  const sr = ratio(avg(p.mine, 'soulsMin'), avg(p.lobbyList, 'soulsMin'));
  const tr = ratio(avg(p.mine, 'dmgTMin'), avg(p.lobbyList, 'dmgTMin'));
  if (!ok(dr, sr)) return null;
  if (dr < 0.8 && ok(tr) && tr < 0.7) {
    return tip('p_absent', 'p_fight', 'Драки', 'warn', 58, 'Тебя часто нет в драках',
      `Ты наносишь ${P(dr)} урона от обычного игрока твоего уровня и получаешь всего ${P(tr)} — значит, ты просто не там, где дерутся.`,
      'Каждые несколько секунд смотри на карту. Когда твоя команда собирается вместе — это сигнал, что скоро драка.');
  }
  if (dr < 0.8 && sr >= 0.95) {
    return tip('p_dmg_farmok', 'p_fight', 'Драки', 'warn', 60, 'Фарм есть, урона мало',
      `Душ у тебя не меньше, чем у игроков твоего уровня, а урона по героям — ${P(dr)}.`,
      'Души у тебя есть — используй их. После покупки ключевого предмета ищи драку, а не следующий лагерь.');
  }
  if (dr < 0.8 && sr < 0.9) {
    return tip('p_dmg_farmlow', 'p_fight', 'Драки', 'warn', 54, 'Мало урона — из-за нехватки фарма',
      `Урона у тебя ${P(dr)} от твоего уровня, душ — ${P(sr)}. Урон растёт вместе с предметами.`,
      'Сначала подтяни фарм — урон вырастет сам. Совет по фарму смотри выше.');
  }
  if (sr >= 1.1 && dr >= 1.1) {
    return tip('p_strong_both', 'p_fight', 'Драки', 'good', 13, 'Фармишь и дерёшься выше своего уровня',
      `Душ ${P(sr)} и урона ${P(dr)} от обычного игрока твоих матчей. Ты готов к более сильным соперникам.`);
  }
  return null;
});

rule((p) => {
  if (!enough(p)) return null;
  const me = avg(p.mine, 'kp');
  const lob = avg(p.lobbyList, 'kp');
  if (!ok(me, lob) || me >= lob - 0.08) return null;
  return tip('p_kp', 'p_kp', 'Драки', 'warn', 50, 'Редко участвуешь в убийствах команды',
    `В среднем ты участвуешь в ${P(me)} убийств своей команды, игроки твоего уровня — в ${P(lob)}.`,
    'Помощь в убийстве даёт и души, и опыт. Когда видишь драку рядом — иди, даже если лагерь в лесу не добит.');
});

rule((p) => {
  if (!enough(p)) return null;
  const ns = avg(p.mine, 'nwShare');
  const ds = avg(p.mine, 'dmgShare');
  if (!ok(ns, ds) || ns < 0.17 || ds >= 0.13) return null;
  return tip('p_rich_lowdmg', 'p_impact', 'Драки', 'warn', 52, 'Много душ, мало вклада в драки',
    `В среднем у тебя ${P(ns)} душ команды, а урона по героям — только ${P(ds)}.`,
    'Ты фармишь как главный герой команды, но в драках им не становишься. С таким фармом вступай в драку одним из первых.');
});

rule((p) => {
  if (!enough(p)) return null;
  const tr = ratio(avg(p.mine, 'dmgTMin'), avg(p.lobbyList, 'dmgTMin'));
  const dme = avg(p.mine, 'd');
  const dlob = avg(p.lobbyList, 'd');
  if (!ok(tr, dme, dlob) || tr < 1.3 || dme < dlob + 1) return null;
  const noVit = p.mine.filter((f) => f.slots20 && f.slots20.vitality === 0).length / p.mine.length;
  return noVit >= 0.5
    ? tip('p_taken_novit', 'p_taken', 'Выживание', 'warn', 50, 'По тебе много урона, а живучести в сборке нет',
      `Урона по тебе ${P(tr)} от обычного, и в ${P(noVit)} игр к 20:00 у тебя нет ни одного предмета на живучесть.`,
      'Один-два зелёных предмета к середине игры часто дают больше, чем ещё один предмет на урон: живой герой стреляет дольше.')
    : tip('p_taken_pos', 'p_taken', 'Выживание', 'warn', 46, 'Стоишь слишком близко к врагу',
      `Урона по тебе ${P(tr)} от обычного игрока твоего уровня, и умираешь ты чаще.`,
      'В драке держись за спинами союзников, которые принимают урон, и стреляй оттуда.');
});

rule((p) => {
  if (!enough(p)) return null;
  const k = avg(p.mine, 'k');
  const a = avg(p.mine, 'a');
  const kl = avg(p.lobbyList, 'k');
  if (!ok(k, a, kl) || a < 8 || k > a / 3.5 || k >= kl * 0.7) return null;
  return tip('p_finisher', 'p_kills', 'Драки', 'info', 26, 'Помогаешь много, добиваешь мало',
    `В среднем ${D1(k)} убийств и ${D1(a)} помощи за игру. Обычный игрок твоего уровня добивает ${D1(kl)}.`,
    'Убийство даёт больше душ, чем помощь. Если у врага мало здоровья и ты рядом — добивай сам.');
});

// ======================= СТРЕЛЬБА =======================
rule((p) => {
  if (!enough(p)) return null;
  const me = avg(p.mine, 'acc');
  const lob = avg(p.lobbyList, 'acc');
  if (!ok(me, lob)) return null;
  if (me < lob - 0.05) {
    return tip('p_acc_low', 'p_acc', 'Стрельба', 'warn', 42, 'Точность ниже твоего уровня',
      `Попадаешь ${P(me)} выстрелов, игроки твоих матчей — ${P(lob)}.`,
      '10 минут в песочнице перед игрой: стрельба по движущимся ботам. В бою — короткие очереди и меньше прыжков во время стрельбы.');
  }
  if (me > lob + 0.05) {
    return tip('p_acc_high', 'p_acc', 'Стрельба', 'good', 11, 'Стреляешь точнее своего уровня',
      `${P(me)} попаданий против ${P(lob)} у игроков твоих матчей. Герои, которые зависят от оружия, — твоя сильная сторона.`);
  }
  return null;
});

rule((p) => {
  if (!enough(p)) return null;
  const me = avg(p.mine, 'hsRate');
  const lob = avg(p.lobbyList, 'hsRate');
  if (!ok(me, lob) || lob < 0.06 || me >= lob * 0.65) return null;
  return tip('p_hs', 'p_hs', 'Стрельба', 'info', 34, 'Редко попадаешь в голову',
    `В голову у тебя ${P(me)} попаданий по героям, у игроков твоего уровня — ${P(lob)}.`,
    'Держи прицел на высоте головы, даже когда просто бежишь. В песочнице тренируй именно попадание в голову.');
});

rule((p) => {
  if (!enough(p)) return null;
  const r = ratio(avg(p.mine, 'heroShotShare'), avg(p.lobbyList, 'heroShotShare'));
  if (!ok(r) || r >= 0.7) return null;
  return tip('p_shots_creeps', 'p_shot_target', 'Стрельба', 'info', 32, 'Слишком много выстрелов по крипам',
    `Доля попаданий по героям у тебя — ${P(r)} от обычной.`,
    'Когда враг рядом, переключайся на него. Крипов добивай последним выстрелом, а не стреляй по ним всей обоймой.');
});

// ======================= ПРЕДМЕТЫ =======================
rule((p) => {
  const delays = [];
  const farmR = [];
  for (const f of p.mine) {
    const ref = p.topHero.get(f.hero);
    if (!ref || !ok(f.firstBigT, ref.firstBigT.med) || ref.firstBigT.n < 5) continue;
    delays.push(f.firstBigT - ref.firstBigT.med);
    if (ok(f.soulsLane, ref.soulsLane.med)) farmR.push(f.soulsLane / ref.soulsLane.med);
  }
  if (delays.length < 3) return null;
  const d = mean(delays);
  if (d < 150) return null;
  const fr = farmR.length ? mean(farmR) : 1;
  return fr < 0.85
    ? tip('p_big_late_farm', 'p_big_item', 'Предметы', 'warn', 47, `Первый дорогой предмет в среднем на ${T(d)} позже топов`,
      `Причина — фарм: на линии у тебя ${P(fr)} душ от топов на тех же героях.`,
      'Сборку менять не нужно — нужно больше душ к 10–12 минуте. Добивание крипов и сферы — первое, над чем стоит поработать.')
    : tip('p_big_late_spend', 'p_big_item', 'Предметы', 'warn', 49, `Первый дорогой предмет в среднем на ${T(d)} позже топов`,
      'Фарма при этом хватает, значит души уходят на мелкие покупки до главного предмета.',
      'Посмотри на странице героя, что топы берут до первого предмета за 3000+, и копи на него, не отвлекаясь.');
});

rule((p) => {
  if (!enough(p)) return null;
  const c = avg(p.mine, 'cheapLate');
  if (!ok(c) || c < 2) return null;
  return tip('p_cheap_late', 'p_cheap', 'Предметы', 'info', 28, 'После 20:00 покупаешь дешёвые предметы',
    `В среднем ${D1(c)} ${plural(c, 'предмет', 'предмета', 'предметов')} до 800 душ после 20 минуты за игру.`,
    'В поздней игре слот ценнее. Копи на дорогие предметы и меняй ими дешёвые.');
});

rule((p) => {
  if (!enough(p)) return null;
  const s = avg(p.mine, 'itemsSold');
  if (!ok(s) || s < 2) return null;
  return tip('p_sold', 'p_sold', 'Предметы', 'info', 25, 'Часто продаёшь предметы',
    `В среднем ${D1(s)} ${plural(s, 'продажа', 'продажи', 'продаж')} за игру — на каждой теряется часть душ.`,
    'Выбери одну проверенную сборку на героя (страница героя в «Мете») и держись её, а не меняй по ходу.');
});

// ======================= РЕЗУЛЬТАТЫ =======================
rule((p) => {
  const throws = p.mine.filter((f) => !f.won && ok(f.teamDiff25) && f.teamDiff25 >= 5000);
  if (throws.length < 2) return null;
  return tip('p_throws', 'p_throws', 'Ход игры', 'bad', 62, `${throws.length} ${plural(throws.length, 'игру', 'игры', 'игр')} упустили, ведя к 25:00`,
    `В этих играх твоя команда вела на 5000+ душ к 25 минуте — и проиграла.`,
    'С преимуществом главная опасность — расслабиться. Ходите вместе, ставьте цель (страж, ходок, база), а не гоняйтесь за убийствами.');
});

rule((p) => {
  const cb = p.mine.filter((f) => f.won && ok(f.teamDiff20) && f.teamDiff20 <= -4000);
  if (cb.length < 2) return null;
  return tip('p_comebacks', 'p_comebacks', 'Ход игры', 'good', 12, `${cb.length} ${plural(cb.length, 'камбэк', 'камбэка', 'камбэков')}`,
    `${cb.length} ${plural(cb.length, 'раз', 'раза', 'раз')} вы отставали на 4000+ душ к 20:00 — и выигрывали. Ты не сдаёшься в тяжёлых играх, это ценно.`);
});

rule((p) => {
  const fast = p.mine.filter((f) => !f.won && f.dur < 25);
  if (fast.length < 3) return null;
  return tip('p_stomped', 'p_stomped', 'Ход игры', 'warn', 52, `${fast.length} ${plural(fast.length, 'быстрое поражение', 'быстрых поражения', 'быстрых поражений')} до 25 минуты`,
    'Быстрые поражения почти всегда решаются на линиях и сразу после них.',
    'Разбери одну такую игру в «Моих матчах» — смотри только первые 12 минут. Там и есть главный резерв.');
});

rule((p) => {
  const long = p.durations.filter((d) => d.from >= 35).reduce((a, d) => ({ g: a.g + d.games, w: a.w + d.wins }), { g: 0, w: 0 });
  const short = p.durations.filter((d) => d.from < 35).reduce((a, d) => ({ g: a.g + d.games, w: a.w + d.wins }), { g: 0, w: 0 });
  if (long.g < 5 || short.g < 5) return null;
  const lw = long.w / long.g;
  const sw = short.w / short.g;
  if (lw < sw - 0.15) {
    return tip('p_long_bad', 'p_length', 'Ход игры', 'warn', 42, 'Затяжные игры проигрываются чаще',
      `Игры дольше 35 минут: винрейт ${P(lw)}, короче — ${P(sw)}.`,
      'В поздней игре одна смерть решает всё. Держись с командой, дерись у объектов и не фарми в одиночку далеко от неё.');
  }
  if (sw < lw - 0.15) {
    return tip('p_short_bad', 'p_length', 'Ход игры', 'info', 36, 'Ты сильнее в долгих играх',
      `Игры дольше 35 минут: винрейт ${P(lw)}, короче — ${P(sw)}. Ранняя игра — твоё слабое место.`,
      'Тебе нужно пережить начало. Играй безопаснее на линии: даже ровная линия даёт тебе шанс выиграть позже.');
  }
  return null;
});

rule((p) => {
  const s = p.summary;
  if (!enough(p, 8) || !ok(s.wr, s.kda)) return null;
  const kdaLob = avg(p.lobbyList.map((f) => ({ x: (f.k + f.a) / Math.max(1, f.d) })), 'x');
  if (!ok(kdaLob)) return null;
  if (s.kda >= kdaLob * 1.2 && s.wr < 0.45) {
    return tip('p_kda_nowin', 'p_kda_wr', 'Ход игры', 'warn', 48, 'Хорошая статистика, но мало побед',
      `KDA ${D1(s.kda)} — выше, чем у игроков твоего уровня (${D1(kdaLob)}), а винрейт ${P(s.wr)}.`,
      'Убийства не выигрывают игру сами по себе. После каждой выигранной драки задай себе вопрос: какой объект мы сейчас берём?');
  }
  if (s.kda < kdaLob * 0.85 && s.wr >= 0.55) {
    return tip('p_win_lowkda', 'p_kda_wr', 'Ход игры', 'info', 20, 'Выигрываешь чаще, чем говорит статистика',
      `Винрейт ${P(s.wr)} при KDA ${D1(s.kda)} (у твоего уровня ${D1(kdaLob)}). Ты приносишь команде пользу, которой не видно в цифрах.`,
      'Подтяни выживание — и при тех же решениях побед станет ещё больше.');
  }
  return null;
});

rule((p) => {
  const wins = p.mine.filter((f) => f.won);
  const losses = p.mine.filter((f) => !f.won);
  const carried = wins.filter((f) => f.nwRank >= 5);
  const goodLoss = losses.filter((f) => f.nwRank <= 2 && ok(f.kp) && f.kp >= 0.5);
  if (goodLoss.length >= 3) {
    return tip('p_good_losses', 'p_team', 'Команда', 'info', 34, `${goodLoss.length} ${plural(goodLoss.length, 'поражение', 'поражения', 'поражений')}, в которых ты был среди лучших`,
      'В этих играх ты был в двух самых богатых в команде и участвовал в половине убийств — но команда проиграла.',
      'Индивидуально ты тянешь. Следующий шаг — вести команду: отмечай на карте цели (пинг на стража, на босса), говори, куда идти после драки.');
  }
  if (wins.length >= 5 && carried.length / wins.length >= 0.4) {
    return tip('p_carried', 'p_team', 'Команда', 'info', 30, 'Часто побеждаешь не за счёт себя',
      `В ${carried.length} из ${wins.length} побед ты был среди двух самых бедных в команде.`,
      'Победы приятны, но расти помогают разборы. Открой пару таких побед в «Моих матчах» и найди, где ты отставал.');
  }
  return null;
});

// ======================= ПРИВЫЧКИ =======================
rule((p) => {
  const b = p.sessions.buckets;
  const early = b.slice(0, 2).reduce((a, x) => ({ g: a.g + x.games, w: a.w + x.wins }), { g: 0, w: 0 });
  const later = b.slice(2).reduce((a, x) => ({ g: a.g + x.games, w: a.w + x.wins }), { g: 0, w: 0 });
  if (early.g < 5 || later.g < 5 || later.w / later.g >= early.w / early.g - 0.1) return null;
  return tip('p_fatigue', 'p_session', 'Сессии', 'warn', 64, 'К концу сессии ты играешь хуже',
    `В первых двух играх сессии винрейт ${P(early.w / early.g)}, а с третьей игры подряд — ${P(later.w / later.g)} (${later.g} игр).`,
    'После двух-трёх игр делай перерыв на 15–20 минут: встань, попей воды. Усталость незаметно съедает реакцию и решения.');
});

rule((p) => {
  const b = p.sessions.buckets;
  const first = b[0];
  const next = b.slice(1, 3).reduce((a, x) => ({ g: a.g + x.games, w: a.w + x.wins }), { g: 0, w: 0 });
  if (first.games < 4 || next.g < 4 || first.wr >= next.w / next.g - 0.15) return null;
  return tip('p_warmup', 'p_session', 'Сессии', 'warn', 50, 'Первая игра сессии — самая слабая',
    `В первой игре за сессию винрейт ${P(first.wr)}, во второй-третьей — ${P(next.w / next.g)}.`,
    'Перед первой игрой разомнись 10 минут в песочнице или сыграй обычный матч — в рейтинг заходи уже «разогретым».');
});

rule((p) => {
  const t = p.tilt;
  const s = p.summary;
  if (t.afterLoss < 5 || !ok(t.afterLossWr, s.wr) || t.afterLossWr >= s.wr - 0.12) return null;
  return tip('p_tilt', 'p_tilt', 'Настрой', 'warn', 60, 'После поражения следующая игра часто тоже проигрывается',
    `Сразу после поражения винрейт ${P(t.afterLossWr)} (${t.afterLoss} игр), в среднем у тебя ${P(s.wr)}.`,
    'После обидного поражения не нажимай «Найти игру» сразу. Пара минут перерыва или разбор матча в «Моих матчах» — и ты зайдёшь с холодной головой.');
});

rule((p) => {
  const s = p.summary.streak;
  if (!s) return null;
  if (!s.win && s.n >= 3) {
    return tip('p_lose_streak', 'p_streak', 'Настрой', 'warn', 70, `Сейчас серия из ${s.n} ${plural(s.n, 'поражения', 'поражений', 'поражений')}`,
      'Длинная серия поражений — хороший момент остановиться: дальше обычно играешь на нервах.',
      'Сделай перерыв хотя бы на час. Вернувшись, начни с обычного матча или разбери последнее поражение в «Моих матчах».');
  }
  if (s.win && s.n >= 4) {
    return tip('p_win_streak', 'p_streak', 'Настрой', 'good', 15, `Серия из ${s.n} ${plural(s.n, 'победы', 'побед', 'побед')}`,
      'Ты в форме. Хорошее время для рейтинговых игр — но следи за усталостью, если сессия затягивается.');
  }
  return null;
});

rule((p) => {
  const night = p.games.filter((g) => g.won !== null && [0, 1, 2, 3, 4, 5].includes(new Date(g.start_time * 1000).getHours()));
  const day = p.games.filter((g) => g.won !== null && !night.includes(g));
  if (night.length < 4 || day.length < 4) return null;
  const nw = wrOf(night);
  const dw = wrOf(day);
  if (nw >= dw - 0.15) return null;
  return tip('p_night', 'p_time', 'Режим', 'warn', 46, 'Ночью ты играешь заметно хуже',
    `Игры с полуночи до 6 утра: винрейт ${P(nw)} (${night.length}), в остальное время — ${P(dw)}.`,
    'Поздно вечером реакция и внимание ниже, чем кажется. Ставь себе время последней рейтинговой игры.');
});

rule((p) => {
  const days = Math.max(1, Math.min(p.days, (p.games.length ? (Math.max(...p.games.map((g) => g.start_time)) - Math.min(...p.games.map((g) => g.start_time))) / 86400 + 1 : 1)));
  const perDay = p.summary.hours / days;
  if (perDay < 5) return null;
  return tip('p_hours', 'p_volume', 'Режим', 'info', 30, `В среднем ${D1(perDay)} ${plural(perDay, 'час', 'часа', 'часов')} игры в день`,
    'Столько часов подряд сложно держать концентрацию — качество каждой игры падает.',
    'Лучше меньше игр, но с разбором: одна разобранная игра даёт больше, чем три сыгранных на автомате.');
});

rule((p) => {
  if (p.sessions.avgLen < 5 || p.sessions.sessions < 2) return null;
  return tip('p_long_sessions', 'p_volume', 'Режим', 'info', 32, `Длинные сессии — в среднем ${D1(p.sessions.avgLen)} ${plural(p.sessions.avgLen, 'игра', 'игры', 'игр')} подряд`,
    'Чем длиннее сессия, тем больше игр ты играешь уставшим.',
    'Делай перерыв каждые 2–3 игры — даже 10 минут заметно освежают голову.');
});

rule((p) => {
  const ranked = p.games.filter((g) => g.match_mode === 4 && g.won !== null);
  const casual = p.games.filter((g) => g.match_mode === 1 && g.won !== null);
  if (ranked.length < 4 || casual.length < 4) return null;
  const rw = wrOf(ranked);
  const cw = wrOf(casual);
  if (rw < cw - 0.15) {
    return tip('p_ranked_worse', 'p_mode', 'Настрой', 'info', 40, 'В рейтинге играешь хуже, чем в обычных',
      `Рейтинг: винрейт ${P(rw)} (${ranked.length}), обычные: ${P(cw)} (${casual.length}).`,
      'Похоже на волнение. В рейтинге играй на тех героях и сборках, которые уверенно работают у тебя в обычных играх, — не экспериментируй.');
  }
  if (cw < rw - 0.2) {
    return tip('p_casual_worse', 'p_mode', 'Настрой', 'info', 22, 'В обычных играх играешь небрежно',
      `Обычные: винрейт ${P(cw)}, рейтинг: ${P(rw)}. Похоже, в обычных ты расслабляешься.`,
      'Используй обычные игры как тренировку: ставь себе одну цель на матч, например «ни одной смерти до 10:00».');
  }
  return null;
});

rule((p) => {
  const list = p.games.filter((g) => g.won !== null).slice().sort((a, b) => a.start_time - b.start_time);
  if (list.length < 10) return null;
  const half = Math.floor(list.length / 2);
  const a = wrOf(list.slice(0, half));
  const b = wrOf(list.slice(half));
  const ma = p.mine.filter((f) => f.start <= list[half - 1].start_time);
  const mb = p.mine.filter((f) => f.start > list[half - 1].start_time);
  const da = avg(ma, 'd');
  const db = avg(mb, 'd');
  if (b >= a + 0.15) {
    return tip('p_trend_up', 'p_trend', 'Прогресс', 'good', 16, 'Ты прогрессируешь',
      `Первая половина периода: винрейт ${P(a)}, вторая — ${P(b)}${ok(da, db) && db < da ? `, а смертей стало меньше: ${D1(da)} → ${D1(db)}` : ''}.`);
  }
  if (b <= a - 0.15) {
    return tip('p_trend_down', 'p_trend', 'Прогресс', 'warn', 45, 'Последние игры хуже, чем в начале периода',
      `Винрейт: ${P(a)} в первой половине, ${P(b)} — во второй${ok(da, db) && db > da ? `; смертей стало больше: ${D1(da)} → ${D1(db)}` : ''}.`,
      'Это может быть усталость или тильт. Пара дней с меньшим числом игр часто возвращает форму.');
  }
  return null;
});

// ======================= ГЕРОИ =======================
rule((p) => {
  const s = p.summary;
  const hs = p.heroes;
  if (s.n < 10 || !hs.length) return null;
  if (hs.length >= 6 && hs[0].games / s.n < 0.35) {
    const best = hs.filter((x) => x.games >= 3).sort((a, b) => b.ci_lo - a.ci_lo)[0];
    return tip('p_pool_wide', 'p_pool', 'Герои', 'info', 36, `${hs.length} разных героев за ${p.days} дн.`,
      `Когда героев много, на каждом мало опыта: тайминги, сборки и линии не запоминаются.${best ? ` Лучше всего у тебя идёт ${p.heroName(best.hero_id)} (${best.wins}–${best.losses}).` : ''}`,
      'Выбери 2–3 героя и играй в основном их хотя бы неделю. Так мастерство растёт быстрее всего.');
  }
  if (hs[0].games / s.n >= 0.7 && hs[0].games >= 8) {
    return tip('p_onetrick', 'p_pool', 'Герои', 'info', 18, `Ты мейн ${p.heroName(hs[0].hero_id)}`,
      `${hs[0].games} из ${s.n} игр — на ${p.heroName(hs[0].hero_id)}, винрейт ${P(hs[0].wr)}.`,
      `Держи в запасе ещё 1–2 героя на случай, если ${p.heroName(hs[0].hero_id)} заберут или забанят.`);
  }
  return null;
});

rule((p) => {
  const bad = p.heroes.filter((x) => x.games >= 5 && x.wr !== null && x.wr <= 0.35).sort((a, b) => a.wr - b.wr)[0];
  if (!bad) return null;
  const others = p.heroes.filter((x) => x.hero_id !== bad.hero_id && x.games >= 3 && x.wr !== null && x.wr >= 0.5);
  return tip('p_hero_bad', 'p_hero_wr', 'Герои', 'warn', 44, `На ${p.heroName(bad.hero_id)} не идёт: ${bad.wins}–${bad.losses}`,
    `Винрейт ${P(bad.wr)} за ${bad.games} игр.${others.length ? ` На ${others.map((x) => p.heroName(x.hero_id)).slice(0, 2).join(' и ')} у тебя получается лучше.` : ''}`,
    `Либо отложи ${p.heroName(bad.hero_id)} в рейтинге, либо разбери пару поражений на нём в «Моих матчах» против топов — там видно, где именно ты теряешь.`);
});

rule((p) => {
  const good = p.heroes.filter((x) => x.games >= 4 && x.wr !== null && x.wr >= 0.65).sort((a, b) => b.ci_lo - a.ci_lo)[0];
  if (!good) return null;
  return tip('p_hero_good', 'p_hero_best', 'Герои', 'good', 13, `${p.heroName(good.hero_id)} — твой лучший герой`,
    `${good.wins}–${good.losses} за период (${P(good.wr)}). В важных рейтинговых играх бери его.`);
});

rule((p) => {
  if (p.heroes.length < 2) return null;
  const all = avg(p.mine, 'd');
  for (const h of p.heroes.filter((x) => x.games >= 4)) {
    const list = p.mine.filter((f) => f.hero === h.hero_id);
    if (list.length < 4) continue;
    const dh = avg(list, 'd');
    if (ok(dh, all) && dh >= all + 2.5) {
      return tip('p_hero_deaths', 'p_hero_deaths', 'Герои', 'warn', 42, `На ${p.heroName(h.hero_id)} ты умираешь заметно чаще`,
        `На ${p.heroName(h.hero_id)} в среднем ${D1(dh)} смертей за игру, на остальных — ${D1(all)}.`,
        `${p.heroName(h.hero_id)} требует другой дистанции в драке. Посмотри, где стоят топы на нём во время драк — обычно дальше, чем кажется.`);
    }
  }
  return null;
});

rule((p) => {
  const fresh = p.heroes.filter((x) => x.games <= 2 && x.losses >= 1 && x.wins === 0);
  const rankedFresh = p.games.filter((g) => g.match_mode === 4 && fresh.some((x) => x.hero_id === g.hero_id));
  if (fresh.length < 2 || rankedFresh.length < 2) return null;
  return tip('p_experiments', 'p_experiments', 'Герои', 'info', 30, 'Пробуешь новых героев в рейтинге',
    `${fresh.map((x) => p.heroName(x.hero_id)).slice(0, 3).join(', ')} — по 1–2 игры, побед нет.`,
    'Новых героев лучше осваивать в обычных играх: там проигрыш не стоит рейтинга.');
});

// ======================= СИЛЬНЫЕ СТОРОНЫ =======================
const STRENGTH = {
  dmgMin: (v, m) => [`Урон по героям — топ ${v}% среди твоего уровня`, `${m} в минуту. Ты сильнее всего в драках — ищи их чаще.`],
  soulsMin: (v, m) => [`Фарм — топ ${v}% среди твоего уровня`, `${m} душ в минуту. Ты умеешь быстро расти — превращай это в давление на объекты.`],
  kda: (v, m) => [`KDA — топ ${v}% среди твоего уровня`, `KDA ${m}. Ты умеешь драться и выживать — бери на себя роль того, кто начинает драки.`],
  acc: (v, m) => [`Точность — топ ${v}% среди твоего уровня`, `${m} попаданий. Тебе подходят герои, которые зависят от стрельбы.`],
  kp: (v, m) => [`Участие в убийствах — топ ${v}% среди твоего уровня`, `${m} убийств команды с твоим участием. Ты всегда там, где драка, — это редкое качество.`],
};
rule((p) => {
  const s = Object.keys(STRENGTH).map((k) => p.compare.find((m) => m.key === k)).filter((m) => m && m.place && m.place.top && m.place.value <= 30).sort((a, b) => a.place.value - b.place.value)[0];
  if (!s) return null;
  const [title, text] = STRENGTH[s.key](s.place.value, s.meText);
  return tip(`p_strength_${s.key}`, 'p_strength', 'Сильная сторона', 'good', 10, title, text);
});

// ======================= БАЗОВЫЕ ПРИВЫЧКИ (под слабое место) =======================
const BASICS = [
  { id: 'b_map', area: 'deaths', title: 'Миникарта каждые 5–10 секунд', text: 'Большинство смертей — от врагов, которых ты не видел.', tip: 'Тренировка: на каждой новой волне крипов смотри на карту и считай видимых врагов.' },
  { id: 'b_retreat', area: 'deaths', title: 'Отступай заранее', text: 'Уходить нужно, когда здоровья половина, а не когда оно почти кончилось — по дороге назад тебя тоже бьют.', tip: 'Поставь себе правило: меньше половины здоровья и нет лечения — назад.' },
  { id: 'b_cs', area: 'farm', title: 'Добивание — главный навык линии', text: 'Разница между хорошей и плохой линией — несколько добитых крипов в каждой волне.', tip: 'В песочнице потренируй добивание: стреляй по крипу только когда у него мало здоровья.' },
  { id: 'b_route', area: 'farm', title: 'Маршрут фарма', text: 'Сильные игроки всегда знают, куда пойдут после волны: лагерь, ящики, следующая линия.', tip: 'Перед каждым перемещением реши, что заберёшь по дороге.' },
  { id: 'b_idle', area: 'farm', title: 'Не стой без дела', text: 'У сильных игроков почти нет минут, когда они ничего не фармят и не дерутся.', tip: 'Если ждёшь драку — ждёшь у лагеря в лесу, а не на месте.' },
  { id: 'b_focus', area: 'fight', title: 'Выбирай цель в драке', text: 'Урон по танку в начале драки мало что решает.', tip: 'Стреляй по тому, кого можешь убить быстрее всего, — обычно это герой, который стоит сзади.' },
  { id: 'b_join', area: 'fight', title: 'Приходи в драку вовремя', text: 'Опоздать в драку на 10 секунд — почти то же, что не прийти.', tip: 'Когда команда собирается вместе — иди к ней сразу, лагерь подождёт.' },
  { id: 'b_aim', area: 'aim', title: 'Разминка перед игрой', text: 'Первые минуты без разминки точность заметно ниже.', tip: '5–10 минут в песочнице по движущимся ботам перед рейтингом.' },
  { id: 'b_items', area: 'items', title: 'Планируй покупки', text: 'Топы заранее знают следующий предмет и копят под него.', tip: 'Смотри тайминги своей сборки на странице героя во вкладке «Мета».' },
  { id: 'b_obj', area: 'objectives', title: 'После драки — объект', text: 'Выигранная драка без взятого стража или ходока — упущенная выгода.', tip: 'Как только враги умерли — все вместе на ближайший объект.' },
  { id: 'b_review', area: 'any', title: 'Разбирай одну игру в день', text: 'Один честный разбор даёт больше, чем пять игр подряд на автомате.', tip: 'Открой поражение в «Моих матчах» и выпиши один главный вывод.' },
  { id: 'b_mind', area: 'any', title: 'Одна цель на игру', text: 'Пытаться исправить всё сразу не получается.', tip: 'Перед игрой выбери одну цель, например «не умереть до 10:00», и после игры проверь её в «Тренере».' },
];

function basicsFor(p, existing) {
  const weakKeys = p.compare.filter((m) => m.place && !m.place.top).sort((a, b) => a.place.value - b.place.value).map((m) => m.key);
  const areaOf = { deaths: 'deaths', soulsMin: 'farm', lhMin: 'farm', dmgMin: 'fight', kp: 'fight', acc: 'aim', kda: 'deaths' };
  const wanted = [...new Set(weakKeys.map((k) => areaOf[k]).filter(Boolean)), 'items', 'objectives', 'any'];
  const out = [];
  for (const a of wanted) for (const b of BASICS.filter((x) => x.area === a)) if (!out.includes(b)) out.push(b);
  const problems = existing.filter((x) => x.level !== 'good').length;
  return out.slice(0, Math.max(0, 3 - problems)).map((b) => tip(b.id, `basic_${b.id}`, 'Основы', 'info', 5, b.title, b.text, b.tip));
}

function periodTips(p) {
  const out = [];
  for (const r of RULES) {
    try {
      const t = r(p);
      if (t) out.push(t);
    } catch (e) {
      // одно правило не должно ронять обзор
    }
  }
  return out;
}

module.exports = { periodTips, basicsFor, PERIOD_RULES: RULES, BASICS };
