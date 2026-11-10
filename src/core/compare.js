'use strict';
// Режим 2: тренировочный лагерь. Сравнивает твою игру с топ-игроками
// на том же герое: сначала находит, какую СБОРКУ ты играл, и сравнивает
// с топами, которые играли похожую сборку. Потом — по фазам игры, по минутам,
// по источникам душ, по предметам и паверспайкам. Выводы — простыми словами.

const { median, quantile } = require('./stats');
const { valueAt, lastMinute, SOURCE_FIELDS } = require('./timeline');
const { firstPurchases } = require('./meta');
const { clusterBuilds, closestVariant } = require('./variants');
const { findSpikes, aroundPurchase } = require('./spikes');
const { phaseSources, summarizePhase, SOURCES } = require('./sources');
const { playerFeatures, refAll } = require('./features');
const { matchTips } = require('./tipsMatch');

const CURVE_FIELDS = ['nw', 'pdmg', 'farm', 'd', 'ka', 'lvl', 'g_lost', ...SOURCE_FIELDS];
const CHECKPOINTS = [5, 10, 15, 20, 25, 30, 35, 40, 45];
const SOURCE_NAMES = {
  g_lane: 'крипы на линии',
  g_neutral: 'лесные крипы',
  g_player: 'убийства героев',
  g_boss: 'боссы и стражи',
  g_treasure: 'урна душ (всей команде)',
  g_brk: 'коробки',
};
const PHASES = [
  { key: 'lane', name: 'Линия', from: 0, to: 10 },
  { key: 'mid', name: 'Середина игры', from: 10, to: 20 },
  { key: 'late', name: 'Поздняя игра', from: 20, to: 60 },
];

function fmtTime(sec) {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtNum(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString('ru-RU');
}

function pct(v) {
  const n = Math.round(v * 100);
  return n < 0 ? `−${-n}%` : `${n}%`;
}

function plural(n, one, few, many) {
  const a = Math.abs(Math.round(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

// Игроки для сравнения: все записи нужного героя из сохранённых матчей.
// accounts — набор аккаунтов (топ-50 или один игрок); null = все игроки в этих матчах.
function benchmarkPlayers({ matches, heroId, accounts = null, winsOnly = false, excludeMatchId = null, excludeAccount = null }) {
  const out = [];
  for (const m of matches) {
    if (m.match_id === excludeMatchId) continue;
    for (const p of m.players) {
      if (p.hero_id !== heroId) continue;
      if (accounts && !accounts.has(p.account_id)) continue;
      if (excludeAccount && p.account_id === excludeAccount) continue;
      if (winsOnly && !p.won) continue;
      if (!p.stats || p.stats.length < 3) continue;
      if (p.abandoned) continue;
      out.push({ match_id: m.match_id, duration_s: m.duration_s, start_time: m.start_time, player: p, match: m });
    }
  }
  return out;
}

function curve(meStats, bench, field, maxMinute) {
  const minN = Math.min(3, bench.length);
  const res = { me: [], med: [], p25: [], p75: [], n: [] };
  for (let m = 0; m <= maxMinute; m++) {
    const t = m * 60;
    res.me.push(valueAt(meStats, field, t));
    const vals = [];
    for (const b of bench) {
      const v = valueAt(b.player.stats, field, t);
      if (v !== null) vals.push(v);
    }
    res.n.push(vals.length);
    if (vals.length >= minN && vals.length > 0) {
      res.med.push(median(vals));
      res.p25.push(quantile(vals, 0.25));
      res.p75.push(quantile(vals, 0.75));
    } else {
      res.med.push(null);
      res.p25.push(null);
      res.p75.push(null);
    }
  }
  return res;
}

function level(ratio, good, warn) {
  if (ratio === null || !Number.isFinite(ratio)) return 'none';
  if (ratio >= good) return 'good';
  if (ratio >= warn) return 'warn';
  return 'bad';
}

const worse = (a, b) => (['bad', 'warn', 'good', 'none'].indexOf(a) <= ['bad', 'warn', 'good', 'none'].indexOf(b) ? a : b);

// Разница по фазе: сколько набрал за отрезок ты и топы.
function phaseStats(curves, from, to) {
  const d = (field, who) => {
    const arr = curves[field][who];
    if (arr[to] === null || arr[to] === undefined || arr[from] === null || arr[from] === undefined) return null;
    return arr[to] - arr[from];
  };
  const out = {};
  for (const f of ['nw', 'pdmg', 'd', 'ka', 'farm']) out[f] = { me: d(f, 'me'), top: d(f, 'med') };
  return out;
}

function phaseVerdict(ps) {
  const notes = [];
  let lvl = 'good';
  const soulsR = ps.nw.top ? ps.nw.me / ps.nw.top : null;
  const dmgR = ps.pdmg.top ? ps.pdmg.me / ps.pdmg.top : null;
  const dDiff = ps.d.me !== null && ps.d.top !== null ? ps.d.me - ps.d.top : null;
  if (soulsR !== null) {
    const l = level(soulsR, 0.92, 0.8);
    lvl = worse(lvl, l);
    if (l !== 'good') notes.push(`мало душ (${pct(soulsR - 1)})`);
  }
  if (dmgR !== null) {
    const l = level(dmgR, 0.88, 0.7);
    lvl = worse(lvl, l);
    if (l !== 'good') notes.push(`мало урона по героям (${pct(dmgR - 1)})`);
  }
  if (dDiff !== null && dDiff >= 1) {
    lvl = worse(lvl, dDiff >= 2 ? 'bad' : 'warn');
    notes.push(`лишние смерти (+${Math.round(dDiff)})`);
  }
  return { level: lvl, soulsR, dmgR, dDiff, notes };
}

function analyze({ me, myMatch, bench, assets = null, nameOf = (id) => `#${id}` }) {
  const myLast = Math.min(lastMinute(me.stats), 60);
  const maxMinute = Math.max(1, myLast);
  const insights = [];
  const benchN = bench.length;
  if (!benchN) {
    const curves = {};
    for (const f of CURVE_FIELDS) curves[f] = curve(me.stats, [], f, maxMinute);
    return { benchN, maxMinute, curves, checkpoints: [], phases: [], items: [], spikes: [], sources: null, sourcePhases: [], insights, priorities: [], scores: {}, variants: [], variant: null };
  }

  // ---------- 1. Какую сборку ты играл ----------
  const records = bench.map((b) => ({ items: b.player.items, won: b.player.won, account_id: b.player.account_id, _b: b }));
  const clusters = clusterBuilds(records, assets);
  const closest = closestVariant(clusters, me, assets);
  const vIdx = closest ? closest.index : 0;
  const variant = clusters.variants[vIdx];
  const variantBench = variant.recs.map((r) => r._b);
  // Кривые фарма/урона сравниваем с той же сборкой, если игр хватает, иначе со всеми.
  const curveBench = variantBench.length >= 8 ? variantBench : bench;
  const variantsOut = clusters.variants.map((v, i) => ({
    index: i,
    label: `Вариант ${i + 1}: ${v.style.name}`,
    style: v.style.key,
    games: v.games,
    wins: v.wins,
    winrate: v.winrate,
    ci_lo: v.ci_lo,
    ci_hi: v.ci_hi,
    share: v.share,
    signature: v.signature,
    core: v.build.core.map((it) => ({ id: it.id, pick: it.pick, medianT: it.medianT })),
  }));
  const variantInfo = {
    index: vIdx,
    label: variantsOut[vIdx].label,
    similarity: closest ? closest.similarity : null,
    haveCore: closest ? closest.haveCore : null,
    coreSize: closest ? closest.coreSize : null,
    games: variant.games,
    curveGames: curveBench.length,
    curveScope: curveBench === variantBench ? 'variant' : 'all',
  };

  const curves = {};
  for (const f of CURVE_FIELDS) curves[f] = curve(me.stats, curveBench, f, maxMinute);

  // ---------- 2. Контрольные точки ----------
  const cps = [];
  for (const m of CHECKPOINTS) {
    if (m > myLast) break;
    if (curves.nw.med[m] === null) continue;
    const row = { minute: m, me: {}, top: {} };
    for (const f of ['nw', 'pdmg', 'farm', 'd', 'ka']) {
      row.me[f] = curves[f].me[m];
      row.top[f] = curves[f].med[m];
    }
    row.nwRatio = row.top.nw ? row.me.nw / row.top.nw : null;
    row.dmgRatio = row.top.pdmg ? row.me.pdmg / row.top.pdmg : null;
    cps.push(row);
  }
  const cpAt = (minute) => cps.filter((c) => c.minute <= minute).pop() || null;

  // ---------- 3. Фазы игры ----------
  const lastWithTop = (() => {
    for (let m = maxMinute; m >= 0; m--) if (curves.nw.med[m] !== null && curves.nw.me[m] !== null) return m;
    return 0;
  })();
  const phases = [];
  for (const ph of PHASES) {
    const to = Math.min(ph.to, lastWithTop);
    if (to - ph.from < 3) continue;
    const ps = phaseStats(curves, ph.from, to);
    const v = phaseVerdict(ps);
    phases.push({ ...ph, to, stats: ps, ...v });
  }
  for (const ph of phases) {
    if (ph.level === 'good') continue;
    insights.push({
      kind: 'phase',
      level: ph.level,
      area: ph.name,
      title: `${ph.name}: ${ph.notes.join(', ')}`,
      text: `С ${ph.from}:00 до ${ph.to}:00 ты набрал ${fmtNum(ph.stats.nw.me)} душ (топы — ${fmtNum(ph.stats.nw.top)}), нанёс ${fmtNum(ph.stats.pdmg.me)} урона по героям (топы — ${fmtNum(ph.stats.pdmg.top)}), умер ${fmtNum(ph.stats.d.me)} ${plural(ph.stats.d.me, 'раз', 'раза', 'раз')} (топы — ${ph.stats.d.top !== null ? Math.round(ph.stats.d.top * 10) / 10 : '—'}).`,
      tip:
        ph.key === 'lane'
          ? 'На линии главное — добивать крипов, забирать сферы душ и не умирать. Не уходи с линии без причины.'
          : ph.key === 'mid'
            ? 'В середине игры фарми лес между волнами, держись рядом с командой на драках и забирай стражей.'
            : 'В поздней игре важнее всего не умирать в одиночку и драться вместе с командой у объектов.',
    });
  }

  // ---------- 4а. Источники душ по каждой фазе ----------
  const benchStats = curveBench.map((b) => b.player.stats);
  const sourcePhases = [];
  for (const ph of phases) {
    const rows = phaseSources(me.stats, benchStats, ph.from, ph.to);
    sourcePhases.push({ key: ph.key, name: ph.name, from: ph.from, to: ph.to, rows, ...summarizePhase(rows, ph.key) });
  }
  const allGaps = sourcePhases.flatMap((p) => p.gaps.map((g) => ({ ...g, phase: p }))).sort((a, b) => b.loss - a.loss);
  for (const g of allGaps.slice(0, 2)) {
    const row = g.phase.rows.find((r) => r.field === g.field);
    insights.push({
      level: g.loss > 800 ? 'bad' : 'warn',
      area: 'Фарм',
      title: g.field === 'g_lost' ? `${g.phase.name}: много душ потеряно при смертях` : `${g.phase.name}: недобор душ — ${(SOURCES.find((x) => x.field === g.field) || g).short.toLowerCase()}`,
      text: g.field === 'g_lost'
        ? `С ${g.phase.from}:00 до ${g.phase.to}:00 ты потерял при смертях ${fmtNum(row.me)} душ, топы — ${fmtNum(row.ref)}.`
        : `С ${g.phase.from}:00 до ${g.phase.to}:00 с источника «${(SOURCES.find((x) => x.field === g.field) || g).short.toLowerCase()}» у тебя ${fmtNum(row.me)} душ, у топов ${fmtNum(row.ref)} (−${fmtNum(g.loss)}).`,
      tip: g.tip,
    });
  }

  // ---------- 4б. Откуда недобор душ (на худшей контрольной точке) ----------
  let sources = null;
  const farmCp = cpAt(15) || cps[cps.length - 1] || null;
  const worst = cps.filter((c) => c.minute >= 8).sort((a, b) => (a.nwRatio ?? 9) - (b.nwRatio ?? 9))[0] || farmCp;
  if (worst) {
    const m = worst.minute;
    const rows = SOURCE_FIELDS.map((f) => ({ field: f, name: SOURCE_NAMES[f], me: curves[f].me[m], top: curves[f].med[m] })).map((r) => ({
      ...r,
      diff: r.me !== null && r.top !== null ? r.me - r.top : null,
    }));
    sources = { minute: m, rows };
    const losses = rows.filter((r) => r.field !== 'g_treasure' && r.diff !== null && r.diff < -250).sort((a, b) => a.diff - b.diff);
    if (!allGaps.length && losses.length && (worst.nwRatio ?? 1) < 0.95) {
      const l = losses[0];
      const tips = {
        g_neutral: 'Заходи в лес между волнами крипов, когда линия запушена.',
        g_lane: 'Добивай крипов на линии и забирай сферы душ — это основной доход в начале.',
        g_player: 'Ты реже участвуешь в убийствах — держись ближе к команде на драках.',
        g_boss: 'Топы чаще забирают стражей и боссов — следи за ними.',
        g_treasure: 'Урна душ даёт души всей команде: неси её сам или прикрывай того, кто несёт.',
        g_brk: 'Разбивай коробки по пути — мелочь, но копится.',
      };
      insights.push({
        level: 'warn',
        area: 'Фарм',
        title: `Недобор душ: ${l.name}`,
        text: `Больше всего недобираешь с источника «${l.name}»: к ${m}:00 у тебя ${fmtNum(l.me)}, у топов ${fmtNum(l.top)} (−${fmtNum(-l.diff)}).`,
        tip: tips[l.field],
      });
    }
  }

  // Урон: стреляешь плохо или просто мало фарма?
  const fightCp = cpAt(20) || cps[cps.length - 1] || null;
  if (fightCp && fightCp.dmgRatio !== null && fightCp.dmgRatio < 0.8) {
    const myEff = fightCp.me.nw ? fightCp.me.pdmg / fightCp.me.nw : null;
    const topEff = fightCp.top.nw ? fightCp.top.pdmg / fightCp.top.nw : null;
    if (myEff !== null && topEff !== null) {
      const farmProblem = myEff >= topEff * 0.9;
      insights.push({
        level: 'info',
        area: 'Урон',
        title: farmProblem ? 'Урона мало из-за фарма' : 'Урона мало даже с учётом фарма',
        text: `На каждые 1000 душ у тебя ${fmtNum(myEff * 1000)} урона по героям, у топов ${fmtNum(topEff * 1000)}.`,
        tip: farmProblem ? 'Стреляешь нормально — подтяни фарм, и урон вырастет сам.' : 'Чаще ищи драки и стреляй по героям, а не только по крипам. Проверь, что ключевые предметы на урон куплены вовремя.',
      });
    }
  }

  // ---------- 5. Предметы (сравнение с ТВОЕЙ сборкой) ----------
  const build = variant.build;
  const mine = firstPurchases(me, assets);
  const myEnd = myMatch ? myMatch.duration_s : me.stats.length ? me.stats[me.stats.length - 1].t : 0;
  const items = build.core.map((it) => {
    const myT = mine.has(it.id) ? mine.get(it.id) : null;
    let status = 'ok';
    let delay = null;
    if (myT === null) status = myEnd > it.medianT + 180 ? 'missing' : 'na';
    else {
      delay = myT - it.medianT;
      if (delay > 120) status = 'late';
      else if (delay < -120) status = 'early';
    }
    return { id: it.id, topPick: it.pick, topT: it.medianT, myT, delay, status };
  });
  const late = items.filter((i) => i.status === 'late').sort((a, b) => b.delay - a.delay);
  for (const it of late.slice(0, 3)) {
    insights.push({
      level: it.delay > 300 ? 'bad' : 'warn',
      area: 'Предметы',
      title: `Поздно «${nameOf(it.id)}» (+${fmtTime(it.delay)})`,
      text: `В твоей сборке топы берут «${nameOf(it.id)}» около ${fmtTime(it.topT)}, ты — на ${fmtTime(it.myT)}.`,
      tip: 'Предмет опаздывает обычно из-за нехватки душ или лишних покупок до него. Посмотри, что ты брал раньше.',
    });
  }
  const missing = items.filter((i) => i.status === 'missing' && i.topPick >= 0.6).sort((a, b) => b.topPick - a.topPick);
  for (const it of missing.slice(0, 2)) {
    insights.push({
      level: 'warn',
      area: 'Предметы',
      title: `Не куплен «${nameOf(it.id)}»`,
      text: `Топы, которые играют такую же сборку, берут «${nameOf(it.id)}» в ${pct(it.topPick)} игр (около ${fmtTime(it.topT)}).`,
      tip: 'Это один из основных предметов этой сборки — попробуй включить его.',
    });
  }
  const onTime = items.filter((i) => i.status === 'ok' || i.status === 'early').length;
  if (items.length >= 3 && onTime / items.length >= 0.7) {
    insights.push({ level: 'good', area: 'Предметы', title: 'Предметы вовремя', text: `Основные предметы сборки собираешь в тайминг топов: ${onTime} из ${items.length}.` });
  }
  const variantItemIds = new Set(build.items.filter((i) => i.pick >= 0.15).map((i) => i.id));
  const extras = [...mine.entries()].filter(([id]) => !variantItemIds.has(id)).sort((a, b) => a[1] - b[1]).map(([id, t]) => ({ id, myT: t }));

  // ---------- 6. Паверспайки ----------
  const spikeBench = variantBench.length >= 5 ? variantBench : bench;
  const spikes = findSpikes(spikeBench, build.core).map((s) => {
    const myT = mine.has(s.id) ? mine.get(s.id) : null;
    const my = aroundPurchase(me.stats, myT);
    let verdict;
    if (myT === null) verdict = { level: 'warn', text: 'У тебя этого предмета не было — ты пропустил момент силы.' };
    else if (myT - s.topT > 150) verdict = { level: 'warn', text: `Купил на ${fmtTime(myT - s.topT)} позже топов — момент силы наступил поздно.` };
    else if (my && my.lift !== null && my.lift < 1.05 && !my.fought) verdict = { level: 'warn', text: 'После покупки урон почти не вырос и драк не было — ты не использовал момент.' };
    else if (my) verdict = { level: 'good', text: 'Ты использовал этот момент — урон после покупки вырос.' };
    else verdict = { level: 'info', text: 'Недостаточно данных о твоём уроне вокруг покупки.' };
    return { ...s, myT, my, verdict };
  });
  for (const s of spikes) {
    if (s.verdict.level !== 'warn') continue;
    insights.push({
      level: 'warn',
      area: 'Паверспайк',
      title: `Паверспайк «${nameOf(s.id)}»`,
      text: `После «${nameOf(s.id)}» топы идут драться: урон по героям ${fmtNum(s.rateBefore)} → ${fmtNum(s.rateAfter)} в минуту. ${s.verdict.text}`,
      tip: 'Сразу после покупки этого предмета ищи драку или иди давить линию вместе с командой.',
    });
  }

  // ---------- 6б. Библиотека советов по ситуации ----------
  let features = null;
  if (myMatch) {
    try {
      const meF = playerFeatures(me, myMatch, assets);
      const refF = refAll(curveBench.filter((b) => b.match).map((b) => playerFeatures(b.player, b.match, assets)));
      const lobbyF = refAll(myMatch.players.filter((p) => p !== me && !p.abandoned).map((p) => playerFeatures(p, myMatch, assets)));
      const heroName = (id) => (assets && assets.heroes && assets.heroes[id] ? assets.heroes[id].name : `герой ${id}`);
      for (const t of matchTips({ me: meF, ref: refF, lobby: lobbyF, heroName, itemName: nameOf, won: me.won })) insights.push(t);
      features = meF;
    } catch (e) {
      // без советов разбор всё равно покажем
    }
  }

  // ---------- 7. Итоговые оценки ----------
  const surviveCp = cpAt(20) || cps[cps.length - 1] || null;
  const delays = items.filter((i) => i.delay !== null).map((i) => i.delay);
  const avgDelay = delays.length ? delays.reduce((s, v) => s + v, 0) / delays.length : null;
  const scores = {
    farm: { level: level(farmCp && farmCp.nwRatio, 0.95, 0.8), value: farmCp && farmCp.nwRatio, minute: farmCp && farmCp.minute },
    fight: { level: level(fightCp && fightCp.dmgRatio, 0.95, 0.75), value: fightCp && fightCp.dmgRatio, minute: fightCp && fightCp.minute },
    survive: {
      level: surviveCp && surviveCp.top.d !== null ? (surviveCp.me.d - surviveCp.top.d <= 0.5 ? 'good' : surviveCp.me.d - surviveCp.top.d <= 2 ? 'warn' : 'bad') : 'none',
      value: surviveCp ? surviveCp.me.d - surviveCp.top.d : null,
      minute: surviveCp && surviveCp.minute,
    },
    items: { level: avgDelay === null ? 'none' : avgDelay <= 60 ? 'good' : avgDelay <= 180 ? 'warn' : 'bad', value: avgDelay },
  };

  const order = { bad: 0, warn: 1, info: 2, good: 3 };
  const baseScore = { bad: 70, warn: 50, info: 25, good: 10 };
  for (const i of insights) if (i.score === undefined) i.score = baseScore[i.level] || 20;
  // одна тема — один вывод
  const famSeen = new Set();
  insights.sort((a, b) => order[a.level] - order[b.level] || b.score - a.score);
  const deduped = [];
  for (const i of insights) {
    const fam = i.family || `${i.area}:${i.title}`;
    if (famSeen.has(fam)) continue;
    famSeen.add(fam);
    deduped.push(i);
  }
  insights.length = 0;
  insights.push(...deduped);
  // Главное: самые важные пункты, но разные — не больше одной фазы и одного пункта на тему.
  const priorities = [];
  const usedAreas = new Set();
  let phaseTaken = false;
  for (const i of insights) {
    if (priorities.length >= 3) break;
    if (i.level !== 'bad' && i.level !== 'warn') continue;
    if (i.kind === 'phase') {
      if (phaseTaken || usedAreas.has(i.area)) continue;
      phaseTaken = true;
    } else if (usedAreas.has(i.area)) continue;
    usedAreas.add(i.area);
    priorities.push(i);
  }

  return {
    benchN,
    maxMinute,
    curves,
    checkpoints: cps,
    phases,
    sources,
    sourcePhases,
    items,
    extras,
    spikes,
    insights,
    priorities,
    scores,
    variants: variantsOut,
    variant: variantInfo,
    features,
    build: { core: build.core, openers: build.openers, n: build.n },
  };
}

module.exports = { benchmarkPlayers, analyze, fmtTime, fmtNum, SOURCE_NAMES, CURVE_FIELDS, PHASES };
