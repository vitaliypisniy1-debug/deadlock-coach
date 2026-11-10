'use strict';
// Локальное хранилище в папке данных приложения (%APPDATA%/deadlock-coach).
// Обычные JSON-файлы: их легко посмотреть или удалить руками.

const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  region: 'Europe',
  topN: 50,
  days: 3,
  onlyRanked: false,
  apiKey: '',
  benchmarkSource: 'top', // 'top' — только игроки топ-50, 'lobby' — все игроки в их матчах
  winsOnly: false,
  autoRefreshHours: 3,
  keepDays: 14,
  manualTop: '',
  topSource: 'auto', // auto (ладдер текущего сезона) | list
  overlayKey: 'Ctrl+Shift+D', // горячая клавиша оверлея «Пик против состава»
  pickPool: null, // свои герои для совета по пику; null — герои с 15+ победами
  gameMode: true, // пока идёт Deadlock — фоновые загрузки ждут, оверлей работает
  autoRecognize: true, // узнавать состав по портретам (пауза перед игрой и горячая клавиша)
  overlayAutoHide: true, // прятать оверлей через несколько секунд после начала игры
  autoUpdateCheck: true, // проверять обновления на GitHub при запуске
  skippedVersion: null, // версия, которую попросили не предлагать
};

class Store {
  // lazy: матчи читаются с диска в фоне (тысячи файлов на Windows — это секунды, окно не должно
  // на это время замирать). Тогда перед работой с матчами нужно дождаться store.ready.
  constructor(dir, { lazy = false } = {}) {
    this.dir = dir;
    this.matchDir = path.join(dir, 'matches');
    fs.mkdirSync(this.matchDir, { recursive: true });
    this.matches = new Map();
    this.loadInfo = { files: 0, ms: 0 };
    this.packFile = path.join(dir, 'matches.pack');
    this.packOn = false;
    this._packQ = Promise.resolve();
    this._putEarly = null;
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
    this._putEarly = new Set(); // сохранённые, пока шла загрузка, — их не затираем старыми
    let names = [];
    try {
      names = (await fs.promises.readdir(this.matchDir)).filter((f) => f.endsWith('.json'));
    } catch {}
    const onDisk = new Set(names.map((f) => Number(f.slice(0, -5))));
    const packed = new Set();
    let lines = 0;
    try {
      const text = await fs.promises.readFile(this.packFile, 'utf8');
      let pos = 0;
      while (pos < text.length) {
        for (let k = 0; k < 150 && pos < text.length; k++) {
          let end = text.indexOf('\n', pos);
          if (end < 0) end = text.length;
          const line = text.slice(pos, end);
          pos = end + 1;
          if (!line) continue;
          lines += 1;
          try {
            const m = JSON.parse(line);
            if (m && m.match_id && onDisk.has(m.match_id) && !this._putEarly.has(m.match_id)) {
              this.matches.set(m.match_id, m); // более поздняя строка новее
              packed.add(m.match_id);
            }
          } catch {} // оборванная строка — возьмём матч из отдельного файла
        }
        await tick();
      }
    } catch {}
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
    this._putEarly = null;
    this.packOn = true;
    // общий файл устарел (много лишних строк или матчей вне его) — пересобираем в фоне
    if (rest.length > 0 || lines > packed.size * 1.3 + 50) this._packQ = this._packQ.then(() => this._rewritePack()).catch(() => {});
  }

  async _rewritePack() {
    const tmp = this.packFile + '.tmp';
    const out = fs.createWriteStream(tmp);
    const all = [...this.matches.values()];
    for (let i = 0; i < all.length; i += 100) {
      const chunk = all.slice(i, i + 100).map((m) => JSON.stringify(m)).join('\n') + '\n';
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      await new Promise((r) => setImmediate(r));
    }
    await new Promise((r, rej) => {
      out.on('error', rej);
      out.end(r);
    });
    await fs.promises.rename(tmp, this.packFile);
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

  settings() {
    return { ...DEFAULT_SETTINGS, ...this.read('settings.json', {}) };
  }

  saveSettings(patch) {
    const next = { ...this.settings(), ...patch };
    next.topN = Math.max(5, Math.min(200, Number(next.topN) || 50));
    next.days = Math.max(1, Math.min(14, Number(next.days) || 3));
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

  putMatch(m) {
    this.matches.set(m.match_id, m);
    const text = JSON.stringify(m);
    fs.writeFileSync(path.join(this.matchDir, `${m.match_id}.json`), text);
    if (this._putEarly) this._putEarly.add(m.match_id);
    // дописываем в общий файл (если он ведётся) — по очереди, не мешая окну
    if (this.packOn || this._putEarly) this._packQ = this._packQ.then(() => fs.promises.appendFile(this.packFile, text + '\n')).catch(() => {});
  }

  allMatches() {
    return [...this.matches.values()];
  }

  // Удаляет старые матчи топов, но никогда — твои собственные.
  prune(keepSinceTs, protectedIds = new Set()) {
    let removed = 0;
    for (const [id, m] of this.matches) {
      if (m.start_time < keepSinceTs && !protectedIds.has(id)) {
        this.matches.delete(id);
        try {
          fs.unlinkSync(path.join(this.matchDir, `${id}.json`));
        } catch {}
        removed += 1;
      }
    }
    return removed;
  }
}

module.exports = { Store, DEFAULT_SETTINGS };
