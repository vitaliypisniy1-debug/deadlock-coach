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
const { buildOverview, rankFromBadges } = require('../core/overview');
const { gameLeaks, gameHighlights, leakProfile, counterItems, winLink, RANK_BENCH, WIN_LINKS } = require('../core/leaks');
const { mapData } = require('../core/mapdata');
const { heroReport } = require('../core/heroReport');
const { updateCoach } = require('../core/coach');
const { myMatchups, heroVs, prepare, heroOutlook } = require('../core/matchups');
const { proCandidates, versus } = require('../core/versus');
const { playerFeatures, refAll } = require('../core/features');
const { matchTips } = require('../core/tipsMatch');
const { skillOrder, skillConsensus, compareSkills } = require('../core/skills');
const { heroPool, pickAdvice, gamePlan } = require('../core/pick');
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
  async myHistory(accountId, ttlMs = 60e3) {
    const hist = await this.api.matchHistory(Number(accountId), ttlMs);
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
  async fetchMine(id) {
    try {
      return extractMatch(await this.api.matchMetadata(Number(id)), { paths: true });
    } catch (e) {
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
  async loadAssets(force = false) {
    const cached = this.store.read('assets.json', null);
    // v2: в справочнике есть компоненты предметов, карта и ранги — старый кэш перекачиваем
    if (!force && cached && cached.v === 5 && Date.now() - cached.fetchedAt < 24 * 3600e3) {
      this.assets = cached;
      return cached;
    }
    try {
      const [heroes, items] = await Promise.all([this.api.heroesAssets(), this.api.itemsAssets()]);
      const a = { v: 5, fetchedAt: Date.now(), heroes: {}, items: {} };
      for (const h of heroes || []) {
        if (!h || !h.id) continue;
        const im = h.images || {};
        a.heroes[h.id] = {
          id: h.id,
          name: h.name || `Герой ${h.id}`,
          img: im.icon_image_small || im.icon_hero_card || im.minimap_image || im.top_bar_image || null,
          card: im.icon_hero_card || im.top_bar_vertical_image || im.selection_image || null,
          wide: im.background_image || im.top_bar_image || null,
          disabled: !!h.disabled,
          inDev: !!h.in_development,
          cls: h.class_name || null,
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
        this.store.putMatch(extractMatch(raw));
        delete missing[id];
        mr.downloaded += 1;
      } catch (e) {
        const stored = this.store.getMatch(id);
        if (stored) {
          stored.upgradeTried = true;
          this.store.putMatch(stored);
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
    const mine = new Set(this.store.read('mine.json', []));
    this.store.prune(nowSec() - settings.keepDays * DAY, mine);
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
  async fetchMatch(matchId, { paths = false } = {}) {
    const id = Number(matchId);
    let m = this.store.getMatch(id);
    const needPaths = paths && m && !m.paths && !m.pathsTried;
    if (!m || needPaths || this.needsUpgrade(m)) {
      try {
        m = extractMatch(await this.api.matchMetadata(id), { paths });
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
      this.store.putMatch(m);
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
      .map((x) => ({ id: x.id, t: x.t, before: x.a.before, after: x.a.after, lift: x.a.lift, fought: x.a.fought }));
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
  async myMatches(accountId, { fresh = false } = {}) {
    let h = null;
    let freshInfo = null;
    if (fresh) {
      try {
        h = await this.api.matchHistoryFresh(accountId);
        freshInfo = { ok: true };
      } catch (e) {
        freshInfo = { ok: false, limited: e.code === 429, error: e.message };
      }
    }
    if (!h) h = await this.api.matchHistory(accountId, 60e3);
    const rows = h.map((m) => {
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
        loaded: !!stored,
        match_mode: m.match_mode,
      };
    });
    // Матчи, найденные в кэше Steam, которых ещё нет в истории deadlock-api
    const known = new Set(rows.map((r) => r.match_id));
    let pending = this.store.read('pending.json', []).filter((p) => !known.has(p.match_id) && Date.now() - p.at < 3 * 86400e3);
    const tryNow = pending.filter((p) => !this.store.getMatch(p.match_id) && (!p.tried || Date.now() - p.tried > 5 * 60e3)).sort((x, y) => y.match_id - x.match_id).slice(0, 2);
    for (const p of tryNow) {
      p.tried = Date.now();
      try {
        const m = extractMatch(await this.api.matchMetadataOnce(p.match_id), { paths: true });
        m.pathsTried = true;
        this.store.putMatch(m);
      } catch (e) {
        // ещё не обработан — попробуем позже
      }
    }
    const keep = [];
    for (const p of pending) {
      const stored = this.store.getMatch(p.match_id);
      const me = stored && stored.players.find((x) => x.account_id === accountId);
      if (stored && !me) continue; // чужой матч из кэша (например, смотрел игру про-игрока)
      keep.push(p);
      if (stored && me) {
        rows.push({ match_id: stored.match_id, hero_id: me.hero_id, start_time: stored.start_time, duration_s: stored.duration_s, k: me.k, d: me.d, a: me.a, nw: me.nw, won: me.won, loaded: true, match_mode: stored.match_mode, source: 'cache' });
      } else {
        rows.push({ match_id: p.match_id, pending: true, start_time: null, source: 'cache' });
      }
    }
    this.store.write('pending.json', keep);
    rows.sort((x, y) => (y.pending ? 2e9 : y.start_time || 0) - (x.pending ? 2e9 : x.start_time || 0));
    const list = rows.slice(0, 60);
    if (fresh) return { list, fresh: freshInfo };
    return list;
  }

  // ---------- общий обзор за период ----------
  async overview(accountId, days = 7) {
    const id = Number(accountId);
    const d = Math.max(1, Math.min(30, Number(days) || 7));
    const hist = await this.myHistory(id, 2 * 60e3);
    const since = nowSec() - d * DAY;
    const inPeriod = hist.filter((m) => (Number(m.start_time) || 0) >= since);
    // Скачиваем подробные данные своих матчей за период (уже скачанные — из памяти).
    const need = inPeriod.filter((m) => this.needsDownload(m.match_id)).slice(0, 80);
    let notFound = 0;
    let failed = 0;
    const mine = new Set(this.store.read('mine.json', []));
    for (let i = 0; i < need.length; i++) {
      const mid = Number(need[i].match_id);
      this.progress('overview', i, need.length, `Скачиваю твои матчи: ${i + 1} из ${need.length}`);
      try {
        const m = await this.fetchMine(mid);
        m.pathsTried = true;
        this.store.putMatch(m);
        mine.add(mid);
      } catch (e) {
        if (e instanceof NotFoundError) notFound += 1;
        else failed += 1;
      }
    }
    for (const m of inPeriod) if (this.store.getMatch(Number(m.match_id))) mine.add(Number(m.match_id));
    this.store.write('mine.json', [...mine].slice(-500));
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

  async heroSummary(accountId, heroId, { limit = 20 } = {}) {
    const id = Number(accountId);
    const hid = Number(heroId);
    const hist = await this.myHistory(id, 2 * 60e3);
    const rows = hist.filter((m) => Number(m.hero_id) === hid).sort((a, b) => (b.start_time || 0) - (a.start_time || 0)).slice(0, limit);
    const need = rows.filter((m) => this.needsDownload(m.match_id));
    const mine = new Set(this.store.read('mine.json', []));
    for (let i = 0; i < need.length; i++) {
      this.progress('hero', i, need.length, `Скачиваю игры на герое: ${i + 1} из ${need.length}`);
      try {
        const m = await this.fetchMine(need[i].match_id);
        m.pathsTried = true;
        this.store.putMatch(m);
      } catch (e) {
        // нет в API — посчитаем без подробностей
      }
    }
    if (need.length) this.progress('done', 1, 1, 'Готово');
    const games = rows.map((r) => {
      const m = this.store.getMatch(Number(r.match_id));
      const me = m ? m.players.find((p) => p.account_id === id) : null;
      if (m) mine.add(m.match_id);
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
    this.store.write('mine.json', [...mine].slice(-500));
    const top = this.store.read('top.json', { players: [] });
    const accounts = new Set(top.players.filter((p) => p.accountId && !p.excluded).map((p) => p.accountId));
    const bench = benchmarkPlayers({ matches: this.store.allMatches(), heroId: hid, accounts, excludeAccount: id });
    const rep = heroReport({ heroId: hid, games, bench, assets: this.assets, accountId: id });
    rep.matchups = myMatchups(games.filter((g) => g.match && g.me).map((g) => ({ match: g.match, me: g.me })));
    const abilityName = (x) => (this.assets && this.assets.items[x] ? this.assets.items[x].name : `способность ${x}`);
    const mySkills = skillConsensus(games.filter((g) => g.me).map((g) => skillOrder(g.me, this.assets)), { minFollow: 2 });
    const topSkills = skillConsensus(bench.map((b) => skillOrder(b.player, this.assets)));
    rep.skills = { mine: mySkills, top: topSkills, compare: compareSkills(mySkills, topSkills, abilityName) };
    rep.list = games.map(({ match, me, ...g }) => ({ ...g, loaded: !!match }));
    return rep;
  }

  // ---------- билд игрока из конкретного матча (выгрузка) ----------
  async matchBuild(matchId, accountId, slot = null) {
    await this.loadAssets().catch(() => {});
    const m = await this.fetchMatch(Number(matchId));
    const p = m.players.find((x) => (accountId && x.account_id === Number(accountId)) || (slot !== null && x.slot === Number(slot))) || null;
    if (!p) throw new Error('Этого игрока нет в матче');
    const b = matchBuild({ match: m, player: p, assets: this.assets });
    const names = await this.namesFor([p.account_id]).catch(() => new Map());
    const top = this.store.read('top.json', { players: [] });
    const t = top.players.find((x) => x.accountId === p.account_id);
    b.playerName = (t && t.name) || names.get(p.account_id) || (p.account_id ? `ID ${p.account_id}` : 'игрок');
    b.rank = t ? t.rank ?? null : null;
    // похожие опубликованные билды — их можно найти в самой игре
    b.similar = [];
    try {
      const raw = await this.api.builds(p.hero_id);
      const core = b.buys.filter((x) => x.fate !== 'sold' && x.t <= 2400).map((x) => ({ id: x.id, pick: x.fate === 'kept' ? 1 : 0.6 }));
      b.similar = rankBuilds(raw, core, { limit: 3 });
    } catch (e) {
      b.similarError = e.message;
    }
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
  // Твои герои для рейтинга: с 15+ победами (правило игры) или список из настроек.
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
    const { pool } = await this.pickPool(id);
    const fresh = cached && cached.accountId === id && cached.v === 3 && Date.now() - cached.at < maxAgeH * 3600e3;
    const missing = pool.filter((p) => !cached || !cached.tables || !cached.tables[p.hero_id]);
    if (!force && fresh && !missing.length) return cached;
    this._pickRunning = (async () => {
      await this.loadAssets().catch(() => {});
      const tables = fresh && !force ? { ...cached.tables } : {};
      const todo = force || !fresh ? pool : missing;
      for (let i = 0; i < todo.length; i++) {
        const hid = todo[i].hero_id;
        const name = this.assets && this.assets.heroes[hid] ? this.assets.heroes[hid].name : String(hid);
        this.progress('pick', i, todo.length, `Готовлю советы по пикам: ${name} (${i + 1} из ${todo.length})`);
        try {
          const o = await this.heroOutlook(id, hid, { download: 15, quiet: true });
          tables[hid] = { vs: o.vs, with: o.with, myGames: o.myGames, proGames: o.proGames };
        } catch (e) {
          tables[hid] = { vs: {}, myGames: 0, proGames: 0, error: e.message };
        }
      }
      this.progress('done', 1, 1, 'Советы по пикам готовы');
      const out = { v: 3, at: Date.now(), accountId: id, tables };
      this.store.write('picktables.json', out);
      return out;
    })();
    try {
      return await this._pickRunning;
    } finally {
      this._pickRunning = null;
    }
  }

  async pickAdvise(accountId, { enemies = [], allies = [], current = null } = {}) {
    const id = Number(accountId);
    const { pool, all, manual } = await this.pickPool(id);
    const cached = this.store.read('picktables.json', null);
    const tables = cached && cached.accountId === id ? cached.tables || {} : {};
    const meta = {};
    const m = this.store.read('meta.json', null);
    for (const r of (m && m.heroes) || []) meta[r.hero_id] = { winrate: r.winrate, games: r.games };
    const advice = pickAdvice({ pool, tables, enemies: enemies.map(Number), allies: allies.map(Number), current, meta });
    const ready = pool.filter((p) => tables[p.hero_id]).length;
    // план на игру: для текущего героя, а если он не отмечен — для лучшего пика
    let plan = null;
    if (enemies.length) {
      const hid = current ? Number(current) : advice.rows[0] && advice.rows[0].hero_id;
      let row = advice.all.find((r) => r.hero_id === hid) || null;
      // текущий герой не из списка для рейтинга — считаем для него таблицу на лету (без скачиваний)
      if (!row && hid) {
        try {
          this._planTables = this._planTables || {};
          if (!this._planTables[hid]) {
            const o = await this.heroOutlook(id, hid, { download: 0, quiet: true });
            this._planTables[hid] = { vs: o.vs, with: o.with };
          }
          const one = pickAdvice({ pool: [{ hero_id: hid, games: 0, wins: 0 }], tables: { [hid]: this._planTables[hid] }, enemies: enemies.map(Number), allies: allies.map(Number), meta });
          row = one.all[0] || null;
        } catch (e) {
          this.emit('log', `plan: ${e.message}`);
        }
      }
      let counters = {};
      try {
        counters = this.counterTable();
      } catch {}
      plan = gamePlan({ row, counters, leak: this.store.read(`leaks-top-${id}.json`, null) });
    }
    for (const r of advice.all) delete r.parts;
    return { ...advice, plan, pool: pool.map((p) => p.hero_id), allHeroes: all.map((p) => ({ hero_id: p.hero_id, games: p.games, wins: p.wins })), manual, ready, poolSize: pool.length, tablesAt: cached ? cached.at : null, preparing: !!this._pickRunning };
  }

  // ---------- общие помощники для тренера и матчапов ----------
  topAccounts() {
    const top = this.store.read('top.json', { players: [] });
    return new Set(top.players.filter((p) => p.accountId && !p.excluded).map((p) => p.accountId));
  }

  // Удалить все скачанные матчи топов (свои матчи остаются) и всё, что по ним посчитано.
  async resetTopMatches() {
    if (this.running) throw new Error('Сейчас идёт обновление меты — дождись конца и попробуй ещё раз');
    const mine = new Set(this.store.read('mine.json', []));
    const removed = await this.store.removeMatches((m) => !mine.has(m.match_id));
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
    const topHero = this.topFeaturesByHero();
    const counters = this.counterTable();
    const picks = this.store.read('picktables.json', null);
    const heroName = (hid) => (this.assets && this.assets.heroes[hid] ? this.assets.heroes[hid].name : `Герой ${hid}`);
    const itemName = (iid) => (this.assets && this.assets.items[iid] ? this.assets.items[iid].name : `Предмет ${iid}`);
    const badges = [];
    for (const x of list) if (x.match && x.me && Array.isArray(x.match.badge) && typeof x.match.badge[x.me.team] === 'number') badges.push(x.match.badge[x.me.team]);
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
      const leaks = gameLeaks({ m, me, f, ref: topHero.get(me.hero_id) || null, tier, assets: this.assets, counters, laneVs, heroName, itemName });
      games.push({ match_id: m.match_id, start_time: m.start_time, duration_s: m.duration_s, hero: me.hero_id, won: me.won, k: me.k, d: me.d, a: me.a, fresh, leaks, f });
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
    const topLeak = profile.rows[0];
    this.store.write(`leaks-top-${id}.json`, topLeak ? { title: topLeak.title, fix: (topLeak.fix || [])[0] || null, count: topLeak.count, games: profile.games, at: Date.now() } : null);
    return {
      rank,
      games: games.map(({ f, ...g }) => ({ ...g, leaks: g.leaks.map((l) => ({ key: l.key, area: l.area, level: l.level, title: l.title, text: l.text, fix: l.fix, moments: l.moments, score: l.score })) })),
      fresh: games.filter((g) => g.fresh).length,
      total: games.length,
      profile,
      habits,
      countersReady: Object.keys(counters).length > 0,
      topsReady: topHero.size > 0,
    };
  }

  topFeaturesByHero() {
    // кэш до изменения набора матчей (считать заново — секунды на тысячах игр)
    const all = this.store.allMatches();
    const key = `${all.length}:${all.reduce((s, m) => s + (m.v || 1), 0)}:${this.topAccounts().size}`;
    if (this._topHero && this._topHero.key === key) return this._topHero.map;
    const map = this.computeTopFeatures();
    this._topHero = { key, map };
    return map;
  }

  computeTopFeatures() {
    const by = new Map();
    for (const r of this.topRecords()) {
      if (!by.has(r.player.hero_id)) by.set(r.player.hero_id, []);
      by.get(r.player.hero_id).push(playerFeatures(r.player, r.match, this.assets));
    }
    return new Map([...by.entries()].map(([h, list]) => [h, refAll(list)]));
  }

  // Твои последние матчи с подробностями (докачивает недостающие).
  async myLoadedGames(accountId, { limit = 30, download = 25, label = 'Скачиваю твои матчи' } = {}) {
    const id = Number(accountId);
    const hist = await this.myHistory(id, 60e3);
    const rows = hist.slice().sort((a, b) => (Number(b.start_time) || 0) - (Number(a.start_time) || 0)).slice(0, limit);
    const need = rows.filter((m) => this.needsDownload(m.match_id)).slice(0, download);
    for (let i = 0; i < need.length; i++) {
      this.progress('coach', i, need.length, `${label}: ${i + 1} из ${need.length}`);
      try {
        const m = await this.fetchMine(need[i].match_id);
        m.pathsTried = true;
        this.store.putMatch(m);
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
    this.store.write('mine.json', [...mine].slice(-500));
    return out;
  }

  // ---------- личный тренер ----------
  async coach(accountId, { forceNew = false } = {}) {
    const id = Number(accountId);
    const list = await this.myLoadedGames(id, { limit: 40, download: 25, label: 'Тренер смотрит твои матчи' });
    const heroName = (h) => (this.assets && this.assets.heroes[h] ? this.assets.heroes[h].name : `герой ${h}`);
    const itemName = (i) => (this.assets && this.assets.items[i] ? this.assets.items[i].name : `предмет ${i}`);
    // сессии и пауза после поражения
    let prevEnd = null;
    let prevWon = null;
    let pos = 0;
    const games = list.map(({ row, match, me }) => {
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
    const lobbyF = [];
    for (const g of games) if (g.match && g.me) for (const p of g.match.players) if (p !== g.me && !p.abandoned) lobbyF.push(playerFeatures(p, g.match, this.assets));
    const lobby = refAll(lobbyF);
    const topHero = this.topFeaturesByHero();
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
    const tierOf = (g) => (g.match && Array.isArray(g.match.badge) && g.me && typeof g.match.badge[g.me.team] === 'number' ? Math.floor(g.match.badge[g.me.team] / 10) : null);
    const tipsFor = (g) => {
      if (!g.f || !g.match) return [];
      if (tipsCache.has(g.match_id)) return tipsCache.get(g.match_id);
      const ref = topHero.get(g.hero) || lobby;
      const lob = refAll(g.match.players.filter((p) => p !== g.me && !p.abandoned).map((p) => playerFeatures(p, g.match, this.assets)));
      const tips = matchTips({ me: g.f, ref, lobby: lob, heroName, itemName, won: g.me.won });
      // ошибки с моментами (лес во время драк, размены, тайминги карты) — в общий список
      let lk = [];
      try {
        lk = gameLeaks({ m: g.match, me: g.me, f: g.f, ref: topHero.get(g.hero) || null, tier: tierOf(g), assets: this.assets, counters, heroName, itemName })
          .map((l) => ({ title: l.title, text: l.text, tip: l.fix && l.fix[0], area: l.area, level: l.level, score: l.score }));
      } catch {}
      const t = tips.concat(lk).sort((a, b) => b.score - a.score);
      tipsCache.set(g.match_id, t);
      return t;
    };
    const state = this.store.read(`coach-${id}.json`, null);
    const { state: next, view } = updateCoach(state, {
      games,
      topHero,
      lobby,
      extra,
      mainMistake: (g) => {
        const t = tipsFor(g).find((x) => x.level === 'bad' || x.level === 'warn');
        return t ? { title: t.title, text: t.text, tip: t.tip, area: t.area } : null;
      },
      mainGood: (g) => {
        const t = tipsFor(g).find((x) => x.level === 'good');
        return t ? { title: t.title } : null;
      },
    }, { forceNew });
    this.store.write(`coach-${id}.json`, next);
    view.topsReady = topHero.size > 0;
    view.loaded = games.filter((g) => g.f).length;
    return view;
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
  async heroOutlook(accountId, heroId, { download = 20, quiet = false } = {}) {
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
    if (id) {
      let hist = [];
      try {
        hist = await this.myHistory(id, 2 * 60e3);
      } catch {}
      const rows = hist.filter((m) => Number(m.hero_id) === hid).sort((a, b) => (b.start_time || 0) - (a.start_time || 0)).slice(0, 60);
      const need = rows.filter((m) => this.needsDownload(m.match_id)).slice(0, download);
      const name = this.assets && this.assets.heroes[hid] ? this.assets.heroes[hid].name : 'герое';
      for (let i = 0; i < need.length; i++) {
        if (!quiet) this.progress('hero', i, need.length, `Скачиваю твои игры на ${name}: ${i + 1} из ${need.length}`);
        try {
          const m = await this.fetchMine(need[i].match_id);
          m.pathsTried = true;
          this.store.putMatch(m);
        } catch {}
      }
      if (need.length && !quiet) this.progress('done', 1, 1, 'Готово');
      for (const r of rows) {
        const m = this.store.getMatch(Number(r.match_id));
        const me = m ? m.players.find((p) => p.account_id === id) : null;
        if (m) mineIds.add(m.match_id);
        if (me) mine.push({ match: m, player: me });
      }
      this.store.write('mine.json', [...mineIds].slice(-500));
    }
    // контр-предметы топов против каждого соперника
    const vs = heroVs(pro.filter((r) => r.w === 1), this.assets, { minGames: 1 });
    const counters = new Map(vs.rows.map((r) => [r.hero_id, r.counters]));
    const res = heroOutlook({ pro, mine, counters });
    res.topsGames = topsN;
    res.heroId = hid;
    return res;
  }

  heroMatchups(heroId) {
    const recs = this.topRecords(Number(heroId));
    return heroVs(recs, this.assets);
  }

  async prepareGame(accountId, { myHero, enemies = [], laneFoe = null }) {
    const recs = this.topRecords(Number(myHero));
    const topVs = heroVs(recs, this.assets, { minGames: 1 });
    const list = accountId ? await this.myLoadedGames(accountId, { limit: 60, download: 0 }).catch(() => []) : [];
    const mine = myMatchups(list.filter((x) => x.match && x.me));
    const heroName = (h) => (this.assets && this.assets.heroes[h] ? this.assets.heroes[h].name : `герой ${h}`);
    const itemName = (i) => (this.assets && this.assets.items[i] ? this.assets.items[i].name : `предмет ${i}`);
    const res = prepare({ myHero: Number(myHero), enemies: enemies.map(Number), laneFoe: laneFoe === null ? null : Number(laneFoe), topVs, mine, heroName, itemName });
    res.topGames = recs.length;
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
        m = extractMatch(await this.api.matchMetadata(id), { paths: true });
        m.pathsTried = true;
      } catch (e) {
        if (stored) {
          stored.pathsTried = true;
          this.store.putMatch(stored);
          return stored;
        }
        if (e instanceof NotFoundError) {
          throw new Error('Этого матча пока нет в deadlock-api. Открой его в игре в истории матчей, затем нажми «Найти в кэше Steam» и попробуй через пару минут.');
        }
        throw e;
      }
      this.store.putMatch(m);
    }
    const mine = new Set(this.store.read('mine.json', []));
    if (!mine.has(id)) {
      mine.add(id);
      this.store.write('mine.json', [...mine].slice(-500));
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

  async analyzeMatch({ matchId, accountId, target = { type: 'top' }, winsOnly = false, source = 'top' }) {
    const m = await this.loadMatch(matchId);
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
      const tierOf = Array.isArray(m.badge) && typeof m.badge[me.team] === 'number' ? Math.floor(m.badge[me.team] / 10) : null;
      const ctx = { m, me, f: playerFeatures(me, m, this.assets), ref: this.topFeaturesByHero().get(me.hero_id) || null, tier: tierOf, assets: this.assets, counters: this.counterTable(), laneVs, heroName, itemName: nameOf };
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
      fresh: (m.v || 1) >= EXTRACT_V,
      map: mapData(m),
      mySlot: me.slot,
      match: { match_id: m.match_id, duration_s: m.duration_s, start_time: m.start_time, hero_id: me.hero_id, won: me.won, k: me.k, d: me.d, a: me.a, nw: me.nw },
      targetLabel: label,
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
      const pendIds = new Set(pend.map((p) => p.match_id));
      for (const r of records) {
        if (histIds.has(r.match_id) || pendIds.has(r.match_id)) continue;
        if (maxId && r.match_id < maxId - 1500000) continue;
        pend.push({ match_id: r.match_id, at: Date.now() });
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
