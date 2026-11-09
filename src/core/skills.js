'use strict';
// Скилл-билд: в каком порядке игрок открывал и качал способности.
// В данных матча каждое вложение очка в способность — отдельная запись в items
// с id этой способности (как покупка предмета). Первая запись — открытие,
// следующие — улучшения (у способности 3 улучшения, всего до 4 записей).

const MAX_LEVEL = 4; // открытие + 3 улучшения

// Четыре способности героя по порядку (1, 2, 3, ульта).
function heroAbilities(assets, heroId) {
  const h = assets && assets.heroes && assets.heroes[heroId];
  if (h && Array.isArray(h.abilities) && h.abilities.length) return h.abilities.slice(0, 4);
  return [];
}

function isAbility(assets, id) {
  const it = assets && assets.items && assets.items[id];
  return !!(it && it.type === 'ability');
}

// Порядок прокачки одного игрока.
// → { abilities: [id×4], steps: [{ id, t, level, n }], levels: { id: итоговый уровень } }
function skillOrder(player, assets) {
  const own = heroAbilities(assets, player.hero_id);
  const ownSet = new Set(own);
  const rows = (player.items || [])
    .filter(([id]) => (ownSet.size ? ownSet.has(id) : isAbility(assets, id)))
    .map(([id, t]) => ({ id, t }))
    .sort((a, b) => a.t - b.t);
  const levels = {};
  const steps = [];
  for (const r of rows) {
    levels[r.id] = (levels[r.id] || 0) + 1;
    if (levels[r.id] > MAX_LEVEL) {
      levels[r.id] = MAX_LEVEL;
      continue;
    }
    steps.push({ id: r.id, t: r.t, level: levels[r.id], n: steps.length + 1 });
  }
  let abilities = own.length ? own : [];
  if (!abilities.length) {
    for (const s of steps) if (!abilities.includes(s.id)) abilities.push(s.id);
  }
  abilities = abilities.slice(0, 4);
  return { abilities, steps, levels, complete: steps.length > abilities.length };
}

// Порядок, в котором способности доходили до максимума.
function maxOrder(order) {
  return order.steps.filter((s) => s.level === MAX_LEVEL).map((s) => s.id);
}

// Порядок открытия способностей.
function unlockOrder(order) {
  return order.steps.filter((s) => s.level === 1).map((s) => s.id);
}

function topShare(lists, key) {
  const counts = new Map();
  for (const l of lists) {
    const k = key(l);
    if (!k) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? { key: best[0], n: best[1], share: best[1] / lists.length } : null;
}

// Типичный путь прокачки по многим играм: на каждом шаге берём самую частую
// следующую способность среди игр, которые до этого шли тем же путём
// (как «дерево» прокачки). Если таких игр стало мало — берём самый частый
// вариант по всем играм на этом шаге.
function skillConsensus(orders, { minFollow = 3, maxSteps = 16 } = {}) {
  const usable = orders.filter((o) => o && o.steps.length >= 3);
  if (!usable.length) return null;
  const abilities = topShare(usable, (o) => o.abilities.join(','));
  const abil = abilities ? abilities.key.split(',').map(Number) : usable[0].abilities;
  const seqs = usable.map((o) => o.steps.map((s) => s.id));
  const path = [];
  let follow = seqs;
  const levels = {};
  for (let i = 0; i < maxSteps; i++) {
    let pool = follow.filter((s) => s.length > i);
    let fromAll = false;
    if (pool.length < minFollow) {
      pool = seqs.filter((s) => s.length > i);
      fromAll = true;
    }
    if (pool.length < Math.min(minFollow, usable.length)) break;
    const counts = new Map();
    for (const s of pool) {
      // не предлагаем шаг, который превысил бы максимальный уровень в нашем пути
      if ((levels[s[i]] || 0) >= MAX_LEVEL) continue;
      counts.set(s[i], (counts.get(s[i]) || 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best) break;
    const [id, n] = best;
    levels[id] = (levels[id] || 0) + 1;
    path.push({ id, level: levels[id], n: i + 1, share: n / pool.length, games: pool.length, loose: fromAll });
    follow = follow.filter((s) => s[i] === id);
  }
  const firstMax = topShare(usable.map(maxOrder).filter((l) => l.length), (l) => String(l[0]));
  const maxSeq = topShare(usable.map(maxOrder).filter((l) => l.length >= 2), (l) => l.slice(0, 2).join(','));
  const unlock = topShare(usable.map(unlockOrder).filter((l) => l.length >= 2), (l) => l.join(','));
  // средние минуты открытия/максимума каждой способности
  const timing = {};
  for (const id of abil) {
    const firstT = usable.map((o) => (o.steps.find((s) => s.id === id && s.level === 1) || {}).t).filter((t) => typeof t === 'number');
    const maxT = usable.map((o) => (o.steps.find((s) => s.id === id && s.level === MAX_LEVEL) || {}).t).filter((t) => typeof t === 'number');
    const med = (a) => {
      if (!a.length) return null;
      const s = a.slice().sort((x, y) => x - y);
      return s[Math.floor(s.length / 2)];
    };
    timing[id] = { unlock: med(firstT), max: med(maxT), maxShare: maxT.length / usable.length };
  }
  return {
    games: usable.length,
    abilities: abil,
    path,
    firstMax: firstMax ? { id: Number(firstMax.key), share: firstMax.share } : null,
    maxPair: maxSeq ? { ids: maxSeq.key.split(',').map(Number), share: maxSeq.share } : null,
    unlock: unlock ? { ids: unlock.key.split(',').map(Number), share: unlock.share } : null,
    timing,
  };
}

// Сравнение твоего пути с путём топов: главное отличие простыми словами.
function compareSkills(mine, top, abilityName = (id) => String(id)) {
  if (!mine || !top || !mine.firstMax || !top.firstMax) return null;
  if (mine.firstMax.id === top.firstMax.id) {
    return { same: true, text: `Ты, как и топы, первой максишь «${abilityName(top.firstMax.id)}».` };
  }
  return {
    same: false,
    text: `Ты чаще первой максишь «${abilityName(mine.firstMax.id)}», а топы — «${abilityName(top.firstMax.id)}» (${Math.round(top.firstMax.share * 100)}% их игр). Попробуй их порядок.`,
  };
}

module.exports = { MAX_LEVEL, heroAbilities, skillOrder, skillConsensus, compareSkills, maxOrder, unlockOrder };
