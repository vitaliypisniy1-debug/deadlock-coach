'use strict';
// Приём мини-портретов героев (квадратные картинки для списков на Главной).
// Запуск (из папки проекта):  npm run portraits -- --inbox "путь к папке с картинками"
// Без --inbox берётся папка ..\portraits-inbox рядом с папкой проекта.
// Что делает: берёт файлы имя-героя.png (или .webp), сверяет имя со списком героев, проверяет размер и пропорцию,
// уменьшает и пересохраняет в webp, кладёт в src/renderer/assets/art/portraits и обновляет список portraits.js.
// Список построен по ID героя (ID и имена — из src/core/data/codexData.json), интерфейс выбирает портрет по ID.
// В Git ничего не добавляет: файлы смотрит человек, потом коммит.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const heroSlug = require('../src/renderer/heroSlug.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'renderer', 'assets', 'art', 'portraits');
const MANIFEST = path.join(ROOT, 'src', 'renderer', 'portraits.js');
const HEROES = Object.values(require('../src/core/data/codexData.json').heroes).map((h) => ({ id: Number(h.id), name: h.name, slug: heroSlug(h.name) }));
const bySlug = new Map(HEROES.map((h) => [h.slug, h]));
const argv = process.argv.slice(2);
const argVal = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const INBOX = path.resolve(argVal('--inbox') || path.join(ROOT, '..', 'portraits-inbox'));

const MIN_SIDE = 96, MAX_W = 192, TARGET_BYTES = 14 * 1024, HARD_BYTES = 60 * 1024, ASPECT_MIN = 0.8, ASPECT_MAX = 1.25;
const kb = (n) => `${Math.round(n / 1024)} КБ`;

function writeManifest() {
  const have = {};
  for (const f of fs.existsSync(OUT) ? fs.readdirSync(OUT) : []) {
    const m = /^(.+)\.(webp|png)$/i.exec(f);
    const hero = m && bySlug.get(m[1]);
    if (hero) have[hero.id] = f;
  }
  const sorted = Object.fromEntries(Object.keys(have).map(Number).sort((a, b) => a - b).map((id) => [id, have[id]]));
  fs.writeFileSync(MANIFEST, `'use strict';\n// Мини-портреты героев по ID героя. Файл создаёт tools/ingest-portraits.js, вручную не править.\n(function (root) { root.HERO_PORTRAITS = ${JSON.stringify(sorted, null, 2)}; })(typeof window !== 'undefined' ? window : globalThis);\n`);
  return have;
}

function main() {
  if (!fs.existsSync(INBOX)) { console.log(`Папка с портретами не найдена: ${INBOX}`); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const accepted = [], rejected = [];
  const jobs = new Map();
  for (const f of fs.readdirSync(INBOX).filter((x) => /\.(webp|png)$/i.test(x))) {
    const slug = f.replace(/\.(webp|png)$/i, '').toLowerCase();
    if (!bySlug.has(slug)) { rejected.push([f, `героя «${slug}» нет в списке (имя файла: английское имя строчными буквами через дефис, например mo-krill.png)`]); continue; }
    jobs.set(slug, { slug, file: f, full: path.join(INBOX, f) });
  }
  const todo = [...jobs.values()];
  if (todo.length) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-portraits-'));
    const jobFile = path.join(tmpDir, 'job.json');
    const reportFile = path.join(tmpDir, 'report.json');
    fs.writeFileSync(jobFile, JSON.stringify({
      files: todo.map((j) => ({ name: j.slug, url: 'file:///' + j.full.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:') })),
      maxWidth: MAX_W, targetBytes: TARGET_BYTES, tmpDir: path.join(tmpDir, 'out'), reportFile,
    }));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    try { execFileSync(require('electron'), [path.join(__dirname, 'ingest-banners-worker.js'), jobFile], { env, timeout: 600000, stdio: 'ignore' }); } catch (e) { /* отчёт проверим ниже */ }
    const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : { fatal: 'рабочая часть не запустилась' };
    if (report.fatal) { console.log('ОШИБКА приёма:', report.fatal); process.exit(1); }
    for (const r of report) {
      const j = jobs.get(r.name);
      if (!r.ok) { rejected.push([j.file, `не удалось прочитать картинку (${r.error})`]); continue; }
      const aspect = r.w / r.h;
      if (Math.min(r.w, r.h) < MIN_SIDE) { rejected.push([j.file, `слишком маленькая: ${r.w}x${r.h}, нужна сторона от ${MIN_SIDE} px`]); continue; }
      if (aspect < ASPECT_MIN || aspect > ASPECT_MAX) { rejected.push([j.file, `не та пропорция: ${r.w}x${r.h}, нужен квадрат или близко к нему`]); continue; }
      if (r.bytes > HARD_BYTES) { rejected.push([j.file, `слишком тяжёлая даже после сжатия (${kb(r.bytes)})`]); continue; }
      for (const old of fs.readdirSync(OUT)) if (old.replace(/\.(webp|png)$/i, '') === j.slug) fs.unlinkSync(path.join(OUT, old));
      fs.copyFileSync(path.join(tmpDir, 'out', `${j.slug}.webp`), path.join(OUT, `${j.slug}.webp`));
      accepted.push([j.file, `${j.slug}.webp`, `${r.W}x${r.H}`, kb(r.bytes)]);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  const have = writeManifest();
  const missing = HEROES.filter((h) => !have[h.id]).map((h) => h.slug);
  const total = fs.readdirSync(OUT).reduce((sum, f) => sum + fs.statSync(path.join(OUT, f)).size, 0);

  console.log(`Папка с портретами: ${INBOX}`);
  console.log(`\nПРИНЯТО (${accepted.length}):`); for (const a of accepted) console.log(`  ${a[0]} -> ${a[1]}  ${a[2]}, ${a[3]}`);
  console.log(`\nОТКЛОНЕНО (${rejected.length}):`); for (const r of rejected) console.log(`  ${r[0]}: ${r[1]}`);
  console.log(`\nГОТОВО в проекте: ${HEROES.length - missing.length} из ${HEROES.length} портретов, общий вес ${kb(total)}.`);
  if (missing.length) console.log(`ЕЩЁ НЕТ (${missing.length}): ${missing.join(', ')}`);
  console.log('\nВ Git ничего не добавлено: файлы смотрит человек, потом коммит.');
}
main();
