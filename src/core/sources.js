'use strict';
// Источники душ по фазам игры: сколько ты набрал с линии, убийств, леса, ящиков,
// стражей — и сколько потерял при смертях — на каждом этапе, против эталона.

const { valueAt } = require('./timeline');
const { median, mean } = require('./stats');

const SOURCES = [
  { field: 'g_lane', name: 'Линия: крипы и сферы', short: 'Крипы на линии' },
  { field: 'g_player', name: 'Убийства и помощь', short: 'Убийства' },
  { field: 'g_neutral', name: 'Лесные крипы', short: 'Лесные крипы' },
  { field: 'g_treasure', name: 'Ящики и находки', short: 'Ящики' },
  { field: 'g_boss', name: 'Стражи и боссы', short: 'Стражи и боссы' },
  { field: 'g_lost', name: 'Потеряно при смертях', short: 'Потери (смерти)', invert: true },
];

const PHASES = [
  { key: 'lane', name: 'Линия', from: 0, to: 10 },
  { key: 'mid', name: 'Середина игры', from: 10, to: 20 },
  { key: 'late', name: 'Поздняя игра', from: 20, to: 60 },
];

// Советы: что делать, если недобираешь с этого источника именно в этой фазе.
const TIPS = {
  lane: {
    g_lane: 'Добивай каждого крипа и сразу стреляй по выпавшей сфере души — на линии это главный доход. Отбирай (денай) сферы врага.',
    g_player: 'На линии ищи размен, когда у врага мало здоровья или он без способности: одно убийство = несколько волн крипов.',
    g_neutral: 'Когда волна запушена, забирай ближайший лагерь малых крипов и возвращайся к следующей волне.',
    g_treasure: 'По пути на линию и обратно разбивай ящики и вазы — они почти бесплатные.',
    g_boss: 'Если враг ушёл с линии — бей стража, он даёт много душ всей линии.',
    g_lost: 'Ты часто умираешь на линии и теряешь души. Играй от своей башни, пока нет преимущества, и следи за миникартой.',
  },
  mid: {
    g_lane: 'Не бросай линии: между драками подходи и забирай волны на боковых линиях, особенно на пустых.',
    g_player: 'В середине игры держись рядом с командой и приходи на драки — ты пропускаешь убийства и помощь.',
    g_neutral: 'Фарми лес между волнами: средние и большие лагеря дают больше всего душ в эту фазу.',
    g_treasure: 'Забирай ящики и находки по дороге между линиями — топы делают это попутно.',
    g_boss: 'После выигранной драки сразу бери стража или ходока — это души для всей команды.',
    g_lost: 'Ты много теряешь душ при смертях. Не ходи в одиночку вглубь карты и не дерись без команды.',
  },
  late: {
    g_lane: 'Даже в поздней игре волны крипов — стабильный доход. Чисти линии, которые подходят к вашей базе.',
    g_player: 'В поздней игре держись с командой: драки у объектов решают игру и дают больше всего душ.',
    g_neutral: 'Пока команда ждёт драку, забирай лагеря рядом — не стой без дела.',
    g_treasure: 'Мелочь, но копится: ящики по пути — бесплатные души.',
    g_boss: 'Забирай боссов и ходоков после выигранных драк — топы чаще конвертируют победу в объект.',
    g_lost: 'Смерть в поздней игре стоит очень дорого: долгое возрождение и потеря душ. Не лезь первым без команды.',
  },
};

function phaseDelta(stats, field, fromS, toS) {
  const a = valueAt(stats, field, fromS);
  const b = valueAt(stats, field, toS);
  if (a === null || b === null) return null;
  return b - a;
}

// Сколько с каждого источника за фазу набрал ты и эталон (медиана списка).
// meStats — снимки игрока, refList — массив снимков эталонных игроков.
// perTen — пересчитать «на 10 минут», чтобы фазы разной длины были сравнимы.
function phaseSources(meStats, refList, fromMin, toMin, { perTen = false, agg = median } = {}) {
  const fromS = fromMin * 60;
  const toS = toMin * 60;
  const k = perTen ? 10 / Math.max(1, toMin - fromMin) : 1;
  const rows = SOURCES.map((s) => {
    const me = phaseDelta(meStats, s.field, fromS, toS);
    const vals = refList.map((st) => phaseDelta(st, s.field, fromS, toS)).filter((v) => v !== null);
    const ref = vals.length ? agg(vals) : null;
    const meK = me === null ? null : me * k;
    const refK = ref === null ? null : ref * k;
    return { field: s.field, name: s.name, short: s.short, invert: !!s.invert, me: meK, ref: refK, diff: meK !== null && refK !== null ? meK - refK : null, n: vals.length };
  });
  return rows;
}

// Итог фазы: сумма доходов (без потерь) и главный недобор.
function summarizePhase(rows, phaseKey) {
  const income = rows.filter((r) => !r.invert);
  const sum = (who) => (income.every((r) => r[who] === null) ? null : income.reduce((s, r) => s + (r[who] || 0), 0));
  const total = { me: sum('me'), ref: sum('ref') };
  total.diff = total.me !== null && total.ref !== null ? total.me - total.ref : null;
  // «Потеря» для доходного источника — отрицательная разница, для потерь при смертях — положительная.
  const loss = (r) => (r.diff === null ? 0 : r.invert ? r.diff : -r.diff);
  const threshold = (r) => Math.max(120, (r.ref || 0) * 0.12);
  const gaps = rows.filter((r) => loss(r) > threshold(r)).sort((a, b) => loss(b) - loss(a));
  const worst = gaps[0] || null;
  const level = total.ref ? (total.me / total.ref >= 0.93 ? 'good' : total.me / total.ref >= 0.8 ? 'warn' : 'bad') : 'none';
  return {
    total,
    ratio: total.ref ? total.me / total.ref : null,
    level: gaps.length && level === 'good' ? 'warn' : level,
    gaps: gaps.map((r) => ({ field: r.field, name: r.name, loss: loss(r), tip: (TIPS[phaseKey] || {})[r.field] || null })),
    worst: worst ? { field: worst.field, name: worst.name, loss: loss(worst), tip: (TIPS[phaseKey] || {})[worst.field] || null } : null,
  };
}

// Сводка нескольких игр: средние по фазам за все игры.
function averageRows(list) {
  if (!list.length) return null;
  return SOURCES.map((s, i) => {
    const me = mean(list.map((rows) => rows[i].me));
    const ref = mean(list.map((rows) => rows[i].ref));
    return { field: s.field, name: s.name, short: s.short, invert: !!s.invert, me, ref, diff: me !== null && ref !== null ? me - ref : null, n: list.length };
  });
}

module.exports = { SOURCES, PHASES, TIPS, phaseDelta, phaseSources, summarizePhase, averageRows };
