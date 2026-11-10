'use strict';
// Признаки игрока в матче: всё, по чему библиотека советов понимает ситуацию.
// Считается одинаково для тебя, для топов и для игроков лобби — чтобы сравнивать честно.

const { valueAt } = require('./timeline');
const { median, quantile } = require('./stats');
const { isUpgrade, itemFates } = require('./meta');

const at = (stats, field, min) => valueAt(stats, field, min * 60);
const lastOf = (stats) => (stats && stats.length ? stats[stats.length - 1] : null);
const safeDiv = (a, b) => (a === null || b === null || !b ? null : a / b);
const sub = (a, b) => (a === null || b === null ? null : a - b);
const rnd = (v) => (v === null || v === undefined ? null : Math.round(v));

// Сумма поля по команде в момент времени (для разницы душ между командами).
function teamSumAt(match, team, field, min) {
  let s = 0;
  for (const p of match.players) {
    if (p.team !== team) continue;
    const v = at(p.stats, field, min);
    if (v === null) return null;
    s += v;
  }
  return s;
}

// Время смертей: из списка смертей, а если его нет — по снимкам (с точностью до снимка).
function deathTimes(p) {
  if (p.deaths_t && p.deaths_t.length) return p.deaths_t.slice().sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const s of p.stats || []) {
    for (let i = prev; i < s.d; i++) out.push(s.t);
    prev = s.d;
  }
  return out;
}

function playerFeatures(p, match, assets = null) {
  const st = p.stats || [];
  const last = lastOf(st);
  const dur = Math.max(1, (match.duration_s || (last ? last.t : 60)) / 60);
  const endMin = last ? last.t / 60 : dur;
  const team = match.players.filter((x) => x.team === p.team);
  const enemies = match.players.filter((x) => x.team !== p.team);
  const teamK = team.reduce((s, x) => s + (x.k || 0), 0);
  const teamDmg = team.reduce((s, x) => s + (lastOf(x.stats) ? lastOf(x.stats).pdmg : 0), 0);
  const teamNw = team.reduce((s, x) => s + (x.nw || 0), 0);
  const nwRank = team.slice().sort((a, b) => b.nw - a.nw).findIndex((x) => x === p) + 1;
  const dts = deathTimes(p);

  // Предметы: стоимость, слот, продажи, «непотраченные» души (оценка снизу).
  const items = (p.items || []).filter(([id]) => isUpgrade(assets, id));
  const cost = (id) => (assets && assets.items && assets.items[id] && assets.items[id].cost) || null;
  const slot = (id) => (assets && assets.items && assets.items[id] && assets.items[id].slot) || null;
  const bought = items.slice().sort((a, b) => a[1] - b[1]);
  const big = bought.find(([id]) => (cost(id) || 0) >= 3000);
  const huge = bought.find(([id]) => (cost(id) || 0) >= 6000);
  const slotsBy = (min) => {
    const c = { weapon: 0, vitality: 0, spirit: 0 };
    for (const [id, t] of bought) if (t <= min * 60 && c[slot(id)] !== undefined) c[slot(id)] += 1;
    return c;
  };
  let unspentPeak = null;
  let unspentPeakT = null;
  if (assets && assets.items && Object.keys(assets.items).length && bought.every(([id]) => cost(id) !== null)) {
    for (const s of st) {
      if (s.t < 300) continue;
      const spent = bought.filter(([, t]) => t <= s.t).reduce((sum, [id]) => sum + cost(id), 0);
      const free = s.nw - spent;
      if (unspentPeak === null || free > unspentPeak) {
        unspentPeak = free;
        unspentPeakT = s.t;
      }
    }
  }

  // Паверспайки: после покупки большого предмета (3000+) — была ли драка за 3 минуты
  // (выросли убийства + помощи) и насколько вырос урон по героям.
  const endS = match.duration_s || endMin * 60;
  const spikeBuys = bought.filter(([id, t]) => (cost(id) || 0) >= 3000 && t + 180 <= endS);
  let spikeN = 0;
  let spikeFought = 0;
  for (const [, t] of spikeBuys) {
    const k0 = valueAt(st, 'ka', t);
    const k1 = valueAt(st, 'ka', t + 180);
    if (k0 === null || k1 === null) continue;
    spikeN += 1;
    if (k1 > k0) spikeFought += 1;
  }
  let spikeDmg = null; // урон по героям в минуту за 3 минуты после первого большого предмета
  if (big && big[1] + 180 <= endS) {
    const d0 = valueAt(st, 'pdmg', big[1]);
    const d1 = valueAt(st, 'pdmg', big[1] + 180);
    if (d0 !== null && d1 !== null) spikeDmg = (d1 - d0) / 3;
  }

  // Тайминги карты (только в матчах, скачанных с версии 0.11: в старых этих полей нет)
  const has = (f) => st.length > 0 && st[0][f] !== undefined;
  const atS = (f, t) => (has(f) && t <= endS + 5 ? valueAt(st, f, t) : null);
  const pu = Array.isArray(p.pu) ? p.pu : null;
  const puBy = (t) => (pu && endS >= t ? pu.filter(([pt]) => pt <= t).length : null);

  // Противники по линии (если API отдал назначенную линию)
  const laneFoes = p.lane !== null && p.lane !== undefined ? enemies.filter((x) => x.lane === p.lane) : [];
  const laneFoeNw10 = laneFoes.length ? median(laneFoes.map((x) => at(x.stats, 'nw', 10)).filter((v) => v !== null)) : null;

  const nw10 = at(st, 'nw', 10);
  const nw20 = at(st, 'nw', 20);
  const lh10 = at(st, 'lh', 10);
  const lane10 = at(st, 'g_lane', 10);
  const myT = p.team;
  const otherT = myT === 0 ? 1 : 0;
  const tdiff = (min) => sub(teamSumAt(match, myT, 'nw', min), teamSumAt(match, otherT, 'nw', min));
  const rate = (field, a, b) => {
    const x = at(st, field, a);
    const y = at(st, field, Math.min(b, endMin));
    if (x === null || y === null || Math.min(b, endMin) - a < 2) return null;
    return (y - x) / (Math.min(b, endMin) - a);
  };
  const shots = last ? last.hit + last.miss : 0;

  return {
    hero: p.hero_id,
    account: p.account_id,
    team: p.team,
    won: p.won,
    dur,
    endMin,
    k: p.k,
    d: p.d,
    a: p.a,
    nw: p.nw,
    soulsMin: p.nw / dur,
    nw10,
    nw20,
    lh10: rnd(lh10),
    nk10: rnd(at(st, 'nk', 10)),
    dn10: rnd(at(st, 'dn', 10)),
    lane10,
    neu10: at(st, 'g_neutral', 10),
    neu20: at(st, 'g_neutral', 20),
    boss10: at(st, 'g_boss', 10),
    bossEnd: last ? last.g_boss : null,
    treasureEnd: last ? last.g_treasure : null,
    lostEnd: last ? last.g_lost : null,
    soulsPerCreep10: lh10 && lh10 >= 10 ? lane10 / lh10 : null,
    pdmg10: at(st, 'pdmg', 10),
    pdmgT10: at(st, 'pdmgT', 10),
    dmgMin: last ? last.pdmg / dur : null,
    dmgTMin: last ? last.pdmgT / dur : null,
    healMin: last ? last.heal / dur : null,
    bdmgMin: last ? last.bdmg / dur : null,
    bdmg1020: rate('bdmg', 10, 20),
    dmgLane: rate('pdmg', 0, 10),
    dmgMid: rate('pdmg', 10, 20),
    dmgLate: rate('pdmg', 20, 60),
    soulsLane: rate('nw', 0, 10),
    soulsMid: rate('nw', 10, 20),
    soulsLate: rate('nw', 20, 60),
    ka10: rnd(at(st, 'ka', 10)),
    kaMid: rnd(sub(at(st, 'ka', 20), at(st, 'ka', 10))),
    d10: rnd(at(st, 'd', 10)),
    dMid: rnd(sub(at(st, 'd', 20), at(st, 'd', 10))),
    dLate: endMin > 22 ? rnd(sub(p.d, at(st, 'd', 20))) : null,
    deathTimes: dts,
    firstDeath: dts.length ? dts[0] : null,
    deathBurst: maxInWindow(dts, 300),
    lastMinutesDeaths: dts.filter((t) => t >= (match.duration_s || 0) - 180).length,
    acc: shots >= 80 ? last.hit / shots : null,
    hsRate: last && last.hhit >= 40 ? last.hcrit / last.hhit : null,
    heroShotShare: last && last.hit >= 80 ? last.hhit / last.hit : null,
    kp: teamK > 0 ? Math.min(1, (p.k + p.a) / teamK) : null,
    dmgShare: teamDmg > 0 && last ? last.pdmg / teamDmg : null,
    nwShare: teamNw > 0 ? p.nw / teamNw : null,
    nwRank,
    teamDiff10: tdiff(10),
    teamDiff20: tdiff(20),
    teamDiff25: tdiff(25),
    firstBigT: big ? big[1] : null,
    firstBigId: big ? big[0] : null,
    firstHugeT: huge ? huge[1] : null,
    brk9: atS('g_brk', 540),
    brk20: atS('g_brk', 1200),
    neu9: atS('g_neutral', 540),
    pu10: puBy(600),
    pu20: puBy(1200),
    tre20: atS('g_treasure', 1200),
    lost20: atS('g_lost', 1200),
    lostPerDeath: p.d >= 2 && last && has('g_lost') ? last.g_lost / p.d : null,
    spikeFights: spikeN ? spikeFought / spikeN : null,
    spikeDmg,
    itemsSold: itemFates(p.items, assets).filter((f) => f.fate === 'sold').length,
    cheapLate: bought.filter(([id, t]) => t >= 1200 && (cost(id) || 9999) <= 800).length,
    slots20: slotsBy(20),
    unspentPeak,
    unspentPeakT,
    lane: p.lane ?? null,
    laneFoes: laneFoes.map((x) => x.hero_id),
    laneFoeNw10,
    abandoned: !!p.abandoned,
  };
}

function maxInWindow(times, win) {
  let best = 0;
  for (let i = 0; i < times.length; i++) {
    let j = i;
    while (j < times.length && times[j] - times[i] <= win) j++;
    best = Math.max(best, j - i);
  }
  return best;
}

// Медиана и квартили признака по списку признаков.
function refOf(list, key) {
  const vals = list.map((f) => f[key]).filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  if (!vals.length) return { med: null, p25: null, p75: null, n: 0 };
  return { med: median(vals), p25: quantile(vals, 0.25), p75: quantile(vals, 0.75), n: vals.length };
}

function refAll(list) {
  const keys = list.length ? Object.keys(list[0]).filter((k) => typeof list[0][k] === 'number' || list[0][k] === null) : [];
  const out = {};
  for (const k of keys) out[k] = refOf(list, k);
  return out;
}

module.exports = { playerFeatures, refOf, refAll, deathTimes, teamSumAt };
