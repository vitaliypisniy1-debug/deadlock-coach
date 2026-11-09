'use strict';
// Скачивает саму программу Electron (electron.exe) в node_modules/electron/dist.
// Обычно это делает установочный скрипт пакета electron, но новые версии npm
// его не запускают, а на некоторых системах он молча ничего не делает.
// Здесь всё то же самое, только с понятным выводом и запасными адресами.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'node_modules', 'electron');
const dist = path.join(dir, 'dist');

function fail(text) {
  console.error('\n[ОШИБКА] ' + text);
  process.exit(1);
}

if (!fs.existsSync(path.join(dir, 'package.json'))) fail('Нет папки node_modules/electron — сначала нужна команда npm install.');
const version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
const platform = process.env.npm_config_platform || process.platform;
const arch = process.env.npm_config_arch || process.arch;
const exeName = platform === 'win32' ? 'electron.exe' : platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';

// Пакет electron находит программу по файлу path.txt.
function writeMeta() {
  fs.writeFileSync(path.join(dir, 'path.txt'), exeName);
}

if (fs.existsSync(path.join(dist, exeName))) {
  writeMeta();
  console.log(`Electron ${version} уже установлен.`);
  process.exit(0);
}

const file = `electron-v${version}-${platform}-${arch}.zip`;
const urls = [];
if (process.env.ELECTRON_MIRROR) {
  const custom = (process.env.ELECTRON_CUSTOM_DIR || 'v{{ version }}').replace(/\{\{\s*version\s*\}\}/g, version);
  urls.push(process.env.ELECTRON_MIRROR.replace(/\/?$/, '/') + custom + '/' + file);
}
urls.push(`https://github.com/electron/electron/releases/download/v${version}/${file}`);
urls.push(`https://cdn.npmmirror.com/binaries/electron/${version}/${file}`);

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('http:') ? http : https;
    const req = lib.get(url, { headers: { 'User-Agent': 'DeadlockCoach/1.0' }, timeout: 30000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects > 8) return reject(new Error('слишком много перенаправлений'));
        return resolve(download(new URL(res.headers.location, url).toString(), dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`сервер ответил ${res.statusCode}`));
      }
      const total = Number(res.headers['content-length']) || 0;
      let got = 0;
      let lastPct = -1;
      const out = fs.createWriteStream(dest);
      res.on('data', (chunk) => {
        got += chunk.length;
        const pct = total ? Math.floor((got / total) * 100) : -1;
        if (pct !== lastPct && (pct % 5 === 0 || pct === 100)) {
          lastPct = pct;
          process.stdout.write(`\r  скачано ${Math.round(got / 1048576)} МБ${total ? ` из ${Math.round(total / 1048576)} МБ (${pct}%)` : ''}   `);
        }
      });
      res.pipe(out);
      out.on('finish', () => out.close(() => {
        process.stdout.write('\n');
        if (total && got < total) return reject(new Error('загрузка оборвалась'));
        resolve();
      }));
      out.on('error', reject);
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('нет ответа 30 секунд')));
    req.on('error', reject);
  });
}

function extract(zip, to) {
  fs.mkdirSync(to, { recursive: true });
  const attempts = platform === 'win32'
    ? [
        ['tar', ['-xf', zip, '-C', to]],
        ['powershell', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${to.replace(/'/g, "''")}' -Force`]],
      ]
    : [['unzip', ['-oq', zip, '-d', to]], ['tar', ['-xf', zip, '-C', to]]];
  const errors = [];
  for (const [cmd, args] of attempts) {
    try {
      execFileSync(cmd, args, { stdio: 'inherit' });
      if (fs.existsSync(path.join(to, exeName))) return;
      errors.push(`${cmd}: после распаковки нет ${exeName}`);
    } catch (e) {
      errors.push(`${cmd}: ${e.message}`);
    }
  }
  throw new Error('не удалось распаковать архив (' + errors.join('; ') + ')');
}

(async () => {
  console.log(`Скачиваю Electron ${version} (${platform}-${arch}), около 100 МБ...`);
  const tmp = path.join(os.tmpdir(), `dc-${file}`);
  let ok = false;
  const errors = [];
  for (const url of urls) {
    console.log('  адрес: ' + url);
    try {
      await download(url, tmp);
      ok = true;
      break;
    } catch (e) {
      errors.push(`${new URL(url).host}: ${e.message}`);
      console.log(`  не вышло: ${e.message}`);
    }
  }
  if (!ok) fail('Не удалось скачать Electron. ' + errors.join('; ') + '. Проверь интернет, VPN или антивирус и запусти снова.');
  console.log('Распаковываю...');
  try {
    if (fs.existsSync(dist)) fs.rmSync(dist, { recursive: true, force: true });
    extract(tmp, dist);
  } catch (e) {
    fail(e.message);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
  writeMeta();
  console.log(`Готово: Electron ${version} установлен.`);
})().catch((e) => fail(e.stack || e.message));
