'use strict';
// Измеренное лечение героев за игру (Deadlock API SQL, таблица match_player, только чтение).
// Запуск после патча: node tools/build-heal-stats.js  → src/core/data/heroHealing.json
// Окно — игры после последнего патча (RULES.patchSince), рейтинговые, normal, ранг Оракул 1+,
// матчи длиннее 10 минут. «Лечение себя» — stats.self_healing (накопительный счётчик, берём последнее значение).
// Важно: если способность не считает своё действие лечением (например, Bloodletting у Shiv только
// откладывает урон), в этой метрике оно не видно.

const fs = require('fs');
const path = require('path');
const { RULES } = require('../src/core/counterRules');

const OUT = path.join(__dirname, '..', 'src', 'core', 'data', 'heroHealing.json');
const RANK = 81;

async function main() {
  const since = Number(process.argv[2]) || RULES.patchSince;
  const q = `SELECT hero_id, count(*) n, round(avg(sh)) sh, round(median(sh)) sh_med, round(avg(sh*60.0/duration_s)*10)/10 sh_pm, round(sum(sh)*1.0/sum(dt),3) heal_taken, round(sum(dt)*1.0/greatest(sum(dth),1)) dmg_per_death FROM (SELECT hero_id, duration_s, "stats.self_healing"[-1] sh, "stats.player_damage_taken"[-1] dt, deaths dth FROM match_player WHERE start_time >= to_timestamp(${since}) AND match_mode='Ranked' AND game_mode='Normal' AND player_rank_initial_display_rank >= ${RANK} AND duration_s > 600 AND len("stats.self_healing") >= 4) GROUP BY 1 HAVING count(*) >= 100 ORDER BY 1`;
  // SQL-эндпоинт ограничен по частоте (около 2 запросов в минуту): при ответе не-JSON ждём и повторяем
  let rows = null;
  for (let attempt = 1; attempt <= 4 && !rows; attempt++) {
    const r = await fetch('https://api.deadlock-api.com/v1/sql?query=' + encodeURIComponent(q));
    const text = await r.text();
    try { rows = JSON.parse(text); } catch { if (attempt < 4) await new Promise((s) => setTimeout(s, 35000)); }
  }
  if (!rows) throw new Error('API SQL не ответил JSON после 4 попыток (лимит запросов?)');
  if (!Array.isArray(rows) || !rows.length) throw new Error('API не вернул строк: ' + JSON.stringify(rows).slice(0, 200));
  const sorted = [...rows].sort((a, b) => b.sh_pm - a.sh_pm);
  const heroes = {};
  for (const x of rows) {
    heroes[x.hero_id] = {
      games: x.n,
      perGame: x.sh,
      median: x.sh_med,
      perMinute: x.sh_pm,
      shareOfTaken: x.heal_taken,
      damageTakenPerDeath: x.dmg_per_death,
      rank: sorted.findIndex((y) => y.hero_id === x.hero_id) + 1,
    };
  }
  const med = [...rows].map((x) => x.sh_pm).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
  const out = {
    v: 1,
    generatedAt: new Date().toISOString(),
    since,
    sinceDate: new Date(since * 1000).toISOString().slice(0, 10),
    filter: 'Ranked, game_mode normal, ранг матча Оракул 1+, длительность > 10 мин',
    metric: 'stats.self_healing (последнее значение), в минуту и за игру',
    heroesCount: rows.length,
    matches: rows.reduce((s, x) => s + x.n, 0),
    medianPerMinute: med,
    heroes,
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`героев ${rows.length}, матчей ${out.matches}, с ${out.sinceDate}, медиана ${med}/мин → ${path.relative(process.cwd(), OUT)}`);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
