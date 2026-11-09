'use strict';
// Сводка по герою: все твои игры на одном герое против топов на нём же.
// Что получается, чего не хватает, что повторяется из игры в игру.

const { median, mean, wilson } = require('./stats');
const { playerFeatures, refAll } = require('./features');
const { matchTips } = require('./tipsMatch');
const { phaseSources, averageRows, summarizePhase, PHASES } = require('./sources');
const { clusterBuilds, closestVariant } = require('./variants');
const { firstPurchases } = require('./meta');
const { N, D1, P, T, plural } = require('./tipkit');

// Строки таблицы «ты против топов». better: 'high' — больше лучше, 'low' — меньше лучше.
const METRICS = [
  { key: 'nw10', label: 'Души к 10:00', fmt: N, better: 'high' },
  { key: 'lh10', label: 'Добито крипов к 10:00', fmt: N, better: 'high' },
  { key: 'dn10', label: 'Отобрано сфер к 10:00', fmt: N, better: 'high', onlyIf: (ref) => ref >= 1 },
  { key: 'soulsMid', label: 'Души в минуту, 10–20 мин', fmt: N, better: 'high' },
  { key: 'soulsMin', label: 'Души в минуту за игру', fmt: N, better: 'high' },
  { key: 'dmgMin', label: 'Урон по героям в минуту', fmt: N, better: 'high' },
  { key: 'kp', label: 'Участие в убийствах', fmt: P, better: 'high' },
  { key: 'd', label: 'Смерти за игру', fmt: D1, better: 'low' },
  { key: 'd10', label: 'Смерти до 10:00', fmt: D1, better: 'low' },
  { key: 'dmgTMin', label: 'Урон по тебе в минуту', fmt: N, better: 'low' },
  { key: 'healMin', label: 'Лечение в минуту', fmt: N, better: 'high', onlyIf: (ref) => ref >= 40 },
  { key: 'bdmgMin', label: 'Урон по объектам в минуту', fmt: N, better: 'high' },
  { key: 'acc', label: 'Точность', fmt: P, better: 'high' },
  { key: 'hsRate', label: 'Попадания в голову', fmt: P, better: 'high', onlyIf: (ref) => ref >= 0.05 },
  { key: 'firstBigT', label: 'Первый предмет за 3000+', fmt: T, better: 'low' },
];

function avgOf(list, key) {
  return mean(list.map((f) => f[key]).filter((v) => v !== null && v !== undefined && Number.isFinite(v)));
}

function heroReport({ heroId, games, bench, assets = null, accountId }) {
  const heroName = (id) => (assets && assets.heroes && assets.heroes[id] ? assets.heroes[id].name : `герой ${id}`);
  const itemName = (id) => (assets && assets.items && assets.items[id] ? assets.items[id].name : `предмет ${id}`);
  const loaded = games.filter((g) => g.match && g.me);
  const decided = games.filter((g) => g.won !== null && g.won !== undefined);
  const wins = decided.filter((g) => g.won).length;
  const ci = wilson(wins, decided.length);

  const benchF = bench.filter((b) => b.match).map((b) => playerFeatures(b.player, b.match, assets));
  const ref = refAll(benchF);
  const myF = loaded.map((g) => ({ ...playerFeatures(g.me, g.match, assets), match_id: g.match.match_id, start: g.match.start_time }));

  // ---- 1. Цифры: ты против топов ----
  const metrics = [];
  for (const m of METRICS) {
    const me = avgOf(myF, m.key);
    const r = ref[m.key];
    if (me === null || !r || r.n < 3 || r.med === null) continue;
    if (m.onlyIf && !m.onlyIf(r.med)) continue;
    const ratio = r.med ? me / r.med : null;
    let verdict = 'even';
    if (ratio !== null) {
      if (m.better === 'high') verdict = ratio >= 1.05 ? 'good' : ratio < 0.85 ? 'bad' : ratio < 0.95 ? 'warn' : 'even';
      else verdict = ratio <= 0.9 ? 'good' : ratio > 1.25 ? 'bad' : ratio > 1.1 ? 'warn' : 'even';
    }
    // меньше урона по тебе — не заслуга (может значить, что тебя нет в драках)
    if (m.key === 'dmgTMin' && verdict === 'good') verdict = 'even';
    // для времени предмета сравниваем разницей, а не долей
    if (m.key === 'firstBigT') {
      const dlt = me - r.med;
      verdict = dlt <= -60 ? 'good' : dlt > 180 ? 'bad' : dlt > 90 ? 'warn' : 'even';
    }
    metrics.push({ key: m.key, label: m.label, me, top: r.med, p25: r.p25, p75: r.p75, ratio, verdict, better: m.better, meText: m.fmt(me), topText: m.fmt(r.med) });
  }

  // ---- 2. Что повторяется из игры в игру ----
  const fam = new Map();
  myF.forEach((f, i) => {
    const g = loaded[i];
    const lobby = refAll(g.match.players.filter((p) => p !== g.me && !p.abandoned).map((p) => playerFeatures(p, g.match, assets)));
    for (const t of matchTips({ me: f, ref, lobby, heroName, itemName, won: g.me.won })) {
      if (!fam.has(t.family)) fam.set(t.family, { family: t.family, list: [] });
      fam.get(t.family).list.push({ ...t, match_id: g.match.match_id, start: g.match.start_time });
    }
  });
  const n = myF.length;
  const recurring = [...fam.values()]
    .map((x) => {
      const neg = x.list.filter((t) => t.level === 'bad' || t.level === 'warn');
      const pos = x.list.filter((t) => t.level === 'good');
      return { ...x, neg, pos };
    });
  const weaknesses = recurring
    .filter((x) => x.neg.length >= Math.max(2, Math.ceil(n * 0.25)))
    .map((x) => {
      const latest = x.neg.slice().sort((a, b) => b.start - a.start)[0];
      const bad = x.neg.filter((t) => t.level === 'bad').length;
      return {
        family: x.family,
        area: latest.area,
        level: bad >= x.neg.length / 2 ? 'bad' : 'warn',
        count: x.neg.length,
        of: n,
        share: x.neg.length / n,
        title: latest.title,
        text: latest.text,
        tip: latest.tip,
        matches: x.neg.map((t) => t.match_id),
        score: (x.neg.length / n) * 100 + (bad ? 15 : 0) + (latest.score || 0) / 5,
      };
    })
    .sort((a, b) => b.score - a.score);
  const strengthsTips = recurring
    .filter((x) => x.pos.length >= Math.max(2, Math.ceil(n * 0.3)))
    .map((x) => {
      const latest = x.pos.slice().sort((a, b) => b.start - a.start)[0];
      return { family: x.family, count: x.pos.length, of: n, title: latest.title, text: latest.text, area: latest.area };
    })
    .sort((a, b) => b.count - a.count);

  // сильные стороны по цифрам
  const goodMetrics = metrics.filter((m) => m.verdict === 'good');
  const strengths = goodMetrics.map((m) => ({
    title: m.label,
    text: m.key === 'firstBigT'
      ? `Первый дорогой предмет в среднем на ${T(m.me)}, у топов — ${T(m.top)}.`
      : `У тебя ${m.meText}, у топов на ${heroName(heroId)} — ${m.topText}.`,
  })).concat(strengthsTips.filter((s) => !goodMetrics.length || !/точность|урон|души/i.test(s.title)).map((s) => ({ title: s.title, text: `${s.text} Так было в ${s.count} из ${s.of} игр.` })));

  // ---- 3. Души по фазам против топов ----
  const benchStats = bench.map((b) => b.player.stats).filter((s) => s && s.length >= 3);
  const perPhase = PHASES.map(() => []);
  for (const g of loaded) {
    const st = g.me.stats;
    if (!st || st.length < 3) continue;
    const endMin = Math.floor(st[st.length - 1].t / 60);
    PHASES.forEach((ph, i) => {
      const to = Math.min(ph.to, endMin);
      if (to - ph.from < 4) return;
      perPhase[i].push(phaseSources(st, benchStats, ph.from, to, { perTen: true }));
    });
  }
  const sources = PHASES.map((ph, i) => {
    const rows = averageRows(perPhase[i]);
    if (!rows || !benchStats.length) return { key: ph.key, name: ph.name, from: ph.from, to: ph.to, games: 0, rows: null };
    return { key: ph.key, name: ph.name, from: ph.from, to: ph.to, games: perPhase[i].length, rows, ...summarizePhase(rows, ph.key) };
  });

  // ---- 4. Предметы: твои тайминги против основной сборки топов ----
  let items = [];
  let variantLabel = null;
  if (bench.length >= 6) {
    const records = bench.map((b) => ({ items: b.player.items, won: b.player.won, account_id: b.player.account_id }));
    const clusters = clusterBuilds(records, assets);
    const votes = new Map();
    for (const g of loaded) {
      const c = closestVariant(clusters, g.me, assets);
      const idx = c ? c.index : 0;
      votes.set(idx, (votes.get(idx) || 0) + 1);
    }
    const vIdx = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    const v = clusters.variants[vIdx ? vIdx[0] : 0];
    variantLabel = v ? v.style.name : null;
    if (v) {
      const mine = loaded.map((g) => firstPurchases(g.me, assets));
      items = v.build.core.map((it) => {
        const ts = mine.map((m) => (m.has(it.id) ? m.get(it.id) : null)).filter((t) => t !== null);
        const myT = ts.length ? median(ts) : null;
        return { id: it.id, name: itemName(it.id), topT: it.medianT, topPick: it.pick, myT, myShare: mine.length ? ts.length / mine.length : 0, delay: myT !== null ? myT - it.medianT : null };
      });
    }
  }

  // ---- 5. Короткий вывод ----
  const s = [];
  s.push(`${games.length} ${plural(games.length, 'игра', 'игры', 'игр')}, ${wins}–${decided.length - wins}${decided.length ? ` (${P(wins / decided.length)} побед)` : ''}.`);
  if (strengths.length) s.push(`Лучше всего получается: ${strengths.slice(0, 2).map((x) => x.title.toLowerCase()).join(' и ')}.`);
  if (weaknesses.length) {
    const w = weaknesses[0];
    s.push(`Главное, что повторяется: «${w.title.toLowerCase()}» — в ${w.count} из ${w.of} ${plural(w.of, 'игры', 'игр', 'игр')}.`);
  }
  const worstM = metrics.filter((m) => m.verdict === 'bad').sort((a, b) => Math.abs(1 - b.ratio) - Math.abs(1 - a.ratio))[0];
  if (worstM) s.push(`Самое большое отставание от топов: ${worstM.label.toLowerCase()} (${worstM.meText} против ${worstM.topText}).`);
  if (!bench.length) s.push('Игр топов на этом герое пока нет — обнови мету, чтобы было с чем сравнивать.');

  return {
    heroId,
    games: games.length,
    loaded: loaded.length,
    wins,
    losses: decided.length - wins,
    wr: decided.length ? wins / decided.length : null,
    ci_lo: ci.lo,
    ci_hi: ci.hi,
    kda: games.length ? games.reduce((x, g) => x + g.k + g.a, 0) / Math.max(1, games.reduce((x, g) => x + g.d, 0)) : null,
    benchN: bench.length,
    metrics,
    strengths: strengths.slice(0, 5),
    weaknesses: weaknesses.slice(0, 6),
    sources,
    items,
    variantLabel,
    summary: s.join(' '),
    list: games,
  };
}

module.exports = { heroReport, HERO_METRICS: METRICS };
