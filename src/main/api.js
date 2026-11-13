'use strict';
const { setTimeout: delay } = require('node:timers/promises');
// Клиент deadlock-api.com: очередь запросов, паузы при лимитах, повторы при сбоях,
// кэш ответов в памяти. Ключ API не обязателен, но с ним лимиты выше
// (бесплатно выдают в Discord проекта).

const BASE = 'https://api.deadlock-api.com';

class NotFoundError extends Error {
  constructor(path) {
    super(`Нет данных: ${path}`);
    this.code = 404;
  }
}

class Api {
  constructor({ getApiKey = () => '', concurrency = 2, minGapMs = 300 } = {}) {
    this.getApiKey = getApiKey;
    this.concurrency = concurrency;
    this.minGapMs = minGapMs;
    this.active = 0;
    this.queue = [];
    this.lastStart = 0;
    this.pausedUntil = 0;
    this.cache = new Map();
  }

  _pump() {
    while (this.active < this.concurrency && this.queue.length) {
      const now = Date.now();
      const wait = Math.max(this.pausedUntil - now, this.lastStart + this.minGapMs - now);
      if (wait > 0) {
        if (!this._timer) {
          this._timer = setTimeout(() => {
            this._timer = null;
            this._pump();
          }, wait);
        }
        return;
      }
      const job = this.queue.shift();
      this.active += 1;
      this.lastStart = Date.now();
      job()
        .catch(() => {})
        .finally(() => {
          this.active -= 1;
          this._pump();
        });
    }
  }

  _enqueue(fn, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const job = () => {
        signal?.removeEventListener('abort', cancelQueued);
        return fn().then(resolve, reject);
      };
      const cancelQueued = () => {
        const index = this.queue.indexOf(job);
        if (index >= 0) this.queue.splice(index, 1);
        reject(signal.reason);
      };
      signal?.addEventListener('abort', cancelQueued, { once: true });
      this.queue.push(job);
      this._pump();
    });
  }

  async _request(path, { method = 'GET', body = null, attempt = 0, noRetry = false, signal } = {}) {
    signal?.throwIfAborted();
    const headers = { 'User-Agent': 'DeadlockCoach/1.0', Accept: 'application/json' };
    const key = this.getApiKey();
    if (key) headers['X-API-KEY'] = key;
    if (body) headers['Content-Type'] = 'application/json';
    let res;
    try {
      const timeout = AbortSignal.timeout(45000);
      res = await fetch(/^https:\/\//.test(path) ? path : BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch (e) {
      signal?.throwIfAborted();
      if (attempt < 3) {
        await delay(1500 * (attempt + 1), undefined, { signal });
        return this._request(path, { method, body, attempt: attempt + 1, noRetry, signal });
      }
      throw new Error(`Нет связи с deadlock-api.com (${e.message})`);
    }
    if (res.status === 404) throw new NotFoundError(path);
    if (res.status === 429 && noRetry) {
      const err = new Error('rate-limited');
      err.code = 429;
      err.retryAfter = Number(res.headers.get('retry-after')) || null;
      throw err;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 4) throw new Error(`deadlock-api.com отвечает ошибкой ${res.status}, попробуй позже`);
      const ra = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 3000 * 2 ** attempt;
      this.pausedUntil = Date.now() + waitMs;
      await delay(waitMs, undefined, { signal });
      return this._request(path, { method, body, attempt: attempt + 1, noRetry, signal });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Ошибка API ${res.status}: ${text.slice(0, 200)}`);
      err.code = res.status;
      throw err;
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : res.text();
  }

  // GET с кэшем в памяти на ttlMs.
  get(path, { ttlMs = 0, signal } = {}) {
    if (ttlMs) {
      const hit = this.cache.get(path);
      if (hit && hit.until > Date.now()) return Promise.resolve(hit.value);
    }
    return this._enqueue(() => this._request(path, { signal }), signal).then((value) => {
      if (ttlMs) this.cache.set(path, { value, until: Date.now() + ttlMs });
      return value;
    });
  }

  post(path, body, { signal } = {}) {
    return this._enqueue(() => this._request(path, { method: 'POST', body, signal }), signal);
  }

  // ---- конкретные запросы ----
  leaderboard(region) {
    return this.get(`/v1/leaderboard/${encodeURIComponent(region)}`, { ttlMs: 10 * 60e3 }).then((r) => {
      if (Array.isArray(r)) return r;
      if (r && typeof r === 'object') return r.entries || r.leaderboard || r.players || [];
      return [];
    });
  }

  // Свежая история прямо из Steam (лимит deadlock-api — примерно раз в час с одного адреса).
  matchHistoryFresh(accountId, { signal } = {}) {
    const path = `/v1/players/${accountId}/match-history?force_refetch=true`;
    return this._enqueue(() => this._request(path, { noRetry: true, signal }), signal).then((r) => {
      const list = Array.isArray(r) ? r : (r && (r.matches || r.match_history || r.history)) || [];
      this.cache.set(`/v1/players/${accountId}/match-history`, { value: list, until: Date.now() + 2 * 60e3 });
      return list;
    });
  }

  // Метаданные без повторов при лимите (для проверки «новых» матчей).
  matchMetadataOnce(matchId, { signal } = {}) {
    return this._enqueue(() => this._request(`/v1/matches/${matchId}/metadata`, { noRetry: true, signal }), signal);
  }

  matchHistory(accountId, ttlMs = 20 * 60e3, { signal } = {}) {
    return this.get(`/v1/players/${accountId}/match-history`, { ttlMs, signal }).then((r) => {
      if (Array.isArray(r)) return r;
      if (r && typeof r === 'object') return r.matches || r.match_history || r.history || [];
      return [];
    });
  }

  // SQL-доступ к базе deadlock-api (только чтение). Формат ответа может быть
  // JSON-массивом, JSON по строкам или таблицей через табуляцию — разбираем любой.
  sql(query) {
    return this.get(`/v1/sql?query=${encodeURIComponent(query)}`, { ttlMs: 10 * 60e3 });
  }

  async sqlRows(query, cols) {
    return normRows(await this.sql(query), cols);
  }

  async sqlColumns(table) {
    try {
      const rows = normRows(await this.sql(`DESCRIBE TABLE ${table}`), ['name', 'type']);
      if (rows.length && rows[0].name) return rows.map((x) => ({ name: String(x.name), type: String(x.type || '') }));
    } catch (e) {
      // попробуем по одной строке ниже
    }
    const rows = normRows(await this.sql(`SELECT * FROM ${table} LIMIT 1`), null);
    if (!rows.length || typeof rows[0] !== 'object') throw new Error(`таблица ${table} недоступна или пуста`);
    return Object.entries(rows[0]).map(([name, v]) => ({
      name,
      type: Array.isArray(v) ? 'Array' : typeof v === 'number' ? 'Int' : /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d/.test(String(v)) ? 'DateTime' : 'String',
    }));
  }

  activeMatches() {
    return this.get('/v1/matches/active', { ttlMs: 2 * 60e3 });
  }

  recentMatches() {
    return this.get('/v1/matches/recently-fetched', { ttlMs: 5 * 60e3 });
  }

  // Текущие ранги пачки игроков. Ответ — список с account_id и рангом.
  async ranks(accountIds) {
    const out = [];
    for (let i = 0; i < accountIds.length; i += 50) {
      const chunk = accountIds.slice(i, i + 50);
      const r = await this.get(`/v1/players/rank?account_ids=${chunk.join(',')}`, { ttlMs: 30 * 60e3 });
      if (Array.isArray(r)) out.push(...r);
    }
    return out;
  }

  steamSearch(name) {
    return this.get(`/v1/players/steam-search?search_query=${encodeURIComponent(name)}&limit=20`, { ttlMs: 6 * 3600e3 }).then((r) => (Array.isArray(r) ? r : []));
  }

  matchMetadata(matchId, { signal } = {}) {
    return this.get(`/v1/matches/${matchId}/metadata`, { signal });
  }

  steamProfiles(accountIds, { signal } = {}) {
    if (!accountIds.length) return Promise.resolve([]);
    return this.get(`/v1/players/steam?account_ids=${accountIds.join(',')}`, { ttlMs: 60 * 60e3, signal }).then((r) => (Array.isArray(r) ? r : []));
  }

  heroesAssets() {
    return this.get('/v1/assets/heroes', { ttlMs: 6 * 3600e3 });
  }

  itemsAssets() {
    return this.get('/v1/assets/items', { ttlMs: 6 * 3600e3 });
  }

  // Карта: радиус мира и картинки миникарты.
  async mapAssets() {
    for (const p of ['/v1/assets/map', 'https://assets.deadlock-api.com/v1/map']) {
      try {
        const r = await this.get(p, { ttlMs: 24 * 3600e3 });
        if (r && typeof r === 'object' && !Array.isArray(r)) return r;
      } catch (e) {
        // следующий адрес
      }
    }
    return null;
  }

  // Названия и картинки рангов (сервис ассетов deadlock-api).
  async ranksAssets() {
    for (const p of ['/v1/assets/ranks', 'https://assets.deadlock-api.com/v2/ranks']) {
      try {
        const r = await this.get(p, { ttlMs: 24 * 3600e3 });
        if (Array.isArray(r) && r.length) return r;
      } catch (e) {
        // пробуем следующий адрес
      }
    }
    return [];
  }

  async builds(heroId, { signal } = {}) {
    const tries = [
      `/v1/builds?hero_id=${heroId}&sort_by=favorites&sort_direction=desc&limit=200&only_latest=true`,
      `/v1/builds?hero_id=${heroId}`,
    ];
    let lastErr;
    for (const p of tries) {
      try {
        const r = await this.get(p, { ttlMs: 60 * 60e3, signal });
        return Array.isArray(r) ? r : r.builds || [];
      } catch (e) {
        lastErr = e;
        if (e.code !== 400 && e.code !== 422) break;
      }
    }
    throw lastErr;
  }

  // Готовая статистика deadlock-api по всем матчам выбранного уровня (для совета по пику).
  // since — unix-время начала окна, badge — минимальный средний ранг матча (91 = Фантом 1).
  _analytics(kind, { since, badge, lane = null }) {
    const q = [`game_mode=normal`, `min_average_badge=${badge}`, `min_unix_timestamp=${since}`];
    if (lane !== null) q.push(`same_lane_filter=${lane ? 'true' : 'false'}`);
    return this.get(`/v1/analytics/${kind}?${q.join('&')}`, { ttlMs: 3 * 3600e3 }).then((r) => (Array.isArray(r) ? r : []));
  }

  heroStatsAnalytics(opts) {
    return this._analytics('hero-stats', { ...opts, lane: null });
  }

  heroCounterAnalytics(opts) {
    return this._analytics('hero-counter-stats', opts);
  }

  heroSynergyAnalytics(opts) {
    return this._analytics('hero-synergy-stats', opts);
  }

  // Покупки на одном герое (для профиля сборки в справочнике контрпиков):
  // доля матчей героя с покупкой каждого предмета, игры normal, минимальный средний ранг матча.
  itemStatsAnalytics({ heroId, since, badge }) {
    const q = [`hero_id=${Number(heroId)}`, 'game_mode=normal', `min_average_badge=${badge}`, `min_unix_timestamp=${since}`];
    return this.get(`/v1/analytics/item-stats?${q.join('&')}`, { ttlMs: 3 * 3600e3 }).then((r) => (Array.isArray(r) ? r : []));
  }

  ingestSalts(records) {
    return this.post('/v1/matches/salts', records);
  }
}

function parseCell(v) {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (/^\[.*\]$/.test(t)) {
    try {
      return JSON.parse(t.replace(/'/g, '"'));
    } catch {
      return t.slice(1, -1).split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
    }
  }
  return t;
}

function normRows(r, cols) {
  if (Array.isArray(r)) {
    if (r.length && Array.isArray(r[0]) && cols) return r.map((a) => Object.fromEntries(cols.map((c, i) => [c, parseCell(a[i])])));
    return r;
  }
  if (r && typeof r === 'object') return normRows(r.data || r.rows || r.result || [], cols);
  if (typeof r === 'string') {
    const lines = r.split('\n').map((l) => l.trimEnd()).filter(Boolean);
    const out = [];
    for (const l of lines) {
      if (l.startsWith('{')) {
        try {
          out.push(JSON.parse(l));
          continue;
        } catch {}
      }
      if (cols) {
        const parts = l.split('\t');
        out.push(Object.fromEntries(cols.map((c, i) => [c, parseCell(parts[i] ?? '')])));
      }
    }
    return out;
  }
  return [];
}

module.exports = { Api, NotFoundError, BASE, normRows };
