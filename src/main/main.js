'use strict';
const { app, BrowserWindow, ipcMain, shell, clipboard, nativeTheme, dialog, globalShortcut, screen, desktopCapturer, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { checkConsoleLog, findDeadlockDir } = require('./gameLog');
const { Recognizer } = require('./recognizer');
const { GameWatch, consoleLogPath } = require('./gameWatch');
const { GameMode } = require('./gameMode');
let recognizer = null;
let watch = null;
let gameMode = null;
let autoPending = false; // фоновое обновление пришлось на игру — сделаем после неё
const { Updater } = require('./updater');
let updater = null;

// Папка с данными. Раньше она называлась «deadlock-coach»; чтобы после обновления
// не пропали вход, матчи и мета, продолжаем пользоваться ею, если она уже есть.
try {
  const legacy = path.join(app.getPath('appData'), 'deadlock-coach');
  if (fs.existsSync(path.join(legacy, 'data'))) app.setPath('userData', legacy);
} catch {}

// Ошибки при запуске записываем в файл и показываем, а не закрываемся молча.
// Монитор зависаний: если главный поток не отвечал дольше 1,5 с, пишем в lag.log,
// сколько длилось и какой запрос окна выполнялся последним. Нужен, чтобы найти причину подвисаний.
let lastIpc = '';
let lagTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const lag = now - lagTick - 500;
  lagTick = now;
  if (lag > 1500) {
    try {
      const file = path.join(app.getPath('userData'), 'lag.log');
      if (fs.existsSync(file) && fs.statSync(file).size > 200e3) fs.unlinkSync(file);
      fs.appendFileSync(file, `${new Date().toISOString()} завис на ${(lag / 1000).toFixed(1)} с; последний запрос: ${lastIpc || '—'}; память ${Math.round(process.memoryUsage().rss / 1e6)} МБ\n`);
    } catch {}
  }
}, 500).unref();

// Запросы окна, которым сохранённые матчи не нужны, — отвечают сразу.
const NO_MATCHES = new Set(['app:init', 'auth:login', 'auth:manual', 'auth:logout', 'status:get', 'top:list', 'shell:open', 'game:mode', 'rec:run', 'rec:learn', 'rec:forget', 'rec:status',
  'overlay:toggle', 'overlay:key', 'game:logCheck', 'update:check', 'update:download', 'update:install', 'update:skip', 'clipboard:write', 'lag:get']);

function slowLog(text) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'lag.log'), `${new Date().toISOString()} ${text}\n`);
  } catch {}
}

function logCrash(where, e) {
  const text = `[${new Date().toISOString()}] ${where}: ${(e && e.stack) || e}\n`;
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.appendFileSync(path.join(app.getPath('userData'), 'crash.log'), text);
  } catch {}
  console.error(text);
  return text;
}
let started = false;
function fatal(where, e) {
  const text = logCrash(where, e);
  if (!started) {
    try {
      dialog.showErrorBox('Deadlock Coach не запустился', `${text}\nЭтот текст сохранён в файл:\n${path.join(app.getPath('userData'), 'crash.log')}`);
    } catch {}
  }
}
const { Api } = require('./api');
const { Store } = require('./store');
const { Sync } = require('./sync');
const { loginWithSteam } = require('./steamAuth');
const { scanCache } = require('./steamCache');
const { parseSteamInput, vanityOf, resolveVanity } = require('./steamIds');

let win = null;
let store;
let api;
let sync;
let autoTimer = null;

function emit(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send(channel, payload);
}

// ---------- оверлей «Пик против состава» ----------
// Отдельное прозрачное окно поверх игры. Игру не трогает: не читает память и
// не меняет файлы. Видно поверх игры в режиме «В окне без рамки».
let overlay = null;
let overlayKey = null;

function createOverlay() {
  if (overlay && !overlay.isDestroyed()) return overlay;
  const area = screen.getPrimaryDisplay().workArea;
  const saved = store ? store.read('overlay.json', null) : null;
  const w = Math.min(1060, area.width - 40);
  const h = Math.min(640, area.height - 40);
  overlay = new BrowserWindow({
    x: saved && Number.isFinite(saved.x) ? saved.x : Math.round(area.x + (area.width - w) / 2),
    y: saved && Number.isFinite(saved.y) ? saved.y : Math.round(area.y + area.height * 0.17), // ниже верхней панели с портретами
    width: saved && saved.width ? saved.width : w,
    height: saved && saved.height ? saved.height : h,
    minWidth: 720,
    minHeight: 420,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    title: 'Deadlock Coach — пик',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
  const save = () => {
    if (overlay && !overlay.isDestroyed() && store) store.write('overlay.json', overlay.getBounds());
  };
  overlay.on('moved', save);
  overlay.on('resized', save);
  overlay.on('closed', () => {
    overlay = null;
  });
  return overlay;
}

function showOverlay({ focus = true } = {}) {
  const o = createOverlay();
  const go = () => {
    if (focus) {
      o.show();
      o.focus();
    } else o.showInactive(); // не забираем фокус у игры
    o.webContents.send('overlay:shown');
  };
  if (o.webContents.isLoading()) o.webContents.once('did-finish-load', go);
  else go();
  return o;
}

function sendToOverlay(channel, payload) {
  const o = createOverlay();
  const send = () => o.webContents.send(channel, payload);
  if (o.webContents.isLoading()) o.webContents.once('did-finish-load', send);
  else send();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Снимок экрана и распознавание. Оверлей на время снимка прячем, чтобы он не закрыл портреты.
let recognizing = null;
async function runRecognition({ retries = 0, focus = true, reason = 'manual' } = {}) {
  if (recognizing) return recognizing;
  recognizing = (async () => {
    const o = overlay && !overlay.isDestroyed() ? overlay : null;
    const wasVisible = !!(o && o.isVisible());
    if (wasVisible) {
      o.hide();
      await wait(250);
    }
    let best = null;
    let lastN = -1;
    for (let i = 0; i <= retries; i++) {
      try {
        lastIpc = `распознавание портретов (${reason})`;
        const r = await recognizer.recognize();
        if (!best || (r.ok && (!best.ok || r.slots.length > best.slots.length))) best = r;
        if (r.ok && r.slots.length >= 12) break; // все 12 на месте
        // два раза подряд одно и то же — дальше снимать экран незачем
        const n = r.ok ? r.slots.length : 0;
        if (i > 0 && n === lastN) break;
        lastN = n;
      } catch (e) {
        best = best || { ok: false, reason: `Ошибка распознавания: ${e.message}` };
      }
      if (i < retries) await wait(2000);
    }
    best.reason2 = reason;
    sendToOverlay('overlay:recognized', best);
    if (wasVisible || reason !== 'hotkey-silent') showOverlay({ focus });
    return best;
  })();
  try {
    return await recognizing;
  } finally {
    recognizing = null;
  }
}

function toggleOverlay(force = null) {
  const o = createOverlay();
  const show = force === null ? !o.isVisible() : force;
  if (!show) {
    o.hide();
    return;
  }
  const st = store.settings();
  const fresh = recognizer && recognizer.last && Date.now() - recognizer.last.out.at < 90e3;
  if (st.autoRecognize !== false && recognizer && !fresh) {
    runRecognition({ reason: 'hotkey' }).catch(() => showOverlay());
  } else showOverlay();
}

function registerOverlayKey(key) {
  try {
    if (overlayKey) globalShortcut.unregister(overlayKey);
  } catch {}
  overlayKey = null;
  if (!key) return { ok: true, key: null };
  try {
    const ok = globalShortcut.register(key, () => toggleOverlay());
    if (ok) overlayKey = key;
    return { ok, key: ok ? key : null };
  } catch (e) {
    return { ok: false, key: null, error: e.message };
  }
}

// Размер и положение окна запоминаем между запусками.
function windowBounds() {
  const saved = store ? store.read('window.json', null) : null;
  const def = { width: 1440, height: 900 };
  if (!saved || !saved.width) return def;
  const { screen } = require('electron');
  const area = screen.getDisplayMatching({ x: saved.x || 0, y: saved.y || 0, width: saved.width, height: saved.height }).workArea;
  const fits = saved.x >= area.x - 20 && saved.y >= area.y - 20 && saved.x + saved.width <= area.x + area.width + 20 && saved.y + saved.height <= area.y + area.height + 20;
  return fits ? saved : { width: Math.min(saved.width, area.width), height: Math.min(saved.height, area.height) };
}

function createWindow() {
  nativeTheme.themeSource = 'dark';
  const b = windowBounds();
  win = new BrowserWindow({
    ...b,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#0b0c0f',
    title: 'Deadlock Coach',
    icon: path.join(__dirname, '..', 'renderer', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (b.maximized) win.maximize();
  win.on('closed', () => {
    if (overlay && !overlay.isDestroyed()) overlay.destroy();
  });
  const reveal = () => {
    if (win && !win.isDestroyed() && !win.isVisible()) win.show();
    started = true;
  };
  win.once('ready-to-show', reveal);
  setTimeout(reveal, 4000); // если страница грузится долго — всё равно показываем окно
  const saveBounds = () => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    store.write('window.json', { ...win.getNormalBounds(), maximized: win.isMaximized() });
  };
  win.on('close', saveBounds);
  let crashes = 0;
  win.webContents.on('render-process-gone', (_e, d) => {
    logCrash('renderer', d.reason);
    if (d.reason !== 'clean-exit' && ++crashes <= 3) setTimeout(() => win && !win.isDestroyed() && win.reload(), 500);
  });
  win.webContents.on('preload-error', (_e, p, err) => logCrash('preload', err));
  win.webContents.on('did-fail-load', (_e, code, desc) => logCrash('load', `${code} ${desc}`));
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Любые ссылки открываем во внешнем браузере, а не внутри приложения.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

async function fetchProfile(accountId) {
  try {
    const [p] = await api.steamProfiles([accountId]);
    if (!p) return {};
    return { name: p.personaname || null, avatar: p.avatarmedium || p.avatar || p.avatarfull || null };
  } catch {
    return {};
  }
}

// Идёт ли игра и включён ли игровой режим.
function inGameMode() {
  return !!(gameMode && gameMode.active && store.settings().gameMode !== false);
}

function autoRefresh() {
  if (inGameMode()) {
    autoPending = true; // не грузим сеть и диск во время игры
    return;
  }
  autoPending = false;
  store.ready.then(() => sync.refreshTop(store.settings(), { background: true }).then((r) => emit('meta:updated', r.meta)).catch((e) => emit('log', e.message)));
}

function scheduleAuto() {
  if (autoTimer) clearInterval(autoTimer);
  const hours = store.settings().autoRefreshHours;
  if (!hours) return;
  autoTimer = setInterval(autoRefresh, hours * 3600e3);
}

// Игра запущена: заранее готовим всё для оверлея, остальное откладываем.
// Игра закрыта: через минуту доделываем отложенное.
function onGameMode(active) {
  emit('game:mode', { active, enabled: store.settings().gameMode !== false });
  if (active) {
    if (recognizer) recognizer.loadRefs().catch(() => {});
    const a = store.read('auth.json', null);
    if (a && a.accountId) store.ready.then(() => sync.pickTables(a.accountId)).catch(() => {});
  } else if (autoPending) {
    setTimeout(() => {
      if (!inGameMode() && autoPending) autoRefresh();
    }, 60e3);
  }
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      // запросы, которым нужны матчи, ждут, пока они дочитаются с диска (окно при этом живое)
      if (!NO_MATCHES.has(channel)) await store.ready;
      lastIpc = `${channel} (выполняется)`;
      const t0 = Date.now();
      const data = await fn(...args);
      if (Date.now() - t0 > 3000) slowLog(`${channel} выполнялся ${((Date.now() - t0) / 1000).toFixed(1)} с`);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    } finally {
      lastIpc = `${channel} (закончен)`;
    }
  });
}

function registerIpc() {
  handle('app:init', async () => {
    const settings = store.settings();
    const auth = store.read('auth.json', null);
    const meta = store.read('meta.json', null);
    const status = store.read('status.json', null);
    let assets = sync.assets;
    try {
      assets = await sync.loadAssets();
    } catch (e) {
      emit('log', e.message);
    }
    return { settings, auth, meta, status, assets, version: app.getVersion() };
  });

  handle('auth:login', async () => {
    const { steamId64, accountId } = await loginWithSteam(win);
    const profile = await fetchProfile(accountId);
    const auth = { steamId64, accountId, ...profile, via: 'steam' };
    store.write('auth.json', auth);
    return auth;
  });

  handle('auth:manual', async (input) => {
    let parsed = parseSteamInput(input);
    if (!parsed) {
      const name = vanityOf(input);
      if (name) {
        try {
          parsed = await resolveVanity(name);
        } catch (e) {
          throw new Error(`Не получилось открыть профиль Steam «${name}»: ${e.message}. Проверь интернет или вставь ссылку вида steamcommunity.com/profiles/7656…`);
        }
        if (!parsed) throw new Error(`Профиль Steam «${name}» не найден. Проверь ссылку — её можно скопировать в Steam: профиль → правой кнопкой → «Скопировать адрес страницы».`);
      }
    }
    if (!parsed) throw new Error('Не понял ссылку. Вставь адрес профиля Steam: steamcommunity.com/id/… или steamcommunity.com/profiles/7656…');
    const profile = await fetchProfile(parsed.accountId);
    const auth = { ...parsed, ...profile, via: 'manual' };
    store.write('auth.json', auth);
    return auth;
  });

  handle('auth:logout', async () => {
    store.remove('auth.json');
    return true;
  });

  handle('settings:save', async (patch) => {
    const before = store.settings();
    const next = store.saveSettings(patch || {});
    scheduleAuto();
    let keyResult = null;
    if (patch && 'overlayKey' in patch) keyResult = registerOverlayKey(next.overlayKey);
    if (patch && 'pickPool' in patch) {
      const a = store.read('auth.json', null);
      if (a && a.accountId) sync.pickTables(a.accountId).catch(() => {});
    }
    const metaChanged = before.days !== next.days || before.onlyRanked !== next.onlyRanked;
    return { settings: next, meta: metaChanged ? sync.computeMeta(next) : null, overlayKey: keyResult };
  });

  handle('top:refresh', async () => {
    const r = await sync.refreshTop(store.settings());
    return r;
  });

  handle('top:list', async () => store.read('top.json', null));

  handle('status:get', async () => store.read('status.json', null));

  handle('top:override', async ({ name, accountId }) => {
    const o = store.read('overrides.json', {});
    if (accountId) o[name] = Number(accountId);
    else delete o[name];
    store.write('overrides.json', o);
    return o;
  });

  handle('hero:build', async (heroId) => sync.heroBuild(Number(heroId), store.settings()));

  handle('players:search', async (q) => sync.searchPlayers(q));
  handle('favorites:list', async () => sync.favorites());
  handle('favorites:add', async (f) => sync.addFavorite(f));
  handle('favorites:remove', async (id) => sync.removeFavorite(id));

  handle('match:detail', async ({ matchId, accountId }) => sync.matchDetail(matchId, accountId));

  handle('player:detail', async (accountId) => sync.playerDetail(accountId, store.settings()));

  handle('my:overview', async (days) => {
    const auth = store.read('auth.json', null);
    if (!auth) throw new Error('Сначала войди через Steam');
    return sync.overview(auth.accountId, days);
  });

  const authId = () => {
    const auth = store.read('auth.json', null);
    if (!auth) throw new Error('Сначала войди через Steam');
    return auth.accountId;
  };
  handle('lag:get', async () => {
    try {
      return fs.readFileSync(path.join(app.getPath('userData'), 'lag.log'), 'utf8').trim().split('\n').slice(-40).join('\n');
    } catch {
      return '';
    }
  });
  handle('coach:get', async (opts) => sync.coach(authId(), opts || {}));
  handle('leaks:get', async () => sync.leaks(authId()));
  handle('mu:mine', async () => sync.matchups(authId()));
  handle('mu:hero', async (heroId) => sync.heroMatchups(heroId));
  handle('mu:outlook', async (heroId) => {
    const auth = store.read('auth.json', null);
    return sync.heroOutlook(auth ? auth.accountId : null, heroId);
  });
  handle('mu:prepare', async (opts) => {
    const auth = store.read('auth.json', null);
    return sync.prepareGame(auth ? auth.accountId : null, opts || {});
  });
  handle('vs:candidates', async (matchId) => sync.proCandidatesFor(matchId, authId()));
  handle('vs:get', async ({ matchId, proMatchId, proAccountId }) => sync.versus(matchId, authId(), proMatchId, proAccountId));

  handle('my:heroes', async () => {
    const auth = store.read('auth.json', null);
    if (!auth) throw new Error('Сначала войди через Steam');
    return sync.myHeroes(auth.accountId);
  });

  handle('my:heroSummary', async (heroId) => {
    const auth = store.read('auth.json', null);
    if (!auth) throw new Error('Сначала войди через Steam');
    return sync.heroSummary(auth.accountId, heroId);
  });

  handle('my:matches', async () => {
    const auth = store.read('auth.json', null);
    if (!auth) throw new Error('Сначала войди через Steam');
    return sync.myMatches(auth.accountId);
  });

  handle('my:scanCache', async () => {
    const auth = store.read('auth.json', null);
    return sync.scanSteamCache(store.settings(), scanCache, auth ? auth.accountId : null);
  });

  handle('my:freshMatches', async () => {
    const auth = store.read('auth.json', null);
    if (!auth) throw new Error('Сначала войди через Steam');
    return sync.myMatches(auth.accountId, { fresh: true });
  });

  handle('camp:targets', async (heroId) => sync.targetsForHero(Number(heroId)));

  handle('camp:analyze', async (opts) => {
    const auth = store.read('auth.json', null);
    if (!auth) throw new Error('Сначала войди через Steam');
    const s = store.settings();
    return sync.analyzeMatch({ ...opts, accountId: auth.accountId, source: opts.source || s.benchmarkSource, winsOnly: opts.winsOnly ?? s.winsOnly });
  });

  handle('shell:open', async (url) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) await shell.openExternal(url);
    return true;
  });

  handle('build:get', async ({ matchId, accountId, slot }) => sync.matchBuild(matchId, accountId, slot ?? null));
  handle('build:text', async (b) => sync.buildExportText(b));
  handle('build:encode', async (build) => sync.encodeGameBuild(build));
  // Сохранить файл билда (текст или JSON) через окно «Сохранить как».
  handle('build:save', async ({ name, content, kind }) => {
    const ext = kind === 'json' ? 'json' : 'txt';
    const safe = String(name || 'build').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'build';
    const r = await dialog.showSaveDialog(win, {
      title: 'Сохранить билд',
      defaultPath: path.join(app.getPath('documents'), `${safe}.${ext}`),
      filters: kind === 'json' ? [{ name: 'Билд (JSON)', extensions: ['json'] }] : [{ name: 'Текст', extensions: ['txt'] }],
    });
    if (r.canceled || !r.filePath) return { saved: false };
    fs.writeFileSync(r.filePath, kind === 'json' ? JSON.stringify(content, null, 2) : String(content), 'utf8');
    return { saved: true, path: r.filePath };
  });
  // Картинка билда: снимок указанной области окна.
  handle('build:png', async ({ rect, name }) => {
    const img = await win.webContents.capturePage({ x: Math.max(0, Math.floor(rect.x)), y: Math.max(0, Math.floor(rect.y)), width: Math.ceil(rect.width), height: Math.ceil(rect.height) });
    const safe = String(name || 'build').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'build';
    const r = await dialog.showSaveDialog(win, {
      title: 'Сохранить картинку билда',
      defaultPath: path.join(app.getPath('pictures'), `${safe}.png`),
      filters: [{ name: 'Картинка PNG', extensions: ['png'] }],
    });
    if (r.canceled || !r.filePath) return { saved: false };
    fs.writeFileSync(r.filePath, img.toPNG());
    return { saved: true, path: r.filePath };
  });
  handle('build:copyImage', async ({ rect }) => {
    const img = await win.webContents.capturePage({ x: Math.max(0, Math.floor(rect.x)), y: Math.max(0, Math.floor(rect.y)), width: Math.ceil(rect.width), height: Math.ceil(rect.height) });
    clipboard.writeImage(img);
    return true;
  });
  // --- распознавание состава ---
  handle('rec:run', async () => runRecognition({ reason: 'manual' }));
  handle('rec:learn', async ({ slot, heroId }) => recognizer.learn(slot, heroId));
  handle('rec:forget', async () => recognizer.forget());
  handle('game:mode', async () => ({ ...(gameMode ? gameMode.info() : { active: false }), enabled: store.settings().gameMode !== false, pending: autoPending }));
  handle('rec:status', async () => ({
    watch: watch ? watch.info() : null,
    learned: Object.keys(recognizer.learnedAll()).length,
    last: recognizer.last ? { at: recognizer.last.out.at, ok: recognizer.last.out.ok, slots: recognizer.last.out.slots.length, unsure: recognizer.last.out.unsure, ms: recognizer.last.out.ms } : null,
    dir: recognizer.dir,
  }));
  // --- оверлей и совет по пику ---
  handle('overlay:toggle', async (show) => {
    toggleOverlay(typeof show === 'boolean' ? show : null);
    return true;
  });
  handle('overlay:key', async () => ({ key: overlayKey, wanted: store.settings().overlayKey }));
  handle('pick:advise', async (opts) => sync.pickAdvise(authId(), opts || {}));
  handle('pick:prepare', async (force) => {
    const id = authId();
    sync.pickTables(id, { force: !!force }).catch(() => {});
    return true;
  });
  handle('game:logCheck', async () => {
    await sync.loadAssets().catch(() => {});
    const heroes = Object.values((sync.assets && sync.assets.heroes) || {}).map((h) => ({ id: h.id, name: h.name, cls: h.cls }));
    return checkConsoleLog({ steamDir: store.settings().steamDir || null, heroes });
  });
  // --- обновления через GitHub Releases ---
  handle('update:check', async () => updater.check());
  handle('update:download', async () => updater.download());
  handle('update:install', async () => updater.install());
  handle('update:skip', async (version) => {
    store.saveSettings({ skippedVersion: version || null });
    return true;
  });
  handle('clipboard:write', async (text) => {
    clipboard.writeText(String(text || ''));
    return true;
  });
}

// Только одна копия программы: повторный запуск открывает уже открытое окно.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) {
      if (store) createWindow();
      return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}
process.on('uncaughtException', (e) => fatal('uncaught', e));
process.on('unhandledRejection', (e) => logCrash('unhandled', e));
app.setAppUserModelId && app.setAppUserModelId('local.deadlock.coach');

app.whenReady().then(() => {
  if (!gotLock) return;
  try {
    store = new Store(path.join(app.getPath('userData'), 'data'), { lazy: true });
    store.ready.then(() => {
      try {
        fs.appendFileSync(path.join(app.getPath('userData'), 'lag.log'), `${new Date().toISOString()} запуск ${app.getVersion()}: матчей на диске ${store.loadInfo.files}, прочитаны за ${(store.loadInfo.ms / 1000).toFixed(1)} с\n`);
      } catch {}
    });
    api = new Api({ getApiKey: () => store.settings().apiKey });
    sync = new Sync({ api, store, emit });
    registerIpc();
    createWindow();
    scheduleAuto();
    registerOverlayKey(store.settings().overlayKey);
    recognizer = new Recognizer({ store, getAssets: () => sync.assets, electron: { desktopCapturer, screen, nativeImage }, log: (m) => logCrash('recognizer', m) });
    watch = new GameWatch({
      findFile: async () => {
        const { gameDir } = await findDeadlockDir(store.settings().steamDir || null);
        const f = consoleLogPath(gameDir);
        return f && fs.existsSync(f) ? f : null;
      },
      log: (m) => logCrash('watch', m),
    });
    // Пауза перед игрой → снимок → оверлей с составом и советом (без кражи фокуса у игры).
    watch.on('event', (ev) => {
      const st = store.settings();
      emit('game:event', ev);
      if (ev.type === 'pregame' && st.autoRecognize !== false) {
        setTimeout(() => runRecognition({ retries: 3, focus: false, reason: 'pregame' }).catch(() => {}), 1500);
      }
      if (ev.type === 'started' && st.overlayAutoHide !== false) {
        setTimeout(() => {
          if (overlay && !overlay.isDestroyed() && overlay.isVisible() && !overlay.isFocused()) overlay.hide();
        }, 8000);
      }
    });
    watch.start().catch(() => {});
    sync.holdIf = inGameMode;
    gameMode = new GameMode({ logActiveAt: () => (watch ? watch.lastDataAt : 0) });
    gameMode.on('change', onGameMode);
    gameMode.start();
    let repo = '';
    try {
      repo = require('../../package.json').updateRepo || '';
    } catch {}
    updater = new Updater({ app, repo, emit });
    // проверка обновлений через 15 с после запуска (если не выключена)
    setTimeout(async () => {
      const st = store.settings();
      if (st.autoUpdateCheck === false) return;
      try {
        const r = await updater.check();
        if (r.available && r.release && r.release.version !== st.skippedVersion) emit('update:available', r);
      } catch (e) {
        logCrash('update-check', e.message);
      }
    }, 15000);
    // советы по пикам готовим заранее, чтобы в 30-секундной паузе всё было мгновенно
    setTimeout(() => {
      const a = store.read('auth.json', null);
      if (a && a.accountId) sync.pickTables(a.accountId).catch(() => {});
    }, 20000);
  } catch (e) {
    fatal('start', e);
    app.quit();
    return;
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  try {
    globalShortcut.unregisterAll();
    if (watch) watch.stop();
    if (gameMode) gameMode.stop();
  } catch {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
