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
const { updateCoach, checkGame } = require('../src/core/coach');
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
  assert.ok(r1.view.goals.length >= 2 && r1.view.goals.length <= 3, `целей ${r1.view.goals.length}`);
  assert.strictEqual(new Set(r1.view.goals.map((g) => g.area)).size, r1.view.goals.length, 'разные разделы');
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
    3: { vs: { 10: { delta: 0.3, evidence: 4 } } }, // выброс ограничивается ±15%
  };
  const a = pickAdvice({ pool: full, tables, enemies: [10, 11], current: 1 });
  assert.strictEqual(a.rows[0].hero_id, 2, 'лучший против состава — герой 2');
  assert.ok(a.verdict && !a.verdict.keep && a.verdict.hero_id === 2 && a.verdict.from === 1);
  assert.ok(Math.abs(a.all.find((r) => r.hero_id === 3).vsScore - 0.15) < 1e-9, 'матчап ограничен 15%');
  assert.ok(a.rows[0].pros.length >= 1 && a.all.find((r) => r.hero_id === 1).cons.length === 2);
  const keep = pickAdvice({ pool: full, tables, enemies: [10, 11], current: 2 });
  assert.ok(keep.verdict.keep, 'уже на лучшем — оставаться');
  const taken = pickAdvice({ pool: full, tables, enemies: [10, 2] });
  assert.ok(!taken.rows.some((r) => r.hero_id === 2), 'занятого героя не советуем');
  assert.ok(taken.all.find((r) => r.hero_id === 4).noTable, 'нет таблицы — помечено');
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
