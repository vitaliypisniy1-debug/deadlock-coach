'use strict';
// Тесты меты героев по API: окно, порог выборки, сдвиг, баны, игры топа. Подключается из test/run.js.

const assert = require('assert');
const MS = require('../src/core/metashift');
const { heroTable } = require('../src/core/meta');

module.exports = function metashiftTests(test) {
  const D = MS.DAY;
  const NOW = 1_794_700_000; // 2026-11-14 ~19:00 UTC
  const W = MS.windows(NOW);
  // суточные строки hero-stats: spec = {герой: [игр в сутки раньше, винрейт раньше, игр в сутки сейчас, винрейт сейчас]}
  const dayRows = (spec) => {
    const rows = [];
    for (const [hero, [pn, pw, cn, cw]] of Object.entries(spec)) {
      for (let i = 0; i < 14; i++) {
        rows.push({ bucket: W.prev.from + i * D, hero_id: Number(hero), matches: pn, wins: Math.round(pn * pw) });
        rows.push({ bucket: W.cur.from + i * D, hero_id: Number(hero), matches: cn, wins: Math.round(cn * cw) });
      }
    }
    return rows;
  };
  const by = (m, id) => m.heroes.find((x) => x.hero_id === id);

  test('metashift: окна — полные сутки UTC без текущих', () => {
    assert.strictEqual(W.cur.to % D, 0);
    assert.strictEqual(W.cur.to - W.cur.from, 14 * D);
    assert.strictEqual(W.prev.to, W.cur.from);
    assert.ok(W.cur.to <= NOW && NOW - W.cur.to < D, 'текущие сутки в окно не входят');
  });

  test('metashift: порог выборки — мало данных / ориентир / достаточно', () => {
    assert.strictEqual(MS.sampleStatus(0), 'low');
    assert.strictEqual(MS.sampleStatus(299), 'low');
    assert.strictEqual(MS.sampleStatus(300), 'orient');
    assert.strictEqual(MS.sampleStatus(999), 'orient');
    assert.strictEqual(MS.sampleStatus(1000), 'ok');
    assert.strictEqual(MS.sampleStatus(undefined), 'low');
  });

  test('metashift: герой с малой выборкой не получает сдвиг и стрелку', () => {
    // у героя 5 игр за сутки × 14 = 70; винрейт «скачет» с 30% до 70%
    const m = MS.buildHeroMeta({ heroRows: dayRows({ 1: [5, 0.3, 5, 0.7], 2: [500, 0.5, 500, 0.5] }), now: NOW });
    const small = by(m, 1);
    assert.strictEqual(small.status, 'low');
    assert.strictEqual(small.wrShift.verdict, 'nodata');
    assert.strictEqual(small.pickShift.verdict, 'nodata');
    assert.strictEqual(m.lowCount, 1);
  });

  test('metashift: реальный сдвиг винрейта отделяется от шума', () => {
    const m = MS.buildHeroMeta({ heroRows: dayRows({ 1: [800, 0.5, 800, 0.56], 2: [800, 0.5, 800, 0.505], 3: [800, 0.55, 800, 0.49] }), now: NOW });
    assert.strictEqual(by(m, 1).wrShift.verdict, 'up');
    assert.strictEqual(by(m, 2).wrShift.verdict, 'noise', '0,5 п.п. — шум и меньше порога 1 п.п.');
    assert.strictEqual(by(m, 3).wrShift.verdict, 'down');
    assert.ok(by(m, 1).wrShift.lo > 0 && by(m, 3).wrShift.hi < 0, 'интервал разницы не включает 0');
    assert.ok(by(m, 1).ci_lo < by(m, 1).winrate && by(m, 1).winrate < by(m, 1).ci_hi);
  });

  test('metashift: интервал разницы честный — малая разница на большой выборке остаётся шумом', () => {
    const iv = MS.diffInterval(5040, 10000, 5000, 10000);
    assert.ok(iv.lo < 0 && iv.hi > 0, 'разница 0,4 п.п. на 10 000 игр — в пределах шума');
    assert.ok(MS.diffInterval(5300, 10000, 5000, 10000).lo > 0, '3 п.п. на 10 000 игр — значимо');
  });

  test('metashift: если в одном из окон мало игр, сдвиг не считается', () => {
    const m = MS.buildHeroMeta({ heroRows: dayRows({ 1: [5, 0.3, 800, 0.6], 2: [800, 0.5, 800, 0.5] }), now: NOW });
    assert.strictEqual(by(m, 1).wrShift.verdict, 'nodata');
  });

  test('metashift: герой, которого не было в прошлом окне, — сдвига нет', () => {
    const rows = dayRows({ 2: [800, 0.5, 800, 0.5] }).concat(dayRows({ 1: [0, 0, 800, 0.6] }).filter((r) => r.matches > 0));
    const m = MS.buildHeroMeta({ heroRows: rows, now: NOW });
    assert.strictEqual(by(m, 1).prev, null);
    assert.strictEqual(by(m, 1).wrShift.verdict, 'nodata');
  });

  test('metashift: сдвиг пикрейта — только если герой берётся заметно чаще или реже', () => {
    const m = MS.buildHeroMeta({ heroRows: dayRows({ 1: [1000, 0.5, 2000, 0.5], 2: [1000, 0.5, 1050, 0.5], 3: [1000, 0.5, 400, 0.5] }), now: NOW });
    assert.strictEqual(by(m, 1).pickShift.verdict, 'up');
    assert.strictEqual(by(m, 3).pickShift.verdict, 'down');
    assert.strictEqual(by(m, 2).pickShift.verdict, 'noise');
    assert.ok(Math.abs(m.heroes.reduce((a, x) => a + x.pick_share, 0) - 1) < 1e-9, 'доли пиков в сумме дают 100%');
  });

  test('metashift: нет данных — пусто, баны недоступны с причиной', () => {
    const m = MS.buildHeroMeta({ heroRows: [], banRows: null, now: NOW });
    assert.strictEqual(m.heroes.length, 0);
    assert.strictEqual(m.bans.available, false);
    assert.ok(/не вернул/.test(m.bans.reason));
    assert.strictEqual(MS.buildHeroMeta({ heroRows: undefined, now: NOW }).matches.cur, 0);
  });

  // баны: суточные строки; perMatch — банов на матч (3 или 4), matchesPerDay — матчей с данными в сутки
  const banRows = (win, days, perMatch, matchesPerDay, hero1Share) => {
    const rows = [];
    for (const d of days) {
      for (const h of [1, 2, 3, 4]) {
        const bans = h === 1 ? Math.round(matchesPerDay * hero1Share) : Math.round((matchesPerDay * perMatch - matchesPerDay * hero1Share) / 3);
        rows.push({ bucket: win.from + d * D, hero_id: h, bans, matches: matchesPerDay });
      }
    }
    return rows;
  };
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

  test('metashift: правило банов сменилось — берём только свежие сутки с тем же числом банов', () => {
    // игр героев 400 в сутки ≈ 33 матча, данные о банах у 20 матчей — охват около 60%
    const old = banRows(W.cur, range(0, 7), 3, 250, 0.1);
    const nu = banRows(W.cur, range(7, 14), 4, 250, 0.5);
    const m = MS.buildHeroMeta({ heroRows: dayRows({ 1: [2000, 0.5, 2000, 0.5], 2: [2000, 0.5, 2000, 0.5] }), banRows: [...old, ...nu], now: NOW });
    assert.strictEqual(m.bans.available, true);
    assert.strictEqual(m.bans.days, 7, 'только 7 суток с 4 банами');
    assert.ok(Math.abs(m.bans.perMatch - 4) < 0.01);
    assert.strictEqual(m.bans.shiftAvailable, false, 'в прошлом окне банов 3 — сравнивать нельзя');
    assert.ok(/правило/.test(m.bans.shiftReason));
    assert.ok(Math.abs(by(m, 1).ban.rate - 0.5) < 0.01, `доля банов считается по свежей серии: ${by(m, 1).ban.rate}`);
    assert.strictEqual(by(m, 1).ban.shift, null);
  });

  test('metashift: при одинаковом правиле в обоих окнах считаем сдвиг банов', () => {
    const prev = banRows(W.prev, range(0, 14), 4, 3000, 0.1);
    const cur = banRows(W.cur, range(0, 14), 4, 3000, 0.3);
    const m = MS.buildHeroMeta({ heroRows: dayRows({ 1: [20000, 0.5, 20000, 0.5], 2: [20000, 0.5, 20000, 0.5] }), banRows: [...prev, ...cur], now: NOW });
    assert.strictEqual(m.bans.shiftAvailable, true);
    assert.strictEqual(by(m, 1).ban.shift.verdict, 'up');
    assert.ok(Math.abs(by(m, 1).ban.rate - 0.3) < 0.01);
  });

  test('metashift: охват банов ниже порога — баны не показываются, с причиной', () => {
    // игр героев 20 000 в сутки ≈ 1 667 матчей, данные о банах у 300 матчей — охват 18%
    const m = MS.buildHeroMeta({ heroRows: dayRows({ 1: [20000, 0.5, 20000, 0.5] }), banRows: banRows(W.cur, range(0, 14), 4, 300, 0.1), now: NOW });
    assert.strictEqual(m.bans.available, false);
    assert.ok(/меньше порога/.test(m.bans.reason), m.bans.reason);
    assert.ok(m.heroes.every((x) => x.ban === null));
  });

  test('metashift: обновления Steam помечены по окнам', () => {
    const iso = (t) => new Date(t * 1000).toISOString();
    const m = MS.buildHeroMeta({
      heroRows: dayRows({ 1: [800, 0.5, 800, 0.5] }),
      now: NOW,
      patches: [
        { pub_date: iso(W.cur.from + 3600), title: ' Minor Update ' },
        { pub_date: iso(W.prev.from + 3600), title: 'Старый патч' },
        { pub_date: iso(W.prev.from - 5 * D), title: 'Слишком давно' },
      ],
    });
    assert.deepStrictEqual(m.patches.map((p) => [p.title, p.window]), [['Старый патч', 'prev'], ['Minor Update', 'cur']]);
  });

  test('metashift: игры топа по герою — победа по команде, только нужный герой и свежие', () => {
    const accounts = new Map([[10, { name: 'Топ А', rank: 1 }], [11, { name: 'Топ Б', rank: 2 }]]);
    const mk = (id, start, win, players) => ({ match_id: id, start_time: start, duration_s: 1800, winning_team: win, players });
    const matches = [
      mk(1, '2026-11-14 10:00:00', 'Team1', [{ account_id: 10, hero_id: 13, team: 'Team1', kills: 5, deaths: 2, assists: 3, net_worth: 30000 }]),
      mk(2, '2026-11-13 10:00:00', 'Team0', [{ account_id: 10, hero_id: 13, team: 'Team1', kills: 1, deaths: 9, assists: 2, net_worth: 20000 }, { account_id: 11, hero_id: 7, team: 'Team0', kills: 1, deaths: 1, assists: 1, net_worth: 1 }]),
      mk(3, '2026-10-01 10:00:00', 'Team1', [{ account_id: 10, hero_id: 13, team: 'Team1', kills: 1, deaths: 1, assists: 1, net_worth: 1 }]),
      mk(4, '2026-11-12 10:00:00', 'Team1', [{ account_id: 99, hero_id: 13, team: 'Team1', kills: 1, deaths: 1, assists: 1, net_worth: 1 }]),
    ];
    const now = Math.floor(Date.parse('2026-11-14T12:00:00Z') / 1000);
    const r = MS.topHeroGames({ matches, accounts, heroId: 13, now });
    assert.deepStrictEqual(r.games.map((g) => [g.match_id, g.won]), [[1, true], [2, false]], 'свежие сверху; старый матч, чужой игрок и другой герой отброшены');
    assert.strictEqual(r.summary.games, 2);
    assert.strictEqual(r.summary.wins, 1);
    assert.strictEqual(r.summary.status, 'low', 'две игры — «мало данных»');
    assert.strictEqual(r.games[0].name, 'Топ А');
    const none = MS.topHeroGames({ matches: [], accounts, heroId: 13, now });
    assert.strictEqual(none.summary.games, 0);
    assert.strictEqual(none.summary.winrate, null);
  });

  test('metashift: ладдер — берём только игроков с однозначным аккаунтом', () => {
    const entries = [
      { rank: 1, account_name: 'Один', possible_account_ids: [101] },
      { rank: 2, account_name: 'Двое', possible_account_ids: [102, 103] },
      { rank: 3, account_name: 'Ручной', possible_account_ids: [104, 105] },
      { rank: 4, account_name: 'Пустой', possible_account_ids: [] },
      { rank: 5, account_name: 'За пределами', possible_account_ids: [106] },
    ];
    const r = MS.ladderAccounts(entries, { Ручной: 105 }, 4);
    assert.deepStrictEqual([...r.accounts.keys()], [101, 105]);
    assert.strictEqual(r.entries, 4);
    assert.strictEqual(r.resolved, 2);
  });

  test('meta.js: таблица топ-50 использует тот же порог «мало данных»', () => {
    const recs = [];
    for (let i = 0; i < 40; i++) recs.push({ hero_id: 1, won: i % 2 === 0, k: 1, d: 1, a: 1, account_id: i });
    for (let i = 0; i < 400; i++) recs.push({ hero_id: 2, won: i % 2 === 0, k: 1, d: 1, a: 1, account_id: i });
    const t = heroTable(recs);
    assert.strictEqual(t.find((x) => x.hero_id === 1).lowSample, true);
    assert.strictEqual(t.find((x) => x.hero_id === 2).lowSample, false);
    assert.strictEqual(t.find((x) => x.hero_id === 2).status, 'orient');
  });
};
