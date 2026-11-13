'use strict';
// Рабочая роль игрока в матче — определяется автоматически по данным матча, без ввода от пользователя.
// Признаки (все считаются из сохранённого матча): доля урона команды, доля полученного урона, доля лечения,
// доля душ команды, участие в убийствах, доля душ от добивания/леса/героев/боссов, сборка (оружие/дух/живучесть),
// кто чаще первым вступает в бой в драках (по маршрутам). Границы «много/мало» — перцентили 120 тысяч игроков
// рейтинга (tools/errors-pilot/norms.js → errorNorms.json, roleCuts).
//
// Роли: «инициатор» (передовая), «керри» (урон), «поддержка», «универсал». Это стиль игры в конкретном матче,
// а не класс героя: Lash или Paradox могут играть по-разному. Доверие к роли считается по числу игр и их согласованности.

const FIGHT_MIN_DEATHS = 3;
const FIGHT_FROM = 600;

const ROLE_LABELS = { initiator: 'инициатор (передовая)', carry: 'керри (урон)', support: 'поддержка', flex: 'универсал' };

const lastOf = (p) => (p.stats && p.stats.length ? p.stats[p.stats.length - 1] : null);
const share = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null);

// Кто первым вступает в бой: по дракам (≥3 смертей после 10:00) — доля драк, где у игрока контакт с героями
// не позже всех живых участников его команды. Нужны маршруты. { fights, firsts, rate } или null.
function engageStats(m, findFights) {
  if (!m.paths || !m.paths.players) return null;
  const step = m.paths.step || 5;
  const out = new Map();
  for (const fight of findFights(m)) {
    if (fight.t0 < FIGHT_FROM || fight.deaths.length < FIGHT_MIN_DEATHS) continue;
    const i0 = Math.max(0, Math.floor((fight.t0 - 20) / step));
    const i1 = Math.ceil((fight.t1 + step) / step);
    const contact = new Map(); // slot -> первое время контакта
    for (const p of m.players) {
      const pp = m.paths.players[p.slot];
      if (!pp) continue;
      for (let i = i0; i <= Math.min(i1, pp.length - 1); i++) {
        const pt = pp[i];
        if (pt && pt[2] && (pt[3] & 1)) { contact.set(p.slot, i * step); break; }
      }
    }
    for (const team of [0, 1]) {
      const mem = m.players.filter((p) => p.team === team && contact.has(p.slot));
      if (mem.length < 2) continue; // в драке «первым» можно быть, только если рядом есть хотя бы ещё один участник
      const first = Math.min(...mem.map((p) => contact.get(p.slot)));
      for (const p of mem) {
        const o = out.get(p.slot) || { fights: 0, firsts: 0 };
        o.fights += 1;
        if (contact.get(p.slot) <= first) o.firsts += 1;
        out.set(p.slot, o);
      }
    }
  }
  return out;
}

// Признаки роли для всех игроков матча. f — признаки игрока (features.playerFeatures), если есть (сборка).
function roleFeatures(m, me, f = null, findFights = null) {
  const last = lastOf(me);
  if (!last) return null;
  const team = m.players.filter((p) => p.team === me.team && lastOf(p));
  const sum = (field) => team.reduce((s, p) => s + (lastOf(p)[field] || 0), 0);
  const nw = last.nw || 0;
  const slots = f && f.slots20 ? f.slots20 : null;
  const slotTotal = slots ? slots.weapon + slots.spirit + slots.vitality : 0;
  let eng = null;
  if (findFights) {
    const map = engageStats(m, findFights);
    const o = map && map.get(me.slot);
    eng = o && o.fights >= 3 ? { fights: o.fights, rate: o.firsts / o.fights } : null;
  }
  const teamK = team.reduce((s, p) => s + (p.k || 0), 0);
  return {
    dmgShare: share(last.pdmg, sum('pdmg')),
    takenShare: share(last.pdmgT, sum('pdmgT')),
    healShare: share(last.heal, sum('heal')),
    nwShare: share(nw, team.reduce((s, p) => s + (p.nw || lastOf(p).nw || 0), 0)),
    kp: share((me.k || 0) + (me.a || 0), teamK),
    laneSouls: share(last.g_lane, nw),
    neutralSouls: share(last.g_neutral, nw),
    heroSouls: share(last.g_player, nw),
    bossSouls: share(last.g_boss, nw),
    boxSouls: share(last.g_brk, nw),
    vitality: slotTotal >= 4 ? slots.vitality / slotTotal : null,
    weapon: slotTotal >= 4 ? slots.weapon / slotTotal : null,
    spirit: slotTotal >= 4 ? slots.spirit / slotTotal : null,
    firstEngage: eng ? eng.rate : null,
    engageFights: eng ? eng.fights : 0,
  };
}

// Границы признаков (перцентили игроков рейтинга) — из errorNorms.json (roleCuts); без них роль не определяется.
function roleOf(feat, cuts) {
  if (!feat || !cuts) return { role: null, why: [] };
  const hi = (v, c) => Number.isFinite(v) && Number.isFinite(c) && v >= c;
  const lo = (v, c) => Number.isFinite(v) && Number.isFinite(c) && v <= c;
  const pct = (v) => `${Math.round(v * 100)}%`;
  // инициатор: получает много урона И первым заходит в бой / берёт живучесть
  if (hi(feat.takenShare, cuts.takenShare.p67) && (hi(feat.firstEngage, cuts.firstEngage.p50) || hi(feat.vitality, cuts.vitality.p67))) {
    return { role: 'initiator', why: [`получено ${pct(feat.takenShare)} урона команды (у трети игроков рейтинга — от ${pct(cuts.takenShare.p67)})`, hi(feat.firstEngage, cuts.firstEngage.p50) ? `первым вступает в бой в ${pct(feat.firstEngage)} драк` : `живучесть в ${pct(feat.vitality)} покупок`] };
  }
  if (hi(feat.dmgShare, cuts.dmgShare.p67)) {
    return { role: 'carry', why: [`${pct(feat.dmgShare)} урона команды (у трети игроков рейтинга — от ${pct(cuts.dmgShare.p67)})`, Number.isFinite(feat.takenShare) ? `получено ${pct(feat.takenShare)} урона` : null].filter(Boolean) };
  }
  if (lo(feat.dmgShare, cuts.dmgShare.p40) && (hi(feat.healShare, cuts.healShare.p67) || lo(feat.nwShare, cuts.nwShare.p33))) {
    return { role: 'support', why: [`${pct(feat.dmgShare)} урона команды (меньше, чем у 60% игроков рейтинга)`, hi(feat.healShare, cuts.healShare.p67) ? `${pct(feat.healShare)} лечения команды` : `${pct(feat.nwShare)} душ команды`] };
  }
  return { role: 'flex', why: [Number.isFinite(feat.dmgShare) ? `${pct(feat.dmgShare)} урона, ${Number.isFinite(feat.takenShare) ? pct(feat.takenShare) + ' полученного' : 'без признаков передовой'}` : 'нет ярко выраженного стиля'] };
}

const mean = (a) => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

// Рабочие роли по героям за серию игр: games — [{ hero, role, feat }]. Для каждого героя: сколько игр, какая роль чаще,
// насколько согласованы игры (доля игр с главной ролью) и уровень доверия. Мало игр — роль не называем.
function heroRoles(games, { minGames = 5 } = {}) {
  const by = new Map();
  for (const g of games) {
    if (!g.role) continue;
    const e = by.get(g.hero) || { hero: g.hero, games: 0, roles: {}, feats: [] };
    e.games += 1;
    e.roles[g.role] = (e.roles[g.role] || 0) + 1;
    e.feats.push(g.feat);
    by.set(g.hero, e);
  }
  const out = [];
  for (const e of by.values()) {
    const [role, n] = Object.entries(e.roles).sort((a, b) => b[1] - a[1])[0];
    const agree = n / e.games;
    let confidence = 'мало данных';
    if (e.games >= minGames) confidence = agree >= 0.7 && e.games >= 10 ? 'высокое' : agree >= 0.5 ? 'среднее' : 'низкое (роль меняется от игры к игре)';
    out.push({
      hero: e.hero, games: e.games, role: e.games >= minGames ? role : null, mainRole: role, agree: Math.round(agree * 100) / 100, confidence,
      roles: e.roles,
      features: { dmgShare: mean(e.feats.map((f) => f.dmgShare)), takenShare: mean(e.feats.map((f) => f.takenShare)), healShare: mean(e.feats.map((f) => f.healShare)), kp: mean(e.feats.map((f) => f.kp)), firstEngage: mean(e.feats.map((f) => f.firstEngage)), vitality: mean(e.feats.map((f) => f.vitality)), weapon: mean(e.feats.map((f) => f.weapon)), spirit: mean(e.feats.map((f) => f.spirit)), laneSouls: mean(e.feats.map((f) => f.laneSouls)), neutralSouls: mean(e.feats.map((f) => f.neutralSouls)), heroSouls: mean(e.feats.map((f) => f.heroSouls)), bossSouls: mean(e.feats.map((f) => f.bossSouls)) },
    });
  }
  return out.sort((a, b) => b.games - a.games);
}

module.exports = { ROLE_LABELS, roleFeatures, roleOf, heroRoles, engageStats };
