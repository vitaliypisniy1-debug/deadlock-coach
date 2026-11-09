'use strict';
// Билд одного игрока из конкретного матча: предметы по стадиям (как в игровом
// редакторе билдов) + порядок прокачки способностей. Умеет превращаться в текст
// (для Discord/заметок) и в файл.

const { itemFates } = require('./meta');
const { skillOrder } = require('./skills');

const STAGES = [
  { key: 'early', name: 'Начало (до 10:00)', to: 600 },
  { key: 'mid', name: 'Середина (10–20 мин)', to: 1200 },
  { key: 'late', name: 'Поздняя игра (20+ мин)', to: Infinity },
];

const clock = (t) => {
  const s = Math.max(0, Math.round(t || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function matchBuild({ match, player, assets }) {
  const info = (id) => (assets && assets.items && assets.items[id]) || {};
  const buys = itemFates(player.items, assets)
    .sort((a, b) => a.t - b.t)
    .map((f) => ({ id: f.id, t: f.t, fate: f.fate, soldT: f.soldT, into: f.into, cost: info(f.id).cost ?? null, slot: info(f.id).slot || null }));
  const stages = [];
  let from = -Infinity;
  for (const st of STAGES) {
    stages.push({ key: st.key, name: st.name, items: buys.filter((b) => b.t >= from && b.t < st.to) });
    from = st.to;
  }
  // что было в слотах в конце игры: не продано и не ушло в улучшение
  const final = buys.filter((b) => b.fate === 'kept');
  const skills = skillOrder(player, assets);
  return {
    match_id: match.match_id,
    start_time: match.start_time || null,
    duration_s: match.duration_s || null,
    account_id: player.account_id,
    hero_id: player.hero_id,
    won: !!player.won,
    k: player.k,
    d: player.d,
    a: player.a,
    nw: player.nw,
    buys,
    stages,
    final,
    skills,
  };
}

// Короткий текст билда — вставить в Discord, заметки, отправить другу.
function buildText(b, { heroName, itemName, abilityName, playerName }) {
  const lines = [];
  lines.push(`${heroName(b.hero_id)} — билд ${playerName || 'игрока'} из матча ${b.match_id}`);
  lines.push(`${b.won ? 'Победа' : 'Поражение'} · ${b.k}/${b.d}/${b.a} · ${Math.round(b.nw / 1000)}k душ${b.duration_s ? ` · ${clock(b.duration_s)}` : ''}`);
  lines.push('');
  if (b.skills.steps.length) {
    const idx = new Map(b.skills.abilities.map((id, i) => [id, i + 1]));
    lines.push('Способности (порядок очков):');
    lines.push(b.skills.steps.map((s) => `${idx.get(s.id) || '?'}`).join(' → '));
    b.skills.abilities.forEach((id, i) => lines.push(`  ${i + 1} — ${abilityName(id)}`));
    lines.push('');
  }
  for (const st of b.stages) {
    if (!st.items.length) continue;
    lines.push(`${st.name}:`);
    for (const it of st.items) {
      const tail = it.fate === 'sold' ? ` (продан на ${clock(it.soldT)})` : it.fate === 'upgraded' ? ` (→ ${itemName(it.into)})` : '';
      lines.push(`  ${clock(it.t)}  ${itemName(it.id)}${tail}`);
    }
    lines.push('');
  }
  if (b.final.length) {
    lines.push('К концу игры:');
    lines.push('  ' + b.final.map((it) => itemName(it.id)).join(', '));
    lines.push('');
  }
  lines.push('Собрано в Deadlock Coach по данным deadlock-api.com');
  return lines.join('\n');
}

// Файл билда. Предметы разложены как в игровых билдах (details.mod_categories[].mods[].ability_id —
// так же устроены билды в /v1/builds), плюс порядок способностей. Импортировать такой файл
// в саму игру нельзя — билды хранятся на серверах Valve, — но его удобно хранить и сравнивать.
function buildFile(b, { heroName, itemName, abilityName, playerName }) {
  return {
    format: 'deadlock-coach/build',
    version: 1,
    source: { match_id: b.match_id, account_id: b.account_id, player: playerName || null, won: b.won, kda: [b.k, b.d, b.a], net_worth: b.nw },
    hero_build: {
      hero_id: b.hero_id,
      name: `${heroName(b.hero_id)} — матч ${b.match_id}`,
      description: `Билд ${playerName || 'игрока'} из матча ${b.match_id} (${b.won ? 'победа' : 'поражение'}, ${b.k}/${b.d}/${b.a}).`,
      details: {
        mod_categories: b.stages
          .filter((st) => st.items.length)
          .map((st) => ({
            name: st.name,
            mods: st.items.map((it) => ({ ability_id: it.id, name: itemName(it.id), time_s: it.t, fate: it.fate })),
          })),
        ability_order: b.skills.steps.map((s) => ({ ability_id: s.id, name: abilityName(s.id), level: s.level, time_s: s.t })),
      },
    },
  };
}

module.exports = { STAGES, matchBuild, buildText, buildFile, clock };
