'use strict';
// Справочник контрпиков и контрпредметов: «выбрал врага — кого взять и что купить».
//
// Контрпики: статистика матчапов deadlock-api (pm из buildPickMeta), дельта результата героя
// против выбранного к его обычному результату (pairDelta из pick.js).
//
// Контрпредметы выводятся из угроз героя:
//  • что герой делает (способности, тип урона, контроль, лечение, полёт) — heroThreats.json,
//    проверено по deadlock.wiki и данным игры build 6861;
//  • что на нём обычно собирают (профиль покупок, src/core/heroProfile.js);
//  • что предмет умеет — counterRules.js (числа сверяются с данными игры тестом).
// У каждой рекомендации указано основание: какие способности и покупки её вызвали и откуда
// сведения. Если героя в таблице нет — предметы выводятся только из покупок топов и профиля,
// без объяснений способностей.

const { pairDelta, baseWr, laneSouls } = require('./pick');
const { RULES, threatLabel } = require('./counterRules');
const TABLE = safeRequire('./data/heroThreats.json');
const CODEX = safeRequire('./data/codexData.json');

function safeRequire(p) {
  try { return require(p); } catch { return null; }
}

// Пара с меньшим числом игр не показывается: стянутая дельта всё равно почти ноль.
const MIN_PAIR_GAMES = 100;

const HARD_CC = new Set(['stun', 'immobilize', 'sleep', 'silence', 'chain', 'tether', 'fear', 'hex', 'freeze', 'time-slow', 'disarm', 'pull', 'knockup', 'curse']);
const LASTING_CC = new Set(['slow', 'sleep', 'silence', 'fear', 'hex', 'freeze', 'curse', 'time-slow', 'disarm']);
const CC_RU = {
  stun: 'стан', immobilize: 'иммобилайз', sleep: 'сон', silence: 'молчание', chain: 'цепи', tether: 'привязь', fear: 'страх',
  hex: 'превращение', freeze: 'заморозка', 'time-slow': 'замедление времени', disarm: 'разоружение', pull: 'подтягивание',
  knockup: 'подброс', curse: 'проклятие', slow: 'замедление', root: 'корень', blind: 'ослепление',
};

// ---------- контрпики ----------
function counterPicks(enemyId, { pm = null, pool = [] } = {}) {
  const X = Number(enemyId);
  const myPool = new Set((pool || []).map(Number));
  const rows = [];
  if (!pm || !pm.vs) return { rows, covered: false };
  for (const H of Object.keys(pm.base || {})) {
    const h = Number(H);
    if (h === X) continue;
    const m = pairDelta(pm, 'vs', h, X, -1);
    if (!m || m.n < MIN_PAIR_GAMES) continue;
    const base = baseWr(pm, h);
    const pair = pm.vs[h] && pm.vs[h][X];
    const wrVs = pair ? pair[0] / pair[1] : null;
    const lanePair = pm.lane && pm.lane[h] ? pm.lane[h][X] : null;
    const lane = pairDelta(pm, 'lane', h, X, -1);
    const souls = laneSouls(pm, h, X);
    rows.push({
      hero_id: h,
      d: m.d,
      pp: base !== null && wrVs !== null ? wrVs - base : null,
      wrVs,
      base,
      n: m.n,
      laneD: lane ? lane.d : null,
      laneN: lanePair ? lanePair[1] : 0,
      laneWr: lanePair ? lanePair[0] / lanePair[1] : null,
      soulsD: souls ? souls.d : null,
      soulsN: souls ? souls.n : null,
      inPool: myPool.has(h),
      small: m.n < 300,
    });
  }
  rows.sort((a, b) => b.d - a.d);
  const only = rows.filter((r) => r.pp === null || r.pp > 0.0005);
  return { rows: only, covered: only.length > 0, pairsSeen: rows.length };
}

// ---------- контрпредметы из угроз ----------
const pct = (x) => `${Math.round(x * 100)}%`;
const names = (abs) => abs.map((a) => a.name).join(', ');
const ccList = (a) => (a.cc || []).filter((c) => CC_RU[c]).map((c) => CC_RU[c]).join(', ');

// Угрозы героя: разбор таблицы способностей и профиля покупок.
function threatsOf(hero, profile) {
  const abs = hero.abilities || [];
  const spirit = abs.filter((a) => a.damage === 'spirit');
  const weapon = abs.filter((a) => a.damage === 'weapon');
  const slots = profile && profile.slotShare;
  // Плавные веса 0…1 вместо жёстких порогов: герой с долей на границе (например, 24% и 27% оружейных
  // покупок в разные недели) не должен перескакивать из «пули важны» в «пули не важны».
  const ramp = (x, full) => Math.max(0, Math.min(1, x / full));
  const dmg = hero.dmg || [];
  const mf = dmg.includes('melee') || (hero.primary || []).includes('melee') ? 1 : profile ? ramp(profile.melee, 0.6) : 0;
  const sf = !dmg.includes('spirit') ? 0 : slots ? Math.max(ramp(slots.spirit, 0.45), spirit.length >= 3 ? 0.8 : 0) : (spirit.length >= 2 || !dmg.includes('weapon') ? 1 : 0);
  // без профиля покупок «пули — основной урон» утверждаем только для героев, где это отмечено явно
  const wf = !dmg.includes('weapon') ? 0 : (hero.primary || []).includes('weapon') ? 1 : slots ? ramp(slots.weapon, 0.35) : 0;
  const lf = (hero.heal || []).length > 0 ? 1 : profile ? ramp(profile.lifesteal, 0.6) : 0;
  const meleeHeavy = mf >= 0.6;
  const spiritHeavy = sf >= 0.6;
  const weaponHeavy = wf >= 0.6;
  const lifesteal = lf >= 0.6;
  const airAbs = abs.filter((a) => a.air || /полёт|парит|летит|левитац|в воздухе/i.test(a.note || ''));
  return {
    abs, spirit, weapon, meleeHeavy, spiritHeavy, weaponHeavy, lifesteal, airAbs, mf, sf, wf, lf,
    air: !!hero.air || abs.some((a) => a.air),
    cc: abs.filter((a) => (a.cc || []).some((c) => HARD_CC.has(c))),
  };
}

function threatLines(hero, t, profile) {
  const out = [];
  if (t.spiritHeavy) out.push({ kind: 'spirit', text: `Spirit-урон способностями: ${names(t.spirit.slice(0, 4))}.` });
  if (t.weaponHeavy) out.push({ kind: 'weapon', text: `Урон оружием${hero.weaponDps ? ` (около ${hero.weaponDps} в секунду)` : ''} — пули.` });
  if (t.meleeHeavy) out.push({ kind: 'melee', text: `Много бьёт ближним боем${profile && profile.melee >= 0.5 ? ` (предметы ближнего боя в ${pct(profile.melee)} игр)` : ''}.` });
  if (t.cc.length) out.push({ kind: 'control', text: `Контроль: ${t.cc.map((a) => `${a.name} (${ccList(a)})`).join('; ')}.` });
  if (t.lifesteal) out.push({ kind: 'heal', text: `Лечится: ${(hero.heal || []).length ? hero.heal.join('; ') : `вампиризм в сборке ${pct(profile.lifesteal)} игр`}.` });
  if (t.air) out.push({ kind: 'air', text: `Летает или парит${t.airAbs.length ? `: ${names(t.airAbs)}` : ''}.` });
  return out;
}

// Рекомендуемые предметы: каждый — со списком причин (откуда взялась рекомендация).
function recommendItems(hero, profile) {
  const t = threatsOf(hero, profile);
  const cand = new Map();
  const add = (name, score, kind, why) => {
    const rule = RULES.items[name];
    const shop = CODEX && CODEX.items && CODEX.items[name];
    if (!rule || !shop) return; // предмета нет в текущем магазине или правило не заведено — молчим
    const c = cand.get(name) || { name, score: 0, why: [], kinds: new Set() };
    c.score += score;
    c.why.push(why);
    c.kinds.add(kind);
    cand.set(name, c);
  };
  const w = (a) => (a.slot === 4 ? 2 : 1); // ультимейт важнее

  for (const a of t.abs) {
    const compat = a.compat || [];
    const lasting = a.lasting === true || (a.cc || []).some((c) => LASTING_CC.has(c));
    if (compat.includes('reactiveBarrier')) add('Reactive Barrier', 2 * w(a), 'control', `${a.name}: ${ccList(a) || 'контроль'} — включает барьер`);
    if (compat.includes('indomitable')) add('Indomitable', 1.5 * w(a), 'control', `${a.name}: очищается автоматически`);
    if (compat.includes('unstoppable') && (a.cc || []).some((c) => HARD_CC.has(c) || c === 'slow')) add('Unstoppable', 1 * w(a), 'control', `${a.name}: подавляется активом`);
    if (compat.includes('dispel') && lasting) add('Dispel Magic', 1.2, 'debuff', `${a.name}: долгий эффект можно снять`);
    if (compat.includes('slowingHex')) add('Slowing Hex', 1 * w(a), 'control', `${a.name}: не даст запустить (Slowing Hex глушит)`);
    if (compat.includes('platedArmor') && t.wf >= 0.3) add('Plated Armor', 1 * t.wf, 'weapon', `${a.name}: эффект от пуль отменяется`);
  }
  if (t.cc.some((a) => a.slot === 4)) add('Counterspell', 0.8, 'control', 'ультимейт с контролем: парирование в нужный момент защищает от способности');
  if (t.air) {
    const flyers = names(t.airAbs) || 'полёт';
    add('Knockdown', 4, 'air', `летает (${flyers}): стан по цели в воздухе длиннее, гравитация выше`);
    add('Phantom Strike', 3.6, 'air', `летает (${flyers}): стягивает на землю`);
  }
  if (t.lf >= 0.3) {
    const src = (hero.heal || []).length ? 'лечится способностями и вампиризмом' : `вампиризм в сборке (${pct(profile.lifesteal)} игр)`;
    add('Healbane', 3 * t.lf, 'heal', src);
    add('Toxic Bullets', 2.8 * t.lf, 'heal', src);
    add('Decay', 1.5 * t.lf, 'heal', src);
    add('Crippling Headshot', 1 * t.lf, 'heal', src);
    add('Inhibitor', 1 * t.lf, 'heal', src);
  }
  if (t.sf >= 0.3) {
    add('Spirit Shielding', 2.6 * t.sf, 'spirit', `Spirit-урон: ${names(t.spirit.slice(0, 3))}`);
    add('Spirit Resilience', 2.8 * t.sf, 'spirit', `Spirit-урон: ${names(t.spirit.slice(0, 3))}`);
  }
  if (t.wf >= 0.3) {
    add('Weapon Shielding', 2.4 * t.wf, 'weapon', 'основной урон — пули');
    add('Bullet Resilience', 2.8 * t.wf, 'weapon', 'основной урон — пули');
    add('Plated Armor', 1.5 * t.wf, 'weapon', 'пули и эффекты от пуль');
    add('Metal Skin', 0.8 * t.wf, 'weapon', 'пули: 5 секунд иммунитета');
  }
  if (t.mf >= 0.3) add('Rebuttal', 3.5 * t.mf, 'melee', profile && profile.melee >= 0.5 ? `предметы ближнего боя в ${pct(profile.melee)} игр` : 'много урона ближним боем');

  const items = [...cand.values()].map((c) => {
    const rule = RULES.items[c.name];
    const shop = CODEX.items[c.name];
    return {
      name: c.name,
      tier: shop.tier,
      slot: shop.slot,
      cost: shop.cost,
      score: Math.round(c.score * 10) / 10,
      kind: [...c.kinds][0],
      kindLabel: threatLabel([...c.kinds][0]),
      why: [...new Set(c.why)],
      text: rule.text,
      goodVs: rule.goodVs,
      notEnough: rule.notEnough,
      src: rule.src,
    };
  });
  // Дешёвый и подходящий — выше: предметы за 800–1 600 душ чуть выше, за 6 400 — чуть ниже.
  const adj = (i) => i.score * (i.cost <= 1600 ? 1.1 : i.cost >= 6400 ? 0.85 : 1);
  items.sort((a, b) => adj(b) - adj(a) || a.cost - b.cost);
  return { items: items.filter((i) => i.score >= 1).slice(0, 10), threats: threatLines(hero, t, profile), table: t };
}

// Контрпредметы против выбранного врага.
// table — counterTable(): { hero: [{ id, lift, rateVs }] } из покупок топов (наблюдение, не доказательство).
function counterItemsFor(enemyId, { table = {}, assets = null, profile = null } = {}) {
  const X = Number(enemyId);
  const item = (id) => (assets && assets.items && assets.items[id]) || null;
  const purchases = (table[X] || []).map((r) => {
    const a = item(r.id);
    const rule = a ? RULES.items[a.name] || null : null;
    return {
      id: r.id, lift: r.lift, rateVs: r.rateVs,
      name: a ? a.name : `Предмет ${r.id}`,
      cost: a ? a.cost : null, tier: a ? a.tier : null, slot: a ? a.slot : null,
      rule: rule ? { ...rule, threatLabel: threatLabel(rule.threat) } : null,
      source: 'purchases',
    };
  });
  const hero = TABLE && TABLE.heroes && TABLE.heroes[X];
  const rec = hero ? recommendItems(hero, profile) : { items: [], threats: [] };
  return {
    purchases,
    recommended: rec.items,
    threats: rec.threats,
    verified: !!hero,
    abilities: hero ? hero.abilities.map((a) => ({ slot: a.slot, name: a.name, damage: a.damage, cc: a.cc || [], note: a.note })) : null,
    profile: profile ? { games: profile.games, small: profile.small, top: profile.top, slotShare: profile.slotShare, since: profile.since || null } : null,
    mechanics: [], // прежние «механики 4 героев» заменены общими рекомендациями выше
  };
}

// Полный ответ справочника по одному врагу. Результат помечен enemy — при смене героя во время
// запроса интерфейс сверяет метку и не подменяет данные.
function counterCodex(enemyId, { pm = null, table = {}, assets = null, pool = [], stale = false, profile = null } = {}) {
  const X = Number(enemyId);
  const picks = counterPicks(X, { pm, pool });
  const items = counterItemsFor(X, { table, assets, profile });
  const age = pm && pm.at ? Math.round((Date.now() - pm.at) / 60000) : null;
  return {
    enemy: X,
    meta: {
      badge: pm ? pm.badge : null, since: pm ? pm.since : null, at: pm ? pm.at : null, ageMin: age,
      games: pm ? pm.games : null, stale, covered: picks.covered,
    },
    picks,
    items,
    rules: { patch: RULES.patch, build: RULES.build, source: RULES.source, verified: TABLE ? TABLE.verified : null, heroesCovered: TABLE ? Object.keys(TABLE.heroes).length : 0 },
    heroRule: TABLE && TABLE.heroes[X] ? { name: TABLE.heroes[X].name, threats: items.threats, heals: TABLE.heroes[X].heal || [] } : null,
  };
}

module.exports = { counterPicks, counterItemsFor, counterCodex, recommendItems, threatsOf, MIN_PAIR_GAMES };
