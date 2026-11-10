'use strict';
// Запуск: node test/run.js
// Проверяет расчёты на синтетических матчах (без интернета).

const assert = require('assert');
const { extractMatch } = require('../src/core/extract');
const { valueAt, minuteSeries } = require('../src/core/timeline');
const { buildMeta, heroBuild, collectRecords, isStandardMatch } = require('../src/core/meta');
const { benchmarkPlayers, analyze, fmtTime } = require('../src/core/compare');
const { rankBuilds } = require('../src/core/buildMatch');
const { wilson, median } = require('../src/core/stats');
const { parseOpenIdReturn, steamIdToAccountId, parseSteamInput } = require('../src/main/steamIds');
const { parseReplayUrls } = require('../src/main/steamCacheParse');
const { fakeMatch, SPIKE_ITEM } = require('./fake');

let passed = 0;
const pending = [];
function test(name, fn) {
  const r = fn();
  if (r && typeof r.then === 'function') {
    pending.push(r.then(() => {
      passed += 1;
      console.log('  ok  ' + name);
    }, (e) => {
      console.error('  FAIL ' + name);
      console.error(e);
      process.exit(1);
    }));
    return;
  }
  passed += 1;
  console.log('  ok  ' + name);
}

const now = 1_762_000_000;
const TOP = Array.from({ length: 12 }, (_, i) => 1000 + i);
const slotOf = (id) => (id >= 500 ? 'spirit' : id >= 400 ? 'weapon' : 'vitality');
const assets = {
  items: Object.fromEntries(
    [101, 102, 103, 104, 201, 202, 203, 301, 302, 401, 402, 403, 501, 502, 503].map((id) => [id, { id, name: 'Item' + id, type: 'upgrade', slot: slotOf(id) }]).concat([[9001, { id: 9001, name: 'Ability', type: 'ability' }]])
  ),
};

// 40 матчей топов, сильные игроки
const matches = [];
for (let i = 0; i < 40; i++) {
  matches.push(extractMatch(fakeMatch({ id: 5000 + i, seed: 77 + i, start: now - i * 3600, accounts: TOP, skill: Array(12).fill(1.15) })));
}
// Мой матч: я играю героем 1 (слот 0), навык ниже
const MY = 4242;
const myRaw = fakeMatch({ id: 9999, seed: 3, start: now, accounts: [MY, ...TOP.slice(1)], skill: [0.75] });
const myMatch = extractMatch(myRaw);
const me = myMatch.players.find((p) => p.account_id === MY);

console.log('core:');
test('extract keeps stats and items', () => {
  assert.strictEqual(myMatch.players.length, 12);
  assert.ok(me.stats.length >= 10);
  assert.ok(me.items.length >= 5);
  assert.strictEqual(typeof me.stats[0].g_lane, 'number');
});

test('interpolation is linear and stops after last snapshot', () => {
  const s = [{ t: 60, nw: 100 }, { t: 120, nw: 300 }];
  assert.strictEqual(valueAt(s, 'nw', 90), 200);
  assert.strictEqual(valueAt(s, 'nw', 30), 50);
  assert.strictEqual(valueAt(s, 'nw', 600), null);
  const ser = minuteSeries(s, 'nw', 3);
  assert.deepStrictEqual(ser, [0, 100, 300, null]);
});

test('wilson interval is wide for tiny samples', () => {
  const w = wilson(2, 2);
  assert.ok(w.lo < 0.4 && w.hi === 1);
  assert.strictEqual(median([3, 1, 2]), 2);
});

test('match mode filter', () => {
  assert.ok(isStandardMatch({ game_mode: 1, match_mode: 4 }));
  assert.ok(!isStandardMatch({ game_mode: 1, match_mode: 3 }));
  assert.ok(!isStandardMatch({ game_mode: 1, match_mode: 1 }, { onlyRanked: true }));
});

test('meta: hero table and builds', () => {
  const topList = TOP.map((accountId, i) => ({ rank: i + 1, name: 'P' + i, accountId }));
  const meta = buildMeta({ matches, topList, sinceTs: now - 3 * 86400, onlyRanked: false, assets });
  assert.strictEqual(meta.totalMatches, 40);
  assert.strictEqual(meta.totalRecords, 480);
  assert.ok(meta.heroes.length === 12);
  const sumShare = meta.heroes.reduce((s, h) => s + h.pick_share, 0);
  assert.ok(Math.abs(sumShare - 1) < 1e-9);
  const recs = collectRecords({ matches, topAccounts: new Set(TOP), sinceTs: 0 }).filter((r) => r.hero_id === 1);
  const b = heroBuild(recs, assets);
  assert.ok(b.core.length >= 6, 'core items ' + b.core.length);
  assert.ok(!b.items.some((i) => i.id === 9001), 'abilities filtered out');
  for (let i = 1; i < b.core.length; i++) assert.ok(b.core[i].medianT >= b.core[i - 1].medianT);
  assert.ok(b.phases.early.length && b.phases.mid.length);
});

test('time window excludes old matches', () => {
  const topList = TOP.map((accountId, i) => ({ rank: i + 1, name: 'P' + i, accountId }));
  const meta = buildMeta({ matches, topList, sinceTs: now - 10 * 3600, onlyRanked: false, assets });
  assert.strictEqual(meta.totalMatches, 11);
});

console.log('camp:');
let result;
test('analysis finds farm, damage, item and spike issues', () => {
  const bench = benchmarkPlayers({ matches, heroId: me.hero_id, accounts: new Set(TOP), excludeMatchId: myMatch.match_id });
  assert.ok(bench.length >= 20);
  result = analyze({ me, myMatch, bench, assets, nameOf: (id) => 'Item' + id });
  assert.ok(result.checkpoints.length >= 5);
  const cp10 = result.checkpoints.find((c) => c.minute === 10);
  assert.ok(cp10.nwRatio < 0.85, 'weaker player is behind on souls: ' + cp10.nwRatio);
  const areas = new Set(result.insights.map((i) => i.area));
  assert.ok(areas.has('Линия'), 'lane phase flagged');
  assert.ok(areas.has('Предметы'));
  assert.ok(result.priorities.length >= 1 && result.priorities.length <= 3);
  assert.ok(result.phases.length >= 2);
  assert.ok(result.spikes[0].rateAfter > result.spikes[0].rateBefore, 'spike shows damage before/after');
  assert.ok(result.spikes.length >= 1, 'spike detected');
  assert.strictEqual(result.spikes[0].id, SPIKE_ITEM, 'strongest spike is the synthetic spike item');
  assert.strictEqual(result.scores.farm.level, 'bad');
});

test('equal player is not flagged as behind', () => {
  const eq = extractMatch(fakeMatch({ id: 9998, seed: 5, start: now, accounts: [MY, ...TOP.slice(1)], skill: [1.15] }));
  const pe = eq.players.find((p) => p.account_id === MY);
  const bench = benchmarkPlayers({ matches, heroId: pe.hero_id, accounts: new Set(TOP) });
  const r = analyze({ me: pe, myMatch: eq, bench, assets, nameOf: (id) => 'Item' + id });
  assert.notStrictEqual(r.scores.farm.level, 'bad');
  assert.ok(!r.insights.some((i) => i.level === 'bad' && /души/.test(i.title || '')));
});

test('empty benchmark does not crash', () => {
  const r = analyze({ me, myMatch, bench: [], assets });
  assert.strictEqual(r.benchN, 0);
  assert.strictEqual(r.insights.length, 0);
});

test('fmtTime', () => {
  assert.strictEqual(fmtTime(605), '10:05');
  assert.strictEqual(fmtTime(null), '—');
});

console.log('variants:');
const { clusterBuilds } = require('../src/core/variants');
test('two different builds are split into two variants', () => {
  // герой 1 в слоте 0: в чётных матчах сборка через оружие, в нечётных — через спирит
  const ms = [];
  for (let i = 0; i < 30; i++) ms.push(extractMatch(fakeMatch({ id: 7000 + i, seed: 500 + i, start: now - i * 3000, accounts: TOP, skill: Array(12).fill(1.15), styles: [i % 2 ? 's' : 'w'] })));
  const bench = benchmarkPlayers({ matches: ms, heroId: 1, accounts: new Set(TOP) });
  const cl = clusterBuilds(bench.map((b) => ({ items: b.player.items, won: b.player.won, account_id: b.player.account_id })), assets);
  assert.strictEqual(cl.k, 2, 'k=' + cl.k);
  const styles = cl.variants.map((v) => v.style.key).sort();
  assert.deepStrictEqual(styles, ['spirit', 'weapon']);
  for (const v of cl.variants) assert.ok(v.signature.length >= 2);
  // мой матч — сборка через спирит: не должны ругать за отсутствие оружейных предметов
  const mm = extractMatch(fakeMatch({ id: 9990, seed: 9, start: now, accounts: [MY, ...TOP.slice(1)], skill: [1.1], styles: ['s'] }));
  const pm = mm.players.find((p) => p.account_id === MY);
  const r = analyze({ me: pm, myMatch: mm, bench, assets, nameOf: (id) => 'Item' + id });
  assert.ok(/спирит/.test(r.variant.label), r.variant.label);
  assert.ok(!r.insights.some((i) => /Item40[123]/.test(i.text)), 'no complaints about the other build');
  assert.strictEqual(r.variants.length, 2);
});

test('single build stays one variant', () => {
  const recs = collectRecords({ matches, topAccounts: new Set(TOP), sinceTs: 0 }).filter((r) => r.hero_id === 1);
  const cl = clusterBuilds(recs, assets);
  assert.strictEqual(cl.k, 1);
});

console.log('builds:');
test('rankBuilds prefers the build matching core items', () => {
  const core = [101, 102, 103, 201, 202].map((id, i) => ({ id, pick: 0.9 - i * 0.1 }));
  const raw = [
    { hero_build: { hero_build_id: 1, name: 'Random', details: { mod_categories: [{ name: 'a', mods: [{ ability_id: 555 }, { ability_id: 556 }] }] } }, num_favorites: 9000 },
    { hero_build: { hero_build_id: 2, name: 'Pro path', details: { mod_categories: [{ name: 'early', mods: [{ ability_id: 101 }, { ability_id: 102 }, { ability_id: 103 }] }, { name: 'mid', mods: [{ ability_id: 201 }, { ability_id: 202 }] }] } }, num_favorites: 10 },
    { hero_build_id: 3, name: 'Flat shape', details: { mod_categories: [{ mods: [{ ability_id: 101 }] }] } },
  ];
  const ranked = rankBuilds(raw, core);
  assert.strictEqual(ranked[0].name, 'Pro path');
  assert.ok(ranked[0].score > 0.95);
  assert.strictEqual(ranked[ranked.length - 1].name, 'Random');
});

console.log('steam:');
test('steam ids', () => {
  assert.strictEqual(steamIdToAccountId('76561198000000000'), 39734272);
  assert.deepStrictEqual(parseSteamInput('https://steamcommunity.com/profiles/76561198000000000/'), { accountId: 39734272, steamId64: '76561198000000000' });
  assert.deepStrictEqual(parseSteamInput('39734272'), { accountId: 39734272, steamId64: '76561198000000000' });
  assert.deepStrictEqual(parseSteamInput('[U:1:39734272]'), { accountId: 39734272, steamId64: '76561198000000000' });
  assert.strictEqual(parseSteamInput('hello'), null);
});

test('openid return parsing', () => {
  const url = 'http://localhost:47821/auth?openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&openid.mode=id_res&openid.claimed_id=https%3A%2F%2Fsteamcommunity.com%2Fopenid%2Fid%2F76561198000000000&openid.identity=https%3A%2F%2Fsteamcommunity.com%2Fopenid%2Fid%2F76561198000000000&openid.return_to=http%3A%2F%2Flocalhost%3A47821%2Fauth&openid.sig=abc';
  const r = parseOpenIdReturn(url, 'http://localhost:47821/auth');
  assert.strictEqual(r.steamId64, '76561198000000000');
  assert.strictEqual(r.params['openid.sig'], 'abc');
  assert.throws(() => parseOpenIdReturn(url.replace('id_res', 'cancel'), 'http://localhost:47821/auth'));
  assert.throws(() => parseOpenIdReturn(url, 'http://localhost:9999/auth'));
});

test('replay url parsing from cache bytes', () => {
  const blob = Buffer.concat([
    Buffer.from([0, 1, 2, 3]),
    Buffer.from('http://replay404.valve.net/1422450/37959196_937530290.meta.bz2?v=2'),
    Buffer.from([0]),
    Buffer.from('http://replay183.valve.net/1422450/37959196_1234.dem.bz2'),
    Buffer.from('http://replay1.valve.net/570/1_2.dem.bz2'),
  ]);
  const found = parseReplayUrls(blob.toString('latin1'));
  assert.strictEqual(found.length, 2);
  assert.deepStrictEqual(found[0], { cluster_id: 404, match_id: 37959196, salt: 937530290, kind: 'meta' });
  assert.strictEqual(found[1].kind, 'dem');
});

console.log('discover:');
const { playersFromMatches, mergeCandidates, rankOf } = require('../src/core/discover');
test('fallback: players from high-badge matches, region filter', () => {
  const mk = (id, b0, b1, region, accs) => ({ match_id: id, average_badge_team0: b0, average_badge_team1: b1, region_mode: region, players: accs.map((a, i) => ({ account_id: a, team: i < 6 ? 0 : 1 })) });
  const list = { matches: [mk(1, 116, 115, 1, Array.from({ length: 12 }, (_, i) => 10 + i)), mk(2, 80, 81, 1, Array.from({ length: 12 }, (_, i) => 100 + i)), mk(3, 120, 120, 2, Array.from({ length: 12 }, (_, i) => 200 + i))] };
  const rows = playersFromMatches(list);
  assert.strictEqual(rows.length, 36);
  const { list: merged, regionFiltered } = mergeCandidates(rows, 'Europe');
  assert.ok(regionFiltered);
  assert.strictEqual(merged.length, 24);
  assert.strictEqual(merged[0].matchBadge, 116);
  assert.strictEqual(rankOf({ account_id: 1, badge: 104 }), 104);
  assert.strictEqual(rankOf(null), null);
});


console.log('overview:');
const { buildOverview } = require('../src/core/overview');
const { phaseSources, summarizePhase } = require('../src/core/sources');
test('source phases flag the weak source in the right phase', () => {
  const ref = extractMatch(fakeMatch({ id: 1, seed: 3, start: 1, accounts: Array.from({ length: 12 }, (_, i) => i + 1) })).players;
  const me = JSON.parse(JSON.stringify(ref[0].stats));
  // в середине игры у "меня" вдвое меньше леса
  for (const s of me) if (s.t > 600) s.g_neutral = Math.round(valueAt(ref[0].stats, 'g_neutral', 600) + (s.g_neutral - valueAt(ref[0].stats, 'g_neutral', 600)) * 0.4);
  const rows = phaseSources(me, ref.map((p) => p.stats), 10, 20);
  const sum = summarizePhase(rows, 'mid');
  assert.ok(sum.worst, 'есть главный недобор');
  assert.strictEqual(sum.worst.field, 'g_neutral');
  assert.ok(sum.worst.tip);
  const lane = summarizePhase(phaseSources(me, ref.map((p) => p.stats), 0, 10), 'lane');
  assert.ok(!lane.gaps.some((g) => g.field === 'g_neutral'), 'на линии лес не трогали');
});

test('overview: summary, sessions, compare, tips', () => {
  const ME = 777;
  const now = 2_000_000_000;
  const history = [];
  const matches = new Map();
  for (let i = 0; i < 24; i++) {
    const start = now - 6 * 86400 + i * 2600 + (i % 4 === 0 ? 20000 : 0) * Math.floor(i / 4);
    const accs = [ME, ...Array.from({ length: 11 }, (_, k) => 1000 + i * 20 + k)];
    const raw = fakeMatch({ id: 5000 + i, seed: 40 + i, start, accounts: accs, skill: [0.7] });
    raw.match_info.average_badge_team0 = 54;
    raw.match_info.average_badge_team1 = 55;
    const m = extractMatch(raw);
    if (i % 5 !== 0) matches.set(m.match_id, m);
    const p = m.players[0];
    history.push({ match_id: m.match_id, start_time: start, match_duration_s: m.duration_s, hero_id: p.hero_id, player_team: p.team, match_result: m.winning_team, player_kills: p.k, player_deaths: p.d, player_assists: p.a, net_worth: p.nw, last_hits: p.lh, match_mode: 4 });
  }
  history.push({ match_id: 1, start_time: now - 30 * 86400, match_duration_s: 1800, hero_id: 1, player_team: 0, match_result: 0, player_kills: 1, player_deaths: 1, player_assists: 1, net_worth: 1, last_hits: 1 });
  const o = buildOverview({ history, matches, accountId: ME, days: 7, now });
  assert.strictEqual(o.summary.n, 24);
  assert.ok(o.loaded >= 18 && o.missing >= 4);
  assert.strictEqual(o.form.rolling.length, o.form.results.length);
  assert.ok(o.rank && o.rank.tier === 5, 'ранг из значков');
  const dmg = o.compare.lobby.find((x) => x.key === 'dmgMin');
  assert.ok(dmg.place && !dmg.place.top, 'слабый игрок ниже медианы лобби');
  assert.ok(o.sources.lobby.some((p) => p.rows && p.worst), 'есть недобор душ');
  assert.ok(o.tips.length >= 3);
  assert.ok(o.tips.some((t) => t.area === 'Фарм'));
  assert.strictEqual(o.sessions.buckets.reduce((s, b) => s + b.games, 0), o.summary.wins + o.summary.losses);
  console.log('    советы:', o.tips.map((t) => `${t.area}: ${t.title}`).join(' | '));
});

console.log('tips / hero / map:');
const { playerFeatures, refAll } = require('../src/core/features');
const { matchTips, MATCH_RULES } = require('../src/core/tipsMatch');
const { PERIOD_RULES } = require('../src/core/tipsPeriod');
const { selectTips, plural } = require('../src/core/tipkit');
const { heroReport } = require('../src/core/heroReport');
const { mapData } = require('../src/core/mapdata');
const ACC = Array.from({ length: 12 }, (_, i) => i + 1);
const benchM = Array.from({ length: 14 }, (_, k) => extractMatch(fakeMatch({ id: 700 + k, seed: 900 + k, start: 1, accounts: ACC.map((a) => a + k * 100), skill: Array(12).fill(1.15) })));
const benchP = benchM.map((m) => ({ player: m.players[0], match: m }));
const refF = refAll(benchP.map((b) => playerFeatures(b.player, b.match)));
function tipsFor(skill, seed) {
  const m = extractMatch(fakeMatch({ id: 1, seed, start: 1, accounts: ACC, skill: [skill] }));
  const me = m.players[0];
  const lobby = refAll(m.players.slice(1).map((p) => playerFeatures(p, m)));
  return matchTips({ me: playerFeatures(me, m), ref: refF, lobby, heroName: (id) => `H${id}`, itemName: (id) => `I${id}`, won: me.won });
}
test('tips differ between a weak and a strong game', () => {
  const weak = tipsFor(0.6, 11);
  const strong = tipsFor(1.4, 11);
  assert.ok(weak.filter((t) => t.level === 'bad' || t.level === 'warn').length >= 3, 'слабая игра — есть замечания');
  assert.ok(strong.filter((t) => t.level === 'good').length >= 1, 'сильная игра — есть похвала');
  const ids = new Set(weak.map((t) => t.id));
  assert.ok(!strong.some((t) => (t.level === 'bad') && ids.has(t.id) && t.family === 'lane_cs'), 'у сильной нет тех же ошибок линии');
  const sel = selectTips(weak, { max: 8 });
  assert.strictEqual(new Set(sel.map((t) => t.family)).size, sel.length, 'без повторов темы');
  for (const t of weak.concat(strong)) assert.ok(t.title && t.text && !/undefined|NaN/.test(t.title + t.text + (t.tip || '')), `шаблон без пустот: ${t.id}`);
  console.log('    правил: матч', MATCH_RULES.length, 'период', PERIOD_RULES.length, '| слабая игра:', weak.map((t) => t.id).join(', '));
});
test('russian plurals with fractions', () => {
  assert.strictEqual(plural(1, 'смерть', 'смерти', 'смертей'), 'смерть');
  assert.strictEqual(plural(5, 'смерть', 'смерти', 'смертей'), 'смертей');
  assert.strictEqual(plural(1.5, 'смерть', 'смерти', 'смертей'), 'смерти');
  assert.strictEqual(plural(12, 'игра', 'игры', 'игр'), 'игр');
});
test('hero report: strengths, recurring issues, items', () => {
  const games = Array.from({ length: 8 }, (_, k) => {
    const m = extractMatch(fakeMatch({ id: 800 + k, seed: 300 + k, start: 1000 + k, accounts: [777, ...ACC.slice(1)], skill: [0.7] }));
    return { match_id: m.match_id, won: m.players[0].won, k: 1, d: 5, a: 3, match: m, me: m.players[0] };
  });
  const bench = benchM.map((m) => ({ player: m.players[0], match: m }));
  const r = heroReport({ heroId: games[0].me.hero_id, games, bench, accountId: 777 });
  assert.strictEqual(r.games, 8);
  assert.ok(r.metrics.length >= 8);
  assert.ok(r.weaknesses.length >= 2, 'повторяющиеся проблемы найдены');
  assert.ok(r.weaknesses.every((w) => w.count >= 2 && w.count <= 8));
  assert.ok(r.sources.some((p) => p.rows));
  assert.ok(/повторяется/.test(r.summary));
});
test('map data: deaths with positions and decoded paths', () => {
  const raw = fakeMatch({ id: 5, seed: 5, start: 1, accounts: ACC });
  const m = extractMatch(raw, { paths: true });
  const md = mapData(m);
  assert.ok(md.hasPos);
  assert.ok(md.kills.length > 0 && md.kills.every((k) => k.x !== null && Math.abs(k.x) <= 10000));
  const pts = md.paths.players[1];
  assert.ok(pts.length > 100);
  const [x, y] = pts[100];
  assert.ok(Math.abs(x) <= 10000 && Math.abs(y) <= 10000, 'координаты в пределах мира');
  const noPaths = extractMatch(raw);
  assert.strictEqual(noPaths.paths, null);
  assert.strictEqual(noPaths.players[0].lane, 1);
});

test('steam vanity links are understood', async () => {
  const { vanityOf } = require('../src/main/steamIds');
  assert.strictEqual(vanityOf('https://steamcommunity.com/id/Frolovylka/'), 'Frolovylka');
  assert.strictEqual(vanityOf('steamcommunity.com/id/some_name'), 'some_name');
  assert.strictEqual(vanityOf('76561198012345678'), null);
});

test('sold vs upgraded items', () => {
  const { itemFates } = require('../src/core/meta');
  const assets = { items: {
    1: { id: 1, type: 'upgrade', slot: 'vitality', cost: 800, components: [] },
    2: { id: 2, type: 'upgrade', slot: 'vitality', cost: 3000, components: [1] },
    3: { id: 3, type: 'upgrade', slot: 'weapon', cost: 1600, components: [] },
    4: { id: 4, type: 'upgrade', slot: 'spirit', cost: 800, components: [] },
  } };
  const f = itemFates([[1, 100, 900, 0], [2, 899, 0, 0], [3, 300, 1500, 0], [4, 200, 700, 9]], assets);
  assert.strictEqual(f.find((x) => x.id === 1).fate, 'upgraded');
  assert.strictEqual(f.find((x) => x.id === 1).into, 2);
  assert.strictEqual(f.find((x) => x.id === 2).fate, 'kept');
  assert.strictEqual(f.find((x) => x.id === 3).fate, 'sold');
  assert.strictEqual(f.find((x) => x.id === 4).fate, 'upgraded', 'upgrade_id из API');
  // без данных о компонентах — по слоту и цене
  const noComp = { items: { 1: { id: 1, type: 'upgrade', slot: 'vitality', cost: 800 }, 2: { id: 2, type: 'upgrade', slot: 'vitality', cost: 3000 } } };
  assert.strictEqual(itemFates([[1, 100, 900, 0], [2, 901, 0, 0]], noComp)[0].fate, 'upgraded');
});

console.log('coach / matchups / versus:');
const { updateCoach, checkGame, CATALOG, pickGoals } = require('../src/core/coach');
const { myMatchups, heroVs, prepare, heroOutlook } = require('../src/core/matchups');
const { proCandidates, versus } = require('../src/core/versus');
function coachGames(skill, n, t0, seedBase = 500) {
  return Array.from({ length: n }, (_, i) => {
    const raw = fakeMatch({ id: 9000 + seedBase + i, seed: seedBase + i, start: t0 + i * 3000, accounts: [777, ...ACC.slice(1).map((a) => a + 50 * i)], skill: [skill] });
    const m = extractMatch(raw, { paths: false });
    const me = m.players[0];
    return { match_id: m.match_id, start_time: m.start_time, duration_s: m.duration_s, hero: me.hero_id, won: me.won, k: me.k, d: me.d, a: me.a, nw: me.nw, pos: (i % 4) + 1, afterLoss: false, gapMin: 20, match: m, me, f: playerFeatures(me, m) };
  });
}
test('coach: plan from weaknesses, checks, closing goals', () => {
  const topHero = new Map([[benchM[0].players[0].hero_id, refF]]);
  const t0 = 1_900_000_000;
  const weak = coachGames(0.6, 12, t0);
  const lobby = refAll(weak.flatMap((g) => g.match.players.slice(1).map((p) => playerFeatures(p, g.match))));
  const r1 = updateCoach(null, { games: weak, topHero, lobby, extra: {}, now: t0 + 12 * 3000 + 100 });
  assert.ok(r1.view.plan, 'план создан');
  assert.ok(r1.view.goals.length >= 3 && r1.view.goals.length <= 4, `целей ${r1.view.goals.length}`);
  const fams = r1.view.goals.map((g) => (CATALOG.find((c) => c.key === g.key) || {}).family);
  assert.strictEqual(new Set(fams).size, fams.length, 'нет двух целей про одно и то же');
  const perArea = {};
  for (const g of r1.view.goals) perArea[g.area] = (perArea[g.area] || 0) + 1;
  assert.ok(Object.values(perArea).every((n) => n <= 2), 'не больше двух целей в разделе');
  for (const g of r1.view.goals) assert.ok(!/undefined|NaN/.test(g.title), g.title);
  // затем игрок играет сильно — цели должны закрываться
  const strong = coachGames(1.5, 8, t0 + 12 * 3000 + 600, 800);
  const r2 = updateCoach(r1.state, { games: weak.concat(strong), topHero, lobby, extra: {}, now: t0 + 20 * 3000 + 1000 });
  assert.ok(r2.view.cards.length >= 5 && !r2.view.cards[0].beforePlan, 'карточки после плана');
  assert.ok(r2.view.goals.some((g) => g.status === 'done'), 'хотя бы одна цель выполнена');
  assert.ok(r2.view.events.some((e) => e.kind === 'done'), 'сообщение о выполнении');
  const c = checkGame(strong[0], r1.view.goals);
  assert.ok(c.every((x) => x.pass === null || typeof x.pass === 'boolean'));
  // мало игр — плана нет
  const r0 = updateCoach(null, { games: weak.slice(0, 3), topHero, lobby, extra: {}, now: t0 });
  assert.strictEqual(r0.view.plan, null);
  assert.ok(r0.view.need > 0);
  console.log('    цели:', r1.view.goals.map((g) => g.title).join(' | '));
  // старый план из 2 целей добирается до 3–4
  const oldState = JSON.parse(JSON.stringify(r1.state));
  oldState.plan.goals = oldState.plan.goals.slice(0, 2).map(({ family, kind, ...g }) => g);
  const r3 = updateCoach(oldState, { games: weak, topHero, lobby, extra: {}, now: t0 + 12 * 3000 + 200 });
  assert.ok(r3.view.goals.filter((g) => g.status === 'active').length >= 3, 'план добран');
  // выбор: по одному на раздел, потом второй в раздел, одна семья — одна цель
  const pk = pickGoals([
    { key: 'd10', family: 'deaths', area: 'Выживание', gap: 1 },
    { key: 'd', family: 'deaths', area: 'Выживание', gap: 0.9 },
    { key: 'firstBigT', family: 'spike1', area: 'Паверспайки', gap: 0.8 },
    { key: 'spikeFights', family: 'spikeUse', area: 'Паверспайки', gap: 0.7 },
    { key: 'firstHugeT', family: 'spike2', area: 'Паверспайки', gap: 0.6 },
    { key: 'lh10', family: 'laneFarm', area: 'Фарм', gap: 0.5 },
  ]);
  assert.deepStrictEqual(pk.map((g) => g.key), ['d10', 'firstBigT', 'lh10', 'spikeFights']);
  // признаки паверспайков считаются
  assert.ok(weak.some((g) => g.f.spikeFights !== undefined) && 'spikeDmg' in weak[0].f);
});
test('matchups: my record, tops vs heroes, counters, prepare', () => {
  const games = coachGames(0.9, 10, 1_900_000_000).map((g) => ({ match: g.match, me: g.me }));
  const mine = myMatchups(games);
  assert.ok(mine.all.length >= 5);
  assert.ok(mine.lanes.length >= 1, 'соперники по линии');
  assert.strictEqual(mine.minGames, 3);
  const loose = myMatchups(games.slice(0, 4), { minGames: 2 });
  assert.strictEqual(loose.minGames, 2);
  assert.ok([...loose.worst, ...loose.best].every((x) => x.games >= 2), 'порог встреч для героя');
  const recs = benchM.map((m) => ({ match: m, player: m.players[0] }));
  const vs = heroVs(recs, null, { minGames: 1 });
  assert.ok(vs.rows.length >= 3);
  assert.ok(vs.rows.every((r) => r.wr >= 0 && r.wr <= 1));
  const enemies = vs.rows.slice(0, 3).map((r) => r.hero_id);
  const pr = prepare({ myHero: recs[0].player.hero_id, enemies, laneFoe: enemies[0], topVs: vs, mine, heroName: (x) => `H${x}`, itemName: (x) => `I${x}` });
  assert.strictEqual(pr.rows.length, 3);
  assert.ok(pr.rows[0].isLane);
});
test('hero outlook: good/bad enemies and lane partners', () => {
  // Синтетика: мой герой 1. Против героя 10 почти всегда победы, против 11 — поражения,
  // с напарником 20 на линии побеждаем, с 21 — нет. Остальные соперники — шум.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const st = (nw) => [{ t: 300, nw: nw / 2 }, { t: 600, nw }, { t: 900, nw: nw * 1.5 }];
  const game = (i, opts) => {
    const enemy = [opts.foe, 30 + (i % 4), 34 + (i % 5), 40, 41, 42];
    const mate = opts.mate;
    let won = opts.foe === 10 ? rnd() < 0.85 : opts.foe === 11 ? rnd() < 0.15 : rnd() < 0.5;
    if (mate === 20) won = won || rnd() < 0.6;
    if (mate === 21) won = won && rnd() < 0.3;
    const me = { hero_id: 1, team: 0, won, lane: 1, account_id: 777, stats: st(mate === 20 ? 5200 : 4400) };
    const players = [me, { hero_id: mate, team: 0, won, lane: 1, stats: st(mate === 20 ? 5000 : 4300) },
      ...[50, 51, 52, 53].map((hid) => ({ hero_id: hid, team: 0, won, lane: 2, stats: st(4500) })),
      ...enemy.map((hid, k) => ({ hero_id: hid, team: 1, won: !won, lane: k < 2 ? 1 : 2, stats: st(4600) }))];
    return { match: { match_id: i, players }, player: me };
  };
  const pro = [];
  const mine = [];
  for (let i = 0; i < 60; i++) pro.push({ ...game(i, { foe: [10, 11, 12][i % 3], mate: [20, 21, 22][i % 3 === 0 ? 0 : i % 3] }), w: i % 2 ? 1 : 0.5 });
  for (let i = 0; i < 12; i++) mine.push(game(100 + i, { foe: [10, 11][i % 2], mate: 20 }));
  const o = heroOutlook({ pro, mine });
  assert.ok(o.good.length >= 1 && o.bad.length >= 1);
  assert.strictEqual(o.good[0].hero_id, 10, 'самый удобный — 10');
  assert.strictEqual(o.bad[0].hero_id, 11, 'самый неудобный — 11');
  assert.ok(o.good.length <= 5 && o.bad.length <= 5 && o.mates.length <= 5);
  assert.ok(o.good.every((r) => r.delta > 0) && o.bad.every((r) => r.delta < 0));
  for (let i = 1; i < o.good.length; i++) assert.ok(o.good[i - 1].delta >= o.good[i].delta);
  assert.strictEqual(o.mates[0].hero_id, 20, 'лучший напарник — 20');
  assert.ok(o.mates[0].laneDiff > 0, 'пара с 20 выигрывает линию');
  assert.ok(o.good[0].pro && o.good[0].mine, 'учтены и топы, и мои игры');
  assert.ok(typeof o.vs[10].pro === 'number' && typeof o.vs[10].mine === 'number' && o.vs[10].pro > 0, 'в таблице для пика — топы и твои отдельно');
  // маленькая выборка стягивается к нулю
  const tiny = heroOutlook({ pro: pro.slice(0, 2), mine: [], minEvidence: 1 });
  assert.ok([...tiny.good, ...tiny.bad, ...tiny.mates].every((r) => Math.abs(r.delta) < 0.3));
  console.log('    удобные:', o.good.map((r) => `${r.hero_id}:${Math.round(r.delta * 100)}%`).join(' '), '| неудобные:', o.bad.map((r) => `${r.hero_id}:${Math.round(r.delta * 100)}%`).join(' '), '| напарники:', o.mates.map((r) => `${r.hero_id}:${Math.round(r.delta * 100)}% (${r.laneDiff})`).join(' '));
});
test('skills: order, consensus and build export', () => {
  const { skillOrder, skillConsensus, compareSkills } = require('../src/core/skills');
  const { matchBuild, buildText, buildFile } = require('../src/core/buildExport');
  // герой 1 со способностями 101..104 (104 — ульта), предметы 900/901/902
  const assets = {
    heroes: { 1: { id: 1, name: 'Тест', abilities: [101, 102, 103, 104] } },
    items: {
      101: { id: 101, name: 'Удар', type: 'ability' }, 102: { id: 102, name: 'Рывок', type: 'ability' },
      103: { id: 103, name: 'Щит', type: 'ability' }, 104: { id: 104, name: 'Ульта', type: 'ability' },
      900: { id: 900, name: 'Пули', type: 'upgrade', cost: 500, slot: 'weapon', components: [] },
      901: { id: 901, name: 'Броня', type: 'upgrade', cost: 1250, slot: 'vitality', components: [] },
      902: { id: 902, name: 'Большие пули', type: 'upgrade', cost: 3000, slot: 'weapon', components: [900] },
      555: { id: 555, name: 'Чужая', type: 'ability' },
    },
  };
  const seq = (order) => order.map((id, i) => [id, 60 + i * 90, 0, 0]);
  // путь: 101,102,101,103,101,101(макс 101),104,102,102,102(макс 102)...
  const pathA = [101, 102, 101, 103, 101, 101, 104, 102, 102, 102, 103, 103, 103, 104, 104, 104];
  const pathB = [102, 101, 102, 103, 102, 102, 104, 101, 101, 101, 103, 103, 103, 104, 104, 104];
  const p = { hero_id: 1, account_id: 5, won: true, k: 10, d: 2, a: 8, nw: 40000, items: [...seq(pathA), [555, 30, 0, 0], [900, 100, 700, 902], [901, 500, 0, 0], [902, 700, 0, 0], [101, 2000, 0, 0]] };
  const o = skillOrder(p, assets);
  assert.deepStrictEqual(o.abilities, [101, 102, 103, 104]);
  assert.strictEqual(o.steps.length, 16, 'все 16 очков, лишняя запись не считается');
  assert.ok(o.steps.every((s) => s.level >= 1 && s.level <= 4));
  assert.strictEqual(o.steps[5].level, 4, 'шестой шаг — максимум первой способности');
  assert.ok(!o.steps.some((s) => s.id === 555), 'чужие способности не попадают');
  // консенсус: 6 игр пути A и 3 игры пути B → путь A
  const orders = [...Array(6)].map(() => skillOrder({ hero_id: 1, items: seq(pathA) }, assets)).concat([...Array(3)].map(() => skillOrder({ hero_id: 1, items: seq(pathB) }, assets)));
  const c = skillConsensus(orders);
  assert.strictEqual(c.games, 9);
  assert.deepStrictEqual(c.path.map((x) => x.id), pathA, 'типичный путь = самый частый');
  assert.strictEqual(c.firstMax.id, 101);
  assert.ok(Math.abs(c.firstMax.share - 6 / 9) < 1e-9);
  assert.ok(c.path.every((x) => x.level <= 4));
  const mine = skillConsensus([...Array(3)].map(() => skillOrder({ hero_id: 1, items: seq(pathB) }, assets)), { minFollow: 2 });
  const cmp = compareSkills(mine, c, (id) => assets.items[id].name);
  assert.ok(cmp && !cmp.same && cmp.text.includes('Рывок') && cmp.text.includes('Удар'));
  // выгрузка билда
  const b = matchBuild({ match: { match_id: 77, duration_s: 1900 }, player: p, assets });
  assert.deepStrictEqual(b.stages.map((x) => x.items.map((i) => i.id)), [[900, 901], [902], []]);
  assert.strictEqual(b.buys.find((x) => x.id === 900).fate, 'upgraded', 'пули ушли в улучшение, не продажа');
  assert.deepStrictEqual(b.final.map((x) => x.id), [901, 902]);
  const names = { heroName: (x) => assets.heroes[x].name, itemName: (x) => assets.items[x].name, abilityName: (x) => assets.items[x].name, playerName: 'Игрок' };
  const txt = buildText(b, names);
  assert.ok(txt.includes('Тест — билд Игрок из матча 77') && txt.includes('1 → 2 → 1 → 3') && txt.includes('(→ Большие пули)') && txt.includes('К концу игры'));
  const file = buildFile(b, names);
  assert.strictEqual(file.hero_build.details.mod_categories.length, 2);
  assert.strictEqual(file.hero_build.details.ability_order.length, 16);
  assert.strictEqual(file.hero_build.details.mod_categories[0].mods[0].ability_id, 900);
});

test('pick advice: best pick vs enemies, keep/swap verdict, pool rules', () => {
  const { heroPool, pickAdvice } = require('../src/core/pick');
  const hist = [];
  const push = (hero, n, wins) => { for (let i = 0; i < n; i++) hist.push({ hero_id: hero, won: i < wins, start_time: 1000 + i }); };
  push(1, 30, 18); push(2, 25, 16); push(3, 20, 10); push(4, 6, 2);
  const { pool } = heroPool(hist);
  assert.deepStrictEqual(pool.map((p) => p.hero_id).sort(), [1, 2], 'в пуле только герои с 15+ победами');
  assert.deepStrictEqual(heroPool(hist, { manual: [3, 4] }).pool.map((p) => p.hero_id), [3, 4], 'ручной список');
  const full = heroPool(hist, { minWins: 0 }).pool;
  const tables = {
    1: { vs: { 10: { delta: -0.12, evidence: 20 }, 11: { delta: -0.05, evidence: 10 } } },
    2: { vs: { 10: { delta: 0.08, evidence: 15 }, 11: { delta: 0.02, evidence: 8 } } },
    3: { vs: { 10: { delta: 0.3, evidence: 4 }, 11: { delta: -0.1, evidence: 6 } } }, // выброс ограничивается ±15%
  };
  const a = pickAdvice({ pool: full, tables, enemies: [10, 11], current: 1 });
  assert.strictEqual(a.rows[0].hero_id, 2, 'лучший против состава — герой 2');
  assert.ok(a.verdict && !a.verdict.keep && a.verdict.hero_id === 2 && a.verdict.from === 1);
  assert.ok(Math.abs(a.all.find((r) => r.hero_id === 3).vsScore - 0.05) < 1e-9, 'матчап ограничен 15%');
  assert.ok(a.rows[0].pros.length >= 1 && a.all.find((r) => r.hero_id === 1).cons.length === 2);
  const keep = pickAdvice({ pool: full, tables, enemies: [10, 11], current: 2 });
  assert.ok(keep.verdict.keep, 'уже на лучшем — оставаться');
  const taken = pickAdvice({ pool: full, tables, enemies: [10, 2] });
  assert.ok(!taken.rows.some((r) => r.hero_id === 2), 'занятого героя не советуем');
  assert.ok(taken.all.find((r) => r.hero_id === 4).noTable, 'нет таблицы — помечено');
  // 80% топы, 20% твои игры
  const { mixMatchup, MY_SHARE } = require('../src/core/pick');
  assert.strictEqual(MY_SHARE, 0.2);
  assert.ok(Math.abs(mixMatchup({ pro: 0.1, mine: -0.1 }) - 0.06) < 1e-9, '0.8·0.1 + 0.2·(−0.1)');
  assert.strictEqual(mixMatchup({ pro: 0.05, mine: null }), 0.05, 'нет твоих игр — только топы');
  assert.ok(Math.abs(mixMatchup({ pro: null, mine: 0.1 }) - 0.02) < 1e-9, 'нет игр топов — твоим всё равно 20%');
  assert.strictEqual(mixMatchup(null), null);
  // топы говорят «плохо», ты сам — «хорошо»: решают топы
  const split = {
    1: { vs: { 10: { pro: -0.1, mine: 0.15, evidence: 30 } } },
    2: { vs: { 10: { pro: 0.04, mine: -0.05, evidence: 30 } } },
  };
  const sp = pickAdvice({ pool: full, tables: split, enemies: [10] });
  assert.strictEqual(sp.rows[0].hero_id, 2, 'мета весит больше твоих игр');
});

test('updater: versions, release parsing, check and download', async () => {
  const { Updater, isNewer, pickRelease } = require('../src/main/updater');
  assert.ok(isNewer('0.9.0', '0.8.0') && isNewer('v1.0.0', '0.9.9') && isNewer('0.8.10', '0.8.9'));
  assert.ok(!isNewer('0.8.0', '0.8.0') && !isNewer('0.7.9', '0.8.0') && !isNewer('мусор', '0.8.0'));
  assert.ok(isNewer('1.0.0', '1.0.0-beta.1') && !isNewer('1.0.0-beta.1', '1.0.0'));
  const rel = {
    tag_name: 'v0.9.0', name: 'Deadlock Coach 0.9.0', body: '- Оверлей\n- Фиксы', html_url: 'https://github.com/u/r/releases/tag/v0.9.0',
    assets: [
      { name: 'DeadlockCoach-Portable-0.9.0.exe', browser_download_url: 'https://x/p.exe', size: 5 },
      { name: 'DeadlockCoach-Setup-0.9.0.exe', browser_download_url: 'https://x/s.exe', size: 6 },
    ],
  };
  const pr = pickRelease(rel);
  assert.strictEqual(pr.version, '0.9.0');
  assert.strictEqual(pr.setup.url, 'https://x/s.exe');
  assert.strictEqual(pr.portable.url, 'https://x/p.exe');
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const fakeFetch = async (url) => {
    if (url.includes('api.github.com')) return { ok: true, status: 200, json: async () => rel };
    let sent = false;
    return { ok: true, status: 200, headers: { get: () => '6' }, body: { getReader: () => ({ read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes })) }) } };
  };
  const app = { getVersion: () => '0.8.0', isPackaged: true, quit: () => {} };
  const events = [];
  const u = new Updater({ app, repo: 'u/r', emit: (c, p) => events.push([c, p]), fetchImpl: fakeFetch });
  const c = await u.check();
  assert.ok(c.available && c.configured && c.release.version === '0.9.0' && c.mode === 'installed');
  const d = await u.download();
  assert.strictEqual(d.size, 6);
  assert.deepStrictEqual([...require('fs').readFileSync(d.file)], [1, 2, 3, 4, 5, 6]);
  assert.ok(events.some(([ch, p]) => ch === 'update:progress' && p.pct === 100));
  require('fs').unlinkSync(d.file);
  const none = new Updater({ app: { ...app, getVersion: () => '0.9.0' }, repo: 'u/r', fetchImpl: fakeFetch });
  assert.ok(!(await none.check()).available, 'та же версия — обновления нет');
  const dev = new Updater({ app: { ...app, isPackaged: false }, repo: '', fetchImpl: fakeFetch });
  const dc = await dev.check();
  assert.ok(!dc.configured && dc.mode === 'dev' && dc.reason);
});

test('game build code: encode/decode round trip, ability steps, size', () => {
  const { encodeBuildCode, decodeBuildCode } = require('../src/core/gameCode');
  const build = {
    heroId: 6, name: 'Abrams — Игрок', description: 'Из матча 77',
    categories: [{ name: 'Начало (до 10:00)', items: [{ id: 2789 }, { id: 4072270083, note: 'продан на 25:00' }] }, { name: 'Пусто', items: [] }, { name: 'Поздняя', items: [{ id: 1009965641 }] }],
    abilities: [{ id: 11, level: 1 }, { id: 12, level: 1 }, { id: 11, level: 2 }, { id: 11, level: 3 }, { id: 11, level: 4 }],
  };
  const r = encodeBuildCode(build);
  assert.ok(/^[A-Za-z0-9+/=]+$/.test(r.code) && !r.tooBig);
  assert.ok(Buffer.from(r.code, 'base64').subarray(0, 4).equals(Buffer.from([0x28, 0xb5, 0x2f, 0xfd])), 'кадр Zstandard');
  const b = decodeBuildCode(r.code);
  assert.strictEqual(b.heroId, 6);
  assert.strictEqual(b.name, 'Abrams — Игрок');
  assert.deepStrictEqual(b.categories.map((c) => c.name), ['Начало (до 10:00)', 'Поздняя'], 'пустые стадии не попадают');
  assert.deepStrictEqual(b.categories[0].items, [{ id: 2789, note: '' }, { id: 4072270083, note: 'продан на 25:00' }]);
  assert.deepStrictEqual(b.abilities.map((x) => [x.t, x.d]), [[2, -1], [2, -1], [1, -1], [1, -2], [1, -5]], 'открытие и улучшения 1/2/5 очков');
  const big = encodeBuildCode({ ...build, description: 'x'.repeat(1400), categories: [{ name: 'a', items: [...Array(4000)].map((_, i) => ({ id: 1000 + i })) }] });
  assert.ok(big.tooBig, 'слишком большой билд помечается');
  assert.ok(decodeBuildCode(big.code).categories[0].items.length === 4000, 'длинный кадр тоже читается');
});

test('portraits: slots, own portrait, learned matching, log events', () => {
  const P = require('../src/core/portraits');
  const { parseLines } = require('../src/main/gameWatch');
  const { bgraToRgba } = require('../src/main/recognizer');
  // Нарисованная «верхняя панель» 1280×800: 2 союзника (янтарь) слева, 2 соперника (сапфир) справа.
  const W = 1280, H = 800;
  const data = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = 30; data[i * 4 + 1] = 15; data[i * 4 + 2] = 12; data[i * 4 + 3] = 255; }
  const rect = (x0, y0, x1, y1, f) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const c = f(x, y); const i = (y * W + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; } };
  const AMBER = [212, 135, 12], SAPH = [78, 118, 196];
  const centers = [{ cx: 467, t: AMBER }, { cx: 532, t: AMBER, own: true }, { cx: 748, t: SAPH }, { cx: 813, t: SAPH }];
  const pattern = (k) => (x, y) => [(x * (k + 3) + y * 7) % 200 + 30, (y * (k + 5)) % 180 + 40, ((x + y) * (k + 2)) % 160 + 50];
  centers.forEach((c, k) => {
    rect(Math.round(c.cx - 12), 72, Math.round(c.cx + 13), 89, () => c.t); // плашка душ
    rect(Math.round(c.cx - 28), 0, Math.round(c.cx + 28), 70, pattern(k)); // портрет
    if (c.own) rect(Math.round(c.cx + 7), 1, Math.round(c.cx + 27), 8, () => c.t); // квадратная подложка своего
  });
  const img = { w: W, h: H, data };
  const slots = P.findSlots(img);
  assert.strictEqual(slots.length, 4, 'найдены все 4 портрета');
  assert.deepStrictEqual(slots.map((s) => s.team), ['amber', 'amber', 'sapphire', 'sapphire']);
  assert.deepStrictEqual(slots.map((s) => P.isOwnSlot(img, s)), [false, true, false, false], 'свой портрет по квадратной подложке');
  const feats = slots.map((s) => P.slotFeature(img, s));
  const heroes = [10, 11, 12, 13].map((id, k) => ({ id, learned: [feats[k]] }));
  const res = P.assignHeroes(feats, heroes);
  assert.deepStrictEqual(res.map((r) => r.id), [10, 11, 12, 13]);
  assert.ok(res.every(P.confident));
  // неизвестный герой: образцов нет → не уверены
  const res2 = P.assignHeroes(feats, [{ id: 10, learned: [feats[0]] }, { id: 99, learned: [] }]);
  assert.ok(P.confident(res2[0]) && !res2.slice(1).some((r) => r && P.confident(r)));
  // строки настоящего лога Deadlock
  const st = { matchId: null, phase: null };
  const ev = parseLines([
    '11/09 23:23:51 OnGameStateChanged: MatchIntro (4)', // песочница — без матча
    '11/09 23:23:51 OnGameStateChanged: GameInProgress (7)',
    '11/09 23:25:41 Lobby 174217834820289999 for Match 134512045 created',
    '11/09 23:25:42 [Citadel Play Controller] CCitadel_PlayController::OnMatchFormed',
    '11/09 23:25:45 OnGameStateChanged: WaitingForPlayersToJoin (2)',
    '11/09 23:26:06 OnGameStateChanged: WaitForMapToLoad (5)',
    '11/09 23:26:06 OnGameStateChanged: PreGameWait (6)',
    '11/09 23:26:36 OnGameStateChanged: GameInProgress (7)',
    '11/09 23:58:00 Loading map "dl_hideout"',
  ], st);
  assert.deepStrictEqual(ev.map((e) => e.type), ['match', 'pregame', 'started', 'left']);
  assert.ok(ev.every((e) => e.matchId === 134512045));
  // BGRA → RGBA с отменой предумножения
  const px = bgraToRgba(Buffer.from([10, 20, 128, 128, 1, 2, 3, 255]), { unpremultiply: true });
  assert.deepStrictEqual([...px], [255, 40, 20, 128, 3, 2, 1, 255]);
});

test('game mode: process detection, log activity, background sync waits', async () => {
  const { GameMode, hasProcess } = require('../src/main/gameMode');
  assert.ok(hasProcess('"deadlock.exe","14320","Console","1","2 104 532 K"\r\n'));
  assert.ok(hasProcess('"Deadlock.exe","1","Console","1","1 K"'));
  assert.ok(!hasProcess('INFO: No tasks are running which match the specified criteria.'));
  assert.ok(!hasProcess('"deadlock-coach.exe","1","Console","1","1 K"'));
  let running = true;
  let logAt = 0;
  const gm = new GameMode({ check: async () => running, logActiveAt: () => logAt });
  const seen = [];
  gm.on('change', (a) => seen.push(a));
  await gm.tick();
  running = false;
  logAt = Date.now() - 5000; // лог свежий — игра ещё идёт
  await gm.tick();
  logAt = 0;
  await gm.tick();
  assert.deepStrictEqual(seen, [true, false]);
  // фоновое обновление ждёт, по кнопке — нет
  const { Sync } = require('../src/main/sync');
  const fakeStore = { read: (_k, d) => d };
  const sy = new Sync({ api: {}, store: fakeStore, emit: () => {} });
  let hold = true;
  sy.holdIf = () => hold;
  sy.holdPollMs = 10;
  sy.background = false;
  await sy.yieldToGame(); // по кнопке — сразу
  sy.background = true;
  let released = false;
  const p = sy.yieldToGame().then(() => (released = true));
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(!released);
  sy.background = false; // нажали «Обновить данные»
  await p;
  assert.ok(released);
});

test('portraits: fixed layout for pregame, dim plates, mirror fill', () => {
  const P = require('../src/core/portraits');
  const img = { w: 2560, h: 1600, data: Buffer.alloc(2560 * 224 * 4) };
  const L = P.layoutSlots(img);
  assert.strictEqual(L.length, 12);
  // места измерены на настоящих скриншотах 2560×1600
  const want = [411, 541, 672, 802, 932, 1061, 1499, 1629, 1759, 1889, 2019, 2149];
  L.forEach((s, i) => assert.ok(Math.abs(s.cx - want[i]) <= 3, `слот ${i}: ${s.cx}`));
  assert.strictEqual(P.teamColor(212, 135, 12), 'amber');
  assert.strictEqual(P.teamColor(78, 118, 196), 'sapphire');
  assert.strictEqual(P.teamColor(106, 71, 33), 'amber', 'полупрозрачная плашка соперника');
  assert.strictEqual(P.teamColor(169, 129, 92), 'amber');
  assert.strictEqual(P.teamColor(120, 120, 120), null, 'серый — не команда');
  assert.strictEqual(P.teamColor(40, 44, 38), null);
  // плашки: 6 синих слева и только 3 янтарных справа — недостающие достраиваются зеркально
  const paint = (cx, col) => { for (let y = 150; y < 175; y++) for (let x = cx - 24; x < cx + 24; x++) { const i = (y * 2560 + x) * 4; img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255; } };
  want.slice(0, 6).forEach((x) => paint(x, [78, 118, 196]));
  [1499, 1759, 2149].forEach((x) => paint(x, [106, 71, 33]));
  const F = P.findSlots(img);
  assert.strictEqual(F.length, 12, `найдено ${F.length}`);
  assert.strictEqual(F.filter((s) => s.guessed).length, 3);
  assert.ok(F.slice(6).every((s) => s.team === 'amber'));
  assert.ok(P.confident({ score: 0.67, margin: 0.12 }) && !P.confident({ score: 0.65, margin: 0.01 }) && !P.confident({ score: 0.61, margin: 0.32 }));
});

test('leaks: new match data (v2) and mistakes with moments', () => {
  const { extractMatch: ex, EXTRACT_V } = require('../src/core/extract');
  const L = require('../src/core/leaks');
  const { playerFeatures: pf } = require('../src/core/features');
  assert.strictEqual(EXTRACT_V, 2);
  // ---- извлечение: формат как в настоящем ответе API ----
  const snap = (t, extra = {}) => ({ time_stamp_s: t, net_worth: t * 10, kills: 0, deaths: 0, assists: 0, creep_kills: 0, neutral_kills: 0, gold_death_loss: 0, gold_neutral_creep: 0, gold_neutral_creep_orbs: 0,
    gold_sources: [{ source: 12, gold: Math.round(t / 2), gold_orbs: 0 }, { source: 8, gold: 50, gold_orbs: null }], ...extra });
  const rawPlayers = Array.from({ length: 12 }, (_, i) => ({ account_id: 100 + i, player_slot: i + 1, team: i < 6 ? 0 : 1, hero_id: 10 + i, assigned_lane: [1, 1, 4, 4, 6, 6][i % 6], kills: 0, deaths: 0, assists: 0, net_worth: 9000, last_hits: 0, level: 10,
    items: [], death_details: [], stats: [snap(180), snap(360), snap(540), snap(720), snap(900), snap(1200)],
    power_up_buffs: [{ is_permanent: true, type: 'hp_permanent_pickup', pickup_times_s: [200, 590] }, { is_permanent: true, type: 'firerate_permanent_pickup_lv2', pickup_times_s: [900] }, { is_permanent: false, type: 'gun_powerup_pickup', pickup_times_s: [] }] }));
  const raw = { match_info: { match_id: 777, start_time: 1, duration_s: 1300, winning_team: 0, players: rawPlayers,
    objectives: [{ team: 1, team_objective_id: 3, destroyed_time_s: 482 }], mid_boss: [{ team_killed: 0, team_claimed: 0, destroyed_time_s: 1263 }],
    damage_matrix: { sample_time_s: [180, 360, 540], source_details: { stat_type: [0, 0, 6], source_name: ['Bullet', 'citadel_weapon_x', 'Bullet'] },
      damage_dealers: [{ dealer_player_slot: 1, damage_sources: [
        { source_details_index: 0, damage_to_players: [{ target_player_slot: 7, damage: [100, 300] }, { target_player_slot: 2, damage: [999] }] },
        { source_details_index: 1, damage_to_players: [{ target_player_slot: 7, damage: [100, 300, 500] }] },
        { source_details_index: 2, damage_to_players: [{ target_player_slot: 7, damage: [5000] }] }] }] },
    match_paths: { interval_s: 1, x_resolution: 100, y_resolution: 100, paths: [{ player_slot: 1, x_min: 0, x_max: 100, y_min: 0, y_max: 100, x_pos: Array(12).fill(50), y_pos: Array(12).fill(50), health: [100, 100, 100, 100, 100, 0, 0, 0, 0, 0, 80, 80], combat_type: [0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2] }] } } };
  const m2 = ex(raw, { paths: true });
  const p1 = m2.players[0];
  assert.strictEqual(m2.v, 2);
  assert.strictEqual(p1.stats[2].g_brk, 270, 'коробки из gold_sources (12)');
  assert.strictEqual(p1.stats[2].g_bonus, 50, 'командный бонус (8)');
  assert.deepStrictEqual(p1.pu, [[200, 'hp'], [590, 'hp'], [900, 'firerate_lv2']], 'только постоянные бафы, по времени');
  assert.deepStrictEqual(m2.dmg.d['1>7'], [100, 300, 300], 'урон: только категория Bullet, хвост массива — без изменений');
  assert.ok(!m2.dmg.d['1>2'], 'урон по своим не храним');
  assert.deepStrictEqual(m2.paths.players[1][0], [50, 50, 1, 4, 100], 'в маршруте: лес (бит 4) и здоровье');
  assert.strictEqual(m2.paths.players[1][1][2], 0, 'здоровье 0 — мёртв');
  assert.deepStrictEqual(m2.paths.players[1][2].slice(0, 4), [50, 50, 1, 3], 'герои (1) + крипы линии (2)');
  assert.deepStrictEqual(m2.objectives, [[1, 3, 482]]);
  const f2 = pf(p1, m2, null);
  assert.strictEqual(f2.brk9, 270);
  assert.strictEqual(f2.pu10, 2);
  assert.strictEqual(f2.pu20, 3);

  // ---- детекторы на компактном матче ----
  const step = 5;
  const mkPath = (fn) => Array.from({ length: 400 }, (_, i) => fn(i * step));
  const players = [];
  for (let i = 0; i < 12; i++) {
    const team = i < 6 ? 0 : 1;
    players.push({ account_id: 1 + i, hero_id: 20 + i, team, slot: i, lane: [1, 1, 4, 4, 6, 6][i % 6], won: team === 1, k: 0, d: 0, a: 0, nw: 20000, items: [], deaths: [], deaths_t: [], pu: [],
      stats: [{ t: 540, nw: 6000, d: 0, g_lost: 0, g_brk: 600, g_neutral: 600, g_treasure: 0, pdmg: 3000, ka: 0, k: 0, a: 0 }, { t: 1200, nw: 18000, d: 0, g_lost: 0, g_brk: 2200, g_neutral: 3000, g_treasure: 330, pdmg: 9000, k: 0, a: 0 }, { t: 1800, nw: 24000, d: 0, g_lost: 0, g_brk: 2600, g_neutral: 4000, g_treasure: 330, pdmg: 15000, k: 0, a: 0 }] });
  }
  const me = players[0];
  // я: 2 смерти на линии от врага по линии (слот 6), проиграл размены; потом 2 раза фармил лес, пока своих убивали
  me.deaths = [[200, 0, 0, 6, 0, 0], [420, 0, 0, 6, 0, 0], [1500, 0, 0, 7, 0, 0]];
  me.deaths_t = [200, 420, 1500];
  me.d = 3;
  me.stats = [{ t: 540, nw: 4000, d: 2, g_lost: 0, g_brk: 100, g_neutral: 50, g_treasure: 0, k: 0, a: 0 }, { t: 1200, nw: 12000, d: 2, g_lost: 0, g_brk: 700, g_neutral: 900, g_treasure: 0, k: 0, a: 0 }, { t: 1800, nw: 18000, d: 3, g_lost: 1500, g_brk: 900, g_neutral: 1200, g_treasure: 0, k: 0, a: 0 }];
  me.pu = [[500, 'hp']];
  const ally = players[1];
  const ally2 = players[2];
  ally.deaths = [[900, 6000, 0, 8, 6000, 0], [1300, 6000, 0, 8, 6000, 0]];
  ally2.deaths = [[905, 6100, 0, 9, 6100, 0], [1305, 6100, 0, 9, 6100, 0]];
  const pathsP = {};
  for (const p of players) pathsP[p.slot] = mkPath((t) => [p === me ? 0 : 6000, 0, 1, p === me && t > 600 ? 4 : 0, 100]);
  const mm = { match_id: 9001, start_time: 1, duration_s: 1800, players, paths: { step, players: pathsP }, badge: [52, 52],
    dmg: { t: [180, 360, 540, 1800], d: { '0>6': [200, 500, 900, 2000], '6>0': [600, 1500, 3000, 4000], '7>0': [0, 0, 0, 9000] } } };
  const fm = pf(me, mm, null);
  const leaks = L.gameLeaks({ m: mm, me, f: fm, ref: null, tier: 5, laneVs: { 26: -0.06 }, heroName: (x) => `H${x}`, itemName: (x) => `I${x}`,
    counters: { 27: [{ id: 555, lift: 2.1, rateVs: 0.4 }] } });
  const keys = leaks.map((l) => l.key);
  assert.ok(keys.includes('lane_trades'), 'размены на линии');
  const lt = leaks.find((l) => l.key === 'lane_trades');
  assert.ok(/Тяжёлый матчап с H26/.test(lt.title) && /6% реже/.test(lt.text), 'матчап по топам в тексте');
  assert.strictEqual(lt.moments.length, 2);
  assert.ok(keys.includes('farm_while_fight'), 'лес во время проигранных драк');
  const fw = leaks.find((l) => l.key === 'farm_while_fight');
  assert.strictEqual(fw.moments.length, 2);
  assert.strictEqual(fw.cost.allyDeaths, 4);
  assert.ok(/19 с бега/.test(fw.moments[0].text), `время бега: ${fw.moments[0].text}`);
  assert.ok(keys.includes('map_timings'), 'тайминги карты');
  assert.ok(/у игроков Ascendant\+/.test(leaks.find((l) => l.key === 'map_timings').text));
  assert.ok(keys.includes('sinner'), 'казино');
  assert.ok(keys.includes('lost_souls'), 'потерянные души');
  assert.strictEqual(leaks.find((l) => l.key === 'lost_souls').moments[0].t, 1500);
  assert.ok(keys.includes('counter_missing'), 'нет ответа на опасного героя');
  assert.ok(/I555/.test(leaks.find((l) => l.key === 'counter_missing').text));
  for (const l of leaks) assert.ok(!/undefined|NaN/.test(l.title + l.text), `${l.key}: ${l.text}`);
  // драки, в которых я дрался, не считаются
  const pathsFight = { ...pathsP, 0: mkPath((t) => [0, 0, 1, t > 600 ? 5 : 0, 100]) };
  const l2 = L.gameLeaks({ m: { ...mm, paths: { step, players: pathsFight } }, me, f: fm, tier: 5 });
  assert.ok(!l2.some((l) => l.key === 'farm_while_fight'), 'был в бою с героями — не ошибка');
  // далеко за пределами досягаемости — тоже не ошибка
  const pathsFar = {};
  for (const p of players) pathsFar[p.slot] = mkPath((t) => [p === me ? -9500 : 6000, 0, 1, p === me && t > 600 ? 4 : 0, 100]);
  const l3 = L.gameLeaks({ m: { ...mm, paths: { step, players: pathsFar } }, me, f: fm, tier: 5 });
  assert.ok(!l3.some((l) => l.key === 'farm_while_fight'), 'не успел бы добежать — не ошибка');

  // ---- общая картина ----
  const games = [
    { match_id: 1, won: false, hero: 1, leaks },
    { match_id: 2, won: false, hero: 1, leaks: leaks.filter((l) => l.key === 'lane_trades') },
    { match_id: 3, won: true, hero: 1, leaks: [] },
    { match_id: 4, won: true, hero: 1, leaks: [] },
    { match_id: 5, won: true, hero: 1, leaks: [] },
  ];
  const prof = L.leakProfile(games);
  assert.strictEqual(prof.games, 5);
  const lr = prof.rows.find((r) => r.key === 'lane_trades');
  assert.strictEqual(lr.count, 2);
  assert.strictEqual(lr.wrWith, null, 'мало игр с ошибкой — винрейт не показываем');
  assert.strictEqual(lr.deaths, 4);
  assert.strictEqual(prof.rows[0].key, 'lane_trades', 'на первом месте — то, что чаще и дороже');

  // ---- что берут против героя ----
  const recs = [];
  for (let i = 0; i < 400; i++) {
    const withE = i % 3 === 0;
    const enemies = [{ team: 1, hero_id: withE ? 50 : 51 }];
    const items = [[1, 600]].concat(withE ? (i % 2 === 0 ? [[2, 900]] : []) : i % 10 === 0 ? [[2, 900]] : []);
    recs.push({ match: { players: [{ team: 0, hero_id: 1 }, ...enemies] }, player: { team: 0, items } });
  }
  const ct = L.counterItems(recs);
  assert.ok(ct[50] && ct[50][0].id === 2 && ct[50][0].lift > 3, 'против героя 50 чаще берут предмет 2');
  assert.ok(!ct[50].some((x) => x.id === 1), 'предмет, который берут всегда, — не ответ');
  // привычки и победа
  assert.strictEqual(L.winLink('d9', 2).wr, 0.473);
  assert.strictEqual(L.winLink('pu10', 7).wr, 0.519);
});

test('versus: candidates and side by side', () => {
  const recs = benchM.map((m) => ({ match: m, player: m.players[0] }));
  const myM = extractMatch(fakeMatch({ id: 4242, seed: 77, start: 1, accounts: [777, ...ACC.slice(1)], skill: [0.8] }), { paths: true });
  const me = myM.players[0];
  const c = proCandidates({ me, bench: recs });
  assert.ok(c.length >= 5 && c[0].score >= c[c.length - 1].score);
  const v = versus({ myMatch: myM, me, proMatch: recs[0].match, pro: recs[0].player });
  assert.strictEqual(v.me.phases.length, 3);
  assert.ok(v.me.curves.nw.length > 10 && v.pro.items.length > 3);
  assert.strictEqual(v.me.sources[0].rows.length, 6);
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} tests passed.\n`);
  console.log('Пример выводов разбора для слабой игры:');
  for (const i of result.insights) console.log(`  [${i.level}] ${i.area}: ${i.text}`);
});
