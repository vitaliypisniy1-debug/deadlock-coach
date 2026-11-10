'use strict';
// Превращает полный ответ /v1/matches/{id}/metadata в компактную запись.
// Полные метаданные весят сотни КБ; нам нужна только малая часть, поэтому
// храним выжимку (~10–20 КБ на матч) — так база на сотни матчей остаётся лёгкой.

// Версия выжимки: 2 — коробки, командный бонус, статуи, урон по врагам, режим боя в маршрутах.
const EXTRACT_V = 2;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// Короткие имена полей для снимков статистики (накопительные значения "на момент t").
function compactStat(s) {
  return {
    t: num(s.time_stamp_s),
    nw: num(s.net_worth),
    lvl: num(s.level),
    k: num(s.kills),
    d: num(s.deaths),
    a: num(s.assists),
    lh: num(s.creep_kills),
    nk: num(s.neutral_kills),
    dn: num(s.denies),
    pdmg: num(s.player_damage),
    pdmgT: num(s.player_damage_taken),
    bdmg: num(s.boss_damage),
    heal: num(s.player_healing),
    g_lane: num(s.gold_lane_creep) + num(s.gold_lane_creep_orbs),
    g_neutral: num(s.gold_neutral_creep) + num(s.gold_neutral_creep_orbs),
    g_player: num(s.gold_player) + num(s.gold_player_orbs),
    g_boss: num(s.gold_boss) + num(s.gold_boss_orb),
    g_treasure: num(s.gold_treasure),
    g_lost: num(s.gold_death_loss),
    // источники душ из списка gold_sources: 12 — коробки (ломаемые ящики), 8 — командный бонус
    g_brk: goldSource(s, 12),
    g_bonus: goldSource(s, 8),
    hit: num(s.shots_hit),
    miss: num(s.shots_missed),
    hhit: num(s.hero_bullets_hit),
    hcrit: num(s.hero_bullets_hit_crit),
  };
}

// Души из конкретного источника (EGoldSource): 1 герои, 2 крипы, 3 лес, 4 боссы,
// 5 сокровища, 6 помощь, 7 отбор, 8 командный бонус, 12 коробки.
function goldSource(s, id) {
  const list = Array.isArray(s.gold_sources) ? s.gold_sources : null;
  if (list) {
    const e = list.find((x) => x && x.source === id);
    return e ? num(e.gold) + num(e.gold_orbs) : 0;
  }
  // плоские поля (как в SQL-таблице deadlock-api); нет и их — данных нет (undefined, а не 0)
  if (id === 12 && typeof s.gold_source_breakable_gold === 'number') return s.gold_source_breakable_gold;
  if (id === 8 && typeof s.gold_source_team_bonus_gold === 'number') return s.gold_source_team_bonus_gold;
  return undefined;
}

// Постоянные бафы со статуй: [время, тип] по возрастанию времени.
function powerUps(p) {
  if (!Array.isArray(p.power_up_buffs)) return null; // нет данных — не «ноль статуй»
  const out = [];
  for (const b of p.power_up_buffs || []) {
    if (!b || !b.is_permanent) continue;
    const type = String(b.type || '').replace(/_permanent_pickup/, '').replace(/_pickup$/, '');
    for (const t of b.pickup_times_s || []) if (typeof t === 'number') out.push([t, type]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

// Урон между игроками по времени: { t: [секунды снимков], d: { "кто>кого": [накопленный урон] } }.
// В матрице каждый урон записан дважды: по конкретному оружию/способности и по общей
// категории (Bullet, Ability, Melee). Берём только stat_type 0 (урон) и общие категории —
// их сумма ровно совпадает с player_damage игрока (проверено на матче).
function extractDamage(mi) {
  const dm = mi.damage_matrix;
  if (!dm || !Array.isArray(dm.damage_dealers) || !Array.isArray(dm.sample_time_s)) return null;
  const sd = dm.source_details || {};
  const types = Array.isArray(sd.stat_type) ? sd.stat_type : null;
  const names = Array.isArray(sd.source_name) ? sd.source_name : null;
  const counts = (i) => {
    if (!types || !names) return true;
    return types[i] === 0 && /^[A-Z][A-Za-z]*$/.test(String(names[i] || ''));
  };
  const n = dm.sample_time_s.length;
  const teamOf = new Map((mi.players || []).map((p) => [p.player_slot, p.team]));
  const d = {};
  for (const dealer of dm.damage_dealers) {
    for (const src of dealer.damage_sources || []) {
      if (!counts(src.source_details_index)) continue;
      for (const tp of src.damage_to_players || []) {
        // только урон по врагам: так запись остаётся маленькой (~4 КБ на матч)
        const ta = teamOf.get(dealer.dealer_player_slot);
        const tb = teamOf.get(tp.target_player_slot);
        if (ta === undefined || tb === undefined || ta === tb) continue;
        const key = `${dealer.dealer_player_slot}>${tp.target_player_slot}`;
        const arr = d[key] || (d[key] = new Array(n).fill(0));
        const vals = tp.damage || [];
        // массив может быть короче: последние значения — без изменений
        for (let i = 0; i < n; i++) arr[i] += num(vals[Math.min(i, vals.length - 1)] ?? 0);
      }
    }
  }
  return { t: dm.sample_time_s.slice(), d };
}

// Позиция {x, y} из разных возможных форм ответа API.
function posOf(v) {
  if (!v || typeof v !== 'object') return null;
  const x = v.x ?? v[0];
  const y = v.y ?? v[1];
  return typeof x === 'number' && typeof y === 'number' ? [Math.round(x), Math.round(y)] : null;
}

// Смерти с координатами: [время, x, y, слот убийцы, x убийцы, y убийцы]
function deathRows(p) {
  return (p.death_details || [])
    .map((d) => {
      const t = deathTime(d);
      const pos = posOf(d.death_pos || d.position || d.pos);
      const kp = posOf(d.killer_pos);
      const killer = d.killer_player_slot ?? d.killer_slot ?? null;
      return t === null ? null : [t, pos ? pos[0] : null, pos ? pos[1] : null, typeof killer === 'number' ? killer : null, kp ? kp[0] : null, kp ? kp[1] : null];
    })
    .filter(Boolean);
}

// Маршруты героев (match_paths): позиции раз в step секунд в мировых координатах.
// Ответ API: { interval_s, x_resolution, y_resolution, paths: [{ player_slot, x_min, x_max, y_min, y_max, x_pos[], y_pos[], health[], combat_type[] }] }
// Точка: [x, y, жив, с кем бился за эти step секунд (биты: 1 герои, 2 крипы линии, 4 лес), здоровье %].
// combat_type в данных: 0 — нет боя, 1 — с героями, 2 — с крипами линии, 3 — с лесными крипами
// (проверено на матче: доля секунд «3» совпадает с убитыми лесными крипами, корреляция 0,9).
function extractPaths(mi, step = 5) {
  const mp = mi.match_paths || mi.paths;
  if (!mp || !Array.isArray(mp.paths) || !mp.paths.length) return null;
  const interval = mp.interval_s || mp.interval || 1;
  const xr = mp.x_resolution || null;
  const yr = mp.y_resolution || null;
  const every = Math.max(1, Math.round(step / interval));
  const out = {};
  for (const p of mp.paths) {
    const xs = p.x_pos || p.x || [];
    const ys = p.y_pos || p.y || [];
    if (!xs.length || xs.length !== ys.length) continue;
    const scaleX = xr && typeof p.x_min === 'number' && typeof p.x_max === 'number' ? (v) => p.x_min + (v / xr) * (p.x_max - p.x_min) : (v) => v;
    const scaleY = yr && typeof p.y_min === 'number' && typeof p.y_max === 'number' ? (v) => p.y_min + (v / yr) * (p.y_max - p.y_min) : (v) => v;
    const pts = [];
    const hp = Array.isArray(p.health) ? p.health : null;
    const ct = Array.isArray(p.combat_type) ? p.combat_type : null;
    for (let i = 0; i < xs.length; i += every) {
      let alive = Array.isArray(p.alive) ? (p.alive[i] ? 1 : 0) : 1;
      if (!Array.isArray(p.alive) && hp) alive = hp[i] > 0 ? 1 : 0;
      let mask = 0;
      if (ct) {
        for (let j = i; j < Math.min(i + every, ct.length); j++) {
          if (ct[j] === 1) mask |= 1;
          else if (ct[j] === 2) mask |= 2;
          else if (ct[j] === 3) mask |= 4;
        }
      }
      pts.push([Math.round(scaleX(xs[i])), Math.round(scaleY(ys[i])), alive, mask, hp ? Math.round(hp[i]) : null]);
    }
    out[p.player_slot] = pts;
  }
  return Object.keys(out).length ? { step: every * interval, players: out } : null;
}

function deathTime(d) {
  if (!d || typeof d !== 'object') return null;
  const t = d.game_time_s ?? d.time_s ?? d.death_time_s ?? d.game_time;
  return typeof t === 'number' ? t : null;
}

function extractMatch(raw, { paths = false } = {}) {
  const mi = (raw && raw.match_info) || raw;
  if (!mi || !Array.isArray(mi.players)) throw new Error('Неожиданный формат метаданных матча');
  const winning = typeof mi.winning_team === 'number' ? mi.winning_team : null;
  const players = mi.players.map((p) => {
    const stats = (p.stats || [])
      .map(compactStat)
      .filter((s) => s.t > 0)
      .sort((x, y) => x.t - y.t);
    const items = (p.items || [])
      .filter((i) => i && i.item_id)
      .map((i) => [Number(i.item_id), num(i.game_time_s), num(i.sold_time_s), num(i.upgrade_id)]);
    return {
      account_id: Number(p.account_id),
      hero_id: Number(p.hero_id),
      team: typeof p.team === 'number' ? p.team : null,
      slot: p.player_slot,
      lane: typeof p.assigned_lane === 'number' ? p.assigned_lane : null,
      won: winning !== null && p.team === winning,
      k: num(p.kills),
      d: num(p.deaths),
      a: num(p.assists),
      nw: num(p.net_worth),
      lh: num(p.last_hits),
      lvl: num(p.level),
      abandoned: num(p.abandon_match_time_s) > 0,
      items,
      deaths_t: (p.death_details || []).map(deathTime).filter((t) => t !== null),
      deaths: deathRows(p),
      pu: powerUps(p),
      stats,
    };
  });
  const objectives = (mi.objectives || [])
    .filter((o) => o && typeof o.destroyed_time_s === 'number' && o.destroyed_time_s > 0)
    .map((o) => [teamNum(o.team), o.team_objective_id ?? o.team_objective ?? null, o.destroyed_time_s]);
  const midBoss = (mi.mid_boss || [])
    .filter((b) => b && typeof b.destroyed_time_s === 'number')
    .map((b) => [teamNum(b.team_killed), teamNum(b.team_claimed), b.destroyed_time_s]);
  return {
    v: EXTRACT_V,
    match_id: Number(mi.match_id),
    start_time: num(mi.start_time),
    duration_s: num(mi.duration_s),
    winning_team: winning,
    game_mode: mi.game_mode ?? null,
    match_mode: mi.match_mode ?? null,
    badge: [mi.average_badge_team0 ?? null, mi.average_badge_team1 ?? null],
    players,
    paths: paths ? extractPaths(mi) : null,
    dmg: extractDamage(mi),
    objectives,
    midBoss,
  };
}

// Команда в ответе бывает числом (0/1) или строкой ("Team0"/"k_ECitadelLobbyTeam_Team1").
function teamNum(v) {
  if (typeof v === 'number') return v;
  const m = /([01])\s*$/.exec(String(v || ''));
  return m ? Number(m[1]) : null;
}

module.exports = { EXTRACT_V, extractMatch, compactStat, extractPaths, extractDamage, goldSource, powerUps };
