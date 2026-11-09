'use strict';
// Генератор правдоподобных метаданных матча в формате /v1/matches/{id}/metadata
// для проверки логики без доступа к API.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const HEROES = [1, 2, 3, 4, 6, 7, 8, 10, 11, 12, 13, 14];
// Предметы: id → базовое время покупки (сек)
const ITEMS = { 101: 120, 102: 200, 103: 300, 104: 420, 201: 650, 202: 800, 203: 950, 301: 1300, 302: 1600 };
const SPIKE_ITEM = 201;

// Две сборки: 'w' (через оружие) и 's' (через спирит) — со своими предметами.
const STYLE_ITEMS = { w: { 401: 1000, 402: 1250, 403: 1500 }, s: { 501: 1000, 502: 1250, 503: 1500 } };

// Позиция героя: линия (3 штуки, по вертикали), команда 0 снизу, 1 сверху; после 10:00 — блуждание.
function posFor(i, t, r) {
  const lane = (i % 6) % 3;
  const team = i < 6 ? 0 : 1;
  const laneX = [-6500, 0, 6500][lane];
  const front = Math.sin(t / 90 + i) * 2500;
  let x = laneX + Math.sin(t / 37 + i * 2) * 600;
  let y = (team === 0 ? -1 : 1) * (1500 + Math.abs(front)) * (t < 600 ? 1 : 0.6);
  if (t > 600) {
    x += Math.sin(t / 140 + i) * 3500;
    y += Math.cos(t / 120 + i * 3) * 2500;
  }
  return [Math.max(-9500, Math.min(9500, Math.round(x))), Math.max(-9500, Math.min(9500, Math.round(y)))];
}

function fakeMatch({ id, seed, start, accounts, skill = [], heroes = HEROES, duration = 2100, styles = [] }) {
  const r = rng(seed);
  const winning = r() < 0.5 ? 0 : 1;
  const players = [];
  for (let i = 0; i < 12; i++) {
    const sk = skill[i] ?? 1;
    const team = i < 6 ? 0 : 1;
    const hero = heroes[i % heroes.length];
    const items = [];
    const bought = {};
    const style = styles[i] || (i % 2 === 0 ? 'w' : 's');
    for (const [itemId, base] of Object.entries({ ...ITEMS, ...STYLE_ITEMS[style] })) {
      if (r() < 0.85) {
        const t = Math.round(base / sk + (r() - 0.5) * 60);
        if (t < duration) {
          items.push({ item_id: Number(itemId), game_time_s: t, sold_time_s: 0, upgrade_id: 0 });
          bought[itemId] = t;
        }
      }
    }
    // абилки тоже попадают в items — их должен отфильтровать справочник
    items.push({ item_id: 9001, game_time_s: 60, sold_time_s: 0 });
    const stats = [];
    const deathDetails = [];
    let pdmg = 0;
    let k = 0;
    let d = 0;
    let a = 0;
    let src = { lane: 0, neutral: 0, player: 0, boss: 0, treasure: 0, lost: 0 };
    for (let t = 180; t <= duration; t += 180) {
      const spikeOn = bought[SPIKE_ITEM] !== undefined && t > bought[SPIKE_ITEM];
      const dmgRate = (300 + t / 3) * sk * (spikeOn ? 1.8 : 1);
      pdmg += (dmgRate * 180) / 60;
      src.lane += 380 * sk * (t < 1200 ? 1 : 0.6);
      src.neutral += 200 * sk * (t > 300 ? 1 : 0.2);
      src.player += (spikeOn ? 260 : 60) * sk;
      src.boss += t > 900 ? 120 : 0;
      src.treasure += 30;
      if (r() < 0.35 / sk) {
        d += 1;
        src.lost += 150;
        const dt = t - Math.round(r() * 170);
        const [dx, dy] = posFor(i, dt, r);
        deathDetails.push({ game_time_s: dt, death_pos: { x: dx, y: dy, z: 0 }, killer_player_slot: (team === 0 ? 7 : 1) + Math.floor(r() * 6), killer_pos: { x: dx + 300, y: dy - 200, z: 0 } });
      }
      if (r() < 0.4 * sk * (spikeOn ? 2 : 1)) k += 1;
      if (r() < 0.5 * sk * (spikeOn ? 2 : 1)) a += 1;
      const nw = src.lane + src.neutral + src.player + src.boss + src.treasure - src.lost;
      stats.push({
        time_stamp_s: t,
        net_worth: Math.round(nw),
        level: Math.min(35, Math.floor(t / 60)),
        kills: k,
        deaths: d,
        assists: a,
        creep_kills: Math.round((t / 60) * 6 * sk),
        neutral_kills: Math.round((t / 60) * 2 * sk),
        denies: 0,
        player_damage: Math.round(pdmg),
        player_damage_taken: Math.round(pdmg * 0.9),
        gold_lane_creep: Math.round(src.lane * 0.8),
        gold_lane_creep_orbs: Math.round(src.lane * 0.2),
        gold_neutral_creep: Math.round(src.neutral),
        gold_neutral_creep_orbs: 0,
        gold_player: Math.round(src.player),
        gold_player_orbs: 0,
        gold_boss: Math.round(src.boss),
        gold_boss_orb: 0,
        gold_treasure: Math.round(src.treasure),
        gold_death_loss: Math.round(src.lost),
      });
    }
    players.push({
      account_id: accounts[i],
      player_slot: i + 1,
      team,
      hero_id: hero,
      kills: k,
      deaths: d,
      assists: a,
      net_worth: stats[stats.length - 1].net_worth,
      last_hits: stats[stats.length - 1].creep_kills,
      level: 30,
      abandon_match_time_s: 0,
      items,
      stats,
      death_details: deathDetails,
      assigned_lane: (i % 6) % 3 + 1,
    });
  }
  // маршруты: каждый герой ходит по своей линии и иногда уходит в центр
  const RES = 16383;
  const XMIN = -10000;
  const XMAX = 10000;
  const paths = players.map((pl, i) => {
    const xs = [];
    const ys = [];
    const alive = [];
    for (let t = 0; t <= duration; t += 1) {
      const [x, y] = posFor(i, t, null);
      xs.push(Math.round(((x - XMIN) / (XMAX - XMIN)) * RES));
      ys.push(Math.round(((y - XMIN) / (XMAX - XMIN)) * RES));
      alive.push(pl.death_details.some((dd) => t >= dd.game_time_s && t < dd.game_time_s + 20) ? 0 : 1);
    }
    return { player_slot: i + 1, x_min: XMIN, x_max: XMAX, y_min: XMIN, y_max: XMAX, x_pos: xs, y_pos: ys, alive };
  });
  return {
    match_info: {
      match_paths: { interval_s: 1, x_resolution: RES, y_resolution: RES, paths },
      match_id: id,
      duration_s: duration,
      start_time: start,
      winning_team: winning,
      game_mode: 1,
      match_mode: 4,
      players,
    },
  };
}

module.exports = { fakeMatch, HEROES, ITEMS, SPIKE_ITEM, STYLE_ITEMS };
