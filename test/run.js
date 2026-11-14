'use strict';
// Запуск: node test/run.js
// Проверяет расчёты на синтетических матчах (без интернета).

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { Store } = require('../src/main/store');
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

async function withStoreDir(run) {
  const parent = await fs.realpath(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(parent, 'deadlock-coach-store-'));
  try {
    await run(dir);
  } finally {
    const resolved = await fs.realpath(dir);
    if (path.dirname(resolved) === parent && path.basename(resolved).startsWith('deadlock-coach-store-')) {
      await fs.rm(resolved, { recursive: true, force: true });
    }
  }
}

test('store keeps personal matches by account across logout, prune and reset', () => withStoreDir(async (dir) => {
  const store = new Store(dir);
  const [personal, fromLegacy, top] = matches.slice(0, 3).map((m, i) => ({ ...m, players: [{ ...m.players[0], account_id: 123 + i }] }));
  store.write('auth.json', { accountId: 123 });
  store.write('coach-124.json', {});
  await store.saveAuth({ accountId: 200 });
  await store.saveAuth(null);
  await Promise.all([store.putMatch(personal), store.putMatch(fromLegacy), store.putMatch(top)]);
  assert.strictEqual(await store.prune(now + 1), 1);
  assert.strictEqual(await store.removeMatches(() => true), 0);
  assert.deepStrictEqual(new Set(new Store(dir).allMatches().map((m) => m.match_id)), new Set([personal.match_id, fromLegacy.match_id]));
  store.markPersonalMatches(Array.from({ length: 501 }, (_, i) => i + 1));
  store.markPersonalMatches([502]);
  assert.strictEqual(store.read('mine.json').length, 502);
}));

test('store recovers newer JSON and rebuilds the package after append failure', () => withStoreDir(async (dir) => {
  const store = new Store(dir, { lazy: true });
  const match = matches[0];
  await store.putMatch(match);
  assert.strictEqual(await store._canReadPack(), true);
  const oldPack = store.packFile + '.backup';
  await fs.rename(store.packFile, oldPack);
  await fs.mkdir(store.packFile);
  await store.putMatch({ ...match, pathsTried: true });
  await store.putMatch(matches[1]);
  await fs.rmdir(store.packFile);
  await fs.rename(oldPack, store.packFile);
  assert.strictEqual(await store._canReadPack(), false);
  const recovered = new Store(dir, { lazy: true });
  await recovered.ready;
  await recovered._matchQ;
  assert.strictEqual(recovered.getMatch(match.match_id).pathsTried, true);
  assert.strictEqual(recovered.hasMatch(matches[1].match_id), true);
  const next = new Store(dir, { lazy: true });
  await next.ready;
  assert.strictEqual(next.loadInfo.fromPack, 2);
  assert.strictEqual(next.getMatch(match.match_id).pathsTried, true);
}));

test('store survives a rebuild error and does not delete when protection metadata is invalid', () => withStoreDir(async (dir) => {
  const saved = new Store(dir);
  await saved.putMatch(matches[0]);
  const tmp = saved.packFile + '.tmp';
  await fs.mkdir(tmp);
  const errors = [];
  const store = new Store(dir, { lazy: true, onPackError: (err) => errors.push(err) });
  await store.ready;
  await store.putMatch(matches[1]);
  assert.strictEqual(errors.length, 1);
  assert.strictEqual(await store._canReadPack(), false);
  await fs.writeFile(path.join(dir, 'mine.json'), '[');
  await assert.rejects(store.prune(now + 1), /защиту личных матчей/);
  assert.strictEqual(store.matches.size, 2);
  await fs.rmdir(tmp);
  const recovered = new Store(dir, { lazy: true });
  await recovered.ready;
  await recovered._matchQ;
  assert.strictEqual(recovered.matches.size, 2);
  assert.strictEqual(await recovered._canReadPack(), true);
}));

test('store keeps the last saved match after a JSON write error and accepts a retry', () => withStoreDir(async (dir) => {
  const store = new Store(dir, { lazy: true });
  const match = matches[0];
  await store.putMatch(match);
  const target = path.join(store.matchDir, `${match.match_id}.json`);
  const tmp = target + '.tmp';
  const updated = { ...match, pathsTried: true };
  await fs.mkdir(tmp);
  await assert.rejects(store.putMatch(updated));
  assert.deepStrictEqual(store.getMatch(match.match_id), match);
  assert.strictEqual(await fs.readFile(target, 'utf8'), JSON.stringify(match));
  await fs.rmdir(tmp);
  await store.putMatch(updated);
  assert.deepStrictEqual(store.getMatch(match.match_id), updated);
  assert.strictEqual(await fs.readFile(target, 'utf8'), JSON.stringify(updated));
}));
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

test('dashboard keeps seven calendar days, a separate baseline and personal ranked badges', () => {
  const { dashboardStats } = require('../src/core/overview');
  const now = Math.floor(new Date(2026, 10, 11, 16, 0).getTime() / 1000);
  const at = (day, hour = 12) => Math.floor(new Date(2026, 10, day, hour).getTime() / 1000);
  const match = (match_id, start_time, hero_id, match_mode, match_result, ranked_display_badge) =>
    ({ match_id, start_time, hero_id, game_mode: 1, match_mode, match_result, player_team: 0, ranked_display_badge });
  const rows = [
    match(1, at(3), 72, 4, 1, 101),
    match(2, at(5, 0), 72, 1, 0, 110),
    match(3, at(8), 7, 4, 1, 102),
    match(4, at(11), 7, 4, null, 103),
    match(5, at(11, 13), 7, 2, 0, 106),
    match(6, at(11, 19), 72, 4, 0, 105),
    match(3, at(8), 7, 4, 1, 102),
  ];
  const stats = dashboardStats(rows, now);
  assert.deepStrictEqual(stats.week, { games: 3, wins: 1, losses: 1, unknown: 1, wr: 0.5 });
  assert.strictEqual(stats.baseline.wr, 0);
  assert.strictEqual(stats.days.length, 7);
  assert.strictEqual(stats.days[0].wins, 1);
  assert.strictEqual(stats.latest.hero_id, 7);
  assert.deepStrictEqual(stats.rank.map((p) => p.badge), [102, 103]);
  assert.deepStrictEqual(stats.heroes.map((h) => [h.heroId, h.games]), [[7, 2], [72, 1]]);
});

test('last match for the Home card: one record, no invented numbers', () => {
  const { dashboardStats, lastMatchSummary, gameFromHistory } = require('../src/core/overview');
  const now = Math.floor(new Date(2026, 10, 14, 12, 0).getTime() / 1000);
  const row = (match_id, start_time, extra = {}) => ({ match_id, start_time, hero_id: 72, game_mode: 1, match_mode: 4, match_result: 0, player_team: 0, player_kills: 5, player_deaths: 3, player_assists: 8, match_duration_s: 1800, ...extra });
  // последний по времени, а не по порядку в списке; герой, итог и счёт из одной записи
  const rows = [row(11, now - 100, { hero_id: 7, match_result: 1, player_kills: 1, player_deaths: 9, player_assists: 2 }), row(10, now - 5000), row(12, now - 9000)];
  const st = dashboardStats(rows, now);
  assert.deepStrictEqual(st.lastMatch, { matchId: 11, heroId: 7, startTime: now - 100, result: 'loss', kda: { k: 1, d: 9, a: 2 } });
  assert.strictEqual(st.lastMatch.matchId, st.latest.match_id, 'тот же матч, что и «Последний матч · герой · дата»');
  // победа
  assert.strictEqual(dashboardStats([row(1, now - 50, { match_result: 0, player_team: 0 })], now).lastMatch.result, 'win');
  // результат неизвестен: ни победы, ни поражения
  assert.strictEqual(dashboardStats([row(2, now - 50, { match_result: null })], now).lastMatch.result, null);
  // счёта нет в записи: не рисуем 0/0/0
  const noKda = row(3, now - 50); delete noKda.player_kills; delete noKda.player_deaths; delete noKda.player_assists;
  const lm = dashboardStats([noKda], now).lastMatch;
  assert.strictEqual(lm.kda, null);
  assert.strictEqual(lm.heroId, 72);
  // нет данных / мусор / будущее время: null без NaN
  assert.strictEqual(dashboardStats([], now).lastMatch, null);
  assert.strictEqual(lastMatchSummary(undefined), null);
  assert.strictEqual(lastMatchSummary([{ match_id: 5, start_time: 0, hero_id: 7 }, { match_id: 6, start_time: 10, hero_id: 0 }, null]), null);
  assert.strictEqual(dashboardStats([row(4, now + 99999)], now).lastMatch, null);
  const direct = lastMatchSummary([gameFromHistory(row(8, 100)), gameFromHistory(row(9, 200, { match_result: 1 }))]);
  assert.strictEqual(direct.matchId, 9);
  assert.strictEqual(direct.result, 'loss');
  assert.ok(!JSON.stringify(direct).includes('NaN') && !JSON.stringify(direct).includes('undefined'));
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
test('early death advice distinguishes the event from its first recorded snapshot', () => {
  const advise = (firstDeathExact) => matchTips({
    me: { firstDeath: 140, firstDeathExact }, ref: {}, lobby: {},
  }).find((t) => t.family === 'first_death');
  assert.match(advise(true).text, /в журнале.*2:20/i);
  assert.match(advise(false).text, /к снимку.*2:20/i);
  assert.match(advise(false).text, /точной секунды/i);
});
test('purchase windows do not infer kills or assists from interpolated counters', () => {
  const { aroundPurchase } = require('../src/core/spikes');
  const stats = (kill) => Array.from({ length: 12 }, (_, i) => ({
    t: i * 60, pdmg: i * 50, k: i * 60 >= kill ? 1 : 0, a: 0,
  }));
  assert.strictEqual(aroundPurchase(stats(240), 210).participated, null);
  assert.strictEqual(aroundPurchase(stats(300), 210).participated, true);
  assert.strictEqual(aroundPurchase(stats(480), 210).participated, false);
  assert.strictEqual(aroundPurchase(stats(300).slice(0, 5), 210), null);
});
test('map review preserves grouped soul losses and verifies team kills before a Midboss prompt', () => {
  const { macroReview } = require('../src/core/macro');
  const { majorSoulLosses } = require('../src/core/leaks');
  const player = { team: 0, slot: 1, d: 3, deaths_t: [190, 250, 700], stats: [
    { t: 300, d: 2, g_lost: 1600, g_brk: 80, g_lane: 1200 },
    { t: 1200, d: 3, g_lost: 2600 },
  ] };
  const enemies = [2, 3, 4].map((slot) => ({ team: 1, slot, deaths: [[935 + slot, 100, 200, 1]] }));
  const m = { match_id: 10, start_time: Date.UTC(2026, 10, 1) / 1000, duration_s: 1200, players: [player, ...enemies], midBoss: [[0, 1, 1000]] };
  const rows = macroReview(m, player);
  assert.match(rows[0].text, /Суммарная потеря/);
  assert.equal(rows[0].evidence, null);
  assert.equal(rows[1].evidence.t, 700);
  assert.equal(majorSoulLosses(player, m.duration_s), null);
  assert.equal(majorSoulLosses({ ...player, d: 1, deaths_t: [700], stats: [{ t: 1200, d: 1, g_lost: 1000 }] }, 1200), 1);
  assert.ok(rows.some((r) => r.title === 'Когда проверить ранний Midboss'));
  enemies[0].deaths[0][3] = null;
  assert.ok(!macroReview(m, player).some((r) => r.title === 'Когда проверить ранний Midboss'));
  assert.ok(rows.some((r) => r.moments.some((point) => point.t === 1000 && point.text.includes('награда — соперники'))));
  assert.ok(rows.find((r) => r.title.includes('Rift')).moments.length === 0);
  assert.ok(!macroReview({ ...m, start_time: 1 }, player).some((r) => r.title.includes('Rift') || r.tip.includes('Plaza')));
});
test('map review uses purchases and verified events without attributing a fight to Rift', () => {
  const { macroReview } = require('../src/core/macro');
  const player = { team: 0, slot: 1, lane: 0, stats: [{ t: 360, nw: 4500 }], items: [[10, 400]], deaths: [[1105, 100, 200, 2]] };
  const enemies = [2, 3, 4].map((slot, i) => ({ team: 1, slot, deaths: [
    [900 + i * 12, 100, 200, 1],
    ...(i < 2 ? [[1100 + i * 3, 100, 200, 1]] : []),
  ] }));
  Object.assign(enemies[0], { lane: 0, stats: [{ t: 360, nw: 3000 }] });
  const match = { start_time: Date.UTC(2026, 10, 1) / 1000, duration_s: 1200, players: [player, ...enemies] };
  const rows = macroReview(match, player, { nameOf: () => 'Предмет игрока' });
  assert.ok(!rows.some((r) => r.title.includes('Midboss')), 'три убийства за 24 секунды не дают короткого окна');
  const rift = rows.find((r) => r.title.includes('Rift'));
  assert.match(rift.text, /Связь с Rift можно проверить в повторе/);
  assert.equal(rift.moments[0].t, 1100);
  const rotation = rows.find((r) => r.title.includes('Ротация'));
  assert.match(rotation.text, /К 6:00.*4\s500.*3\s000/);
  assert.match(rotation.text, /6:40.*Предмет игрока/);
  assert.equal(rotation.moments[1].t, 400);
  enemies[0].stats[0].t = 361;
  assert.doesNotMatch(macroReview(match, player).find((r) => r.title.includes('Ротация')).text, /в среднем/);
});
test('map review: late decisive fight followed by an objective or wasted', () => {
  const { macroReview } = require('../src/core/macro');
  const { findFights } = require('../src/core/leaks');
  const player = { team: 0, slot: 1, d: 0, deaths: [], deaths_t: [], stats: [] };
  const enemies = [2, 3, 4].map((slot) => ({ team: 1, slot, deaths: [[1250 + slot, 100, 200, 1]] }));
  const late = { match_id: 11, start_time: Date.UTC(2026, 10, 1) / 1000, duration_s: 1800,
    players: [player, ...enemies], objectives: [], midBoss: [] };
  // драка скластеризовалась и поздняя
  assert.strictEqual(findFights(late).length, 1);
  assert.ok(findFights(late)[0].t1 > 1200);
  // 3 соперника, 0 своих — победа без объекта
  const wasted = macroReview(late, player).find((r) => r.title === 'После выигранной драки — объект');
  assert.ok(wasted, 'строка про незакреплённую победу появилась');
  assert.match(wasted.text, /не взяла ни Midboss, ни объект/);
  assert.match(wasted.text, /3 соперников и 0 героев/);
  assert.ok(!/undefined|NaN/.test(wasted.text + wasted.tip));
  // объект взят в окно 60 секунд — хвалим шаблон
  const taken = macroReview({ ...late, objectives: [[0, 3, 1290]] }, player).find((r) => r.title === 'После выигранной драки — объект');
  assert.match(taken.text, /взяла 1 объект/);
  assert.match(taken.text, /закрепи этот шаблон/);
  assert.ok(taken.moments.some((m) => m.t === 1290 && m.text === 'Сломан объект'));
  // Midboss в окно тоже считается
  const boss = macroReview({ ...late, midBoss: [[0, 0, 1300]] }, player).find((r) => r.title === 'После выигранной драки — объект');
  assert.match(boss.text, /Midboss/);
  // размен 3:2 — не решительная победа, строки нет
  const close = { ...late, players: [player, ...enemies, { team: 0, slot: 5, deaths: [[1252, 150, 250, 2]] }, { team: 0, slot: 6, deaths: [[1258, 150, 250, 3]] }] };
  assert.ok(!macroReview(close, player).some((r) => r.title === 'После выигранной драки — объект'), '3:2 — не окно');
  // старый формат без данных об объектах — молчим, а не «не взяли»
  assert.ok(!macroReview({ ...late, objectives: undefined }, player).some((r) => r.title === 'После выигранной драки — объект'));
  assert.ok(!macroReview({ ...late, midBoss: undefined }, player).some((r) => r.title === 'После выигранной драки — объект'));
  // игрок погиб в драке — другой совет
  const meDead = { ...late, players: [{ ...player, deaths: [[1255, 120, 210, 2]] }, ...enemies] };
  assert.match(macroReview(meDead, { ...player, deaths: [[1255, 120, 210, 2]] }).find((r) => r.title === 'После выигранной драки — объект').tip, /возродиться/);
});

test('replay ties losses and Midboss context to matching death records only', () => {
  const { summarizeReplay } = require('../src/main/replayAnalysis');
  const player = { team: 0, deaths_t: [100], stats: [{ t: 110, d: 1, g_lost: 1200 }] };
  const match = { duration_s: 600, players: [player, { team: 1, deaths_t: [115] }], midBoss: [[0, 0, 120]] };
  const events = [{ tick: 6400, victim_team_number: 2 }, { tick: 7360, victim_team_number: 3 }];
  const result = summarizeReplay(events, match, player);
  assert.equal(result.aligned, true);
  assert.deepEqual(result.losses, [{ t: 100, lost: 1200 }]);
  assert.deepEqual(result.bosses, [{ t: 120, allies: 1, opponents: 1 }]);
  const mismatched = summarizeReplay([events[0], { ...events[1], tick: 8000 }], match, player);
  assert.deepEqual(mismatched, { count: 2, aligned: false, losses: [], bosses: [] });
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
test('coach: solo deaths goal from episode, plan even with few games', () => {
  const now = 1_900_000_000;
  const evidence = { key: 'solo_deaths', matchId: 1, t: 1100 };
  const games = [{ match_id: 1, start_time: now - 600, hero: 72, f: { soloDeaths: 3 } }];
  // игр меньше пяти: раньше эпизод молча пропадал, теперь план создаётся из одной цели
  const r = updateCoach(null, { now, games, topHero: new Map(), lobby: {}, extra: {} }, { focusEvidence: evidence });
  assert.ok(r.view.plan, 'план создан из эпизода');
  const g = r.view.goals[0];
  assert.strictEqual(g.key, 'solo_deaths');
  assert.strictEqual(g.target, 1);
  assert.strictEqual(g.cmp, 'le');
  assert.strictEqual(g.evidence.t, 1100);
  assert.strictEqual(g.baseline, 3, 'основание — как было обычно');
  // игра после плана: ни одной одиночной смерти — цель выполнена
  const after = updateCoach(r.state, { now: now + 120, games: [...games, { match_id: 2, start_time: now + 60, hero: 72, f: { soloDeaths: 0 } }], topHero: new Map(), lobby: {}, extra: {} });
  assert.strictEqual(after.view.goals[0].passed, 1);
  assert.strictEqual(after.view.goals[0].games, 1);
  // метрики нет (старый матч без маршрутов) — «жду данные», не «выполнено»
  const unknown = updateCoach(r.state, { now: now + 240, games: [...games, { match_id: 3, start_time: now + 180, hero: 72, f: {} }], topHero: new Map(), lobby: {}, extra: {} });
  assert.strictEqual(unknown.view.cards[0].checks.find((x) => x.key === 'solo_deaths').pass, null, 'нет данных — pending');
  // авто-подбор цели: медиана одиночных смертей выше 1,5
  const cands = require('../src/core/coach').candidates({ games: [
    { match_id: 11, start_time: now, hero: 72, f: { soloDeaths: 3 } },
    { match_id: 12, start_time: now + 1, hero: 72, f: { soloDeaths: 3 } },
    { match_id: 13, start_time: now + 2, hero: 72, f: { soloDeaths: 2 } },
  ], topHero: new Map(), lobby: {}, extra: {} });
  const cand = cands.find((c) => c.key === 'solo_deaths');
  assert.ok(cand, 'цель появляется сама при частых одиночных смертях');
  assert.strictEqual(cand.target, 2, 'цель — на единицу меньше медианы');
});

test('coach returns the actual hero-specific threshold and keeps missing values pending', () => {
  const goal = { key: 'neu9', short: 'лес к 9:00', cmp: 'ge', target: 800, byHero: { 72: 1000 } };
  const [billy] = checkGame({ hero: 72, f: { neu9: 901 } }, [goal]);
  assert.deepStrictEqual([billy.value, billy.target, billy.cmp, billy.pass], [901, 1000, 'ge', false]);
  const [missing] = checkGame({ hero: 72, f: null }, [goal]);
  assert.deepStrictEqual([missing.target, missing.pass], [1000, null]);
  const [another] = checkGame({ hero: 7, f: { neu9: 901 } }, [goal]);
  assert.deepStrictEqual([another.target, another.pass], [800, true]);
});

test('a selected episode survives reload and missing matches stay pending', () => {
  const now = 1_900_000_000;
  const evidence = { matchId: 100, t: 140 };
  const old = Array.from({ length: 6 }, (_, i) => ({ match_id: 100+i, start_time: now-600*(6-i), hero:72, f:{d10:2} }));
  const create = updateCoach(null, { now, games:old, topHero:new Map(), lobby:{}, extra:{} }, { focusEvidence:evidence });
  assert.strictEqual(create.view.goals[0].target,1);
  assert.strictEqual(create.view.goals[0].evidence.t,140);
  const pendingGame = { match_id: 200, start_time: now+60, hero:72, f:null };
  const next = updateCoach(create.state, { now:now+120, games:[...old,pendingGame,pendingGame], topHero:new Map(), lobby:{}, extra:{} });
  assert.strictEqual(next.view.cards.length,1);
  assert.strictEqual(next.view.cards[0].checks.find((x)=>x.key==='d10').pass,null);
  assert.strictEqual(next.view.goals[0].games,0);
  const checked = updateCoach(next.state, { now:now+240, games:[...old,{...pendingGame,f:{d10:1}}], topHero:new Map(), lobby:{}, extra:{} });
  assert.strictEqual(checked.view.goals[0].passed,1);
  assert.strictEqual(checked.view.goals[0].startedAt,now);
});

test('coach: plan from weaknesses, checks, closing goals', () => {
  const topHero = new Map([[benchM[0].players[0].hero_id, refF]]);
  const t0 = 1_900_000_000;
  const weak = coachGames(0.6, 12, t0);
  const lobby = refAll(weak.flatMap((g) => g.match.players.slice(1).map((p) => playerFeatures(p, g.match))));
  const r1 = updateCoach(null, { games: weak, topHero, lobby, extra: {}, now: t0 + 12 * 3000 + 100 });
  assert.ok(r1.view.plan, 'план создан');
  assert.ok(r1.view.goals.length >= 2 && r1.view.goals.length <= 3, `целей ${r1.view.goals.length}`);
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
  assert.ok(r2.view.goals.some((g) => g.status === 'done') || r2.view.events.some((e) => e.kind === 'step'), 'цель выполнена или пройдена ступень');
  assert.ok(r2.view.events.some((e) => e.kind === 'done' || e.kind === 'step'), 'сообщение о выполнении');
  const c = checkGame(strong[0], r1.view.goals);
  assert.ok(c.every((x) => x.pass === null || typeof x.pass === 'boolean'));
  // мало игр — плана нет
  const r0 = updateCoach(null, { games: weak.slice(0, 3), topHero, lobby, extra: {}, now: t0 });
  assert.strictEqual(r0.view.plan, null);
  assert.ok(r0.view.need > 0);
  console.log('    цели:', r1.view.goals.map((g) => g.title).join(' | '));
  // старый план из 1 цели добирается до 2–3
  const oldState = JSON.parse(JSON.stringify(r1.state));
  oldState.plan.goals = oldState.plan.goals.slice(0, 1).map(({ family, kind, ...g }) => g);
  const r3 = updateCoach(oldState, { games: weak, topHero, lobby, extra: {}, now: t0 + 12 * 3000 + 200 });
  assert.ok(r3.view.goals.filter((g) => g.status === 'active').length >= 2, 'план добран');
  // выбор: по одному на раздел, потом второй в раздел, одна семья — одна цель
  const pk = pickGoals([
    { key: 'd10', family: 'deaths', area: 'Выживание', gap: 1 },
    { key: 'd', family: 'deaths', area: 'Выживание', gap: 0.9 },
    { key: 'firstBigT', family: 'spike1', area: 'Паверспайки', gap: 0.8 },
    { key: 'spikeFights', family: 'spikeUse', area: 'Паверспайки', gap: 0.7 },
    { key: 'firstHugeT', family: 'spike2', area: 'Паверспайки', gap: 0.6 },
    { key: 'lh10', family: 'laneFarm', area: 'Фарм', gap: 0.5 },
  ], 4);
  assert.deepStrictEqual(pk.map((g) => g.key), ['d10', 'firstBigT', 'lh10', 'spikeFights']);
  // признаки паверспайков считаются
  assert.ok(weak.some((g) => g.f.spikeFights !== undefined) && 'spikeDmg' in weak[0].f);
});
test('coach: goal honesty — easy goals skipped, too-hard goals get steps, no calendar expiry', () => {
  const { candidates, calibrate } = require('../src/core/coach');
  const now = 1_900_000_000;
  const mk = (i, f) => ({ match_id: 300 + i, start_time: now - (30 - i) * 3000, hero: 72, f });
  // обычно 1–2 смерти до 10:00; планка «0» выполнялась в 1 игре из 12 — нужна ступень «не больше 1»
  const hard = Array.from({ length: 12 }, (_, i) => mk(i, { d10: i === 0 ? 0 : 1 + (i % 2) }));
  const cand = candidates({ games: hard, topHero: new Map(), lobby: {}, extra: {} }).find((c) => c.key === 'd10');
  assert.ok(cand, 'цель про смерти до 10:00 предложена');
  assert.ok(cand.ladder && cand.ladder.steps.length === 2, 'есть ступени');
  assert.deepStrictEqual(cand.ladder.steps.map((x) => x.target), [1, 0], 'сначала легче, потом нужная планка');
  assert.strictEqual(cand.target, 1);
  assert.strictEqual(cand.ladder.i, 0);
  assert.ok(cand.calib.rate <= 0.15 && cand.calib.n === 12, 'доля выполнения до цели записана');
  // цель уже выполняется почти всегда — тренировать нечего
  const easy = Array.from({ length: 10 }, (_, i) => mk(i, { kp: 0.6 }));
  assert.strictEqual(calibrate({ key: 'kp', cmp: 'ge', target: 0.55, byHero: null, title: 'x', short: 'x' }, CATALOG.find((c) => c.key === 'kp'), easy), null, 'выполняется в 100% игр — не берём');
  // мало проверенных игр — цель остаётся, но про выборку сказано
  const few = calibrate({ key: 'kp', cmp: 'ge', target: 0.55, byHero: null, title: 'x', short: 'x' }, CATALOG.find((c) => c.key === 'kp'), easy.slice(0, 3));
  assert.ok(few && few.calib.n === 3 && !few.ladder);
  // ступень пройдена → планка выше, счёт заново; потом цель выполнена
  const state = { plan: { createdAt: now - 40 * 86400, reason: 'first', goals: [{ key: 'd10', family: 'deaths', area: 'Выживание', cmp: 'le', habit: false, kind: 'fix', title: 'Не больше 1 смерти до 10:00', short: 'смерти до 10:00', tip: 't', target: 1, byHero: null, baseline: 2, ref: null, gap: 1, status: 'active', startedAt: now - 20000, ladder: { i: 0, steps: [{ target: 1, byHero: null }, { target: 0, byHero: null }], finalTitle: 'Не умирать до 10:00' } }] }, archive: [], log: [] };
  const played = (from, n, d10) => Array.from({ length: n }, (_, i) => ({ match_id: 700 + from + i, start_time: now - 15000 + (from + i) * 1000, hero: 72, f: { d10 } }));
  const base = { topHero: new Map(), lobby: {}, extra: {} };
  const r1 = updateCoach(state, { ...base, now, games: hard.concat(played(0, 5, 1)) });
  const g1 = r1.view.goals.find((g) => g.key === 'd10');
  assert.strictEqual(g1.status, 'active', 'цель не закрыта на первой ступени');
  assert.strictEqual(g1.target, 0, 'планка выросла');
  assert.deepStrictEqual([g1.ladderInfo.step, g1.ladderInfo.of], [2, 2]);
  assert.strictEqual(g1.games, 0, 'счёт игр начат заново');
  assert.ok(r1.view.events.some((e) => e.kind === 'step'), 'сообщение о пройденной ступени');
  assert.ok(r1.state.plan.createdAt === state.plan.createdAt, 'план не пересоздан по календарю (прошло 40 дней)');
  const snap = JSON.stringify(r1.state);
  const r2 = updateCoach(JSON.parse(snap), { ...base, now: now + 100, games: hard.concat(played(0, 5, 1), played(5, 5, 0)).map((g, i) => (i >= 17 ? { ...g, start_time: now + 10 + i } : g)) });
  assert.strictEqual(r2.view.goals.find((g) => g.key === 'd10').status, 'done', 'на последней ступени цель закрыта');
  assert.ok(r2.view.finished.some((f) => f.key === 'd10'), 'в списке выполненных');
  // смена цели: старая уходит, новая той же темы 14 дней не возвращается
  const r3 = updateCoach(JSON.parse(snap), { ...base, now: now + 50, games: hard.concat(played(0, 5, 1)) }, { replaceKey: 'd10' });
  const old = r3.view.goals.find((g) => g.key === 'd10');
  assert.ok(old.status === 'replaced' && old.userReplaced);
  assert.ok(!r3.view.goals.some((g) => g.key === 'd10' && g.status === 'active'));
});

test('coach: survivability goal from episode — pass only for checked games', () => {
  const now = 1_900_000_000;
  const evidence = { key: 'survivability_purchase', matchId: 5, t: 1500, title: 'Серия смертей без живучести', text: 'С 25:00 ты погиб 3 раза' };
  const games = [{ match_id: 5, start_time: now - 600, hero: 72, f: { survivability_purchase: 0 } }];
  const r = updateCoach(null, { now, games, topHero: new Map(), lobby: {}, extra: {} }, { focusEvidence: evidence });
  const g = r.view.goals[0];
  assert.strictEqual(g.key, 'survivability_purchase');
  assert.strictEqual(g.cmp, 'ge');
  assert.strictEqual(g.target, 1);
  assert.strictEqual(g.evidence.t, 1500);
  assert.strictEqual(g.baseline, 0, 'до цели замечание было');
  const next = [...games, { match_id: 6, start_time: now + 60, hero: 72, f: { survivability_purchase: 1 } }, { match_id: 7, start_time: now + 120, hero: 72, f: { survivability_purchase: null } }, { match_id: 8, start_time: now + 180, hero: 72, f: { survivability_purchase: 0 } }];
  const after = updateCoach(r.state, { now: now + 240, games: next, topHero: new Map(), lobby: {}, extra: {} });
  const goal = after.view.goals.find((x) => x.key === 'survivability_purchase');
  assert.strictEqual(goal.games, 2, 'игра без возможности проверки не считается');
  assert.strictEqual(goal.passed, 1);
  assert.ok(goal.how.includes("3 смерти и больше"));
  assert.ok(goal.rows.every((x) => !/undefined|NaN/.test(x.text)));
});

test('coach: why this goal — only measured facts, wins link only with enough games', () => {
  const now = 1_900_000_000;
  const games = Array.from({ length: 8 }, (_, i) => ({ match_id: 900 + i, start_time: now - (9 - i) * 1000, hero: 72, f: { d10: 2 } }));
  const state = { plan: { createdAt: now - 5000, reason: 'first', goals: [{ key: 'd10', family: 'deaths', area: 'Выживание', cmp: 'le', habit: false, kind: 'fix', title: 'Не больше 1 смерти до 10:00', short: 'смерти до 10:00', tip: 't', target: 1, byHero: null, baseline: 2, ref: 1, gap: 1, status: 'active', startedAt: now - 5000 }] }, archive: [], log: [] };
  const base = { topHero: new Map(), lobby: {}, extra: {}, now, games };
  const rich = updateCoach(state, { ...base, leakStats: { lane_trades: { count: 12, eligible: 29, wrWith: 0.33, wrWithout: 0.53 } } }).view.goals[0].why;
  assert.ok(rich.lines.some((l) => l.kind === 'stat' && /12 из 29/.test(l.text)));
  assert.ok(!rich.lines.some((l) => l.kind === 'compare' && /обычно 2.*— 2/.test(l.text)));
  assert.ok(rich.lines.some((l) => l.kind === 'link' && /33%.*53%/.test(l.text)));
  assert.ok(rich.lines.some((l) => l.kind === 'compare'), 'сравнение с топами');
  assert.ok(/связь, а не доказанная причина/i.test(rich.note));
  const poor = updateCoach(state, { ...base, leakStats: { lane_trades: { count: 3, eligible: 8, wrWith: 0.2, wrWithout: 0.6 } } }).view.goals[0].why;
  assert.ok(!poor.lines.some((l) => l.kind === 'stat' || /Побед в этих играх/.test(l.text)), 'мало игр — личные доли и победы не показываем');
  for (const l of rich.lines.concat(poor.lines)) assert.ok(!/undefined|NaN/.test(l.text), l.text);
});
test('progress: trend only with enough games and a real shift; comparison with tops on your heroes', () => {
  const { progressView, mannWhitneyZ, levelVsTop } = require('../src/core/progress');
  const lo = [10, 12, 11, 13, 12, 10, 11, 12];
  assert.ok(mannWhitneyZ(lo, lo.map((v) => v + 8)) > 3, 'явный сдвиг вверх');
  assert.ok(Math.abs(mannWhitneyZ(lo, lo.slice().reverse())) < 0.5, 'одни и те же значения — без сдвига');
  assert.strictEqual(levelVsTop(20, 20, 'ge'), 'top');
  assert.strictEqual(levelVsTop(18, 20, 'ge'), 'near');
  assert.strictEqual(levelVsTop(10, 20, 'ge'), 'below');
  assert.strictEqual(levelVsTop(1, 3, 'le'), 'top', 'смертей меньше, чем у топов');
  assert.strictEqual(levelVsTop(null, 3, 'le'), null);
  const mk = (i, lh10, d) => ({ match_id: i, start_time: 1_900_000_000 + i * 3000, hero: 72, f: { lh10, d, nw10: 4000 } });
  const games = Array.from({ length: 30 }, (_, i) => mk(i, i < 15 ? 12 + (i % 3) : 22 + (i % 3), i < 15 ? 4 + (i % 2) : 9 + (i % 2)));
  const topHero = new Map([[72, { lh10: { n: 20, med: 24 }, d: { n: 20, med: 5 } }], [73, { lh10: { n: 20, med: 24 } }]]);
  const p = progressView({ games, topHero });
  const lh = p.indicators.find((x) => x.key === 'lh10');
  const dd = p.indicators.find((x) => x.key === 'd');
  assert.strictEqual(lh.trend, 'better');
  assert.strictEqual(dd.trend, 'worse', 'смертей стало больше — хуже');
  assert.strictEqual(lh.vsTop, 'near');
  assert.strictEqual(lh.topText, '24');
  assert.ok(p.enough && p.better >= 1 && p.worse >= 1);
  assert.ok(!p.indicators.find((x) => x.key === 'nw10' && x.trend !== 'same'), 'постоянный показатель — без заметных изменений');
  const few = progressView({ games: games.slice(-12), topHero });
  assert.ok(few.indicators.every((x) => x.trend === 'few'), 'мало игр — вывода о динамике нет');
  assert.ok(!few.enough);
  const noTop = progressView({ games, topHero: new Map() });
  assert.ok(noTop.indicators.every((x) => x.vsTop === null && x.top === null), 'нет данных топов — сравнения нет');
  for (const x of p.indicators) assert.ok(!/undefined|NaN/.test(`${x.recentText} ${x.prevText} ${x.topText}`), x.key);
});

test('achievements: measured only, gaps do not break runs, unlocked ones stay, new ones flagged', () => {
  const { achievementsView, personalRecords } = require('../src/core/achievements');
  const t0 = 1_900_000_000;
  const g = (i, soloDeaths, extra = {}) => ({ match_id: 1000 + i, start_time: t0 + i * 3000, hero: 72, f: soloDeaths === undefined ? {} : { soloDeaths, d10: 1 }, afterLoss: false, gapMin: null, ...extra });
  // 0,0,(нет данных),0,0,0 → серия 5 (игра без данных пропускается), затем 1 обрывает
  const games = [g(0, 0), g(1, 0), g(2, undefined), g(3, 0), g(4, 0), g(5, 0), g(6, 1), g(7, 0)];
  const r = achievementsView({ games, finished: [], now: t0 + 99999 });
  const solo = r.items.find((x) => x.key === 'solo_free');
  assert.strictEqual(solo.value, 5);
  assert.strictEqual(solo.tier, 2, 'серебро: 5 игр подряд');
  assert.strictEqual(solo.unlocked[1].matchId, 1005, 'ступень открыта на игре, где серия достигла порога');
  assert.strictEqual(solo.current, 1);
  assert.strictEqual(solo.next, 8);
  // цели тренера
  const fin = [{ title: 'a', doneAt: t0 + 10 }, { title: 'b', doneAt: t0 + 20 }, { title: 'c', doneAt: t0 + 30 }];
  const goals = achievementsView({ games: [], finished: fin, now: t0 + 99999 }).items.find((x) => x.key === 'goals_done');
  assert.strictEqual(goals.tier, 2);
  assert.strictEqual(goals.unlocked[1].t, t0 + 30, 'серебро (3 цели) — дата закрытия третьей цели');
  // открытое не пропадает, если данных стало меньше; «новое» — пока не просмотрено
  const first = achievementsView({ games, finished: [], now: t0 + 99999 });
  assert.ok(first.anyNew);
  const again = achievementsView({ games: games.slice(0, 3), finished: [], prevUnlocked: first.unlocked, seen: first.unlocked, now: t0 + 99999 });
  const s2 = again.items.find((x) => x.key === 'solo_free');
  assert.strictEqual(s2.tier, 2, 'серебро сохранено');
  assert.ok(!again.anyNew);
  const unseen = achievementsView({ games, finished: [], prevUnlocked: first.unlocked, seen: {}, now: t0 + 99999 });
  assert.ok(unseen.anyNew);
  // победы и заходы ничего не открывают
  const wins = achievementsView({ games: Array.from({ length: 20 }, (_, i) => ({ match_id: i, start_time: t0 + i, hero: 1, won: true, f: { d10: 3, soloDeaths: 3 } })), finished: [] });
  assert.ok(wins.items.every((x) => x.tier === 0), 'победы сами по себе ничего не открывают');
  // паузы после поражения: только игры с известной паузой
  const rest = achievementsView({ games: Array.from({ length: 6 }, (_, i) => ({ match_id: i, start_time: t0 + i * 5000, hero: 1, f: { d10: 3 }, afterLoss: true, gapMin: i % 2 ? 12 : 3 })), finished: [] }).items.find((x) => x.key === 'rest_after_loss');
  assert.strictEqual(rest.value, 3);
  // рекорды: ≥5 прежних игр на герое и +10% к прежнему максимуму
  const recGames = Array.from({ length: 7 }, (_, i) => ({ match_id: i, start_time: t0 + i, hero: 5, f: { lh10: i === 6 ? 40 : 20 + (i % 2) } }));
  const rec = personalRecords(recGames);
  assert.strictEqual(rec.length, 1);
  assert.deepStrictEqual([rec[0].key, rec[0].value, rec[0].before, rec[0].matchId], ['lh10', 40, 21, 6]);
  assert.strictEqual(personalRecords(recGames.slice(0, 5)).length, 0, 'меньше 5 прежних игр — рекорда нет');
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
  assert.ok(vs.rows.every((r) => r.laneSamples <= r.laneGames));
});

test('prepare: thin pairs (fewer than 5 games) marked and kept out of confident tips', () => {
  const { heroVs, prepare, myMatchups } = require('../src/core/matchups');
  const pl = (hero_id, team, won, lane = null) => ({ hero_id, team, won, lane, items: [] });
  const rec = (i, foes, won) => {
    const my = pl(1, 0, won, 1);
    const others = [pl(2, 0, won, 1), ...[3, 4, 5, 6, 7].map((h) => pl(h, 0, won, 2))];
    const enemies = foes.map((h, k) => pl(h, 1, !won, k < 2 ? 1 : 2));
    return { match: { match_id: i, players: [my, ...others, ...enemies] }, player: my };
  };
  // X(10): 4 игры, 1 победа — тонкая пара; Y(11): 5 игр, 2 победы — уверенно тяжёлая; Z(12): 8 игр, 5 побед — уверенно лёгкая
  const recs = [
    rec(1, [10, 11, 12, 33, 34, 35], false),
    rec(2, [10, 11, 12, 33, 34, 35], false),
    rec(3, [10, 11, 12, 33, 34, 35], false),
    rec(4, [10, 11, 12, 33, 34, 35], true),
    rec(5, [11, 12, 33, 34, 35, 36], true),
    rec(6, [12, 33, 34, 35, 36, 37], true),
    rec(7, [12, 33, 34, 35, 36, 37], true),
    rec(8, [12, 33, 34, 35, 36, 37], true),
  ];
  const topVs = heroVs(recs, null, { minGames: 1 });
  const by = (h) => topVs.rows.find((r) => r.hero_id === h);
  assert.strictEqual(by(10).games, 4);
  assert.strictEqual(by(11).games, 5);
  assert.strictEqual(by(12).games, 8);
  // мои две встречи с X
  const me1 = pl(1, 0, true);
  const me2 = pl(1, 0, false);
  const mine = myMatchups([
    { match: { match_id: 101, players: [me1, pl(10, 1, false)] }, me: me1 },
    { match: { match_id: 102, players: [me2, pl(10, 1, true)] }, me: me2 },
  ]);
  const pr = prepare({ myHero: 1, enemies: [10, 11, 12], laneFoe: 10, topVs, mine, heroName: (x) => `H${x}`, itemName: (x) => `I${x}` });
  const row = (h) => pr.rows.find((r) => r.hero_id === h);
  // помечены тонкие выборки
  assert.ok(row(10).thin && row(10).mineThin && row(10).laneThin, 'X: топов < 5, встреч < 5, замеров линии < 5');
  assert.ok(!row(11).thin && !row(12).thin, 'Y и Z: топов в паре достаточно');
  assert.strictEqual(row(10).mineThin, mine.all.find((r) => r.hero_id === 10).games < 5, 'mineThin согласован с числом встреч');
  // тонкая пара не попадает в уверенные советы
  const hard = pr.tips.find((t) => t.title === 'Меньше побед в сохранённых матчах');
  const easy = pr.tips.find((t) => t.title === 'Больше побед в сохранённых матчах');
  assert.ok(hard && /H11/.test(hard.text) && !/H10/.test(hard.text), 'тяжёлый совет — только про Y (5 игр), не про X (4 игры)');
  assert.ok(easy && /H12/.test(easy.text), 'лёгкий совет — про Z');
  // личный опыт с 2 встречами — показан, но с пометкой
  const my = pr.tips.find((t) => t.title === 'Твой опыт против H10');
  assert.ok(my, 'совет про свой опыт есть (порог показа ≥ 2)');
  assert.ok(/мало/.test(my.text) && /1–1/.test(my.text), 'счёт честный и помечен как малая выборка');
  assert.strictEqual(my.kind, 'info', 'малая выборка показывается без положительной или отрицательной оценки');
  // без line-данных (нет stats) линия тонкая, но не падает
  assert.ok(pr.rows.every((r) => typeof r.laneThin === 'boolean'));
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

test('ranked hero progress counts 34, 35 and 36 points in Standard only', () => {
  const { heroPool, RANKED_HERO_RULE } = require('../src/core/pick');
  const from = RANKED_HERO_RULE.from;
  const now = from + 2 * 86400;
  const rows = [];
  for (const [heroId, wins, losses] of [[1, 17, 0], [2, 17, 1], [3, 18, 0]]) {
    for (let i = 0; i < wins + losses; i++) {
      rows.push({ match_id: rows.length + 1, hero_id: heroId, game_mode: 1, match_mode: 1, start_time: from + i,
        match_result: i < wins ? 0 : 1, player_team: 0 });
    }
  }
  const base = { ...rows[0], match_id: 100 };
  rows.push(rows[0], { ...base, match_mode: 2 }, { ...base, match_id: 101, match_mode: 3 },
    { ...base, match_id: 102, match_mode: 7 }, { ...base, match_id: 103, game_mode: 2 },
    { ...base, match_id: 104, match_result: null }, { ...base, match_id: 105, player_team: null },
    { ...base, match_id: 106, match_mode: null }, { ...base, match_id: 107, start_time: from - 1 },
    { ...base, match_id: 108, start_time: RANKED_HERO_RULE.until }, { ...base, match_id: 109, start_time: now + 1 },
    { ...base, match_id: null }, { ...base, match_id: 110, game_mode: null });
  const data = heroPool(rows, { now });
  const byId = new Map(data.all.map((h) => [h.hero_id, h]));
  assert.deepStrictEqual([1, 2, 3].map((id) => byId.get(id).unlockPoints), [34, 35, 36]);
  assert.deepStrictEqual([1, 2, 3].map((id) => byId.get(id).rankedEvidence), ['unknown', 'points', 'points']);
  assert.deepStrictEqual(data.pool.map((h) => h.hero_id).sort(), [2, 3]);
});

test('ranked history evidence and incomplete progress remain distinct from manual selection', () => {
  const { heroPool, RANKED_HERO_RULE } = require('../src/core/pick');
  const from = RANKED_HERO_RULE.from;
  const rows = Array.from({ length: 5 }, (_, i) => ({ match_id: i + 1, hero_id: 7, game_mode: 1, start_time: from - i, won: true }));
  const options = { now: from + 86400 };
  assert.strictEqual(heroPool(rows, options).pool[0].rankedEvidence, 'unknown');
  rows.push({ match_id: 10, hero_id: 8, game_mode: 1, match_mode: 4, start_time: from - 1 });
  const automatic = heroPool(rows, options).pool[0];
  assert.deepStrictEqual([automatic.hero_id, automatic.unlockPoints, automatic.rankedEvidence], [8, 0, 'played']);
  const manual = heroPool([], { ...options, manual: [88, 86] });
  assert.deepStrictEqual(manual.pool.map((h) => [h.hero_id, h.rankedEvidence]), [[88, 'unknown'], [86, 'unknown']]);
});

test('saved history does not turn an unknown match result into ranked unlock points', () => withStoreDir(async (dir) => {
  const { Sync } = require('../src/main/sync');
  const { heroPool, RANKED_HERO_RULE } = require('../src/core/pick');
  const store = new Store(dir);
  const from = RANKED_HERO_RULE.from;
  await store.putMatch({ match_id: 123, game_mode: 1, match_mode: 1, winning_team: null, start_time: from,
    players: [{ account_id: 42, hero_id: 1, team: 0, won: false }] });
  await store.putMatch({ match_id: 124, game_mode: 1, match_mode: 1, winning_team: 1, start_time: from,
    players: [{ account_id: 42, hero_id: 1, team: 0, won: false }] });
  const sync = new Sync({ store, api: { matchHistory: async () => { throw new Error('offline'); } } });
  const history = await sync.myHistory(42);
  assert.strictEqual(history.find((r) => r.match_id === 123).match_result, null);
  assert.strictEqual(history.find((r) => r.match_id === 124).match_result, 1);
  assert.strictEqual(heroPool(history, { now: from + 1 }).all[0].unlockPoints, 1);
}));

test('dashboard can show API history before the large match pack is ready', async () => {
  const { Sync } = require('../src/main/sync');
  const store = { read: () => null, loadInfo: { files: 0 }, ready: new Promise(() => {}) };
  const history = [{ match_id: 1, hero_id: 72, start_time: Math.floor(Date.now() / 1000), game_mode: 1, match_mode: 4, player_team: 0, match_result: 0 }];
  const dashboard = await new Sync({ store, api: { matchHistory: async () => history } }).dashboard(7);
  assert.strictEqual(dashboard.source, 'api');
  assert.strictEqual(dashboard.latest.hero_id, 72);
});

test('hero summary opens saved games without the API and keeps them on download failure', () => withStoreDir(async (dir) => {
  const { Sync } = require('../src/main/sync');
  const store = new Store(dir);
  const m = matches[0];
  const p = m.players[0];
  await store.putMatch(m);
  let historyCalls = 0;
  let detailsCalls = 0;
  const api = {
    matchHistory: async () => {
      historyCalls++;
      return [
        { match_id: m.match_id, hero_id: p.hero_id, start_time: m.start_time, game_mode: 1, match_mode: 1 },
        { match_id: 314159, hero_id: p.hero_id, start_time: m.start_time + 1, game_mode: 1, match_mode: 1, match_result: 0, player_team: 0 },
      ];
    },
    matchMetadata: async (_matchId, { signal }) => {
      detailsCalls++;
      assert.ok(signal instanceof AbortSignal);
      throw new Error('Service unavailable');
    },
  };
  const sync = new Sync({ store, api });
  const cached = await sync.heroSummary(p.account_id, p.hero_id, { cachedOnly: true });
  assert.deepStrictEqual([cached.games, cached.loaded, historyCalls, detailsCalls], [1, 1, 0, 0]);
  const refreshed = await sync.heroSummary(p.account_id, p.hero_id);
  assert.deepStrictEqual([refreshed.games, refreshed.loaded, historyCalls, detailsCalls, refreshed.partial], [2, 1, 1, 1, true]);
  assert.deepStrictEqual(refreshed.list.map((x) => x.loaded), [false, true]);
  assert.strictEqual(store.hasMatch(m.match_id), true);
}));

test('match history opens from disk without a request and merges online and saved rows by ID', () => withStoreDir(async (dir) => {
  const { Sync } = require('../src/main/sync');
  const store = new Store(dir);
  const m = matches[0];
  const account = m.players[0].account_id;
  await store.putMatch(m);
  let apiCalls = 0;
  const same = { match_id: m.match_id, start_time: m.start_time, hero_id: m.players[0].hero_id };
  const recent = { match_id: 80001, start_time: m.start_time + 1, hero_id: 1 };
  const api = { matchHistory: async (_id, _ttl, { signal }) => {
    apiCalls++;
    assert.ok(signal instanceof AbortSignal);
    return [same, same, recent];
  } };
  const sync = new Sync({ store, api });
  const saved = await sync.myMatches(account, { cachedOnly: true });
  assert.deepStrictEqual([saved.source, saved.checkedAt, saved.list.length, apiCalls], ['saved', null, 1, 0]);
  const online = await sync.myMatches(account);
  assert.strictEqual(online.source, 'api');
  assert.deepStrictEqual(online.list.map((x) => [x.match_id, x.loaded]), [[80001, false], [m.match_id, true]]);
  assert.strictEqual(apiCalls, 1);
  api.matchHistory = async () => [];
  assert.deepStrictEqual((await sync.myMatches(account)).list.map((x) => x.match_id), [m.match_id]);
}));

test('Steam rate limit is reported while normal history uses the same time budget', () => withStoreDir(async (dir) => {
  const { Sync } = require('../src/main/sync');
  const store = new Store(dir);
  const m = matches[0];
  const account = m.players[0].account_id;
  await store.putMatch(m);
  let originalSignal;
  const api = {
    matchHistoryFresh: async (_id, { signal }) => { originalSignal = signal; throw Object.assign(new Error('rate-limited'), { code: 429 }); },
    matchHistory: async (_id, _ttl, { signal }) => { assert.strictEqual(signal, originalSignal); throw new Error('offline'); },
  };
  const result = await new Sync({ store, api }).myMatches(account, { fresh: true });
  assert.deepStrictEqual([result.fresh.limited, result.source, result.list[0].match_id], [true, 'saved', m.match_id]);
}));

test('pending Steam matches preserve another account and entries added during a request', () => withStoreDir(async (dir) => {
  const { Sync } = require('../src/main/sync');
  const store = new Store(dir);
  const account = 123;
  const at = Date.now();
  store.write('pending.json', [{ match_id: 70001, accountId: account, at }, { match_id: 70002, accountId: 456, at }]);
  const api = {
    matchHistory: async () => [],
    matchMetadataOnce: async (id) => {
      assert.strictEqual(id, 70001);
      store.write('pending.json', [...store.read('pending.json', []), { match_id: 70003, accountId: account, at }]);
      throw new Error('still processing');
    },
  };
  const sync = new Sync({ store, api });
  const cached = await sync.myMatches(account, { cachedOnly: true });
  assert.deepStrictEqual(cached.list.map((x) => x.match_id), [70001]);
  assert.strictEqual(store.read('pending.json')[0].tried, undefined);
  const result = await sync.myMatches(account);
  assert.deepStrictEqual(result.list.map((x) => x.match_id), [70001, 70003]);
  assert.deepStrictEqual(store.read('pending.json').map((x) => x.match_id), [70001, 70002, 70003]);
  assert.ok(store.read('pending.json')[0].tried >= at);
}));

test('pregame plan uses saved matches on the selected hero without requesting history', () => withStoreDir(async (dir) => {
  const { Sync } = require('../src/main/sync');
  const store = new Store(dir);
  const match = matches[0];
  const player = match.players[0];
  const foe = match.players.find((p) => p.team !== player.team);
  const otherHero = player.hero_id + 1000;
  await store.putMatch({ ...match, game_mode: 1, match_mode: 1 });
  await store.putMatch({ ...match, match_id: match.match_id + 1000, game_mode: 1, match_mode: 1,
    players: [{ ...player, hero_id: otherHero, won: !player.won }, ...match.players.slice(1)] });
  await store.putMatch({ ...match, match_id: match.match_id + 2000, game_mode: 1, match_mode: 2 });
  let requests = 0;
  const api = { matchHistory: async () => { requests++; throw new Error('History unavailable'); } };
  const sync = new Sync({ store, api });
  const opts = { enemies: [foe.hero_id], laneFoe: foe.hero_id };
  const first = await sync.prepareGame(player.account_id, { ...opts, myHero: player.hero_id });
  assert.strictEqual(first.myGames, 1);
  assert.strictEqual(first.rows[0].mine.games, 1);
  assert.strictEqual(first.rows[0].mine.wins, Number(player.won));
  const second = await sync.prepareGame(player.account_id, { ...opts, myHero: otherHero });
  assert.strictEqual(second.rows[0].mine.wins, Number(!player.won));
  const empty = await sync.prepareGame(player.account_id, { ...opts, myHero: otherHero + 1 });
  assert.strictEqual(empty.myGames, 0);
  assert.strictEqual(empty.rows[0].mine, null);
  assert.strictEqual(requests, 0);
}));

test('saved episode opens without waiting for a route download', () => withStoreDir(async (dir) => {
  const { Sync } = require('../src/main/sync');
  const store = new Store(dir);
  const match = { ...matches[0], game_mode: 1, match_mode: 4, paths: null, pathsTried: false };
  const player = match.players[0];
  await store.putMatch(match);
  const other = { ...player, account_id: player.account_id + 1000 };
  store.write('top.json', { players: [{ accountId: other.account_id }] });
  await store.putMatch({ ...match, match_id: match.match_id + 1000, match_mode: 1, players: [other, ...match.players.slice(1)] });
  await store.putMatch({ ...match, match_id: match.match_id + 1001, players: [other, ...match.players.slice(1)] });
  let requests = 0;
  const api = { matchMetadata: async () => { requests++; throw new Error('Offline'); } };
  const sync = new Sync({ store, api });
  const analysis = await sync.analyzeMatch({ matchId: match.match_id, accountId: player.account_id, preferSaved: true });
  assert.strictEqual(analysis.match.match_id, match.match_id);
  assert.strictEqual(analysis.map.paths, null);
  assert.strictEqual(analysis.benchMode, 4);
  assert.strictEqual(analysis.result.benchN, 1);
  assert.strictEqual(requests, 0);
  assert.strictEqual(store.getMatch(match.match_id).pathsTried, false);
}));

test('saved match exports even if the published-build service is unavailable', () => withStoreDir(async (dir) => {
  const { Sync } = require('../src/main/sync');
  const { decodeBuildCode } = require('../src/core/gameCode');
  const store = new Store(dir);
  const match = matches[0];
  const player = match.players[0];
  await store.putMatch(match);
  store.write('auth.json', { accountId: player.account_id, name: 'Игрок' });
  store.write('assets.json', { ...assets, heroes: { [player.hero_id]: { id: player.hero_id, name: 'Герой' } } });
  let suggestions = 0;
  const api = { builds: async (_hero, { signal }) => {
    assert.ok(signal instanceof AbortSignal);
    suggestions++;
    throw new Error('Offline');
  } };
  const sync = new Sync({ store, api });
  const build = await sync.matchBuild(match.match_id, player.account_id);
  assert.deepStrictEqual([build.playerName, build.similar.length, build.similarError, suggestions], ['Игрок', 0, 'Offline', 1]);
  const exported = sync.buildExportText(build);
  assert.strictEqual(decodeBuildCode(exported.gameCode).heroId, player.hero_id);
  assert.ok(exported.file.hero_build.details.mod_categories.length > 0);
}));

test('hero catalog upgrades explicit selectability and retains the old catalog offline', () => withStoreDir(async (dir) => {
  const { Sync } = require('../src/main/sync');
  const store = new Store(dir);
  const old = { v: 6, fetchedAt: Date.now(), heroes: { 88: { id: 88, inDev: true } }, items: {} };
  store.write('assets.json', old);
  const offline = async () => { throw new Error('offline'); };
  const api = { heroesAssets: offline, itemsAssets: async () => [], mapAssets: async () => null, ranksAssets: async () => [] };
  const sync = new Sync({ store, api });
  assert.deepStrictEqual(await sync.loadAssets(), old);
  let finish;
  api.heroesAssets = () => new Promise((resolve) => { finish = resolve; });
  const pending = sync.loadAssets();
  assert.strictEqual(sync.loadAssets(), pending);
  assert.deepStrictEqual(sync.assets, old);
  finish([
    { id: 88, name: 'Baba', in_development: true, player_selectable: true, development_state: 'release', colors: { ui: [22, 63, 91] } },
    { id: 86, name: 'Violet', in_development: true, development_state: 'release' },
    { id: 89, player_selectable: false, development_state: 'release' },
    { id: 90, development_state: 'unreleased' },
    { id: 91, disabled: true, player_selectable: true },
  ]);
  const updated = await pending;
  assert.strictEqual(updated.v, 8);
  assert.deepStrictEqual(updated.heroes[88].color, [22, 63, 91]);
  assert.deepStrictEqual(Object.values(updated.heroes).filter((x) => !x.disabled && x.selectable).map((x) => x.id), [86, 88]);
  api.heroesAssets = offline;
  assert.deepStrictEqual(await sync.loadAssets(true), updated);
}));

test('pick advice: best pick vs enemies, keep/swap verdict, pool rules', () => {
  const { heroPool, pickAdvice, gamePlan, buildPickMeta, pairDelta, heroRole, teamComp, mixMatchup, MY_SHARE, RANKED_HERO_RULE } = require('../src/core/pick');
  const now = RANKED_HERO_RULE.from + 100 * 86400;
  const hist = [];
  const push = (hero, n, wins, { mode = 4, t = now - 86400 } = {}) => {
    for (let i = 0; i < n; i++) hist.push({ match_id: hist.length + 1, hero_id: hero, won: i < wins, game_mode: 1, match_mode: mode, start_time: t - i });
  };
  push(1, 30, 18); push(2, 25, 16); push(3, 20, 15, { mode: 1, t: now - 80 * 86400 }); push(4, 2, 1); push(4, 4, 2); push(5, 1, 1);
  const hp = heroPool(hist, { now });
  assert.deepStrictEqual(hp.pool.map((p) => p.hero_id).sort(), [1, 2, 4], 'свидетельство рейтинга или 35 очков, недавние игры в приоритете');
  assert.deepStrictEqual(hp.inactive.map((p) => p.hero_id).sort(), [3, 5], 'давно не играл / одна игра — отдельно');
  assert.strictEqual(hp.inactive.find((p) => p.hero_id === 3).lastDays, 80);
  assert.deepStrictEqual(heroPool(hist, { manual: [3, 5], now }).pool.map((p) => p.hero_id), [3, 5], 'ручной список');

  // роли из справочника
  assert.strictEqual(heroRole({ type: 'brawler', tags: [] }), 'tank');
  assert.strictEqual(heroRole({ type: null, tags: ['Teamplay'] }), 'support');
  assert.strictEqual(heroRole({ type: 'mystic', tags: ['Inventor', 'Support'] }), 'support');
  assert.strictEqual(heroRole({ type: 'mystic', tags: [] }), 'spirit');
  assert.strictEqual(heroRole({ type: 'assassin', tags: [] }), 'gun');
  assert.deepStrictEqual(teamComp(['gun', 'gun', 'spirit']).missing, ['tank', 'support']);

  // мета: сила героев и пары
  const stats = [
    { hero_id: 1, wins: 4700, matches: 10000 }, // слабый: 47%
    { hero_id: 2, wins: 5300, matches: 10000 }, // сильный: 53%
    { hero_id: 4, wins: 5000, matches: 10000 },
    { hero_id: 10, wins: 5000, matches: 10000 },
    { hero_id: 11, wins: 5000, matches: 10000 },
    { hero_id: 30, wins: 5000, matches: 10000 },
  ];
  const counters = [
    { hero_id: 1, enemy_hero_id: 10, wins: 6000, matches_played: 10000 }, // сильный контр: +13% сырых → после стягивания ≈ +6%, потолок 3%
    { hero_id: 2, enemy_hero_id: 10, wins: 530, matches_played: 1000 },
    { hero_id: 4, enemy_hero_id: 10, wins: 400, matches_played: 1000 },
  ];
  const synergy = [{ hero_id1: 2, hero_id2: 30, wins: 600, matches_played: 1000 }];
  const laneSouls = [{ h: 2, e: 10, n: 400, d: -600 }, { h: 2, e: 11, n: 20, d: 900 }];
  const pm = buildPickMeta({ stats, counters, synergy, laneSouls, badge: 91 });
  assert.ok(pm.with[30][2] && pm.with[2][30], 'связки в обе стороны');
  assert.ok(pm.souls[2][10] && !pm.souls[2][11], 'души: малые выборки отброшены');
  const pd = pairDelta(pm, 'vs', 2, 10, -1);
  assert.ok(pd.d > 0 && pd.d < 0.003, 'пара с тысячей игр почти не влияет (реальный разброс пар ~0,5%)');
  const roles = { 1: 'gun', 2: 'gun', 4: 'tank', 10: 'gun', 11: 'spirit', 30: 'gun', 31: 'gun', 32: 'spirit' };
  const a = pickAdvice({ pool: hp.pool, pm, roles, enemies: [10, 11], current: 1 });
  const r1 = a.all.find((r) => r.hero_id === 1);
  const r2 = a.all.find((r) => r.hero_id === 2);
  assert.strictEqual(a.rows[0].hero_id, 2, 'сильный герой впереди');
  assert.ok(r1.weak && !r2.weak, 'слабый в патче помечен');
  assert.ok(r1.parts.find((x) => x.hero_id === 10).d === 0.03, 'один соперник — не больше 3%');
  assert.ok(Math.abs(r2.chance - (0.5 + r2.score)) < 1e-9 && r2.chance > 0.5);
  assert.ok(a.verdict && !a.verdict.keep && a.verdict.hero_id === 2 && a.verdict.from === 1);
  const keep = pickAdvice({ pool: hp.pool, pm, roles, enemies: [10, 11], current: 2 });
  assert.ok(keep.verdict.keep, 'уже на лучшем — оставаться');
  const taken = pickAdvice({ pool: hp.pool, pm, roles, enemies: [10, 2] });
  assert.ok(!taken.rows.some((r) => r.hero_id === 2), 'занятого героя не советуем');

  // состав: нет танка у союзников — танку +2%; три стрелка — четвёртому −1,5%
  const comp = pickAdvice({ pool: hp.pool, pm, roles, enemies: [10], allies: [30, 31, 32] });
  assert.strictEqual(comp.all.find((r) => r.hero_id === 4).compD, 0.02);
  assert.strictEqual(comp.all.find((r) => r.hero_id === 2).compD, 0);
  assert.deepStrictEqual(comp.comp.missing, ['tank', 'support']);
  const heavy = pickAdvice({ pool: hp.pool, pm, roles: { ...roles, 32: 'gun', 33: 'tank' }, enemies: [10], allies: [30, 31, 32, 33] });
  assert.strictEqual(heavy.all.find((r) => r.hero_id === 2).compD, -0.015);

  // линия: души к 9-й минуте и план
  const ln = pickAdvice({ pool: hp.pool, pm, roles, enemies: [10, 11], allies: [30], laneEnemies: [10, 99], partner: 30 });
  assert.deepStrictEqual(ln.laneEnemies, [10], 'на линии только отмеченные соперники');
  const l2 = ln.all.find((r) => r.hero_id === 2);
  assert.ok(l2.lanes.length === 1 && l2.lanes[0].souls < -400 && l2.lanes[0].souls > -600, 'души стянуты к нулю немного');
  assert.ok(l2.mates.length === 1 && l2.mates[0].partner, 'напарник по линии');
  const counterItems = { 10: [{ id: 500, lift: 1.9 }], 11: [{ id: 500, lift: 1.6 }, { id: 501, lift: 1.5 }] };
  const plan = gamePlan({ row: l2, counters: counterItems, leak: { title: 'X', count: 3, games: 10 }, laneEnemies: ln.laneEnemies });
  assert.ok(plan.lane.known && plan.lane.list[0].hero_id === 10);
  const plan2 = gamePlan({ row: l2, counters: counterItems });
  assert.ok(!plan2.lane.known && plan2.lane.hard[0].hero_id === 10, 'без отметки: «если попадётся на линии»');
  assert.deepStrictEqual(plan2.items.map((x) => x.id), [500], 'предметы — от известных соперников, без повторов');
  assert.strictEqual(plan.leak.title, 'X');

  // без меты — запасной вариант по старым таблицам
  const old = pickAdvice({ pool: hp.pool, tables: { 1: { vs: { 10: { pro: -0.02 } } }, 2: { vs: { 10: { pro: 0.02 } } } }, enemies: [10], current: 1 });
  assert.strictEqual(old.rows[0].hero_id, 2);
  assert.strictEqual(MY_SHARE, 0.2);
  assert.ok(Math.abs(mixMatchup({ pro: 0.1, mine: -0.1 }) - 0.06) < 1e-9, '0.8·0.1 + 0.2·(−0.1)');
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
      { name: 'DeadlockCoach-Setup-0.9.0.exe', browser_download_url: 'https://x/s.exe', size: 6, digest: 'sha256:7192385c3c0605de55bb9476ce1d90748190ecb32a8eed7f5207b30cf6a1fe89' },
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
  // как в игре: героев много — 4 с образцами и 30 «чужих» со случайными образцами
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 255;
  const noise = () => Float32Array.from({ length: P.GW * P.GH * 3 }, rnd);
  const others = Array.from({ length: 30 }, (_, k) => ({ id: 100 + k, learned: [noise()] }));
  const heroes = [10, 11, 12, 13].map((id, k) => ({ id, learned: [feats[k]] })).concat(others);
  const res = P.assignHeroes(feats, heroes);
  assert.deepStrictEqual(res.map((r) => r.id), [10, 11, 12, 13]);
  assert.ok(res.every(P.confident), JSON.stringify(res.map((r) => [r.score, r.margin])));
  // неизвестный герой: образцов нет → не уверены
  const res2 = P.assignHeroes(feats, [{ id: 10, learned: [feats[0]] }, { id: 99, learned: [] }].concat(others));
  assert.ok(P.confident(res2[0]) && !res2.slice(1).some((r) => r && P.confident(r)), JSON.stringify(res2.map((r) => [r.id, r.score, r.margin])));
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
  assert.ok(P.confident({ score: 2.0, margin: 0.86 }) && !P.confident({ score: 2.1, margin: 0.6 }) && !P.confident({ score: 1.5, margin: 1.2 }));
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
  assert.ok(/900/.test(lt.text) && /3\s000/.test(lt.text) && /H26/.test(lt.context), 'урон в наблюдении и матчап отдельно');
  assert.strictEqual(lt.moments.length, 2);
  assert.ok(keys.includes('farm_while_fight'), 'лес во время проигранных драк');
  const fw = leaks.find((l) => l.key === 'farm_while_fight');
  assert.strictEqual(fw.moments.length, 2);
  assert.strictEqual(fw.cost.allyDeaths, 4);
  assert.ok(/19 с по прямой/.test(fw.moments[0].text), `оценка по прямой: ${fw.moments[0].text}`);
  assert.match(fw.context, /приблизительную оценку/);
  assert.ok(keys.includes('map_timings'), 'тайминги карты');
  assert.ok(/у игроков Ascendant\+/.test(leaks.find((l) => l.key === 'map_timings').text));
  assert.ok(!keys.includes('sinner'), 'урна душ — командная, личной ошибкой не считается');
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

  // ---- сильные моменты ----
  const gm = JSON.parse(JSON.stringify(mm));
  const gme = gm.players[0];
  gme.deaths = []; gme.deaths_t = []; gme.d = 0;
  gme.stats = [{ t: 540, nw: 7000, d: 0, g_lost: 0, g_brk: 900, g_neutral: 800, k: 2, a: 0 }, { t: 1200, nw: 20000, d: 0, g_lost: 0, g_brk: 2600, g_neutral: 3200, k: 4, a: 1 }, { t: 1800, nw: 30000, d: 0, g_lost: 0, g_brk: 3000, g_neutral: 4000, k: 5, a: 2 }];
  gme.pu = [[200, 'hp'], [260, 'hp'], [300, 'cd'], [400, 'wp'], [500, 'hp'], [580, 'cd']];
  gm.dmg = { t: [180, 360, 540, 1800], d: { '0>6': [900, 2000, 3500, 9000], '6>0': [300, 800, 1500, 4000] } };
  gm.players[6].deaths = [[300, 0, 0, 0, 0, 0], [1000, 100, 0, 0, 0, 0]];
  gm.players[7].deaths = [[1006, 120, 0, 0, 0, 0]];
  gm.players[8].deaths = [[1010, 90, 0, 0, 0, 0]];
  for (const pl of gm.players) gm.paths.players[pl.slot] = mkPath((t) => [0, 0, 1, pl.slot === 0 && t >= 990 && t <= 1015 ? 1 : 0, pl.slot === 0 && t >= 995 && t <= 1005 ? 15 : 100]);
  const hl = L.gameHighlights({ m: gm, me: gme, f: pf(gme, gm, null), ref: null, tier: 5, heroName: (x) => `H${x}`, itemName: (x) => `I${x}` });
  const hk = hl.map((x) => x.key);
  assert.ok(hk.includes('lane_won'), `размены выиграны: ${hk}`);
  assert.strictEqual(hl.find((x) => x.key === 'lane_won').moments[0].t, 300);
  assert.ok(hk.includes('multikill') && /Тройное/.test(hl.find((x) => x.key === 'multikill').title), 'серия из трёх убийств');
  assert.ok(hk.includes('map_good') && hk.includes('few_deaths'));
  assert.ok(hl.every((x) => x.level === 'good' && x.keep && !/undefined|NaN/.test(x.title + x.text)), 'у каждого — что закрепить');
  assert.ok(hl.length <= 5);
  assert.ok(!L.gameHighlights({ m: mm, me, f: fm, tier: 5 }).some((x) => x.key === 'lane_won' || x.key === 'lane_clean'), 'за проигранную линию не хвалим');

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
  assert.strictEqual(prof.goal.title, 'Не больше одной смерти до 10:00');
  assert.ok(prof.goal.episode.t >= 0 && [1, 2].includes(prof.goal.episode.matchId));
  assert.strictEqual(L.leakProfile(games.filter((g) => g.match_id !== 2)).goal, null);
  const noTime = games.map((g) => ({ ...g, leaks: g.leaks.map((l) => ({ ...l, moments: [] })) }));
  assert.strictEqual(L.leakProfile(noTime).goal, null);
  const coverage = L.leakProfile(games.map((g) => ({
    ...g, checked: g.match_id === 3 ? ['lane_trades'] : [],
  })));
  const coveredLane = coverage.rows.find((r) => r.key === 'lane_trades');
  assert.deepStrictEqual([coveredLane.count, coveredLane.eligible, coveredLane.unknown], [2, 3, 2]);
  assert.strictEqual(coveredLane.share, 2 / 3);
  assert.strictEqual(coveredLane.wrWithout, null);
  assert.strictEqual(coverage.goal.eligible, 3);

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

test('survivability purchase: streak of deaths without a vitality item', () => {
  const L = require('../src/core/leaks');
  const { playerFeatures: pf } = require('../src/core/features');

  // каталог: 11 — живучесть 1 500, 13 — живучесть 2 000, 12 — оружие 3 000
  const assets = { items: {
    11: { id: 11, name: 'Барьер', slot: 'vitality', cost: 1500, tier: 2 },
    13: { id: 13, name: 'Кираса', slot: 'vitality', cost: 2000, tier: 3 },
    12: { id: 12, name: 'Резак', slot: 'weapon', cost: 3000, tier: 3 },
  } };
  const mkMatch = ({ deaths, items, duration = 1800, end }) => {
    const players = [];
    for (let i = 0; i < 12; i++) {
      const team = i < 6 ? 0 : 1;
      players.push({ account_id: 1 + i, hero_id: 20 + i, team, slot: i, lane: 1, won: team === 1, k: 0, d: 0, a: 0, nw: 20000,
        items: i === 0 ? items : [], deaths: i === 0 ? deaths : [], deaths_t: (i === 0 ? deaths : []).map((d) => d[0]), pu: [],
        stats: [{ t: 540, nw: 6000, d: 2, g_lost: 0, g_brk: 600, g_neutral: 600, k: 0, a: 0 }, { t: 1800, nw: 24000, d: deaths.length, g_lost: 1500, g_brk: 2600, g_neutral: 4000, k: 0, a: 0 }] });
    }
    const m = { match_id: 42, start_time: 1, duration_s: end ?? duration, players, badge: [52, 52], dmg: { t: [180, 1800], d: {} } };
    const me = players[0];
    const f = pf(me, m, assets);
    const checked = new Set();
    const leaks = L.gameLeaks({ m, me, f, ref: null, tier: 5, assets, checked, heroName: (x) => `H${x}`, itemName: (x) => assets.items[x].name });
    return { leaks, checked, m, me, f };
  };

  // 1) серия из 3 смертей после 10:00, покупался только урон — утечка есть
  const deaths = [[700, 0, 0, 6, 0, 0], [830, 0, 0, 7, 0, 0], [950, 0, 0, 6, 0, 0]];
  const r1 = mkMatch({ deaths, items: [[12, 1000, 0, 0]] });
  const lk = r1.leaks.find((l) => l.key === 'survivability_purchase');
  assert.ok(lk, 'утечка после серии без живучести');
  assert.strictEqual(lk.area, 'Предметы');
  assert.strictEqual(lk.moments.length, 3, 'момент на каждую смерть серии');
  assert.strictEqual(lk.cost.deaths, 3);
  assert.ok(/H26/.test(lk.moments[0].text) && /H27/.test(lk.moments[1].text), 'имена убийц в моментах');
  assert.ok(/Резак/.test(lk.text) && /не в живучесть/.test(lk.text), 'показано, куда ушли души');
  assert.ok(/гипотеза/.test(lk.context), 'помечено как гипотеза, а не факт');
  assert.ok(/за 4 минуты/.test(lk.text) && !/[.] [а-я]/.test(lk.text), 'серия описана по фактическому сроку, без строчной буквы после точки: ' + lk.text);
  assert.ok(r1.checked.has('survivability_purchase'), 'игра помечена проверяемой');
  assert.ok(!/undefined|NaN/.test(lk.title + lk.text + lk.moments.map((x) => x.text).join('')), 'нет undefined/NaN');
  // серия входит в цель тренера (нужно ≥2 игры с доказательством)
  const mkGame = (mid, ls, ck) => ({ match_id: mid, start_time: mid, won: false, hero: 20, leaks: ls, checked: ck });
  const prof = L.leakProfile([mkGame(42, r1.leaks, [...r1.checked]), mkGame(43, r1.leaks, [...r1.checked])]);
  const row = prof.rows.find((x) => x.key === 'survivability_purchase');
  assert.ok(row, 'строка в общем профиле');
  assert.strictEqual(row.deaths, 6);
  // наблюдение (цена не подтверждена на больших данных): цель тренера не создаёт, уровень «info», «чего не хватает» названо
  assert.strictEqual(row.status, 'observation');
  assert.strictEqual(lk.status, 'observation');
  assert.strictEqual(lk.level, 'info');
  assert.ok(/Чего не хватает/.test(lk.context), 'сказано, чего не хватает для уверенности');
  assert.strictEqual(prof.goal, null, 'цель тренера из наблюдения не создаётся');

  // 2) живучесть куплена после начала серии — утечки нет
  const r2 = mkMatch({ deaths, items: [[12, 1000, 0, 0], [11, 1020, 0, 0]] });
  assert.ok(!r2.leaks.some((l) => l.key === 'survivability_purchase'), 'живучесть после серии — не утечка');
  assert.ok(r2.checked.has('survivability_purchase'), 'игра всё равно проверяемая');

  // 3) к началу серии уже было 2 предмета живучести — «купи ещё» не показываем
  const r3 = mkMatch({ deaths, items: [[11, 300, 0, 0], [13, 500, 0, 0], [12, 1000, 0, 0]] });
  assert.ok(!r3.leaks.some((l) => l.key === 'survivability_purchase'), 'живучесть уже собрана — без совета');

  // 4) смерти растянуты (порог 4 минуты между соседними) — не серия
  const r4 = mkMatch({ deaths: [[700, 0, 0, 6, 0, 0], [1500, 0, 0, 7, 0, 0], [2200, 0, 0, 6, 0, 0]], items: [[12, 1000, 0, 0]], duration: 2400 });
  assert.ok(!r4.leaks.some((l) => l.key === 'survivability_purchase'), 'смерти не подряд — не серия');

  // 5) после последней смерти не осталось 90 секунд игры — не проверяем
  const r5 = mkMatch({ deaths: [[700, 0, 0, 6, 0, 0], [830, 0, 0, 7, 0, 0], [950, 0, 0, 6, 0, 0]], items: [[12, 1000, 0, 0]], end: 1000 });
  assert.ok(!r5.leaks.some((l) => l.key === 'survivability_purchase'), 'нет окна на покупку — без совета');

  // 6) каталог не загружен — утечки нет (и «чисто» тоже не заявляем)
  const noAssets = L.gameLeaks({ m: r1.m, me: r1.me, f: r1.f, ref: null, tier: 5, assets: null, heroName: (x) => `H${x}`, itemName: (x) => `I${x}` });
  assert.ok(!noAssets.some((l) => l.key === 'survivability_purchase'), 'без каталога — без утечки');
});

test('counter codex: picks, items, rules, small samples, stale, hero switch, false counter item', () => {
  const C = require('../src/core/counters');
  const { RULES } = require('../src/core/counterRules');

  // синтетическая мета: 50 героев, ~50% побед; герой 5 сильный (55%),
  // герой 2 выигрывает против него 62% — это и есть контрпик
  const heroes = Array.from({ length: 50 }, (_, i) => i + 1);
  const pm = { v: 1, badge: 81, since: 1000, at: 2000, games: 100000, base: {}, vs: {}, lane: {}, with: {}, duo: {}, souls: {} };
  for (const h of heroes) {
    pm.base[h] = [500, 1000];
    pm.vs[h] = {};
    pm.lane[h] = {};
    pm.souls[h] = {};
    for (const e of heroes) {
      if (e === h) continue;
      pm.vs[h][e] = [500, 1000];
      pm.lane[h][e] = [150, 300];
      pm.souls[h][e] = [0, 300];
    }
  }
  pm.base[5] = [550, 1000];
  pm.vs[2][5] = [620, 1000];
  pm.lane[2][5] = [200, 300];
  pm.souls[2][5] = [180, 300];
  pm.vs[7][5] = [10, 20]; // пара с малой выборкой — скрыть
  pm.vs[8][5] = [560, 1000]; // герой из пула с небольшим плюсом

  const table = { 50: [{ id: 2, lift: 3.3, rateVs: 0.3 }] };
  const as = { items: { 2: { id: 2, name: 'Toxic Bullets', cost: 1250, tier: 3, slot: 'weapon' } } };

  // 1) полный список героев: у каждого героя корректный ответ, помеченный своим enemy
  const data = {};
  for (const h of heroes) {
    const res = C.counterCodex(h, { pm, table, assets: as, pool: [8] });
    assert.strictEqual(res.enemy, h, 'результат помечен своим героем — при смене героя данные не смешиваются');
    data[h] = res;
    assert.ok(Array.isArray(res.picks.rows), 'строки контрпиков — массив');
    assert.ok(typeof res.picks.covered === 'boolean' && typeof res.picks.pairsSeen === 'number', 'флаги покрытия и видимых пар');
    assert.ok(Array.isArray(res.items.purchases) && Array.isArray(res.items.mechanics), 'структура предметов');
    assert.ok(res.rules.patch && res.rules.source, 'источник правил указан');
  }
  // у героя 6 разницы в парах в пределах шума — контрпиков нет, и это видно
  assert.strictEqual(data[6].picks.rows.length, 0, 'нулевые разницы не выдаются за контрпики');
  assert.strictEqual(data[6].picks.pairsSeen, 49, 'видимые пары посчитаны');
  assert.notStrictEqual(data[5].enemy, data[6].enemy, 'смена героя: разные ответы');

  // 2) контрпик и дельта
  const p5 = data[5].picks;
  assert.strictEqual(p5.rows[0].hero_id, 2, 'против сильного героя 5 — контрпик герой 2');
  assert.ok(p5.rows[0].pp > 0.1, 'фактическая разница заметна');
  assert.ok(p5.rows.every((r) => r.n >= C.MIN_PAIR_GAMES), 'пары с малым числом игр скрыты');
  assert.ok(!p5.rows.some((r) => r.hero_id === 7), 'пара с 20 играми скрыта');
  assert.ok(p5.rows.every((r) => r.pp > 0), 'показываются только плюсовые разницы');
  assert.strictEqual(p5.rows[0].small, false, '1000 игр — не «мало игр»');
  assert.strictEqual(p5.rows.find((r) => r.hero_id === 8).inPool, true, 'герой из пула помечен');
  assert.ok(p5.rows[0].laneWr !== null && p5.rows[0].laneN === 300 && p5.rows[0].soulsD !== null, 'линия и души передаются');

  // 3) устаревшие данные: метка stale и дата
  const staleRes = C.counterCodex(5, { pm: { ...pm, at: 1 }, table, assets: as, stale: true });
  assert.strictEqual(staleRes.meta.stale, true, 'устаревшие данные помечены');
  assert.strictEqual(staleRes.meta.at, 1, 'дата сохранённых данных передаётся');

  // 4) популярный предмет не выдают за контрпредмет: предмет 1 (берут всегда) не в выводе
  const r50 = C.counterCodex(50, { pm, table, assets: as });
  assert.strictEqual(r50.items.purchases.length, 1);
  const pu = r50.items.purchases[0];
  assert.strictEqual(pu.id, 2);
  assert.ok(pu.rule && pu.rule.threatLabel === 'Режет лечение', 'правило предмета подхвачено по имени');
  assert.ok(!r50.items.purchases.some((x) => x.id === 1), 'популярный предмет — не контрпредмет');

  // 5) контрпредметы из угроз: у героя из таблицы — рекомендации с основанием, у героя вне таблицы — молчим
  for (const id of [77, 66, 31, 1]) {
    const res = C.counterCodex(id, { pm, table: {}, assets: as });
    assert.ok(res.heroRule && res.heroRule.threats.length, `угрозы героя ${id}`);
    assert.ok(res.items.verified && res.items.recommended.length >= 3, `рекомендации для героя ${id}`);
    for (const m of res.items.recommended) assert.ok(m.why.length && m.src && m.text && m.notEnough, 'у рекомендации есть основание, источник, эффект и ограничение');
  }
  const noRule = C.counterCodex(42, { pm, table: {}, assets: as });
  assert.strictEqual(noRule.heroRule, null, 'нет героя в таблице — нет heroRule');
  assert.strictEqual(noRule.items.recommended.length, 0, 'нет выдуманных рекомендаций для героя без проверенных механик');
  assert.strictEqual(noRule.items.verified, false);

  // 6) правила: сборка и патч, у предметов — эффект, польза и ограничение
  assert.ok(/Halloween/.test(RULES.patch) && /04/.test(RULES.patch) && RULES.build === 6861);
  for (const n of ['Toxic Bullets', 'Healbane', 'Debuff Reducer', 'Counterspell', 'Slowing Hex', 'Reactive Barrier', 'Spirit Resilience']) {
    assert.ok(RULES.items[n], `правило предмета ${n}`);
    assert.ok(RULES.items[n].text && RULES.items[n].goodVs && RULES.items[n].notEnough, `у ${n} — эффект, польза и ограничение`);
  }
});

test('counter data: rule numbers match game data, all 44 heroes have verified threats', () => {
  const { RULES } = require('../src/core/counterRules');
  const codex = require('../src/core/data/codexData.json');
  const threats = require('../src/core/data/heroThreats.json');
  assert.strictEqual(codex.build, RULES.build, 'правила и данные игры — одна сборка');
  for (const [name, r] of Object.entries(RULES.items)) {
    const shop = codex.items[name];
    assert.ok(shop, `${name} есть в магазине build ${codex.build}`);
    assert.ok(r.src, `у ${name} указан источник`);
    for (const [k, v] of Object.entries(r.nums || {})) assert.strictEqual(shop.nums[k], v, `${name}: ${k} — число правила совпадает с данными игры (после патча обнови правило)`);
  }
  const ids = Object.keys(codex.heroes);
  assert.strictEqual(ids.length, 44, '44 героя в данных игры');
  const DMG = ['spirit', 'weapon', 'melee', 'none'];
  for (const id of ids) {
    const h = threats.heroes[id];
    assert.ok(h, `герой ${codex.heroes[id].name} есть в таблице угроз`);
    assert.strictEqual(h.abilities.length, 4, `${h.name}: четыре способности`);
    assert.ok(Array.isArray(h.dmg) && h.dmg.length && Array.isArray(h.heal) && typeof h.air === 'boolean', `${h.name}: поля героя`);
    for (const a of h.abilities) {
      assert.ok(DMG.includes(a.damage) && Array.isArray(a.cc) && Array.isArray(a.compat) && typeof a.lasting === 'boolean' && a.note, `${h.name}/${a.name}: поля способности`);
    }
  }
});

test('counter advice: from hero threats and build profile, no weak recommendations', () => {
  const C = require('../src/core/counters');
  const codex = require('../src/core/data/codexData.json');
  const rec = (id, profile = null) => C.counterItemsFor(id, { profile }).recommended.map((i) => i.name);

  // Vindicta: сбить с полёта, снять долгие дебаффы, Spirit-урон ульты
  const vin = rec(3);
  for (const n of ['Knockdown', 'Phantom Strike', 'Dispel Magic', 'Spirit Resilience']) assert.ok(vin.includes(n), `Vindicta: ${n}`);
  // Billy: ближний бой и контроль; Dispel Magic не нужен — снимать нечего (мгновенные эффекты)
  const billy = rec(72);
  assert.ok(billy.includes('Rebuttal') && billy.includes('Reactive Barrier'), 'Billy: Rebuttal и Reactive Barrier');
  assert.ok(!billy.includes('Dispel Magic'), 'Billy: Dispel Magic — слабый выбор');
  // Abrams: лечится — предметы против лечения; контроль — Reactive Barrier
  const abrams = rec(6);
  assert.ok(abrams.includes('Healbane') && abrams.includes('Toxic Bullets') && abrams.includes('Reactive Barrier'), 'Abrams: анти-лечение и Reactive Barrier');
  // Apollo: Slowing Hex глушит его рывки и ульт
  assert.ok(rec(77).includes('Slowing Hex'), 'Apollo: Slowing Hex');

  // профиль покупок меняет вывод: без пулевой сборки нет Bullet Resilience, с ней — есть
  const lash = (weapon) => rec(31, { games: 5000, small: false, top: [], slotShare: { weapon, spirit: 1 - weapon - 0.3, vitality: 0.3 }, melee: 0, lifesteal: 0 });
  assert.ok(!lash(0.12).includes('Bullet Resilience'), 'Lash почти не берёт оружейные предметы');
  assert.ok(rec(13, { games: 5000, small: false, top: [], slotShare: { weapon: 0.5, spirit: 0.2, vitality: 0.3 }, melee: 0, lifesteal: 0 }).includes('Bullet Resilience'), 'Haze: пули в сборке');
  // лечение из профиля покупок: у Vindicta своего лечения нет, но вампиризм в сборке даёт анти-лечение
  const noHeal = { games: 5000, small: false, top: [], slotShare: { weapon: 0.45, spirit: 0.24, vitality: 0.31 }, melee: 0, lifesteal: 0.1 };
  assert.ok(!rec(3, noHeal).includes('Healbane'));
  assert.ok(rec(3, { ...noHeal, lifesteal: 0.6 }).includes('Healbane'), 'вампиризм в сборке — предметы против лечения');

  // все 44 героя: есть рекомендации, у каждой — основание, цена и источник, без NaN/undefined
  for (const id of Object.keys(codex.heroes)) {
    const r = C.counterItemsFor(id, {});
    assert.ok(r.verified && r.recommended.length >= 2, `${codex.heroes[id].name}: рекомендации`);
    for (const i of r.recommended) assert.ok(i.why.length && i.src && Number.isFinite(i.cost) && Number.isFinite(i.score) && i.tier >= 1 && i.tier <= 4, `${codex.heroes[id].name}/${i.name}`);
    assert.ok(!/NaN|undefined/.test(JSON.stringify(r)), `${codex.heroes[id].name}: нет NaN/undefined`);
  }
});

test('measured self-healing per hero drives anti-heal advice', () => {
  const C = require('../src/core/counters');
  const heal = require('../src/core/data/heroHealing.json');
  const codex = require('../src/core/data/codexData.json');
  assert.strictEqual(Object.keys(heal.heroes).length, 44, 'измерено лечение 44 героев');
  assert.ok(heal.since && heal.matches > 100000 && heal.medianPerMinute > 0, 'окно, число матчей и медиана указаны');
  for (const [id, x] of Object.entries(heal.heroes)) {
    assert.ok(codex.heroes[id], `герой ${id} из данных игры`);
    assert.ok(x.games >= 100 && x.perMinute >= 0 && x.perGame >= 0 && x.rank >= 1 && x.rank <= 44, `лечение героя ${id}`);
  }
  const score = (id, n) => (C.counterItemsFor(id, {}).recommended.find((i) => i.name === n) || { score: 0 }).score;
  // Victor лечит себя сильнее всех, Vindicta почти не лечится: у Victor анти-лечение в рекомендациях, у Vindicta нет
  assert.ok(score(66, 'Healbane') >= 2.5, 'Victor: Healbane важен');
  assert.strictEqual(score(3, 'Healbane'), 0, 'Vindicta не лечится — Healbane не советуем');
  // Shiv лечится ниже медианы по измерению: Healbane слабый запасной вариант
  assert.ok(score(19, 'Healbane') < score(19, 'Spirit Resilience'), 'Shiv: анти-лечение ниже защиты от Spirit');
  // строка про лечение есть у каждого героя с числами
  for (const id of Object.keys(codex.heroes)) {
    const line = C.counterItemsFor(id, {}).threats.find((t) => t.kind === 'heal');
    assert.ok(line && /в минуту/.test(line.text), `${codex.heroes[id].name}: измеренное лечение в угрозах`);
  }
});

test('hero build profile: top purchases, slot shares, melee and lifesteal flags, small samples', () => {
  const { buildHeroProfile } = require('../src/core/heroProfile');
  const codex = require('../src/core/data/codexData.json');
  const rows = [['Melee Charge', 900], ['Melee Lifesteal', 850], ['Lifestrike', 800], ['Crushing Fists', 600], ['Close Quarters', 950], ['Extra Spirit', 100]]
    .map(([n, m]) => ({ item_id: codex.items[n].id, matches: m, bucket: 0 }));
  const p = buildHeroProfile(rows, { codex, games: 1000 });
  assert.strictEqual(p.games, 1000);
  assert.strictEqual(p.small, false);
  assert.strictEqual(p.top[0].name, 'Close Quarters');
  assert.strictEqual(p.top[0].share, 0.95);
  assert.ok(!p.top.some((x) => x.name === 'Extra Spirit'), 'редкая покупка не попадает в топ');
  assert.ok(p.melee >= 0.5, 'сборка ближнего боя');
  assert.ok(p.lifesteal >= 0.8, 'вампиризм в сборке');
  const sum = Object.values(p.slotShare).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - 1) < 0.02, 'доли слотов складываются в 100%');
  assert.strictEqual(buildHeroProfile(rows, { codex, games: 300 }).small, true, 'мало матчей — помечено');
  assert.strictEqual(buildHeroProfile([], { codex, games: 1000 }), null, 'нет данных — нет профиля');
});

test('codex lookup: no network on hero switch, saved data on failure', () => withStoreDir(async (dir) => {
  const { Sync } = require('../src/main/sync');
  const store = new Store(dir);
  // свежие кэши: мета и справочники — сеть не нужна
  const pm = { v: 1, badge: 81, since: 1000, at: Date.now(), games: 1000, base: { 5: [50, 100], 6: [50, 100] },
    // герой 6 против героя 5 выигрывает 60% — контрпик; герой 5 против 6 — 40%
    vs: { 5: { 6: [40, 100] }, 6: { 5: [60, 100] } }, lane: {}, with: {}, duo: {}, souls: {} };
  store.write('pickmeta.json', pm);
  store.write('assets.json', { v: 8, fetchedAt: Date.now(), heroes: { 5: { id: 5, name: 'H5' }, 6: { id: 6, name: 'H6' } },
    items: { 2: { id: 2, name: 'Toxic Bullets', cost: 1250, tier: 3, slot: 'weapon' } } });
  let calls = 0;
  let profileCalls = 0;
  let failProfile = false;
  const codexItems = require('../src/core/data/codexData.json').items;
  const api = {
    // профиль покупок героя: окно после патча (hero-stats) и покупки (item-stats)
    heroStatsAnalytics: async ({ since } = {}) => (since === require('../src/core/counterRules').RULES.patchSince ? [{ hero_id: 5, matches: 5000 }, { hero_id: 6, matches: 5000 }] : (calls++, [])),
    itemStatsAnalytics: async ({ heroId }) => {
      profileCalls++;
      if (failProfile) throw new Error('offline');
      return [{ item_id: codexItems['Rebuttal'].id, matches: 4000, bucket: 0 }, { item_id: codexItems['Healbane'].id, matches: 100, bucket: 0 }];
    },
    heroCounterAnalytics: async () => { calls++; return []; },
    heroSynergyAnalytics: async () => { calls++; return []; },
    matchHistory: async () => { calls++; throw new Error('offline'); },
    heroesAssets: async () => { calls++; return []; },
    itemsAssets: async () => { calls++; return []; },
  };
  const sync = new Sync({ store, api });
  const a = await sync.codexLookup(null, 5);
  assert.strictEqual(a.enemy, 5);
  assert.strictEqual(a.meta.stale, false, 'свежая мета — без пометки');
  assert.ok(a.picks.rows.length === 1 && a.picks.rows[0].hero_id === 6, 'контрпик из меты');
  assert.strictEqual(a.meta.error, undefined, 'ошибок нет');
  // смена героя: ответ из кэша, сеть не трогаем
  const b = await sync.codexLookup(null, 6);
  assert.strictEqual(b.enemy, 6);
  const again = await sync.codexLookup(null, 5);
  assert.strictEqual(again.enemy, 5);
  assert.strictEqual(calls, 0, 'ни одного запроса к сети при смене героя');
  assert.strictEqual(profileCalls, 2, 'профиль покупок — по одному запросу на героя, при возврате к герою без сети');
  assert.ok(a.items.profile && a.items.profile.games === 5000 && a.items.profile.since > 1000, 'профиль построен по окну после патча');
  assert.strictEqual(a.items.profile.top[0].name, 'Rebuttal', 'в профиле — частая покупка');
  // профиль сохранён в файле: новый Sync без сети берёт его из кэша
  failProfile = true;
  const sync3 = new Sync({ store, api });
  const d3 = await sync3.codexLookup(null, 5);
  assert.ok(d3.items.profile && !d3.meta.profileError, 'свежий кэш профиля — без запроса');
  assert.strictEqual(profileCalls, 2, 'кэш профиля не вызвал сеть');
  failProfile = false;

  // устаревшая мета + сбой сети: показываем сохранённые данные с датой и ошибкой
  store.write('pickmeta.json', { ...pm, at: Date.now() - 8 * 3600e3 });
  const sync2 = new Sync({ store, api });
  const c = await sync2.codexLookup(null, 5);
  assert.strictEqual(c.enemy, 5);
  assert.strictEqual(c.meta.stale, true, 'данные помечены как сохранённые');
  assert.ok(c.meta.at < Date.now() - 7 * 3600e3, 'дата сохранённых данных передана');
  assert.ok(c.meta.error, 'ошибка обновления видна');
  assert.ok(c.picks.rows.length, 'контрпики показаны из сохранённой меты');
}));

test('solo deaths: fires without allies nearby, hidden without routes', () => {
  const L = require('../src/core/leaks');
  const D = require('../src/core/deaths');
  const { playerFeatures: pf } = require('../src/core/features');
  const step = 5;
  const mkPath = (fn) => Array.from({ length: 400 }, (_, i) => fn(i * step));
  const players = [];
  for (let i = 0; i < 12; i++) {
    const team = i < 6 ? 0 : 1;
    players.push({ account_id: 1 + i, hero_id: 20 + i, team, slot: i, lane: [1, 1, 4, 4, 6, 6][i % 6], won: team === 1, k: 0, d: 0, a: 0, nw: 20000, items: [], deaths: [], deaths_t: [], pu: [],
      stats: [{ t: 600, nw: 5000, d: 0, g_lost: 0, k: 0, a: 0 }, { t: 1200, nw: 12000, d: 1, g_lost: 700, k: 0, a: 0 }, { t: 1800, nw: 18000, d: 3, g_lost: 1500, k: 0, a: 0 }] });
  }
  const me = players[0];
  me.d = 4;
  // смерть до 10:00 — не в счёт; три после — в одиночку (союзники в 6000 единицах); порог — выше нормы (3-й квартиль = 2)
  me.deaths = [[200, 0, 0, 6, 0, 0], [1100, 0, 0, 7, 100, 0], [1400, 0, 0, 7, 100, 0], [1700, 0, 0, 7, 100, 0]];
  me.deaths_t = [200, 1100, 1400, 1700];
  const pathsP = {};
  for (const p of players) pathsP[p.slot] = mkPath((t) => [p === me ? 0 : 6000, 0, 1, 0, 100]);
  const mm = { match_id: 9002, start_time: 1, duration_s: 1800, players, paths: { step, players: pathsP }, badge: [52, 52],
    dmg: { t: [180, 600, 1800], d: { '7>0': [0, 0, 9000] } } };
  const fm = pf(me, mm, null);
  assert.strictEqual(fm.soloDeaths, 3, 'три смерти в одиночку');
  const checked = new Set();
  const leaks = L.gameLeaks({ m: mm, me, f: fm, ref: null, tier: 5, checked, heroName: (x) => `H${x}`, itemName: (x) => `I${x}` });
  const sd = leaks.find((l) => l.key === 'solo_deaths');
  assert.ok(sd, 'правило сработало');
  assert.ok(checked.has('solo_deaths'), 'игра помечена проверяемой');
  assert.strictEqual(sd.moments.length, 3);
  assert.ok(/убил H27/.test(sd.moments[0].text), `кто убил: ${sd.moments[0].text}`);
  assert.ok(/до союзников \d+ с бега/.test(sd.moments[0].text));
  assert.strictEqual(sd.cost.deaths, 3);
  assert.strictEqual(sd.status, 'observation', 'цена не подтверждена — наблюдение');
  assert.strictEqual(sd.level, 'info');
  assert.ok(/Цена не подтверждена/.test(sd.context) && /Для сравнения/.test(sd.text), 'норма героя и ранга в тексте, цена названа неподтверждённой');
  assert.ok(!/undefined|NaN/.test(sd.title + sd.text + sd.context + sd.moments.map((x) => x.text).join('')));

  // союзник рядом (500 единиц) — не считается одиночеством
  const nearPaths = { ...pathsP };
  nearPaths[1] = mkPath((t) => [500, 0, 1, 0, 100]);
  const mNear = { ...mm, paths: { step, players: nearPaths } };
  assert.strictEqual(pf(me, mNear, null).soloDeaths, 0, 'союзник был рядом');
  const ln = L.gameLeaks({ m: mNear, me, f: pf(me, mNear, null), ref: null, tier: 5, heroName: (x) => `H${x}` });
  assert.ok(!ln.some((l) => l.key === 'solo_deaths'), 'рядом союзник — не ошибка');

  // маршрутов нет — данных не хватает: null, а не «ноль»
  const mNo = { ...mm, paths: null };
  assert.strictEqual(D.soloDeathRows(mNo, me), null);
  assert.strictEqual(D.soloDeathsVerifiable(mNo, me), null);
  assert.strictEqual(pf(me, mNo, null).soloDeaths, null, 'нет данных — не 0');
  const checked2 = new Set();
  const lNo = L.gameLeaks({ m: mNo, me, f: fm, ref: null, tier: 5, checked: checked2, heroName: (x) => `H${x}` });
  assert.ok(!lNo.some((l) => l.key === 'solo_deaths'));
  assert.ok(!checked2.has('solo_deaths'), 'без маршрутов игра не считается проверяемой — ложного «нуля ошибок» нет');

  // наблюдение (цена не подтверждена) цели тренера не создаёт, но остаётся в списке после выводов
  const games = [
    { match_id: 1, won: false, hero: 1, leaks, checked: [...checked] },
    { match_id: 2, won: false, hero: 1, leaks, checked: [...checked] },
    { match_id: 3, won: true, hero: 1, leaks: [], checked: [...checked] },
  ];
  const prof = L.leakProfile(games);
  assert.strictEqual(prof.goal, null, 'цель из наблюдения не создаётся');
  const soloRow = prof.rows.find((r) => r.key === 'solo_deaths');
  assert.deepStrictEqual([soloRow.count, soloRow.eligible], [2, 3], 'частота среди проверяемых игр');
  assert.strictEqual(soloRow.status, 'observation');
});

test('errors audit: absent API data is "no data", not zero (buffs and lost souls)', () => {
  const L = require('../src/core/leaks');
  const { playerFeatures: pf } = require('../src/core/features');
  const { majorSoulLosses } = require('../src/core/leaks');
  const mk = ({ pus, lost }) => {
    const players = [];
    for (let i = 0; i < 12; i++) {
      const team = i < 6 ? 0 : 1;
      players.push({ account_id: 1 + i, hero_id: 20 + i, team, slot: i, lane: 1, won: team === 1, k: 0, d: i === 0 ? 3 : 1, a: 0, nw: 20000, items: [],
        deaths: i === 0 ? [[700, 0, 0, 6, 0, 0], [1000, 0, 0, 6, 0, 0], [1300, 0, 0, 6, 0, 0]] : [], deaths_t: i === 0 ? [700, 1000, 1300] : [],
        pu: pus[i] || [],
        stats: [{ t: 540, nw: 6000, d: 0, g_lost: 0, g_brk: 600, g_neutral: 600, k: 0, a: 0 },
          { t: 1800, nw: 24000, d: i === 0 ? 3 : 1, g_lost: i === 0 ? lost : 0, g_brk: 2600, g_neutral: 4000, k: 0, a: 0 }] });
    }
    return { match_id: 77, start_time: 1, duration_s: 1800, players, badge: [52, 52], dmg: { t: [180, 1800], d: {} } };
  };
  // бафов нет ни у кого — данных нет: null, а не «0 бафов»
  const none = mk({ pus: {}, lost: 0 });
  assert.strictEqual(pf(none.players[0], none, null).pu10, null);
  assert.strictEqual(pf(none.players[0], none, null).pu20, null);
  // у соседа бафы есть, у меня нет — это настоящий ноль
  const some = mk({ pus: { 3: [[400, 'hp'], [500, 'spirit']] }, lost: 0 });
  assert.strictEqual(pf(some.players[0], some, null).pu10, 0);
  assert.strictEqual(pf(some.players[3], some, null).pu10, 2);
  assert.strictEqual(pf(some.players[0], some, null).pu20, 0);
  // игра без данных о бафах не помечается проверяемой для «таймингов»
  const chk = new Set();
  L.gameLeaks({ m: none, me: none.players[0], f: pf(none.players[0], none, null), ref: null, tier: 5, checked: chk, heroName: (x) => `H${x}`, itemName: (x) => `I${x}` });
  assert.ok(!chk.has('map_timings'), 'нет данных о бафах — тайминги не проверены');

  // потери душ: ноль у всех игроков при трёх смертях — данных нет
  assert.strictEqual(L.lostTracked(none), false);
  const f0 = pf(none.players[0], none, null);
  assert.strictEqual(f0.lostEnd, null);
  assert.strictEqual(f0.lostPerDeath, null);
  assert.strictEqual(majorSoulLosses(none.players[0], 1800, undefined, none), null);
  const c0 = new Set();
  const l0 = L.gameLeaks({ m: none, me: none.players[0], f: f0, ref: null, tier: 5, checked: c0, heroName: (x) => `H${x}`, itemName: (x) => `I${x}` });
  assert.ok(!c0.has('lost_souls') && !l0.some((l) => l.key === 'lost_souls'), 'нет данных о потерях — ни «чисто», ни ошибки');
  assert.ok(!L.gameHighlights({ m: none, me: none.players[0], f: f0, ref: null, tier: 5 }).some((x) => x.key === 'souls_safe'), 'нет данных — не хвалим «умирал пустым»');
  // данные есть — работает как раньше
  const real = mk({ pus: {}, lost: 1500 });
  assert.strictEqual(L.lostTracked(real), true);
  assert.strictEqual(pf(real.players[0], real, null).lostEnd, 1500);
  assert.strictEqual(majorSoulLosses(real.players[0], 1800, [{ t: 700, lost: 1100 }, { t: 1000, lost: 200 }, { t: 1300, lost: 200 }], real), 1);
});

test('errors audit: solo deaths ignore a fight, text says N of M, souls are whole numbers', () => {
  const L = require('../src/core/leaks');
  const D = require('../src/core/deaths');
  const { playerFeatures: pf } = require('../src/core/features');
  assert.strictEqual(L.souls(379.5), '380 душ');
  assert.strictEqual(L.souls(1), '1 душа');
  const step = 5;
  const mkPath = (fn) => Array.from({ length: 400 }, (_, i) => fn(i * step));
  const players = [];
  for (let i = 0; i < 12; i++) {
    const team = i < 6 ? 0 : 1;
    players.push({ account_id: 1 + i, hero_id: 20 + i, team, slot: i, lane: 1, won: team === 1, k: 0, d: 0, a: 0, nw: 20000, items: [], deaths: [], deaths_t: [], pu: [],
      stats: [{ t: 600, nw: 5000, d: 0, g_lost: 0, k: 0, a: 0 }, { t: 1800, nw: 18000, d: 3, g_lost: 1500, k: 0, a: 0 }] });
  }
  const me = players[0];
  me.d = 3;
  me.deaths = [[1100, 0, 0, 7, 100, 0], [1400, 0, 0, 7, 100, 0], [1700, 0, 0, 7, 100, 0]];
  me.deaths_t = [1100, 1400, 1700];
  const far = {};
  for (const p of players) far[p.slot] = mkPath(() => [p === me ? 0 : 6000, 0, 1, 0, 100]);
  const m = { match_id: 9100, start_time: 1, duration_s: 1800, players, paths: { step, players: far }, badge: [52, 52], dmg: { t: [180, 600, 1800], d: {} } };
  const rows = D.soloDeathRows(m, me);
  assert.strictEqual(rows.length, 3);
  const lk = L.gameLeaks({ m, me, f: pf(me, m, null), ref: null, tier: 5, heroName: (x) => `H${x}`, itemName: (x) => `I${x}` }).find((l) => l.key === 'solo_deaths');
  assert.ok(/3 из 3 твоих смертей/.test(lk.text), lk.text);
  assert.strictEqual(lk.level, 'info', 'наблюдение без подтверждённой цены не «bad»');
  assert.ok(/условность/.test(lk.context), 'порог назван условностью, а не найденной границей');

  // союзник погиб рядом за 4 секунды до моей смерти — это драка, а не одиночный заход
  const ally = players[1];
  ally.deaths = [[1096, 400, 0, 7, 0, 0]];
  ally.deaths_t = [1096];
  const fight = { ...far, 1: mkPath((t) => [6000, 0, t < 1095 ? 1 : 0, 0, 100]) };
  const mf = { ...m, paths: { step, players: fight } };
  assert.deepStrictEqual(D.soloDeathRows(mf, me).map((r) => r.t), [1400, 1700], 'смерть в бою, где только что погиб союзник, не одиночная');
  // союзник погиб давно (30 с назад) — смерть по-прежнему одиночная
  ally.deaths = [[1070, 400, 0, 7, 0, 0]];
  assert.strictEqual(D.soloDeathRows(mf, me).length, 3);
  // союзник погиб далеко от места моей смерти — тоже не повод считать её командной
  ally.deaths = [[1096, 9000, 0, 7, 0, 0]];
  assert.strictEqual(D.soloDeathRows(mf, me).length, 3);

  // 3 из 6 поздних смертей: «info» (наблюдение); больше половины, но не «bad»
  ally.deaths = [];
  me.deaths = [[1100, 0, 0, 7, 100, 0], [1200, 5000, 0, 7, 0, 0], [1300, 5000, 0, 7, 0, 0], [1400, 5000, 0, 7, 0, 0], [1500, 0, 0, 7, 100, 0], [1700, 0, 0, 7, 100, 0]];
  me.d = 6;
  const mixed = {};
  for (const p of players) mixed[p.slot] = mkPath(() => [p === me ? 0 : p.team === 0 ? 5000 : 7000, 0, 1, 0, 100]);
  // союзники стоят в 5 000 от точки (0, 0) и рядом с точкой (5 000, 0) — смерти в (5 000, 0) не одиночные
  const mw = { ...m, paths: { step, players: mixed } };
  const lw = L.gameLeaks({ m: mw, me, f: pf(me, mw, null), ref: null, tier: 5, heroName: (x) => `H${x}` }).find((l) => l.key === 'solo_deaths');
  assert.ok(lw && /3 из 6/.test(lw.text) && lw.level === 'info' && lw.status === 'observation', `${lw && lw.text}`);
  // две смерти в одиночку — в пределах нормы (3-й квартиль 2): замечания нет
  me.deaths = [[1100, 0, 0, 7, 100, 0], [1700, 0, 0, 7, 100, 0]];
  me.d = 2;
  assert.ok(!L.gameLeaks({ m: mw, me, f: pf(me, mw, null), ref: null, tier: 5, heroName: (x) => `H${x}` }).some((l) => l.key === 'solo_deaths'), 'две смерти — норма героя и ранга');
});

test('errors audit: win-rate comparison is adjusted for the number of deaths', () => {
  const L = require('../src/core/leaks');
  // победа зависит ТОЛЬКО от числа смертей; замечание чаще бывает в играх с большим числом смертей
  const leak = { key: 'solo_deaths', area: 'Выживание', level: 'warn', title: 'T', text: 'x', fix: [], score: 50, cost: {}, moments: [{ t: 700, text: 'm' }] };
  const games = [];
  let id = 0;
  const add = (d, flagged, won) => games.push({ match_id: ++id, start_time: id, won, hero: 1, d, leaks: flagged ? [leak] : [], checked: ['solo_deaths'] });
  // 2 смерти: все побеждают; 5: половина; 8: никто. С замечанием: 5 / 15 / 25 игр, без: 25 / 15 / 5
  for (const [d, nFlag, nNo, winShare] of [[2, 5, 25, 1], [5, 15, 15, 0.5], [8, 25, 5, 0]]) {
    for (let i = 0; i < nFlag; i++) add(d, true, i < nFlag * winShare);
    for (let i = 0; i < nNo; i++) add(d, false, i < nNo * winShare);
  }
  const row = L.leakProfile(games).rows[0];
  assert.ok(row.wrWithout - row.wrWith > 0.3, `«в лоб» разница огромная: ${row.wrWith} / ${row.wrWithout}`);
  assert.ok(row.wrAdj && Math.abs(row.wrAdj.diff) < 0.02, `с поправкой на смерти связи нет: ${row.wrAdj && row.wrAdj.diff}`);
  assert.ok(Math.abs(row.impact - (row.count / games.length) * 50) < 1e-9, 'влияние не завышено поддельной связью');
  // настоящая связь (в каждой группе с замечанием проигрывают чаще) — поправка её сохраняет
  const real = [];
  let rid = 0;
  const addR = (d, flagged, won) => real.push({ match_id: ++rid, start_time: rid, won, hero: 1, d, leaks: flagged ? [leak] : [], checked: ['solo_deaths'] });
  for (const d of [2, 5, 8]) {
    for (let i = 0; i < 10; i++) addR(d, true, i < 3);
    for (let i = 0; i < 10; i++) addR(d, false, i < 7);
  }
  const rr = L.leakProfile(real).rows[0];
  assert.ok(rr.wrAdj.diff < -0.35 && rr.wrAdj.diff > -0.45, `настоящая связь сохранена: ${rr.wrAdj.diff}`);
  assert.ok(rr.impact > (rr.count / real.length) * 50, 'настоящая связь усиливает важность');
  // число смертей неизвестно — поправки нет, как раньше
  const noD = games.map(({ d, ...g }) => g);
  assert.strictEqual(L.leakProfile(noD).rows[0].wrAdj, null);
});

test('errors audit: died_rich is a lower bound, counter_missing has episodes', () => {
  const L = require('../src/core/leaks');
  const { playerFeatures: pf } = require('../src/core/features');
  const assets = { items: { 12: { id: 12, name: 'Резак', slot: 'weapon', cost: 3000, tier: 3 } } };
  const players = [];
  for (let i = 0; i < 12; i++) {
    const team = i < 6 ? 0 : 1;
    players.push({ account_id: 1 + i, hero_id: 20 + i, team, slot: i, lane: 1, won: team === 1, k: 0, d: i === 0 ? 2 : 0, a: 0, nw: 20000,
      items: i === 0 ? [[12, 800, 0, 0]] : [], deaths: i === 0 ? [[1000, 0, 0, 6, 0, 0], [1500, 0, 0, 6, 0, 0]] : [], deaths_t: i === 0 ? [1000, 1500] : [], pu: [],
      stats: [{ t: 540, nw: 6000, d: 0, g_lost: 0, g_brk: 600, g_neutral: 600, k: 0, a: 0 }, { t: 1800, nw: 30000, d: i === 0 ? 2 : 0, g_lost: 900, g_brk: 2600, g_neutral: 4000, k: 0, a: 0 }] });
  }
  const me = players[0];
  const m = { match_id: 5, start_time: 1, duration_s: 1800, players, badge: [52, 52], dmg: { t: [180, 1800], d: { '6>0': [0, 9000], '7>0': [0, 1000] } } };
  const counters = { 26: [{ id: 99, lift: 1.9, rateVs: 0.3 }] };
  const checked = new Set();
  const leaks = L.gameLeaks({ m, me, f: pf(me, m, assets), ref: null, tier: 5, assets, counters, checked, heroName: (x) => `H${x}`, itemName: (x) => `I${x}` });
  const rich = leaks.find((l) => l.key === 'died_rich');
  assert.ok(rich && rich.level === 'info' && rich.status === 'observation', 'богатая смерть: наблюдение, не «ошибка»');
  assert.ok(/не меньше/.test(rich.text) && !/\d[.,]\d/.test(rich.text), `нижняя граница, целые числа: ${rich.text}`);
  assert.ok(/гипотеза/.test(rich.context));
  const cm = leaks.find((l) => l.key === 'counter_missing');
  assert.ok(cm, 'ответа на героя нет');
  assert.deepStrictEqual(cm.moments.map((x) => x.t), [1000, 1500], 'эпизоды — смерти от этого героя');
  assert.ok(/статистика/.test(cm.context) && /доказанный/.test(cm.context), 'не выдаём статистику за причину');
  assert.ok(!/undefined|NaN/.test(JSON.stringify(leaks)));
});

test('errors pilot: lane trades is a finding with a measured price; norms by hero and rank; findings first in the profile', () => {
  const L = require('../src/core/leaks');
  const { playerFeatures: pf } = require('../src/core/features');
  // нормы: ячейка героя и ранга, затем запасные варианты
  assert.ok(L.normFor(0, 5) && L.normFor(0, 5).scope === 'rank', 'нет героя — берём ранг');
  assert.ok(/обычно/.test(L.normPhrase('Хиро', L.normFor(0, 5), 'solo')), 'фраза нормы');
  assert.strictEqual(L.normPhrase('Хиро', null, 'solo'), '', 'нет норм — нет фразы');
  // линия: наша пара (слоты 0, 1) на 1000 душ позади пары соперников к 10:00
  const players = [];
  for (let i = 0; i < 12; i++) {
    const team = i < 6 ? 0 : 1;
    const lane = [1, 1, 4, 4, 6, 6][i % 6];
    const nw10 = team === 0 ? (lane === 1 ? 5000 : 6000) : (lane === 1 ? 6000 : 6000);
    players.push({ account_id: 1 + i, hero_id: 20 + i, team, slot: i, lane, won: team === 1, k: 0, d: i === 0 ? 1 : 0, a: 0, nw: 20000, items: [],
      deaths: i === 0 ? [[400, 0, 0, 6, 0, 0]] : [], deaths_t: i === 0 ? [400] : [], pu: [],
      stats: [{ t: 600, nw: nw10, d: i === 0 ? 1 : 0, g_lost: 100, g_brk: 600, g_neutral: 600, k: 0, a: 0 }, { t: 1800, nw: 20000, d: i === 0 ? 1 : 0, g_lost: 100, g_brk: 2600, g_neutral: 4000, k: 0, a: 0 }] });
  }
  const me = players[0];
  const m = { match_id: 7, start_time: 1, duration_s: 1800, players, badge: [0, 0],
    dmg: { t: [180, 540, 1800], d: { '0>6': [0, 400, 800], '6>0': [0, 2000, 3000] } } };
  const leaks = L.gameLeaks({ m, me, f: pf(me, m, null), ref: null, tier: 6, heroName: (x) => `H${x}`, itemName: (x) => `I${x}` });
  const lt = leaks.find((l) => l.key === 'lane_trades');
  assert.ok(lt, 'размены в пользу врага');
  assert.strictEqual(lt.status, 'finding');
  assert.strictEqual(lt.level, 'bad', 'у вывода с подтверждённой ценой уровень сохраняется');
  assert.strictEqual(lt.facts.laneGap, -1000);
  assert.ok(/на 1.000 душ меньше/.test(lt.text) && /около 42%/.test(lt.text), `цена в душах и победах: ${lt.text}`);
  assert.strictEqual(lt.cost.souls, 1000);
  assert.ok(/Чего не хватает/.test(lt.context), 'сказано, чего не хватает');
  assert.ok(!/undefined|NaN/.test(JSON.stringify(leaks)));
  // профиль: вывод идёт раньше наблюдения даже при меньшей важности, а цель тренера — только из вывода
  const obs = { key: 'solo_deaths', area: 'Выживание', level: 'info', status: 'observation', title: 'T', text: 'x', fix: [], score: 500, cost: {}, moments: [{ t: 700, text: 'm' }] };
  const games = [1, 2, 3].map((id) => ({ match_id: id, start_time: id, won: id === 1, hero: 1, d: 5, leaks: [lt, obs], checked: ['lane_trades', 'solo_deaths'] }));
  const prof = L.leakProfile(games);
  assert.strictEqual(prof.rows[0].key, 'lane_trades');
  assert.strictEqual(prof.rows[0].status, 'finding');
  assert.strictEqual(prof.rows[1].status, 'observation');
  assert.strictEqual(prof.goal.key, 'lane_trades', 'цель — из подтверждённого вывода');
});

test('errors pilot: farm episodes are shared, observation status and the norm thresholds', () => {
  const L = require('../src/core/leaks');
  const { playerFeatures: pf } = require('../src/core/features');
  const step = 5;
  const mkPath = (fn) => Array.from({ length: 400 }, (_, i) => fn(i * step));
  const players = [];
  for (let i = 0; i < 12; i++) {
    const team = i < 6 ? 0 : 1;
    players.push({ account_id: 1 + i, hero_id: 20 + i, team, slot: i, lane: 1, won: team === 1, k: 0, d: 0, a: 0, nw: 20000, items: [], deaths: [], deaths_t: [], pu: [],
      stats: [{ t: 600, nw: 5000, d: 0, g_lost: 0, k: 0, a: 0 }, { t: 1800, nw: 18000, d: 0, g_lost: 0, k: 0, a: 0 }] });
  }
  const me = players[0];
  // две драки после 10:00: союзники 1 и 2 погибают у (0,0), соперник — одного; я фармлю в 6 000 от места (режим 2 — крипы линии)
  const fights = [1000, 1400];
  for (const t of fights) {
    players[1].deaths.push([t, 0, 0, 6, 0, 0]);
    players[2].deaths.push([t + 3, 0, 0, 6, 0, 0]);
    players[7].deaths.push([t + 6, 0, 0, 0, 0, 0]);
  }
  const far = {};
  for (const p of players) far[p.slot] = mkPath(() => [p === me ? 6000 : 0, 0, 1, p === me ? 2 : 0, 100]);
  const m = { match_id: 9, start_time: 1, duration_s: 1800, players, paths: { step, players: far }, badge: [0, 0], dmg: { t: [180, 600, 1800], d: {} } };
  const fe = L.farmEpisodes(m, me);
  assert.strictEqual(fe.missed.length, 2);
  assert.ok(fe.fightChecks >= 2 && !fe.incompleteFights);
  const fl = L.gameLeaks({ m, me, f: pf(me, m, null), ref: null, tier: 6, heroName: (x) => `H${x}`, itemName: (x) => `I${x}` }).find((l) => l.key === 'farm_while_fight');
  assert.ok(fl, 'два эпизода');
  assert.strictEqual(fl.status, 'observation');
  assert.strictEqual(fl.level, 'info');
  assert.ok(/Цена не подтверждена/.test(fl.context) && /фармящим вдали/.test(fl.context), 'цена не подтверждена, причина названа');
  assert.ok(/Для сравнения/.test(fl.text), 'норма героя и ранга в тексте');
  // я рядом с дракой (в 1 000 от неё) — эпизодов нет
  const near = { ...far, 0: mkPath(() => [1000, 0, 1, 2, 100]) };
  assert.strictEqual(L.farmEpisodes({ ...m, paths: { step, players: near } }, me).missed.length, 0);
});

test('rank: fresh ranked matches have a zero team badge, the own badge from history is the fallback', () => {
  const { gameBadge, tierOfBadge } = require('../src/core/rank');
  const L = require('../src/core/leaks');
  const me = { team: 1 };
  assert.strictEqual(gameBadge({ badge: [0, 0] }, me, null), null, 'ноль — не ранг');
  assert.strictEqual(gameBadge({ badge: [0, 0] }, me, 72), 72, 'значок игрока из истории');
  assert.strictEqual(gameBadge({ badge: [54, 63] }, me, 72), 63, 'значок команды из матча приоритетнее');
  assert.strictEqual(gameBadge({ badge: [null, null] }, me, '0'), null);
  assert.strictEqual(gameBadge(null, me, 71), 71);
  assert.strictEqual(tierOfBadge(0), null, 'уровень 0 — «неизвестно», а не самый низкий');
  assert.strictEqual(tierOfBadge(72), 7);
  // нормы не принимают 0 за «ранги 1–5»
  assert.notStrictEqual(L.normFor(0, 0).band, 0);
  assert.strictEqual(L.normFor(0, 0).band, 'any');
  assert.strictEqual(L.normFor(0, 3).band, 0);
  assert.strictEqual(L.normFor(0, 8).band, 2);
  // обзор: матчи с нулевым значком, ранг берётся из истории (ranked_display_badge)
  const { buildOverview } = require('../src/core/overview');
  const ME = 777;
  const now = 2_000_000_000;
  const history = [];
  const matches = new Map();
  for (let i = 0; i < 6; i++) {
    const start = now - 3 * 86400 + i * 3000;
    const raw = fakeMatch({ id: 7000 + i, seed: 90 + i, start, accounts: [ME, ...Array.from({ length: 11 }, (_, k) => 2000 + i * 20 + k)], skill: [0.7] });
    raw.match_info.average_badge_team0 = 0;
    raw.match_info.average_badge_team1 = 0;
    const m = extractMatch(raw);
    matches.set(m.match_id, m);
    const p = m.players[0];
    history.push({ match_id: m.match_id, start_time: start, match_duration_s: m.duration_s, hero_id: p.hero_id, player_team: p.team, match_result: m.winning_team, player_kills: p.k, player_deaths: p.d, player_assists: p.a, net_worth: p.nw, last_hits: p.lh, denies: 0, match_mode: 4, game_mode: 1, ranked_display_badge: 72 });
  }
  const o = buildOverview({ history, matches, accountId: ME, days: 7, now });
  assert.ok(o.rank && o.rank.tier === 7 && o.rank.sub === 2, `ранг из истории: ${JSON.stringify(o.rank)}`);
  const noRow = buildOverview({ history: history.map(({ ranked_display_badge, ...r }) => r), matches, accountId: ME, days: 7, now });
  assert.strictEqual(noRow.rank, null, 'ни значка команды, ни собственного — ранга нет, а не «ранг 0»');
});

test('roles: automatic working role from match data, hero summary with confidence', () => {
  const Rl = require('../src/core/roles');
  const L = require('../src/core/leaks');
  const cuts = require('../src/core/data/errorNorms.json').roleCuts;
  assert.ok(cuts && cuts.dmgShare.p67 > 0 && cuts.takenShare.p67 > 0, 'границы признаков роли есть в нормах');
  assert.strictEqual(Rl.roleOf({ dmgShare: 0.2 }, null).role, null, 'без границ роль не определяется');
  assert.strictEqual(Rl.roleOf(null, cuts).role, null);
  const feat = (o) => ({ dmgShare: 0.16, takenShare: 0.15, healShare: 0.1, nwShare: 0.17, firstEngage: 0.3, vitality: 0.3, ...o });
  assert.strictEqual(Rl.roleOf(feat({ takenShare: 0.3, firstEngage: 0.6 }), cuts).role, 'initiator');
  assert.strictEqual(Rl.roleOf(feat({ takenShare: 0.3, firstEngage: null, vitality: 0.5 }), cuts).role, 'initiator', 'живучесть вместо маршрутов');
  assert.strictEqual(Rl.roleOf(feat({ dmgShare: 0.25 }), cuts).role, 'carry');
  const sup = Rl.roleOf(feat({ dmgShare: 0.1, healShare: 0.3 }), cuts);
  assert.strictEqual(sup.role, 'support');
  assert.ok(sup.why.length >= 2 && sup.why.every((w) => /%/.test(w)), 'названы признаки');
  assert.strictEqual(Rl.roleOf(feat({}), cuts).role, 'flex');
  // «первым в бой»: по маршрутам и дракам
  const step = 5;
  const mk = (fn) => Array.from({ length: 300 }, (_, i) => fn(i * step));
  const players = [];
  for (let i = 0; i < 12; i++) players.push({ slot: i, team: i < 6 ? 0 : 1, deaths: [], k: 0, a: 0, stats: [{ t: 1800, nw: 20000, pdmg: 1000 * (i % 6 + 1), pdmgT: 1000, heal: 0, g_lane: 6000, g_neutral: 3000, g_player: 2000, g_boss: 500, g_brk: 1000 }] });
  // драка 1000–1010: трое союзников; слот 0 вступает в контакт с героями в 995, слоты 1 и 2 — в 1005
  const paths = {};
  for (const p of players) paths[p.slot] = mk((t) => [0, 0, 1, (p.slot === 0 && t >= 995 && t <= 1010) || ((p.slot === 1 || p.slot === 2) && t >= 1005 && t <= 1010) ? 1 : 0, 100]);
  players[3].deaths = [[1000, 0, 0, 7, 0, 0]]; players[4].deaths = [[1004, 0, 0, 7, 0, 0]]; players[7].deaths = [[1008, 0, 0, 0, 0, 0]];
  const m = { players, paths: { step, players: paths }, duration_s: 1800 };
  const eng = Rl.engageStats(m, L.findFights);
  assert.deepStrictEqual([eng.get(0).fights, eng.get(0).firsts, eng.get(1).firsts], [1, 1, 0], 'первым вступил слот 0');
  const rf = Rl.roleFeatures(m, players[0], null, L.findFights);
  assert.ok(Math.abs(rf.dmgShare - 1000 / 21000) < 1e-9 && Math.abs(rf.laneSouls - 0.3) < 1e-9 && Math.abs(rf.bossSouls - 0.025) < 1e-9, 'доли урона и душ по источникам');
  assert.strictEqual(rf.firstEngage, null, 'меньше трёх драк — «первым» не считаем');
  // роли на героях: мало данных — роль не называем; согласованность задаёт доверие
  const g = (hero, role) => ({ hero, role, feat: feat({}) });
  const list = [...Array(3).fill(0).map(() => g(1, 'carry')), ...Array(12).fill(0).map((_, i) => g(2, i < 10 ? 'carry' : 'flex')), ...Array(8).fill(0).map((_, i) => g(3, ['carry', 'flex', 'initiator', 'support'][i % 4]))];
  const hr = Object.fromEntries(Rl.heroRoles(list).map((x) => [x.hero, x]));
  assert.strictEqual(hr[1].role, null);
  assert.strictEqual(hr[1].confidence, 'мало данных');
  assert.strictEqual(hr[2].role, 'carry');
  assert.strictEqual(hr[2].confidence, 'высокое');
  assert.ok(/^низкое/.test(hr[3].confidence), 'роль меняется — доверие низкое');
});

test('roles: errors text says the role was chosen automatically and why; role norms are used', () => {
  const L = require('../src/core/leaks');
  const { playerFeatures: pf } = require('../src/core/features');
  const step = 5;
  const mkPath = (fn) => Array.from({ length: 400 }, (_, i) => fn(i * step));
  const players = [];
  for (let i = 0; i < 12; i++) {
    const team = i < 6 ? 0 : 1;
    players.push({ account_id: 1 + i, hero_id: 20 + i, team, slot: i, lane: 1, won: team === 1, k: 5, d: 0, a: 5, nw: 20000, items: [], deaths: [], deaths_t: [], pu: [],
      stats: [{ t: 600, nw: 5000, d: 0, g_lost: 0, pdmg: 3000, pdmgT: 3000, heal: 100, k: 0, a: 0 }, { t: 1800, nw: 18000, d: 0, g_lost: 0, pdmg: i === 0 ? 60000 : 20000, pdmgT: 20000, heal: 1000, g_lane: 6000, k: 5, a: 5 }] });
  }
  const me = players[0];
  me.d = 4;
  me.deaths = [[1100, 0, 0, 7, 100, 0], [1300, 0, 0, 7, 100, 0], [1500, 0, 0, 7, 100, 0], [1700, 0, 0, 7, 100, 0]];
  me.deaths_t = [1100, 1300, 1500, 1700];
  const far = {};
  for (const p of players) far[p.slot] = mkPath(() => [p === me ? 0 : 6000, 0, 1, 0, 100]);
  const m = { match_id: 9300, start_time: 1, duration_s: 1800, players, paths: { step, players: far }, badge: [0, 0], dmg: { t: [180, 600, 1800], d: {} } };
  const role = L.gameRole(m, me, pf(me, m, null));
  assert.strictEqual(role.role, 'carry', `большая доля урона — керри: ${JSON.stringify(role.why)}`);
  const sd = L.gameLeaks({ m, me, f: pf(me, m, null), ref: null, tier: 6, heroName: (x) => `H${x}`, itemName: (x) => `I${x}` }).find((l) => l.key === 'solo_deaths');
  assert.ok(sd, 'четыре смерти в одиночку — выше нормы роли');
  assert.strictEqual(sd.role, 'carry');
  assert.ok(/определена автоматически: керри/.test(sd.context) && /% урона команды/.test(sd.context), 'в тексте — роль, что она автоматическая, и признаки');
  assert.ok(/в роли «керри/.test(sd.text), `норма роли в сравнении: ${sd.text}`);
  const n = L.normFor(20, 6, 'carry');
  assert.ok(n.scope === 'role-rank' && n.role === 'carry');
  assert.strictEqual(L.normFor(20, 6, null).scope === 'role-rank', false);
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
  assert.strictEqual(v.me.sources[0].rows.length, 7);
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} tests passed.\n`);
  console.log('Пример выводов разбора для слабой игры:');
  for (const i of result.insights) console.log(`  [${i.level}] ${i.area}: ${i.text}`);
});
