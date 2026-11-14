'use strict';
// Сбор данных: справочники, ладдер, матчи топов, твои матчи.

const { extractMatch, EXTRACT_V } = require('../core/extract');
const { buildMeta, isStandardMatch, firstPurchases, isUpgrade, itemFates } = require('../core/meta');
const { benchmarkPlayers, analyze, SOURCE_NAMES } = require('../core/compare');
const { valueAt, lastMinute, SOURCE_FIELDS } = require('../core/timeline');
const { clusterBuilds } = require('../core/variants');
const { findSpikes, aroundPurchase } = require('../core/spikes');
const { rankBuilds } = require('../core/buildMatch');
const { NotFoundError } = require('./api');
const { playersFromMatches, mergeCandidates, rankOf } = require('../core/discover');
const { parseSteamInput, vanityOf, resolveVanity } = require('./steamIds');
const { buildOverview, dashboardStats, rankFromBadges } = require('../core/overview');
const { gameBadge, tierOfBadge } = require('../core/rank');
const { heroRoles } = require('../core/roles');
const { gameRole, gameLeaks, gameHighlights, leakProfile, counterItems, winLink, RANK_BENCH, WIN_LINKS, lossPerDeath, SOUL_LOSS_THRESHOLD } = require('../core/leaks');
const { soloDeathRows } = require('../core/deaths');
const { mapData } = require('../core/mapdata');
const { heroReport } = require('../core/heroReport');
const { updateCoach } = require('../core/coach');
const { progressView } = require('../core/progress');
const { achievementsView } = require('../core/achievements');
const { T: clockT } = require('../core/tipkit');
const { macroReview } = require('../core/macro');
const { myMatchups, heroVs, prepare, heroOutlook } = require('../core/matchups');
const { proCandidates, versus } = require('../core/versus');
const { playerFeatures, refAll } = require('../core/features');
const { matchTips } = require('../core/tipsMatch');
const { skillOrder, skillConsensus, compareSkills } = require('../core/skills');
const { heroPool, pickAdvice, gamePlan, buildPickMeta, heroRole, RANKED_HERO_RULE } = require('../core/pick');
const { counterCodex } = require('../core/counters');
const { buildHeroMeta, windows: metaWindows, topHeroGames, ladderAccounts, DAY: META_DAY } = require('../core/metashift');
const { buildHeroProfile } = require('../core/heroProfile');
const { computeLift } = require('../core/lift');
const { RULES } = require('../core/counterRules');
const codexData = require('../core/data/codexData.json');
const { matchBuild, buildText, buildFile } = require('../core/buildExport');
const { encodeBuildCode } = require('../core/gameCode');

const DAY = 86400;

// Известные про-игроки. ID аккаунтов — из профилей на Deadfrag (deadfrag.com/players/<ID>).
// v — в какой версии списка игрок добавлен: при обновлении приложения новые игроки
// добавляются сами, а удалённые тобой вручную не возвращаются.
const DEFAULT_FAVORITES_VERSION = 2;
const DEFAULT_FAVORITES = [
  // Abrahams / Leviathan — СНГ и Европа
  { accountId: 906011648, name: 'sanya_sniper', team: 'Leviathan', country: 'RU', v: 1 },
  { accountId: 1055638874, name: 'saintmxsm', team: 'Abrahams', country: 'RU', v: 1 },
  { accountId: 888853854, name: 'ABL', team: 'Leviathan', country: 'KZ', v: 1 },
  { accountId: 298305257, name: 'Dimov', team: 'Leviathan', country: 'BG', v: 2 },
  { accountId: 5278896, name: 'empty dreams', team: 'Leviathan', country: 'RU', v: 2 },
  { accountId: 136898005, name: 'Irezumi', team: 'Leviathan', country: 'RU', v: 2 },
  { accountId: 984254212, name: 'overseas', team: 'Leviathan', country: 'RU', v: 2 },
  { accountId: 1444662928, name: 'Tas', team: 'Abrahams', country: 'RU', v: 2 },
  { accountId: 298155885, name: 'together', team: 'Abrahams', country: 'RU', v: 2 },
  { accountId: 1045169707, name: 'sai', team: '', country: 'UA', v: 2 },
  // Buff Enjoyers — Европа
  { accountId: 483770846, name: 'cosmetical', team: 'Buff Enjoyers', country: '', v: 2 },
  { accountId: 344946432, name: 'vraic', team: 'Buff Enjoyers', country: '', v: 2 },
  { accountId: 87241154, name: 'hoot', team: 'Buff Enjoyers', country: 'SE', v: 2 },
  { accountId: 97533101, name: 'Lystic', team: 'Buff Enjoyers', country: '', v: 2 },
  { accountId: 911856667, name: 'obikym', team: 'Buff Enjoyers', country: '', v: 2 },
  { accountId: 35187362, name: 'Zerggy', team: 'Buff Enjoyers', country: 'GB', v: 2 },
  // Сильнейшие игроки Северной Америки за последние 90 дней (по Deadfrag)
  { accountId: 1730032433, name: 'Zeno', team: '', country: 'US', v: 2 },
  { accountId: 1871021649, name: 'LOMEIN', team: '', country: 'US', v: 2 },
  { accountId: 1477660209, name: 'League', team: '', country: 'CA', v: 2 },
];

// Кого игрок играл в последних 20 матчах и за выбранный период.
// "Спамит" — если один герой занимает половину и больше из последних игр.
function recentHeroes(list, since) {
  const sorted = list.slice().sort((a, b) => (Number(b.start_time) || 0) - (Number(a.start_time) || 0));
  const last = sorted.slice(0, 20);
  const count = (arr) => {
    const m = new Map();
    for (const x of arr) {
      const hid = Number(x.hero_id);
      if (!hid) continue;
      const e = m.get(hid) || { hero_id: hid, games: 0, wins: 0, known: 0 };
      e.games += 1;
      if (typeof x.match_result === 'number' && typeof x.player_team === 'number') {
        e.known += 1;
        if (x.match_result === x.player_team) e.wins += 1;
      }
      m.set(hid, e);
    }
    return [...m.values()].sort((a, b) => b.games - a.games);
  };
  const heroes = count(last);
  const windowList = sorted.filter((x) => (Number(x.start_time) || 0) >= since);
  const top = heroes[0];
  const spam = top && last.length >= 8 && top.games / last.length >= 0.5 ? { hero_id: top.hero_id, games: top.games, of: last.length } : null;
  return { n: last.length, heroes: heroes.slice(0, 6), windowGames: windowList.length, windowHeroes: count(windowList).slice(0, 6), lastPlayed: Number(sorted[0] && sorted[0].start_time) || null, spam };
}
const nowSec = () => Math.floor(Date.now() / 1000);

// Ниже этого ранга игрок не считается топом, если его нет в ладдере (91 = Phantom 1).
const MIN_TOP_BADGE = 91;

// Ранг игрока по истории: значок из самой свежей рейтинговой игры.
function badgeOf(hist) {
  let best = null;
  for (const m of hist || []) {
    const b = Number(m.ranked_display_badge);
    const t = Number(m.start_time) || 0;
    if (b > 0 && (!best || t > best.t)) best = { b, t };
  }
  return best ? best.b : null;
}

class Sync {
  constructor({ api, store, emit }) {
    this.api = api;
    this.store = store;
    this.emit = emit || (() => {});
    this.running = null;
    this.background = false; // текущее обновление запущено по таймеру, а не кнопкой
    this.holdIf = () => false; // true — идёт игра, фоновые загрузки ждут
    this.assets = store.read('assets.json', null);
  }

  progress(stage, done, total, text) {
    this.emit('progress', { stage, done, total, text });
  }

  // Твоя история для анализа: только обычные и рейтинговые матчи. Street Brawl, боты, лобби —
  // другие режимы с другими цифрами, в тренера, ошибки, сводку и матчапы они попадать не должны.
  async historyWithCache(accountId, ttlMs, signal = AbortSignal.timeout(8000)) {
    const id = Number(accountId);
    try {
      return await this.api.matchHistory(id, ttlMs, { signal });
    } catch (error) {
      const rows = this.savedHistory(id);
      if (!rows.length) {
        if (signal.aborted) throw new Error('История матчей не загрузилась вовремя. Попробуй ещё раз.');
        throw error;
      }
      return rows;
    }
  }

  savedHistory(accountId, heroId = null) {
    const rows = [];
    for (const match of this.store.allMatches()) {
      const p = match.players.find((player) => player.account_id === accountId);
      if (!p || (heroId !== null && p.hero_id !== heroId)) continue;
      rows.push({ match_id: match.match_id, hero_id: p.hero_id, start_time: match.start_time,
        match_duration_s: match.duration_s, player_kills: p.k, player_deaths: p.d, player_assists: p.a,
        net_worth: p.nw, player_team: p.team, match_result: match.winning_team ?? (p.won === true ? p.team : null),
        game_mode: match.game_mode, match_mode: match.match_mode, source: 'saved-history' });
    }
    return rows;
  }

  async myHistory(accountId, ttlMs = 60e3, signal) {
    const hist = await this.historyWithCache(accountId, ttlMs, signal);
    return (hist || []).filter((m) => isStandardMatch({ game_mode: m.game_mode, match_mode: m.match_mode }));
  }

  // Матч сохранён старой версией (до 0.11: без коробок, статуй, урона по врагам и режима боя
  // в маршрутах) — его стоит перекачать. Один раз: если API его уже не отдаёт, больше не пробуем.
  needsUpgrade(m) {
    return !!m && (m.v || 1) < EXTRACT_V && !m.upgradeTried;
  }

  needsDownload(id) {
    const m = this.store.getMatch(Number(id));
    return !m || this.needsUpgrade(m);
  }

  // Скачать свой матч (с маршрутами). Не вышло, но есть старая копия — отдаём её.
  async fetchMine(id, signal) {
    try {
      return extractMatch(await this.api.matchMetadata(Number(id), { signal }), { paths: true });
    } catch (e) {
      signal?.throwIfAborted();
      const stored = this.store.getMatch(Number(id));
      if (stored) {
        stored.upgradeTried = true;
        return stored;
      }
      throw e;
    }
  }

  // Игровой режим: фоновое обновление ждёт, пока игра не закроется.
  // Обновление, запущенное кнопкой, не ждёт.
  async yieldToGame() {
    if (!this.background || !this.holdIf()) return;
    this.progress('paused', 0, 1, 'Игровой режим: обновление на паузе, продолжу после игры');
    while (this.background && this.holdIf()) await new Promise((r) => setTimeout(r, this.holdPollMs || 5000));
  }

  // ---------- справочники героев и предметов ----------
  loadAssets(force = false) {
    if (this._assetsLoading) return this._assetsLoading;
    const cached = this.store.read('assets.json', null);
    if (!force && cached && cached.v === 8 && Date.now() - cached.fetchedAt < 24 * 3600e3) {
      this.assets = cached;
      return Promise.resolve(cached);
    }
    this._assetsLoading = this._refreshAssets(cached).finally(() => { this._assetsLoading = null; });
    return this._assetsLoading;
  }

  async _refreshAssets(cached) {
    try {
      const [heroes, items] = await Promise.all([this.api.heroesAssets(), this.api.itemsAssets()]);
      const a = { v: 8, fetchedAt: Date.now(), heroes: {}, items: {} };
      for (const h of heroes || []) {
        if (!h || !h.id) continue;
        const im = h.images || {};
        a.heroes[h.id] = {
          id: h.id,
          name: h.name || `Герой ${h.id}`,
          img: im.icon_image_small || im.icon_hero_card || im.minimap_image || im.top_bar_image || null,
          card: im.icon_hero_card || im.top_bar_vertical_image || im.selection_image || null,
          wide: im.background_image || im.top_bar_image || null,
          color: Array.isArray(h.colors?.ui) && h.colors.ui.length === 3
            && h.colors.ui.every((v) => Number.isInteger(v) && v >= 0 && v <= 255) ? h.colors.ui : null,
          disabled: !!h.disabled,
          inDev: !!h.in_development,
          selectable: typeof h.player_selectable === 'boolean' ? h.player_selectable
            : typeof h.development_state === 'string' ? h.development_state === 'release' : !h.in_development,
          cls: h.class_name || null,
          type: h.hero_type || null,
          tags: Array.isArray(h.tags) ? h.tags : [],
          // способности 1–4 (class_name из items героя: signature1..signature4)
          abilityCls: ['signature1', 'signature2', 'signature3', 'signature4'].map((k) => (h.items && h.items[k]) || null),
        };
      }
      for (const i of items || []) {
        if (!i || !i.id) continue;
        a.items[i.id] = {
          id: i.id,
          name: i.name || `Предмет ${i.id}`,
          type: i.type || null,
          slot: i.item_slot_type || null,
          tier: i.item_tier ?? null,
          cost: i.cost ?? null,
          img: i.shop_image_small || i.shop_image || i.image || i.image_webp || null,
          cls: i.class_name || null,
          compCls: Array.isArray(i.component_items) ? i.component_items : [],
          hero: i.hero ?? null,
          abType: i.ability_type || null,
        };
      }
      // компоненты: из каких предметов собирается улучшенный (по class_name → id)
      const byCls = new Map(Object.values(a.items).filter((x) => x.cls).map((x) => [x.cls, x.id]));
      for (const it of Object.values(a.items)) {
        it.components = it.compCls.map((c) => byCls.get(c)).filter(Boolean);
        delete it.compCls;
      }
      // способности героя: сначала по class_name из справочника героя, иначе — по полю hero у способностей
      for (const hero of Object.values(a.heroes)) {
        let ab = (hero.abilityCls || []).map((c) => (c ? byCls.get(c) : null));
        if (ab.filter(Boolean).length < 4) {
          ab = Object.values(a.items)
            .filter((x) => x.type === 'ability' && x.hero === hero.id && (x.abType === 'signature' || x.abType === 'ultimate'))
            .sort((x, y) => (x.abType === 'ultimate') - (y.abType === 'ultimate'))
            .map((x) => x.id);
        }
        hero.abilities = ab.filter(Boolean).slice(0, 4);
        delete hero.abilityCls;
      }
      a.map = null;
      try {
        const mp = await this.api.mapAssets();
        if (mp) {
          const im = mp.images || {};
          a.map = { radius: mp.radius || mp.map_radius || 10752, img: im.minimap || im.plain || im.background || mp.minimap || mp.image || null, frame: im.frame || null };
        }
      } catch (e) {
        // карта не обязательна
      }
      a.ranks = {};
      try {
        for (const r of await this.api.ranksAssets()) {
          if (!r || typeof r.tier !== 'number') continue;
          const im = r.images || {};
          a.ranks[r.tier] = { tier: r.tier, name: r.name || null, color: r.color || null, img: im.small || im.large || null, sub: im };
        }
      } catch (e) {
        // ранги — не обязательны
      }
      this.store.write('assets.json', a);
      this.assets = a;
      return a;
    } catch (e) {
      if (cached) {
        this.assets = cached;
        return cached;
      }
      throw new Error(`Не удалось загрузить список героев и предметов: ${e.message}`);
    }
  }

  // ---------- ладдер: кто в топе и какой у него аккаунт ----------
  // Самый свежий матч аккаунта (0 — если истории нет или запрос не удался).
  async lastPlayed(accountId, report) {
    try {
      const h = await this.api.matchHistory(accountId, 60 * 60e3);
      return Math.max(0, ...h.map((m) => Number(m.start_time) || 0));
    } catch (e) {
      if (report) report.errors.push(`история ${accountId}: ${e.message}`);
      return 0;
    }
  }

  // Несколько аккаунтов с одним ником: берём тот, у кого выше ранг в последней рейтинговой игре
  // (а не просто последнего игравшего) и только если он не ниже Phantom.
  async pickBestAccount(candidates, report) {
    let best = null;
    for (const c of candidates.slice(0, 6)) {
      try {
        const h = await this.api.matchHistory(c, 60 * 60e3);
        const badge = badgeOf(h) || 0;
        const last = Math.max(0, ...h.map((m) => Number(m.start_time) || 0));
        if (!last) continue;
        if (!best || badge > best.badge || (badge === best.badge && last > best.last)) best = { id: c, badge, last };
      } catch (e) {
        if (report) report.errors.push(`история ${c}: ${e.message}`);
      }
    }
    return best && best.badge >= MIN_TOP_BADGE ? best.id : null;
  }

  async pickMostRecent(candidates, report) {
    let best = null;
    for (const c of candidates.slice(0, 6)) {
      const last = await this.lastPlayed(c, report);
      if (!best || last > best.last) best = { id: c, last };
    }
    return best && best.last > 0 ? best.id : null;
  }

  // Откуда брать топов (настройка «Источник топа»):
  //  auto    — ладдер текущего сезона, если в нём уже есть нужное число игроков;
  //            иначе финальный ладдер прошлого сезона; иначе свой список / поиск по матчам
  //  prev    — всегда финальный ладдер прошлого сезона
  //  current — только текущий ладдер
  //  list    — только свой список
  // Топ только ТЕКУЩЕГО сезона: ладдер региона. Если в нём пока меньше игроков,
  // чем нужно (начало сезона), добираем сильнейших из свежих матчей этого сезона.
  async resolveTop(settings, report) {
    const mode = settings.topSource === 'list' ? 'list' : 'auto';
    report.topSource = mode;
    if (mode === 'list') return this.fallbackTop(settings, report, { onlyList: true });
    let entries = [];
    this.progress('ladder', 0, 1, `Загружаю ладдер текущего сезона (${settings.region})…`);
    try {
      const rawLb = await this.api.leaderboard(settings.region);
      entries = Array.isArray(rawLb) ? rawLb : (rawLb && rawLb.entries) || [];
    } catch (e) {
      report.errors.push(`ладдер: ${e.message}`);
    }
    report.ladder = { entries: entries.length, sample: entries.slice(0, 2) };
    if (!entries.length) return this.fallbackTop(settings, report);
    this.archiveLadder(settings.region, entries);
    const out = await this.resolveEntries(entries, settings, report, 'ladder');
    const have = out.players.filter((p) => p.accountId);
    if (have.length >= settings.topN) return out;
    // ладдер ещё короткий — добираем
    let extra = { players: [] };
    try {
      extra = await this.fallbackTop({ ...settings, manualTop: '', topN: settings.topN * 2 }, report);
    } catch (e) {
      report.errors.push(`добор игроков: ${e.message}`);
    }
    const ids = new Set(have.map((p) => p.accountId));
    const merged = out.players.slice();
    for (const p of extra.players) {
      if (merged.filter((x) => x.accountId).length >= settings.topN) break;
      if (!p.accountId || ids.has(p.accountId)) continue;
      ids.add(p.accountId);
      merged.push({ ...p, rank: null, ladder: false, how: 'discovered' }); // места в ладдере у него нет
    }
    const res = { ...out, players: merged, source: merged.length > out.players.length ? 'ladder+discovered' : out.source };
    this.store.write('top.json', res);
    return res;
  }

  // Сохраняем снимок ладдера: пригодится, когда начнётся следующий сезон.
  archiveLadder(region, entries) {
    const arch = this.store.read('ladderArchive.json', {});
    const list = arch[region] || [];
    list.push({ at: nowSec(), entries: entries.slice(0, 300).map((e) => ({ rank: e.rank, account_name: e.account_name, possible_account_ids: e.possible_account_ids || [] })) });
    arch[region] = list.slice(-20);
    this.store.write('ladderArchive.json', arch);
  }

  async resolveEntries(entries, settings, report, source) {
    const prev = this.store.read('top.json', { players: [] });
    const prevByName = new Map(prev.players.map((p) => [p.name, p]));
    const overrides = this.store.read('overrides.json', {});
    const top = entries
      .map((e, idx) => ({ ...e, rank: Number(e.rank) || idx + 1 }))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, settings.topN);
    const players = [];
    const counts = { exact: 0, guess: 0, manual: 0, search: 0, none: 0 };
    let i = 0;
    for (const e of top) {
      i += 1;
      this.progress('ladder', i, top.length, `Определяю аккаунты топов: ${i}/${top.length}`);
      const name = e.account_name || e.name || `#${e.rank}`;
      let candidates = (e.possible_account_ids || (e.account_id ? [e.account_id] : [])).map(Number).filter(Boolean);
      let accountId = null;
      let how = 'none';
      const old = prevByName.get(name);
      if (overrides[name]) {
        accountId = Number(overrides[name]);
        how = 'manual';
      } else if (candidates.length === 1) {
        accountId = candidates[0];
        how = 'exact';
      } else if (old && old.accountId && (old.how === 'guess' || old.how === 'search') && (!candidates.length || candidates.includes(old.accountId))) {
        accountId = old.accountId; // уже определяли раньше — не тратим запросы
        how = old.how;
      } else if (candidates.length > 1) {
        accountId = await this.pickBestAccount(candidates, report);
        if (accountId) how = 'guess';
      } else if (e.account_name) {
        // Сервер не сопоставил ник с аккаунтом — ищем профиль Steam по нику.
        try {
          const found = await this.api.steamSearch(name);
          const exact = found.filter((p) => String(p.personaname || '').toLowerCase() === name.toLowerCase()).map((p) => Number(p.account_id)).filter(Boolean);
          candidates = exact;
          if (exact.length === 1) accountId = exact[0];
          else if (exact.length > 1) accountId = await this.pickBestAccount(exact, report);
          if (accountId) how = 'search';
        } catch (err) {
          report.errors.push(`поиск ника ${name}: ${err.message}`);
        }
      }
      counts[how] += 1;
      players.push({ rank: e.rank, ladder: source === 'ladder', name, accountId, how, candidates, topHeroes: e.top_hero_ids || [] });
    }
    report.accounts = counts;
    const out = { fetchedAt: nowSec(), region: settings.region, source, players };
    this.store.write('top.json', out);
    return out;
  }

  // ---------- избранные игроки (стримеры, про-игроки) ----------
  // Всегда учитываются вместе с топом: в мете, в сборках и в лагере.
  withFavorites(top) {
    const favs = this.favorites();
    const byId = new Map(top.players.filter((p) => p.accountId).map((p) => [p.accountId, p]));
    for (const f of favs) {
      const existing = byId.get(f.accountId);
      if (existing) {
        existing.favorite = true;
        if (f.team) existing.team = f.team;
      }
      else top.players.push({ rank: null, name: f.name, team: f.team || '', accountId: f.accountId, how: 'favorite', favorite: true, candidates: [f.accountId], topHeroes: [] });
    }
    this.store.write('top.json', top);
    return top;
  }

  favorites() {
    // Известные игроки СНГ-сцены добавляются один раз при первом запуске (ID — из профилей на Deadfrag).
    const seeded = this.store.read('favoritesSeeded.json', 0);
    const seededVersion = seeded === true ? 1 : Number(seeded) || 0;
    if (seededVersion < DEFAULT_FAVORITES_VERSION) {
      const favs = this.store.read('favorites.json', []);
      for (const d of DEFAULT_FAVORITES) {
        if (d.v <= seededVersion) continue;
        if (favs.some((f) => f.accountId === d.accountId)) continue;
        const { v, ...rest } = d;
        favs.push({ ...rest, addedAt: nowSec() });
      }
      this.store.write('favorites.json', favs);
      this.store.write('favoritesSeeded.json', DEFAULT_FAVORITES_VERSION);
    }
    return this.store.read('favorites.json', []);
  }

  addFavorite({ accountId, name }) {
    const id = Number(accountId);
    if (!id) throw new Error('Нет ID аккаунта');
    const favs = this.favorites().filter((f) => f.accountId !== id);
    favs.push({ accountId: id, name: String(name || id), addedAt: nowSec() });
    this.store.write('favorites.json', favs);
    const top = this.store.read('top.json', null);
    if (top) this.withFavorites(top);
    return favs;
  }

  removeFavorite(accountId) {
    const id = Number(accountId);
    const favs = this.favorites().filter((f) => f.accountId !== id);
    this.store.write('favorites.json', favs);
    const top = this.store.read('top.json', null);
    if (top) {
      top.players = top.players.filter((p) => !(p.how === 'favorite' && p.accountId === id));
      for (const p of top.players) if (p.accountId === id) p.favorite = false;
      this.store.write('top.json', top);
    }
    return favs;
  }

  // Поиск игрока по нику или ссылке: показываем, кто реально играет в Deadlock,
  // чтобы не перепутать стримера с тёзкой.
  async searchPlayers(query) {
    const q = String(query || '').trim();
    if (!q) return [];
    let profiles = [];
    let parsed = parseSteamInput(q);
    if (!parsed && /steamcommunity\.com\/id\//i.test(q)) {
      try {
        parsed = await resolveVanity(vanityOf(q));
      } catch {}
    }
    if (parsed) {
      profiles = [{ account_id: parsed.accountId }];
      try {
        const [pr] = await this.api.steamProfiles([parsed.accountId]);
        if (pr) profiles = [pr];
      } catch {}
    } else {
      profiles = (await this.api.steamSearch(q)).slice(0, 10);
    }
    const since = nowSec() - 14 * DAY;
    const out = [];
    for (const p of profiles.slice(0, 8)) {
      const id = Number(p.account_id);
      if (!id) continue;
      let hist = [];
      try {
        hist = await this.api.matchHistory(id, 60 * 60e3);
      } catch {}
      const recent = recentHeroes(hist, since);
      out.push({
        accountId: id,
        name: p.personaname || String(id),
        avatar: p.avatarmedium || p.avatar || null,
        profileurl: p.profileurl || null,
        totalGames: hist.length,
        games14: recent.windowGames,
        lastPlayed: recent.lastPlayed,
        heroes: recent.heroes.slice(0, 3),
      });
    }
    return out.sort((a, b) => b.games14 - a.games14 || b.totalGames - a.totalGames);
  }

  // Имена для найденных аккаунтов (из профилей Steam).
  async namesFor(ids) {
    const names = new Map();
    for (let i = 0; i < ids.length; i += 50) {
      try {
        for (const p of await this.api.steamProfiles(ids.slice(i, i + 50))) names.set(Number(p.account_id), p.personaname);
      } catch {}
    }
    return names;
  }

  // Ладдер пуст (новый сезон) — берём топов из запасных источников.
  async fallbackTop(settings, report, { onlyList = false } = {}) {
    report.fallback = {};
    // 1) Свой список игроков из настроек
    const manual = String(settings.manualTop || '')
      .split(/[\s,;]+/)
      .map(parseSteamInput)
      .filter(Boolean)
      .map((x) => x.accountId);
    if (manual.length) {
      const names = await this.namesFor(manual);
      const players = [...new Set(manual)].slice(0, settings.topN).map((accountId, i) => ({ rank: i + 1, name: names.get(accountId) || `ID ${accountId}`, accountId, how: 'list', candidates: [accountId], topHeroes: [] }));
      report.fallback.source = 'list';
      report.accounts = { list: players.length };
      const out = { fetchedAt: nowSec(), region: settings.region, source: 'list', players };
      this.store.write('top.json', out);
      return out;
    }
    if (onlyList) {
      report.fallback.source = 'list';
      report.accounts = { list: 0 };
      const out = { fetchedAt: nowSec(), region: settings.region, source: 'list', players: [] };
      this.store.write('top.json', out);
      return out;
    }
    // 2) Игроки из свежих матчей с самым высоким рангом
    this.progress('ladder', 0, 1, 'Ладдер пуст (новый сезон) — ищу сильнейших игроков в свежих матчах…');
    const rows = [];
    for (const [key, fn] of [['active', () => this.api.activeMatches()], ['recent', () => this.api.recentMatches()]]) {
      try {
        const found = playersFromMatches(await fn());
        report.fallback[key] = found.length;
        rows.push(...found);
      } catch (e) {
        report.fallback[key] = `ошибка: ${e.message}`;
        report.errors.push(`${key}: ${e.message}`);
      }
    }
    const { list, regionFiltered } = mergeCandidates(rows, settings.region);
    report.fallback.regionFiltered = regionFiltered;
    report.fallback.candidates = list.length;
    let pool = list.slice(0, 200);
    try {
      const ranks = await this.api.ranks(pool.map((c) => c.account_id));
      const byId = new Map(ranks.map((r) => [Number(r.account_id), rankOf(r)]));
      report.fallback.ranked = [...byId.values()].filter((v) => v !== null).length;
      report.fallback.rankSample = ranks.slice(0, 2);
      for (const c of pool) c.badge = byId.get(c.account_id) ?? null;
      pool.sort((a, b) => (b.badge ?? -1) - (a.badge ?? -1) || b.matchBadge - a.matchBadge);
    } catch (e) {
      report.errors.push(`ранги игроков: ${e.message}`);
    }
    pool = pool.slice(0, settings.topN);
    const names = await this.namesFor(pool.map((c) => c.account_id));
    const players = pool.map((c) => ({ rank: null, ladder: false, name: names.get(c.account_id) || `ID ${c.account_id}`, accountId: c.account_id, how: 'discovered', badge: c.badge ?? c.matchBadge ?? null, candidates: [c.account_id], topHeroes: [] }));
    report.fallback.source = 'discovered';
    report.accounts = { discovered: players.length };
    const out = { fetchedAt: nowSec(), region: settings.region, source: players.length ? 'discovered' : 'none', players };
    this.store.write('top.json', out);
    return out;
  }

  // ---------- матчи топов ----------
  async syncTopMatches(settings, top, report) {
    const since = nowSec() - settings.days * DAY;
    const missing = this.store.read('missing.json', {});
    const ids = new Set();
    const withAcc = top.players.filter((p) => p.accountId);
    const h = (report.history = { players: withAcc.length, ok: 0, failed: 0, empty: 0, rows: 0, old: 0, otherMode: 0, kept: 0, modes: {}, sample: null });
    let i = 0;
    for (const p of withAcc) {
      await this.yieldToGame();
      i += 1;
      this.progress('history', i, withAcc.length, `История матчей топов: ${i}/${withAcc.length} (${p.name})`);
      try {
        const list = await this.api.matchHistory(p.accountId);
        h.ok += 1;
        p.recent = recentHeroes(list, since);
        // ранг — из последней рейтинговой игры этого сезона; кто не в ладдере и ниже Phantom — не топ
        p.badge = badgeOf(list);
        const trusted = p.how === 'exact' || p.how === 'manual' || p.how === 'list' || p.how === 'favorite' || p.favorite;
        p.excluded = !trusted && (p.badge === null || p.badge < MIN_TOP_BADGE);
        if (p.excluded) {
          h.lowRank = (h.lowRank || 0) + 1;
          continue;
        }
        if (!list.length) h.empty += 1;
        if (!h.sample && list.length) h.sample = list[0];
        for (const m of list) {
          h.rows += 1;
          const key = `${m.game_mode}/${m.match_mode}`;
          h.modes[key] = (h.modes[key] || 0) + 1;
          const st = Number(m.start_time);
          // если времени нет — не выкидываем: точное время возьмём из метаданных матча
          if (st && st < since) {
            h.old += 1;
            continue;
          }
          if (!isStandardMatch({ game_mode: m.game_mode, match_mode: m.match_mode }, { onlyRanked: settings.onlyRanked })) {
            h.otherMode += 1;
            continue;
          }
          h.kept += 1;
          const id = Number(m.match_id);
          if (id) ids.add(id);
        }
      } catch (e) {
        h.failed += 1;
        report.errors.push(`история ${p.name} (${p.accountId}): ${e.message}`);
      }
    }
    this.store.write('top.json', top); // сохраняем, кто что играл в последних матчах
    const now = nowSec();
    const fresh = [...ids].filter((id) => !this.store.hasMatch(id) && !(missing[id] && now - missing[id] < 2 * 3600));
    // старые копии (до 0.11) понемногу перекачиваем: новые сначала, не больше 120 за раз
    const upgrade = [...ids].filter((id) => this.needsUpgrade(this.store.getMatch(id))).sort((a, b) => b - a).slice(0, 120);
    const todo = fresh.concat(upgrade);
    const mr = (report.matches = { unique: ids.size, alreadyHave: ids.size - todo.length, todo: todo.length, downloaded: 0, notFound: 0, failed: 0 });
    let done = 0;
    for (const id of todo) {
      await this.yieldToGame();
      done += 1;
      this.progress('matches', done, todo.length, `Скачиваю матчи: ${done}/${todo.length}`);
      try {
        const raw = await this.api.matchMetadata(id);
        await this.store.putMatch(extractMatch(raw));
        delete missing[id];
        mr.downloaded += 1;
      } catch (e) {
        const stored = this.store.getMatch(id);
        if (stored) {
          await this.store.putMatch({ ...stored, upgradeTried: true });
          continue;
        }
        if (e instanceof NotFoundError) {
          missing[id] = now;
          mr.notFound += 1;
        } else {
          mr.failed += 1;
          report.errors.push(`матч ${id}: ${e.message}`);
        }
      }
    }
    this.store.write('missing.json', missing);
    await this.store.prune(nowSec() - settings.keepDays * DAY);
    return { found: ids.size, downloaded: mr.downloaded, unavailable: mr.notFound + mr.failed };
  }

  computeMeta(settings) {
    const top = this.store.read('top.json', null);
    if (!top) return null;
    const meta = buildMeta({
      matches: this.store.allMatches(),
      topList: top.players.filter((p) => !p.excluded),
      sinceTs: nowSec() - settings.days * DAY,
      onlyRanked: settings.onlyRanked,
      assets: this.assets,
    });
    meta.topFetchedAt = top.fetchedAt;
    meta.region = top.region;
    meta.days = settings.days;
    meta.unresolved = top.players.filter((p) => !p.accountId).length;
    meta.source = top.source || 'ladder';
    this.store.write('meta.json', meta);
    return meta;
  }

  // Полное обновление режима "мета топ-50".
  refreshTop(settings, { background = false } = {}) {
    if (this.running) {
      if (!background) this.background = false; // нажали кнопку — больше не ждём конца игры
      return this.running;
    }
    this.background = background;
    this.running = (async () => {
      try {
        const report = { at: nowSec(), region: settings.region, topN: settings.topN, days: settings.days, onlyRanked: settings.onlyRanked, errors: [] };
        try {
          await this.loadAssets();
        } catch (e) {
          report.errors.push(e.message);
        }
        let top;
        let res;
        try {
          top = this.withFavorites(await this.resolveTop(settings, report));
          res = await this.syncTopMatches(settings, top, report);
        } catch (e) {
          report.errors.push(e.message);
          report.fatal = e.message;
          this.store.write('status.json', { ...(this.store.read('status.json', {}) || {}), report });
          throw e;
        }
        const meta = this.computeMeta(settings);
        report.meta = meta ? { matches: meta.totalMatches, records: meta.totalRecords, storedMatches: this.store.matches.size } : null;
        report.errors = report.errors.slice(0, 30);
        const status = { lastSync: nowSec(), ...res, report };
        this.store.write('status.json', status);
        this.progress('done', 1, 1, 'Готово');
        return { meta, status };
      } finally {
        this.running = null;
        this.background = false;
      }
    })();
    return this.running;
  }

  // ---------- мета героев по готовой статистике API (матчи не скачиваем) ----------
  // Кэш в профиле на час (heroshift.json); при ошибке сети отдаём последний сохранённый результат с датой.
  async heroMeta({ force = false } = {}) {
    const cached = this.store.read('heroshift.json', null);
    const usable = cached && cached.v === 1 && Array.isArray(cached.heroes) && cached.heroes.length ? cached : null;
    if (!force && usable && Date.now() - usable.at < 3600e3) return { ...usable, stale: false };
    if (this._hmRunning) return this._hmRunning;
    this._hmRunning = (async () => {
      try {
        const now = nowSec();
        const win = metaWindows(now);
        let badge = 91; // Фантом 1+
        const load = (b) => this.api.heroStatsDaily({ from: win.prev.from, to: win.cur.to, badge: b });
        let rows = await load(badge);
        const curGames = (r) => r.filter((x) => x.bucket >= win.cur.from).reduce((sum, x) => sum + (Number(x.matches) || 0), 0);
        // на высоком ранге мало игр — берём уровень пониже, как в «Перед игрой»
        if (curGames(rows) / 12 < 15000) {
          badge = 81;
          rows = await load(badge);
        }
        let banRows = null;
        let banError = null;
        try {
          banRows = await this.api.heroBansDaily({ from: win.prev.from, to: win.cur.to, badge });
        } catch (e) {
          banError = e.message;
        }
        let patches = [];
        try {
          patches = await this.api.patches();
        } catch (e) {
          this.emit('log', `patches: ${e.message}`);
        }
        const meta = buildHeroMeta({ heroRows: rows, banRows, patches, now });
        if (!meta.heroes.length) throw new Error('deadlock-api не отдал статистику героев');
        if (banError && !meta.bans.available) meta.bans.reason = `Баны не загрузились (${banError}).`;
        const out = { ...meta, at: Date.now(), badge, mode: 'ranked' };
        this.store.write('heroshift.json', out);
        return { ...out, stale: false };
      } catch (e) {
        if (usable) return { ...usable, stale: true, error: e.message };
        throw e;
      } finally {
        this._hmRunning = null;
      }
    })();
    return this._hmRunning;
  }

  // Последние игры героя за 14 дней у игроков топ-300 ладдера региона (одним запросом к API).
  // Берём только игроков с однозначным аккаунтом: чужие игры нельзя выдавать за игры топа.
  async heroTopGames(heroId, settings, { force = false } = {}) {
    heroId = Number(heroId);
    const all = this.store.read('herotopgames.json', {}) || {};
    const cached = all[heroId] && all[heroId].region === settings.region ? all[heroId] : null;
    if (!force && cached && Date.now() - cached.at < 3600e3) return { ...cached, stale: false };
    try {
      const raw = await this.api.leaderboard(settings.region);
      const entries = Array.isArray(raw) ? raw : (raw && raw.entries) || [];
      const ladder = ladderAccounts(entries, this.store.read('overrides.json', {}) || {}, 300);
      if (!ladder.accounts.size) throw new Error('в ладдере региона нет игроков с определённым аккаунтом');
      const now = nowSec();
      const matches = await this.api.topHeroMatches({ accountIds: [...ladder.accounts.keys()], heroId, since: now - 14 * META_DAY, limit: 1000 });
      const res = topHeroGames({ matches, accounts: ladder.accounts, heroId, now, days: 14 });
      // итог считаем по всем играм за период, в профиле храним только свежие 200 строк таблицы
      const out = { ...res, games: res.games.slice(0, 200), region: settings.region, ladder: { entries: ladder.entries, resolved: ladder.resolved, cap: ladder.cap }, truncated: matches.length >= 1000, at: Date.now() };
      all[heroId] = out;
      this.store.write('herotopgames.json', all);
      return { ...out, stale: false };
    } catch (e) {
      if (cached) return { ...cached, stale: true, error: e.message };
      throw e;
    }
  }

  // ---------- билд героя: варианты сборок, паверспайки, кто играет ----------
  async heroBuild(heroId, settings) {
    const top = this.store.read('top.json', { players: [] });
    const accounts = new Set(top.players.filter((p) => p.accountId && !p.excluded).map((p) => p.accountId));
    const since = nowSec() - settings.days * DAY;
    const matches = this.store.allMatches().filter((m) => m.start_time >= since && isStandardMatch(m, { onlyRanked: settings.onlyRanked }));
    const bench = benchmarkPlayers({ matches, heroId, accounts });
    const records = bench.map((b) => ({ items: b.player.items, won: b.player.won, account_id: b.player.account_id, _b: b }));
    const clusters = clusterBuilds(records, this.assets);
    let raw = null;
    let buildsError = null;
    if (records.length) {
      try {
        raw = await this.api.builds(heroId);
      } catch (e) {
        buildsError = e.message;
      }
    }
    const variants = clusters.variants.map((v, i) => {
      const vb = v.recs.map((r) => r._b);
      return {
        index: i,
        label: clusters.variants.length > 1 ? `Вариант ${i + 1}: ${v.style.name}` : `Основной билд: ${v.style.name}`,
        style: v.style.key,
        games: v.games,
        wins: v.wins,
        winrate: v.winrate,
        ci_lo: v.ci_lo,
        ci_hi: v.ci_hi,
        share: v.share,
        players: v.players,
        signature: v.signature,
        build: { n: v.build.n, core: v.build.core, situational: v.build.situational, phases: v.build.phases, openers: v.build.openers },
        spikes: findSpikes(vb.length >= 5 ? vb : bench, v.build.core),
        similar: raw ? rankBuilds(raw, v.build.core, { limit: 3 }) : [],
      };
    });
    const byPlayer = new Map();
    for (const r of records) {
      const p = byPlayer.get(r.account_id) || { accountId: r.account_id, games: 0, wins: 0 };
      p.games += 1;
      if (r.won) p.wins += 1;
      byPlayer.set(r.account_id, p);
    }
    const info = new Map(top.players.map((p) => [p.accountId, p]));
    const players = [...byPlayer.values()]
      .map((p) => {
        const t = info.get(p.accountId) || {};
        const spam = t.recent && t.recent.spam && t.recent.spam.hero_id === heroId ? t.recent.spam : null;
        return { ...p, name: t.name || String(p.accountId), rank: t.rank ?? null, spam };
      })
      .sort((a, b) => b.games - a.games);
    // спамеры героя из всего топа (даже если их матчи ещё не скачаны)
    const spammers = top.players
      .filter((p) => p.recent && p.recent.spam && p.recent.spam.hero_id === heroId)
      .map((p) => ({ accountId: p.accountId, name: p.name, rank: p.rank, ...p.recent.spam }));
    const skills = skillConsensus(bench.map((b) => skillOrder(b.player, this.assets)));
    return { heroId, games: records.length, wins: records.filter((r) => r.won).length, variants, players, spammers, buildsError, skills };
  }

  // ---------- подробности одного матча ----------
  async fetchMatch(matchId, { paths = false, signal } = {}) {
    const id = Number(matchId);
    let m = this.store.getMatch(id);
    const needPaths = paths && m && !m.paths && !m.pathsTried;
    if (!m || needPaths || this.needsUpgrade(m)) {
      try {
        m = extractMatch(await this.api.matchMetadata(id, { signal }), { paths });
        if (paths) m.pathsTried = true;
      } catch (e) {
        const stored = this.store.getMatch(id);
        if (stored) {
          stored.pathsTried = true;
          stored.upgradeTried = true;
          return stored;
        }
        if (e instanceof NotFoundError) throw new Error('Подробных данных этого матча пока нет в deadlock-api. Попробуй позже.');
        throw e;
      }
      await this.store.putMatch(m);
    }
    return m;
  }

  async matchDetail(matchId, accountId) {
    const m = await this.fetchMatch(matchId, { paths: true }).catch(async () => this.fetchMatch(matchId));
    const focusId = Number(accountId);
    const names = await this.namesFor(m.players.map((p) => p.account_id));
    const top = this.store.read('top.json', { players: [] });
    const topInfo = new Map(top.players.filter((p) => p.accountId).map((p) => [p.accountId, p]));
    const last = (p, f) => (p.stats.length ? p.stats[p.stats.length - 1][f] : null);
    const players = m.players.map((p) => ({
      account_id: p.account_id,
      name: topInfo.get(p.account_id)?.name || names.get(p.account_id) || `ID ${p.account_id}`,
      rank: topInfo.get(p.account_id)?.rank ?? null,
      favorite: !!topInfo.get(p.account_id)?.favorite,
      hero_id: p.hero_id,
      team: p.team,
      won: p.won,
      k: p.k,
      d: p.d,
      a: p.a,
      nw: p.nw,
      lh: p.lh,
      pdmg: last(p, 'pdmg'),
      heal: last(p, 'heal'),
      focus: p.account_id === focusId,
    }));
    const fp = m.players.find((p) => p.account_id === focusId) || m.players[0];
    const maxMinute = Math.max(1, lastMinute(fp.stats));
    // кривые: этот игрок против медианы остальных 11 игроков матча
    const others = m.players.filter((p) => p !== fp).map((p) => ({ player: p }));
    const curves = {};
    for (const f of ['nw', 'pdmg', 'farm', 'ka', 'd']) {
      const me = [];
      const med = [];
      const p25 = [];
      const p75 = [];
      for (let mi = 0; mi <= maxMinute; mi++) {
        me.push(valueAt(fp.stats, f, mi * 60));
        const vals = others.map((o) => valueAt(o.player.stats, f, mi * 60)).filter((v) => v !== null).sort((a, b) => a - b);
        const q = (x) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(x * (vals.length - 1)))] : null);
        med.push(q(0.5));
        p25.push(q(0.25));
        p75.push(q(0.75));
      }
      curves[f] = { me, med, p25, p75, n: [] };
    }
    const fates = new Map(itemFates(fp.items, this.assets).map((f) => [`${f.id}:${f.t}`, { fate: f.fate, into: f.into }]));
    const items = fp.items
      .filter(([id]) => isUpgrade(this.assets, id))
      .map(([id, t, sold]) => ({ id, t, sold: sold || null, ...(fates.get(`${id}:${t}`) || {}) }))
      .sort((a, b) => a.t - b.t);
    // после каких покупок урон резко вырос именно в этой игре
    const firsts = firstPurchases(fp, this.assets);
    const jumps = [...firsts.entries()]
      .map(([id, t]) => ({ id, t, a: aroundPurchase(fp.stats, t) }))
      .filter((x) => x.a && x.a.lift !== null && x.a.lift >= 1.2)
      .sort((x, y) => y.a.lift - x.a.lift)
      .slice(0, 3)
      .map((x) => ({ id: x.id, t: x.t, before: x.a.before, after: x.a.after, lift: x.a.lift, participated: x.a.participated }));
    const lastStat = fp.stats[fp.stats.length - 1] || {};
    const sources = SOURCE_FIELDS.map((f) => ({ field: f, name: SOURCE_NAMES[f], value: lastStat[f] ?? null }));
    return {
      map: mapData(m),
      match: { match_id: m.match_id, start_time: m.start_time, duration_s: m.duration_s, winning_team: m.winning_team, badge: m.badge },
      focus: { account_id: fp.account_id, hero_id: fp.hero_id, team: fp.team, won: fp.won, deaths: fp.deaths_t, lost: lastStat.g_lost ?? null },
      players,
      curves,
      items,
      jumps,
      sources,
    };
  }

  // ---------- карточка про-игрока ----------
  async playerDetail(accountId, settings) {
    const id = Number(accountId);
    const top = this.store.read('top.json', { players: [] });
    const player = top.players.find((p) => p.accountId === id) || { accountId: id, name: String(id) };
    let hist = [];
    let error = null;
    try {
      hist = await this.api.matchHistory(id);
    } catch (e) {
      error = e.message;
    }
    const since = nowSec() - settings.days * DAY;
    const games = hist
      .slice()
      .sort((a, b) => (Number(b.start_time) || 0) - (Number(a.start_time) || 0))
      .slice(0, 40)
      .map((m) => {
        const ex = this.store.getMatch(m.match_id);
        const pl = ex && ex.players.find((x) => x.account_id === id);
        const items = pl ? [...firstPurchases(pl, this.assets).entries()].sort((a, b) => a[1] - b[1]).slice(0, 12).map(([iid, t]) => ({ id: iid, t })) : null;
        const won = pl ? pl.won : typeof m.match_result === 'number' && typeof m.player_team === 'number' ? m.match_result === m.player_team : null;
        return {
          match_id: Number(m.match_id),
          start_time: Number(m.start_time) || null,
          duration_s: m.match_duration_s,
          hero_id: Number(m.hero_id),
          k: m.player_kills,
          d: m.player_deaths,
          a: m.player_assists,
          nw: m.net_worth,
          won,
          items,
          inWindow: (Number(m.start_time) || 0) >= since,
        };
      });
    const recent = hist.length ? recentHeroes(hist, since) : player.recent || null;
    return { player: { ...player, recent }, games, error };
  }

  // ---------- твои матчи ----------
  async myMatches(accountId, { fresh = false, cachedOnly = false } = {}) {
    accountId = Number(accountId);
    let h = null;
    let freshInfo = null;
    let source = 'saved';
    const signal = cachedOnly ? null : AbortSignal.timeout(8000);
    if (fresh && signal) {
      try {
        h = await this.api.matchHistoryFresh(accountId, { signal });
        source = 'steam';
        freshInfo = { ok: true };
      } catch (e) {
        freshInfo = { ok: false, limited: e.code === 429, error: e.message };
      }
    }
    if (!h && signal && !signal.aborted) {
      try {
        h = await this.api.matchHistory(accountId, 60e3, { signal });
        source = 'api';
      } catch {
        // При сбое остаются игры из локальных файлов.
      }
    }
    const history = new Map(this.savedHistory(accountId).map((m) => [m.match_id, m]));
    const onlineIds = new Set();
    for (const m of h || []) {
      const id = Number(m.match_id);
      if (!Number.isSafeInteger(id) || id <= 0) continue;
      history.set(id, m);
      onlineIds.add(id);
    }
    const rows = [...history.values()].map((m) => {
      const stored = this.store.getMatch(m.match_id);
      const me = stored && stored.players.find((p) => p.account_id === accountId);
      return {
        match_id: Number(m.match_id),
        hero_id: m.hero_id,
        start_time: m.start_time,
        duration_s: m.match_duration_s,
        k: m.player_kills,
        d: m.player_deaths,
        a: m.player_assists,
        nw: m.net_worth,
        won: me ? me.won : typeof m.match_result === 'number' && typeof m.player_team === 'number' ? m.match_result === m.player_team : null,
        loaded: !!me,
        match_mode: m.match_mode,
        source: m.source,
      };
    });
    // На диске могут быть записи от сканирования другого профиля.
    const known = new Set(rows.map((r) => r.match_id));
    const pendingForAccount = (p) => (!p.accountId || p.accountId === accountId) && Date.now() - p.at < 3 * 86400e3;
    if (signal && !signal.aborted) {
      const pendingSignal = AbortSignal.any([signal, AbortSignal.timeout(3000)]);
      const tryNow = this.store.read('pending.json', []).filter((p) => pendingForAccount(p) && !known.has(p.match_id) && !this.store.hasMatch(p.match_id) && (!p.tried || Date.now() - p.tried > 5 * 60e3))
        .sort((x, y) => y.match_id - x.match_id).slice(0, 2);
      for (const p of tryNow) {
        if (pendingSignal.aborted) break;
        // Сохраняем отметку до ожидания API, чтобы не затирать результат параллельного сканирования.
        const latest = this.store.read('pending.json', []);
        const entry = latest.find((x) => x.match_id === p.match_id && x.accountId === p.accountId);
        if (!entry || (entry.tried && Date.now() - entry.tried <= 5 * 60e3)) continue;
        entry.tried = Date.now();
        this.store.write('pending.json', latest);
        try {
          const m = extractMatch(await this.api.matchMetadataOnce(p.match_id, { signal: pendingSignal }), { paths: true });
          m.pathsTried = true;
          await this.store.putMatch(m);
        } catch {
          // Метаданные ещё недоступны, оставляем запись в ожидании.
        }
      }
    }
    const pending = this.store.read('pending.json', []);
    for (const p of pending.filter(pendingForAccount)) {
      if (known.has(p.match_id)) continue;
      const stored = this.store.getMatch(p.match_id);
      const me = stored && stored.players.find((x) => x.account_id === accountId);
      if (stored && !me) continue; // чужой матч из кэша (например, смотрел игру про-игрока)
      known.add(p.match_id);
      if (stored && me) {
        rows.push({ match_id: stored.match_id, hero_id: me.hero_id, start_time: stored.start_time, duration_s: stored.duration_s, k: me.k, d: me.d, a: me.a, nw: me.nw, won: me.won, loaded: true, match_mode: stored.match_mode, source: 'cache' });
      } else {
        rows.push({ match_id: p.match_id, pending: true, start_time: null, source: 'cache' });
      }
    }
    if (!cachedOnly) {
      const keep = pending.filter((p) => Date.now() - p.at < 3 * 86400e3 && (!pendingForAccount(p) || !onlineIds.has(p.match_id)));
      if (keep.length !== pending.length) this.store.write('pending.json', keep);
    }
    rows.sort((x, y) => (y.pending ? 2e9 : y.start_time || 0) - (x.pending ? 2e9 : x.start_time || 0));
    return { list: rows.slice(0, 60), source, checkedAt: source === 'saved' ? null : Date.now(), fresh: freshInfo };
  }

  // ---------- общий обзор за период ----------
  async dashboard(accountId, { cachedOnly = false } = {}) {
    const id = Number(accountId);
    const local = async () => { await this.store.ready; return this.savedHistory(id); };
    const stats = (rows, source) => ({ ...dashboardStats(rows), accountId: id, source });
    if (cachedOnly) return stats(await local(), 'saved');
    try {
      const rows = await this.api.matchHistory(id, 2 * 60e3, { signal: AbortSignal.timeout(8000) });
      if (!rows?.length) return stats(await local(), 'saved');
      const saved = this.store.loadInfo.files ? this.savedHistory(id) : [];
      return stats([...saved, ...rows], 'api');
    } catch (error) {
      const saved = await local();
      if (!saved.length) throw error;
      return stats(saved, 'saved');
    }
  }

  async overview(accountId, days = 7) {
    const id = Number(accountId);
    const d = Math.max(1, Math.min(30, Number(days) || 7));
    const signal = AbortSignal.timeout(8000);
    const hist = await this.myHistory(id, 2 * 60e3, signal);
    const since = nowSec() - d * DAY;
    const inPeriod = hist.filter((m) => (Number(m.start_time) || 0) >= since);
    // Скачиваем подробные данные своих матчей за период (уже скачанные — из памяти).
    const need = inPeriod.filter((m) => this.needsDownload(m.match_id)).slice(0, 80);
    let notFound = 0;
    let failed = 0;
    const mine = new Set(this.store.read('mine.json', []));
    for (let i = 0; i < need.length; i++) {
      const mid = Number(need[i].match_id);
      if (signal.aborted) { failed += need.length - i; break; }
      this.progress('overview', i, need.length, `Скачиваю твои матчи: ${i + 1} из ${need.length}`);
      try {
        const m = await this.fetchMine(mid, signal);
        m.pathsTried = true;
        await this.store.putMatch(m);
        mine.add(mid);
      } catch (e) {
        if (e instanceof NotFoundError) notFound += 1;
        else failed += 1;
      }
    }
    for (const m of inPeriod) if (this.store.getMatch(Number(m.match_id))) mine.add(Number(m.match_id));
    this.store.markPersonalMatches(mine);
    if (need.length) this.progress('done', 1, 1, 'Готово');
    const matches = new Map();
    for (const m of inPeriod) {
      const x = this.store.getMatch(Number(m.match_id));
      if (x) matches.set(x.match_id, x);
    }
    const top = this.store.read('top.json', { players: [] });
    const topAccounts = new Set(top.players.filter((p) => p.accountId && !p.excluded).map((p) => p.accountId));
    const topMatches = topAccounts.size ? this.store.allMatches().filter((m) => m.players.some((p) => topAccounts.has(p.account_id))) : [];
    const o = buildOverview({ history: hist, matches, accountId: id, days: d, topAccounts, topMatches, assets: this.assets });
    o.notFound = notFound;
    o.failed = failed;
    return o;
  }

  // ---------- сводка по герою ----------
  async myHeroes(accountId) {
    const hist = await this.myHistory(accountId, 2 * 60e3);
    const by = new Map();
    for (const m of hist) {
      const h = Number(m.hero_id);
      if (!by.has(h)) by.set(h, { hero_id: h, games: 0, wins: 0, last: 0 });
      const x = by.get(h);
      x.games += 1;
      if (typeof m.match_result === 'number' && m.match_result === m.player_team) x.wins += 1;
      x.last = Math.max(x.last, Number(m.start_time) || 0);
    }
    const tops = this.store.read('top.json', { players: [] });
    const topAcc = new Set(tops.players.filter((p) => p.accountId && !p.excluded).map((p) => p.accountId));
    const topGames = new Map();
    for (const m of this.store.allMatches()) for (const p of m.players) if (topAcc.has(p.account_id)) topGames.set(p.hero_id, (topGames.get(p.hero_id) || 0) + 1);
    return [...by.values()].map((x) => ({ ...x, topGames: topGames.get(x.hero_id) || 0 })).sort((a, b) => b.games - a.games || b.last - a.last);
  }

  async heroSummary(accountId, heroId, { limit = 20, cachedOnly = false, mode = null } = {}) {
    const id = Number(accountId);
    const hid = Number(heroId);
    const history = new Map(this.savedHistory(id, hid).filter((m) => isStandardMatch(m)).map((m) => [m.match_id, m]));
    let partial = cachedOnly;
    const signal = cachedOnly ? null : AbortSignal.timeout(8000);
    if (signal) {
      try {
        const recent = await this.myHistory(id, 2 * 60e3, signal);
        partial = recent.some((m) => m.source === 'saved-history');
        for (const m of recent) if (Number(m.hero_id) === hid) history.set(Number(m.match_id), m);
      } catch {
        partial = true;
      }
    }
    const rows = [...history.values()].filter((row) => (mode !== 1 && mode !== 4) || row.match_mode === mode)
      .sort((a, b) => (b.start_time || 0) - (a.start_time || 0)).slice(0, limit);
    if (signal) for (const row of rows) {
      if (!this.needsDownload(row.match_id)) continue;
      if (signal.aborted) { partial = true; break; }
      try {
        const m = await this.fetchMine(row.match_id, signal);
        m.pathsTried = true;
        await this.store.putMatch(m);
      } catch {
        partial = true;
      }
    }
    const mine = [];
    const games = rows.map((r) => {
      const m = this.store.getMatch(Number(r.match_id));
      const me = m ? m.players.find((p) => p.account_id === id) : null;
      if (me) mine.push(m.match_id);
      return {
        match_id: Number(r.match_id),
        start_time: Number(r.start_time) || 0,
        duration_s: r.match_duration_s,
        hero_id: hid,
        k: r.player_kills,
        d: r.player_deaths,
        a: r.player_assists,
        nw: r.net_worth,
        match_mode: r.match_mode,
        won: me ? me.won : typeof r.match_result === 'number' ? r.match_result === r.player_team : null,
        match: m || null,
        me: me || null,
      };
    });
    if (!cachedOnly && mine.length) this.store.markPersonalMatches(mine);
    const top = this.store.read('top.json', { players: [] });
    const accounts = new Set(top.players.filter((p) => p.accountId && !p.excluded).map((p) => p.accountId));
    const modes = new Set(mode === 1 || mode === 4 ? [mode] : games.map((g) => g.match_mode).filter((m) => m === 1 || m === 4));
    const pool = this.store.allMatches().filter((match) => isStandardMatch(match) && (!modes.size || modes.has(match.match_mode)));
    const bench = benchmarkPlayers({ matches: pool, heroId: hid, accounts, excludeAccount: id });
    const rep = heroReport({ heroId: hid, games, bench, assets: this.assets, accountId: id });
    rep.partial = partial || rep.loaded < rep.games;
    rep.benchModes = [...modes];
    rep.matchups = myMatchups(games.filter((g) => g.match && g.me).map((g) => ({ match: g.match, me: g.me })));
    const abilityName = (x) => (this.assets && this.assets.items[x] ? this.assets.items[x].name : `способность ${x}`);
    const mySkills = skillConsensus(games.filter((g) => g.me).map((g) => skillOrder(g.me, this.assets)), { minFollow: 2 });
    const topSkills = skillConsensus(bench.map((b) => skillOrder(b.player, this.assets)));
    rep.skills = { mine: mySkills, top: topSkills, compare: compareSkills(mySkills, topSkills, abilityName) };
    rep.list = games.map(({ match, me, ...g }) => ({ ...g, loaded: !!me }));
    return rep;
  }

  // ---------- билд игрока из конкретного матча (выгрузка) ----------
  async matchBuild(matchId, accountId, slot = null) {
    const m = this.store.getMatch(Number(matchId)) || await this.fetchMatch(Number(matchId), { signal: AbortSignal.timeout(8000) });
    const p = m.players.find((x) => (accountId && x.account_id === Number(accountId)) || (slot !== null && x.slot === Number(slot))) || null;
    if (!p) throw new Error('Этого игрока нет в матче');
    const b = matchBuild({ match: m, player: p, assets: this.assets });
    const top = this.store.read('top.json', { players: [] });
    const t = top.players.find((x) => x.accountId === p.account_id);
    const auth = this.store.read('auth.json', null);
    const localName = t?.name || (auth?.accountId === p.account_id ? auth.name : null);
    b.rank = t ? t.rank ?? null : null;
    // Профиль и опубликованные билды дополняют экспорт, оба запроса делят короткий лимит.
    const signal = AbortSignal.timeout(4000);
    const name = localName || (p.account_id ? this.api.steamProfiles([p.account_id], { signal }).then((profiles) => profiles[0]?.personaname).catch(() => null) : null);
    const similar = this.api.builds(p.hero_id, { signal }).then((raw) => {
      const core = b.buys.filter((x) => x.fate !== 'sold' && x.t <= 2400).map((x) => ({ id: x.id, pick: x.fate === 'kept' ? 1 : 0.6 }));
      return { similar: rankBuilds(raw, core, { limit: 3 }) };
    }).catch((e) => ({ similar: [], similarError: signal.aborted ? 'Сервис не ответил вовремя' : e.message }));
    const [playerName, suggestions] = await Promise.all([name, similar]);
    b.playerName = playerName || (p.account_id ? `ID ${p.account_id}` : 'игрок');
    Object.assign(b, suggestions);
    return b;
  }

  buildExportText(b) {
    const heroName = (x) => (this.assets && this.assets.heroes[x] ? this.assets.heroes[x].name : `Герой ${x}`);
    const itemName = (x) => (this.assets && this.assets.items[x] ? this.assets.items[x].name : `предмет ${x}`);
    const opts = { heroName, itemName, abilityName: itemName, playerName: b.playerName };
    const clock = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
    const game = encodeBuildCode({
      heroId: b.hero_id,
      name: `${heroName(b.hero_id)} — ${b.playerName}`,
      description: `Билд ${b.playerName} из матча ${b.match_id} (${b.won ? 'победа' : 'поражение'}, ${b.k}/${b.d}/${b.a}). Собрано в Deadlock Coach.`,
      categories: b.stages.map((st) => ({
        name: st.name,
        items: st.items.map((it) => ({ id: it.id, note: it.fate === 'sold' && it.soldT ? `продан на ${clock(it.soldT)}` : '' })),
      })),
      abilities: b.skills.steps.map((s) => ({ id: s.id, level: s.level })),
    });
    return { text: buildText(b, opts), file: buildFile(b, opts), gameCode: game.code, gameCodeTooBig: game.tooBig };
  }

  // Код билда для вставки в игру из готовых данных (сборка топов на странице героя).
  encodeGameBuild(build) {
    return encodeBuildCode(build);
  }

  // ---------- совет по пику (оверлей) ----------
  // Пул по доступной истории матчей или сохранённый ручной выбор.
  async pickPool(accountId) {
    const id = Number(accountId);
    let hist = [];
    try {
      hist = await this.myHistory(id, 5 * 60e3);
    } catch {}
    const settings = this.store.settings();
    const res = heroPool(hist, { manual: settings.pickPool });
    return { ...res, totalGames: hist.length };
  }

  // Таблицы матчапов для каждого героя из пула. Считаются заранее (это долго:
  // докачиваются твои игры на каждом герое), хранятся в picktables.json.
  async pickTables(accountId, { force = false, maxAgeH = 12 } = {}) {
    if (this._pickRunning) return this._pickRunning;
    const id = Number(accountId);
    const cached = this.store.read('picktables.json', null);
    this._pickRunning = (async () => {
      const usableCache = cached?.accountId === id && cached.v === 3 ? cached : null;
      const signal = AbortSignal.timeout(20000);
      const historySignal = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
      let history;
      try {
        history = await this.myHistory(id, 5 * 60e3, historySignal);
      } catch (error) {
        if (usableCache) return usableCache;
        throw error;
      }
      const { pool } = heroPool(history, { manual: this.store.settings().pickPool });
      const maxAge = usableCache?.partial ? Math.min(maxAgeH * 3600e3, 5 * 60e3) : maxAgeH * 3600e3;
      const fresh = usableCache && Date.now() - usableCache.at < maxAge;
      const missing = pool.filter((p) => !usableCache?.tables?.[p.hero_id]);
      if (!force && fresh && !missing.length) return usableCache;
      let partial = history.some((row) => row.source === 'saved-history');
      const tables = { ...usableCache?.tables };
      const todo = force || !fresh ? pool : missing;
      for (let i = 0; i < todo.length; i++) {
        const hid = todo[i].hero_id;
        const name = this.assets && this.assets.heroes[hid] ? this.assets.heroes[hid].name : String(hid);
        const label = `${name} (${i + 1} из ${todo.length})`;
        this.progress('pick', i, todo.length, `Готовлю советы по пикам: ${label}`);
        try {
          const o = await this.heroOutlook(id, hid, { history, signal, download: 15, quiet: true,
            onDownload: (done, total) => this.progress('pick', i, todo.length, `Загружаю матчи для ${label}: ${done} из ${total}`) });
          partial ||= o.partial;
          if (!o.partial || !tables[hid]) tables[hid] = { vs: o.vs, with: o.with, myGames: o.myGames, proGames: o.proGames };
        } catch (e) {
          partial = true;
          this.emit('log', `Советы по пикам (${name}): ${e.message}`);
        }
      }
      this.progress('done', 1, 1, partial ? 'Советы по пикам готовы по сохранённым матчам' : 'Советы по пикам готовы');
      const out = { v: 3, at: Date.now(), accountId: id, tables, partial };
      this.store.write('picktables.json', out);
      return out;
    })();
    try {
      return await this._pickRunning;
    } finally {
      this._pickRunning = null;
    }
  }

  // Мета для совета по пику: готовая статистика deadlock-api по всем матчам топового уровня
  // за 2 недели — сила героев, герой против героя (вообще и на одной линии), связки.
  // Пять быстрых запросов, кэш на 6 часов.
  async pickMeta({ force = false } = {}) {
    const cached = this.store.read('pickmeta.json', null);
    if (!force && cached && cached.v === 1 && Date.now() - cached.at < 6 * 3600e3) return cached;
    if (this._pmRunning) return this._pmRunning;
    this._pmRunning = (async () => {
      const since = Math.floor(Date.now() / 1000) - 14 * 86400;
      let badge = 91;
      let stats = await this.api.heroStatsAnalytics({ since, badge });
      // на высоком ранге мало игр — берём уровень пониже
      if (stats.reduce((s, r) => s + (Number(r.matches) || 0), 0) / 12 < 15000) {
        badge = 81;
        stats = await this.api.heroStatsAnalytics({ since, badge });
      }
      const [counters, laneCounters, synergy, laneSynergy] = await Promise.all([
        this.api.heroCounterAnalytics({ since, badge, lane: false }),
        this.api.heroCounterAnalytics({ since, badge, lane: true }),
        this.api.heroSynergyAnalytics({ since, badge, lane: false }),
        this.api.heroSynergyAnalytics({ since, badge, lane: true }),
      ]);
      // души на линии к 9-й минуте по парам (SQL, лимит 2 запроса в минуту — кэш на сутки)
      let laneSouls = [];
      const ls = this.store.read('lanesouls.json', null);
      if (ls && Date.now() - ls.at < 24 * 3600e3 && ls.rows && ls.rows.length) laneSouls = ls.rows;
      else {
        try {
          const rank = badge >= 91 ? 91 : 81;
          laneSouls = await this.api.sqlRows(
            `WITH p AS (SELECT match_id, team, assigned_lane lane, hero_id, "stats.net_worth"[3]::BIGINT nw FROM match_player WHERE start_time > now() - INTERVAL 14 DAY AND match_mode='Ranked' AND game_mode='Normal' AND player_rank_initial_display_rank >= ${rank} AND len("stats.net_worth") >= 4) ` +
              `SELECT a.hero_id h, b.hero_id e, count(*) n, round(avg(a.nw - b.nw)) d FROM p a JOIN p b ON a.match_id=b.match_id AND a.lane=b.lane AND a.team<>b.team GROUP BY 1,2 HAVING count(*) >= 30`,
            ['h', 'e', 'n', 'd'],
          );
          laneSouls = laneSouls.map((r) => ({ h: Number(r.h), e: Number(r.e), n: Number(r.n), d: Number(r.d) })).filter((r) => r.h && r.e);
          if (laneSouls.length) this.store.write('lanesouls.json', { at: Date.now(), rows: laneSouls });
        } catch (e) {
          this.emit('log', `lanesouls: ${e.message}`);
          if (ls && ls.rows) laneSouls = ls.rows;
        }
      }
      const pm = { ...buildPickMeta({ stats, counters, laneCounters, synergy, laneSynergy, laneSouls, badge, since }), at: Date.now() };
      if (!Object.keys(pm.base).length) throw new Error('deadlock-api не отдал статистику героев');
      this.store.write('pickmeta.json', pm);
      return pm;
    })();
    try {
      return await this._pmRunning;
    } finally {
      this._pmRunning = null;
    }
  }

  heroRoles() {
    const out = {};
    for (const [id, h] of Object.entries((this.assets && this.assets.heroes) || {})) out[id] = heroRole(h);
    return out;
  }

  async pickAdvise(accountId, { enemies = [], allies = [], current = null, laneEnemies = [], partner = null } = {}) {
    const id = Number(accountId);
    const { pool, all, inactive, manual } = await this.pickPool(id);
    const cached = this.store.read('picktables.json', null);
    const tables = cached && cached.accountId === id ? cached.tables || {} : {};
    const meta = {};
    const m = this.store.read('meta.json', null);
    for (const r of (m && m.heroes) || []) meta[r.hero_id] = { winrate: r.winrate, games: r.games };
    let pm = this.store.read('pickmeta.json', null);
    let pmError = null;
    if (!pm || pm.v !== 1 || Date.now() - pm.at > 6 * 3600e3) {
      // нет меты — ждём (это несколько секунд); устарела — обновляем в фоне
      const job = this.pickMeta().catch((e) => {
        pmError = e.message;
        this.emit('log', `pickmeta: ${e.message}`);
        return null;
      });
      if (!pm || pm.v !== 1) pm = await Promise.race([job, new Promise((r) => setTimeout(() => r(null), 20000))]);
    }
    if (!this.assets) await this.loadAssets().catch(() => {});
    const roles = this.heroRoles();
    const opts = { enemies: enemies.map(Number), allies: allies.map(Number), laneEnemies: laneEnemies.map(Number), partner, roles, meta, pm };
    const advice = pickAdvice({ pool, tables, current, ...opts });
    const ready = pool.filter((p) => tables[p.hero_id]).length;
    // план на игру: для текущего героя, а если он не отмечен — для лучшего пика
    let plan = null;
    if (enemies.length) {
      const hid = current ? Number(current) : advice.rows[0] && advice.rows[0].hero_id;
      let row = advice.all.find((r) => r.hero_id === hid) || null;
      // текущий герой не из твоих — считаем для него отдельно (мета есть для всех героев)
      if (!row && hid) {
        try {
          const one = pickAdvice({ pool: [{ hero_id: hid, games: 0, wins: 0, recent: 0, recentWins: 0, lastDays: null }], tables: {}, ...opts });
          row = one.all[0] || null;
        } catch (e) {
          this.emit('log', `plan: ${e.message}`);
        }
      }
      let counters = {};
      try {
        counters = this.counterTable();
      } catch {}
      plan = gamePlan({ row, counters, leak: this.store.read(`leaks-top-${id}.json`, null), laneEnemies: advice.laneEnemies });
      if (plan && row) plan.chance = row.chance;
    }
    for (const r of advice.all) delete r.parts;
    return {
      ...advice,
      plan,
      roles: Object.fromEntries([...enemies, ...allies, ...pool.map((p) => p.hero_id)].map((h) => [h, roles[h] || null])),
      pool: pool.map((p) => p.hero_id),
      inactive: inactive.map((p) => ({ hero_id: p.hero_id, lastDays: p.lastDays })),
      allHeroes: [...new Map([...all, ...pool].map((p) => [p.hero_id, p])).values()].map((p) => ({
        hero_id: p.hero_id, games: p.games, wins: p.wins, unlockPoints: p.unlockPoints, rankedEvidence: p.rankedEvidence,
      })),
      rankedThreshold: RANKED_HERO_RULE.threshold,
      manual,
      ready,
      poolSize: pool.length,
      tablesAt: cached ? cached.at : null,
      preparing: !!this._pickRunning,
      metaInfo: pm ? { at: pm.at, badge: pm.badge, games: pm.games } : null,
      metaError: pm ? null : pmError || 'мета ещё загружается',
    };
  }

  // ---------- справочник контрпиков и контрпредметов ----------
  // Один запрос на врага, ответ кэшируется: смена героя не запускает новых
  // обращений к сети (мета и таблица покупок уже в кэше, пул — на 10 минут).
  async codexLookup(accountId, enemyId, { force = false } = {}) {
    const X = Number(enemyId);
    if (!X) throw new Error('Не выбран герой соперника');
    const table = this.counterTable(); // с внутренним кэшем по числу матчей
    let pm = this.store.read('pickmeta.json', null);
    const pmKey = (m) => (m && m.at) || 0;
    const tKey = Object.keys(table).length;
    const cache = this._codexCache;
    if (!force && cache && cache.X === X && cache.pmKey === pmKey(pm) && cache.tKey === tKey) return cache.res;

    let pmError = null;
    let stale = false;
    if (!pm || pm.v !== 1 || Date.now() - pm.at > 6 * 3600e3) {
      // нет меты — ждём (несколько секунд); устарела — обновляем, но сохранённую
      // отдаём даже при сбое сети (с датой и пометкой)
      const job = this.pickMeta().then((m) => ({ m }), (e) => ({ e }));
      if (!pm || pm.v !== 1) {
        const r = await Promise.race([job, new Promise((res) => setTimeout(() => res({}), 20000))]);
        if (r.m) pm = r.m;
        if (r.e) pmError = r.e.message;
      } else {
        stale = true;
        const r = await Promise.race([job, new Promise((res) => setTimeout(() => res({}), 8000))]);
        if (r.m) {
          pm = r.m;
          stale = false;
        } else if (r.e) pmError = r.e.message;
        else job.then(({ m }) => { if (m) this._codexCache = null; }); // обновится позже — сбросим кэш
      }
    }
    if (!this.assets) await this.loadAssets().catch(() => {});

    // пул твоих героев для тумблера «Из моего пула» — кэш 10 минут, сеть дёргаем редко
    let pool = [];
    if (accountId) {
      const pc = this._codexPool;
      if (!pc || Date.now() - pc.at > 10 * 60e3) {
        this._codexPool = { at: Date.now(), job: this.pickPool(accountId).then((r) => r.pool).catch(() => []) };
      }
      pool = await this._codexPool.job;
    }
    const [prof, lift] = await Promise.all([this.heroBuildProfile(X, pm), this.heroLift(X)]);
    const res = counterCodex(X, { pm, table, assets: this.assets, pool, stale: stale && !!pm, profile: prof.profile, lift });
    if (pmError) res.meta.error = pmError;
    if (prof.error) res.meta.profileError = prof.error;
    if (prof.at) res.meta.profileAt = prof.at;
    this._codexCache = { X, pmKey: pmKey(pm), tKey, res };
    return res;
  }

  // Lift контрпредметов против героя X (порог игр, интервал и пояснения — src/core/lift.js).
  // Запросов немного: базовая линия (винрейты предметов во всех играх окна) — один на всех героев,
  // кэш 12 часов; на героя — один запрос, кэш 6 часов в файле. При сбое сети берём сохранённое с датой.
  // Окно 14 дней, ранг Оракул 1+, рейтинг: именно на этом окне проверена устойчивость порогов.
  async heroLift(X) {
    const DAY = 86400;
    const HOUR6 = 6 * 3600;
    const since = Math.floor(Date.now() / 1000 / HOUR6) * HOUR6 - 14 * DAY; // ступенька в 6 часов — стабильный ключ кэша
    const badge = 81;
    const lim = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('таймаут 10 с')), 10000))]);
    const slim = (rows) => (Array.isArray(rows) ? rows : []).filter((r) => r.item_id && r.matches > 0 && (r.bucket === 0 || r.bucket === undefined)).map((r) => ({ item_id: r.item_id, wins: r.wins, matches: r.matches, bucket: 0 }));
    const load = async (key, ttl, fetcher) => {
      const cached = this.store.read(key, null);
      const fresh = cached && Array.isArray(cached.rows) && cached.badge === badge && Date.now() - cached.at < ttl;
      if (fresh) return { rows: cached.rows, at: cached.at, since: cached.since, error: null, stale: false };
      try {
        if (typeof this.api.itemStatsAnalytics !== 'function') throw new Error('метод недоступен');
        const rows = slim(await lim(fetcher()));
        if (!rows.length) throw new Error('API не вернул данных');
        const out = { at: Date.now(), since, badge, rows };
        this.store.write(key, out);
        return { rows, at: out.at, since, error: null, stale: false };
      } catch (e) {
        if (cached && Array.isArray(cached.rows)) return { rows: cached.rows, at: cached.at, since: cached.since, error: e.message, stale: true };
        return { rows: null, at: null, since, error: e.message, stale: false };
      }
    };
    this._liftBase = this._liftBase || {};
    const baseJob = this._liftBase.job && Date.now() - this._liftBase.t < 60e3 ? this._liftBase.job : (this._liftBase = { t: Date.now(), job: load('codexlift-base.json', 12 * 3600e3, () => this.api.itemStatsAnalytics({ since, badge })) }).job;
    const [base, enemy] = await Promise.all([baseJob, load(`codexlift-${X}.json`, 6 * 3600e3, () => this.api.itemStatsAnalytics({ enemyId: X, since, badge }))]);
    const meta = {
      since: enemy.since || base.since || since, days: 14, badge, rank: 'Оракул 1+', mode: 'рейтинговые',
      at: enemy.at && base.at ? Math.min(enemy.at, base.at) : enemy.at || base.at,
      error: enemy.error || base.error || null, stale: !!(enemy.stale || base.stale),
    };
    if (!enemy.rows || !base.rows) return { result: null, meta };
    return { result: computeLift(enemy.rows, base.rows), meta };
  }

  // Профиль покупок героя для справочника контрпиков: что на нём обычно собирают.
  // Тот же ранг и окно, что у меты (pm), чтобы число матчей совпадало с hero-stats.
  // Кэш на 6 часов в файле; при сбое сети берём сохранённое, иначе профиля нет (рекомендации
  // тогда строятся только по способностям героя и помечаются как «без профиля покупок»).
  async heroBuildProfile(X, pm) {
    if (!pm || !pm.base || !pm.base[X]) return { profile: null };
    const key = `codexbuild-${X}.json`;
    const cached = this.store.read(key, null);
    const fresh = cached && cached.badge === pm.badge && Array.isArray(cached.rows) && Date.now() - cached.at < 6 * 3600e3;
    let rows = fresh ? cached.rows : null;
    let at = fresh ? cached.at : null;
    let games = fresh ? cached.games : null;
    let since = fresh ? cached.since : null;
    let error = null;
    if (!rows) {
      try {
        if (typeof this.api.itemStatsAnalytics !== 'function') throw new Error('метод недоступен');
        const lim = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('таймаут 8 с')), 8000))]);
        // окно: игры после последнего патча (баланс изменился), если их у героя не меньше 1 000; иначе окно меты
        since = pm.since;
        games = pm.base[X][1];
        if (RULES.patchSince > pm.since) {
          try {
            const hs = await lim(this.api.heroStatsAnalytics({ since: RULES.patchSince, badge: pm.badge }));
            const row = (hs || []).find((r) => Number(r.hero_id) === X);
            if (row && Number(row.matches) >= 1000) { since = RULES.patchSince; games = Number(row.matches); }
          } catch {
            // не вышло — остаёмся на окне меты
          }
        }
        const got = await lim(this.api.itemStatsAnalytics({ heroId: X, since, badge: pm.badge }));
        rows = got.map((r) => ({ item_id: r.item_id, matches: r.matches, bucket: r.bucket })).filter((r) => r.item_id);
        at = Date.now();
        this.store.write(key, { at, badge: pm.badge, since, games, rows });
      } catch (e) {
        error = e.message;
        if (cached && Array.isArray(cached.rows)) { rows = cached.rows; at = cached.at; games = cached.games; since = cached.since; }
      }
    }
    const profile = rows ? buildHeroProfile(rows, { codex: codexData, games: games || pm.base[X][1] }) : null;
    if (profile) profile.since = since || pm.since;
    return { profile, error, at };
  }

  // ---------- общие помощники для тренера и матчапов ----------
  topAccounts() {
    const top = this.store.read('top.json', { players: [] });
    return new Set(top.players.filter((p) => p.accountId && !p.excluded).map((p) => p.accountId));
  }

  // Удалить все скачанные матчи топов (свои матчи остаются) и всё, что по ним посчитано.
  async resetTopMatches() {
    if (this.running) throw new Error('Сейчас идёт обновление меты — дождись конца и попробуй ещё раз');
    const removed = await this.store.removeMatches(() => true);
    for (const f of ['missing.json', 'picktables.json']) this.store.write(f, f === 'missing.json' ? {} : null);
    this._topHero = null;
    this._counters = null;
    this._planTables = null;
    const meta = this.computeMeta(this.store.settings());
    return { removed, kept: this.store.matches.size, meta };
  }

  topRecords(heroId = null, excludeAccount = null) {
    const acc = this.topAccounts();
    const out = [];
    for (const m of this.store.allMatches()) {
      for (const p of m.players) {
        if (!acc.has(p.account_id) || p.abandoned || !p.stats || p.stats.length < 3) continue;
        if (heroId !== null && p.hero_id !== heroId) continue;
        if (excludeAccount && p.account_id === excludeAccount) continue;
        out.push({ match: m, player: p });
      }
    }
    return out;
  }

  // Что топы чаще берут против каждого героя (все игроки в матчах топового уровня).
  // Считается раз на набор матчей — кэш до следующего обновления меты.
  counterTable() {
    const all = this.store.allMatches();
    const key = `${all.length}:${this.assets ? Object.keys(this.assets.items || {}).length : 0}`;
    if (this._counters && this._counters.key === key) return this._counters.table;
    const mine = new Set(this.store.read('mine.json', []));
    const records = [];
    for (const m of all) {
      if (mine.has(m.match_id) || !isStandardMatch(m)) continue;
      for (const p of m.players) if (!p.abandoned && p.items && p.items.length) records.push({ match: m, player: p });
    }
    const cost = (id) => (this.assets && this.assets.items && this.assets.items[id] && this.assets.items[id].cost) || 0;
    const table = counterItems(records, { isItem: (id) => isUpgrade(this.assets, id) && cost(id) >= 1250 });
    this._counters = { key, table };
    return table;
  }

  // Разбор ошибок: каждая из последних игр + общая картина «что мешает расти».
  async leaks(accountId, { limit = 30 } = {}) {
    const id = Number(accountId);
    const list = await this.myLoadedGames(id, { limit, download: limit, label: 'Скачиваю твои матчи для разбора ошибок' });
    const topHero = await this.topFeaturesByHero();
    const counters = this.counterTable();
    const picks = this.store.read('picktables.json', null);
    const heroName = (hid) => (this.assets && this.assets.heroes[hid] ? this.assets.heroes[hid].name : `Герой ${hid}`);
    const itemName = (iid) => (this.assets && this.assets.items[iid] ? this.assets.items[iid].name : `Предмет ${iid}`);
    const badges = [];
    for (const x of list) {
      // значок команды из матча (в свежих рейтинговых он 0), иначе собственный значок игрока из истории
      const b = x.match && x.me ? gameBadge(x.match, x.me, x.row && x.row.ranked_display_badge) : null;
      if (b) badges.push(b);
    }
    // свой ранг — из последней рейтинговой игры (ranked_display_badge), иначе средний по матчам
    const own = list.map((x) => x.row && Number(x.row.ranked_display_badge)).filter((b) => b > 0).pop();
    const rank = own ? { badge: own, tier: Math.floor(own / 10), sub: own % 10, n: 1, own: true } : rankFromBadges(badges);
    const tier = rank ? rank.tier : null;
    const games = [];
    for (const x of list) {
      if (!x.match || !x.me) continue;
      const m = x.match;
      const me = x.me;
      const f = playerFeatures(me, m, this.assets);
      const table = picks && picks.tables && picks.tables[me.hero_id];
      const laneVs = table && table.vs ? Object.fromEntries(Object.entries(table.vs).map(([k, v]) => [k, typeof v.pro === 'number' ? v.pro : v.delta])) : null;
      const fresh = (m.v || 1) >= EXTRACT_V;
      const checked = new Set();
      const leaks = gameLeaks({ m, me, f, ref: topHero.get(me.hero_id) || null, tier, assets: this.assets, counters, laneVs, heroName, itemName, checked });
      const role = gameRole(m, me, f);
      games.push({ match_id: m.match_id, start_time: m.start_time, duration_s: m.duration_s, hero: me.hero_id, won: me.won, k: me.k, d: me.d, a: me.a, fresh, leaks, checked: [...checked], f, role: role.role, roleFeat: role.feat });
    }
    const profile = leakProfile(games.filter((g) => g.fresh));
    // Привычки до 10:00: твои медианы, твой ранг, высокий ранг и как это связано с победой
    const med = (k) => {
      const v = games.filter((g) => g.fresh).map((g) => g.f[k]).filter((x) => x !== null && x !== undefined && Number.isFinite(x)).sort((a, b) => a - b);
      return v.length >= 3 ? v[Math.floor(v.length / 2)] : null;
    };
    const tierB = tier ? RANK_BENCH[Math.max(1, Math.min(10, tier))] : null;
    const habits = ['d10', 'neu9', 'brk9', 'pu10', 'brk20', 'pu20'].map((k) => {
      const key = k === 'd10' ? 'd9' : k;
      const mine = med(k);
      return {
        key: k,
        mine,
        rank: tierB ? tierB[k] ?? null : null,
        top: RANK_BENCH[10][k] ?? null,
        link: WIN_LINKS[key] ? { mine: winLink(key, mine), best: WIN_LINKS[key][key === 'd9' ? 0 : WIN_LINKS[key].length - 1] } : null,
      };
    });
    // главная повторяющаяся ошибка — в план на игру в оверлее
    const topLeak = profile.rows.find((r) => r.status !== 'observation') || null;
    this.store.write(`leaks-top-${id}.json`, topLeak ? { title: topLeak.title, fix: (topLeak.fix || [])[0] || null, count: topLeak.count, games: profile.games, at: Date.now() } : null);
    return {
      rank,
      // рабочая роль на каждом герое — определена автоматически по данным матчей (признаки и доверие внутри)
      roles: heroRoles(games.filter((g) => g.role).map((g) => ({ hero: g.hero, role: g.role, feat: g.roleFeat }))),
      games: games.map(({ f, roleFeat, ...g }) => ({ ...g, leaks: g.leaks.map((l) => ({ key: l.key, area: l.area, level: l.level, status: l.status, title: l.title, text: l.text, context: l.context, basis: l.basis, missing: l.missing, fix: l.fix, moments: l.moments, score: l.score })) })),
      fresh: games.filter((g) => g.fresh).length,
      total: games.length,
      profile,
      habits,
      countersReady: Object.keys(counters).length > 0,
      topsReady: topHero.size > 0,
    };
  }

  async topFeaturesByHero() {
    // кэш до изменения набора матчей (считать заново — секунды на тысячах игр)
    const all = this.store.allMatches();
    const key = `${all.length}:${all.reduce((s, m) => s + (m.v || 1), 0)}:${this.topAccounts().size}`;
    if (this._topHero && this._topHero.key === key) return this._topHero.map;
    const map = await this.computeTopFeatures();
    this._topHero = { key, map };
    return map;
  }

  async computeTopFeatures() {
    const by = new Map();
    let processed = 0;
    for (const r of this.topRecords()) {
      if (!by.has(r.player.hero_id)) by.set(r.player.hero_id, []);
      by.get(r.player.hero_id).push(playerFeatures(r.player, r.match, this.assets));
      if (++processed % 250 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
    return new Map([...by.entries()].map(([h, list]) => [h, refAll(list)]));
  }

  // Твои последние матчи с подробностями (докачивает недостающие).
  async myLoadedGames(accountId, { limit = 30, download = 25, label = 'Скачиваю твои матчи' } = {}) {
    const id = Number(accountId);
    const signal = AbortSignal.timeout(8000);
    const hist = await this.myHistory(id, 60e3, signal);
    const rows = hist.slice().sort((a, b) => (Number(b.start_time) || 0) - (Number(a.start_time) || 0)).slice(0, limit);
    const need = rows.filter((m) => this.needsDownload(m.match_id)).slice(0, download);
    for (let i = 0; i < need.length; i++) {
      if (signal.aborted) break;
      this.progress('coach', i, need.length, `${label}: ${i + 1} из ${need.length}`);
      try {
        const m = await this.fetchMine(need[i].match_id, signal);
        m.pathsTried = true;
        await this.store.putMatch(m);
      } catch (e) {
        // матча нет в API — пропустим
      }
    }
    if (need.length) this.progress('done', 1, 1, 'Готово');
    const mine = new Set(this.store.read('mine.json', []));
    const out = rows
      .map((r) => {
        const m = this.store.getMatch(Number(r.match_id));
        const me = m ? m.players.find((p) => p.account_id === id) : null;
        if (m) mine.add(m.match_id);
        return { row: r, match: m || null, me: me || null };
      })
      .reverse();
    this.store.markPersonalMatches(mine);
    return out;
  }

  // Игры по возрастанию времени с признаками сессии и паузы после поражения.
  _gamesFrom(list) {
    let prevEnd = null;
    let prevWon = null;
    let pos = 0;
    return list.map(({ row, match, me }) => {
      const start = Number(row.start_time) || 0;
      const dur = Number(row.match_duration_s) || 0;
      const gapMin = prevEnd === null ? null : (start - prevEnd) / 60;
      pos = gapMin === null || gapMin > 60 ? 1 : pos + 1;
      const won = me ? me.won : typeof row.match_result === 'number' ? row.match_result === row.player_team : null;
      const g = {
        match_id: Number(row.match_id),
        start_time: start,
        duration_s: dur,
        hero: Number(row.hero_id),
        won,
        k: row.player_kills,
        d: row.player_deaths,
        a: row.player_assists,
        nw: row.net_worth,
        rankBadge: Number(row.ranked_display_badge) || null,
        pos,
        afterLoss: prevWon === false && gapMin !== null && gapMin <= 60,
        gapMin,
        match,
        me,
        f: match && me ? playerFeatures(me, match, this.assets) : null,
      };
      prevEnd = start + dur;
      prevWon = won;
      return g;
    });
  }

  // ---------- личный тренер ----------
  async coach(accountId, { forceNew = false, evidence = null, replaceKey = null } = {}) {
    const id = Number(accountId);
    const list = await this.myLoadedGames(id, { limit: 40, download: 25, label: 'Тренер смотрит твои матчи' });
    const heroName = (h) => (this.assets && this.assets.heroes[h] ? this.assets.heroes[h].name : `герой ${h}`);
    const itemName = (i) => (this.assets && this.assets.items[i] ? this.assets.items[i].name : `предмет ${i}`);
    const games = this._gamesFrom(list);
    const lobbyF = [];
    for (const g of games) if (g.match && g.me) for (const p of g.match.players) if (p !== g.me && !p.abandoned) lobbyF.push(playerFeatures(p, g.match, this.assets));
    const lobby = refAll(lobbyF);
    const topHero = await this.topFeaturesByHero();
    // признаки усталости и тильта
    const decided = games.filter((g) => g.won !== null);
    const wrOf = (l) => (l.length ? l.filter((g) => g.won).length / l.length : null);
    const early = decided.filter((g) => g.pos <= 2);
    const late = decided.filter((g) => g.pos >= 3);
    const afterL = decided.filter((g) => g.afterLoss);
    const extra = {
      fatigue: early.length >= 5 && late.length >= 4 && wrOf(late) < wrOf(early) - 0.12,
      tilt: afterL.length >= 4 && wrOf(afterL) < wrOf(decided) - 0.12,
    };
    const tipsCache = new Map();
    const counters = this.counterTable();
    const tierOf = (g) => tierOfBadge(gameBadge(g.match, g.me, g.rankBadge));
    // Ошибки игры: считаем один раз на матч (и для карточек, и для «почему эта цель»).
    const leakCache = new Map();
    const leaksOf = (g) => {
      if (leakCache.has(g.match_id)) return leakCache.get(g.match_id);
      const checked = new Set();
      let leaks = [];
      try {
        leaks = gameLeaks({ m: g.match, me: g.me, f: g.f, ref: topHero.get(g.hero) || null, tier: tierOf(g), assets: this.assets, counters, heroName, itemName, checked });
      } catch {}
      const res = { leaks, checked: [...checked] };
      leakCache.set(g.match_id, res);
      return res;
    };
    const tipsFor = (g) => {
      if (!g.f || !g.match) return [];
      if (tipsCache.has(g.match_id)) return tipsCache.get(g.match_id);
      const ref = topHero.get(g.hero) || lobby;
      const lob = refAll(g.match.players.filter((p) => p !== g.me && !p.abandoned).map((p) => playerFeatures(p, g.match, this.assets)));
      const tips = matchTips({ me: g.f, ref, lobby: lob, heroName, itemName, won: g.me.won });
      // ошибки с моментами (лес во время драк, размены, тайминги карты) — в общий список
      const lk = leaksOf(g).leaks.map((l) => ({ title: l.title, text: l.text, tip: l.fix && l.fix[0], area: l.area, level: l.level, score: l.score }));
      const t = tips.concat(lk).sort((a, b) => b.score - a.score);
      tipsCache.set(g.match_id, t);
      return t;
    };
    const state = this.store.read(`coach-${id}.json`, null);
    let focusEvidence = null;
    if (evidence) {
      const m = this.store.getMatch(Number(evidence.matchId));
      const me = m?.players.find((p) => p.account_id === id);
      if (evidence.key === 'lost_souls') {
        const event = me && lossPerDeath(me).find((x) => x.t === evidence.t && x.lost >= SOUL_LOSS_THRESHOLD);
        if (!event) throw new Error('Эту потерю душ не удалось подтвердить в сохранённом матче.');
        focusEvidence = { key: 'lost_souls', matchId: m.match_id, t: event.t, title: 'Крупная потеря душ', text: `При смерти потеряно ${event.lost} душ` };
      } else if (evidence.key === 'solo_deaths') {
        const row = me && (soloDeathRows(m, me) || []).find((r) => r.t === evidence.t);
        if (!row) throw new Error('Эту смерть в одиночку не удалось подтвердить в сохранённом матче.');
        const killer = m.players.find((p) => p.slot === row.killerSlot);
        focusEvidence = { key: 'solo_deaths', matchId: m.match_id, t: row.t, x: row.x, y: row.y, title: 'Смерть в одиночку',
          text: killer ? `Смерть вдали от команды — убил ${heroName(killer.hero_id)}` : 'Смерть вдали от команды',
          context: 'В момент смерти ни один живой союзник не был ближе 2 500 единиц карты (≈8 с бега по прямой), и никто из союзников не погиб рядом за 10 с до этого. Это расчёт по маршрутам: был ли заход осознанным, из данных не видно.' };
      } else if (evidence.key === 'survivability_purchase') {
        const g = me && { match: m, me, f: playerFeatures(me, m, this.assets), hero: me.hero_id };
        let leak = null;
        try {
          leak = g && gameLeaks({ m, me, f: g.f, ref: topHero.get(me.hero_id) || null, tier: tierOf(g), assets: this.assets, counters, heroName, itemName }).find((l) => l.key === 'survivability_purchase');
        } catch {}
        const moment = leak && (leak.moments || []).find((x) => x.t === evidence.t);
        if (!moment) throw new Error('Эту серию смертей не удалось подтвердить в сохранённом матче.');
        focusEvidence = { key: 'survivability_purchase', matchId: m.match_id, t: moment.t, x: moment.x, y: moment.y, title: 'Серия смертей без живучести',
          text: `Серия из ${leak.moments.length} смертей с ${clockT((leak.moments[0] || moment).t)} без покупки живучести`, context: leak.context };
      } else {
        const foe = me && m.players.find((p) => p.slot === me.deaths?.find((d) => d[0] === evidence.t)?.[3]);
        if (!foe || foe.team === me.team || me.lane == null || foe.lane !== me.lane || !(evidence.t >= 0 && evidence.t <= 600)) {
          throw new Error('Этот эпизод на линии не удалось подтвердить в сохранённом матче.');
        }
        focusEvidence = { matchId: m.match_id, t: evidence.t, title: 'Смерть на линии', text: `Смерть от ${heroName(foe.hero_id)}` };
      }
    }
    // Признак «после серии смертей куплена живучесть»: 1 — замечания нет, 0 — есть, null — игру проверить нельзя.
    for (const g of games) {
      if (!g.f || !g.match || !g.me || (g.match.v || 1) < EXTRACT_V) continue;
      const r = leaksOf(g);
      g.f = { ...g.f, survivability_purchase: r.leaks.some((l) => l.key === 'survivability_purchase') ? 0 : r.checked.includes('survivability_purchase') ? 1 : null };
    }
    // Как часто повторяется замечание и как связано с победами — основание цели «Почему именно это».
    let leakStats = {};
    try {
      const prof = leakProfile(games.filter((g) => g.f && g.match && g.me && (g.match.v || 1) >= EXTRACT_V).slice(-30).map((g) => {
        const r = leaksOf(g);
        return { match_id: g.match_id, start_time: g.start_time, won: g.won, hero: g.hero, leaks: r.leaks, checked: r.checked };
      }));
      leakStats = Object.fromEntries(prof.rows.map((r) => [r.key, { title: r.title, count: r.count, eligible: r.eligible, wrWith: r.wrWith, wrWithout: r.wrWithout }]));
    } catch {}
    const { state: next, view } = updateCoach(state, {
      games,
      topHero,
      lobby,
      extra,
      leakStats,
      mainMistake: (g) => {
        const t = tipsFor(g).find((x) => x.level === 'bad' || x.level === 'warn');
        return t ? { title: t.title, text: t.text, tip: t.tip, area: t.area } : null;
      },
      mainGood: (g) => {
        const t = tipsFor(g).find((x) => x.level === 'good');
        return t ? { title: t.title } : null;
      },
    }, { forceNew, focusEvidence, replaceKey: typeof replaceKey === 'string' ? replaceKey : null });
    this.store.write(`coach-${id}.json`, next);
    view.topsReady = topHero.size > 0;
    view.loaded = games.filter((g) => g.f).length;
    return view;
  }

  // ---------- динамика показателей и достижения ----------
  // Только сохранённые матчи (без скачивания): динамика, сравнение с топами на твоих героях, достижения.
  async playerProgress(accountId, { markSeen = false } = {}) {
    const id = Number(accountId);
    const list = await this.myLoadedGames(id, { limit: 300, download: 0, label: '' });
    const heroName = (h) => (this.assets && this.assets.heroes[h] ? this.assets.heroes[h].name : `герой ${h}`);
    const itemName = (i) => (this.assets && this.assets.items[i] ? this.assets.items[i].name : `предмет ${i}`);
    const games = this._gamesFrom(list);
    const loaded = games.filter((g) => g.f);
    const topHero = await this.topFeaturesByHero();
    const counters = this.counterTable();
    // замечания «Ошибок» на игру — для последних 30 свежих игр
    const tierOf = (g) => (g.match && Array.isArray(g.match.badge) && g.me && typeof g.match.badge[g.me.team] === 'number' ? Math.floor(g.match.badge[g.me.team] / 10) : null);
    const errors = [];
    for (const g of loaded.filter((x) => (x.match.v || 1) >= EXTRACT_V).slice(-30)) {
      try {
        const leaks = gameLeaks({ m: g.match, me: g.me, f: g.f, ref: topHero.get(g.hero) || null, tier: tierOf(g), assets: this.assets, counters, heroName, itemName });
        errors.push({ match_id: g.match_id, n: leaks.filter((l) => l.level !== 'good').length });
      } catch {}
    }
    const prog = progressView({ games: loaded, topHero, errors });
    // выполненные цели тренера (без дублей)
    const coachState = this.store.read(`coach-${id}.json`, null) || {};
    const seenDone = new Set();
    const finished = [];
    for (const g of [...((coachState.plan && coachState.plan.goals) || []), ...(coachState.archive || [])]) {
      if (g.status !== 'done') continue;
      const k = `${g.key}|${g.title}`;
      if (seenDone.has(k)) continue;
      seenDone.add(k);
      finished.push({ title: g.title, doneAt: g.doneAt || g.endedAt || null });
    }
    const stored = this.store.read(`achievements-${id}.json`, null) || {};
    const ach = achievementsView({ games: loaded, finished, progress: prog, prevUnlocked: stored.unlocked || {}, seen: stored.seen || null });
    const next = { unlocked: ach.unlocked, seen: markSeen ? ach.unlocked : stored.seen || stored.unlocked || ach.unlocked };
    if (JSON.stringify(next) !== JSON.stringify(stored)) this.store.write(`achievements-${id}.json`, next);
    return { progress: prog, achievements: ach.items, records: ach.records, anyNew: ach.anyNew, games: loaded.length };
  }

  // ---------- матчапы ----------
  async matchups(accountId) {
    const list = await this.myLoadedGames(accountId, { limit: 60, download: 20, label: 'Собираю твои матчапы' });
    const games = list.filter((x) => x.match && x.me).map((x) => ({ match: x.match, me: x.me }));
    const mine = myMatchups(games);
    const heroes = new Map();
    for (const g of games) heroes.set(g.me.hero_id, (heroes.get(g.me.hero_id) || 0) + 1);
    // Матчапы отдельно по каждому твоему герою: на разных героях неудобны разные соперники.
    const byHero = {};
    for (const [heroId, n] of heroes) {
      if (n < 3) continue;
      byHero[heroId] = myMatchups(games.filter((g) => g.me.hero_id === heroId), { minGames: 2 });
    }
    return { mine, byHero, myHeroes: [...heroes.entries()].sort((a, b) => b[1] - a[1]).map(([hero_id, n]) => ({ hero_id, games: n })) };
  }

  // Прогноз для героя в «Перед игрой»: твои игры на нём + игры топового уровня.
  async heroOutlook(accountId, heroId, { download = 20, quiet = false, history, signal = AbortSignal.timeout(8000), onDownload } = {}) {
    const hid = Number(heroId);
    const id = accountId ? Number(accountId) : null;
    const mineIds = new Set(this.store.read('mine.json', []));
    const tops = this.topAccounts();
    // Игры топового уровня: сами топы (вес 1) и остальные игроки в их матчах (вес 0,5).
    const pro = [];
    let topsN = 0;
    for (const m of this.store.allMatches()) {
      if (mineIds.has(m.match_id)) continue;
      for (const p of m.players) {
        if (p.hero_id !== hid || p.abandoned || p.account_id === id) continue;
        const isTop = tops.has(p.account_id);
        if (isTop) topsN += 1;
        pro.push({ match: m, player: p, w: isTop ? 1 : 0.5 });
      }
    }
    let mine = [];
    let partial = false;
    if (id) {
      let hist = history;
      if (!hist) {
        try { hist = await this.myHistory(id, 2 * 60e3, signal); }
        catch { hist = []; partial = true; }
      }
      partial ||= hist.some((row) => row.source === 'saved-history');
      const rows = hist.filter((m) => Number(m.hero_id) === hid).sort((a, b) => (b.start_time || 0) - (a.start_time || 0)).slice(0, 60);
      const need = rows.filter((m) => this.needsDownload(m.match_id)).slice(0, download);
      const name = this.assets && this.assets.heroes[hid] ? this.assets.heroes[hid].name : 'герое';
      for (let i = 0; i < need.length; i++) {
        if (signal.aborted) { partial = true; break; }
        onDownload?.(i + 1, need.length);
        if (!quiet) this.progress('hero', i, need.length, `Скачиваю твои игры на ${name}: ${i + 1} из ${need.length}`);
        try {
          const m = await this.fetchMine(need[i].match_id, signal);
          m.pathsTried = true;
          await this.store.putMatch(m);
        } catch (error) { if (!(error instanceof NotFoundError)) partial = true; }
      }
      if (need.length && !quiet) this.progress('done', 1, 1, 'Готово');
      for (const r of rows) {
        const m = this.store.getMatch(Number(r.match_id));
        const me = m ? m.players.find((p) => p.account_id === id) : null;
        if (m) mineIds.add(m.match_id);
        if (me) mine.push({ match: m, player: me });
      }
      this.store.markPersonalMatches(mineIds);
    }
    // контр-предметы топов против каждого соперника
    const vs = heroVs(pro.filter((r) => r.w === 1), this.assets, { minGames: 1 });
    const counters = new Map(vs.rows.map((r) => [r.hero_id, r.counters]));
    const res = heroOutlook({ pro, mine, counters });
    res.topsGames = topsN;
    res.heroId = hid;
    res.partial = partial;
    return res;
  }

  heroMatchups(heroId) {
    const recs = this.topRecords(Number(heroId));
    return heroVs(recs, this.assets);
  }

  async prepareGame(accountId, { myHero, enemies = [], laneFoe = null }) {
    const heroId = Number(myHero);
    const id = Number(accountId);
    const recs = this.topRecords(heroId, id).filter(({ match }) => isStandardMatch(match));
    const topVs = heroVs(recs, this.assets, { minGames: 1 });
    const saved = id ? this.savedHistory(id, heroId).filter((row) => isStandardMatch(row)) : [];
    const games = saved.sort((a, b) => b.start_time - a.start_time).slice(0, 60).map((row) => {
      const match = this.store.getMatch(row.match_id);
      return { match, me: match.players.find((p) => p.account_id === id) };
    });
    const mine = myMatchups(games);
    const heroName = (h) => (this.assets && this.assets.heroes[h] ? this.assets.heroes[h].name : `герой ${h}`);
    const itemName = (i) => (this.assets && this.assets.items[i] ? this.assets.items[i].name : `предмет ${i}`);
    const res = prepare({ myHero: heroId, enemies: enemies.map(Number), laneFoe: laneFoe === null ? null : Number(laneFoe), topVs, mine, heroName, itemName });
    res.topGames = recs.length;
    res.myGames = mine.games;
    res.latestTopMatch = recs.reduce((latest, { match }) => Math.max(latest, match.start_time || 0), 0);
    return res;
  }

  // ---------- бок о бок с про-игроком ----------
  async proCandidatesFor(matchId, accountId) {
    const m = await this.loadMatch(matchId);
    const me = m.players.find((p) => p.account_id === Number(accountId));
    if (!me) throw new Error('В этом матче нет твоего аккаунта.');
    const top = this.store.read('top.json', { players: [] });
    const names = new Map(top.players.filter((p) => p.accountId).map((p) => [p.accountId, p.name]));
    const bench = this.topRecords(me.hero_id, Number(accountId)).filter((r) => r.match.match_id !== m.match_id);
    return proCandidates({ me, bench, assets: this.assets, nameOf: (a) => names.get(a) || `ID ${a}` });
  }

  async versus(matchId, accountId, proMatchId, proAccountId) {
    const m = await this.loadMatch(matchId);
    const me = m.players.find((p) => p.account_id === Number(accountId));
    const pm = await this.fetchMatch(proMatchId, { paths: true }).catch(() => this.fetchMatch(proMatchId));
    const pro = pm.players.find((p) => p.account_id === Number(proAccountId));
    if (!me || !pro) throw new Error('Не нашёл одного из игроков в матче.');
    const top = this.store.read('top.json', { players: [] });
    const proInfo = top.players.find((p) => p.accountId === pro.account_id);
    const data = versus({ myMatch: m, me, proMatch: pm, pro, assets: this.assets });
    data.me.map = mapData(m);
    data.pro.map = mapData(pm);
    data.me.match_id = m.match_id;
    data.pro.match_id = pm.match_id;
    data.pro.name = proInfo ? proInfo.name : `ID ${pro.account_id}`;
    data.pro.rank = proInfo ? proInfo.rank : null;
    return data;
  }

  async loadMatch(matchId) {
    const id = Number(matchId);
    let m = this.store.getMatch(id);
    if (!m || (!m.paths && !m.pathsTried) || this.needsUpgrade(m)) {
      const stored = m;
      try {
        m = extractMatch(await this.api.matchMetadata(id, { signal: AbortSignal.timeout(8000) }), { paths: true });
        m.pathsTried = true;
      } catch (e) {
        if (stored) {
          const fallback = { ...stored, pathsTried: true };
          await this.store.putMatch(fallback);
          return fallback;
        }
        if (e instanceof NotFoundError) {
          throw new Error('Этого матча пока нет в deadlock-api. Открой его в игре в истории матчей, затем нажми «Найти в кэше Steam» и попробуй через пару минут.');
        }
        throw e;
      }
      await this.store.putMatch(m);
    }
    const mine = new Set(this.store.read('mine.json', []));
    if (!mine.has(id)) {
      mine.add(id);
      this.store.markPersonalMatches(mine);
    }
    return m;
  }

  // Список топов, у которых есть игры на этом герое (для сравнения с конкретным игроком).
  targetsForHero(heroId) {
    const top = this.store.read('top.json', { players: [] });
    const byAcc = new Map(top.players.filter((p) => p.accountId).map((p) => [p.accountId, p]));
    const counts = new Map();
    for (const m of this.store.allMatches()) {
      for (const p of m.players) {
        if (p.hero_id !== heroId || !byAcc.has(p.account_id)) continue;
        counts.set(p.account_id, (counts.get(p.account_id) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([accountId, games]) => ({ accountId, games, name: byAcc.get(accountId).name, rank: byAcc.get(accountId).rank }))
      .sort((a, b) => b.games - a.games);
  }

  async analyzeMatch({ matchId, accountId, target = { type: 'top' }, winsOnly = false, source = 'top', preferSaved = false }) {
    const m = (preferSaved && this.store.getMatch(matchId)) || await this.loadMatch(matchId);
    const me = m.players.find((p) => p.account_id === Number(accountId));
    if (!me) throw new Error('В этом матче нет твоего аккаунта. Проверь, что вошёл в нужный Steam.');
    const top = this.store.read('top.json', { players: [] });
    let accounts = null;
    let label;
    if (target.type === 'player') {
      accounts = new Set([Number(target.accountId)]);
      const p = top.players.find((x) => x.accountId === Number(target.accountId));
      label = p ? `${p.name} (#${p.rank})` : `игрок ${target.accountId}`;
    } else {
      accounts = source === 'lobby' ? null : new Set(top.players.filter((p) => p.accountId && !p.excluded).map((p) => p.accountId));
      label = source === 'lobby' ? 'все игроки в матчах топов' : `топ-${top.players.length || 50}`;
    }
    let pool = this.store.allMatches();
    // в режиме "все игроки в матчах топов" берём только матчи, где был хотя бы один топ
    if (source === 'lobby' && target.type !== 'player') {
      const topAcc = new Set(top.players.filter((p) => p.accountId && !p.excluded).map((p) => p.accountId));
      pool = pool.filter((x) => x.players.some((p) => topAcc.has(p.account_id)));
    }
    const benchMode = m.match_mode === 1 || m.match_mode === 4 ? m.match_mode : null;
    pool = pool.filter((match) => isStandardMatch(match) && (benchMode === null || match.match_mode === benchMode));
    const bench = benchmarkPlayers({ matches: pool, heroId: me.hero_id, accounts, winsOnly, excludeMatchId: m.match_id, excludeAccount: Number(accountId) });
    const nameOf = (id) => (this.assets && this.assets.items[id] ? this.assets.items[id].name : `Предмет ${id}`);
    const result = analyze({ me, myMatch: m, bench, assets: this.assets, nameOf });
    const benchDays = bench.length ? Math.ceil((nowSec() - Math.min(...bench.map((b) => b.start_time))) / DAY) : 0;
    let leaks = [];
    let highlights = [];
    try {
      const picks = this.store.read('picktables.json', null);
      const table = picks && picks.tables && picks.tables[me.hero_id];
      const laneVs = table && table.vs ? Object.fromEntries(Object.entries(table.vs).map(([k, v]) => [k, typeof v.pro === 'number' ? v.pro : v.delta])) : null;
      const heroName = (hid) => (this.assets && this.assets.heroes[hid] ? this.assets.heroes[hid].name : `Герой ${hid}`);
      const tierOf = tierOfBadge(gameBadge(m, me));
      const topHero = await this.topFeaturesByHero();
      const ctx = { m, me, f: playerFeatures(me, m, this.assets), ref: topHero.get(me.hero_id) || null, tier: tierOf, assets: this.assets, counters: this.counterTable(), laneVs, heroName, itemName: nameOf };
      leaks = gameLeaks(ctx);
      highlights = gameHighlights(ctx);
      // не хвалим и не ругаем за одно и то же: если по карте есть ошибка, похвалу за карту убираем
      const bad = new Set(leaks.filter((l) => l.level !== 'good').map((l) => l.key));
      highlights = highlights.filter((x) => !(x.key === 'map_good' && bad.has('map_timings')) && !(x.key === 'lane_clean' && bad.has('lane_trades')));
    } catch (e) {
      this.emit('log', `leaks: ${e.message}`);
    }
    return {
      leaks,
      highlights,
      macro: macroReview(m, me, { nameOf }),
      fresh: (m.v || 1) >= EXTRACT_V,
      map: mapData(m),
      mySlot: me.slot,
      purchases: itemFates(me.items || [], this.assets).map(({ id, t }) => ({ id, t })),
      match: { match_id: m.match_id, duration_s: m.duration_s, start_time: m.start_time, hero_id: me.hero_id, won: me.won, k: me.k, d: me.d, a: me.a, nw: me.nw },
      targetLabel: label,
      benchMode,
      benchDays,
      winsOnly,
      result,
    };
  }

  // ---------- кэш Steam ----------
  async scanSteamCache(settings, scanCache, accountId = null) {
    this.progress('cache', 0, 1, 'Ищу матчи в кэше Steam…');
    const { steamDir, records } = await scanCache({ steamDir: settings.steamDir });
    if (!steamDir) return { steamDir: null, found: 0, sent: 0 };
    let sent = 0;
    const known = new Set(this.store.read('sentSalts.json', []));
    const fresh = records.filter((r) => !known.has(`${r.match_id}:${r.metadata_salt || ''}:${r.replay_salt || ''}`));
    for (let i = 0; i < fresh.length; i += 100) {
      const chunk = fresh.slice(i, i + 100);
      try {
        await this.api.ingestSalts(chunk);
        sent += chunk.length;
        for (const r of chunk) known.add(`${r.match_id}:${r.metadata_salt || ''}:${r.replay_salt || ''}`);
      } catch (e) {
        this.emit('log', `Отправка в deadlock-api не удалась: ${e.message}`);
      }
    }
    this.store.write('sentSalts.json', [...known].slice(-5000));
    // свежие матчи из кэша, которых нет в истории, — показываем в списке сразу
    let added = 0;
    if (accountId) {
      let hist = [];
      try {
        hist = await this.api.matchHistory(accountId, 60e3);
      } catch {}
      const histIds = new Set(hist.map((m) => Number(m.match_id)));
      const maxId = hist.reduce((x, m) => Math.max(x, Number(m.match_id) || 0), 0);
      const pend = this.store.read('pending.json', []);
      const pendIds = new Set(pend.filter((p) => !p.accountId || p.accountId === accountId).map((p) => p.match_id));
      for (const r of records) {
        if (histIds.has(r.match_id) || pendIds.has(r.match_id)) continue;
        if (maxId && r.match_id < maxId - 1500000) continue;
        pend.push({ match_id: r.match_id, accountId, at: Date.now() });
        pendIds.add(r.match_id);
        added += 1;
      }
      this.store.write('pending.json', pend.slice(-30));
    }
    this.progress('done', 1, 1, 'Готово');
    return { steamDir, found: records.length, sent, added };
  }
}

module.exports = { Sync };
