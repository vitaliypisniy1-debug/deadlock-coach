'use strict';
// Линия: разрыв по душам к 10:00 и доля побед.
// Папка данных: первый аргумент или DC_PILOT_DIR (по умолчанию tools/errors-pilot/pilot-data). См. README.md.
const path = require('path');
const DATA = path.resolve(process.argv[2] || process.env.DC_PILOT_DIR || path.join(__dirname, 'pilot-data'));
const P = (f) => path.join(DATA, f);
const SRC = path.join(__dirname, '..', '..', 'src');
const fs = require('fs'); const readline = require('readline');
(async () => {
  const byM = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(P('rows.jsonl')), crlfDelay: Infinity });
  for await (const l of rl) { if (!l) continue; const r = JSON.parse(l); let a = byM.get(r.mid); if (!a) byM.set(r.mid, (a = [])); a.push(r); }
  const rows = [];
  for (const a of byM.values()) for (const r of a) {
    if (r.lane === null || r.nw10 === null || r.tier === null) continue;
    const foes = a.filter((x) => x.won !== r.won && x.lane === r.lane && x.nw10 !== null);
    if (!foes.length) continue;
    const allies = a.filter((x) => x.won === r.won && x.lane === r.lane && x.nw10 !== null);
    const gap = r.nw10 - foes.reduce((s, x) => s + x.nw10, 0) / foes.length;
    // командный разрыв линии: среднее по своим на линии − среднее по соперникам
    const lg = allies.reduce((s, x) => s + x.nw10, 0) / allies.length - foes.reduce((s, x) => s + x.nw10, 0) / foes.length;
    rows.push({ gap, lg, won: r.won, flagged: r.keys.includes('lane_trades'), checked: r.checked.includes('lane_trades'), tier: r.tier, d10: null });
  }
  console.log('игроков на линии', rows.length);
  const fl = rows.filter((r) => r.flagged), nf = rows.filter((r) => r.checked && !r.flagged);
  const mean = (a, f) => a.reduce((s, r) => s + f(r), 0) / a.length;
  console.log('размены в пользу врага: игроков', fl.length, 'средний разрыв по душам к 10:00 против соперника по линии', mean(fl, (r) => r.gap).toFixed(0), '| без замечания', nf.length, mean(nf, (r) => r.gap).toFixed(0));
  // WR vs разрыв линии (командный) по рангам
  const cuts = [-1500, -800, -300, 300, 800, 1500];
  const bk = (v) => { let i = 0; while (i < cuts.length && v > cuts[i]) i++; return i; };
  const lab = ['≤−1500', '−1500..−800', '−800..−300', '−300..300', '300..800', '800..1500', '>1500'];
  for (const [nm, f] of [['ранги 1-5', (r) => r.tier <= 5], ['ранги 6-7', (r) => r.tier >= 6 && r.tier <= 7], ['ранги 8+', (r) => r.tier >= 8]]) {
    const s = rows.filter(f); const c = lab.map(() => [0, 0]);
    for (const r of s) { const b = bk(r.lg); c[b][0]++; c[b][1] += r.won; }
    console.log(nm.padEnd(10), 'WR по разрыву душ на линии к 10:00 (своя линия − соперники):', c.map((x, i) => `${lab[i]}: ${x[0] ? (x[1] / x[0] * 100).toFixed(0) : '-'}%`).join(' | '));
  }
})();
