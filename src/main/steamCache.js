'use strict';
// Находит твои матчи в кэше Steam и отправляет "соль" матчей в deadlock-api,
// чтобы сервис смог скачать их метаданные (так же делает официальная утилита).
// Матч попадает в кэш, когда ты открываешь его в истории матчей в игре
// или видишь экран после матча.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { parseReplayUrls, toSaltRecords } = require('./steamCacheParse');

function regQuery(key, value) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    execFile('reg', ['query', key, '/v', value], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const m = String(stdout).match(/REG_\w+\s+(.+)\s*$/m);
      resolve(m ? m[1].trim() : null);
    });
  });
}

async function findSteamDir(custom) {
  const candidates = [];
  if (custom) candidates.push(custom);
  const reg = (await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath')) || (await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'));
  if (reg) candidates.push(reg.replace(/\//g, path.sep));
  candidates.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam', path.join(os.homedir(), '.steam', 'steam'), path.join(os.homedir(), '.local', 'share', 'Steam'));
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'appcache', 'httpcache'))) return c;
  }
  return null;
}

function walk(dir, out, limit = 200000) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= limit) return;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, limit);
    else if (e.isFile()) out.push(p);
  }
}

// Читаем начало файла (адрес запроса обычно в заголовке записи кэша),
// а небольшие файлы — целиком: у части записей адрес лежит дальше.
function readHead(file, bytes = 1024) {
  try {
    const size = fs.statSync(file).size;
    if (size <= 256 * 1024) return fs.readFileSync(file).toString('latin1');
  } catch {
    return '';
  }
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('latin1');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

async function scanCache({ steamDir, sinceMs = Date.now() - 45 * 86400e3 } = {}) {
  const dir = await findSteamDir(steamDir);
  if (!dir) return { steamDir: null, records: [] };
  const files = [];
  walk(path.join(dir, 'appcache', 'httpcache'), files);
  const found = [];
  for (const f of files) {
    if (sinceMs) {
      try {
        if (fs.statSync(f).mtimeMs < sinceMs) continue;
      } catch {
        continue;
      }
    }
    const head = readHead(f, 16384);
    if (!head.includes('1422450')) continue;
    found.push(...parseReplayUrls(head));
  }
  return { steamDir: dir, records: toSaltRecords(found) };
}

module.exports = { scanCache, findSteamDir };
