'use strict';
// Генератор данных справочника контрпиков: способности героев и эффекты предметов
// из справочников Deadlock API (assets). Запускается вручную после патча:
//
//   node tools/build-codex-data.js            # текущая сборка
//   node tools/build-codex-data.js 6861       # конкретная сборка клиента
//
// Результат — src/core/data/codexData.json (в Git, работает без сети). Строки статьи
// помечены сборкой и датой; правило «после патча — один запуск» вместо ручного
// переписывания. Признаки берутся из текстов описаний игры и из свойств (тип урона —
// по метке scale_function_tech_damage), а не придумываются.
//
// Что НЕ определяется автоматически и лежит в src/core/counterRules.js вручную:
// совместимость предмет↔эффект (Unstoppable, Reactive Barrier, Dispel Magic и т. п.),
// список летающих героев, польза предмета (цена, окно применения).

const fs = require('fs');
const path = require('path');

const BASE = 'https://api.deadlock-api.com';
const OUT = path.join(__dirname, '..', 'src', 'core', 'data', 'codexData.json');

const clean = (s) => String(s == null ? '' : s)
  .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

// Признаки эффектов по тексту описания способности (английский текст игры).
const FLAG_RULES = [
  ['stun', /\bstun/i],
  ['immobilize', /immobiliz/i],
  ['sleep', /\bsleep|put to sleep/i],
  ['silence', /silenc/i],
  ['disarm', /disarm/i],
  ['slow', /\bslow/i],
  ['knockup', /knock(ed)? ?up|knockback|launch|toss|lift/i],
  ['pull', /\bpull|drag|reel|yank|tether|chain(?!s? ?to)|grab/i],
  ['fear', /\bfear|hex(ing|ed)?\b|pigeon/i],
  ['heal', /\bheal(s|ing|ed)?\b|lifesteal|regenerat|drain health/i],
  ['antiHeal', /incoming heal|healing reduc|reduces? (their )?heal/i],
  ['resistShred', /(bullet|spirit|melee)? ?resist(ance)? (reduc|shred)|reduces? .{0,30}resist|-\d+% .{0,20}resist/i],
  ['invulnerable', /invulnerab|untargetable|immune/i],
  ['bleed', /bleed|burn|damage over time|poison/i],
  ['mobility', /\bdash|leap|jump|teleport|fly|flight|glide|blink|charge forward|rush/i],
];

function flagsOf(text) {
  const t = clean(text);
  const out = [];
  for (const [k, re] of FLAG_RULES) if (re.test(t)) out.push(k);
  return out;
}

async function get(p) {
  const r = await fetch(BASE + p, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  return r.json();
}

// Единицы измерения: свойство со шкалой Spirit — признак Spirit-урона способности.
function spiritScaled(props) {
  for (const v of Object.values(props || {})) {
    const f = v && v.scale_function;
    if (f && f.class_name === 'scale_function_tech_damage' && Number(v.value) > 0) return true;
  }
  return false;
}

function abilityRow(slot, a) {
  const d = a.description || {};
  const base = clean(d.desc);
  const up = [clean(d.t1_desc), clean(d.t2_desc), clean(d.t3_desc)];
  const props = a.properties || {};
  const cd = props.AbilityCooldown ? Number(props.AbilityCooldown.value) : null;
  const dmg = {
    spirit: spiritScaled(props),
    melee: /melee/i.test(base) && /damage/i.test(base),
    weapon: /weapon damage|bullet|shot|fires/i.test(base),
  };
  return {
    slot,
    name: a.name,
    cls: a.class_name,
    cd: Number.isFinite(cd) ? cd : null,
    text: base,
    up,
    flags: { base: flagsOf(base), t1: flagsOf(up[0]), t2: flagsOf(up[1]), t3: flagsOf(up[2]) },
    dmg,
  };
}

// Числа предметов, которые используем для расчётов: сопротивления, лечение, барьеры.
const NUM_KEYS = {
  bulletResist: ['BulletResist', 'BulletArmorDamageResist'],
  spiritResist: ['TechResist'],
  bulletResistBelow: ['BulletResistBelowThreshold'],
  spiritResistBelow: ['TechResistBelowThreshold'],
  meleeResist: ['MeleeResist'],
  debuffResist: ['StatusResistancePercent'],
  antiHeal: ['HealAmpReceivePenaltyPercent'],
  barrier: ['VexBarrierCombatBarrier', 'CombatBarrier'],
  cooldown: ['AbilityCooldown'],
  duration: ['AbilityDuration'],
  bonusHealth: ['BonusHealth'],
};

function itemRow(i) {
  const d = i.description || {};
  const props = i.properties || {};
  const nums = {};
  for (const [k, keys] of Object.entries(NUM_KEYS)) {
    for (const key of keys) {
      const p = props[key];
      if (p && p.value !== undefined && p.value !== '' && Number(p.value) !== 0 && !Number.isNaN(Number(p.value))) { nums[k] = Number(p.value); break; }
    }
  }
  const text = clean([d.desc, d.active, d.passive].filter(Boolean).join(' '));
  return {
    id: i.id,
    name: i.name,
    slot: i.item_slot_type,
    tier: i.item_tier,
    cost: i.cost,
    active: !!i.is_active_item,
    text,
    nums,
  };
}

async function main() {
  const ver = process.argv[2] ? Number(process.argv[2]) : null;
  const q = ver ? `?client_version=${ver}` : '';
  const [info, heroes, items] = await Promise.all([get('/v1/assets/steam-info'), get(`/v1/assets/heroes${q}`), get(`/v1/assets/items${q}`)]);
  const byCls = new Map(items.map((x) => [x.class_name, x]));
  const out = {
    v: 1,
    build: ver || info.client_version,
    buildDate: ver ? null : info.version_datetime,
    generatedAt: new Date().toISOString(),
    source: 'Deadlock API assets (heroes, items) — тексты и свойства из файлов игры',
    heroes: {},
    items: {},
  };
  for (const h of heroes) {
    if (!h.player_selectable || h.disabled) continue;
    const abilities = [];
    ['signature1', 'signature2', 'signature3', 'signature4'].forEach((k, idx) => {
      const a = byCls.get(h.items && h.items[k]);
      if (a) abilities.push(abilityRow(idx + 1, a));
    });
    out.heroes[h.id] = { id: h.id, name: h.name, cls: h.class_name, type: h.hero_type || null, abilities };
  }
  for (const i of items) {
    if (i.type !== 'upgrade' || i.shopable === false || !i.item_slot_type || !(i.item_tier >= 1 && i.item_tier <= 4)) continue;
    out.items[i.name] = itemRow(i);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`build ${out.build}: героев ${Object.keys(out.heroes).length}, предметов ${Object.keys(out.items).length}, ${fs.statSync(OUT).size} байт → ${path.relative(process.cwd(), OUT)}`);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { flagsOf, clean, FLAG_RULES, abilityRow, itemRow };
