'use strict';

const { findFights, SOUL_LOSS_THRESHOLD } = require('./leaks');
const { isStandardMatch } = require('./meta');
const { N, T } = require('./tipkit');
// Первый полный UTC-день после каждого обновления. Игры в день релиза
// могут быть сыграны как до, так и после смены карты или правил.
const RIFT_PATCH = Date.UTC(2026, 6, 1) / 1000;
const CITY_PATCH = Date.UTC(2026, 8, 30) / 1000;

function macroReview(match, player) {
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
    rows.push({
      title: 'Крупная потеря душ',
      text: exact ? `На ${T(events[0])} при смерти потеряно ${N(loss)} душ.`
        : `Между ${T(prev.t)} и ${T(cur.t)} зарегистрировано смертей: ${count}. Суммарная потеря — ${N(loss)} душ.`,
      tip: 'Если в повторе видно, что ты давил Walker с крупным мешком, сравни пользу пуша с риском смерти. Проверь, можно ли было сохранить души или купить предмет до следующей попытки.',
      moments: [{ t: exact ? events[0] : prev.t, text: exact ? 'Смерть' : 'Начало интервала' }],
      evidence: exact ? { key: 'lost_souls', matchId: match.match_id, t: events[0] } : null,
    });
  }

  const early = samples.findLast((s) => s.t >= 300 && s.t <= 540 && Number.isFinite(s.g_brk));
  if (early) rows.push({
    title: 'Коробки и ранний доход',
    text: `К снимку на ${T(early.t)} с коробок собрано ${N(early.g_brk)} душ.`
      + (Number.isFinite(early.g_lane) ? ` С линии за тот же период — ${N(early.g_lane)}.` : ''),
    tip: 'Когда волна позволяет уйти, проверь в повторе, были ли доступны коробки у линии'
      + (match.start_time >= CITY_PATCH ? ' или в Plaza и Big Ben.' : '.')
      + ' Оцени, успевал ли ты вернуться к следующей волне.',
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
  const windows = findFights(match).filter((fight) => fight.t1 >= 600 && fight.t1 <= Math.min(1200, match.duration_s)
    && fight.deaths.every((d) => Number.isFinite(d.x) && Number.isFinite(d.y))
    && new Set(fight.deaths.filter((d) => d.team !== player.team && teamBySlot.get(d.killer) === player.team
      && Number.isFinite(d.x) && Number.isFinite(d.y)).map((d) => d.slot)).size >= 3);
  if (windows.length) rows.push({
    title: 'Когда проверить ранний Midboss',
    text: 'В отмеченных драках твоя команда убила как минимум троих разных соперников.',
    tip: 'Проверь в повторе доступность Midboss, позиции и здоровье союзников, а также время до возрождения врагов. Если команда успевает и может удержать яму, это повод предложить Midboss.',
    moments: windows.map((f) => ({ t: f.t1, text: 'Конец серии убийств' })),
  });

  if (match.start_time >= RIFT_PATCH && match.duration_s >= 1080) rows.push({
    title: 'Rift после 18:00',
    text: 'Совет для просмотра повтора. Время и место боя за Rift в сохранённых данных не подтверждены.',
    tip: 'Когда Rift появился, проверь, могла ли команда его оспорить, успевал ли ты подойти и что пришлось бы оставить на линии.',
    moments: [],
  });
  if (match.duration_s >= 420) rows.push({
    title: 'Ротация после линии',
    text: 'Два ориентира для просмотра решений на активном герое.',
    tip: 'Если свою линию уже выиграли или башню пока не продавить, сравни варианты: усилить соседнюю линию с преимуществом, остаться ради волны или заранее занять сторону следующей цели. На 7:00 проверь, была ли уже ключевая покупка или способность. Перед ротацией под урну сверяй её появление на карте.',
    moments: [{ t: 300, text: 'Проверить состояние волн' }, { t: 420, text: 'Проверить покупки и способности' }],
  });
  return rows;
}

function teamLabel(team, ownTeam) {
  if (team !== 0 && team !== 1) return 'нет данных';
  return team === ownTeam ? 'твоя команда' : 'соперники';
}

module.exports = { macroReview };
