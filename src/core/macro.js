'use strict';

const { findFights, SOUL_LOSS_THRESHOLD } = require('./leaks');
const { isStandardMatch } = require('./meta');
const { N, T } = require('./tipkit');
// Первый полный UTC-день после каждого обновления. Игры в день релиза
// могут быть сыграны как до, так и после смены карты или правил.
const RIFT_PATCH = Date.UTC(2026, 6, 1) / 1000;
const CITY_PATCH = Date.UTC(2026, 8, 30) / 1000;

function macroReview(match, player, { nameOf = () => null } = {}) {
  if (!isStandardMatch(match) || !(match.duration_s > 0)) return [];
  const rows = [];
  const samples = player.stats || [];
  const deaths = player.deaths_t || [];
  for (let i = 0; i < samples.length; i++) {
    const prev = samples[i - 1] || { t: 0, d: 0, g_lost: 0 };
    const cur = samples[i];
    const count = cur.d - prev.d;
    const loss = cur.g_lost - prev.g_lost;
    if (!(count > 0 && Number.isFinite(loss) && loss >= SOUL_LOSS_THRESHOLD && cur.t > prev.t)) continue;
    const events = deaths.filter((t) => t > prev.t && t <= cur.t);
    const exact = count === 1 && events.length === 1;
    const title = exact ? 'Крупная потеря душ при смерти' : 'Потеря душ между замерами';
    rows.push({
      title,
      text: exact ? `На ${T(events[0])} при смерти потеряно ${N(loss)} душ.`
        : `Между ${T(prev.t)} и ${T(cur.t)} зарегистрировано смертей: ${count}. Суммарная потеря — ${N(loss)} душ.`,
      tip: exact
        ? 'Открой момент перед смертью и сравни пользу следующего действия с риском потерять мешок. Если это был пуш Walker, проверь, можно ли было отойти и вернуться с командой.'
        : 'Посмотри смерти в этом интервале. Сумма относится ко всему интервалу, поэтому начни с эпизода, где можно было отойти.',
      moments: [{ t: exact ? events[0] : prev.t, text: exact ? 'Смерть' : 'Начало интервала' }],
      evidence: exact ? { key: 'lost_souls', matchId: match.match_id, t: events[0] } : null,
    });
  }

  const early = samples.findLast((s) => s.t >= 300 && s.t <= 540 && Number.isFinite(s.g_brk));
  if (early) rows.push({
    title: 'Коробки и ранний доход',
    text: `К снимку на ${T(early.t)} с коробок собрано ${N(early.g_brk)} душ.`
      + (Number.isFinite(early.g_lane) ? ` С линии за тот же период — ${N(early.g_lane)}.` : ''),
    tip: (early.g_brk > 0
      ? 'Посмотри, после какой волны ты успел взять коробки, и попробуй повторить этот маршрут, когда есть время вернуться на линию.'
      : 'Проверь в повторе, открывалось ли время на короткий маршрут к коробкам у линии'
        + (match.start_time >= CITY_PATCH ? ' или в Plaza и Big Ben.' : '.')
        + ' Если волна уже шла к твоей башне, сравни, что пришлось бы оставить.'),
    moments: [{ t: early.t, text: 'Снимок дохода' }],
  });

  const bosses = (match.midBoss || []).filter((b) => Number.isFinite(b[2]) && b[2] > 0 && b[2] <= match.duration_s);
  if (bosses.length) rows.push({
    title: 'Midboss в этом матче',
    text: 'По журналу видно, кто убил Midboss и кто забрал награду.',
    tip: 'Посмотри, кто из союзников мог подойти и кто из врагов ещё мог оспорить награду.',
    moments: bosses.map(([kill, claim, t]) => ({
      t, text: `Убийство — ${teamLabel(kill, player.team)}, награда — ${teamLabel(claim, player.team)}`,
    })),
  });

  const teamBySlot = new Map(match.players.map((p) => [p.slot, p.team]));
  const fights = findFights(match);
  if (player.team === 0 || player.team === 1) {
    for (const fight of fights) {
      if (fight.t1 < 600 || fight.t1 > Math.min(1200, match.duration_s)) continue;
      if (!fight.deaths.every((d) => Number.isFinite(d.x) && Number.isFinite(d.y))) continue;
      // Считаем только недавние убийства, чтобы длинная цепочка смертей не выглядела как численное преимущество.
      const recent = fight.deaths.filter((d) => d.t >= fight.t1 - 20);
      const opponents = new Set(recent.filter((d) => d.team === 1 - player.team && d.slot != null
        && teamBySlot.get(d.killer) === player.team).map((d) => d.slot));
      if (opponents.size < 3) continue;
      const allies = new Set(recent.filter((d) => d.team === player.team && d.slot != null).map((d) => d.slot));
      const ourBoss = bosses.find(([kill, , t]) => kill === player.team && t >= fight.t1 && t <= fight.t1 + 60);
      const text = `За 20 секунд к ${T(fight.t1)} твоя команда убила ${opponents.size} разных соперников. Героев твоей команды погибло: ${allies.size}.`;
      const moments = [{ t: fight.t1, text: 'Конец серии убийств' }];
      if (ourBoss) moments.push({ t: ourBoss[2], text: 'Команда убила Midboss' });
      rows.push({
        title: 'Когда проверить ранний Midboss',
        text,
        tip: ourBoss
          ? `На ${T(ourBoss[2])} твоя команда убила Midboss. Сравни позиции союзников в конце драки и в момент убийства босса.`
          : allies.size >= opponents.size
            ? 'У твоей команды тоже были потери. Проверь, кто из союзников оставался жив и мог подойти, прежде чем предлагать Midboss.'
            : 'Проверь доступность Midboss, позиции союзников и время до возрождения соперников. Если команда успевает собраться и удержать яму, предложи Midboss.',
        moments,
      });
    }
  }

  if (match.start_time >= RIFT_PATCH && match.duration_s >= 1080) {
    const nearbyFight = fights.find((fight) => fight.t0 >= 1080 && fight.t0 <= Math.min(1200, match.duration_s)
      && fight.deaths.length >= 3
      && fight.deaths.every((d) => Number.isFinite(d.x) && Number.isFinite(d.y))
      && fight.deaths.some((d) => d.team === 0) && fight.deaths.some((d) => d.team === 1));
    rows.push({
      title: 'Rift после 18:00',
      text: nearbyFight
        ? `На ${T(nearbyFight.t0)} началась серия смертей рядом друг с другом. Связь с Rift можно проверить в повторе.`
        : 'Совет для просмотра повтора. Время и место боя за Rift в сохранённых данных не подтверждены.',
      tip: 'Когда Rift появился, проверь, могла ли команда его оспорить, успевал ли ты подойти и что пришлось бы оставить на линии.',
      moments: nearbyFight ? [{ t: nearbyFight.t0, text: 'Первая смерть в серии' }] : [],
    });
  }
  if (match.duration_s >= 420) {
    const purchase = (player.items || []).filter(([, t]) => t >= 300 && t <= 420)
      .reduce((last, item) => !last || item[1] >= last[1] ? item : last, null);
    const itemName = purchase && nameOf(purchase[0]);
    const lane = earlyLaneEconomy(match, player);
    const context = lane
      ? `К ${T(lane.t)} у игроков твоей стартовой линии было в среднем ${N(lane.ours)} душ на героя, у соперников — ${N(lane.theirs)}.`
      : 'Проверь состояние волн между 5:00 и 7:00.';
    rows.push({
      title: 'Ротация после линии',
      text: context + (itemName
        ? ` На ${T(purchase[1])} ты купил «${itemName}». Посмотри, изменились ли после покупки твои возможности уйти с линии.`
        : ''),
      tip: 'Если свою линию уже выиграли или башню пока не продавить, проверь, можно ли было усилить линию, где союзники уже давили. Сравни это с пользой от следующей волны. Перед ротацией под урну сверяй её появление на карте.',
      moments: [{ t: lane?.t ?? 300, text: 'Проверить состояние волн' },
        itemName ? { t: purchase[1], text: 'Покупка предмета' } : { t: 420, text: 'Проверить покупки и способности' }],
    });
  }
  return rows;
}

function earlyLaneEconomy(match, player) {
  if (player.lane == null || (player.team !== 0 && player.team !== 1)) return null;
  const side = (team) => match.players.filter((p) => p.lane === player.lane && p.team === team);
  const ours = side(player.team);
  const theirs = side(1 - player.team);
  if (!ours.length || !theirs.length) return null;
  for (const { t } of (player.stats || []).slice().reverse()) {
    if (t < 300 || t > 420) continue;
    const average = (players) => {
      const values = players.map((p) => p.stats?.find((s) => s.t === t)?.nw);
      if (!values.every((v) => Number.isFinite(v) && v > 0)) return null;
      return values.reduce((total, value) => total + value, 0) / values.length;
    };
    const own = average(ours);
    const enemy = average(theirs);
    if (own !== null && enemy !== null) return { t, ours: own, theirs: enemy };
  }
  return null;
}

function teamLabel(team, ownTeam) {
  if (team !== 0 && team !== 1) return 'нет данных';
  return team === ownTeam ? 'твоя команда' : 'соперники';
}

module.exports = { macroReview };
