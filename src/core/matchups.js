'use strict';
// Матчапы и контрпики.
// 1) Твои результаты против каждого героя (в команде соперника и на твоей линии).
// 2) Как топы на герое играют против каждого соперника: винрейт, души на линии,
//    и какие предметы они берут чаще именно против него (контр-предметы).
// 3) Подготовка к игре: твой герой + герои соперников → короткий план.

const { median, wilson } = require('./stats');
const { firstPurchases } = require('./meta');
const { valueAt } = require('./timeline');

const nw10 = (p) => valueAt(p.stats, 'nw', 600);

// --- 1. Мои матчапы ---
// games: [{ match, me }] — твои загруженные матчи.
function myMatchups(games, { minGames = 3 } = {}) {
  const vs = new Map();
  const lane = new Map();
  const bump = (map, hero, won, extra = null) => {
    if (!map.has(hero)) map.set(hero, { hero_id: hero, games: 0, wins: 0, laneDiff: [] });
    const r = map.get(hero);
    r.games += 1;
    if (won) r.wins += 1;
    if (extra !== null) r.laneDiff.push(extra);
  };
  for (const { match, me } of games) {
    if (!match || !me) continue;
    const enemies = match.players.filter((p) => p.team !== me.team);
    for (const e of enemies) bump(vs, e.hero_id, me.won);
    if (me.lane !== null && me.lane !== undefined) {
      const mine10 = nw10(me);
      for (const e of enemies.filter((x) => x.lane === me.lane)) {
        const theirs = nw10(e);
        bump(lane, e.hero_id, me.won, mine10 !== null && theirs !== null ? mine10 - theirs : null);
      }
    }
  }
  const fin = (r) => {
    const ci = wilson(r.wins, r.games);
    return { hero_id: r.hero_id, games: r.games, wins: r.wins, losses: r.games - r.wins, wr: r.games ? r.wins / r.games : null, ci_lo: ci.lo, ci_hi: ci.hi, laneDiff: r.laneDiff.length ? median(r.laneDiff) : null };
  };
  const all = [...vs.values()].map(fin).sort((a, b) => b.games - a.games);
  const lanes = [...lane.values()].map(fin).sort((a, b) => b.games - a.games);
  const enough = all.filter((x) => x.games >= minGames);
  return {
    games: games.length,
    minGames,
    all,
    lanes,
    worst: enough.slice().sort((a, b) => a.wr - b.wr || b.games - a.games).filter((x) => x.wr < 0.5).slice(0, 5),
    best: enough.slice().sort((a, b) => b.wr - a.wr || b.games - a.games).filter((x) => x.wr > 0.5).slice(0, 5),
  };
}

// --- 2. Топы на герое против соперников ---
// records: [{ match, player }] — игры топов на этом герое.
function heroVs(records, assets, { minGames = 3 } = {}) {
  const total = records.length;
  const baseItems = new Map();
  const per = new Map();
  for (const { match, player } of records) {
    const items = [...firstPurchases(player, assets).entries()].filter(([, t]) => t <= 1800).map(([id]) => id);
    for (const id of new Set(items)) baseItems.set(id, (baseItems.get(id) || 0) + 1);
    const enemies = match.players.filter((p) => p.team !== player.team);
    const laneFoes = player.lane !== null && player.lane !== undefined ? enemies.filter((e) => e.lane === player.lane).map((e) => e.hero_id) : [];
    const my10 = nw10(player);
    for (const e of enemies) {
      if (!per.has(e.hero_id)) per.set(e.hero_id, { hero_id: e.hero_id, games: 0, wins: 0, items: new Map(), laneGames: 0, laneDiff: [] });
      const r = per.get(e.hero_id);
      r.games += 1;
      if (player.won) r.wins += 1;
      for (const id of new Set(items)) r.items.set(id, (r.items.get(id) || 0) + 1);
      if (laneFoes.includes(e.hero_id)) {
        r.laneGames += 1;
        const their = nw10(e);
        if (my10 !== null && their !== null) r.laneDiff.push(my10 - their);
      }
    }
  }
  const rows = [...per.values()].filter((r) => r.games >= minGames).map((r) => {
    const ci = wilson(r.wins, r.games);
    // контр-предметы: берут против него заметно чаще, чем обычно
    const counters = [...r.items.entries()]
      .map(([id, n]) => ({ id, pick: n / r.games, base: (baseItems.get(id) || 0) / Math.max(1, total) }))
      .map((x) => ({ ...x, lift: x.pick - x.base }))
      .filter((x) => r.games >= 5 && x.pick >= 0.3 && x.lift >= 0.12)
      .sort((a, b) => b.lift - a.lift)
      .slice(0, 3);
    return {
      hero_id: r.hero_id,
      games: r.games,
      wins: r.wins,
      wr: r.wins / r.games,
      ci_lo: ci.lo,
      ci_hi: ci.hi,
      laneGames: r.laneGames,
      laneSamples: r.laneDiff.length,
      laneDiff: r.laneDiff.length >= 2 ? median(r.laneDiff) : null,
      counters,
    };
  });
  return {
    total,
    rows: rows.sort((a, b) => b.games - a.games),
    hard: rows.filter((r) => r.games >= 4 && r.wr < 0.5).sort((a, b) => a.wr - b.wr).slice(0, 5),
    easy: rows.filter((r) => r.games >= 4 && r.wr > 0.5).sort((a, b) => b.wr - a.wr).slice(0, 5),
  };
}

// --- 3. Подготовка к игре ---
// myHero, enemies[], lanes: id героя на твоей линии (или null)
function prepare({ myHero, enemies, laneFoe = null, topVs, mine, heroName, itemName, global = null }) {
  const rows = enemies.map((e) => {
    const t = topVs.rows.find((r) => r.hero_id === e) || null;
    const m = mine.all.find((r) => r.hero_id === e) || null;
    const g = global ? global.find((r) => r.enemy === e) || null : null;
    return { hero_id: e, top: t, mine: m, global: g, isLane: laneFoe === e };
  });
  const tips = [];
  const lane = rows.find((r) => r.isLane);
  if (lane) {
    if (lane.top && lane.top.laneDiff !== null) {
      tips.push({
        kind: 'info',
        title: `Линия против ${heroName(lane.hero_id)}`,
        text: `К 10:00 типичная разница у топов на ${heroName(myHero)} — ${lane.top.laneDiff > 0 ? '+' : ''}${Math.round(lane.top.laneDiff)} душ. Сравнение по ${lane.top.laneSamples} матчам с данными по линии.`,
      });
    }
    if (lane.mine && lane.mine.games >= 2) {
      tips.push({ kind: lane.mine.wr >= 0.5 ? 'good' : 'warn', title: `Твой опыт против ${heroName(lane.hero_id)}`, text: `${lane.mine.wins}–${lane.mine.losses} в играх, где он был у тебя в соперниках.` });
    }
  }
  const counterIds = new Map();
  for (const r of rows) for (const c of (r.top && r.top.counters) || []) {
    if (!counterIds.has(c.id) || counterIds.get(c.id).lift < c.lift) counterIds.set(c.id, { ...c, vs: r.hero_id });
  }
  const counters = [...counterIds.values()].sort((a, b) => b.lift - a.lift).slice(0, 4);
  if (counters.length) {
    tips.push({ kind: 'info', title: 'Что топы докупают против этого состава', text: counters.map((c) => `«${itemName(c.id)}» против ${heroName(c.vs)} (${Math.round(c.pick * 100)}% игр, обычно ${Math.round(c.base * 100)}%)`).join('; ') + '.' });
  }
  const hard = rows.filter((r) => r.top && r.top.games >= 4 && r.top.wr < 0.45);
  const observed = (entries) => entries.map((r) => `${heroName(r.hero_id)} (${r.top.wins} побед из ${r.top.games})`).join(', ');
  if (hard.length) tips.push({ kind: 'warn', title: 'Меньше побед в сохранённых матчах', text: `На ${heroName(myHero)} топы выиграли менее 45% матчей с этими героями в составе соперника: ${observed(hard)}.` });
  const easy = rows.filter((r) => r.top && r.top.games >= 4 && r.top.wr > 0.58);
  if (easy.length) tips.push({ kind: 'good', title: 'Больше побед в сохранённых матчах', text: `На ${heroName(myHero)} топы выиграли более 58% матчей с этими героями в составе соперника: ${observed(easy)}.` });
  return { rows, tips, counters };
}


// --- 4. Прогноз для героя: удобные и неудобные соперники, лучшие напарники по линии ---
// pro: [{ match, player, w }] — игры топового уровня на этом герое (w — вес записи),
// mine: [{ match, player }] — твои игры на нём. Твои игры весят больше (weightMine),
// маленькие выборки «стягиваются» к нулю (prior), чтобы 1–0 не выглядело как 100%.
function tallyHero(records) {
  const vs = new Map();
  const mates = new Map();
  const allies = new Map();
  let w = 0;
  let g = 0;
  const get = (map, id) => {
    if (!map.has(id)) map.set(id, { g: 0, w: 0, n: 0, wins: 0, lane: [] });
    return map.get(id);
  };
  for (const { match, player, w: wt = 1 } of records) {
    if (!match || !player) continue;
    g += wt;
    if (player.won) w += wt;
    const enemies = match.players.filter((p) => p.team !== player.team);
    const lane = player.lane === null || player.lane === undefined ? null : player.lane;
    const laneEnemies = lane === null ? [] : enemies.filter((e) => e.lane === lane);
    const my10 = nw10(player);
    for (const e of enemies) {
      const r = get(vs, e.hero_id);
      r.g += wt;
      r.n += 1;
      if (player.won) { r.w += wt; r.wins += 1; }
      if (laneEnemies.includes(e)) {
        const t = nw10(e);
        if (my10 !== null && t !== null) r.lane.push(my10 - t);
      }
    }
    // все союзники (не только по линии) — для связок в совете по пику
    for (const a of match.players) {
      if (a.team !== player.team || a === player) continue;
      const r = get(allies, a.hero_id);
      r.g += wt;
      r.n += 1;
      if (player.won) { r.w += wt; r.wins += 1; }
    }
    if (lane === null) continue;
    const enemy10 = laneEnemies.map(nw10).filter((x) => x !== null);
    const enemyAvg = enemy10.length ? enemy10.reduce((a, b) => a + b, 0) / enemy10.length : null;
    for (const a of match.players.filter((p) => p.team === player.team && p !== player && p.lane === lane)) {
      const r = get(mates, a.hero_id);
      r.g += wt;
      r.n += 1;
      if (player.won) { r.w += wt; r.wins += 1; }
      const a10 = nw10(a);
      if (my10 !== null && a10 !== null && enemyAvg !== null) r.lane.push(my10 + a10 - 2 * enemyAvg);
    }
  }
  return { g, w, base: g ? w / g : 0.5, vs, mates, allies };
}

function heroOutlook({ pro, mine, weightMine = 2, prior = 5, minEvidence = 3, take = 5, counters = null }) {
  const P = tallyHero(pro);
  const M = tallyHero(mine.map((x) => ({ ...x, w: 1 })));
  const combine = (mapP, mapM) => {
    const ids = new Set([...mapP.keys(), ...mapM.keys()]);
    const rows = [];
    for (const id of ids) {
      const p = mapP.get(id);
      const m = mapM.get(id);
      const gP = p ? p.g : 0;
      const gM = m ? m.g : 0;
      const dP = gP ? p.w / gP - P.base : 0;
      const dM = gM ? m.w / gM - M.base : 0;
      const wP = gP;
      const wM = weightMine * gM;
      const evidence = (p ? p.n : 0) + (m ? m.n : 0);
      if (evidence < minEvidence) continue;
      const lane = [...(p ? p.lane : []), ...(m ? m.lane : [])];
      rows.push({
        hero_id: id,
        delta: (wP * dP + wM * dM) / (wP + wM + prior),
        // по отдельности (стянуто к нулю при малой выборке) — для совета по пику 80/20
        dPro: gP ? (gP * dP) / (gP + prior) : null,
        dMine: gM ? (gM * dM) / (gM + prior) : null,
        evidence,
        pro: p && p.n ? { games: p.n, wins: p.wins, losses: p.n - p.wins, wr: p.w / p.g } : null,
        mine: m && m.n ? { games: m.n, wins: m.wins, losses: m.n - m.wins, wr: m.w / m.g } : null,
        laneDiff: lane.length >= 2 ? median(lane) : null,
        laneGames: lane.length,
      });
    }
    return rows;
  };
  const vsRows = combine(P.vs, M.vs).map((r) => ({ ...r, counters: counters && counters.get(r.hero_id) ? counters.get(r.hero_id) : [] }));
  const mateRows = combine(P.mates, M.mates);
  return {
    // все соперники кратко — для совета по пику
    vs: Object.fromEntries(vsRows.map((r) => [r.hero_id, {
      delta: Math.round(r.delta * 1000) / 1000,
      evidence: r.evidence,
      pro: r.dPro === null ? null : Math.round(r.dPro * 1000) / 1000,
      mine: r.dMine === null ? null : Math.round(r.dMine * 1000) / 1000,
    }])),
    // все союзники кратко — связки для совета по пику
    with: Object.fromEntries(combine(P.allies, M.allies).map((r) => [r.hero_id, {
      delta: Math.round(r.delta * 1000) / 1000,
      evidence: r.evidence,
      pro: r.dPro === null ? null : Math.round(r.dPro * 1000) / 1000,
      mine: r.dMine === null ? null : Math.round(r.dMine * 1000) / 1000,
    }])),
    proGames: pro.length,
    myGames: mine.length,
    proBase: P.base,
    myBase: mine.length ? M.base : null,
    good: vsRows.filter((r) => r.delta > 0.01).sort((a, b) => b.delta - a.delta).slice(0, take),
    bad: vsRows.filter((r) => r.delta < -0.01).sort((a, b) => a.delta - b.delta).slice(0, take),
    mates: mateRows.filter((r) => r.delta > -0.01).sort((a, b) => b.delta - a.delta || (b.laneDiff || 0) - (a.laneDiff || 0)).slice(0, take),
    matesBad: mateRows.filter((r) => r.delta < -0.03).sort((a, b) => a.delta - b.delta).slice(0, 3),
  };
}

module.exports = { myMatchups, heroVs, prepare, heroOutlook, tallyHero };
