'use strict';
// Эпизодная оценка: смерти в одиночку и фарм вдали при драках (накопители по матчам).
// Папка данных: первый аргумент или DC_PILOT_DIR (по умолчанию tools/errors-pilot/pilot-data). См. README.md.
const path = require('path');
const DATA = path.resolve(process.argv[2] || process.env.DC_PILOT_DIR || path.join(__dirname, 'pilot-data'));
const P = (f) => path.join(DATA, f);
const SRC = path.join(__dirname, '..', '..', 'src');
// Эпизодная оценка: что происходит в следующие 75 секунд после события и как это зависит от «ошибки».
// Вход: probe-out/matches.jsonl (сжатые матчи с маршрутами), probe-out/ranks.json. Выход: probe-out/episodes.json и сводка в консоль.
const fs = require('fs');
const readline = require('readline');
const L = require(path.join(SRC, 'core', 'leaks'));
const D = require(path.join(SRC, 'core', 'deaths'));
const ranks = JSON.parse(fs.readFileSync(P('ranks.json'), 'utf8'));
const WIN = 75;
const band = (t) => (t === null || t === undefined ? 1 : t <= 5 ? 0 : t <= 7 ? 1 : 2);
const phase = (t) => (t < 1200 ? 0 : t < 1800 ? 1 : 2);

// накопители: объект ключ -> [n0, sum0, n1, sum1]
const makeAcc = () => new Map();
const add = (acc, key, cls, v) => { let o = acc.get(key); if (!o) acc.set(key, (o = [0, 0, 0, 0, 0, 0])); o[cls * 2]++; o[cls * 2 + 1] += v; };
const perMatch = [];

(async () => {
  const rl = readline.createInterface({ input: fs.createReadStream(P('matches.jsonl')), crlfDelay: Infinity });
  let nm = 0;
  for await (const line of rl) {
    if (!line) continue;
    const m = JSON.parse(line); nm++;
    const rk = ranks[m.match_id] || {};
    const tierOf = (p) => (Number.isFinite(rk[p.account_id]) ? Math.floor(rk[p.account_id] / 10) : null);
    const bySlot = new Map(m.players.map((p) => [p.slot, p]));
    const step = (m.paths && m.paths.step) || 5;
    if (!m.paths || !m.paths.players) continue;
    const alive = (slot, t) => { const pp = m.paths.players[slot]; if (!pp) return null; const pt = pp[Math.min(pp.length - 1, Math.max(0, Math.round(t / step)))]; return pt ? !!pt[2] : null; };
    // все смерти в матче
    const dead = [];
    for (const p of m.players) for (const d of p.deaths || []) if (Number.isFinite(d[0])) dead.push({ t: d[0], team: p.team, slot: p.slot });
    const acc = { solo: makeAcc(), fight: makeAcc() };
    const matchBand = (() => { const ts = m.players.map(tierOf).filter((x) => x !== null).sort((a, b) => a - b); return ts.length ? band(ts[Math.floor(ts.length / 2)]) : 1; })();

    // ---- A. смерти игрока: в одиночку / нет ----
    for (const me of m.players) {
      if (me.abandoned) continue;
      const solo = D.soloDeathRows(m, me);
      if (solo === null) continue;
      const soloT = new Set(solo.map((r) => r.t));
      for (const d of me.deaths || []) {
        const t = d[0];
        if (!Number.isFinite(t) || t < 600 || t + WIN > m.duration_s) continue;
        let allyAlive = 0, foeAlive = 0;
        for (const q of m.players) { if (q === me) continue; const a = alive(q.slot, t); if (a) { if (q.team === me.team) allyAlive++; else foeAlive++; } }
        let delta = 0;
        for (const x of dead) { if (x.t > t + 1 && x.t <= t + WIN) delta += x.team === me.team ? -1 : 1; }
        const key = `${phase(t)}|${allyAlive}|${foeAlive}|${matchBand}`;
        add(acc.solo, key, soloT.has(t) ? 1 : 0, delta);
      }
    }

    // ---- B. драки: сколько союзников «фармило вдали» ----
    for (const fight of L.findFights(m)) {
      if (fight.t0 < 600 || fight.deaths.length < 3 || !Number.isFinite(fight.x)) continue;
      if (fight.deaths.some((d) => !Number.isFinite(d.x))) continue;
      const teams = [0, 1];
      for (const team of teams) {
        const mem = m.players.filter((p) => p.team === team && !p.abandoned);
        let present = 0, absFarm = 0, absOther = 0, dead0 = 0, ok = true;
        for (const p of mem) {
          const pp = m.paths.players[p.slot]; if (!pp) { ok = false; break; }
          const i0 = Math.max(0, Math.floor((fight.t0 - step) / step)), i1 = Math.min(pp.length - 1, Math.ceil((fight.t1 + step) / step));
          let mask = 0, far = Infinity, anyAlive = false;
          for (let i = i0; i <= i1; i++) { const pt = pp[i]; if (!pt) continue; if (pt[2]) { anyAlive = true; mask |= pt[3] || 0; far = Math.min(far, Math.hypot(pt[0] - fight.x, pt[1] - fight.y)); } }
          if (!anyAlive) { dead0++; continue; }
          const diedInFight = fight.deaths.some((d) => d.slot === p.slot);
          if (diedInFight || (mask & 1) || far < L.FIGHT_FAR) present++;
          else if (far <= L.FIGHT_REACH && (mask & 6)) absFarm++;
          else absOther++;
        }
        if (!ok) continue;
        const allyD = fight.deaths.filter((d) => d.team === team).length;
        const enemyD = fight.deaths.length - allyD;
        const delta = enemyD - allyD;
        const size = fight.deaths.length <= 4 ? 0 : fight.deaths.length <= 6 ? 1 : 2;
        const key = `${phase(fight.t0)}|${size}|${Math.min(5, present)}|${matchBand}`;
        add(acc.fight, key, Math.min(2, absFarm), delta); // класс 0: нет, 1: один, 2: двое+
      }
    }
    perMatch.push({ solo: [...acc.solo.entries()], fight: [...acc.fight.entries()] });
    if (nm % 1000 === 0) console.log(nm);
  }
  fs.writeFileSync(P('episodes-permatch.json'), JSON.stringify(perMatch));
  console.log('done', perMatch.length);
})();
