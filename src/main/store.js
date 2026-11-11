'use strict';
// Локальное хранилище в папке данных приложения (%APPDATA%/deadlock-coach).
// Обычные JSON-файлы: их легко посмотреть или удалить руками.

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const DEFAULT_SETTINGS = {
  region: 'Europe',
  topN: 50,
  days: 7, // за сколько дней берём матчи топов
  onlyRanked: false,
  apiKey: '',
  benchmarkSource: 'top', // 'top' — только игроки топ-50, 'lobby' — все игроки в их матчах
  winsOnly: false,
  autoRefreshHours: 3,
  keepDays: 14,
  manualTop: '',
  topSource: 'auto', // auto (ладдер текущего сезона) | list
  overlayKey: 'Ctrl+Shift+D', // горячая клавиша оверлея «Пик против состава»
  pickPool: null, // свои герои для совета по пику; null — автоматический список по истории
  gameMode: true, // пока идёт Deadlock — фоновые загрузки ждут, оверлей работает
  autoRecognize: true, // узнавать состав по портретам (пауза перед игрой и горячая клавиша)
  overlayAutoHide: true, // прятать оверлей через несколько секунд после начала игры
  autoUpdateCheck: true, // проверять обновления на GitHub при запуске
  skippedVersion: null, // версия, которую попросили не предлагать
};

class Store {
  // lazy: матчи читаются с диска в фоне (тысячи файлов на Windows — это секунды, окно не должно
  // на это время замирать). Тогда перед работой с матчами нужно дождаться store.ready.
  constructor(dir, { lazy = false, onPackError = () => {} } = {}) {
    this.dir = dir;
    this.matchDir = path.join(dir, 'matches');
    fs.mkdirSync(this.matchDir, { recursive: true });
    this.matches = new Map();
    this.loadInfo = { files: 0, ms: 0 };
    this.packFile = path.join(dir, 'matches.pack');
    this.packStamp = path.join(dir, 'matches.pack.state.json');
    this.packOn = false;
    this._packClean = false;
    this._matchQ = Promise.resolve();
    this._onPackError = onPackError;
    if (lazy) this.ready = this._loadMatchesAsync();
    else {
      this._loadMatches();
      this.ready = Promise.resolve();
    }
  }

  // Быстрый запуск: кроме отдельных файлов матчей ведём один общий файл matches.pack
  // (по матчу на строку, новые версии дописываются в конец). Открыть один большой файл в сотни
  // раз быстрее, чем тысячи маленьких (каждый ещё и проверяет антивирус). Отдельные файлы
  // остаются: это запасной вариант, и по списку файлов видно, какие матчи ещё не удалены.
  async _loadMatchesAsync() {
    const t0 = Date.now();
    const tick = () => new Promise((r) => setImmediate(r));
    let names = [];
    try {
      names = (await fs.promises.readdir(this.matchDir)).filter((f) => f.endsWith('.json'));
    } catch {}
    const onDisk = new Set(names.map((f) => Number(f.slice(0, -5))));
    const packed = new Set();
    let lines = 0;
    if (await this._canReadPack()) {
      try {
        for await (const line of this._packLines()) {
          if (!line) continue;
          const m = JSON.parse(line);
          if (!m?.match_id) throw new Error('Некорректная запись в matches.pack');
          if (onDisk.has(m.match_id)) {
            this.matches.set(m.match_id, m); // более поздняя строка новее
            packed.add(m.match_id);
          }
          if (++lines % 150 === 0) await tick();
        }
        this._packClean = true;
      } catch {
        this.matches.clear();
        packed.clear();
      }
    }
    const rest = names.filter((f) => !packed.has(Number(f.slice(0, -5))));
    const BATCH = 24;
    for (let i = 0; i < rest.length; i += BATCH) {
      const texts = await Promise.all(rest.slice(i, i + BATCH).map((f) => fs.promises.readFile(path.join(this.matchDir, f), 'utf8').catch(() => null)));
      for (const t of texts) {
        if (!t) continue;
        try {
          const m = JSON.parse(t);
          if (m && m.match_id && !this.matches.has(m.match_id)) this.matches.set(m.match_id, m);
        } catch {}
      }
      await tick();
    }
    this.loadInfo = { files: names.length, fromPack: packed.size, fromFiles: rest.length, ms: Date.now() - t0 };
    this.packOn = true;
    // общий файл устарел (много лишних строк или матчей вне его) — пересобираем в фоне
    if (!this._packClean || rest.length > 0 || lines > packed.size * 1.3 + 50) {
      this._queueMatches(() => this._rewritePack()).catch(this._onPackError);
    }
  }

  async *_packLines() {
    let tail = '';
    for await (const chunk of fs.createReadStream(this.packFile, { encoding: 'utf8' })) {
      const lines = (tail + chunk).split('\n');
      tail = lines.pop();
      yield* lines;
    }
    if (tail) yield tail;
  }

  async _canReadPack() {
    try {
      const stamp = JSON.parse(await fs.promises.readFile(this.packStamp, 'utf8'));
      const pack = await fs.promises.stat(this.packFile);
      return stamp.version === 1 && pack.isFile() && stamp.size === pack.size && stamp.mtimeMs === pack.mtimeMs;
    } catch { return false; }
  }

  _queueMatches(run) {
    const result = this._matchQ.then(run);
    this._matchQ = result.catch(() => {});
    return result;
  }

  async _invalidatePack() {
    this._packClean = false;
    await fs.promises.unlink(this.packStamp).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }

  async _stampPack() {
    const { size, mtimeMs } = await fs.promises.stat(this.packFile);
    await this._writeAtomic(this.packStamp, JSON.stringify({ version: 1, size, mtimeMs }));
    this._packClean = true;
  }

  async _writeAtomic(file, text) {
    const tmp = file + '.tmp';
    await fs.promises.writeFile(tmp, text, { flush: true });
    await fs.promises.rename(tmp, file);
  }

  async _rewritePack() {
    await this._invalidatePack();
    const tmp = this.packFile + '.tmp';
    async function* chunks(matches) {
      let batch = [];
      for (const m of matches.values()) {
        batch.push(JSON.stringify(m));
        if (batch.length < 100) continue;
        yield batch.join('\n') + '\n';
        batch = [];
        await new Promise((resolve) => setImmediate(resolve));
      }
      if (batch.length) yield batch.join('\n') + '\n';
    }
    await pipeline(Readable.from(chunks(this.matches)), fs.createWriteStream(tmp, { flush: true }));
    await fs.promises.rename(tmp, this.packFile);
    await this._stampPack();
  }

  _file(name) {
    return path.join(this.dir, name);
  }

  read(name, fallback) {
    try {
      return JSON.parse(fs.readFileSync(this._file(name), 'utf8'));
    } catch {
      return fallback;
    }
  }

  write(name, value) {
    const f = this._file(name);
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, f);
  }

  remove(name) {
    try {
      fs.unlinkSync(this._file(name));
    } catch {}
  }

  _readProtection(name, fallback) {
    try {
      return JSON.parse(fs.readFileSync(this._file(name), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return fallback;
      throw new Error(`Не удалось прочитать защиту личных матчей: ${name}`, { cause: err });
    }
  }

  _protectedIds(name) {
    const ids = this._readProtection(name, []);
    if (!Array.isArray(ids) || ids.some((id) => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
      throw new Error(`Некорректный список защиты личных матчей: ${name}`);
    }
    return new Set(ids.map(Number));
  }

  _personalAccounts() {
    const accounts = this._protectedIds('personal-accounts.json');
    const auth = this._readProtection('auth.json', null);
    if (auth !== null) {
      const id = Number(auth.accountId);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Не удалось определить владельца личных матчей');
      accounts.add(id);
    }
    // У предыдущих версий список аккаунтов отсутствует, но эти файлы создавались для личного профиля.
    for (const name of fs.readdirSync(this.dir)) {
      const match = /^(?:coach|leaks-top)-(\d+)\.json$/.exec(name);
      if (match) accounts.add(Number(match[1]));
    }
    return accounts;
  }

  async saveAuth(auth) {
    return this._queueMatches(() => {
      const accounts = this._personalAccounts();
      if (auth) accounts.add(Number(auth.accountId));
      if (accounts.size) this.write('personal-accounts.json', [...accounts]);
      if (auth) this.write('auth.json', auth);
      else this.remove('auth.json');
    });
  }

  markPersonalMatches(ids) {
    const existing = this._protectedIds('mine.json');
    for (const id of ids) existing.add(Number(id));
    this.write('mine.json', [...existing]);
  }

  settings() {
    const saved = this.read('settings.json', {});
    // с версии 0.13 период по умолчанию — неделя; старые «3 дня по умолчанию» переводим один раз
    if (saved.days === 3 && !saved.daysChosen) saved.days = 7;
    return { ...DEFAULT_SETTINGS, ...saved };
  }

  saveSettings(patch) {
    const next = { ...this.settings(), ...patch };
    next.topN = Math.max(5, Math.min(200, Number(next.topN) || 50));
    next.days = Math.max(1, Math.min(14, Number(next.days) || 7));
    if (patch && 'days' in patch) next.daysChosen = true;
    next.keepDays = Math.max(next.days, Math.min(60, Number(next.keepDays) || 14));
    this.write('settings.json', next);
    return next;
  }

  // ---- матчи (компактные выжимки) ----
  _loadMatches() {
    for (const f of fs.readdirSync(this.matchDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const m = JSON.parse(fs.readFileSync(path.join(this.matchDir, f), 'utf8'));
        if (m && m.match_id) this.matches.set(m.match_id, m);
      } catch {}
    }
  }

  hasMatch(id) {
    return this.matches.has(Number(id));
  }

  getMatch(id) {
    return this.matches.get(Number(id)) || null;
  }

  async putMatch(m) {
    await this.ready;
    return this._queueMatches(async () => {
      const append = this.packOn && this._packClean;
      const text = JSON.stringify(m);
      // Сначала убираем разрешение читать старый пакет, затем сохраняем основной JSON.
      await this._invalidatePack();
      await this._writeAtomic(path.join(this.matchDir, `${m.match_id}.json`), text);
      this.matches.set(m.match_id, m);
      if (append) {
        try {
          await fs.promises.appendFile(this.packFile, text + '\n', { flush: true });
          await this._stampPack();
        } catch (error) {
          // JSON уже сохранён. Без отметки при следующем запуске пакет пересоберётся.
          this._onPackError(error);
        }
      }
    });
  }

  allMatches() {
    return [...this.matches.values()];
  }

  async removeMatches(pred, { compact = true } = {}) {
    await this.ready;
    return this._queueMatches(async () => {
      const accounts = this._personalAccounts();
      const protectedIds = this._protectedIds('mine.json');
      const candidates = [];
      for (const [id, m] of this.matches) {
        if (!pred(m) || protectedIds.has(id)) continue;
        if (!Array.isArray(m.players) || !m.players.length) continue;
        const players = m.players.map((p) => Number(p?.account_id));
        if (players.some((id) => !Number.isSafeInteger(id) || id <= 0 || accounts.has(id))) continue;
        candidates.push(id);
      }
      let removed = 0;
      for (let i = 0; i < candidates.length; i += 50) {
        await Promise.all(candidates.slice(i, i + 50).map(async (id) => {
          // Личный список может пополниться, пока очищается предыдущая пачка.
          if (protectedIds.has(id)) return;
          try {
            await fs.promises.unlink(path.join(this.matchDir, `${id}.json`));
          } catch (err) {
            if (err.code !== 'ENOENT') return;
          }
          this.matches.delete(id);
          removed += 1;
        }));
        if (i + 50 < candidates.length) {
          for (const id of this._protectedIds('mine.json')) protectedIds.add(id);
        }
      }
      // Записи удалённых файлов при запуске отфильтровываются по списку файлов.
      if (compact && removed && this.packOn) await this._rewritePack().catch(this._onPackError);
      return removed;
    });
  }

  prune(keepSinceTs) {
    return this.removeMatches((m) => m.start_time < keepSinceTs, { compact: false });
  }
}

module.exports = { Store, DEFAULT_SETTINGS };

