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
  autoRecognize: true, // узнавать состав по портретам (пауза перед игрой и горячая клавиша)
  overlayAutoHide: true, // прятать оверлей через несколько секунд после начала игры
  autoUpdateCheck: true, // проверять обновления на GitHub при запуске
  skippedVersion: null, // версия, которую попросили не предлагать
};

class Store {
  constructor(dir) {
    this.dir = dir;
    this.matchDir = path.join(dir, 'matches');
    fs.mkdirSync(this.matchDir, { recursive: true });
    this.matches = new Map();
    this._loadMatches();
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
    fs.writeFileSync(path.join(this.matchDir, `${m.match_id}.json`), JSON.stringify(m));
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
