'use strict';
// Проверка лога консоли Deadlock: пишет ли игра, какие герои в матче.
// Игра пишет лог в game/citadel/console.log, только если в параметрах запуска
// Steam добавлен -condebug. Мы ничего не трогаем в игре — только читаем файл.

const fs = require('fs');
const path = require('path');
const { findSteamDir } = require('./steamCache');

function libraryDirs(steamDir) {
  const out = [steamDir];
  try {
    const vdf = fs.readFileSync(path.join(steamDir, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) out.push(m[1].replace(/\\\\/g, '\\'));
  } catch {}
  return [...new Set(out)];
}

async function findDeadlockDir(customSteam) {
  const steam = await findSteamDir(customSteam);
  if (!steam) return { steamDir: null, gameDir: null };
  for (const lib of libraryDirs(steam)) {
    const dir = path.join(lib, 'steamapps', 'common', 'Deadlock');
    if (fs.existsSync(path.join(dir, 'game'))) return { steamDir: steam, gameDir: dir };
  }
  return { steamDir: steam, gameDir: null };
}

function tail(file, bytes) {
  const st = fs.statSync(file);
  const fd = fs.openSync(file, 'r');
  try {
    const len = Math.min(bytes, st.size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// heroes: [{ id, name, cls }] — ищем упоминания героев в последних строках лога.
async function checkConsoleLog({ steamDir = null, heroes = [], bytes = 3 * 1024 * 1024 } = {}) {
  const { steamDir: steam, gameDir } = await findDeadlockDir(steamDir);
  if (!gameDir) return { found: false, steamDir: steam, reason: 'Не нашёл папку игры Deadlock в библиотеках Steam.' };
  const file = path.join(gameDir, 'game', 'citadel', 'console.log');
  if (!fs.existsSync(file)) return { found: false, gameDir, file, reason: 'Файла console.log нет — в параметрах запуска игры не добавлен -condebug.' };
  const st = fs.statSync(file);
  const text = tail(file, bytes);
  const lines = text.split(/\r?\n/);
  const keys = heroes
    .filter((h) => h.cls || h.name)
    .map((h) => ({ id: h.id, name: h.name, re: new RegExp(`\\b(${[h.cls, h.cls && h.cls.replace(/^hero_/, 'npc_dota_hero_')].filter(Boolean).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i') }))
    .filter((k) => k.re.source !== '\\b()\\b');
  const counts = new Map();
  const samples = [];
  lines.forEach((line, i) => {
    for (const k of keys) {
      if (k.re.test(line)) {
        counts.set(k.id, (counts.get(k.id) || 0) + 1);
        if (samples.length < 25) samples.push({ n: i, text: line.slice(0, 220) });
      }
    }
  });
  return {
    found: true,
    file,
    size: st.size,
    modified: st.mtimeMs,
    lines: lines.length,
    heroes: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, n })),
    samples,
    last: lines.slice(-15).map((l) => l.slice(0, 220)),
  };
}

module.exports = { checkConsoleLog, findDeadlockDir };
