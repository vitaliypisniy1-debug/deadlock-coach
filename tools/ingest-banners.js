'use strict';
// Приём баннеров «Победа/Поражение» для героев.
// Запуск (из папки проекта):  npm run banners
// Что делает: берёт файлы из папки-приёмника (по умолчанию ..\banners-inbox рядом с папкой проекта), проверяет имя по списку героев,
// размер и прозрачность слева, при необходимости уменьшает и пересохраняет в webp, кладёт в src/renderer/assets/art/banners,
// обновляет список banners.js, пишет понятный отчёт и памятку README.txt в папке-приёмнике.
// В Git ничего не добавляет: файлы смотрит человек, потом коммит.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const heroSlug = require('../src/renderer/heroSlug.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'renderer', 'assets', 'art', 'banners');
const MANIFEST = path.join(ROOT, 'src', 'renderer', 'banners.js');
const HEROES = JSON.parse(fs.readFileSync(path.join(__dirname, 'hero-list.json'), 'utf8'));
const argv = process.argv.slice(2);
const argVal = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const INBOX = path.resolve(argVal('--inbox') || path.join(ROOT, '..', 'banners-inbox'));

const MIN_W = 1200, ASPECT_MIN = 4.5, ASPECT_MAX = 7.5, MAX_W = 1860, TARGET_BYTES = 160 * 1024, HARD_BYTES = 400 * 1024;
// принимаем имя-героя-win.webp и имя-героя-welcome-win-scene.png (так называет файлы генератор картинок)
const FILE_RE = /^(.+?)(?:-welcome)?-(win|loss)(?:-scene)?\.(webp|png)$/i;
const slugs = new Map(HEROES.map((n) => [heroSlug(n), n]));

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const closest = (s) => [...slugs.keys()].sort((x, y) => lev(s, x) - lev(s, y))[0];
const kb = (n) => `${Math.round(n / 1024)} КБ`;

function writeReadme() {
  const lines = [];
  lines.push('ПАПКА ДЛЯ БАННЕРОВ ГЕРОЕВ (Deadlock Coach)', '');
  lines.push('Сюда кладите картинки баннеров «Победа» и «Поражение» для каждого героя. Потом один раз запускаете приём, и баннеры появляются на Главной.', '');
  lines.push('КАК НАЗЫВАТЬ ФАЙЛЫ', '  имя-героя-win.webp      баннер победы', '  имя-героя-loss.webp     баннер поражения', '', 'Имя героя: английское, строчными буквами, слова через дефис (знак & убирается: Mo & Krill = mo-krill).', 'Подходят и имена от генератора: paradox-welcome-win-scene.png, haze-welcome-loss-scene.png (приём сам приведёт к нужному имени и формату).','Примеры: paradox-win.webp, paradox-loss.webp, lady-geist-win.webp, mo-krill-loss.webp, the-doorman-win.webp', '');
  lines.push('КАКОЙ ДОЛЖНА БЫТЬ КАРТИНКА', '  Формат: webp или png.', '  Размер: около 1860 x 318 (широкая полоса). Если больше, приём уменьшит сам.', '  Слева картинка должна плавно уходить в прозрачность (фигура героя справа). На тёмном фоне карточки так выглядит лучше всего.', '  Вес: до 150-200 КБ на файл (приём сам пересохранит в webp, если файл тяжелее).', '');
  lines.push('КАК ПРИНЯТЬ БАННЕРЫ', '  1. Положите файлы в эту папку.', '  2. Откройте терминал в папке проекта и выполните:  npm run banners', '  3. Приём напишет отчёт: что принято, что отклонено и почему, каких баннеров ещё нет.', '  4. Принятые файлы появятся в проекте, дальше их смотрит и коммитит сессия разработки.', '  Если баннера для героя нет, на Главной показывается обычный арт героя (с зелёным или красным акцентом по результату).', '');
  lines.push(`ПОЛНЫЙ СПИСОК: ${HEROES.length} героев, ${HEROES.length * 2} файлов`, '');
  for (const n of HEROES) lines.push(`  ${n.padEnd(16)} ${heroSlug(n)}-win.webp   ${heroSlug(n)}-loss.webp`);
  lines.push('');
  fs.mkdirSync(INBOX, { recursive: true });
  fs.writeFileSync(path.join(INBOX, 'README.txt'), lines.join('\r\n'), 'utf8');
}

function writeManifest() {
  const have = {};
  for (const f of fs.existsSync(OUT) ? fs.readdirSync(OUT) : []) {
    const m = /^(.+)-(win|loss)\.(webp|png)$/i.exec(f);
    if (!m || !slugs.has(m[1])) continue;
    (have[m[1]] ||= {})[m[2].toLowerCase()] = f;
  }
  const sorted = Object.fromEntries(Object.keys(have).sort().map((k) => [k, have[k]]));
  fs.writeFileSync(MANIFEST, `'use strict';\n// Список готовых баннеров героев. Файл создаёт tools/ingest-banners.js, вручную не править.\nwindow.HERO_BANNERS = ${JSON.stringify(sorted, null, 2)};\n`);
  return have;
}

function main() {
  if (!argVal('--inbox')) writeReadme(); // памятка пишется только в обычную папку-приёмник

  fs.mkdirSync(OUT, { recursive: true });
  const accepted = [], rejected = [], warnings = [];
  const raw = fs.readdirSync(INBOX).filter((f) => /\.(webp|png)$/i.test(f));
  const jobs = new Map();
  for (const f of raw) {
    const m = FILE_RE.exec(f);
    if (!m) { rejected.push([f, 'имя не подходит: нужно имя-героя-win.webp или имя-героя-loss.webp (подходит и имя-героя-welcome-win-scene.png)']); continue; }
    const slug = m[1].toLowerCase(), res = m[2].toLowerCase();
    if (!slugs.has(slug)) { rejected.push([f, `героя «${slug}» нет в списке; возможно, имелось в виду «${closest(slug)}»`]); continue; }
    const key = `${slug}-${res}`;
    const prev = jobs.get(key);
    const full = path.join(INBOX, f);
    if (prev) { warnings.push(`для ${key} два файла (${prev.file} и ${f}), взят более новый`); if (fs.statSync(full).mtimeMs < fs.statSync(path.join(INBOX, prev.file)).mtimeMs) continue; }
    jobs.set(key, { key, slug, res, file: f, full });
  }
  const todo = [...jobs.values()];
  if (todo.length) {
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dc-banners-'));
    const jobFile = path.join(tmpDir, 'job.json');
    const reportFile = path.join(tmpDir, 'report.json');
    fs.writeFileSync(jobFile, JSON.stringify({
      files: todo.map((j) => ({ name: j.key, url: 'file:///' + j.full.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:') })),
      maxWidth: MAX_W, targetBytes: TARGET_BYTES, tmpDir: path.join(tmpDir, 'out'), reportFile,
    }));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    try { execFileSync(require('electron'), [path.join(__dirname, 'ingest-banners-worker.js'), jobFile], { env, timeout: 900000, stdio: 'ignore' }); } catch (e) { /* отчёт проверим ниже */ }
    const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : { fatal: 'рабочая часть не запустилась' };
    if (report.fatal) { console.log('ОШИБКА приёма:', report.fatal); process.exit(1); }
    for (const r of report) {
      const j = jobs.get(r.name);
      if (!r.ok) { rejected.push([j.file, `не удалось прочитать картинку (${r.error})`]); continue; }
      const aspect = r.w / r.h;
      if (r.w < MIN_W) { rejected.push([j.file, `слишком маленькая: ${r.w}x${r.h}, нужна ширина от ${MIN_W} px`]); continue; }
      if (aspect < ASPECT_MIN || aspect > ASPECT_MAX) { rejected.push([j.file, `не та пропорция: ${r.w}x${r.h}, нужна широкая полоса примерно 1860x318`]); continue; }
      if (!r.hasAlpha) { rejected.push([j.file, 'нет прозрачности: слева картинка должна уходить в прозрачность (сохраните png или webp с прозрачным фоном)']); continue; }
      if (r.bytes > HARD_BYTES) { rejected.push([j.file, `слишком тяжёлая даже после сжатия (${kb(r.bytes)}), уменьшите размер или упростите картинку`]); continue; }
      if (r.leftAlpha > 0.85) warnings.push(`${j.file}: слева картинка почти непрозрачная, плавного затухания нет (текст на карточке может хуже читаться)`);
      if (r.rightAlpha < 0.5) warnings.push(`${j.file}: справа много прозрачного, возможно, фигура героя не там`);
      for (const old of fs.readdirSync(OUT)) if (old.startsWith(`${j.key}.`)) fs.unlinkSync(path.join(OUT, old));
      fs.copyFileSync(path.join(tmpDir, 'out', `${j.key}.webp`), path.join(OUT, `${j.key}.webp`));
      accepted.push([j.file, `${j.key}.webp`, `${r.W}x${r.H}`, kb(r.bytes)]);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  const have = writeManifest();
  const missing = [];
  for (const n of HEROES) { const s = heroSlug(n); for (const res of ['win', 'loss']) if (!(have[s] && have[s][res])) missing.push(`${s}-${res}`); }
  const total = fs.readdirSync(OUT).reduce((sum, f) => sum + fs.statSync(path.join(OUT, f)).size, 0);

  console.log(`Папка-приёмник: ${INBOX}`);
  console.log(`\nПРИНЯТО (${accepted.length}):`); for (const a of accepted) console.log(`  ${a[0]} -> ${a[1]}  ${a[2]}, ${a[3]}`);
  console.log(`\nОТКЛОНЕНО (${rejected.length}):`); for (const r of rejected) console.log(`  ${r[0]}: ${r[1]}`);
  if (warnings.length) { console.log(`\nЗАМЕЧАНИЯ (${warnings.length}):`); for (const w of warnings) console.log(`  ${w}`); }
  console.log(`\nГОТОВО в проекте: ${HEROES.length * 2 - missing.length} из ${HEROES.length * 2} баннеров, общий вес ${kb(total)}.`);
  if (missing.length) { console.log(`ЕЩЁ НЕТ (${missing.length}): ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ' ...' : ''}`); console.log('(полный список с точными именами файлов: README.txt в папке-приёмнике)'); }
  console.log('\nВ Git ничего не добавлено: файлы смотрит человек, потом коммит.');
}
main();
