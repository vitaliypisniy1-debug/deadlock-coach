'use strict';
// Обновления через GitHub Releases, без сторонних библиотек.
// 1) Спрашиваем у GitHub последний релиз репозитория (updateRepo в package.json —
//    его вписывает сборка на GitHub Actions).
// 2) Если версия новее — показываем «что нового» и по кнопке скачиваем установщик.
// 3) Запускаем установщик в тихом режиме (/S) с --force-run: он ставит новую версию
//    поверх и снова открывает программу. Данные (вход, матчи, мета) не трогаются.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

// Сравнение версий вида 0.9.0 / v1.2.3 / 1.0.0-beta.1
function parseVersion(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || null };
}

function isNewer(remote, local) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a.nums[i] !== b.nums[i]) return a.nums[i] > b.nums[i];
  }
  // 1.0.0 новее, чем 1.0.0-beta; две предварительные — по строке
  if (a.pre && !b.pre) return false;
  if (!a.pre && b.pre) return true;
  if (a.pre && b.pre) return a.pre > b.pre;
  return false;
}

// Из ответа GitHub — то, что нужно программе.
function pickRelease(rel) {
  if (!rel || rel.draft) return null;
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  const setup = assets.find((a) => /setup.*\.exe$/i.test(a.name)) || null;
  const portable = assets.find((a) => /portable.*\.exe$/i.test(a.name)) || null;
  return {
    version: String(rel.tag_name || rel.name || '').replace(/^v/i, ''),
    name: rel.name || rel.tag_name || '',
    notes: String(rel.body || '').trim(),
    page: rel.html_url || null,
    published: rel.published_at || null,
    prerelease: !!rel.prerelease,
    setup: setup ? { name: setup.name, url: setup.browser_download_url, size: setup.size || 0, digest: setup.digest || null } : null,
    portable: portable ? { name: portable.name, url: portable.browser_download_url, size: portable.size || 0 } : null,
  };
}

class Updater {
  constructor({ app, repo, emit = () => {}, fetchImpl = globalThis.fetch }) {
    this.app = app;
    this.repo = repo || '';
    this.emit = emit;
    this.fetch = fetchImpl;
    this.latest = null;
    this.file = null;
    this.downloading = null;
  }

  // Как запущена программа: установленная, переносная или из исходников (start.bat).
  mode() {
    if (!this.app.isPackaged) return 'dev';
    if (process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE) return 'portable';
    return 'installed';
  }

  async check() {
    const current = this.app.getVersion();
    const mode = this.mode();
    if (!this.repo) {
      return { current, mode, configured: false, available: false, reason: 'Обновления работают в версии, собранной на GitHub. Эта копия запущена из исходников.' };
    }
    const res = await this.fetch(`https://api.github.com/repos/${this.repo}/releases/latest`, {
      headers: { 'User-Agent': 'DeadlockCoach/1.0', Accept: 'application/vnd.github+json' },
    });
    if (res.status === 404) return { current, mode, configured: true, available: false, reason: 'Релизов пока нет.' };
    if (!res.ok) throw new Error(`GitHub ответил ${res.status}`);
    const rel = pickRelease(await res.json());
    this.latest = rel;
    const available = !!(rel && isNewer(rel.version, current));
    return { current, mode, configured: true, available, release: rel, repo: this.repo };
  }

  async download() {
    if (this.downloading) return this.downloading;
    const rel = this.latest;
    if (!rel || !rel.setup) throw new Error('В релизе нет установщика — подожди, пока GitHub его соберёт (обычно 5–10 минут после публикации).');
    const digestMatch = String(rel.setup.digest || '').match(/^sha256:([a-f0-9]{64})$/i);
    if (!digestMatch) throw new Error('GitHub не предоставил SHA-256 установщика. Обновление остановлено; скачай новую версию со страницы релиза вручную.');
    const expectedDigest = digestMatch[1].toLowerCase();
    this.file = null;
    this.downloading = (async () => {
      const dest = path.join(os.tmpdir(), `DeadlockCoach-Setup-${rel.version}.exe`);
      const res = await this.fetch(rel.setup.url, { headers: { 'User-Agent': 'DeadlockCoach/1.0' }, redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`Не удалось скачать установщик: ${res.status}`);
      const total = Number(res.headers.get('content-length')) || rel.setup.size || 0;
      const out = fs.createWriteStream(dest);
      let got = 0;
      const hash = crypto.createHash('sha256');
      let lastPct = -1;
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value.length;
          hash.update(value);
          if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
          const pct = total ? Math.floor((got / total) * 100) : -1;
          if (pct !== lastPct) {
            lastPct = pct;
            this.emit('update:progress', { got, total, pct });
          }
        }
      } finally {
        await new Promise((r) => out.end(r));
      }
      if (rel.setup.size && got !== rel.setup.size) {
        try { fs.unlinkSync(dest); } catch {}
        throw new Error('Установщик скачался не полностью — попробуй ещё раз.');
      }
      const actualDigest = hash.digest('hex');
      if (actualDigest !== expectedDigest) {
        try { fs.unlinkSync(dest); } catch {}
        throw new Error('SHA-256 установщика не совпал с GitHub. Файл удалён и запуск заблокирован. Попробуй скачать обновление ещё раз.');
      }
      this.file = dest;
      return { file: dest, size: got };
    })();
    try {
      return await this.downloading;
    } finally {
      this.downloading = null;
    }
  }

  // Тихая установка поверх и перезапуск программы.
  install() {
    if (!this.file || !fs.existsSync(this.file)) throw new Error('Сначала скачай обновление');
    const child = spawn(this.file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    setTimeout(() => this.app.quit(), 300);
    return true;
  }
}

module.exports = { Updater, isNewer, parseVersion, pickRelease };
