'use strict';
/* global F, Charts, dc */
(function () {
  const h = F.h;
  const newPrep = () => ({ myHero: null, enemies: [], laneFoe: null, result: null, request: null, mu: null, muLoading: false, muError: null, outlook: {} });
  const newDashboard = () => ({ data: null, loading: false, error: null, updated: 0, details: false });
  const S = {
    settings: { region: 'Europe', topN: 50, days: 7, winsOnly: false, benchmarkSource: 'top', autoRefreshHours: 3, keepDays: 14 },
    auth: null,
    meta: null,
    status: null,
    assets: { heroes: {}, items: {} },
    view: 'meta',
    metaTab: 'heroes',
    sort: { key: 'games', dir: -1 },
    selectedHero: null,
    heroDetail: null,
    heroLoading: false,
    heroVariant: 0,
    favs: [],
    search: { q: '', loading: false, results: null, error: null },
    selectedPlayer: null,
    playerDetail: null,
    playerLoading: false,
    top: null,
    busy: false,
    coach: { data: null, loading: false, error: null, for: null },
    growth: { data: null, loading: false, error: null, for: null, open: null },
    prep: newPrep(),
    codex: { enemy: null, data: {}, pending: new Set(), poolOnly: false },
    heroMu: {},
    dashboard: newDashboard(),
    ov: { days: 7, data: null, loading: false, error: null, mode: 'lobby', srcMode: 'top', for: null },
    my: { vs: null, vsChart: 'nw', mode: 'match', heroes: null, heroesLoading: false, hero: null, heroRep: null, heroRepLoading: false, heroRepError: null, list: null, loading: false, error: null, selected: null, analysis: null, analyzing: false, error2: null, target: { type: 'top' }, targets: [], chart: 'nw', winsOnly: null },
  };

  // ---------- общие помощники ----------
  window.addEventListener('error', (e) => {
    console.error(e.error || e.message);
    try {
      toast(`Что-то пошло не так в интерфейсе: ${e.message}. Попробуй ещё раз или перезапусти программу.`, true);
    } catch {}
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error(e.reason);
    try {
      toast(`Ошибка: ${(e.reason && e.reason.message) || e.reason}`, true);
    } catch {}
  });
  const $ = (id) => document.getElementById(id);
  let toastTimer;
  function toast(text, isErr = false, ms = null) {
    const t = $('toast');
    t.textContent = text;
    t.className = isErr ? 'toast err' : 'toast';
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms || (isErr ? 7000 : 3500));
  }
  const heroName = (id) => (S.assets.heroes[id] ? S.assets.heroes[id].name : `Герой ${id}`);
  const itemName = (id) => (S.assets.items[id] ? S.assets.items[id].name : `Предмет ${id}`);
  function heroIcon(id, cls = '') {
    const hero = S.assets.heroes[id];
    // везде арт героя из справочника игры; герб (crest.js) только если арта нет
    if (hero && (hero.card || hero.img)) return h(`div.hero-ico.art${cls}`, { style: heroArtStyle(hero), role: 'img', 'aria-label': heroName(id) });
    if (hero && window.HeroCrest) return h(`div.hero-ico.crest${cls}`, { html: window.HeroCrest(hero), role: 'img', 'aria-label': heroName(id) });
    return h(`div.hero-ico.ph${cls}`, heroName(id).slice(0, 2));
  }
  // Арты героя из справочника игры (card — вертикальная карточка, wide — фон) и цвет героя для подсветки.
  const cssUrl = (u) => (u ? `url("${String(u).replace(/["\\]/g, '')}")` : 'none');
  const heroArtStyle = (hh) => {
    if (!hh) return null;
    const c = Array.isArray(hh.color) && hh.color.length === 3 ? hh.color.join(',') : '255,122,69';
    return `--art: ${cssUrl(hh.card || hh.img)}; --wide: ${cssUrl(hh.wide || hh.card || hh.img)}; --hc: ${c}`;
  };
  const heroCardStyle = (id) => {
    const hh = S.assets.heroes[id];
    const src = hh && (hh.card || hh.img);
    return src ? `--hero-bg: url("${String(src).replace(/"/g, '')}"); ${heroArtStyle(hh)}` : null;
  };
  const heroImgSrc = (id) => (S.assets.heroes[id] && S.assets.heroes[id].img) || null;
  function mapPanel(map, focusSlot, title = 'Карта матча', focusName = 'Ты') {
    if (!map) return null;
    return h('div.panel.map-panel', h('h2', title),
      MapView(map, { focusSlot, focusName, heroName, heroImg: heroImgSrc, mapAsset: S.assets.map || null }));
  }
  function itemImg(id) {
    const it = S.assets.items[id];
    if (it && it.img) return h('img', { src: it.img, alt: '', title: itemName(id), loading: 'lazy' });
    return h('div.ph', { title: itemName(id) });
  }
  const slotClass = (id) => (S.assets.items[id] && S.assets.items[id].slot) || '';
  const plural = (n, one, few, many) => {
    const r = Math.round(n * 10) / 10;
    if (!Number.isInteger(r)) return few;
    const a = Math.abs(r) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
  };
  const levelText = { good: 'хорошо', warn: 'есть что улучшить', bad: 'главная проблема', none: 'мало данных' };

  // ---------- навигация ----------
  // Меню: «Моя игра» (главная, тренер, матчи, герои) и «Мета» (герои меты, перед игрой, про-игроки).
  const VIEW_OF = { home: 'overview', overview: 'overview', coach: 'coach', growth: 'growth', matches: 'camp', camp: 'camp', myheroes: 'camp', meta: 'meta', players: 'meta', prep: 'prep', codex: 'codex', settings: 'settings' };
  const viewHistory = [];
  let historyIndex = -1;
  function navKey() {
    if (S.view === 'camp') return S.my.mode === 'hero' ? 'myheroes' : 'matches';
    if (S.view === 'meta') return S.metaTab === 'players' ? 'players' : 'meta';
    if (S.view === 'overview') return 'home';
    return S.view;
  }
  function syncNav() {
    const key = navKey();
    document.querySelectorAll('.nav-item').forEach((b) => {
      const on = b.dataset.view === key;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    const t = $('topN-label');
    if (t) t.textContent = `Мета · топ-${S.settings.topN}`;
  }

  function setView(v, { record = true } = {}) {
    const prevKey = S.view ? navKey() : null;
    if (v === 'matches' || v === 'camp') S.my.mode = 'match';
    if (v === 'myheroes') S.my.mode = 'hero';
    if (v === 'meta') S.metaTab = 'heroes';
    if (v === 'players') S.metaTab = 'players';
    const view = VIEW_OF[v] || v;
    S.view = view;
    const key = navKey();
    if (record && key !== viewHistory[historyIndex]) {
      viewHistory.splice(historyIndex + 1, viewHistory.length, key);
      historyIndex = viewHistory.length - 1;
    }
    for (const id of ['overview', 'coach', 'growth', 'meta', 'camp', 'prep', 'codex', 'settings']) $(`view-${id}`).hidden = id !== view;
    render();
    if (navKey() !== prevKey) {
      document.querySelector('.main').scrollTop = 0;
      animateView(view);
    }
    if (view === 'camp' && S.auth) {
      pollCount = 0;
      if (S.my.mode === 'hero') {
        if (!S.my.heroes && !S.my.heroesLoading) loadMyHeroes();
      } else if (!S.my.list && !S.my.loading) loadMyMatches();
      else loadMyMatches(true);
    }
    if (view === 'overview' && S.auth && Date.now() - S.dashboard.updated > 120000) loadOverview();
    if (view === 'coach' && S.auth && !S.coach.loading && (!S.coach.data || S.coach.for !== S.auth.accountId)) loadCoach(false);
    if (view === 'growth' && S.auth && !S.growth.loading && (!S.growth.data || S.growth.for !== S.auth.accountId)) loadGrowth();
    if (view === 'prep' && S.auth && !S.prep.mu && !S.prep.muLoading) loadMyMatchups();
  }
  let lastNavigationInput = null;
  function navigateHistory(step, source) {
    const time = performance.now();
    // Один клик может дать и событие мыши Chromium, и команду Windows.
    if (lastNavigationInput?.step === step && lastNavigationInput.source !== source
      && time - lastNavigationInput.time < 150) {
      lastNavigationInput = null;
      return;
    }
    lastNavigationInput = { step, source, time };
    const next = historyIndex + step;
    if (next < 0 || next >= viewHistory.length) return;
    historyIndex = next;
    setView(viewHistory[historyIndex], { record: false });
  }
  dc.on('navigation:step', (step) => navigateHistory(step, 'windows'));
  window.addEventListener('mouseup', (event) => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    navigateHistory(event.button === 3 ? -1 : 1, 'mouse');
  }, true);
  document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  function render() {
    syncNav();
    renderAccount();
    if (S.view === 'overview') renderOverview();
    if (S.view === 'coach') renderCoach();
    if (S.view === 'growth') renderGrowth();
    if (S.view === 'prep') renderPrep();
    if (S.view === 'codex') renderCodex();
    if (S.view === 'meta') renderMeta();
    if (S.view === 'camp') renderCamp();
    if (S.view === 'settings') renderSettings();
  }

  // ---------- аккаунт ----------
  function renderAccount() {
    const box = $('account');
    box.replaceChildren();
    if (S.auth) {
      box.append(
        h('div.acc', S.auth.avatar ? h('img', { src: S.auth.avatar, alt: '' }) : h('div.hero-ico.ph', 'ID'),
          h('div.acc-body', h('div.acc-name', S.auth.name || `ID ${S.auth.accountId}`), h('div.acc-sub', S.auth.via === 'steam' ? 'вход через Steam' : 'Steam ID вручную')),
          h('button.btn.small.icon', { title: 'Выйти', 'aria-label': 'Выйти', onclick: logout }, Icon('logout')))
      );
    } else {
      box.append(h('button.btn.steam', { style: { width: '100%', justifyContent: 'center' }, onclick: login }, 'Войти через Steam'));
    }
  }

  async function login() {
    try {
      S.auth = await dc.login();
      toast(`Привет, ${S.auth.name || 'игрок'}!`);
      S.my.list = null;
      S.ov.data = null;
      S.dashboard = newDashboard();
      render();
      if (S.view === 'camp') loadMyMatches();
      if (S.view === 'overview') loadOverview();
    } catch (e) {
      if (!/закрыто/.test(e.message)) toast(e.message, true);
    }
  }
  async function loginManual(input) {
    try {
      S.auth = await dc.loginManual(input);
      S.my.list = null;
      S.ov.data = null;
      S.dashboard = newDashboard();
      render();
      if (S.view === 'overview') loadOverview();
      else loadMyMatches();
    } catch (e) {
      toast(e.message, true);
    }
  }
  async function logout() {
    await dc.logout();
    S.auth = null;
    S.prep = newPrep();
    S.dashboard = newDashboard();
    S.growth = { data: null, loading: false, error: null, for: null, open: null };
    heroReportRequest++;
    S.my = { ...S.my, list: null, selected: null, analysis: null, heroes: null, heroesLoading: false, hero: null, heroRep: null, heroRepLoading: false, heroRepRefreshing: false, heroRepError: null, loading: false, freshBusy: false, scanBusy: false, error: null, historyStatus: null, matchInput: '' };
    S.ov = { ...S.ov, data: null, for: null };
    render();
  }

  // ---------- прогресс ----------
  let progTimer;
  dc.on('progress', (p) => {
    const box = $('progress');
    box.hidden = false;
    $('progressFill').style.width = `${p.total ? Math.round((p.done / p.total) * 100) : 0}%`;
    $('progressText').textContent = p.text || '';
    clearTimeout(progTimer);
    if (p.stage === 'done') progTimer = setTimeout(() => (box.hidden = true), 900);
  });
  dc.on('log', (msg) => console.warn(msg));
  // Игровой режим: пока идёт Deadlock, окно не крутит анимации и не опрашивает сервер.
  function applyGameMode(m) {
    S.gameMode = m;
    document.body.classList.toggle('gaming', !!(m && m.active && m.enabled));
    if (m && !m.active && S.view === 'camp') schedulePoll();
    if (S.view === 'settings') renderSettings();
  }
  dc.on('game:mode', applyGameMode);
  dc.on('meta:updated', (meta) => {
    if (meta) S.meta = meta;
    if (S.view === 'meta') renderMeta();
  });
  dc.on('assets:updated', (assets) => {
    S.assets = assets;
    if (S.view === 'overview' && !S.dashboard.details) renderOverview();
    if (S.view === 'prep') renderPrep();
    if (S.view === 'codex') renderCodex();
    if (S.view === 'meta') renderMeta();
  });

  // ================= МЕТА =================
  async function refreshTop() {
    if (S.busy) return;
    S.busy = true;
    renderMeta();
    try {
      const r = await dc.refreshTop();
      S.meta = r.meta;
      S.status = r.status;
      S.top = null;
      const extra = r.status.unavailable ? ` (${r.status.unavailable} пока недоступны в API)` : '';
      toast(`Обновлено: найдено ${r.status.found} ${plural(r.status.found, 'матч', 'матча', 'матчей')} топов${extra}`);
      if (S.selectedHero) loadHero(S.selectedHero);
    } catch (e) {
      toast(e.message, true);
      try {
        S.status = await dc.status();
      } catch {}
    } finally {
      S.busy = false;
      renderMeta();
    }
  }

  function kpi(label, value, hint, level, barPct) {
    return h(`div.kpi${level ? '.' + level : ''}`, h('div.kpi-label', label), h('div.kpi-value', value), hint ? h('div.kpi-hint', hint) : null,
      barPct !== null && barPct !== undefined ? h('div.kpi-bar', h('span', { style: { width: `${Math.max(2, Math.min(100, barPct))}%` } })) : null);
  }

  // ---------- диагностика последнего обновления ----------
  function diagnosis(r) {
    if (r.fatal) return `Обновление прервалось: ${r.fatal}`;
    const a = r.accounts || {};
    const hist = r.history || {};
    const mt = r.matches || {};
    const resolved = (a.exact || 0) + (a.guess || 0) + (a.manual || 0) + (a.search || 0) + (a.list || 0) + (a.discovered || 0);
    const fb = r.fallback;
    if (r.prevSeason && r.prevSeason.rows && hist.kept) return `Топ взят из финального ладдера прошлого сезона (${r.prevSeason.source}).`;
    if (fb && fb.source === 'list') return 'Ладдер пуст (новый сезон) — топ взят из твоего списка игроков в настройках.';
    if (fb && fb.source === 'discovered' && !(r.accounts && r.accounts.discovered)) return 'Ладдер пуст (после смены сезона Valve обнуляет таблицу), и запасной поиск сильнейших игроков ничего не нашёл. Добавь свой список игроков в настройках.';
    if (fb && fb.source === 'discovered' && !(hist.kept)) return 'Ладдер пуст (новый сезон); найдены сильные игроки из свежих матчей, но их матчей за период нет.';
    if (fb && fb.source === 'discovered') return 'Ладдер пуст (новый сезон) — топ собран из самых рейтинговых свежих матчей.';
    if (!r.ladder || !r.ladder.entries) return 'Ладдер пришёл пустым — API не вернул список топов для этого региона.';
    if (!resolved) return 'Ладдер получен, но ни для одного ника не удалось определить аккаунт Steam.';
    if (hist.ok === 0 && hist.failed) return 'Все запросы истории матчей завершились ошибкой — смотри список ошибок ниже.';
    if (!hist.rows) return 'Аккаунты найдены, но их история матчей в API пустая.';
    if (!hist.kept && hist.old === hist.rows) return 'Все найденные матчи старше выбранного периода.';
    if (!hist.kept && hist.otherMode) return 'Все матчи отсеяны фильтром режима игры.';
    if (mt.unique && !mt.downloaded && !mt.alreadyHave) return 'Матчи найдены, но API не отдаёт их подробные данные (метаданные).';
    return 'Явной поломки не видно.';
  }

  function diagnosticsPanel(r) {
    if (!r) return null;
    const a = r.accounts || {};
    const hist = r.history || {};
    const mt = r.matches || {};
    const line = (label, value) => h('div.row', { style: { padding: '3px 0' } }, h('span.muted', { style: { width: '170px' } }, label), h('span', value));
    const modes = Object.entries(hist.modes || {}).map(([k, v]) => `${k}: ${v}`).join(', ') || '—';
    return h('div.panel', { style: { marginTop: '16px' } },
      h('h2', 'Диагностика последнего обновления'),
      h('div.howto', diagnosis(r)),
      line('Ладдер', r.ladder ? `${r.ladder.entries} записей (${r.region})` : '—'),
      r.fallback
        ? line('Запасной источник', r.fallback.source === 'list' ? `твой список: ${a.list || 0} ${plural(a.list || 0, 'игрок', 'игрока', 'игроков')}` : `активные матчи: ${r.fallback.active ?? '—'} ${plural(r.fallback.active ?? '—', 'игрок', 'игрока', 'игроков')} · недавние матчи: ${r.fallback.recent ?? '—'} · кандидатов ${r.fallback.candidates ?? 0} · с рангом ${r.fallback.ranked ?? 0} · взято ${a.discovered || 0}`)
        : line('Аккаунты топов', `точно ${a.exact || 0} · угадано ${a.guess || 0} · через поиск ${a.search || 0} · вручную ${a.manual || 0} · не найдено ${a.none || 0}`),
      r.prevSeason ? line('Прошлый сезон', r.prevSeason.rows ? `${r.prevSeason.rows} ${plural(r.prevSeason.rows, 'игрок', 'игрока', 'игроков')} (${r.prevSeason.source})` : `не получен${r.prevSeason.error ? ': ' + r.prevSeason.error : ''}`) : null,
      line('История матчей', `успешно ${hist.ok || 0} · ошибок ${hist.failed || 0} · пустых ${hist.empty || 0}`),
      line('Матчи в историях', `всего ${hist.rows || 0} · старше ${r.days} дн. ${hist.old || 0} · другой режим ${hist.otherMode || 0} · подходят ${hist.kept || 0}`),
      line('Режимы (игра/матч)', modes),
      line('Подробные данные', `уникальных ${mt.unique || 0} · уже были ${mt.alreadyHave || 0} · скачано ${mt.downloaded || 0} · нет в API ${mt.notFound || 0} · ошибок ${mt.failed || 0}`),
      r.errors && r.errors.length ? h('div', { style: { marginTop: '10px' } }, h('h3', 'Ошибки'), r.errors.slice(0, 6).map((e) => h('div.dim', { style: { fontSize: '12px' } }, e))) : null,
      h('div.row', { style: { marginTop: '12px' } },
        h('button.btn', { onclick: () => dc.copy(JSON.stringify(r, null, 2)).then(() => toast('Отчёт скопирован — вставь его в чат')) }, 'Скопировать отчёт'),
        h('span.dim', { style: { fontSize: '12px' } }, `обновление ${F.clock(r.at)}`)));
  }

  function renderMeta() {
    const v = $('view-meta');
    const m = S.meta;
    if (m && m.totalRecords && S.metaTab === 'heroes' && S.selectedHero) {
      v.replaceChildren(heroPage());
      return;
    }
    const regionName = { Europe: 'Европа', NAmerica: 'Сев. Америка', SAmerica: 'Юж. Америка', Asia: 'Азия', Oceania: 'Океания' }[m ? m.region : S.settings.region] || S.settings.region;
    const sub = m
      ? `${regionName} · топ-${S.settings.topN} · последние ${m.days} дн. · ${m.totalMatches} ${plural(m.totalMatches, 'матч', 'матча', 'матчей')} · обновлено ${F.ago(S.status ? S.status.lastSync : m.generatedAt)}`
      : `${regionName} · топ-${S.settings.topN} · последние ${S.settings.days} дн.`;
    const head = h(S.metaTab === 'players' ? 'div.page-head.scene-players' : 'div.page-head',
      h('div', h('div.crumbs', `Мета · топ-${S.settings.topN} текущего сезона`), h('h1', S.metaTab === 'players' ? 'Про-игроки' : 'Мета героев'), h('div.sub', sub)),
      h('div.row', S.busy ? h('span.muted.row', h('span.spin'), 'Собираю данные…') : null,
        h('button.btn.primary', { onclick: refreshTop, disabled: S.busy }, Icon('refresh'), 'Обновить данные')));
    const body = [];
    if (!m || !m.totalRecords) {
      body.push(h('div.empty', h('strong', m ? 'Матчей топов пока нет' : 'Данных пока нет'),
        'Нажми «Обновить данные». Первый сбор занимает несколько минут: программа находит топов в ладдере и скачивает их матчи. Дальше обновления быстрые — скачиваются только новые игры.'));
      if (S.status && S.status.report && !S.busy) body.push(diagnosticsPanel(S.status.report));
    } else {
      const favN = S.favs.length;
      body.push(h('div.kpis',
        kpi('Матчей топов', F.num(m.totalMatches), `за ${m.days} дн.`, null, Math.min(100, m.totalMatches / 3)),
        kpi('Игр в выборке', F.num(m.totalRecords), 'топ + избранные', null, Math.min(100, m.totalRecords / 6)),
        kpi('Героев в мете', String(m.heroes.length), 'сыграно топами', null, Math.min(100, (m.heroes.length / 38) * 100)),
        kpi('Отслеживаем', String((m.players || []).length), `из них ${favN} избранных`, null, Math.min(100, ((m.players || []).length / 70) * 100))));
      if (m.source === 'prev_season') {
        body.push(h('div.note.hot', Icon('refresh'), h('div', 'Эти данные собраны по топу прошлого сезона. Нажми «Обновить данные» — соберу топ текущего сезона.')));
      }
      if (m.source === 'ladder+discovered') {
        body.push(h('div.howto', `Ладдер текущего сезона пока короче топ-${S.settings.topN}, поэтому недостающих игроков я добрал из свежих матчей этого сезона с самым высоким рангом.`));
      }
      if (m.source === 'discovered' || m.source === 'list') {
        body.push(h('div.howto', m.source === 'list'
          ? 'Топ взят из твоего списка игроков (Настройки).'
          : 'Ладдер текущего сезона пока пуст, поэтому топ собран из игроков с самым высоким рангом в свежих матчах этого сезона. Как только ладдер заполнится, программа переключится на него.'));
      }
      if (m.unresolved) {
        body.push(h('div.howto', `У ${m.unresolved} ${plural(m.unresolved, 'игрок', 'игрока', 'игроков')} из ладдера не удалось определить аккаунт — их игры не учтены. Можно указать аккаунт вручную в разделе «Про-игроки».`));
      }
      body.push(S.metaTab === 'heroes' ? heroesSection(m) : playersSection(m));
    }
    v.replaceChildren(head, ...body);
  }

  function heroesSection(m) {
    const rows = m.heroes.slice();
    const { key, dir } = S.sort;
    rows.sort((a, b) => (a[key] - b[key]) * dir || b.games - a.games);
    const maxShare = Math.max(...rows.map((r) => r.pick_share), 0.0001);
    const th = (label, k, cls = '') => {
      const sorted = S.sort.key === k;
      return h(`th.sortable${cls}${sorted ? '.sorted' : ''}`, {
        onclick: () => {
          S.sort = { key: k, dir: sorted ? -S.sort.dir : -1 };
          renderMeta();
        },
      }, label + (sorted ? (S.sort.dir < 0 ? ' ↓' : ' ↑') : ''));
    };
    const table = h('table.table',
      h('thead', h('tr', h('th', 'Герой'), th('Игр', 'games', '.r'), th('Пики', 'pick_share'), th('Винрейт', 'winrate'), th('Надёжно', 'ci_lo', '.r'), th('KDA', 'kda', '.r'))),
      h('tbody', rows.map((r) => {
        const lo = Math.max(0, Math.min(1, (r.ci_lo - 0.25) / 0.5));
        const hi = Math.max(0, Math.min(1, (r.ci_hi - 0.25) / 0.5));
        const pt = Math.max(0, Math.min(1, (r.winrate - 0.25) / 0.5));
        return h(`tr.click${r.lowSample ? '.low' : ''}${S.selectedHero === r.hero_id ? '.selected' : ''}`, { onclick: () => loadHero(r.hero_id) },
          h('td', h('div.hero-cell', heroIcon(r.hero_id), heroName(r.hero_id), r.lowSample ? h('span.pill', 'мало игр') : null)),
          h('td.r.num', r.games),
          h('td', h('div.row.nowrap', h('div.bar', { style: { width: '56px' } }, h('span', { style: { width: `${(r.pick_share / maxShare) * 100}%` } })), h('span.num.muted', F.pct(r.pick_share, 1)))),
          h('td', h('div.wr', h('span.wr-val.num', { style: { color: r.winrate >= 0.5 ? 'var(--good)' : 'var(--bad)' } }, F.pct(r.winrate)),
            h('div.wr-ci', { title: `С учётом числа игр реальный винрейт где-то между ${F.pct(r.ci_lo)} и ${F.pct(r.ci_hi)}` },
              h('div.axis'), h('div.mid'), h('div.range', { style: { left: `${lo * 100}%`, width: `${(hi - lo) * 100}%` } }), h('div.dot', { style: { left: `${pt * 100}%` } })))),
          h('td.r.num.muted', { title: 'Нижняя граница винрейта: чем выше, тем увереннее герой сильный' }, F.pct(r.ci_lo)),
          h('td.r.num', r.kda.toFixed(1).replace('.', ',')));
      })));
    const legend = h('div.hint', 'Полоска в «Винрейте» — разброс, в котором реально лежит винрейт с учётом числа игр. Чем она короче, тем надёжнее цифра. Сортировка по «Надёжно» ставит наверх героев, которые сильны с большой уверенностью.');
    if (S.selectedHero) return heroPage();
    return h('div.panel', h('div.table-scroll', table), legend);
  }

  async function loadHero(heroId) {
    document.querySelector('.main').scrollTop = 0;
    S.selectedHero = heroId;
    S.heroVariant = 0;
    S.heroLoading = true;
    S.heroDetail = null;
    renderMeta();
    try {
      S.heroDetail = await dc.heroBuild(heroId);
    } catch (e) {
      toast(e.message, true);
    } finally {
      S.heroLoading = false;
      if (S.selectedHero === heroId) renderMeta();
    }
  }

  function itemTile(it) {
    return h(slotClass(it.id) ? `div.item.${slotClass(it.id)}` : 'div.item',
      itemImg(it.id),
      h('div.item-name', itemName(it.id)),
      h('div.item-meta', `≈ ${F.time(it.medianT)} · берут ${F.pct(it.pick)}`),
      it.winWith !== null && it.winWith !== undefined ? h('div.item-meta', { title: 'Винрейт топов в играх, где они купили этот предмет' }, `победы ${F.pct(it.winWith)}`) : null);
  }

  function buildChecklist(heroId, v) {
    const lines = [`${heroName(heroId)} — ${v.label} (топы, ${v.games} ${plural(v.games, 'игра', 'игры', 'игр')}, винрейт ${F.pct(v.winrate)})`];
    const ph = [['early', 'Ранняя игра'], ['mid', 'Середина'], ['late', 'Поздняя игра']];
    for (const [k, title] of ph) {
      if (!v.build.phases[k].length) continue;
      lines.push('', `${title}:`);
      for (const it of v.build.phases[k]) lines.push(`  ${F.time(it.medianT)}  ${itemName(it.id)} (берут ${F.pct(it.pick)})`);
    }
    if (v.spikes.length) {
      lines.push('', 'Урон за три минуты до и после покупки:');
      for (const s of v.spikes) lines.push(`  ${itemName(s.id)} ≈ ${F.time(s.topT)}: урон ${F.num(s.rateBefore)} → ${F.num(s.rateAfter)} в мин`);
    }
    if (v.build.situational.length) {
      lines.push('', 'По ситуации:');
      for (const it of v.build.situational.slice(0, 8)) lines.push(`  ${itemName(it.id)} (${F.pct(it.pick)})`);
    }
    return lines.join('\n');
  }

  // ---------- общие блоки нового стиля ----------
  // Шкала времени предметов. lanes: [{ label, items: [{ id, t, sub }] }]
  function itemTimeline(lanes, { maxT = null, spikeIds = new Set(), minMinutes = 10 } = {}) {
    const all = lanes.flatMap((l) => l.items.map((i) => i.t)).filter((t) => t !== null && t !== undefined);
    const end = Math.max(minMinutes * 60, maxT || 0, ...all) * 1.04;
    const pct = (t) => 3 + (t / end) * 92;
    const ROW = 70;
    const box = h('div.tl');
    let y = 10;
    const laneEls = [];
    lanes.forEach((lane, li) => {
      const items = lane.items.filter((i) => i.t !== null && i.t !== undefined).slice().sort((a, b) => a.t - b.t);
      const rowsEnd = [];
      const placed = items.map((it) => {
        const x = pct(it.t);
        let r = rowsEnd.findIndex((last) => x - last >= 11);
        if (r === -1) {
          r = rowsEnd.length;
          rowsEnd.push(x);
        } else rowsEnd[r] = x;
        return { it, x, r };
      });
      const rows = Math.max(1, rowsEnd.length);
      if (lane.label) laneEls.push(h('div.tl-lane-label', { style: { top: `${y - 2}px` } }, lane.label));
      for (const { it, x, r } of placed) {
        const cls = ['tl-item', slotClass(it.id), spikeIds.has(it.id) ? 'spike' : ''].filter(Boolean).join('.');
        laneEls.push(h(`div.${cls}`, { style: { left: `${x}%`, top: `${y + 12 + r * ROW}px` }, title: `${itemName(it.id)} — ${F.time(it.t)}` },
          itemImg(it.id), h('div.tl-name', itemName(it.id)), h('div.tl-meta', `${F.time(it.t)}${it.sub ? ' · ' + it.sub : ''}`)));
      }
      y += 12 + rows * ROW + 6;
      if (li < lanes.length - 1) {
        laneEls.push(h('div.tl-lane', { style: { top: `${y}px` } }));
        y += 8;
      }
    });
    const height = y + 22;
    for (let m = 0; m * 60 <= end; m += end > 1800 ? 10 : 5) {
      box.append(h('div.tl-grid', { style: { left: `${pct(m * 60)}%` } }), h('div.tl-tick', { style: { left: `calc(${pct(m * 60)}% + 4px)` } }, `${m}:00`));
    }
    box.append(...laneEls);
    box.style.height = `${height}px`;
    return box;
  }

  function slotKey() {
    return h('div.slot-key',
      h('span', h('i', { style: { background: 'var(--weapon)' } }), 'оружие'),
      h('span', h('i', { style: { background: 'var(--vitality)' } }), 'живучесть'),
      h('span', h('i', { style: { background: 'var(--spirit)' } }), 'спирит'),
      h('span', h('i', { style: { background: 'transparent', outline: '2px solid var(--orange)', outlineOffset: '-2px' } }), 'паверспайк'));
  }

  // Маленький график: урон в минуту до покупки и после.
  function spikeChart(before, after, ariaLabel) {
    const NS = 'http://www.w3.org/2000/svg';
    const W = 300;
    const H = 96;
    const max = Math.max(after, before, 1) * 1.18;
    const y = (v) => H - 10 - (v / max) * (H - 22);
    const pts = [[0, before * 0.86], [50, before * 0.92], [100, before * 0.97], [150, before], [172, (before + after) / 2], [200, after * 0.96], [250, after], [300, after * 1.02]];
    const d = pts.map(([x, v], i) => `${i ? 'L' : 'M'}${x} ${y(v).toFixed(1)}`).join(' ');
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', ariaLabel);
    svg.innerHTML =
      `<line x1="0" y1="${H - 10}" x2="${W}" y2="${H - 10}" stroke="#1e2631"/>` +
      `<line x1="150" y1="6" x2="150" y2="${H - 10}" stroke="#ff8a3d" stroke-dasharray="3 4"/>` +
      `<path d="${d}" fill="none" stroke="#36d0c4" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>` +
      `<text x="6" y="${(y(before) - 8).toFixed(0)}" fill="#8a97a8" font-size="11" font-family="JetBrains Mono, monospace">${F.esc(F.num(before))}/мин</text>` +
      `<text x="${W - 6}" y="${Math.max(12, y(after) - 8).toFixed(0)}" fill="#e6edf5" font-size="11" text-anchor="end" font-family="JetBrains Mono, monospace">${F.esc(F.num(after))}/мин</text>`;
    return h('div.spike-chart', svg);
  }

  function spikeCard(s, mine = null) {
    return h(`div.spike${mine ? '.' + mine.level : ''}`,
      h('div.spike-head', h('span.mini-items', itemImg(s.id)), h('b', itemName(s.id)), h('span.pill.hot', Icon('zap'), `≈ ${F.time(s.topT)}`)),
      spikeChart(s.rateBefore, s.rateAfter, `Урон по героям: ${F.num(s.rateBefore)} в минуту до покупки, ${F.num(s.rateAfter)} после`),
      h('div.spike-stats',
        h('div', h('b', { style: { color: 'var(--good)' } }, F.signedPct(s.lift - 1)), h('span', 'сверх обычного роста урона')),
        h('div', h('b', s.knownParticipation ? `${s.participated} из ${s.knownParticipation}` : '—'), h('span', 'игр с убийством или помощью за 3 минуты среди игр с точными данными')),
        h('div', h('b', String(s.samples)), h('span', 'игр топов в расчёте'))),
      mine ? h('div.spike-mine', mine.content) : null);
  }

  function variantSeg(variants, selected, onPick) {
    return h('div.seg', { role: 'group', 'aria-label': 'Сборка' }, variants.map((v, i) =>
      h(`button${i === selected ? '.on' : ''}`, { onclick: () => onPick(i), 'aria-pressed': i === selected ? 'true' : 'false' }, `${v.label.replace(/^(Вариант \d+|Основной билд): /, '')} · ${F.pct(v.winrate)}`)));
  }

  function heroPage() {
    const back = h('button.btn.small', { onclick: () => { S.selectedHero = null; renderMeta(); } }, '← Все герои');
    if (S.heroLoading || !S.heroDetail) return h('div', h('div.row', { style: { marginBottom: '14px' } }, back), h('div.panel', h('div.row', h('span.spin'), 'Считаю сборки…')));
    const d = S.heroDetail;
    const row = S.meta && S.meta.heroes.find((x) => x.hero_id === d.heroId);
    const vi = Math.min(S.heroVariant || 0, Math.max(0, d.variants.length - 1));
    const v = d.variants[vi];
    const head = h('div.page-head.hero-banner', { style: heroCardStyle(d.heroId) },
      h('div.row', { style: { gap: '18px' } }, heroIcon(d.heroId, '.lg'),
        h('div', h('div.crumbs', `Мета / Герои / ${heroName(d.heroId)}`), h('h1', heroName(d.heroId)))),
      h('div.row', back,
        v ? h('button.btn', { onclick: () => document.getElementById('in-game') && document.getElementById('in-game').scrollIntoView({ behavior: 'smooth' }) }, 'Найти билд в игре') : null,
        v ? h('button.btn.primary', { onclick: () => dc.copy(buildChecklist(d.heroId, v)).then(() => toast('Чек-лист скопирован')) }, Icon('copy'), 'Скопировать чек-лист') : null));
    if (!d.games) return h('div', head, h('div.empty', h('strong', 'Нет игр топов'), 'Топы не играли на этом герое за выбранный период.'));
    const wr = d.wins / d.games;
    const parts = [head,
      h('div.kpis',
        kpi('Игр топов', String(d.games), row ? `${F.pct(row.pick_share, 1)} всех пиков` : null, null, row ? Math.min(100, row.pick_share * 800) : 50),
        kpi('Винрейт', F.pct(wr), row ? `вероятно ${F.pct(row.ci_lo)}–${F.pct(row.ci_hi)}` : null, wr >= 0.5 ? 'good' : 'bad', wr * 100),
        kpi('Топов играют', String(d.players.length), 'разных игроков', null, Math.min(100, d.players.length * 5)),
        kpi('Сборок', String(d.variants.length), d.variants.length > 1 ? 'разные стили' : 'одна основная', null, v ? v.share * 100 : 100))];
    if (d.spammers && d.spammers.length) {
      const shown = d.spammers.slice().sort((a, b) => b.games / b.of - a.games / a.of).slice(0, 5);
      const more = d.spammers.length - shown.length;
      parts.push(h('div.note.hot', Icon('flame'), h('div', 'Сейчас спамят: ', shown.map((p, i) => [i ? ', ' : '', h('a', { href: '#', onclick: (e) => { e.preventDefault(); openPlayer(p.accountId); } }, `${p.rank ? '#' + p.rank + ' ' : ''}${p.name}`), ` (${p.games} из ${p.of})`]), more > 0 ? ` и ещё ${more}` : '')));
    }

    // левая колонка: сборка
    const spikeIds = new Set(v.spikes.map((s) => s.id));
    const left = h('section.panel', { style: { flex: '999 1 600px', minWidth: '0' } },
      h('div.row', { style: { justifyContent: 'space-between', marginBottom: '14px' } }, h('h2', { style: { margin: 0 } }, 'Сборки топов'), d.variants.length > 1 ? variantSeg(d.variants, vi, (i) => { S.heroVariant = i; renderMeta(); }) : null),
      h('div.variant-head',
        h('div.grow', h('div', { style: { fontWeight: 800 } }, v.label.replace(/^(Вариант \d+|Основной билд): /, (m0) => (m0.startsWith('Основной') ? 'Основная сборка: ' : ''))),
          h('div.muted', { style: { fontSize: '13px' } }, `${v.games} ${plural(v.games, 'игра', 'игры', 'игр')} · ${F.pct(v.share)} всех игр · ${v.players} ${plural(v.players, 'игрок', 'игрока', 'игроков')} · винрейт ${F.pct(v.winrate)} (вероятно ${F.pct(v.ci_lo)}–${F.pct(v.ci_hi)})`)),
        v.signature.length ? h('div.row', { style: { gap: '6px' } }, h('span.muted', { style: { fontSize: '12px' } }, 'отличают'), h('div.mini-items', v.signature.map(itemImg))) : null),
      h('h3', 'Когда что покупают'),
      itemTimeline([{ items: v.build.core.map((it) => ({ id: it.id, t: it.medianT, sub: F.pct(it.pick) })) }], { spikeIds, minMinutes: 16 }),
      slotKey(),
      v.build.openers.length ? h('div', { style: { marginTop: '18px' } }, h('h3', 'Частое начало — первые 4 предмета'),
        v.build.openers.map((o) => h('div.row', { style: { marginBottom: '6px' } }, h('div.mini-items', o.items.map(itemImg)), h('span.muted.num', `${F.pct(o.share)} игр`)))) : null,
      v.build.situational.length ? h('div', { style: { marginTop: '14px' } }, h('h3', 'По ситуации'),
        h('div.row', { style: { gap: '6px' } }, v.build.situational.slice(0, 10).map((it) => h('span.pill', { title: `≈ ${F.time(it.medianT)}` }, h('span.mini-items', itemImg(it.id)), itemName(it.id), h('span.num', F.pct(it.pick)))))) : null);

    // правая колонка: паверспайки, кто играет, забрать в игру
    const rightParts = [];
    rightParts.push(h('section.panel', h('h2', 'Урон вокруг покупки предметов'),
      v.spikes.length
        ? h('div.spikes', v.spikes.slice(0, 2).map((s) => spikeCard(s)))
        : h('div.muted', 'Явных скачков урона не нашёл: мало игр или урон у топов растёт ровно.'),
      v.spikes.length ? h('div.hint', { style: { marginTop: '10px' } }, 'Темп урона по героям за три минуты до и после покупки. На результат влияют и события матча.') : null));
    rightParts.push(heroMatchupPanel(d.heroId));
    if (d.players.length) {
      const max = d.players[0].games;
      rightParts.push(h('section.panel', h('h2', 'Кто из топов играет'),
        d.players.slice(0, 8).map((p) => h('a', { href: '#', style: { display: 'block', padding: '9px 0', borderTop: '1px solid var(--line)', color: 'var(--text)' }, onclick: (e) => { e.preventDefault(); openPlayer(p.accountId); } },
          h('div.row', { style: { justifyContent: 'space-between' } }, h('span', h('b', p.name), ' ', h('span.muted', { style: { fontSize: '12px' } }, p.rank ? `#${p.rank}` : '')),
            h('span.num', { style: { color: p.spam ? 'var(--orange-2)' : 'var(--text-2)' } }, `${p.games} ${plural(p.games, 'игра', 'игры', 'игр')} · ${Math.round((p.wins / Math.max(1, p.games)) * 100)}% побед`)),
          h(`div.bar${p.spam ? '.hot' : ''}`, { style: { marginTop: '7px' } }, h('span', { style: { width: `${(p.games / max) * 100}%` } }))))));
    }
    const copyTopsCode = async () => {
      try {
        const stage = (name, list) => ({ name, items: list.map((it) => ({ id: it.id, note: `берут ${F.pct(it.pick)} топов, ≈ ${F.time(it.medianT)}` })) });
        const cats = [stage('Начало (до 10:00)', v.build.phases.early), stage('Середина (10–20 мин)', v.build.phases.mid), stage('Поздняя игра (20+ мин)', v.build.phases.late)];
        if (v.build.situational.length) cats.push({ ...stage('По ситуации', v.build.situational.slice(0, 10)), optional: true });
        const sk = d.skills && d.skills.path ? d.skills.path.map((x) => ({ id: x.id, level: x.level })) : [];
        const r = await dc.encodeGameBuild({
          heroId: d.heroId,
          name: `${heroName(d.heroId)} — сборка топ-${S.settings.topN}`,
          description: `${v.label}. ${v.games} игр топов, винрейт ${F.pct(v.winrate)}. Собрано в Deadlock Coach.`,
          categories: cats,
          abilities: sk,
        });
        await dc.copy(r.code);
        toast('Код сборки топов скопирован — вставь его в редакторе сборок в игре', false, 6000);
      } catch (e) {
        toast(e.message, true);
      }
    };
    rightParts.push(h('section.panel', { id: 'in-game' }, h('h2', 'Забрать в игру'),
      h('button.btn.primary', { style: { width: '100%', justifyContent: 'center', marginBottom: '10px' }, onclick: copyTopsCode, title: PASTE_HOWTO }, Icon('zap'), 'Скопировать код сборки топов'),
      h('div.muted', { style: { fontSize: '12.5px', marginBottom: '12px' } }, PASTE_HOWTO, ' В код входят основные предметы этой сборки по стадиям, «по ситуации» и самый частый порядок прокачки топов.'),
      h('div.muted', { style: { fontSize: '12.5px', margin: '4px 0 8px' } }, 'Или похожая опубликованная сборка — скопируй ID и вставь в поиск в «Обзоре сборок»:'),
      v.similar.length ? v.similar.map((b) => similarCard(b, 'Совпадение с основными предметами сборки'))
        : h('div.muted', d.buildsError ? `Не удалось загрузить билды: ${d.buildsError}` : 'Похожих опубликованных билдов не нашлось.')));
    parts.push(h('div.row', { style: { alignItems: 'flex-start', gap: '18px' } }, left, h('div', { style: { flex: '1 1 360px', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '18px' } }, rightParts)));
    parts.push(skillsPanel(d.skills, { title: 'Порядок прокачки у топов', who: 'топов' }));
    return h('div', parts);
  }

  // ================= СКИЛЛ-БИЛД =================
  const abilityName = (id) => itemName(id);
  function abilityIcon(id, n) {
    const it = S.assets.items[id];
    return h('span.ab-ico', { title: abilityName(id) }, it && it.img ? h('img', { src: it.img, alt: '', loading: 'lazy' }) : null, h('i', n));
  }

  // Таблица прокачки: строки — способности, столбцы — очки по порядку.
  // steps: [{ id, level, share? }]
  function skillGrid(abilities, steps, { compact = false } = {}) {
    if (!abilities || !abilities.length || !steps || !steps.length) return null;
    const cols = Math.max(steps.length, 16);
    const head = h('div.skb-row.skb-head', h('div.skb-name'), [...Array(cols)].map((_, i) => h('div.skb-cell.num', i + 1)));
    const rows = abilities.map((id, ai) => h('div.skb-row',
      h('div.skb-name', abilityIcon(id, ai === 3 ? 'У' : ai + 1), compact ? null : h('span', abilityName(id))),
      [...Array(cols)].map((_, i) => {
        const st = steps[i];
        if (!st || st.id !== id) return h('div.skb-cell');
        const tip = [`${i + 1}-е очко: ${abilityName(id)}`, st.level === 1 ? 'открытие' : st.level === 4 ? 'максимум' : `улучшение ${st.level - 1}`,
          typeof st.t === 'number' ? `на ${F.time(st.t)}` : null, typeof st.share === 'number' ? `${F.pct(st.share)} игр` : null].filter(Boolean).join(' · ');
        return h(`div.skb-cell.on.l${st.level}${typeof st.share === 'number' && st.share < 0.35 ? '.weak' : ''}`, { title: tip }, st.level === 1 ? '●' : st.level === 4 ? 'M' : st.level - 1);
      })));
    return h(`div.skb-grid${compact ? '.compact' : ''}`, head, rows);
  }

  function skillLegend() {
    return h('div.skb-legend', h('span', h('b', '●'), 'открыл'), h('span', h('b', '1 2'), 'улучшения'), h('span', h('b.max', 'M'), 'максимум'));
  }

  function skillsPanel(sk, { title, who = 'топов', extra = null, compact = false } = {}) {
    if (!sk || !sk.path || !sk.path.length) {
      return h('section.panel', h('h2', title), h('div.muted', 'Нет данных о прокачке способностей: мало игр или в этих матчах её нет.'));
    }
    const facts = [];
    if (sk.firstMax) facts.push(h('div.skb-fact', abilityIcon(sk.firstMax.id, ''), h('div', h('b', `Первой максят «${abilityName(sk.firstMax.id)}»`), h('span', `${F.pct(sk.firstMax.share)} игр ${who}`))));
    if (sk.maxPair && sk.maxPair.ids.length === 2) facts.push(h('div.skb-fact', h('div', h('b', `Потом «${abilityName(sk.maxPair.ids[1])}»`), h('span', `порядок максимумов в ${F.pct(sk.maxPair.share)} игр`))));
    const ult = sk.abilities[3];
    if (ult && sk.timing[ult] && sk.timing[ult].unlock !== null) facts.push(h('div.skb-fact', h('div', h('b', `Ульта — на ${F.time(sk.timing[ult].unlock)}`), h('span', 'обычно открывают'))));
    return h('section.panel.skb-panel',
      h('div.row', { style: { justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' } }, h('h2', { style: { margin: 0 } }, title), h('span.muted.small', `по ${sk.games} ${plural(sk.games, 'игре', 'играм', 'играм')} ${who}`)),
      facts.length ? h('div.skb-facts', facts) : null,
      skillGrid(sk.abilities, sk.path, { compact }),
      h('div.row', { style: { justifyContent: 'space-between', marginTop: '8px', flexWrap: 'wrap', gap: '8px' } }, skillLegend(),
        h('span.muted.small', 'Самый частый путь: на каждом шаге — что чаще всего брали дальше. Бледные клетки — шаги без явного лидера.')),
      extra);
  }

  // ================= ВЫГРУЗКА БИЛДА ИЗ МАТЧА =================
  const BM = { data: null, loading: false, error: null, back: null };

  async function openBuild(matchId, accountId, back = null) {
    BM.data = null;
    BM.error = null;
    BM.loading = true;
    BM.back = back;
    renderBuildModal();
    try {
      BM.data = await dc.matchBuild(matchId, accountId);
    } catch (e) {
      BM.error = e.message;
    } finally {
      BM.loading = false;
      renderBuildModal();
    }
  }

  function renderBuildModal() {
    const box = $('modal');
    box.hidden = false;
    const close = h('button.btn.small', { onclick: closeModal }, 'Закрыть', Icon('close'));
    const back = BM.back ? h('button.btn.small.ghost', { onclick: () => BM.back() }, '← К матчу') : null;
    let body;
    if (BM.loading) body = [skeleton('Собираю билд из матча')];
    else if (BM.error) body = [h('div.empty', h('strong', 'Не получилось собрать билд'), BM.error)];
    else body = buildExportBody(BM.data);
    const sheet = h('div.modal-sheet', h('div.row', { style: { justifyContent: 'space-between', marginBottom: '6px' } }, back || h('span'), close), body);
    box.replaceChildren(h('div.modal-back', { onclick: closeModal }), sheet);
  }

  function buildCard(b) {
    const stageCol = (st) => h('div.bc-stage', h('div.bc-stage-name', st.name),
      st.items.length ? h('div.bc-items', st.items.map((it) => h(`div.bc-item${slotClass(it.id) ? '.' + slotClass(it.id) : ''}${it.fate === 'sold' ? '.sold' : ''}`, { title: `${itemName(it.id)} · ${F.time(it.t)}${it.fate === 'sold' ? ` · продан на ${F.time(it.soldT)}` : it.fate === 'upgraded' ? ` · улучшен до «${itemName(it.into)}»` : ''}` },
        itemImg(it.id), h('span.num', F.time(it.t))))) : h('div.muted.small', '—'));
    return h('div.build-export', { id: 'build-card' },
      h('div.bc-head', heroIcon(b.hero_id),
        h('div.grow', h('div.bc-title', `${heroName(b.hero_id)} — билд ${b.playerName}`),
          h('div.bc-sub', `${b.won ? 'Победа' : 'Поражение'} · ${b.k}/${b.d}/${b.a} · ${F.num(b.nw)} душ${b.duration_s ? ` · ${F.time(b.duration_s)}` : ''} · матч ${b.match_id}`)),
        h('div.bc-brand', 'DEADLOCK', h('span', 'COACH'))),
      b.skills.steps.length ? h('div.bc-block', h('div.bc-label', 'Способности'), skillGrid(b.skills.abilities, b.skills.steps)) : null,
      h('div.bc-block', h('div.bc-label', 'Предметы по стадиям'), h('div.bc-stages', b.stages.map(stageCol))),
      b.final.length ? h('div.bc-block', h('div.bc-label', 'К концу игры'), h('div.bc-final', b.final.map((it) => h('span.bc-fin', itemImg(it.id), itemName(it.id))))) : null);
  }

  // Как вставить код билда в игру — одинаковая подсказка везде.
  const PASTE_HOWTO = 'В игре выбери этого героя → B → «Обзор сборок» → «Создать сборку» → в редакторе нажми кнопку вставки из буфера обмена → сохрани. Сборка появится в «Мои сборки».';

  function similarCard(x, scoreTitle) {
    const id = x.id !== null && x.id !== undefined ? String(x.id) : null;
    return h('div.build-card',
      h('div.grow', h('div.build-name', x.name), h('div.muted', { style: { fontSize: '12px' } }, `${id ? `ID ${id} · ` : ''}в избранном у ${F.num(x.favorites)} · ${x.itemIds.length} предметов`)),
      h('div.score', { title: scoreTitle }, F.pct(x.score)),
      id
        ? h('button.btn.small', { title: 'Скопировать ID сборки — по нему поиск в игре находит её точно', onclick: () => dc.copy(id).then(() => toast(`ID ${id} скопирован — вставь его в поиск в «Обзоре сборок»`)) }, Icon('copy'), 'ID')
        : h('button.btn.small.icon', { title: 'Скопировать название', onclick: () => dc.copy(x.name).then(() => toast('Название скопировано')) }, Icon('copy')));
  }

  function buildExportBody(b) {
    const fileName = `${heroName(b.hero_id)} ${b.playerName} ${b.match_id}`;
    const rectOf = () => {
      const el = $('build-card');
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: Math.min(r.height, window.innerHeight - r.top) };
    };
    const withText = async (fn) => {
      try {
        const t = await dc.buildText(b);
        await fn(t);
      } catch (e) {
        toast(e.message, true);
      }
    };
    const actions = h('div.bc-actions',
      h('button.btn.primary', { title: PASTE_HOWTO, onclick: () => withText((t) => dc.copy(t.gameCode).then(() => toast('Код билда скопирован — вставь его в редакторе сборок в игре', false, 6000))) }, Icon('zap'), 'Скопировать код для игры'),
      h('button.btn', { onclick: () => withText((t) => dc.copy(t.text).then(() => toast('Билд скопирован текстом — вставь в Discord или заметки'))) }, Icon('copy'), 'Скопировать текстом'),
      h('button.btn', { onclick: async () => { try { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); await dc.copyBuildImage(rectOf()); toast('Картинка билда скопирована — вставь её в Discord'); } catch (e) { toast(e.message, true); } } }, 'Скопировать картинкой'),
      h('button.btn', { onclick: async () => { try { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const r = await dc.buildPng(rectOf(), fileName); if (r.saved) toast('Картинка сохранена'); } catch (e) { toast(e.message, true); } } }, 'Сохранить картинку'),
      h('button.btn.ghost', { onclick: () => withText(async (t) => { const r = await dc.saveBuild(fileName, t.text, 'txt'); if (r.saved) toast('Текст билда сохранён'); }) }, 'Сохранить .txt'),
      h('button.btn.ghost', { onclick: () => withText(async (t) => { const r = await dc.saveBuild(fileName, t.file, 'json'); if (r.saved) toast('Файл билда сохранён'); }) }, 'Сохранить .json'));
    const similar = h('section.panel', { style: { marginTop: '16px' } }, h('h2', 'Как забрать в игру'),
      h('ol.howto',
        h('li', h('b', 'Код для игры. '), 'Нажми «Скопировать код для игры». ', PASTE_HOWTO, ' Переносятся предметы по стадиям и порядок прокачки способностей.'),
        h('li', h('b', 'Или похожая опубликованная сборка. '), 'Скопируй её ID и вставь в поиск в «Обзоре сборок» (вкладка «От сообщества») — по ID она находится точно, по названию поиск часто промахивается.')),
      b.similar && b.similar.length ? b.similar.map((x) => similarCard(x, 'Совпадение с предметами из этого матча'))
        : h('div.muted', b.similarError ? `Не удалось загрузить опубликованные билды: ${b.similarError}` : 'Похожих опубликованных билдов не нашлось.'));
    const noSkills = !b.skills.steps.length ? h('div.note', { style: { marginTop: '10px' } }, Icon('info'), h('div', 'В данных этого матча нет прокачки способностей — в билде только предметы.')) : null;
    return [buildCard(b), noSkills, actions, similar];
  }

  // ---------- избранные игроки: поиск по нику и добавление ----------
  async function doSearch(q) {
    S.search = { q, loading: true, results: null, error: null };
    renderMeta();
    try {
      S.search.results = await dc.searchPlayers(q);
    } catch (e) {
      S.search.error = e.message;
    } finally {
      S.search.loading = false;
      renderMeta();
    }
  }

  async function addFav(accountId, name) {
    try {
      S.favs = await dc.addFavorite(accountId, name);
      S.top = null;
      toast(`${name} добавлен. Нажми «Обновить данные», чтобы скачать его матчи.`);
    } catch (e) {
      toast(e.message, true);
    }
    renderMeta();
  }

  async function removeFav(accountId) {
    S.favs = await dc.removeFavorite(accountId);
    S.top = null;
    renderMeta();
  }

  function favoritesBlock() {
    const input = h('input.input', { placeholder: 'Ник, ссылка на профиль Steam или ID', value: S.search.q, style: { flex: '1' },
      onkeydown: (e) => { if (e.key === 'Enter' && input.value.trim()) doSearch(input.value.trim()); } });
    const favIds = new Set(S.favs.map((f) => f.accountId));
    const parts = [
      h('div.fav-head', h('h2', 'Избранные игроки'), h('span.muted', `${S.favs.length} — их игры всегда входят в мету и сравнение`)),
      h('div.row.nowrap', input, h('button.btn', { onclick: () => input.value.trim() && doSearch(input.value.trim()), disabled: S.search.loading }, Icon('search'), S.search.loading ? 'Ищу…' : 'Найти')),
    ];
    if (S.search.error) parts.push(h('div.muted', { style: { marginTop: '8px' } }, S.search.error));
    if (S.search.results) {
      if (!S.search.results.length) parts.push(h('div.muted', { style: { marginTop: '8px' } }, 'Никого не нашёл. Попробуй точный ник из Steam или вставь ссылку на профиль.'));
      for (const r of S.search.results) {
        parts.push(h('div.search-row',
          r.avatar ? h('img.hero-ico', { src: r.avatar, alt: '' }) : h('div.hero-ico.ph', 'ID'),
          h('div.grow',
            h('div', h('b', r.name), h('span.dim', `  ID ${r.accountId}`)),
            h('div.muted.small', r.totalGames ? `${r.games14} ${plural(r.games14, 'игра', 'игры', 'игр')} за 14 дней, последняя ${F.ago(r.lastPlayed)}` : 'нет матчей Deadlock в API — скорее всего, не тот аккаунт'),
            r.heroes && r.heroes.length ? h('div.row', { style: { gap: '4px', marginTop: '6px' } }, r.heroes.map((x) => h('span.chip', heroIcon(x.hero_id, '.sm'), heroName(x.hero_id), ` ${x.games}`))) : null),
          favIds.has(r.accountId) ? h('span.pill.good', 'уже в избранном') : h('button.btn.small', { onclick: () => addFav(r.accountId, r.name) }, 'Добавить')));
      }
    }
    if (S.favs.length) {
      parts.push(h('div.fav-list', S.favs.map((f) => h('span.fav', { title: [f.team, f.country].filter(Boolean).join(', ') },
        h('button.fav-name', { onclick: () => openPlayer(f.accountId) }, f.name),
        h('button.x', { title: 'Убрать из избранного', 'aria-label': `Убрать ${f.name}`, onclick: () => removeFav(f.accountId) }, Icon('close'))))));
    }
    return h('div.panel.favs', parts);
  }

  // ---------- окно с подробностями матча ----------
  const MD = { data: null, chart: 'nw', loading: false, error: null };

  function closeModal() {
    $('modal').hidden = true;
    $('modal').replaceChildren();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('modal').hidden) closeModal();
  });

  async function openMatchDetail(matchId, accountId) {
    MD.data = null;
    MD.error = null;
    MD.loading = true;
    MD.chart = 'nw';
    renderModal();
    try {
      MD.data = await dc.matchDetail(matchId, accountId);
    } catch (e) {
      MD.error = e.message;
    } finally {
      MD.loading = false;
      renderModal();
    }
  }

  function renderModal() {
    const box = $('modal');
    box.hidden = false;
    const close = h('button.btn.small', { onclick: closeModal }, 'Закрыть', Icon('close'));
    let body;
    if (MD.loading) body = [h('div.row', h('span.spin'), 'Загружаю матч…')];
    else if (MD.error) body = [h('div.empty', h('strong', 'Не получилось открыть матч'), MD.error)];
    else body = matchDetailBody(MD.data);
    const sheet = h('div.modal-sheet', h('div.row', { style: { justifyContent: 'flex-end', marginBottom: '6px' } }, close), body);
    box.replaceChildren(h('div.modal-back', { onclick: closeModal }), sheet);
  }

  function matchDetailBody(d) {
    const f = d.focus;
    const me = d.players.find((p) => p.focus) || d.players[0];
    const parts = [];
    const toBuild = (accountId) => openBuild(d.match.match_id, accountId, () => renderModal());
    parts.push(h('div.row', { style: { marginBottom: '14px' } }, heroIcon(f.hero_id),
      h('div.grow', h('h2', { style: { margin: 0 } }, `${me.name} — ${heroName(f.hero_id)}, ${f.won ? 'победа' : 'поражение'}`),
        h('div.muted', `Матч ${d.match.match_id} · ${F.clock(d.match.start_time)} · ${F.time(d.match.duration_s)} · ${me.k}/${me.d}/${me.a} · ${F.num(me.nw)} душ · ${F.num(me.pdmg)} урона по героям`)),
      h('button.btn.small', { onclick: () => toBuild(f.account_id), title: 'Предметы и прокачка способностей из этой игры — картинкой, текстом или файлом' }, Icon('download'), 'Выгрузить билд')));

    // таблица обеих команд
    const teamTable = (team) => {
      const rows = d.players.filter((p) => p.team === team).sort((a, b) => b.nw - a.nw);
      const won = rows.length && rows[0].won;
      return h('div.panel', h('h3', `${won ? 'Победители' : 'Проигравшие'} · команда ${team + 1}`),
        h('table.table', h('thead', h('tr', h('th', 'Игрок'), h('th.r', 'K/D/A'), h('th.r', 'Души'), h('th.r', 'Урон'), h('th.r', 'Крипы'), h('th'))),
          h('tbody', rows.map((p) => h(`tr${p.focus ? '.selected' : ''}`,
            h('td', h('div.hero-cell', heroIcon(p.hero_id, '.sm'), h('span', p.name), p.rank ? h('span.pill', `#${p.rank}`) : null, p.favorite ? h('span.fav-star', Icon('star')) : null)),
            h('td.r.num', `${p.k}/${p.d}/${p.a}`),
            h('td.r.num', F.k(p.nw)),
            h('td.r.num', F.k(p.pdmg)),
            h('td.r.num', p.lh),
            h('td.r', p.account_id ? h('button.btn.small.icon.ghost', { title: `Выгрузить билд: ${p.name}`, 'aria-label': `Выгрузить билд ${p.name}`, onclick: () => toBuild(p.account_id) }, Icon('download')) : null))))));
    };
    parts.push(h('div.grid-2', teamTable(f.team), teamTable(f.team === 0 ? 1 : 0)));
    const focusSlot = d.map ? (d.map.players.find((p) => p.account_id === f.account_id) || {}).slot : null;
    if (d.map) parts.push(mapPanel(d.map, focusSlot ?? null, 'Карта матча', me.name));

    // графики
    const tabs = [['nw', 'Души'], ['pdmg', 'Урон по героям'], ['farm', 'Крипы'], ['ka', 'Убийства + помощь']];
    parts.push(h('div.panel', { style: { marginTop: '16px' } },
      h('div.row', h('h2', { style: { margin: 0 } }, 'По минутам'), h('div.grow'),
        h('div.legend', h('span', h('i', { style: { background: 'var(--you)' } }), me.name), h('span', h('i', { style: { background: 'var(--top)' } }), 'медиана остальных 11 игроков'))),
      h('div.tabs', { style: { marginTop: '10px' } }, tabs.map(([k, label]) => h('button.tab' + (MD.chart === k ? '.active' : ''), { onclick: () => { MD.chart = k; renderModal(); } }, label))),
      Charts.lineChart(d.curves[MD.chart], { yFmt: MD.chart === 'ka' ? (v) => String(Math.round(v)) : (v) => F.k(v), meLabel: me.name, topLabel: 'Остальные', markers: f.deaths.map((t) => ({ minute: t / 60, color: 'var(--bad)' })) }),
      f.deaths.length ? h('div.hint', `Красные вертикали — смерти: ${f.deaths.map(F.time).join(', ')}${f.lost ? ` (потеряно ${F.num(f.lost)} душ)` : ''}.`) : null));

    // предметы по порядку
    parts.push(h('div.panel', h('h2', 'Покупки по порядку'),
      h('div.buy-list', d.items.map((it) => h(`div.buy${slotClass(it.id) ? '.' + slotClass(it.id) : ''}`,
        h('span.buy-time.num', F.time(it.t)), h('span.mini-items', itemImg(it.id)), h('span', itemName(it.id)),
        it.fate === 'upgraded' ? h('span.dim', ` · улучшен${it.into && S.assets.items[it.into] ? ' до «' + itemName(it.into) + '»' : ''} на ${F.time(it.sold)}`)
          : it.sold && it.fate !== 'kept' ? h('span.sold', ` · продан на ${F.time(it.sold)}`) : null)))));

    // скачки урона
    if (d.jumps.length) {
      parts.push(h('div.panel', h('h2', 'Когда он включался в игру'),
        h('div.hint', { style: { marginBottom: '10px' } }, 'Покупки, после которых его урон по героям резко вырос в этом матче.'),
        h('div.spikes', d.jumps.map((j) => h('div.spike',
          h('div.spike-head', h('span.mini-items', itemImg(j.id)), h('b', itemName(j.id)), h('span.pill.hot', Icon('zap'), `куплен на ${F.time(j.t)}`)),
          spikeChart(j.before, j.after, `Урон по героям: ${F.num(j.before)} в минуту до покупки, ${F.num(j.after)} после`),
          h('div.spike-stats',
            h('div', h('b', { style: { color: 'var(--good)' } }, F.signedPct(j.lift - 1)), h('span', 'сверх обычного роста')),
            h('div', h('b', j.participated === true ? 'да' : j.participated === false ? 'нет' : '—'), h('span', 'убийство или помощь за 3 минуты'))))))));
    }

    // источники душ
    const max = Math.max(1, ...d.sources.map((x) => x.value || 0));
    parts.push(h('div.panel', h('h2', 'Откуда души за матч'),
      d.sources.map((x) => h('div.src-row', h('div', x.name),
        h('div.src-bars', h('span.you', { style: { width: `${((x.value || 0) / max) * 100}%` } })),
        h('div.r.num', { style: { textAlign: 'right' } }, F.num(x.value))))));
    return parts;
  }

  function recentChips(recent) {
    if (!recent || !recent.heroes || !recent.heroes.length) return h('span.dim', '—');
    return h('div.row.nowrap', { style: { gap: '4px' } }, recent.heroes.slice(0, 4).map((x) =>
      h('span.chip', { title: `${heroName(x.hero_id)}: ${x.games} из ${recent.n} последних игр` }, heroIcon(x.hero_id, '.sm'), h('span', x.games))));
  }

  function spamPill(recent) {
    if (!recent || !recent.spam) return null;
    return h('span.pill.hot', { title: `${heroName(recent.spam.hero_id)} в ${recent.spam.games} из ${recent.spam.of} последних игр` }, Icon('flame'), `спамит ${heroName(recent.spam.hero_id)}`);
  }

  async function openPlayer(accountId) {
    if (!accountId) return;
    if (navKey() !== 'players') setView('players');
    S.selectedPlayer = Number(accountId);
    S.playerDetail = null;
    S.playerLoading = true;
    renderMeta();
    try {
      S.playerDetail = await dc.playerDetail(accountId);
    } catch (e) {
      toast(e.message, true);
    } finally {
      S.playerLoading = false;
      if (S.selectedPlayer === Number(accountId)) renderMeta();
    }
  }

  function playersSection(m) {
    if (!S.top) {
      dc.topList().then((t) => {
        S.top = t || { players: [] };
        renderMeta();
      });
      return h('div.panel', h('span.spin'));
    }
    const info = new Map(S.top.players.map((p) => [p.name, p]));
    const warn = (t) => {
      if (!t || !t.accountId) return h('span.flag.bad', 'аккаунт не найден');
      if (t.how === 'guess' || t.how === 'search') return h('span.flag', { title: 'Аккаунт определён по нику — может быть не тот' }, 'аккаунт угадан');
      return null;
    };
    // место — только настоящее место в ладдере региона; ранг — из последней рейтинговой игры игрока
    const inLadder = (t) => !!t && (t.ladder !== undefined ? t.ladder : ['exact', 'guess', 'search', 'manual'].includes(t.how)) && t.rank;
    const badgeText = (b) => (b ? `${rankName(Math.floor(b / 10))} ${b % 10}` : '—');
    const rows = m.players.slice().sort((a, b) => {
      const ta = info.get(a.name);
      const tb = info.get(b.name);
      const la = inLadder(ta) ? ta.rank : 1e6;
      const lb = inLadder(tb) ? tb.rank : 1e6;
      return la - lb || ((tb && tb.badge) || 0) - ((ta && ta.badge) || 0);
    });
    const dropped = S.top.players.filter((p) => p.excluded);
    const table = h('table.table.players',
      h('thead', h('tr', h('th.r', { title: 'Место в ладдере региона' }, 'Ладдер'), h('th', 'Игрок'), h('th', { title: 'Ранг по последней рейтинговой игре' }, 'Ранг'), h('th.r', 'Игр'), h('th.r', 'Винрейт'), h('th', 'На ком играет'))),
      h('tbody', rows.map((p) => {
        const t = info.get(p.name);
        const recent = t && t.recent;
        const fav = t && t.favorite;
        return h(`tr.click${S.selectedPlayer === p.accountId ? '.selected' : ''}`, { onclick: () => openPlayer(p.accountId) },
          h('td.r.num', inLadder(t) ? `№${t.rank}` : h('span.dim', { title: t && t.favorite ? 'Избранный игрок' : 'Не в ладдере: добран из свежих матчей по рангу' }, t && t.how === 'favorite' ? 'избр.' : 'вне')),
          h('td', h('div.pname', fav ? h('span.fav-dot', { title: 'В избранном' }) : null, h('b', p.name)),
            h('div.psub', t && t.team ? h('span', t.team) : null, recent && recent.spam ? h('span.spam', `спамит ${heroName(recent.spam.hero_id)}`) : null, warn(t))),
          h('td.num', t && t.badge ? badgeText(t.badge) : h('span.dim', '—')),
          h('td.r.num', p.games || '—'),
          h('td.r.num', p.games ? F.pct(p.wins / p.games) : '—'),
          h('td', recentChips(recent)));
      })));
    const droppedNote = dropped.length ? h('div.hint.pad', `Отсеяно ${dropped.length} ${plural(dropped.length, 'игрок', 'игрока', 'игроков')} не из ладдера с рангом ниже Phantom (или без рейтинговых игр): ${dropped.slice(0, 6).map((p) => `${p.name}${p.badge ? ` — ${badgeText(p.badge)}` : ''}`).join(', ')}${dropped.length > 6 ? '…' : ''}. Их матчи в мету не идут.`) : null;
    return h('div', favoritesBlock(), h('div.meta-split', h('div.panel.flush', h('div.table-scroll', table),
      h('div.hint.pad', '«Ладдер» — место в таблице лидеров региона; «вне» — игрока там пока нет, он добран из свежих матчей и проверен по рангу (не ниже Phantom). «Спамит» — один герой занимает половину или больше последних 20 игр.'), droppedNote),
    h('div.sticky', playerDetailPanel())));
  }

  function playerDetailPanel() {
    if (!S.selectedPlayer) return h('div.empty', h('strong', 'Выбери игрока'), 'Покажу его последние матчи: героя, результат, KDA и купленные предметы, и на ком он сейчас сидит.');
    if (S.playerLoading || !S.playerDetail) return h('div.panel', h('div.row', h('span.spin'), 'Загружаю матчи игрока…'));
    const d = S.playerDetail;
    const p = d.player;
    const r = p.recent;
    const parts = [
      h('div.row', { style: { marginBottom: '10px' } },
        h('div.grow', h('h2', { style: { margin: 0 } }, `${p.rank ? '#' + p.rank + ' ' : ''}${p.name}`), h('div.muted', `${p.team ? p.team + ' · ' : ''}ID ${p.accountId}${r && r.lastPlayed ? ' · последняя игра ' + F.ago(r.lastPlayed) : ''}`)),
        h('button.btn.small', { onclick: () => dc.copy(String(p.accountId)).then(() => toast('ID скопирован')) }, 'Скопировать ID')),
    ];
    if (r && r.spam) parts.push(h('div.note.hot', Icon('flame'), h('div', `Сейчас спамит ${heroName(r.spam.hero_id)}: ${r.spam.games} из ${r.spam.of} последних игр.`)));
    if (r && r.heroes && r.heroes.length) {
      parts.push(h('h3', `На ком играет (последние ${r.n} ${plural(r.n, 'игра', 'игры', 'игр')})`));
      const max = r.heroes[0].games;
      parts.push(h('div', r.heroes.map((x) => h('div.hero-bar',
        heroIcon(x.hero_id, '.sm'), h('span.hero-bar-name', heroName(x.hero_id)),
        h('div.bar.grow', h('span', { style: { width: `${(x.games / max) * 100}%` } })),
        h('span.num', `${x.games}`), h('span.muted.num', { style: { width: '74px', textAlign: 'right' } }, x.known ? `${F.pct(x.wins / x.known)} побед` : '')))));
    }
    if (d.error) parts.push(h('div.muted', `История недоступна: ${d.error}`));
    parts.push(h('h3', { style: { marginTop: '16px' } }, 'Последние матчи'));
    if (!d.games.length) parts.push(h('div.muted', 'Матчей не найдено.'));
    for (const g of d.games) {
      parts.push(h(`div.pgame.click${g.won === true ? '.win' : g.won === false ? '.loss' : ''}`, { title: 'Открыть матч подробно', onclick: () => openMatchDetail(g.match_id, p.accountId) },
        heroIcon(g.hero_id, '.sm'),
        h('div.pgame-main',
          h('div.row', { style: { gap: '8px' } }, h('b', heroName(g.hero_id)), h('span.muted', `${F.ago(g.start_time)}${g.duration_s ? ' · ' + F.time(g.duration_s) : ''}`),
            g.won === true ? h('span.res.win', 'победа') : g.won === false ? h('span.res.loss', 'поражение') : null),
          g.items ? h('div.mini-items', { style: { marginTop: '4px', flexWrap: 'wrap' } }, g.items.map((it) => h('span', { title: `${itemName(it.id)} — ${F.time(it.t)}` }, itemImg(it.id))))
            : h('div.dim', { style: { fontSize: '12px' } }, 'предметы — после скачивания матча')),
        h('div.pgame-kda.num', g.k !== undefined ? `${g.k}/${g.d}/${g.a}` : '', h('div.dim', g.nw ? `${F.k(g.nw)} душ` : ''))));
    }
    return h('div.panel', parts);
  }

  // ================= СКЕЛЕТОНЫ И ПОЯВЛЕНИЕ =================
  function skeleton(caption, kind = 'page') {
    const blocks = kind === 'list'
      ? [h('div.sk.sk-row'), h('div.sk.sk-row'), h('div.sk.sk-row'), h('div.sk.sk-row')]
      : [h('div.sk-grid', h('div.sk.sk-tile'), h('div.sk.sk-tile'), h('div.sk.sk-tile'), h('div.sk.sk-tile')), h('div.sk.sk-block'), h('div.sk-grid.two', h('div.sk.sk-block.short'), h('div.sk.sk-block.short'))];
    return h('div.skeleton', { 'aria-busy': 'true' }, h('div.sk-caption', h('span.spin'), caption), blocks);
  }
  function animateView(id) {
    const el = $(`view-${id}`);
    if (!el) return;
    if (window.FX) { window.FX.enter(el); return; }
    el.classList.remove('enter');
    void el.offsetWidth;
    el.classList.add('enter');
    clearTimeout(el._enterT);
    el._enterT = setTimeout(() => el.classList.remove('enter'), 900);
  }

  // ================= ТРЕНЕР =================
  async function loadCoach(forceNew = false, evidence = null) {
    if (!S.auth) return;
    S.coach.loading = true;
    S.coach.error = null;
    if (S.view === 'coach') renderCoach();
    try {
      S.coach.data = await dc.coach({ forceNew, evidence });
      S.coach.for = S.auth.accountId;
      if (forceNew) toast('Новый план готов');
    } catch (e) {
      S.coach.error = e.message;
      // Ошибка валидации эпизода («Отслеживать в тренере») не должна молчать:
      // игрок остаётся на экране «Ошибки» и без объяснения не поймёт, что цель не создалась.
      if (evidence) toast(e.message);
    } finally {
      S.coach.loading = false;
      if (S.view === 'coach') renderCoach();
      if (S.view === 'overview') renderOverview();
    }
  }

  const goalStatus = { active: 'в работе', done: 'выполнена', expired: 'неделя закончилась' };

  function goalCard(g) {
    const heroTargets = g.byHero ? Object.entries(g.byHero).filter(([hid]) => S.assets.heroes[hid]) : [];
    const rate = g.rate;
    return h(`div.goal.${g.status}`,
      h('div.goal-head',
        h('span.goal-area', g.area, g.kind === 'stretch' ? h('span.goal-kind', { title: 'Явной проблемы тут нет, но ты чуть ниже топов на своих героях — цель дотянуться до их уровня.' }, ' · до уровня топов') : null),
        h('span.goal-state', g.status === 'done' ? Icon('trophy') : null, goalStatus[g.status] || g.status)),
      h('div.goal-title', g.title),
      heroTargets.length ? h('div.goal-heroes', h('span.muted.small', 'Пороги по героям'),
        heroTargets.slice(0, 4).map(([hid, t]) => h('span.chip', heroIcon(Number(hid), '.sm'), String(g.key === 'firstBigT' || g.key === 'firstHugeT' ? F.time(t) : g.key === 'kp' || g.key === 'spikeFights' ? F.pct(t) : F.num(t))))) : null,
      h('div.goal-stats',
        h('div', h('b.num', g.games ? `${g.passed}/${g.games}` : '—'), h('span', 'игр с выполнением')),
        h('div', h('b.num', g.streak ? `${g.streak}` : '0'), h('span', 'подряд')),
        h('div', h('b.num', g.baselineText), h('span', 'было обычно'))),
      g.games ? Charts.goalChart(g.rows, g.cmp) : h('div.muted.small', g.rows.length ? 'Жду подробности матчей для проверки цели.' : 'Пока нет игр для проверки цели.'),
      g.games ? h('div.goal-bar', h('span', { style: { width: `${Math.round((rate || 0) * 100)}%` } })) : null,
      g.tip ? h('div.tip', Icon('bulb'), h('span', g.tip)) : null);
  }

  const coachTarget = (check) => `${check.cmp === 'ge' ? '≥' : '≤'} ${check.targetText}`;

  function gameCard(c) {
    return h(`button.gcard${c.won ? '.win' : c.won === false ? '.loss' : ''}`, { onclick: () => { setView('matches'); openMatch(c.match_id); }, title: 'Открыть разбор матча' },
      h('div.gcard-head', heroIcon(c.hero),
        h('div.grow', h('div.gcard-title', heroName(c.hero), h('span', { class: `res ${c.won ? 'win' : 'loss'}` }, c.won ? 'победа' : 'поражение')),
          h('div.gcard-sub', `${c.start_time ? F.ago(c.start_time + (c.duration_s || 0)) : ''} · ${F.time(c.duration_s)} · ${c.k}/${c.d}/${c.a}`)),
        c.counted ? h(`div.gcard-score${c.passed === c.counted ? '.full' : c.passed === 0 ? '.zero' : ''}`, h('b.num', `${c.passed}/${c.counted}`), h('span', 'цели')) : null),
      c.checks.length ? h('div.gcard-checks', c.checks.map((x) => h(`span.check-chip${x.pass === true ? '.ok' : x.pass === false ? '.no' : ''}`,
        x.pass === true ? '✓' : x.pass === false ? '✕' : '·', ` ${x.short}: `, h('b', x.pass === null ? 'жду данные' : x.text), ` · цель ${coachTarget(x)}`))) : null,
      c.mistake ? h('div.gcard-mistake', h('b', c.mistake.title), c.mistake.tip ? h('div', c.mistake.tip) : null) : null,
      c.good ? h('div.gcard-good', '+ ', c.good.title) : null);
  }

  function renderCoach() {
    const v = $('view-coach');
    if (!v) return;
    const d = S.coach.data;
    const head = h('div.page-head',
      h('div', h('div.crumbs', 'Моя игра / Тренер'), h('h1', 'Тренер'), h('div.sub', 'Цели на неделю из твоих главных проблем, проверка каждой игры и прогресс.')),
      h('div.row',
        h('button.btn', { onclick: () => loadCoach(false), disabled: S.coach.loading || null }, Icon('refresh'), 'Проверить новые игры'),
        d && d.plan ? h('button.btn.primary', { onclick: () => loadCoach(true), disabled: S.coach.loading || null, title: 'Пересчитать цели по последним играм' }, 'Новый план') : null));
    if (!S.auth) {
      v.replaceChildren(head, h('div.empty', h('strong', 'Войди через Steam'), 'Тренер строит план по твоим матчам.', h('div', { style: { marginTop: '14px' } }, h('button.btn.steam', { onclick: login }, 'Войти через Steam'))));
      return;
    }
    if (S.coach.loading && !d) return void v.replaceChildren(head, skeleton('Тренер смотрит твои последние матчи — в первый раз это может занять минуту'));
    if (S.coach.error && !d) return void v.replaceChildren(head, h('div.empty', h('strong', 'Не получилось'), S.coach.error, h('div', { style: { marginTop: '12px' } }, h('button.btn', { onclick: () => loadCoach(false) }, 'Попробовать ещё раз'))));
    if (!d) return void v.replaceChildren(head);
    if (!d.plan) {
      v.replaceChildren(head, h('div.empty', h('strong', 'Мало игр для плана'), `Нужно ещё ${d.need || 5} ${plural(d.need || 5, 'игра', 'игры', 'игр')} с подробными данными. Сыграй пару матчей — и тренер составит план.`));
      return;
    }
    const active = d.goals.filter((g) => g.status === 'active');
    const done = d.goals.filter((g) => g.status === 'done');
    const ends = new Date(d.plan.endsAt * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    const score = d.score;
    const hero = h('div.coach-hero',
      h('div.coach-ring', Charts.ring(score || 0, { size: 132, stroke: 10, color: score === null ? 'var(--line-2)' : score >= 0.7 ? 'var(--good)' : score >= 0.4 ? 'var(--warn)' : 'var(--bad)' }),
        h('div.ring-label', h('b', score === null ? '—' : F.pct(score)), h('span', 'целей выполнено'))),
      h('div.coach-hero-text',
        h('div.coach-kicker', `План до ${ends}`),
        h('div.coach-headline', active.length ? `${active.length} ${plural(active.length, 'цель', 'цели', 'целей')} в работе` : 'Все цели закрыты'),
        h('div.muted', d.gamesSince ? `После начала плана сыграно ${d.gamesSince} ${plural(d.gamesSince, 'игра', 'игры', 'игр')}. Цель закрывается, когда выполнена в 4 из 5 игр подряд.` : 'Сыграй матч — после него здесь появится проверка целей.'),
        !d.topsReady ? h('div.note', { style: { marginTop: '10px' } }, Icon('info'), h('div', 'Данных топов пока нет — цели посчитаны против игроков твоего уровня. Обнови мету в «Мете героев», чтобы цели были по топам.')) : null),
      h('div.coach-hero-stats',
        h('div', h('b.num', String(d.done || 0)), h('span', 'целей закрыто')),
        h('div', h('b.num', String(d.loaded || 0)), h('span', 'игр разобрано'))));
    const focus = active[0];
    const otherGoals = active.slice(1).concat(done);
    const recentChecks = focus ? d.cards.filter((c) => !c.beforePlan && c.start_time >= focus.startedAt - (focus.evidence ? 0 : 60)).slice(0, 5).map((c) => {
      const check = c.checks.find((entry) => entry.key === focus.key);
      return h('button.coach-check-row', { onclick: () => { setView('matches'); openMatch(c.match_id); } },
        heroIcon(c.hero, '.sm'), h('span', heroName(c.hero)), h('span.muted.small', dashboardDate(c.start_time)),
        h(`strong.${check?.pass === true ? 'diff-pos' : check?.pass === false ? 'diff-neg' : 'muted'}`,
          check?.pass === true ? `Выполнено · ${check.text} (цель ${coachTarget(check)})` : check?.pass === false ? `Не выполнено · ${check.text} (цель ${coachTarget(check)})` : 'Жду данные'));
    }) : [];
    const goals = h('section.panel.coach-focus',
      h('h2', 'Главная цель'),
      focus ? goalCard(focus) : h('div.muted', 'Активных целей сейчас нет.'),
      focus?.evidence ? h('div.row', h('button.btn.small', { onclick: () => openGrowthEpisode(focus.evidence) }, `Основание цели · ${F.time(focus.evidence.t)}`),
        focus.priorRate !== null && focus.priorRate !== undefined ? h('span.muted.small', `До начала цели: ${F.pct(focus.priorRate)} проверенных игр`) : null) : null,
      recentChecks.length ? h('div.coach-check-list', recentChecks) : null,
      otherGoals.length ? h('details.coach-other', h('summary', `Другие цели · ${otherGoals.length}`), h('div.goals', otherGoals.map(goalCard))) : null);
    const cards = h('section.panel', h('h2', d.cards.length && d.cards[0].beforePlan ? 'Последние игры (до плана)' : 'Проверка после каждой игры'),
      d.cards.length ? h('div.gcards', d.cards.map(gameCard)) : h('div.muted', 'Игр после начала плана пока нет.'));
    const feedIcon = { plan: 'bulb', done: 'trophy', game: 'zap', streak: 'flame' };
    const feed = h('section.panel', h('h2', 'Сообщения тренера'),
      d.events.length ? h('div.feed', d.events.map((e) => h(`div.feed-item.${e.kind}`,
        h('div.feed-ico', Icon(feedIcon[e.kind] || 'info')),
        h('div', h('div.feed-title', e.title, h('span.dim', ` · ${F.ago(e.t)}`)), h('div.feed-text', e.text))))) : h('div.muted', 'Пока тихо.'));
    const archive = d.archive && d.archive.length ? h('section.panel', h('h2', 'Прошлые цели'),
      h('div.archive', d.archive.map((g) => h(`div.arch.${g.status}`, h('span', g.status === 'done' ? '✓' : '·'), g.title)))) : null;
    v.replaceChildren(head, hero, goals, h('div.coach-cols', cards, h('div.coach-side', feed, archive)));
  }

  // ================= ПЕРЕД ИГРОЙ =================
  const allHeroes = () => Object.values(S.assets.heroes).filter((x) => x && !x.disabled && (x.selectable ?? !x.inDev)).sort((a, b) => a.name.localeCompare(b.name));

  async function loadMyMatchups() {
    const P = S.prep;
    if (!S.auth || P.muLoading) return;
    P.muLoading = true;
    try {
      P.mu = await dc.myMatchups();
      if (!P.myHero && P.mu.myHeroes.length) {
        const suggested = P.mu.myHeroes[0].hero_id;
        if (!P.enemies.includes(suggested)) P.myHero = suggested;
      }
    } catch (e) {
      P.muError = e.message;
    } finally {
      P.muLoading = false;
      if (S.view === 'prep' && S.prep === P) renderPrep();
    }
  }

  // Прогноз для выбранного героя: удобные/неудобные соперники и напарники по линии.
  async function loadOutlook(heroId) {
    const P = S.prep;
    if (!heroId || P.outlook[heroId] !== undefined) return;
    P.outlook[heroId] = null;
    try {
      P.outlook[heroId] = await dc.heroOutlook(heroId);
    } catch (e) {
      P.outlook[heroId] = { error: e.message };
    }
    if (S.view === 'prep' && S.prep === P && P.myHero === heroId) renderPrep();
  }

  async function runPrep() {
    const P = S.prep;
    if (!P.myHero || !P.enemies.length || P.request) return;
    const request = { myHero: P.myHero, enemies: P.enemies, laneFoe: P.laneFoe };
    const current = () => S.prep === P && P.request === request;
    P.request = request;
    renderPrep();
    try {
      const result = await dc.prepareGame(request);
      if (current()) P.result = result;
    } catch (e) {
      if (current()) toast(e.message, true);
    } finally {
      if (current()) {
        P.request = null;
        if (S.view === 'prep') renderPrep();
      }
    }
  }

  function heroGrid(selected, onPick, { mine = [], disabled = new Set(), multi = false, lane = null } = {}) {
    const order = new Map(mine.map((x, i) => [x.hero_id, i]));
    const list = allHeroes().slice().sort((a, b) => (order.has(a.id) ? order.get(a.id) : 999) - (order.has(b.id) ? order.get(b.id) : 999) || a.name.localeCompare(b.name));
    const sel = new Set(multi ? selected : [selected]);
    return h('div.hgrid', list.map((x) => h(`button.hpick${sel.has(x.id) ? '.on' : ''}${lane === x.id ? '.lane' : ''}`, { disabled: disabled.has(x.id) || null, onclick: () => onPick(x.id), title: x.name, style: heroArtStyle(x) },
      (x.card || x.img) ? null : h('span.ph', x.name.slice(0, 2)),
      x.type ? h('b.cls.' + x.type) : null,
      h('span', x.name),
      lane === x.id ? h('i', 'линия') : null)));
  }

  function renderPrep() {
    const v = $('view-prep');
    if (!v) return;
    const P = S.prep;
    const selectionChanged = () => {
      P.request = null;
      P.result = null;
      renderPrep();
    };
    const head = h('div.page-head', h('div', h('div.crumbs', `Мета · топ-${S.settings.topN} / Перед игрой`), h('h1', 'Перед игрой'),
      h('div.sub', 'Выбери своего героя и героев соперников — покажу, как против них играют топы, что докупают и какой у тебя опыт против них.')),
      S.auth ? h('button.btn.primary', { onclick: () => dc.toggleOverlay(true), title: 'Окно поверх игры: отметь соперников в паузе перед рейтинговым матчем — получишь лучший пик из своих героев' }, Icon('zap'), `Оверлей пика${S.settings.overlayKey ? ' · ' + S.settings.overlayKey : ''}`) : null);
    if (!Object.keys(S.assets.heroes).length) return void v.replaceChildren(head, h('div.empty', h('strong', 'Нет списка героев'), 'Нажми «Обновить данные» в «Мете героев».'));
    const mine = (P.mu && P.mu.myHeroes) || [];
    const step1 = h('section.panel', h('div.step-head', h('span.step-n', '1'), h('h2', 'Твой герой')),
      heroGrid(P.myHero, (id) => {
        P.myHero = id;
        P.enemies = P.enemies.filter((e) => e !== id);
        if (P.laneFoe === id) P.laneFoe = null;
        selectionChanged();
      }, { mine }));
    const step2 = h('section.panel', h('div.step-head', h('span.step-n', '2'), h('h2', 'Соперники'), h('span.muted.small', `${P.enemies.length} из 6 · повторный клик по выбранному — «он на моей линии»`)),
      heroGrid(P.enemies, (id) => {
        if (P.enemies.includes(id)) {
          if (P.laneFoe !== id) P.laneFoe = id;
          else {
            P.laneFoe = null;
            P.enemies = P.enemies.filter((e) => e !== id);
          }
        } else if (P.enemies.length < 6) P.enemies = P.enemies.concat([id]);
        selectionChanged();
      }, { multi: true, disabled: new Set([P.myHero]), lane: P.laneFoe }),
      h('div.row', { style: { marginTop: '14px' } },
        h('button.btn.primary', { onclick: runPrep, disabled: !P.myHero || !P.enemies.length || !!P.request || null }, P.request ? h('span.spin') : Icon('zap'), 'Показать план'),
        P.enemies.length ? h('button.btn', { onclick: () => { S.codex.enemy = P.laneFoe || P.enemies[0]; setView('codex'); }, title: 'Справочник: контрпики и контрпредметы по выбранному сопернику' }, 'Справочник по сопернику') : null,
        P.enemies.length ? h('button.btn', { onclick: () => { P.enemies = []; P.laneFoe = null; selectionChanged(); } }, 'Сбросить') : null));
    const parts = [head, h('div.prep-steps', step1, step2)];
    const r = P.result;
    if (r) {
      const kindIcon = { good: 'trophy', warn: 'flame', info: 'bulb' };
      const topDate = r.latestTopMatch ? ` · последний матч топов ${new Date(r.latestTopMatch * 1000).toLocaleDateString('ru-RU')}` : '';
      const personalSample = S.auth ? `Твоих матчей на ${heroName(P.myHero)}: ${r.myGames}` : 'Войди через Steam, чтобы увидеть свои результаты';
      parts.push(h('section.panel.prep-plan', h('h2', `План: ${heroName(P.myHero)} против ${P.enemies.map(heroName).join(', ')}`),
        h('div.hint', `По сохранённым данным. ${personalSample} · матчей топов на этом герое: ${r.topGames}${topDate}`),
        r.topGames < 10 ? h('div.note', Icon('info'), h('div', 'Сохранённых матчей топов мало. Выводы предварительные.')) : null,
        r.tips.length ? h('div.prep-tips', r.tips.map((t) => h(`div.prep-tip.${t.kind}`, Icon(kindIcon[t.kind] || 'info'), h('div', h('b', t.title), h('div', t.text))))) : h('div.muted', 'Для этих соперников у топов мало данных.'),
        h('table.table.prep-table', h('thead', h('tr', h('th', 'Соперник'), h('th.r', 'Топы против него'), h('th.r', 'Ты против него'), h('th.r', 'Линия к 10:00'), h('th', 'Топы докупают'))),
          h('tbody', r.rows.map((x) => h(`tr${x.isLane ? '.selected' : ''}`,
            h('td', h('div.hero-cell', heroIcon(x.hero_id, '.sm'), heroName(x.hero_id), x.isLane ? h('span.pill.hot', 'на линии') : null)),
            h('td.r.num', x.top ? h('span', { style: { color: x.thin ? 'var(--muted)' : x.top.wr >= 0.5 ? 'var(--good)' : 'var(--bad)' }, title: x.thin ? 'Игр в паре меньше 5 — цифра может сильно измениться' : `Статистическая оценка по выборке ${F.pct(x.top.ci_lo)} и ${F.pct(x.top.ci_hi)}` }, F.pct(x.top.wr)) : '—',
              x.top ? h('div.dim.small', `${x.top.games} ${plural(x.top.games, 'игра', 'игры', 'игр')} · ${x.thin ? 'мало данных' : `интервал ${F.pct(x.top.ci_lo)}–${F.pct(x.top.ci_hi)}`}`) : null),
            h('td.r.num', x.mine ? `${x.mine.wins}–${x.mine.losses}` : '—', x.mine ? h('div.dim.small', `${x.mine.games} ${plural(x.mine.games, 'игра', 'игры', 'игр')}${x.mineThin ? ' · мало встреч' : ''}`) : null),
            h('td.r.num', x.top && x.top.laneDiff !== null ? h('span', { style: { color: x.laneThin ? 'var(--muted)' : x.top.laneDiff >= 0 ? 'var(--good)' : 'var(--bad)' } }, `${x.top.laneDiff > 0 ? '+' : ''}${F.num(x.top.laneDiff)}`) : '—', x.top?.laneSamples ? h('div.dim.small', `${x.top.laneSamples} ${plural(x.top.laneSamples, 'игра', 'игры', 'игр')}${x.laneThin ? ' · мало данных' : ''}`) : null),
            h('td', x.top && x.top.counters.length ? h('div.mini-items', x.top.counters.map((c) => h('span', { title: `${itemName(c.id)}: ${F.pct(c.pick)} игр против него (обычно ${F.pct(c.base)})` }, itemImg(c.id)))) : h('span.dim', '—')))))),
        h('div.hint', '«Ты против него» — победы и поражения на выбранном герое, когда указанный соперник был во вражеской команде. «Линия к 10:00» — типичная разница в душах по матчам с подтверждённой линией и замером на 10-й минуте. «Топы докупают» — предметы, которые против этого соперника брали заметно чаще обычного. «Интервал» показывает неопределённость оценки по сохранённым матчам. При числе игр меньше 5 результат помечен как предварительный и не входит в сводку побед топов.')));
    }
    // прогноз по выбранному герою: твои игры + игры топового уровня
    if (P.myHero) {
      const o = P.outlook[P.myHero];
      if (o === undefined) loadOutlook(P.myHero);
      if (!o) parts.push(skeleton(`Считаю матчапы для ${heroName(P.myHero)}`, 'list'));
      else if (o.error) parts.push(h('section.panel', h('div.note', Icon('info'), h('div', `Не получилось посчитать матчапы: ${o.error}`))));
      else parts.push(...outlookPanels(o, P.myHero));
    } else if (P.muLoading) parts.push(skeleton('Собираю твоих героев', 'list'));
    v.replaceChildren(...parts);
  }

  function outlookPanels(o, heroId) {
    const name = heroName(heroId);
    const pct = (d) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(Math.round(d * 100))}%`;
    const rec = (x, label) => (x ? h('span.mu-chip', { title: label === 'топы' ? `Игры топового уровня (топы и игроки в их матчах): ${x.wins} побед, ${x.losses} поражений` : `Твои игры: ${x.wins} побед, ${x.losses} поражений` }, h('i', label), `${x.wins}–${x.losses}`) : null);
    const lane = (x, duo) => (x.laneDiff === null ? null : h(`span.mu-lane.${x.laneDiff >= 0 ? 'pos' : 'neg'}`, { title: duo ? 'Разница душ вашей пары и пары соперников к 10:00' : 'Разница душ с ним на линии к 10:00' },
      `линия ${x.laneDiff > 0 ? '+' : x.laneDiff < 0 ? '−' : ''}${F.num(Math.abs(Math.round(x.laneDiff)))}`));
    const row = (x, kind, duo = false) => h(`div.mu-row.ol.${kind}`,
      heroIcon(x.hero_id, '.sm'),
      h('div.grow', h('div.mu-name', heroName(x.hero_id)),
        h('div.mu-meta', rec(x.pro, 'топы'), rec(x.mine, 'ты'), lane(x, duo),
          x.evidence < 5 ? h('span.mu-thin', { title: 'Пар с этим героем меньше 5 — цифра неустойчива, смотри счёт рядом' }, 'мало игр') : null,
          kind === 'bad' && x.counters && x.counters.length ? h('span.mu-counter', { title: 'Что топы докупают против него' }, h('i', 'докупают'), h('span.mini-items', x.counters.map((c) => h('span', { title: itemName(c.id) }, itemImg(c.id))))) : null)),
      h(`div.mu-delta.${x.delta >= 0 ? 'pos' : 'neg'}`, { title: 'Насколько чаще обычного побеждают в таких играх' }, h('b.num', pct(x.delta)), h('span', 'к победам')));
    const empty = (t) => h('div.muted', { style: { padding: '8px 0' } }, t);
    const basis = [
      o.myGames ? `${o.myGames} ${plural(o.myGames, 'твоя игра', 'твои игры', 'твоих игр')} на ${name}` : (S.auth ? `на ${name} у тебя пока нет игр с подробностями` : 'войди через Steam, чтобы учитывать твои игры'),
      `${o.proGames} ${plural(o.proGames, 'игра', 'игры', 'игр')} топового уровня (из них ${o.topsGames} — сами топы)`,
    ].join(' · ');
    const head = h('section.panel.ol-head',
      h('div.row', { style: { alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' } }, h('h2', { style: { margin: 0 } }, `Матчапы ${name}`), h('span.muted.small', basis)),
      h('div.hint', { style: { marginTop: '8px' } }, `Процент справа — насколько чаще обычного побеждают на ${name}, когда этот герой у соперников (или с тобой на линии). Твои игры весят вдвое больше игр топов, а редкие встречи учитываются осторожно.`),
      o.myGames < 5 && S.auth ? h('div.note', { style: { marginTop: '10px' } }, Icon('info'), h('div', `Твоих игр на ${name} мало, поэтому списки в основном по играм топов.`)) : null,
      o.proGames < 15 ? h('div.note', { style: { marginTop: '10px' } }, Icon('info'), h('div', `Игр топового уровня на ${name} мало — увеличь период или выбери топ-100 в настройках, чтобы списки были точнее.`)) : null);
    return [
      head,
      h('div.grid-2.ol-grid',
        h('section.panel', h('h2', h('span.dot.good'), 'Против кого играть легко'), h('div.muted.small', { style: { marginBottom: '8px' } }, 'Эти герои у соперников — тебе в плюс. Ищи с ними драки.'),
          o.good.length ? o.good.map((x) => row(x, 'good')) : empty('Явно удобных соперников пока не видно — мало игр.')),
        h('section.panel', h('h2', h('span.dot.bad'), 'Против кого играть тяжело'), h('div.muted.small', { style: { marginBottom: '8px' } }, 'Не дерись с ними один на один без преимущества. Справа — что топы докупают против них.'),
          o.bad.length ? o.bad.map((x) => row(x, 'bad')) : empty('Явно неудобных соперников пока не видно — мало игр.'))),
      h('section.panel', h('h2', h('span.dot.ally'), `С кем хорошо стоять линию на ${name}`), h('div.muted.small', { style: { marginBottom: '8px' } }, '«Линия» — разница душ вашей пары и пары соперников к 10:00.'),
        o.mates.length ? h('div.ol-mates', o.mates.map((x) => row(x, 'ally', true))) : empty('Пока мало игр, где известны напарники по линии.'),
        o.matesBad && o.matesBad.length ? h('div.muted.small', { style: { marginTop: '10px' } }, `Хуже всего линия идёт с: ${o.matesBad.map((x) => `${heroName(x.hero_id)} (${pct(x.delta)})`).join(', ')}.`) : null),
    ];
  }

  // ================= СПРАВОЧНИК КОНТРПИКОВ И КОНТРПРЕДМЕТОВ =================
  // Выбрал врага — получил «кого взять» (статистика матчапов) и «что купить»
  // (покупки топов + проверенные механики). Ответ кэшируется по герою:
  // смена героя лишних запросов не запускает.
  async function loadCodex(enemyId) {
    const C = S.codex;
    if (C.data[enemyId] !== undefined || C.pending.has(enemyId)) return;
    C.pending.add(enemyId);
    renderCodex();
    try {
      C.data[enemyId] = await dc.codexLookup(enemyId);
    } catch (e) {
      C.data[enemyId] = { enemy: enemyId, error: e.message };
    } finally {
      C.pending.delete(enemyId);
      if (S.view === 'codex') renderCodex();
    }
  }

  function codexMetaNote(d) {
    const m = d.meta || {};
    const bits = [];
    if (m.covered) bits.push(`пары герой-против-героя за 14 дней · ранг ${m.badge >= 91 ? 'Фантом 1+' : 'Оракул 1+'}`);
    if (m.at) bits.push(`данные от ${new Date(m.at).toLocaleString('ru-RU', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}`);
    if (m.stale) bits.push('показаны сохранённые, обновление идёт в фоне');
    if (m.error) bits.push(`обновить не удалось: ${m.error}`);
    return bits.join(' · ');
  }

  function renderCodex() {
    const v = $('view-codex');
    if (!v) return;
    const C = S.codex;
    const head = h('div.page-head', h('div', h('div.crumbs', 'Мета / Справочник контрпиков'), h('h1', 'Справочник контрпиков'),
      h('div.sub', 'Выбери героя соперника: кого взять против него до игры и что докупить, если матч уже идёт. У каждой рекомендации — источник: статистика матчапов, покупки топов или механика из файлов игры.')));
    if (!Object.keys(S.assets.heroes).length) {
      return void v.replaceChildren(head, h('div.empty', h('strong', 'Нет списка героев'), 'Нажми «Обновить данные» в «Мете героев».'));
    }
    const select = h('section.panel', h('div.row', { style: { justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '10px' } },
      h('h2', { style: { margin: 0 } }, 'Герой соперника'),
      C.poolOnly ? h('label.row.small', { style: { gap: '6px', cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: true, onchange: () => { C.poolOnly = false; renderCodex(); } }), 'показываю только из моего пула') : null),
      heroGrid(C.enemy, (id) => { C.enemy = id; C.showAllPicks = false; renderCodex(); }));
    const parts = [head, select];
    const enemy = C.enemy;
    if (!enemy) {
      parts.push(h('div.empty', h('strong', 'Выбери соперника сверху'), 'Покажу контрпики и контрпредметы по нему.'));
      v.replaceChildren(...parts);
      return;
    }
    const d = C.data[enemy];
    if (d === undefined) loadCodex(enemy);
    if (!d || C.pending.has(enemy)) {
      parts.push(skeleton(`Собираю контрпики и предметы против ${heroName(enemy)}`, 'list'));
      v.replaceChildren(...parts);
      return;
    }
    if (d.error) {
      parts.push(h('section.panel', h('div.note', Icon('info'), h('div', `Не получилось собрать справочник: ${d.error}`))));
      v.replaceChildren(...parts);
      return;
    }

    // ---------- кого взять ----------
    const picks = d.picks || { rows: [] };
    let rows = picks.rows || [];
    const hasPool = rows.some((x) => x.inPool);
    if (C.poolOnly && hasPool) {
      rows = rows.filter((x) => x.inPool);
      if (!rows.length) rows = picks.rows;
    }
    const shown = C.showAllPicks ? rows : rows.slice(0, 6);
    const pp = (x) => (x === null || x === undefined ? '—' : `${x >= 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(1)} п.п.`);
    const pickTable = shown.length
      ? h('table.table', h('thead', h('tr', h('th', 'Герой'), h('th.r', 'Против него'), h('th.r', 'Обычно'), h('th.r', 'Разница'), h('th.r', 'Линия'), h('th.r', 'Души к 9-й'))),
        h('tbody', shown.map((x) => h('tr',
          h('td', h('div.hero-cell', heroIcon(x.hero_id, '.sm'), heroName(x.hero_id),
            x.inPool ? h('span.pill', 'твой герой') : null,
            x.small ? h('span.pill.dim', { title: `${x.n} ${plural(x.n, 'игра', 'игры', 'игр')} в паре — выборка скромная` }, 'мало игр') : null)),
          h('td.r.num', x.wrVs !== null ? F.pct(x.wrVs) : '—', h('div.dim.small', `${x.n} ${plural(x.n, 'матч', 'матча', 'матчей')} в паре`)),
          h('td.r.num', x.base !== null ? F.pct(x.base) : '—'),
          h('td.r.num', h('span', { style: { color: (x.pp || 0) >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 700 } }, pp(x.pp))),
          h('td.r.num', { title: x.laneN ? `На одной линии: ${F.pct(x.laneWr)} за ${x.laneN} ${plural(x.laneN, 'матч', 'матча', 'матчей')}` : 'Матчапы на одной линии: мало игр' },
            x.laneN >= 100 && x.laneWr !== null && x.base !== null ? pp(x.laneWr - x.base) : '—', x.laneN >= 100 ? h('div.dim.small', `${x.laneN} ${plural(x.laneN, 'матч', 'матча', 'матчей')}`) : null),
          h('td.r.num', { title: x.soulsN ? `Разница душ к 9-й минуте на одной линии, ${x.soulsN} ${plural(x.soulsN, 'игра', 'игры', 'игр')}` : '' },
            x.soulsD !== null ? h('span', { style: { color: x.soulsD >= 0 ? 'var(--good)' : 'var(--bad)' } }, `${x.soulsD > 0 ? '+' : x.soulsD < 0 ? '−' : ''}${F.num(Math.abs(x.soulsD))}`) : '—')))))
      : h('div.muted', d.picks && d.picks.pairsSeen
        ? `Явных контрпиков по статистике не видно: в ${d.picks.pairsSeen} ${plural(d.picks.pairsSeen, 'паре', 'парах', 'парах')} разница с обычным винрейтом в пределах шума. Бери по составу команды и героям, на которых играешь уверенно.`
        : 'Пар с надёжной выборкой пока нет — мета ещё собирается.');
    parts.push(h('section.panel',
      h('div.row', { style: { justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '10px' } },
        h('h2', `Кого взять против ${heroName(enemy)}`),
        hasPool ? h('button.btn.small', { onclick: () => { C.poolOnly = !C.poolOnly; renderCodex(); }, 'aria-pressed': C.poolOnly ? 'true' : 'false' }, C.poolOnly ? 'Показать всех' : 'Из моего пула') : null),
      h('div.hint', '«Разница» — винрейт героя в матчапах против выбранного соперника минус его обычный винрейт в той же выборке: сильный сам по себе герой не выглядит «контрпиком» против всех. Ранжирование осторожное: малые выборки стянуты к нулю, пары со ${'<' /* разорвать, чтобы не съело html */}100 игр скрыты. Преимущество конкретной пары обычно невелико (около ±1 п.п.) — не воспринимай его как гарантию.'),
      pickTable,
      rows.length > 6 ? h('div.row', { style: { marginTop: '12px' } }, h('button.btn.small', { onclick: () => { C.showAllPicks = !C.showAllPicks; renderCodex(); } }, C.showAllPicks ? 'Свернуть' : `Показать все ${rows.length}`)) : null,
      !hasPool && S.auth ? h('div.hint', 'Героев из твоего пула в списке нет: они не проходят порог выборки, или история ещё загружается.') : null,
      !S.auth ? h('div.hint', 'Войди через Steam — появится фильтр «из моего пула» по героям, на которых ты играешь.') : null));

    // ---------- что купить ----------
    const items = d.items || {};
    const hr = d.heroRule;
    const mechRows = (items.mechanics || []).map((x) => h('div.codex-item',
      h('div.row', { style: { alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
        h('span.pill', 'механика патча'),
        h('b', x.name),
        x.tier ? h('span.muted.small', `${x.slot === 'vitality' ? 'Живучесть' : x.slot === 'spirit' ? 'Дух' : x.slot === 'weapon' ? 'Оружие' : ''} T${x.tier}`) : null,
        x.rule ? h('span.pill.dim', x.rule.threatLabel) : null),
      h('div', { style: { margin: '4px 0' } }, x.why),
      x.rule ? h('details', h('summary', 'Как работает предмет'), h('div.codex-detail', h('div', h('b', 'Эффект: '), x.rule.text), x.rule.goodVs ? h('div', h('b', 'Полезен: '), x.rule.goodVs) : null, x.rule.notEnough ? h('div', h('b', 'Не решит: '), x.rule.notEnough) : null)) : null));
    const buyRows = (items.purchases || []).map((x) => h('div.codex-item',
      h('div.row', { style: { alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
        h('span.mini-items', itemImg(x.id)),
        h('b', x.name),
        x.cost ? h('span.muted.small', `${x.cost} душ · ${x.slot === 'vitality' ? 'Живучесть' : x.slot === 'spirit' ? 'Дух' : x.slot === 'weapon' ? 'Оружие' : ''} T${x.tier}`) : null,
        x.rule ? h('span.pill.dim', x.rule.threatLabel) : null,
        h('span.pill.hot', { title: `Покупают в ${F.pct(x.rateVs)} игр против ${heroName(enemy)} и в ${F.pct(Math.max(0, x.rateVs / x.lift))} игр без него` }, `×${x.lift.toFixed(1)} чаще обычного`)),
      x.rule ? h('div', { style: { margin: '4px 0' } }, x.rule.text) : h('div.muted.small', 'Почему берут именно против него — из файлов игры не подтверждено; смотри на частоту покупок топов.'),
      x.rule ? h('details', h('summary', 'Когда брать, когда нет'), h('div.codex-detail', h('div', h('b', 'Полезен: '), x.rule.goodVs), h('div', h('b', 'Не решит: '), x.rule.notEnough))) : null));
    const itemPanel = h('section.panel',
      h('h2', `Что купить против ${heroName(enemy)}`),
      hr && hr.threats && hr.threats.length ? h('div', { style: { marginBottom: '14px' } },
        h('h3', `Чем опасен ${heroName(enemy)} (из файлов игры, патч ${d.rules ? d.rules.patch : ''})`),
        h('ul.codex-threats', hr.threats.map((t) => h('li', t))),
        hr.heals && hr.heals.length ? h('div.note', Icon('info'), h('div', h('b', 'Лечится: '), hr.heals.join('; '), ' — снижение входящего лечения (Toxic Bullets, Healbane) бьёт именно по этому.')) : null)
        : h('div.hint', `Механики ${heroName(enemy)} из файлов игры пока не разобраны — рекомендации ниже основаны только на покупках топов и статистике. Универсальных советов не показываю.`),
      mechRows.length ? h('div', { style: { marginBottom: '12px' } }, h('h3', 'Проверенные механики'), mechRows) : null,
      buyRows.length ? h('div', h('h3', 'По покупкам топов'), h('div.hint', `Предметы, которые в матчах топового уровня против ${heroName(enemy)} берут минимум в 1.5 раза чаще, чем на тех же героях без него. Это наблюдение, а не доказательство: покупка может быть ответом на весь состав соперника, а дорогие предметы чаще встречаются в длинных играх.`), buyRows) : null,
      !mechRows.length && !buyRows.length ? h('div.muted', 'Надёжных контрпредметов пока нет: покупок против этого героя в матчах топов меньше порога (нужно ≥60 игр с обеих сторон), а механика из файлов игры не подтверждена.') : null);
    parts.push(itemPanel);

    // ---------- источники ----------
    const foot = [];
    const metaNote = codexMetaNote(d);
    if (metaNote) foot.push(h('div', h('b', 'Матчапы: '), `Deadlock API (все матчи выбранного ранга). ${metaNote}. ${d.meta && d.meta.error ? `Ошибка обновления: ${d.meta.error}.` : ''}`));
    if (d.rules) foot.push(h('div', h('b', 'Механики: '), `${d.rules.source}, патч ${d.rules.patch}.`));
    foot.push(h('div', h('b', 'Покупки: '), 'матчи топового уровня, сохранённые приложением (lift против игр без этого героя).'));
    parts.push(h('section.panel', h('h2', 'Откуда данные'), foot));
    v.replaceChildren(...parts);
  }

  // ================= МАТЧАПЫ НА СТРАНИЦЕ ГЕРОЯ (МЕТА) =================
  function heroMatchupPanel(heroId) {
    const c = S.heroMu[heroId];
    if (c === undefined) {
      S.heroMu[heroId] = null;
      dc.heroMatchups(heroId).then((r) => { S.heroMu[heroId] = r; if (S.selectedHero === heroId) renderMeta(); }).catch(() => { S.heroMu[heroId] = { rows: [], hard: [], easy: [], total: 0 }; });
      return h('section.panel', h('h2', 'Против кого'), skeleton('Считаю матчапы топов', 'list'));
    }
    if (c === null) return h('section.panel', h('h2', 'Против кого'), skeleton('Считаю матчапы топов', 'list'));
    if (!c.rows.length) return h('section.panel', h('h2', 'Против кого'), h('div.muted', 'Мало игр топов для матчапов.'));
    const line = (x) => h('div.mu-row', heroIcon(x.hero_id, '.sm'), h('span.grow', heroName(x.hero_id)), h('span.num.muted', `${x.games} ${plural(x.games, 'игра', 'игры', 'игр')}`),
      x.counters.length ? h('div.mini-items', { title: 'Что топы докупают против него' }, x.counters.map((k) => itemImg(k.id))) : null,
      h('b.num', { style: { color: x.wr >= 0.5 ? 'var(--good)' : 'var(--bad)' } }, F.pct(x.wr)));
    return h('section.panel',
      h('div.row', { style: { justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '10px' } },
        h('h2', 'Против кого'),
        h('button.btn.small', { onclick: () => { S.codex.enemy = heroId; setView('codex'); }, title: `Справочник: кого взять против ${heroName(heroId)} и что докупить` }, 'Кого взять против него →')),
      h('h3', 'Неудобные соперники'), c.hard.length ? c.hard.map(line) : h('div.muted.small', 'Нет явно неудобных'),
      h('h3', { style: { marginTop: '14px' } }, 'Удобные соперники'), c.easy.length ? c.easy.map(line) : h('div.muted.small', 'Нет явно удобных'),
      h('div.hint', `Винрейт топов на ${heroName(heroId)} против героя в команде соперника. Иконки — предметы, которые против него берут чаще обычного.`));
  }

  // ================= БОК О БОК С ПРО-ИГРОКОМ =================
  async function openVersusPicker() {
    const matchId = S.my.selected;
    MD.data = null;
    $('modal').hidden = false;
    const close = h('button.btn.small', { onclick: closeModal }, 'Закрыть', Icon('close'));
    const sheet = h('div.modal-sheet.narrow', h('div.row', { style: { justifyContent: 'space-between', marginBottom: '10px' } }, h('h2', { style: { margin: 0 } }, 'С кем сравнить'), close), skeleton('Ищу матчи топов на этом герое', 'list'));
    $('modal').replaceChildren(h('div.modal-back', { onclick: closeModal }), sheet);
    let list = [];
    try {
      list = await dc.proCandidates(matchId);
    } catch (e) {
      sheet.replaceChildren(h('div.empty', h('strong', 'Не получилось'), e.message));
      return;
    }
    sheet.replaceChildren(
      h('div.row', { style: { justifyContent: 'space-between', marginBottom: '6px' } }, h('h2', { style: { margin: 0 } }, 'С кем сравнить'), close),
      h('div.muted', { style: { marginBottom: '12px' } }, 'Матчи топов на том же герое. Сверху — самые похожие по сборке и победы.'),
      list.length ? h('div.vs-list', list.map((c) => h(`button.vs-cand${c.won ? '.win' : '.loss'}`, { onclick: () => { closeModal(); openVersus(matchId, c.match_id, c.account_id); } },
        h('div.grow', h('b', c.name), h('div.muted.small', `${c.won ? 'победа' : 'поражение'} · ${F.time(c.duration_s)} · ${c.k}/${c.d}/${c.a} · ${F.k(c.nw)} душ`)),
        h('div.vs-sim', h('b.num', F.pct(c.similarity)), h('span', 'сборка совпадает')))))
        : h('div.empty', h('strong', 'Нет матчей топов на этом герое'), 'Обнови мету или увеличь период в настройках.'));
  }

  async function openVersus(matchId, proMatchId, proAccountId) {
    S.my.vs = { loading: true, data: null };
    renderCamp();
    try {
      S.my.vs.data = await dc.versus({ matchId, proMatchId, proAccountId });
    } catch (e) {
      S.my.vs = null;
      toast(e.message, true);
    } finally {
      if (S.my.vs) S.my.vs.loading = false;
      renderCamp();
    }
  }

  function versusView() {
    const vs = S.my.vs;
    const back = h('button.btn.small', { onclick: () => { S.my.vs = null; renderCamp(); } }, '← К разбору матча');
    if (vs.loading || !vs.data) return h('div', h('div.row', { style: { marginBottom: '14px' } }, back), skeleton('Загружаю матч топа'));
    const { me, pro } = vs.data;
    const card = (s, who) => h(`div.vs-card${s.won ? '.win' : '.loss'}`,
      heroIcon(s.hero, '.lg'),
      h('div', h('div.vs-who', who), h('div.vs-name', `${heroName(s.hero)}`), h('div.muted', `${s.won ? 'победа' : 'поражение'} · ${F.time(s.duration_s)}`)),
      h('div.vs-nums', h('div', h('b.num', `${s.k}/${s.d}/${s.a}`), h('span', 'K/D/A')), h('div', h('b.num', F.k(s.nw)), h('span', 'душ'))));
    // синхронные карты
    let t = 600;
    const m1 = MapView(me.map, { focusSlot: me.slot, focusName: 'Ты', heroName, heroImg: heroImgSrc, mapAsset: S.assets.map || null, compact: true });
    const m2 = MapView(pro.map, { focusSlot: pro.slot, focusName: pro.name, heroName, heroImg: heroImgSrc, mapAsset: S.assets.map || null, compact: true });
    const maxT = Math.min(me.map.duration, pro.map.duration);
    const clock = h('span.map-clock.num', F.time(t));
    const range = h('input.map-range', { type: 'range', min: 0, max: Math.round(Math.max(me.map.duration, pro.map.duration)), value: t, 'aria-label': 'Минута' });
    const setT = (x) => { t = x; clock.textContent = F.time(t); m1.setTime(t); m2.setTime(t); };
    range.addEventListener('input', () => setT(Number(range.value)));
    let timer = null;
    const play = h('button.btn.small', { onclick: () => {
      if (timer) { clearInterval(timer); timer = null; play.textContent = 'Пуск'; return; }
      play.textContent = 'Пауза';
      timer = setInterval(() => {
        if (!document.body.contains(play)) return clearInterval(timer);
        const nt = Math.min(maxT, t + 1);
        range.value = String(nt);
        setT(nt);
        if (nt >= maxT) { clearInterval(timer); timer = null; play.textContent = 'Пуск'; }
      }, 100);
    } }, 'Пуск');
    setT(t);
    const maps = h('section.panel', h('h2', 'Где были в одну и ту же минуту'),
      h('div.vs-maps', h('div', h('div.vs-map-label', 'Ты'), m1), h('div', h('div.vs-map-label', pro.name), m2)),
      h('div.map-controls', play, h('span'), clock, range));
    // графики
    const tabs = [['nw', 'Души'], ['pdmg', 'Урон по героям'], ['farm', 'Крипы'], ['ka', 'Убийства + помощь']];
    const k = S.my.vsChart || 'nw';
    const len = Math.max(me.curves[k].length, pro.curves[k].length);
    const pad = (a) => a.concat(Array(Math.max(0, len - a.length)).fill(null));
    const chart = h('section.panel', h('div.row', h('h2', { style: { margin: 0 } }, 'По минутам'), h('div.grow'),
      h('div.legend', h('span', h('i', { style: { background: 'var(--you)' } }), 'Ты'), h('span', h('i', { style: { background: 'var(--top)' } }), pro.name))),
      h('div.tabs', { style: { marginTop: '10px' } }, tabs.map(([kk, label]) => h('button.tab' + (k === kk ? '.active' : ''), { onclick: () => { S.my.vsChart = kk; renderCamp(); } }, label))),
      Charts.lineChart({ me: pad(me.curves[k]), med: pad(pro.curves[k]), p25: Array(len).fill(null), p75: Array(len).fill(null), n: [] }, { yFmt: k === 'ka' ? (x) => String(Math.round(x)) : (x) => F.k(x), meLabel: 'Ты', topLabel: pro.name, markers: me.deaths.map((x) => ({ minute: x / 60, color: 'var(--bad)' })) }),
      me.deaths.length ? h('div.hint', `Красные линии — твои смерти: ${me.deaths.map(F.time).join(', ')}. У ${pro.name}: ${pro.deaths.length ? pro.deaths.map(F.time).join(', ') : 'ни одной'}.`) : null);
    // фазы
    const cell = (a, b, invert = false, fmt = F.num) => {
      if (a === null || b === null) return h('td.r.num', '—');
      const good = invert ? a <= b : a >= b;
      return h('td.r.num', h('b', { style: { color: good ? 'var(--good)' : 'var(--bad)' } }, fmt(a)), h('span.muted', ` / ${fmt(b)}`));
    };
    const phases = h('section.panel', h('h2', 'По фазам: ты / он'),
      h('table.table', h('thead', h('tr', h('th', 'Фаза'), h('th.r', 'Души'), h('th.r', 'Урон по героям'), h('th.r', 'Смерти'), h('th.r', 'Уб. + пом.'))),
        h('tbody', me.phases.map((ph, i) => h('tr', h('td', `${ph.name} ${ph.to >= 60 ? ph.from + '+' : ph.from + '–' + ph.to}`),
          cell(ph.nw, pro.phases[i].nw), cell(ph.pdmg, pro.phases[i].pdmg), cell(ph.d, pro.phases[i].d, true, (x) => String(Math.round(x))), cell(ph.ka, pro.phases[i].ka, false, (x) => String(Math.round(x))))))),
      h('table.table', { style: { marginTop: '14px' } }, h('thead', h('tr', h('th', 'Души с источника'), ...me.sources.map((s, i) => h('th.r', me.phases[i].name)))),
        h('tbody', me.sources[0].rows.map((r, ri) => h('tr', h('td', r.short), ...me.sources.map((s, i) => cell(s.rows[ri].v, pro.sources[i].rows[ri].v, r.field === 'g_lost')))))),
      h('div.hint', 'Жирное — ты, после черты — про-игрок. Зелёный — не хуже него.'));
    // предметы
    const items = h('section.panel', h('h2', 'Покупки'),
      itemTimeline([{ label: 'Ты', items: me.items.slice(0, 14).map((it) => ({ id: it.id, t: it.t })) }, { label: pro.name, items: pro.items.slice(0, 14).map((it) => ({ id: it.id, t: it.t })) }], { maxT: Math.max(me.duration_s, pro.duration_s) }),
      slotKey());
    return h('div', h('div.row', { style: { marginBottom: '14px' } }, back),
      h('div.vs-head', card(me, 'Ты'), h('div.vs-vs', 'VS'), card(pro, `${pro.rank ? '#' + pro.rank + ' ' : ''}${pro.name}`)),
      maps, chart, phases, items);
  }

  // ================= ОБЗОР =================
  const RANK_NAMES = ['Obscurus', 'Initiate', 'Seeker', 'Alchemist', 'Arcanist', 'Ritualist', 'Emissary', 'Archon', 'Oracle', 'Phantom', 'Ascendant', 'Eternus'];
  const rankName = (tier) => {
    const r = S.assets.ranks && S.assets.ranks[tier];
    return (r && r.name) || RANK_NAMES[tier] || `Ранг ${tier}`;
  };
  function rankImg(tier, sub) {
    const r = S.assets.ranks && S.assets.ranks[tier];
    const src = r && r.sub ? r.sub[`small_subrank${sub}`] || r.sub.small || r.img : r && r.img;
    if (src) return h('img.rank-img', { src, alt: '' });
    return h('div.rank-img.ph', h('span', String(tier)));
  }
  const modeName = (mm) => ({ 4: 'рейтинг', 1: 'обычная' })[mm] || '';
  function dayLabel(ts) {
    const d = new Date(ts * 1000);
    const today = new Date();
    const y = new Date();
    y.setDate(today.getDate() - 1);
    const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(d, today)) return 'Сегодня';
    if (same(d, y)) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  const hhmm = (ts) => new Date(ts * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  // Строка матча — общая для лагеря и обзора. Список группируется по дням.
  function matchRows(list, { selected = null, onOpen }) {
    const out = [];
    let day = null;
    let group = null;
    for (const m of list) {
      if (m.pending) {
        out.push(h(`button.match.pending${selected === m.match_id ? '.active' : ''}`, { onclick: () => onOpen(m.match_id), title: 'Матч найден в кэше Steam и ещё обрабатывается в deadlock-api' },
          h('div.hero-ico.ph', '?'),
          h('div.match-body', h('div.match-title', h('span.match-hero', 'Новый матч')), h('div.match-sub', 'обрабатывается — нажми, чтобы проверить')),
          h('div.match-kda', h('div.souls', `ID ${m.match_id}`))));
        continue;
      }
      const dl = m.start_time ? dayLabel(m.start_time) : '—';
      if (dl !== day) {
        day = dl;
        const games = list.filter((x) => x.start_time && dayLabel(x.start_time) === dl);
        const w = games.filter((x) => x.won === true).length;
        const l = games.filter((x) => x.won === false).length;
        group = h('div.day-group', h('div.day-head', h('span', dl), h('span.num', h('b.diff-pos', `${w}`), h('span.dim', ' – '), h('b.diff-neg', `${l}`))));
        out.push(group);
      }
      const cls = m.won === true ? '.win' : m.won === false ? '.loss' : '';
      group.append(h(`button.match${cls}${selected === m.match_id ? '.active' : ''}`, { style: heroArtStyle(S.assets.heroes[m.hero_id]), onclick: () => onOpen(m.match_id), title: `Матч ${m.match_id}${modeName(m.match_mode) ? ' · ' + modeName(m.match_mode) : ''}` },
        heroIcon(m.hero_id),
        h('div.match-body',
          h('div.match-title', h('span.match-hero', heroName(m.hero_id))),
          h('div.match-sub', m.won === true ? h('span.res.win', 'победа') : m.won === false ? h('span.res.loss', 'поражение') : null,
            F.time(m.duration_s))),
        h('div.match-kda', h('div.kda', h('b', m.k), h('span.dim', ' / '), h('b.d', m.d), h('span.dim', ' / '), h('b', m.a)),
          h('div.souls', [m.start_time ? hhmm(m.start_time) : null, `${F.k(m.nw)} душ`].filter(Boolean).join(' · ')))));
    }
    return out;
  }

  async function loadOverview() {
    const model = S.dashboard;
    const current = () => S.dashboard === model;
    if (!S.auth || model.loading) return;
    model.loading = true;
    model.error = null;
    renderOverview();
    try {
      if (!model.data) dc.dashboard(true).then((saved) => {
        if (!current() || model.data?.source === 'api') return;
        model.data = saved;
        if (S.view === 'overview') renderOverview();
      }).catch(() => {});
      const incoming = await dc.dashboard(false);
      if (current() && (incoming.source === 'api' || model.data?.source !== 'api')) model.data = incoming;
    } catch (e) {
      model.error = e.message;
    } finally {
      model.loading = false;
      model.updated = Date.now();
      if (current() && S.view === 'overview') renderOverview();
    }
  }

  async function loadOverviewDetails() {
    const model = S.ov;
    const account = S.auth;
    if (!account || model.loading) return;
    model.loading = true;
    model.error = null;
    renderOverview();
    try {
      model.data = await dc.overview(model.days);
      model.for = account.accountId;
    } catch (e) {
      model.error = e.message;
    } finally {
      model.loading = false;
      if (S.view === 'overview' && S.ov === model && S.dashboard.details) renderOverview();
    }
  }

  function seg(options, value, onPick) {
    return h('div.seg', options.map(([v, label]) => h(`button${v === value ? '.on' : ''}`, { onclick: () => onPick(v) }, label)));
  }

  function deltaPill(cur, prev, { lowBetter = false, fmt = (v) => v.toFixed(1).replace('.', ',') } = {}) {
    if (cur === null || prev === null || cur === undefined || prev === undefined) return null;
    const d = cur - prev;
    if (Math.abs(d) < 1e-9) return h('span.delta', '±0');
    const good = lowBetter ? d < 0 : d > 0;
    return h(`span.delta.${good ? 'good' : 'bad'}`, { title: 'Разница с предыдущим таким же периодом' }, `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}`);
  }

  function rankLadder(tier) {
    const bars = [];
    for (let t = 1; t <= 11; t++) bars.push(h(`span${t === tier ? '.on' : t < tier ? '.past' : ''}`, { style: { height: `${18 + t * 4}px` }, title: rankName(t) }));
    return h('div.rank-ladder', h('div.rank-bars', bars), h('div.rank-ends', h('span', rankName(1)), h('span', rankName(11))));
  }

  // Источники душ по фазам — карточки. Используется в обзоре и лагере.
  function sourcePhaseCards(phases, { refLabel = 'топы', unitNote = null } = {}) {
    const cards = phases.filter((p) => p.rows).map((p) => {
      const max = Math.max(1, ...p.rows.flatMap((r) => [Math.abs(r.me || 0), Math.abs(r.ref || 0)]));
      const diffCell = (r) => {
        if (r.diff === null) return h('span.dim', '—');
        const bad = r.invert ? r.diff > 60 : r.diff < -60;
        const good = r.invert ? r.diff < -60 : r.diff > 60;
        return h(`span.num.src-diff${bad ? '.neg' : good ? '.pos' : ''}`, `${r.diff > 0 ? '+' : r.diff < 0 ? '−' : ''}${F.num(Math.abs(r.diff))}`);
      };
      const worstField = p.worst ? p.worst.field : null;
      const tot = p.total || {};
      return h(`div.src-phase.${p.level || 'none'}`,
        h('div.ph-title', h('b', p.name), h('span.muted.num', p.to >= 60 ? `${p.from}:00 и дальше` : `${p.from}:00–${p.to}:00`)),
        h('div.src-total', h('span.muted', 'Всего'), h('span.num', h('b', F.num(tot.me)), h('span.muted', ` / ${F.num(tot.ref)}`)),
          tot.diff !== null && tot.diff !== undefined ? h(`span.num.src-diff${tot.diff < -60 ? '.neg' : tot.diff > 60 ? '.pos' : ''}`, `${tot.diff > 0 ? '+' : tot.diff < 0 ? '−' : ''}${F.num(Math.abs(tot.diff))}`) : null),
        h('div.src-rows', p.rows.map((r) => h(`div.src-line${r.field === worstField ? '.worst' : ''}${r.invert ? '.lost' : ''}`, { title: r.name },
          h('div.src-name', r.short || r.name),
          diffCell(r),
          h('div.src-vals.num', F.num(r.me), h('span.dim', ` / ${F.num(r.ref)}`)),
          h('div.src-bars', h('span.you', { style: { width: `${(Math.abs(r.me || 0) / max) * 100}%` } }), h('span.top', { style: { width: `${(Math.abs(r.ref || 0) / max) * 100}%` } }))))),
        p.worst ? h('div.src-worst', h('div', h('b', p.worst.field === 'g_lost' ? 'Главное: ' : 'Главный недобор: '), p.worst.name.toLowerCase(), p.worst.field === 'g_lost' ? ` (+${F.num(p.worst.loss)})` : ` (−${F.num(p.worst.loss)})`),
          p.worst.tip ? h('div.tip', Icon('bulb'), h('span', p.worst.tip)) : null)
          : h('div.src-worst.ok', `На уровне: ${refLabel} не набирают заметно больше`));
    });
    return h('div',
      h('div.legend', { style: { marginBottom: '12px' } }, h('span', h('i', { style: { background: 'var(--you)' } }), 'Ты'), h('span', h('i', { style: { background: 'var(--top)' } }), refLabel[0].toUpperCase() + refLabel.slice(1)), unitNote ? h('span.dim', unitNote) : null),
      h('div.src-phases', cards));
  }

  const dashboardDate = (ts) => new Date(ts * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  const badgeLabel = (badge) => `${rankName(Math.floor(badge / 10))}${badge % 10 ? ' ' + badge % 10 : ''}`;
  const openDashboardMatch = (id) => { setView('matches'); openMatch(id); };

  function dashboardRank(points, season) {
    if (!points.length) return h('div.muted.dash-empty', 'В доступной истории пока нет отметок личного ранга.');
    const last = points.at(-1);
    const header = h('div.dash-rank-head', rankImg(Math.floor(last.badge / 10), last.badge % 10),
      h('div', h('strong', badgeLabel(last.badge)), h('div.muted.small', `Последняя отметка · ${dashboardDate(last.time)}`)));
    if (points.length === 1) return h('div', header, h('div.hint', 'Для графика нужны хотя бы две отметки.'));
    if (window.Charts && window.Charts.rankChart) return h('div', header, window.Charts.rankChart(points, { label: badgeLabel, onOpen: openDashboardMatch }), h('div.hint', `${points.length} отметок · ${season ? 'текущий сезон' : 'последние 30 дней'}`));
    const levels = [...new Set(points.map((p) => p.badge))].sort((a, b) => a - b);
    const from = points[0].time;
    const end = last.time;
    const width = 550;
    const y = (badge) => levels.length === 1 ? 68 : 108 - 84 * levels.indexOf(badge) / (levels.length - 1);
    const x = (time) => 110 + (time - from) / Math.max(1, end - from) * (width - 124);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} 140`);
    svg.setAttribute('class', 'dash-rank-chart');
    svg.setAttribute('aria-label', 'Ступенчатый график личного ранга');
    const add = (tag, attrs, label) => {
      const el = document.createElementNS(svg.namespaceURI, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      if (label) el.textContent = label;
      svg.append(el);
      return el;
    };
    const labels = levels.length <= 4 ? levels : [levels[0], levels[Math.floor(levels.length / 2)], levels.at(-1)];
    for (const badge of labels) {
      const row = y(badge);
      add('line', { x1: 110, x2: width - 14, y1: row, y2: row, class: 'dash-grid-line' });
      add('text', { x: 0, y: row + 4 }, badgeLabel(badge));
    }
    const path = points.map((point, i) => i === 0
      ? `M ${x(point.time)} ${y(point.badge)}`
      : `H ${x(point.time)} V ${y(point.badge)}`).join(' ');
    add('path', { d: path, class: 'dash-rank-path' });
    for (const point of points) {
      const label = `${dashboardDate(point.time)} · ${hhmm(point.time)} · ${badgeLabel(point.badge)}`;
      const dot = add('circle', { cx: x(point.time), cy: y(point.badge), r: 3, class: 'dash-rank-dot', tabindex: 0, role: 'button', 'aria-label': label });
      const title = document.createElementNS(svg.namespaceURI, 'title');
      title.textContent = label;
      dot.append(title);
      dot.addEventListener('click', () => openDashboardMatch(point.matchId));
      dot.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openDashboardMatch(point.matchId);
        }
      });
    }
    add('text', { x: 110, y: 135 }, dashboardDate(from));
    if (dashboardDate(from) !== dashboardDate(end)) add('text', { x: width - 14, y: 135, 'text-anchor': 'end' }, dashboardDate(end));
    return h('div', header, svg, h('div.hint', `${points.length} отметок · ${season ? 'текущий сезон' : 'последние 30 дней'}`));
  }

  function renderOverview() {
    if (!S.auth || S.dashboard.details) return renderOverviewDetails();
    const v = $('view-overview');
    const model = S.dashboard;
    const d = model.data;
    const latest = d?.latest;
    const hero = latest && S.assets.heroes[latest.hero_id];
    const localArt = { 7: 'assets/wraith-banner.jpg', 72: 'assets/billy-banner.jpg' }[latest?.hero_id];
    const portrait = localArt || hero?.card || hero?.img;
    const backdrop = !localArt && hero?.wide;
    const banner = h(`section.dash-banner${localArt ? '.painted' : ''}`,
      backdrop ? h('img.dash-hero-bg', { src: backdrop, alt: '', onerror: (e) => { e.currentTarget.hidden = true; } }) : null,
      portrait ? h('img.dash-hero-art', { src: portrait, alt: '', onerror: (e) => { e.currentTarget.hidden = true; } }) : null,
      h('div.dash-banner-copy', h('h1', ...(/[p{L}p{N}]/u.test(S.auth.name?.trim() || '') ? ['Привет, ', h('span.dash-name', S.auth.name.trim())] : ['Привет!'])),
        d ? h('div.dash-week', `${d.week.games} ${plural(d.week.games, 'матч', 'матча', 'матчей')} · ${d.hours.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ч · ${d.heroes.length} ${plural(d.heroes.length, 'герой', 'героя', 'героев')} за 7 дней`) : null,
        latest ? h('div.dash-latest', `Последний матч · ${heroName(latest.hero_id)} · ${dashboardDate(latest.start_time)}`) : null,
        h('div.row.dash-banner-actions',
          h('button.btn.primary', { onclick: () => setView('matches') }, 'История матчей', Icon('arrow')),
          h('button.btn.small.icon', { onclick: loadOverview, disabled: model.loading, title: 'Обновить главную', 'aria-label': 'Обновить главную' }, model.loading ? h('span.spin') : Icon('refresh')))));
    const knownColors = { 7: [148,77,120], 72: [164,60,135] };
    const color = hero?.color || knownColors[latest?.hero_id];
    if (color?.length === 3) banner.style.setProperty('--hero-glow', `rgb(${color.join(',')})`);
    if (!d) {
      v.replaceChildren(banner, model.error ? h('div.empty', model.error) : skeleton('Открываю сохранённые матчи'));
      return;
    }
    const card = (title, action, ...children) => h('section.panel.dash-card',
      h('div.dash-card-head', h('h2', title), action), children);
    const maxGames = Math.max(1, ...d.days.map((x) => x.games));
    const bars = h('div.dash-days', { role: 'list', 'aria-label': 'Игры по дням' }, d.days.map((x) => {
      const label = `${dashboardDate(x.start)} · побед: ${x.wins} · поражений: ${x.losses}${x.unknown ? ' · без результата: ' + x.unknown : ''}`;
      const segment = (n, kind) => n ? h(`span.${kind}`, { style: { flex: String(n) } }) : null;
      return h('div.dash-day', { role: 'listitem', title: label, 'aria-label': label },
        h('strong.num', x.games), h('div.dash-track', { 'aria-hidden': 'true' },
          x.games ? h('div.dash-stack', { style: { height: `${x.games / maxGames * 100}%` } }, segment(x.wins, 'win'), segment(x.losses, 'loss'), segment(x.unknown, 'unknown')) : null),
        h('span.muted', dashboardDate(x.start)),
        h('span.dash-day-result.num', { 'aria-hidden': 'true' }, `${x.wins}–${x.losses}`));
    }));
    const legend = h('div.dash-legend', h('span.win', 'Победы'), h('span.loss', 'Поражения'), h('span', 'Счёт под датой'),
      d.week.unknown ? h('span.unknown', 'Без результата') : null);
    const rate = (value, label) => h('div.dash-rate', h('strong.num', F.pct(value.wr)), h('span', label),
      h('span.muted.small', `${value.wins + value.losses} с результатом из ${value.games} матчей`));
    const delta = d.week.wr === null || d.baseline.wr === null ? null : 100 * (d.week.wr - d.baseline.wr);
    const deltaText = delta === null ? 'Для сравнения нужно больше матчей с результатом.'
      : `${delta > 0 ? '+' : ''}${delta.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} п. п. к обычному винрейту`;
    const heroRows = h('div.dash-heroes', d.heroes.slice(0, 5).map((x) =>
      h('button.dash-hero-row', { style: heroArtStyle(S.assets.heroes[x.heroId]), onclick: () => { setView('myheroes'); openHeroSummary(x.heroId); } },
        heroIcon(x.heroId), h('div', h('strong', heroName(x.heroId)), h('div.dash-hero-track', h('span', { style: { width: `${x.games / d.heroes[0].games * 100}%` } }))),
        h('span.muted.small', `${x.games} ${plural(x.games, 'матч', 'матча', 'матчей')} · ${x.wins}–${x.losses}${x.unknown ? ' · без результата: ' + x.unknown : ''}`),
        h('span.num', x.wins + x.losses >= 3 ? F.pct(x.wr) : '—'))));
    // --- ключевые цифры: что важнее всего видно сразу ---
    const wrPct = d.week.wr === null ? null : Math.round(d.week.wr * 100);
    const tone = delta === null ? '' : delta >= 1 ? 'good' : delta <= -1 ? 'bad' : '';
    const ring = (pct) => {
      const r = 34, c = 2 * Math.PI * r;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 80 80'); svg.setAttribute('class', 'hl-ring'); svg.setAttribute('aria-hidden', 'true');
      svg.innerHTML = `<circle cx="40" cy="40" r="${r}" class="hl-ring-bg"/><circle cx="40" cy="40" r="${r}" class="hl-ring-fg" stroke-dasharray="${(c * (pct ?? 0) / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 40 40)"/>`;
      return svg;
    };
    const lastRank = d.rank.length ? d.rank.at(-1) : null;
    const hl = h('div.hl-row',
      h(`div.hl-tile.feature${tone ? '.' + tone : ''}`,
        h('div.hl-main',
          h('div.hl-label', Icon('trending-up'), 'Винрейт за 7 дней'),
          h('div.hl-value.num', wrPct === null ? '—' : h('span', { 'data-count': String(wrPct), 'data-suffix': '%' }, wrPct + '%')),
          delta === null ? h('div.hl-sub', 'Мало матчей с результатом для сравнения')
            : h('div.hl-sub', h(`span.hl-chip${tone ? '.' + tone : ''}`, `${delta > 0 ? '+' : ''}${delta.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} п. п.`), ' к прошлым 30 дням (' + F.pct(d.baseline.wr) + ')')),
        ring(wrPct)),
      h('div.hl-tile',
        h('div.hl-label', Icon('swords'), 'Матчей за неделю'),
        h('div.hl-value.num', h('span', { 'data-count': String(d.week.games) }, String(d.week.games))),
        h('div.hl-sub', `${d.week.wins} побед · ${d.week.losses} поражений`)),
      h('div.hl-tile',
        h('div.hl-label', Icon('clock'), 'Время в игре'),
        h('div.hl-value.num', h('span', { 'data-count': String(+d.hours.toFixed(1)), 'data-decimals': '1' }, d.hours.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })), h('span.hl-unit', ' ч')),
        h('div.hl-sub', `${d.heroes.length} ${plural(d.heroes.length, 'герой', 'героя', 'героев')} за неделю`)),
      h('div.hl-tile',
        h('div.hl-label', Icon('crown'), 'Ранг'),
        lastRank ? h('div.hl-rank', rankImg(Math.floor(lastRank.badge / 10), lastRank.badge % 10), h('div.hl-value.sm', badgeLabel(lastRank.badge))) : h('div.hl-value.sm', '—'),
        h('div.hl-sub', lastRank ? `${d.rank.length} отметок · ${d.season ? 'сезон' : '30 дней'}` : 'Нет отметок')));
    v.replaceChildren(banner, hl, h('div.dash-grid',
      card('Игры за неделю', h('span.muted.small', `${d.week.games} ${plural(d.week.games, 'матч', 'матча', 'матчей')}`), bars, legend),
      card('Мои герои за неделю', h('button.btn.small', { onclick: () => setView('myheroes') }, 'Все герои', Icon('arrow')),
        d.heroes.length ? heroRows : h('div.muted.dash-empty', 'За неделю пока нет матчей.')),
      card('Изменения рейтинга', null, dashboardRank(d.rank, d.season))),
      h('div.dash-footer', h('span.muted.small', model.error ? `История недоступна · ${model.error}`
        : model.loading ? 'Проверяю свежие матчи…' : d.source === 'saved' ? 'Показаны сохранённые матчи' : 'По доступной истории Deadlock API'),
      h('button.btn.small', { onclick: () => { model.details = true; if (!S.ov.data) loadOverviewDetails(); else renderOverview(); } }, 'Подробная статистика', Icon('arrow'))));
  }

  function renderOverviewDetails() {
    const v = $('view-overview');
    const periodSeg = seg([[3, '3 дня'], [7, '7 дней'], [14, '14 дней']], S.ov.days, (d) => { S.ov.days = d; loadOverviewDetails(); });
    const head = h('div.page-head',
      h('div', h('div.crumbs', 'Моя игра / Главная'), h('h1', S.auth && /[p{L}p{N}]/u.test(S.auth.name?.trim() || '') ? `Привет, ${S.auth.name.trim()}` : 'Главная'), h('div.sub', 'Твоя форма за последние дни, цифры против игроков твоего уровня, задачи тренера и над чем работать.')),
      h('div.row', S.auth ? h('button.btn.small', { onclick: () => { S.dashboard.details = false; renderOverview(); } }, 'На главную') : null,
        S.ov.loading ? h('span.muted.row', h('span.spin'), 'Считаю…') : null, periodSeg,
        h('button.btn.small.icon', { onclick: loadOverviewDetails, title: 'Обновить', 'aria-label': 'Обновить', disabled: S.ov.loading }, Icon('refresh'))));
    if (!S.auth) {
      const input = h('input.input', { placeholder: 'или ссылка на профиль Steam: …/id/ник или …/profiles/7656…', style: { flex: '1' } });
      const metaReady = S.meta && S.meta.totalRecords;
      v.replaceChildren(h('div.welcome',
        h('div.welcome-main',
          h('div.crumbs', 'Добро пожаловать'),
          h('h1.welcome-title', 'Личный тренер по Deadlock'),
          h('p.welcome-text', `Программа следит за мета-игрой топ-${S.settings.topN} текущего сезона и учит тебя на их примере: разбирает каждый твой матч, ставит цели на неделю и показывает, где ты отстаёшь от топов.`),
          h('div.welcome-steps',
            h('div.wstep', h('span.step-n', '1'), h('div', h('b', 'Войди через Steam'), h('div.muted', 'Пароль вводится только на сайте Steam — программа получает лишь твой Steam ID.'),
              h('div.row', { style: { marginTop: '10px' } }, h('button.btn.steam', { onclick: login }, 'Войти через Steam')),
              h('div.row.nowrap', { style: { marginTop: '8px' } }, input, h('button.btn', { onclick: () => loginManual(input.value) }, 'OK')))),
            h('div.wstep', h('span.step-n', '2'), h('div', h('b', `Собери мету топ-${S.settings.topN}`), h('div.muted', metaReady ? `Готово: ${S.meta.totalMatches} ${plural(S.meta.totalMatches, 'матч', 'матча', 'матчей')} топов.` : 'Первый сбор занимает несколько минут.'),
              h('div.row', { style: { marginTop: '10px' } }, h('button.btn', { onclick: () => { setView('meta'); if (!metaReady) refreshTop(); } }, metaReady ? 'Открыть мету' : 'Собрать мету')))))),
        h('div.welcome-side',
          [['coach', 'Тренер', 'Цели на неделю и проверка каждой игры'], ['matches', 'Мои матчи', 'Разбор по минутам, карта, бок о бок с про-игроком'], ['prep', 'Перед игрой', 'Матчапы и контр-предметы против состава соперника']]
            .map(([k, t, d]) => h('button.wfeat', { onclick: () => setView(k) }, h('b', t), h('span', d), Icon('arrow'))))));
      return;
    }
    const o = S.ov.data;
    if (!o) {
      v.replaceChildren(head, S.ov.error ? h('div.empty', h('strong', 'Не получилось'), S.ov.error) : skeleton('Загружаю твои матчи — в первый раз это может занять минуту'));
      return;
    }
    const s = o.summary;
    if (!s.n) {
      v.replaceChildren(head, h('div.empty', h('strong', `За ${o.days} дн. игр нет`), 'Выбери период побольше или сыграй пару матчей. Если игры были, но их не видно — в «Моих матчах» нажми «Найти в кэше Steam».'));
      return;
    }

    // ---- профиль ----
    const rk = o.rank;
    const profile = h('div.panel.profile',
      h('div.prof-head', S.auth.avatar ? h('img.prof-ava', { src: S.auth.avatar, alt: '' }) : h('div.prof-ava.ph', 'ID'),
        h('div', h('div.prof-name', S.auth.name || `ID ${S.auth.accountId}`), h('div.muted', s.lastPlayed ? `Последняя игра ${F.ago(s.lastPlayed)}` : ''))),
      rk ? h('div.prof-rank', rankImg(rk.tier, rk.sub),
        h('div', h('div.rank-name', `${rankName(rk.tier)} ${rk.sub}`), h('div.muted', { title: 'Средний значок твоей команды в загруженных матчах' }, `средний ранг твоих матчей · ${rk.n} ${plural(rk.n, 'игра', 'игры', 'игр')}`)))
        : h('div.prof-rank', h('div.muted', 'Ранг появится, когда скачаются подробности матчей.')),
      rk ? rankLadder(rk.tier) : null,
      h('div.prof-stats',
        h('div', h('span.muted', 'Матчей'), h('b.num', s.n)),
        h('div', h('span.muted', 'Время в игре'), h('b.num', `${String(Math.round(s.hours * 10) / 10).replace('.', ',')} ч`)),
        h('div', h('span.muted', 'Героев'), h('b.num', s.heroes)),
        h('div', h('span.muted', 'Лучшая серия'), h('b.num', `${s.bestStreak} ${s.bestStreak === 1 ? 'победа' : s.bestStreak >= 2 && s.bestStreak <= 4 ? 'победы' : 'побед'}`)),
        s.streak ? h('div', h('span.muted', 'Сейчас'), h(`b.num.${s.streak.win ? 'diff-pos' : 'diff-neg'}`, `${s.streak.n} ${s.streak.win ? 'W' : 'L'} подряд`)) : null));

    // ---- форма ----
    const form = h('div.panel.form-card',
      h('div.row', h('div.grow', h('h2', { style: { marginBottom: '2px' } }, 'Форма'), h('div.muted', `Винрейт по последним ${o.form.window} играм, всего ${o.form.results.length} ${plural(o.form.results.length, 'игра', 'игры', 'игр')} за ${o.days} дн.`)),
        h('div.legend', h('span', h('i.sq', { style: { background: 'var(--good)' } }), 'Победа'), h('span', h('i.sq', { style: { background: 'var(--bad)' } }), 'Поражение'))),
      Charts.formChart(o.form, { heroName }),
      h('div.form-foot', h('span.dim', `${o.days} дн. назад`), h('span.dim', 'сейчас')));

    // ---- полоса плиток ----
    const last20 = o.form.results.slice(-20);
    const w20 = last20.filter((x) => x.won).length;
    const wr20 = last20.length ? w20 / last20.length : 0;
    const ringBox = h('div.kstrip-ring',
      h('div.ring', Charts.ring(wr20, { color: wr20 >= 0.5 ? 'var(--good)' : 'var(--bad)' }), h('div.ring-label', h('b', F.pct(wr20)), h('span', `${w20}W ${last20.length - w20}L`))),
      h('div', h('div.kpi-label', `Последние ${last20.length} ${plural(last20.length, 'игра', 'игры', 'игр')}`), h('div.wl-bars', last20.map((x) => h(`span.${x.won ? 'w' : 'l'}`, { style: { height: x.won ? '22px' : '14px' } }))), h('div.dim', { style: { fontSize: '12px', marginTop: '4px' } }, 'от старых к новым')));
    const P = o.prev;
    const tile = (label, value, prevVal, series, ref, opts = {}) => h('div.ktile',
      h('div.ktile-head', h('span.kpi-label', label), deltaPill(value, prevVal, opts)),
      h('div.ktile-value.num', value === null ? '—' : (opts.fmt || ((x) => x.toFixed(1).replace('.', ',')))(value)),
      Charts.sparkline(series, { ref, color: 'var(--text-2)' }),
      h('div.ktile-foot.dim', ref !== null && ref !== undefined ? `медиана твоих матчей ${(opts.fmt || ((x) => x.toFixed(1).replace('.', ',')))(ref)}` : P ? `прошлые ${o.days} дн.: ${prevVal === null ? '—' : (opts.fmt || ((x) => x.toFixed(1).replace('.', ',')))(prevVal)}` : ' '));
    const kstrip = h('div.panel.kstrip', ringBox,
      tile('KDA', s.kda, P && P.kda, o.series.kda, o.lobbyMedian.kda),
      tile('Души / мин', s.soulsMin, P && P.soulsMin, o.series.soulsMin, o.lobbyMedian.soulsMin, { fmt: (x) => F.num(x) }),
      tile('Крипы / мин', s.lhMin, P && P.lhMin, o.series.lhMin, null),
      tile('Смерти за игру', s.deaths, P && P.deaths, o.series.deaths, o.lobbyMedian.deaths, { lowBetter: true }));

    // ---- советы ----
    const tipText = (t) => (t.hero ? t.text.replace('{hero}', heroName(t.hero)) : t.text);
    const focus = o.tips.filter((t) => t.level !== 'good').slice(0, 3);
    const rest = o.tips.filter((t) => !focus.includes(t));
    const tipsPanel = h('div.panel',
      h('div.row', h('h2', { style: { margin: 0 } }, 'Над чем работать'), h('div.grow'), h('span.muted', `по ${s.n} играм за ${o.days} дн.`)),
      h('ol.priorities', { style: { marginTop: '14px' } }, focus.map((t) => h(`li.${t.level === 'info' ? 'warn' : t.level}`, h('div',
        h('div.prio-title', h('span.pill', t.area), ' ', t.title), h('div', tipText(t)), t.tip ? h('div.tip', Icon('bulb'), h('span', t.tip)) : null)))),
      rest.length ? h('div.insights', { style: { marginTop: '12px' } }, rest.map((t) => h(`div.insight.${t.level}`, h('div.insight-area', t.area), h('div', h('div', h('b', t.title)), h('div', tipText(t)), t.tip ? h('div.tip', Icon('bulb'), h('span', t.tip)) : null)))) : null);

    // ---- против твоего уровня ----
    const cmpMode = S.ov.mode;
    const block = o.compare[cmpMode];
    const poolN = cmpMode === 'lobby' ? o.lobbyN : o.topN;
    const rangeRow = (m) => {
      if (m.me === null || m.median === null) return h('div.cmp-row', h('div.cmp-label', h('div', m.label)), h('div.dim.cmp-none', 'мало данных — нужно больше игр с подробностями'));
      const lo = Math.min(m.p05, m.me);
      const hi = Math.max(m.p95, m.me);
      const pos = (x) => `${((x - lo) / Math.max(1e-9, hi - lo)) * 100}%`;
      const good = m.place ? m.place.top : null;
      const color = good === null ? 'var(--muted)' : good ? 'var(--good)' : 'var(--bad)';
      const left = Math.min(m.me, m.median);
      const right = Math.max(m.me, m.median);
      return h('div.cmp-row',
        h('div.cmp-label', h('div', m.label), h('div.dim.num', `медиана ${m.medianText}`)),
        h('div.cmp-val.num', m.meText),
        h('div.cmp-track',
          h('span.cmp-iqr', { style: { left: pos(m.p25), width: `calc(${pos(m.p75)} - ${pos(m.p25)})` } }),
          h('span.cmp-link', { style: { left: pos(left), width: `calc(${pos(right)} - ${pos(left)})`, background: color } }),
          h('span.cmp-med', { style: { left: pos(m.median) } }),
          h('span.cmp-dot', { style: { left: pos(m.me), background: color, boxShadow: `0 0 0 5px color-mix(in srgb, ${color} 25%, transparent)` } })),
        m.place ? h(`span.place.${good ? 'good' : 'bad'}`, `${good ? 'Топ' : 'Низ'} ${m.place.value}%`) : h('span.place', '—'));
    };
    const cmpPanel = h('div.panel',
      h('div.row', h('div.grow', h('h2', { style: { marginBottom: '2px' } }, 'Против твоего уровня'), h('div.muted', cmpMode === 'lobby' ? 'Твоя типичная игра среди всех игроков твоих матчей — это и есть твой уровень.' : 'Твоя типичная игра среди игр топ-50 (все герои).')),
        seg([['lobby', 'Мои матчи'], ['top', 'Топ-50']], cmpMode, (x) => { S.ov.mode = x; renderOverview(); })),
      h('div.cmp-legend.dim', h('span', h('i.iqr'), 'обычные 50%'), h('span', h('i.med'), 'медиана'), h('span', `игр в сравнении: ${F.num(poolN)}`)),
      o.loaded ? h('div.cmp-rows', block.map(rangeRow)) : h('div.muted', 'Нужны подробности матчей — их пока нет в deadlock-api.'),
      o.missing ? h('div.hint', `Подробностей нет для ${o.missing} из ${s.n} игр — сравнение по остальным ${o.loaded}.`) : null);

    // ---- игра за игрой и длина ----
    const barCol = (label, sub, wr, games, hiLite) => h('div.wbar',
      h('div.wbar-val', wr === null ? '—' : F.pct(wr)),
      h('div.wbar-track', h(`span${hiLite ? '.hi' : ''}${wr !== null && wr < 0.5 ? '.lo' : ''}`, { style: { height: `${wr === null ? 0 : Math.max(4, wr * 100)}%` } })),
      h('div.wbar-label', h('b', label), h('div.dim', sub)));
    const bestPos = o.sessions.buckets.filter((b) => b.games >= 3).sort((a, b) => b.wr - a.wr)[0];
    const sessPanel = h('div.panel',
      h('h2', { style: { marginBottom: '2px' } }, 'Игра за игрой'), h('div.muted', `Винрейт по номеру игры в сессии · сессий: ${o.sessions.sessions}, в среднем ${String(Math.round(o.sessions.avgLen * 10) / 10).replace('.', ',')} игры`),
      h('div.wbars', o.sessions.buckets.map((b) => barCol(`#${b.label}`, `${b.games} ${plural(b.games, 'игра', 'игры', 'игр')}`, b.games ? b.wr : null, b.games, bestPos && bestPos.pos === b.pos))),
      h('h3', { style: { marginTop: '18px' } }, 'По длине матча'),
      h('div.wbars.small', o.durations.map((d) => barCol(d.label, `${d.games} ${plural(d.games, 'игра', 'игры', 'игр')}`, d.games ? d.wr : null, d.games, false))),
      o.tilt.afterLoss >= 3 ? h('div.hint', `После поражения следующая игра: винрейт ${F.pct(o.tilt.afterLossWr)} (${o.tilt.afterLoss}). После победы: ${F.pct(o.tilt.afterWinWr)} (${o.tilt.afterWin}).`) : null);

    // ---- источники душ ----
    const srcMode = o.sources.top.some((p) => p.rows) ? S.ov.srcMode : 'lobby';
    const srcPanel = h('div.panel',
      h('div.row', h('div.grow', h('h2', { style: { marginBottom: '2px' } }, 'Откуда души — по фазам игры'),
        h('div.muted', srcMode === 'top' ? 'Сколько душ ты набираешь с каждого источника за 10 минут — против топов на тех же героях.' : 'Сколько душ ты набираешь с каждого источника за 10 минут — против среднего игрока в твоих матчах.')),
        o.sources.top.some((p) => p.rows) ? seg([['top', 'Топы на моих героях'], ['lobby', 'Мои матчи']], srcMode, (x) => { S.ov.srcMode = x; renderOverview(); }) : null),
      o.sources[srcMode].some((p) => p.rows)
        ? sourcePhaseCards(o.sources[srcMode], { refLabel: srcMode === 'top' ? 'топы' : 'игроки твоих матчей', unitNote: 'души за 10 минут фазы, среднее по играм' })
        : h('div.muted', { style: { marginTop: '10px' } }, 'Пока нет подробностей матчей для этого сравнения.'));

    // ---- герои ----
    const heroesPanel = h('div.panel', h('h2', 'Герои'),
      h('table.table', h('thead', h('tr', h('th', 'Герой'), h('th.r', 'Игр'), h('th.r', 'В–П'), h('th.r', 'Винрейт'), h('th.r', 'KDA'), h('th.r', 'Души/мин'))),
        h('tbody', o.heroes.map((x) => h('tr.click', { title: 'Открыть мету героя', onclick: () => { setView('meta'); loadHero(x.hero_id); } },
          h('td', h('div.hero-cell', heroIcon(x.hero_id), heroName(x.hero_id))),
          h('td.r.num', x.games),
          h('td.r.num', h('span.diff-pos', x.wins), h('span.dim', '–'), h('span.diff-neg', x.losses)),
          h('td.r.num', { style: { color: x.wr === null ? '' : x.wr >= 0.5 ? 'var(--good)' : 'var(--bad)' } }, F.pct(x.wr)),
          h('td.r.num', x.kda === null ? '—' : x.kda.toFixed(1).replace('.', ',')),
          h('td.r.num', F.num(x.soulsMin)))))));

    // ---- история ----
    const histPanel = h('div.panel', h('div.row', h('h2', { style: { margin: 0 } }, 'История матчей'), h('div.grow'), h('span.muted', 'нажми — откроется разбор')),
      h('div.match-list.tall', { style: { marginTop: '12px' } }, matchRows(o.games, { onOpen: (id) => { setView('matches'); openMatch(id); } })));

    // ---- задачи тренера ----
    const cd = S.coach.data;
    const coachPanel = h('section.panel.coach-strip',
      h('div.row', h('h2', { style: { margin: 0 } }, 'Задачи тренера'), h('div.grow'), h('button.btn.small', { onclick: () => setView('coach') }, 'Открыть тренера', Icon('arrow'))),
      cd && cd.goals && cd.goals.length
        ? h('div.cs-goals', cd.goals.filter((g) => g.status === 'active').map((g) => h('button.cs-goal', { onclick: () => setView('coach') },
          h('span.goal-area', g.area), h('b', g.title),
          h('div.goal-bar', h('span', { style: { width: `${Math.round((g.rate || 0) * 100)}%` } })),
          h('span.muted.small', g.games ? `${g.passed} из ${g.games} игр` : 'ещё не проверялась'))))
        : S.coach.loading ? h('div.muted', { style: { marginTop: '10px' } }, h('span.spin'), ' Тренер составляет план…')
          : h('div.muted', { style: { marginTop: '10px' } }, cd && !cd.plan ? 'Сыграй ещё пару матчей — тренер составит план.' : 'Открой тренера — он составит план на неделю.'));
    if (!S.coach.data && !S.coach.loading && S.auth) setTimeout(() => loadCoach(false), 0);

    v.replaceChildren(head,
      h('div.ov-top', profile, form),
      kstrip,
      coachPanel,
      tipsPanel,
      h('div.ov-two', cmpPanel, sessPanel),
      srcPanel,
      h('div.ov-two.even', heroesPanel, histPanel));
  }

  // ================= ЛАГЕРЬ =================
  let matchHistoryRequest = null;
  const showingMatches = () => S.view === 'camp' && S.my.mode === 'match';

  function mergeMatchList(incoming, previous = []) {
    const byId = new Map(previous.filter((m) => !m.pending).map((m) => [m.match_id, m]));
    for (const m of incoming) {
      if (!m.pending || !byId.has(m.match_id)) byId.set(m.match_id, m);
    }
    return [...byId.values()].sort((x, y) => (y.pending ? 2e9 : y.start_time || 0) - (x.pending ? 2e9 : x.start_time || 0)).slice(0, 60);
  }

  function loadMyMatches(silent = false) {
    return updateMatchHistory({ silent });
  }

  async function updateMatchHistory({ silent = false, fresh = false } = {}) {
    const model = S.my;
    const account = S.auth;
    if (!account || (matchHistoryRequest?.model === model && (!fresh || matchHistoryRequest.fresh))) return;
    const request = { model, fresh };
    matchHistoryRequest = request;
    const current = () => matchHistoryRequest === request && S.my === model && S.auth === account;
    const updateView = () => { if (showingMatches()) renderCamp(); };
    model.loading = true;
    model.freshBusy = fresh;
    model.error = null;
    updateView();
    try {
      if (!model.list) {
        const saved = await dc.myMatches(true);
        if (!current()) return;
        model.list = saved.list;
        model.historyStatus = saved;
        updateView();
      }
      const before = new Set(model.list.filter((m) => !m.pending).map((m) => m.match_id));
      const result = await (fresh ? dc.freshMatches() : dc.myMatches());
      if (!current()) return;
      model.list = mergeMatchList(result.list, model.list);
      model.historyStatus = result;
      const added = result.list.find((m) => !m.pending && !before.has(m.match_id));
      if (fresh && result.fresh?.ok) toast('Запрос к Steam выполнен');
      else if (silent && added && showingMatches()) toast(`Появился новый матч: ${heroName(added.hero_id)}`);
    } catch (e) {
      if (current()) model.error = e.message;
    } finally {
      if (current()) {
        matchHistoryRequest = null;
        model.loading = false;
        model.freshBusy = false;
        updateView();
        schedulePoll();
      }
    }
  }

  // Пока открыт лагерь и последний матч старый — проверяем историю каждые 3 минуты (до 10 раз).
  let pollTimer = null;
  let pollCount = 0;
  function lastFinished() {
    const done = (S.my.list || []).filter((m) => !m.pending && m.start_time);
    return done.length ? Math.max(...done.map((m) => m.start_time + (m.duration_s || 0))) : 0;
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    const stale = Date.now() / 1000 - lastFinished() > 20 * 60;
    if (!showingMatches() || !S.auth || !stale || pollCount >= 10) return;
    if (S.gameMode && S.gameMode.active && S.gameMode.enabled) return; // пока играешь — новых матчей не будет
    pollTimer = setTimeout(() => {
      pollCount += 1;
      if (showingMatches()) loadMyMatches(true);
    }, 3 * 60e3);
  }

  function freshMatches() {
    return updateMatchHistory({ fresh: true });
  }

  async function scanCache() {
    const model = S.my;
    const account = S.auth;
    try {
      S.my.scanBusy = true;
      renderCamp();
      const r = await dc.scanCache();
      if (S.my !== model || S.auth !== account) return;
      if (!r.steamDir) toast('Не нашёл папку Steam. Укажи её в настройках.', true);
      else if (r.added) toast(`Нашёл новых матчей: ${r.added}. Они уже в списке — если матч ещё обрабатывается, нажми на него через пару минут.`);
      else toast(r.found ? `В кэше ${r.found} ${plural(r.found, 'матч', 'матча', 'матчей')}, новых нет. Если сыгранного матча нет — открой его в игре: «Профиль» → «История матчей», потом нажми эту кнопку ещё раз.` : 'В кэше Steam матчей нет. Открой матч в игре: «Профиль» → «История матчей» → нужный матч, потом нажми эту кнопку ещё раз.');
      const saved = await dc.myMatches(true);
      if (S.my !== model || S.auth !== account) return;
      model.list = mergeMatchList(saved.list, model.list || []);
      if (showingMatches()) renderCamp();
      await loadMyMatches(true);
    } catch (e) {
      toast(e.message, true);
    } finally {
      if (S.my === model && S.auth === account) {
        S.my.scanBusy = false;
        if (showingMatches()) renderCamp();
      }
    }
  }

  async function openMatch(matchId, episode = null) {
    stopReplay();
    S.my.replay = null;
    S.my.selected = Number(matchId);
    S.my.leakMoment = null;
    S.my.reviewTime = episode ? { t: episode.t, point: episode } : null;
    S.my.growthEpisode = episode;
    S.my.vs = null;
    S.my.analysis = null;
    S.my.error2 = null;
    S.my.target = { type: 'top' };
    await runAnalysis(true);
    if (episode && showingMatches() && S.my.growthEpisode === episode) {
      $('growth-episode')?.scrollIntoView({ block: 'nearest' });
    }
  }

  async function runAnalysis(loadTargets = false) {
    const model = S.my;
    const matchId = model.selected;
    const request = {};
    const current = () => S.my === model && model.analysisRequest === request;
    model.analysisRequest = request;
    model.analyzing = true;
    renderCamp();
    try {
      const winsOnly = model.winsOnly === null ? S.settings.winsOnly : model.winsOnly;
      const analysis = await dc.analyze({ matchId, target: model.target, winsOnly, preferSaved: !!model.growthEpisode });
      if (!current()) return;
      model.analysis = analysis;
      if (loadTargets) {
        const targets = await dc.campTargets(analysis.match.hero_id);
        if (!current()) return;
        model.targets = targets;
      }
      const row = model.list && model.list.find((x) => x.match_id === matchId);
      if (row) {
        row.loaded = true;
        row.won = analysis.match.won;
      }
    } catch (e) {
      if (current()) model.error2 = e.message;
    } finally {
      if (current()) {
        model.analyzing = false;
        if (showingMatches()) renderCamp();
      }
    }
  }

  function renderCamp() {
    const v = $('view-camp');
    const hero = S.my.mode === 'hero';
    const head = h(hero ? 'div.page-head.scene-heroes' : 'div.page-head', h('div', h('div.crumbs', hero ? 'Моя игра / Мои герои' : 'Моя игра / Мои матчи'), h('h1', hero ? 'Мои герои' : 'Мои матчи'),
      h('div.sub', hero ? 'Сводка по каждому твоему герою против топов на нём: что получается, что повторяется из игры в игру, матчапы.' : 'Выбери игру — сравню её с топами на том же герое по минутам и покажу, где ты отстаёшь. Можно сравнить бок о бок с матчем про-игрока.')));
    if (!S.auth) {
      const input = h('input.input', { placeholder: 'Ссылка на профиль Steam: …/id/ник или …/profiles/7656…', style: { width: '100%' } });
      v.replaceChildren(head, h('div.login', h('div.panel',
        h('h2', 'Войди, чтобы увидеть свои игры'),
        h('p', 'Вход через официальное окно Steam: пароль вводится только на сайте Steam, программа получает лишь твой Steam ID.'),
        h('button.btn.steam', { onclick: login, style: { padding: '12px 22px', fontSize: '15px' } }, 'Войти через Steam'),
        h('div.or', 'или'),
        h('div.row', input, h('button.btn', { onclick: () => loginManual(input.value) }, 'OK')))));
      return;
    }
    if (hero) v.replaceChildren(head, heroModeArea());
    else if (S.my.vs) v.replaceChildren(head, versusView());
    else v.replaceChildren(head, h('div.split', matchListPanel(), analysisArea()));
  }

  // ---------- сводка по герою ----------
  let heroReportRequest = 0;

  async function loadMyHeroes() {
    const account = S.auth?.accountId;
    S.my.heroesLoading = true;
    renderCamp();
    try {
      const heroes = await dc.myHeroes();
      if (S.auth?.accountId !== account) return;
      S.my.heroes = heroes;
      if (!S.my.hero && S.my.heroes.length) openHeroSummary(S.my.heroes[0].hero_id);
    } catch (e) {
      if (S.auth?.accountId === account) {
        toast(e.message, true);
        S.my.heroes = [];
      }
    } finally {
      if (S.auth?.accountId === account) {
        S.my.heroesLoading = false;
        if (S.view === 'camp' && S.my.mode === 'hero') renderCamp();
      }
    }
  }

  async function openHeroSummary(heroId, mode = S.my.heroMatchMode ?? null) {
    if (S.my.hero === heroId && mode === (S.my.heroMatchMode ?? null) && (S.my.heroRepLoading || S.my.heroRepRefreshing)) return;
    const request = ++heroReportRequest;
    const account = S.auth?.accountId;
    const isCurrent = () => request === heroReportRequest && S.auth?.accountId === account;
    const updateView = () => { if (S.view === 'camp' && S.my.mode === 'hero') renderCamp(); };
    S.my.hero = heroId;
    S.my.heroMatchMode = mode;
    S.my.heroRep = null;
    S.my.heroRepError = null;
    S.my.heroRepLoading = true;
    S.my.heroRepRefreshing = false;
    updateView();
    try {
      const saved = await dc.heroSummary(heroId, true, mode);
      if (!isCurrent()) return;
      S.my.heroRep = saved;
      S.my.heroRepLoading = false;
      S.my.heroRepRefreshing = true;
      updateView();
      const rep = await dc.heroSummary(heroId, false, mode);
      if (isCurrent() && (!rep.partial || rep.loaded >= saved.loaded)) S.my.heroRep = rep;
    } catch (e) {
      if (isCurrent()) S.my.heroRepError = e.message;
    } finally {
      if (isCurrent()) {
        S.my.heroRepLoading = false;
        S.my.heroRepRefreshing = false;
        updateView();
      }
    }
  }

  function heroModeArea() {
    if (S.my.heroesLoading && !S.my.heroes) return h('div.panel', h('div.row', h('span.spin'), 'Собираю твоих героев…'));
    if (!S.my.heroes || !S.my.heroes.length) return h('div.empty', h('strong', 'Пока нет игр'), 'Сыграй пару матчей — и здесь появится сводка по каждому твоему герою.');
    const picker = h('div.hero-picker', S.my.heroes.map((x) => h(`button.hero-pick${S.my.hero === x.hero_id ? '.on' : ''}`, { style: heroArtStyle(S.assets.heroes[x.hero_id]), onclick: () => openHeroSummary(x.hero_id), title: x.topGames ? `Игр топов на этом герое: ${x.topGames}` : 'Игр топов на этом герое пока нет' },
      heroIcon(x.hero_id),
      h('span.hero-pick-name', heroName(x.hero_id)),
      h('span.hero-pick-meta.num', `${x.games} · ${x.games ? Math.round((x.wins / x.games) * 100) : 0}%`))));
    return h('div', picker, S.my.hero ? seg([[null, 'Все'], [4, 'Рейтинг'], [1, 'Обычные']], S.my.heroMatchMode ?? null,
      (mode) => openHeroSummary(S.my.hero, mode)) : null, heroReportView());
  }

  function heroReportView() {
    if (S.my.heroRepLoading) return skeleton(`Открываю сохранённые игры на ${heroName(S.my.hero)}`);
    const r = S.my.heroRep;
    if (!r) return S.my.heroRepError ? h('div.empty', h('strong', 'Не получилось'), S.my.heroRepError) : null;
    const hero = heroName(r.heroId);
    const status = S.my.heroRepRefreshing ? (r.games ? 'Показаны сохранённые игры. Проверяю свежие данные…' : 'Сохранённых игр пока нет. Проверяю историю…')
      : S.my.heroRepError ? `Обновление не удалось. ${S.my.heroRepError}`
        : r.partial ? 'Сводка по доступным данным. Нажми на героя, чтобы проверить снова.' : '';

    const head = h('div.panel.hero-sum.hero-banner', { style: heroCardStyle(r.heroId) },
      h('div.hero-sum-main',
        heroIcon(r.heroId, '.xl'),
        h('div',
          h('div.hero-sum-name', hero),
          h('p.hero-sum-text', r.summary))),
      h('dl.hero-sum-stats',
        h('div', h('dt', 'Игр'), h('dd.num', r.games)),
        h('div', h('dt', 'Победы и поражения'), h('dd.num', h('span.diff-pos', r.wins), '–', h('span.diff-neg', r.losses))),
        h('div', h('dt', 'Винрейт'), h('dd.num', F.pct(r.wr))),
        h('div', h('dt', 'KDA'), h('dd.num', r.kda === null ? '—' : r.kda.toFixed(1).replace('.', ','))),
        h('div', h('dt', 'Игр топов для сравнения'), h('dd.num', r.benchN))),
      r.loaded < r.games ? h('div.hint', `Подробности есть для ${r.loaded} из ${r.games} игр — сравнение по ним.`) : null,
      r.benchModes?.length ? h('div.hint', `Режимы выборки топов · ${r.benchModes.map((mode) => mode === 4 ? 'рейтинговый' : 'обычный').join(', ')}`) : null,
      status ? h('div.hint', status) : null);

    const good = h('div.panel.verdict-col.good',
      h('h2', 'Что получается'),
      r.strengths.length ? h('ul.verdict-list', r.strengths.map((s) => h('li', h('b', s.title), h('div', s.text))))
        : h('div.muted', r.benchN ? 'В этой выборке пока нет показателей, где ты заметно сильнее топов.' : 'Пока нет матчей топов для сравнения. Твои личные результаты доступны ниже.'));
    const bad = h('div.panel.verdict-col.bad',
      h('h2', 'Чего не хватает'),
      r.weaknesses.length ? h('ul.verdict-list', r.weaknesses.map((w) => h(`li.${w.level}`,
        h('div.verdict-head', h('b', w.title), h('span.freq.num', { title: 'В скольких играх это повторилось' }, `${w.count} из ${w.of}`)),
        h('div.freq-bar', h('span', { style: { width: `${Math.round(w.share * 100)}%` } })),
        h('div', w.text),
        w.tip ? h('div.tip', Icon('bulb'), h('span', w.tip)) : null)))
        : h('div.muted', 'Повторяющихся ошибок не нашлось: в разных играх проблемы разные. Разбери отдельные игры в разделе «Мои матчи».'));

    // цифры против топов
    const metricRow = (m) => {
      const pct = m.ratio === null ? 0 : Math.max(-1, Math.min(1, (m.ratio - 1) / 0.5));
      const good = m.verdict === 'good';
      const color = m.verdict === 'good' ? 'var(--good)' : m.verdict === 'bad' ? 'var(--bad)' : m.verdict === 'warn' ? 'var(--warn)' : 'var(--muted)';
      const goodSide = m.better === 'high' ? pct : -pct;
      return h('tr',
        h('td', m.label),
        h('td.r.num', h('b', m.meText)),
        h('td.r.num.muted', m.topText),
        h('td.diverge-cell', h('div.diverge', h('span.mid'),
          h('span.fill', { style: { background: color, left: goodSide >= 0 ? '50%' : `${50 + goodSide * 50}%`, width: `${Math.abs(goodSide) * 50}%` } }))),
        h('td', h('span', { style: { color } }, { good: 'лучше', bad: 'сильно хуже', warn: 'хуже', even: 'на уровне' }[m.verdict] || '')));
    };
    const metrics = h('div.panel', h('h2', `Ты и топы на ${hero}`),
      h('div.muted', { style: { marginBottom: '10px' } }, 'Средние по твоим играм против медианы топ-50 на этом герое. Полоска вправо — в твою пользу.'),
      h('table.table.metrics', h('thead', h('tr', h('th', 'Показатель'), h('th.r', 'Ты'), h('th.r', 'Топы'), h('th', ''), h('th', ''))),
        h('tbody', r.metrics.map(metricRow))));

    const src = r.sources.some((p) => p.rows) ? h('div.panel', h('h2', 'Откуда души по фазам'),
      h('div.muted', { style: { marginBottom: '12px' } }, `Сколько душ за каждые 10 минут ты набираешь на ${hero} с каждого источника — против топов на нём же.`),
      sourcePhaseCards(r.sources, { refLabel: 'топы', unitNote: 'души за 10 минут фазы' })) : null;

    const items = r.items.length ? h('div.panel', h('h2', `Предметы: ты и топы${r.variantLabel ? ` (сборка ${r.variantLabel})` : ''}`),
      h('table.table', h('thead', h('tr', h('th', 'Предмет'), h('th.r', 'Топы берут'), h('th.r', 'Ты берёшь'), h('th', ''))),
        h('tbody', r.items.map((it) => h('tr',
          h('td', h('div.row.nowrap', { style: { gap: '8px' } }, h('span.mini-items', itemImg(it.id)), itemName(it.id))),
          h('td.r.num', F.time(it.topT), h('div.dim.small', `в ${F.pct(it.topPick)} игр`)),
          h('td.r.num', it.myT === null ? '—' : F.time(it.myT), h('div.dim.small', `в ${F.pct(it.myShare)} игр`)),
          h('td', it.myShare < 0.3 && it.topPick >= 0.5 ? h('span.pill.warn', 'почти не берёшь') : it.delay === null ? null : it.delay > 150 ? h('span.pill.bad', `позже на ${F.time(it.delay)}`) : it.delay < -120 ? h('span.pill.good', `раньше на ${F.time(-it.delay)}`) : h('span.pill.good', 'вовремя'))))))) : null;

    const games = h('div.panel', h('h2', `Игры на ${hero}`), h('div.muted', { style: { marginBottom: '10px' } }, 'Нажми на игру — откроется её подробный разбор.'),
      h('div.match-list.flat', matchRows(r.list, { onOpen: (id) => { setView('matches'); openMatch(id); } })));

    const mu = r.matchups;
    const muRow = (x) => h('div.mu-row', heroIcon(x.hero_id, '.sm'), h('span.grow', heroName(x.hero_id)), h('span.num.muted', `${x.wins}–${x.losses}`),
      x.laneDiff !== null && x.laneDiff !== undefined ? h('span.num.small', { style: { color: x.laneDiff >= 0 ? 'var(--good)' : 'var(--bad)' }, title: 'Разница душ с ним на линии к 10:00' }, `${x.laneDiff > 0 ? '+' : ''}${F.num(x.laneDiff)}`) : null,
      h('div.mu-bar', h('span', { style: { width: `${Math.round(x.wr * 100)}%`, background: x.wr >= 0.5 ? 'var(--good)' : 'var(--bad)' } })), h('b.num', F.pct(x.wr)));
    const muPanel = mu && mu.all.length ? h('div.grid-2',
      h('section.panel', h('h2', `Против кого на ${hero} тяжело`), mu.worst.length ? mu.worst.map(muRow) : h('div.muted', 'Явно неудобных соперников нет (нужно минимум 3 встречи).')),
      h('section.panel', h('h2', 'Соперники на твоей линии'), mu.lanes.length ? mu.lanes.slice(0, 6).map(muRow) : h('div.muted', 'Нет данных о линиях в этих матчах.'),
        h('div.hint', 'Справа от имени — сколько душ ты обгонял или отставал от него к 10:00.'))) : null;
    const sk = r.skills;
    const skPanel = sk && (sk.mine || sk.top) ? h('div.grid-2', { style: { margin: '18px 0' } },
      skillsPanel(sk.mine, { title: `Твоя прокачка на ${hero}`, who: 'твоих', compact: true,
        extra: sk.compare ? h(`div.note${sk.compare.same ? '.good' : ''}`, { style: { marginTop: '12px', marginBottom: 0 } }, Icon(sk.compare.same ? 'trophy' : 'info'), h('div', sk.compare.text)) : null }),
      skillsPanel(sk.top, { title: `Прокачка топов на ${hero}`, who: 'топов', compact: true })) : null;
    return h('div', head, h('div.grid-2.verdicts', good, bad), metrics, skPanel, muPanel, src, items, games);
  }

  function missingHint() {
    if (!S.my.list) return null;
    const ageMin = (Date.now() / 1000 - lastFinished()) / 60;
    if (S.my.list.length && ageMin < 20) return null;
    return h('details.missing', {
      open: (S.my.missingHintOpen ?? !S.my.list.length) || null,
      ontoggle: (e) => { if (e.currentTarget.isConnected) S.my.missingHintOpen = e.currentTarget.open; },
    },
      h('summary', 'Только что сыграл, а матча нет?'),
      h('ol',
        h('li', 'deadlock-api добавляет матчи в историю с задержкой — от пары минут до нескольких часов. Пока открыт этот раздел, я сам проверяю каждые 3 минуты.'),
        h('li', 'Быстрее всего: в игре открой «Профиль» → «История матчей» → свой матч, затем нажми «Найти в кэше Steam». Матч сразу появится в списке.'),
        h('li', '«Запросить у Steam» — свежая история напрямую из Steam (примерно раз в час).'),
        h('li', 'Или впиши ID матча (виден в истории матчей в игре) и нажми «Открыть».')));
  }

  function matchListPanel() {
    const idInput = h('input.input', { placeholder: 'ID матча', 'aria-label': 'ID матча', value: S.my.matchInput || '', oninput: (e) => { S.my.matchInput = e.target.value; }, style: { flex: '1' } });
    const items = [];
    if (S.my.list?.length) items.push(...matchRows(S.my.list, { selected: S.my.selected, onOpen: openMatch }));
    else if (!S.my.loading && S.my.list) items.push(h('div.muted', 'Матчей не найдено. Если ты недавно играл, нажми «Найти в кэше Steam».'));
    const result = S.my.historyStatus;
    const time = result?.checkedAt ? new Date(result.checkedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
    let historyStatus = '';
    if (S.my.loading) historyStatus = S.my.list?.length ? 'Матчи доступны. Проверяю новые игры…' : 'Проверяю историю матчей…';
    else if (S.my.error) historyStatus = `Не удалось проверить историю. ${S.my.error}`;
    else if (result?.fresh?.limited) historyStatus = 'Steam ограничил частоту запросов. Можно поискать матч в кэше Steam.';
    else if (result?.fresh && !result.fresh.ok) historyStatus = result.source === 'api' ? `Steam не ответил. История из Deadlock API проверена в ${time}.` : 'Steam не ответил. Показаны доступные сохранённые матчи.';
    else if (result?.source === 'steam') historyStatus = `Запрос к Steam выполнен в ${time}. Новая игра может ещё обрабатываться.`;
    else if (result?.source === 'api') historyStatus = `История Deadlock API проверена в ${time}.`;
    else if (result?.source === 'saved') historyStatus = 'Показаны доступные сохранённые матчи. Свежая история пока недоступна.';
    return h('div.panel',
      h('div.row', { style: { marginBottom: '12px' } }, h('h2', { style: { margin: 0 } }, 'Твои матчи'), h('div.grow'),
        h('button.btn.small.icon', { onclick: () => loadMyMatches(), disabled: S.my.loading || null, title: 'Обновить список', 'aria-label': 'Обновить список' }, Icon('refresh'))),
      h('form.row.nowrap', { style: { marginBottom: '10px' }, onsubmit: (e) => {
        e.preventDefault();
        const id = idInput.value.trim();
        if (id) openMatch(id);
      } }, idInput, h('button.btn.small', { type: 'submit' }, 'Открыть')),
      h('div.find-row',
        h('button.btn.small', { onclick: scanCache, disabled: S.my.scanBusy || null, title: 'Ищет твои матчи в кэше Steam и отправляет их в deadlock-api на обработку' }, S.my.scanBusy ? h('span.spin') : Icon('search'), 'Найти в кэше Steam'),
        h('button.btn.small', { onclick: freshMatches, disabled: S.my.freshBusy || null, title: 'Просит deadlock-api взять свежую историю прямо из Steam. Можно примерно раз в час.' }, S.my.freshBusy ? h('span.spin') : Icon('download'), 'Запросить у Steam')),
      missingHint(),
      historyStatus ? h('div.hint', { role: 'status' }, S.my.loading ? h('span.spin') : null, historyStatus) : null,
      h('div.match-list', items));
  }

  // Ошибки этой игры с моментами; момент можно посмотреть на мини-карте (повтор позиций).
  function macroReviewPanel(rows, seek) {
    if (!rows?.length) return null;
    return h('section.panel#macro-review', h('h2', 'Решения по карте'),
      h('div.mleak-list', rows.map((row) => h('div.mleak.info',
        h('div.mleak-head', h('b', row.title)),
        h('div.mleak-text', row.text),
        momentChips(row, (_i, moment) => {
          seek(moment.t);
          $('match-review')?.scrollIntoView({ block: 'nearest' });
        }),
        h('div.tip', Icon('bulb'), h('span', row.tip)),
        row.evidence ? h('button.btn.small', { onclick: () => {
          loadCoach(false, row.evidence);
          setView('coach');
        } }, 'Отслеживать в тренере') : null))));
  }

  function stopReplay() {
    const state = S.my.replay;
    if (!state?.loading) return;
    S.my.replay = null;
    dc.cancelReplay(state.matchId).catch(() => {});
  }

  function replayPanel(matchId, seek) {
    const state = S.my.replay?.matchId === matchId ? S.my.replay : null;
    const result = state?.result;
    const open = (t) => {
      seek(t);
      $('match-review')?.scrollIntoView({ block: 'nearest' });
    };
    const start = async () => {
      const model = S.my;
      const request = { matchId, loading: true };
      model.replay = request;
      renderCamp();
      try {
        request.result = await dc.replay(matchId);
      } catch (error) {
        request.error = error.message;
      } finally {
        request.loading = false;
        if (S.my === model && model.replay === request && showingMatches()) renderCamp();
      }
    };
    return h('section.panel', h('h2', 'Глубокий разбор реплея'),
      state?.loading ? h('div.row', h('span.muted', 'Сверяю события реплея…'),
        h('button.btn.small', { onclick: () => { stopReplay(); renderCamp(); } }, 'Отменить')) : null,
      state?.error ? h('p.muted', state.error) : null,
      !state?.loading && !result ? h('button.btn.small', { onclick: start }, 'Разобрать реплей') : null,
      result ? h('div',
        h('p', `В реплее найдено событий смерти: ${result.count}.`),
        !result.aligned ? h('p.muted', 'Журналы не совпали по времени или командам. Для эпизодов используй обычный разбор.') : null,
        result.losses.map(({ t, lost }) => h('div.row',
          h('button.btn.small', { onclick: () => open(t) }, F.time(t)),
          h('span', `Потеря душ по статистике матча: ${F.num(lost)}`))),
        result.bosses.map(({ t, allies, opponents }) => h('div.row',
          h('button.btn.small', { onclick: () => open(t) }, F.time(t)),
          h('span', `Midboss по метаданным. За 30 секунд до события смертей у твоей команды: ${allies}, у соперников: ${opponents}.`)))) : null);
  }

  function matchLeaksPanel(A, onSeek) {
    const leaks = (A.leaks || []).filter((l) => l.level !== 'good');
    const good = (A.highlights || []).concat((A.leaks || []).filter((l) => l.level === 'good'));
    if (!leaks.length && !good.length) {
      return A.fresh === false ? h('div.panel', h('h2', 'Разбор игры по моментам'), h('div.muted', 'Матч сохранён старой версией программы, подробных данных нет. Открой его ещё раз чуть позже — программа перекачает данные.')) : null;
    }
    const hasMap = A.map && A.map.paths;
    const mini = hasMap ? MapView(A.map, { focusSlot: A.mySlot ?? null, focusName: 'Ты', heroName, heroImg: heroImgSrc, mapAsset: S.assets.map || null, compact: true }) : null;
    const pick = S.my.leakMoment || null;
    if (mini && pick) mini.setTime(pick.t);
    // сначала то, что получилось, потом ошибки; нумерация карточек общая (для выбора момента на карте)
    const all = good.concat(leaks);
    const card = (l, li) => h(`div.mleak.${l.level}`,
      h('div.mleak-head', h('span.leak-area', l.area), h('b', l.title)),
      l.text ? h('div.mleak-text', l.text) : null,
      l.context ? h('div.hint.analysis-context', l.context) : null,
      momentChips(l, (i, mo) => {
        S.my.leakMoment = { li, i, t: mo.t };
        mini?.setTime(mo.t);
        renderMomentSel();
        onSeek(mo.t, mo);
        $('match-review')?.scrollIntoView({ block: 'nearest' });
      }, pick && pick.li === li ? pick.i : null),
      l.level === 'good'
        ? (l.keep ? h('div.tip.keep', Icon('trophy'), h('span', l.keep)) : null)
        : (l.fix && l.fix.length ? h('div.tip', Icon('bulb'), h('span', l.fix[0])) : null));
    const won = A.match && A.match.won;
    const verdict = good.length && leaks.length
      ? `${good.length} ${plural(good.length, 'сильный момент', 'сильных момента', 'сильных моментов')} и ${leaks.length} ${plural(leaks.length, 'ошибка', 'ошибки', 'ошибок')}. ${won ? 'Победа — но ошибки стоит разобрать, пока они не стоили игры.' : 'Поражение — но сильные стороны у тебя в этой игре были, их и держись.'}`
      : good.length ? `Ошибок не нашёл, а сильных моментов — ${good.length}. ${won ? 'Чистая игра.' : 'Ты сыграл хорошо — такие поражения бывают.'}`
        : `Сильных моментов не выделил, ошибок — ${leaks.length}. Разбери их по одной.`;
    const panel = h('div.panel.mleak-panel', h('div.row', h('h2', { style: { margin: 0 } }, 'Разбор игры по моментам'), h('div.grow'), h('button.btn.small', { onclick: () => setView('growth'), title: 'Какие ошибки повторяются из игры в игру' }, 'Все мои ошибки')),
      h('div.mleak-verdict', verdict),
      h(`div.mleak-grid${mini ? '' : '.nomap'}`, h('div.mleak-list',
        good.length ? h('div.mleak-sec.good', Icon('trophy'), 'Что получилось') : null,
        good.map((l, i) => card(l, i)),
        h('div.mleak-sec.bad', Icon('flame'), 'Что исправить'),
        leaks.length ? leaks.map((l, i) => card(l, good.length + i)) : h('div.muted', 'Явных ошибок в этой игре не нашёл.')),
        mini ? h('div.mleak-map', mini, h('div.hint', pick ? `Позиции всех героев на ${F.time(pick.t)}. Ты — с белой обводкой.` : 'Нажми на время у момента — покажу, где были все герои.')) : null));
    function renderMomentSel() {
      panel.querySelectorAll('.moment').forEach((b) => b.classList.remove('on'));
      const sel = S.my.leakMoment;
      if (!sel) return;
      const card = panel.querySelectorAll('.mleak')[sel.li];
      const btn = card && card.querySelectorAll('.moment')[sel.i];
      if (btn) btn.classList.add('on');
      const hint = panel.querySelector('.mleak-map .hint');
      if (hint) hint.textContent = `Позиции всех героев на ${F.time(sel.t)}. Ты — с белой обводкой.`;
    }
    return panel;
  }

  function growthEpisodePanel(A) {
    const episode = S.my.growthEpisode;
    if (!episode || episode.matchId !== A.match.match_id) return null;
    const hasCoords = (point) => Number.isFinite(point?.x) && Number.isFinite(point?.y);
    const death = A.map?.kills.find((k) => k.t === episode.t && k.victim === A.mySlot && hasCoords(k));
    const location = hasCoords(episode) ? episode : death;
    const path = A.map?.paths?.players?.[A.mySlot];
    const hasRoute = path?.length && episode.t <= (path.length - 1) * (A.map.paths.step || 5);
    const mini = A.map && (location || hasRoute) ? MapView(hasRoute ? A.map : { ...A.map, paths: null }, {
      focusSlot: A.mySlot, heroName, heroImg: heroImgSrc, mapAsset: S.assets.map || null,
      compact: true, moment: { t: episode.t, x: location?.x, y: location?.y },
    }) : null;
    return h('section.panel', { id: 'growth-episode' },
      h('h2', `Эпизод на ${F.time(episode.t)}`), h('div', h('b', episode.title), h('p', episode.text)),
      episode.context ? h('div.hint.analysis-context', episode.context) : null,
      mini ? h('div', { style: { maxWidth: '360px' } }, mini, h('div.hint', location ? 'Круг отмечает место события.' : 'На карте показаны доступные позиции героев в этот момент.'))
        : h('div.hint', 'В сохранённых данных нет координат для этого эпизода. Время события доступно.'));
  }

  function matchReview(A) {
    const { map, result: r, mySlot } = A;
    const duration = A.match.duration_s || 0;
    const coords = (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y);
    const deaths = (map?.kills || []).filter((k) => k.victim === mySlot);
    const nameBySlot = new Map((map?.players || []).map((p) => [p.slot, heroName(p.hero)]));
    const events = deaths.map((p) => ({ ...p, label: nameBySlot.has(p.killer) ? 'Смерть от ' + nameBySlot.get(p.killer) : 'Смерть' }))
      .concat((A.purchases || []).map((p) => ({ t: p.t, label: 'Покупка · ' + itemName(p.id) })))
      .filter((p) => Number.isFinite(p.t) && p.t >= 0 && p.t <= duration).sort((a, b) => a.t - b.t);
    const mapView = map && (map.hasPos || events.some(coords)) ? MapView(map, {
      focusSlot: mySlot, heroName, heroImg: heroImgSrc, mapAsset: S.assets.map, compact: true,
    }) : null;
    const key = S.my.chart;
    const curve = r.curves[key];
    const chart = Charts.lineChart(curve, { onSeek: (t) => seek(t) });
    const clock = h('output.num', { for: 'review-time' });
    const slider = h('input#review-time', { type: 'range', min: 0, max: duration, step: 1, oninput: (ev) => seek(Number(ev.target.value)) });
    const note = h('div.hint');
    const values = h('div.hint.review-values');
    const eventSelect = events.length ? h('select.select', { 'aria-label': 'События матча', onchange: (e) => {
      if (e.target.value === '') return;
      const p = events[Number(e.target.value)];
      seek(p.t, p);
    } }, h('option', { value: '' }, 'Перейти к событию…'),
    events.map((p, i) => h('option', { value: String(i) }, `${F.time(p.t)} · ${p.label}`))) : null;
    function seek(t, point = null) {
      if (!Number.isFinite(t)) return;
      t = Math.max(0, Math.min(duration, Math.round(t)));
      const selected = point ? (coords(point) ? point : null) : deaths.find((p) => p.t === t && coords(p));
      S.my.reviewTime = { t, point: point || selected || null };
      slider.value = t;
      clock.value = F.time(t);
      chart.setTime(t);
      mapView?.setMoment(t, selected || null);
      if (eventSelect) {
        const index = events.findIndex((p) => p.t === t && (!point?.label || p.label === point.label));
        eventSelect.value = index === -1 ? '' : String(index);
      }
      const minute = Math.floor(t / 60);
      const own = curve.me[minute];
      const median = curve.med[minute];
      values.textContent = `На ${minute}:00 · Ты ${F.num(own)}${Number.isFinite(median) ? ` · медиана ${F.num(median)} · выборка ${curve.n[minute]}` : ' · данных для сравнения на этой минуте нет'}`;
      const route = map?.paths?.players?.[mySlot];
      note.textContent = selected ? 'Круг отмечает место события.'
        : route?.length && t <= (route.length - 1) * (map.paths.step || 5) ? 'Позиции из сохранённых маршрутов.' : 'Координаты на выбранное время недоступны.';
    }
    seek(S.my.reviewTime?.t ?? 0, S.my.reviewTime?.point);
    const tabs = [['nw', 'Души'], ['pdmg', 'Урон'], ['farm', 'Крипы'], ['d', 'Смерти'], ['ka', 'Убийства + помощь']];
    return { seek, panel: h('section.panel#match-review',
      h('h2', 'Хронология матча'),
      h('div.review-body', h('div',
        h('div.tabs', tabs.map(([k, label]) => h(`button.tab${key === k ? '.active' : ''}`, { onclick: () => { S.my.chart = k; renderCamp(); } }, label))),
        chart, values), h('div.review-map', mapView, note)),
      h('div.review-controls', h('label', { for: 'review-time' }, 'Время матча'), slider, clock, eventSelect)) };
  }

  function analysisArea() {
    if (!S.my.selected) return h('div.empty', h('strong', 'Выбери матч слева'), 'Покажу поминутно: души, урон по героям, источники фарма, тайминги предметов и после каких покупок топы идут драться.');
    if (S.my.analyzing && !S.my.analysis) return skeleton('Загружаю матч и сравниваю с топами');
    if (S.my.error2) return h('div.empty', h('strong', 'Не получилось'), S.my.error2);
    const A = S.my.analysis;
    if (!A) return h('div');
    const r = A.result;
    const m = A.match;
    const episode = growthEpisodePanel(A);
    const review = matchReview(A);
    const replay = replayPanel(m.match_id, review.seek);

    const head = h('div.row', { style: { marginBottom: '14px' } }, heroIcon(m.hero_id),
      h('div.grow', h('h2', { style: { margin: 0 } }, `${heroName(m.hero_id)} — ${m.won ? 'победа' : 'поражение'}`),
        h('div.muted', `Матч ${m.match_id} · ${F.clock(m.start_time)} · ${F.time(m.duration_s)} · ${m.k}/${m.d}/${m.a} · ${F.num(m.nw)} душ`)),
      S.my.analyzing ? h('span.spin') : null,
      h('button.btn.small', { onclick: () => openBuild(m.match_id, S.auth && S.auth.accountId), title: 'Твои предметы и прокачка способностей из этой игры — картинкой, текстом или файлом' }, Icon('download'), 'Выгрузить билд'),
      h('button.btn.small', { onclick: openVersusPicker, title: 'Сравнить этот матч с матчем топа на том же герое' }, Icon('arrow'), 'Бок о бок с про-игроком'));

    const sel = h('select.select', {
      onchange: (e) => {
        const val = e.target.value;
        S.my.target = val === 'top' ? { type: 'top' } : { type: 'player', accountId: Number(val) };
        runAnalysis();
      },
    }, h('option', { value: 'top', selected: S.my.target.type === 'top' }, `Средний топ-${S.settings.topN}`),
    S.my.targets.map((t) => h('option', { value: t.accountId, selected: S.my.target.accountId === t.accountId }, `#${t.rank} ${t.name} — ${t.games} ${plural(t.games, 'игра', 'игры', 'игр')} на герое`)));
    const wins = h('input', { type: 'checkbox', checked: (S.my.winsOnly ?? S.settings.winsOnly) || null, onchange: (e) => { S.my.winsOnly = e.target.checked; runAnalysis(); } });
    const bar = h('div.compare-bar', h('span.muted', 'Сравнить с:'), sel, h('label.check', wins, 'только победы'), h('div.grow'),
      h('span.muted', r.benchN ? `${r.benchN} ${plural(r.benchN, 'игра', 'игры', 'игр')} · ${A.targetLabel} · ${A.benchMode === 4 ? 'рейтинговые' : A.benchMode === 1 ? 'обычные' : 'доступные режимы'} · до ${A.benchDays} дн. назад` : ''));

    if (!r.benchN) {
      return h('div', h('div.panel', head, bar, h('div.empty', h('strong', 'Нет матчей для сравнения'),
        'В выборке нет игр на этом герое для выбранного режима и настроек сравнения. Данные самого матча доступны ниже.')),
        episode, review.panel, replay, macroReviewPanel(A.macro, review.seek), matchLeaksPanel(A, review.seek), A.map ? mapPanel(A.map, A.mySlot ?? null, 'Карта матча') : null);
    }

    const sc = r.scores;
    const barOf = (s, kind) => {
      if (s.value === null || s.value === undefined) return 0;
      if (kind === 'ratio') return Math.max(4, Math.min(100, s.value * 100));
      if (kind === 'deaths') return Math.max(4, Math.min(100, 50 + s.value * 12));
      return Math.max(4, Math.min(100, 50 + s.value / 6));
    };
    const scoreCard = (label, s, value, hint, kind = 'ratio') => h(`div.score-card.${s.level}`, h('div.score-label', label), h('div.score-value', value), h('div.score-hint', hint),
      h('div.score-bar', h('span', { style: { width: `${barOf(s, kind)}%` } })));
    const scores = h('div.scores',
      scoreCard('Фарм', sc.farm, sc.farm.value !== null ? `${F.signedPct(sc.farm.value - 1)}` : '—', `души против топов · ${levelText[sc.farm.level]}`),
      scoreCard('Драки', sc.fight, sc.fight.value !== null ? `${F.signedPct(sc.fight.value - 1)}` : '—', `урон по героям · ${levelText[sc.fight.level]}`),
      scoreCard('Выживание', sc.survive, sc.survive.value !== null ? `${sc.survive.value > 0 ? '+' : ''}${String(Math.round(sc.survive.value * 10) / 10).replace('.', ',')}` : '—', `смертей к 20:00 против топов · ${levelText[sc.survive.level]}`, 'deaths'),
      scoreCard('Предметы', sc.items, sc.items.value !== null ? `${sc.items.value > 0 ? '+' : ''}${F.time(sc.items.value)}` : '—', `средняя задержка · ${levelText[sc.items.level]}`, 'delay'));

    // Главное — 3 приоритета
    const mainPanel = h('div.panel', h('h2', 'Наблюдения по матчу'),
      h('div.hint', 'Сравнение показывает различия в цифрах. Открой эпизод на карте, чтобы оценить игровое решение.'),
      r.priorities.length
        ? h('ol.priorities', r.priorities.map((i) => h(`li.${i.level}`, h('div', h('div.prio-title', i.title || i.area), h('div', i.text), i.tip ? h('div.tip', Icon('bulb'), h('span', i.tip)) : null))))
        : h('div.muted', 'Явных отставаний от топов не видно — игра на их уровне. Ниже детали по минутам.'));

    // Твоя сборка
    const V = r.variant;
    const variantPanel = V ? h('div.panel', h('h2', 'Твоя сборка'),
      h('div', 'По купленным предметам ты играл ', h('b', V.label.replace(/^Вариант \d+: /, '')),
        V.coreSize ? ` — совпадает ${V.haveCore} из ${V.coreSize} основных предметов этой сборки у топов.` : '.'),
      h('div.hint', V.curveScope === 'variant'
        ? `Поэтому сравниваю с ${V.curveGames} играми топов именно на этой сборке — за другую сборку ругать не буду.`
        : `На этой сборке у топов всего ${V.games} ${plural(V.games, 'игра', 'игры', 'игр')}, поэтому фарм и урон сравниваю со всеми ${V.curveGames} их играми на герое, а предметы — только с этой сборкой.`),
      r.variants.length > 1 ? h('div.vtabs', { style: { marginTop: '10px' } }, r.variants.map((v) => h(`div.vtab${v.index === V.index ? '.active' : ''}`,
        h('div.vtab-title', v.label + (v.index === V.index ? ' — твоя' : '')),
        h('div.vtab-meta', `${v.games} ${plural(v.games, 'игра', 'игры', 'игр')} топов · винрейт `, h('b', { style: { color: v.winrate >= 0.5 ? 'var(--good)' : 'var(--bad)' } }, F.pct(v.winrate))),
        v.signature.length ? h('div.mini-items', { style: { marginTop: '6px' } }, v.signature.map(itemImg)) : null))) : null) : null;

    // По фазам
    const phasePanel = r.phases.length ? h('div.panel', h('h2', 'По фазам игры'),
      h('div.phases', r.phases.map((ph) => {
        const st = ph.stats;
        const row = (label, me, top, invert = false, fmt = F.num) => {
          const ok = me === null || top === null ? null : invert ? me <= top + 0.5 : me >= top * 0.92;
          return h('div.ph-row', h('span.muted', label), h('span.num', h('b', { style: { color: ok === null ? '' : ok ? 'var(--good)' : 'var(--bad)' } }, fmt(me)), h('span.muted', ` / ${fmt(top)}`)));
        };
        return h(`div.phase-card.${ph.level}`,
          h('div.ph-title', h('b', ph.name), h('span.muted', ph.to >= 60 ? `${ph.from}:00 и дальше` : `${ph.from}:00–${ph.to}:00`)),
          row('Души', st.nw.me, st.nw.top),
          row('Урон по героям', st.pdmg.me, st.pdmg.top),
          row('Крипы', st.farm.me, st.farm.top),
          row('Смерти', st.d.me, st.d.top, true, (v) => (v === null ? '—' : String(Math.round(v * 10) / 10).replace('.', ','))),
          h('div.ph-verdict', ph.level === 'good' ? 'На уровне топов' : ph.notes.join(', ')));
      })),
      h('div.hint', 'Сколько ты набрал именно за эту часть игры. Жирное — ты, после черты — медиана топов.')) : null;

    // Паверспайки
    const spikePanel = r.spikes.length ? h('div.panel', h('h2', 'Урон вокруг покупки предметов'),
      h('div.hint', { style: { marginBottom: '10px' } }, 'Сравнение темпа урона по героям за три минуты до и после покупки. На результат влияют и события матча.'),
      h('div.spikes', r.spikes.map((s) => spikeCard(s, {
        level: s.verdict.level,
        content: [h('b', 'У тебя: '), s.myT === null ? 'не куплен. ' : `куплен на ${F.time(s.myT)}${s.myT - s.topT > 60 ? ` (позже на ${F.time(s.myT - s.topT)})` : ''}. `,
          s.my ? `Урон ${F.num(s.my.before)} → ${F.num(s.my.after)}/мин. ` : '', s.verdict.text],
      })))) : null;

    const insights = h('div.panel', h('h2', 'Все выводы'),
      r.insights.length ? h('div.insights', r.insights.map((i) => h(`div.insight.${i.level}`, h('div.insight-area', i.area), h('div', h('div', i.text), i.tip ? h('div.tip', Icon('bulb'), h('span', i.tip)) : null))))
        : h('div.muted', 'Явных отставаний не видно — игра на уровне топов.'));


    // источники душ по фазам
    const sourcesPanel = r.sourcePhases && r.sourcePhases.some((p) => p.rows)
      ? h('div.panel', h('h2', { style: { marginBottom: '2px' } }, 'Где ты недобираешь души'),
        h('div.muted', { style: { marginBottom: '12px' } }, 'Сколько душ ты набрал с каждого источника в каждой фазе игры — против медианы топов. Красным — где отстаёшь.'),
        sourcePhaseCards(r.sourcePhases, { refLabel: 'топы', unitNote: 'души за фазу: ты / топы' }))
      : null;

    // предметы
    const statusPill = (it) => {
      if (it.status === 'late') return h('span.pill.bad', `позже на ${F.time(it.delay)}`);
      if (it.status === 'early') return h('span.pill.good', `раньше на ${F.time(-it.delay)}`);
      if (it.status === 'missing') return h('span.pill.warn', 'не купил');
      if (it.status === 'na') return h('span.pill', 'игра кончилась');
      return h('span.pill.good', 'вовремя');
    };
    const spikeIds = new Set(r.spikes.map((s) => s.id));
    const itemsPanel = h('div.panel', h('h2', 'Предметы твоей сборки: ты и топы'),
      itemTimeline([
        { label: 'Топы', items: r.items.map((it) => ({ id: it.id, t: it.topT })) },
        { label: 'Ты', items: r.items.filter((it) => it.myT !== null).map((it) => ({ id: it.id, t: it.myT })) },
      ], { spikeIds: new Set(r.spikes.map((s) => s.id)), maxT: m.duration_s }),
      slotKey(),
      h('table.table', h('thead', h('tr', h('th', 'Предмет'), h('th.r', 'Топы'), h('th.r', 'Ты'), h('th', ''))),
        h('tbody', r.items.map((it) => h('tr',
          h('td', h('div.row.nowrap', { style: { gap: '8px' } }, h('span.mini-items', itemImg(it.id)), itemName(it.id), spikeIds.has(it.id) ? h('span.pill.warn', { title: 'После этого предмета топы резко поднимают урон' }, 'спайк') : null)),
          h('td.r.num', F.time(it.topT), h('div.dim', { style: { fontSize: '11px' } }, `берут ${F.pct(it.topPick)}`)),
          h('td.r.num', F.time(it.myT)),
          h('td', statusPill(it)))))),
      r.extras && r.extras.length ? h('div.hint', `Ещё ты купил (в этой сборке топы берут редко — это не ошибка, просто иначе): ${r.extras.slice(0, 8).map((x) => itemName(x.id)).join(', ')}`) : null);

    // контрольные точки
    const cpTable = h('div.panel', h('h2', 'Контрольные точки'),
      h('table.table', h('thead', h('tr', h('th', 'Время'), h('th.r', 'Души'), h('th.r', 'Урон по героям'), h('th.r', 'Крипы'), h('th.r', 'Смерти'), h('th.r', 'Уб.+пом.'))),
        h('tbody', r.checkpoints.map((c) => {
          const cell = (f, invert = false) => {
            const me = c.me[f];
            const top = c.top[f];
            const better = invert ? me <= top : me >= top;
            return h('td.r.num', h('span', { style: { color: better ? 'var(--good)' : 'var(--bad)' } }, f === 'd' || f === 'ka' ? Math.round(me) : F.num(me)), h('span.muted', ` / ${f === 'd' || f === 'ka' ? Math.round(top * 10) / 10 : F.num(top)}`));
          };
          return h('tr', h('td.num', `${c.minute}:00`), cell('nw'), cell('pdmg'), cell('farm'), cell('d', true), cell('ka'));
        }))),
      h('div.hint', 'Слева твоё значение, справа — медиана топов. Зелёный — не хуже топов.'));

    return h('div', h('div.panel', head, bar, scores), episode, review.panel, replay, mainPanel, macroReviewPanel(A.macro, review.seek), matchLeaksPanel(A, review.seek), variantPanel, phasePanel, sourcesPanel, spikePanel, A.map ? mapPanel(A.map, A.mySlot ?? null, 'Карта матча') : null, itemsPanel, insights, cpTable);
  }


  // ================= РАЗБОР ОШИБОК =================
  // Что мешает расти: повторяющиеся ошибки по последним играм, их цена и как исправить.
  async function loadGrowth() {
    const account = S.auth;
    const G = S.growth;
    if (!account || G.loading) return;
    G.loading = true;
    G.error = null;
    if (S.view === 'growth') renderGrowth();
    try {
      G.data = await dc.leaks();
      G.for = account.accountId;
    } catch (e) {
      G.error = e.message;
    } finally {
      G.loading = false;
      if (S.view === 'growth' && S.growth === G) renderGrowth();
    }
  }

  const HABITS = {
    d10: { label: 'Смерти до 10:00', fmt: (v) => String(Math.round(v * 10) / 10).replace('.', ','), lower: true },
    neu9: { label: 'Души с леса к 9:00', fmt: (v) => F.num(v), why: 'Малый лагерь у линии появляется на 2:00 и восстанавливается через 1:25 — бесплатные души, пока ждёшь волну.' },
    brk9: { label: 'Души с коробок к 9:00', fmt: (v) => F.num(v), why: 'Коробки появляются на 3:00 и восстанавливаются через 3 минуты после поломки.' },
    pu10: { label: 'Постоянные бафы к 10:00', fmt: (v) => String(Math.round(v)), why: 'Из контейнеров с бафами (бывшие золотые статуи, с 3:00) и с джекпота Sinner’s. Здоровье, урон, скорость стрельбы — до конца игры.' },
    brk20: { label: 'Души с коробок к 20:00', fmt: (v) => F.num(v) },
    pu20: { label: 'Постоянные бафы к 20:00', fmt: (v) => String(Math.round(v)) },
  };

  // Моменты ошибки: чипы со временем. Клик — показать момент на мини-карте матча.
  function momentChips(leak, onPick, picked) {
    if (!leak.moments || !leak.moments.length) return null;
    return h('div.moments', leak.moments.map((mo, i) => h(`button.moment${picked === i ? '.on' : ''}`, {
      onclick: onPick ? () => onPick(i, mo) : null,
      disabled: onPick ? null : true,
      title: onPick ? 'Показать этот момент на карте' : null,
    }, h('b.num', F.time(mo.t)), h('span', mo.text))));
  }

  function wrCompare(row) {
    if (row.wrWith === null || row.wrWithout === null) return null;
    if (Math.abs(row.wrWith - row.wrWithout) < 0.05) {
      return h('div.wr-same', `В разобранных матчах доля побед близкая — ${F.pct(row.wrWith)} с этим эпизодом и ${F.pct(row.wrWithout)} без него.`);
    }
    const bar = (label, v, cls) => h('div.wr-line', h('span.wr-label', label), h('div.wr-track', h(`span.${cls}`, { style: { width: `${Math.max(3, Math.round(v * 100))}%` } })), h('b.num', F.pct(v)));
    return h('div.wr-compare', h('div.hint', 'Доля побед в разобранных матчах'), bar('с замечанием', row.wrWith, 'bad'), bar('без замечания', row.wrWithout, 'good'));
  }

  function leakCost(row) {
    const parts = [];
    if (row.souls) parts.push(h('span.pill.bad', `≈ ${F.num(row.souls)} ${plural(row.souls, 'душа', 'души', 'душ')} мимо`));
    if (row.deaths) parts.push(h('span.pill.bad', `${row.deaths} ${plural(row.deaths, 'смерть', 'смерти', 'смертей')} на линии`));
    if (row.allyDeaths) parts.push(h('span.pill.bad', `${row.allyDeaths} ${plural(row.allyDeaths, 'смерть', 'смерти', 'смертей')} союзников`));
    if (row.statues) parts.push(h('span.pill.warn', `${row.statues} ${plural(row.statues, 'баф', 'бафа', 'бафов')} мимо`));
    return parts.length ? h('div.leak-cost', parts) : null;
  }

  function openGrowthEpisode(episode) {
    setView('matches');
    return openMatch(episode.matchId, episode);
  }

  function leakExamples(row) {
    return h('div.leak-examples', row.examples.map((g) => {
      const moments = (g.moments || []).filter((mo) => Number.isFinite(mo.t) && mo.t >= 0).slice(0, 3);
      return h('div.leak-example',
        h('button.leak-ex', { onclick: () => { setView('matches'); openMatch(g.match_id); }, title: 'Открыть разбор этого матча' },
          heroIcon(g.hero, '.sm'),
          h('div.grow',
            h('div.leak-ex-head', h('b', heroName(g.hero)), h(`span.res.${g.won ? 'win' : 'loss'}`, g.won ? 'победа' : 'поражение'), h('span.dim', F.ago(g.start_time))),
            moments.length ? null : exampleBody(g))),
        moments.length ? momentChips({ moments }, (_i, mo) => openGrowthEpisode({ ...mo, matchId: g.match_id, title: g.title, context: g.context })) : null,
        g.context ? h('div.hint.analysis-context', g.context) : null);
    }));
  }

  // Что показать в примере: моменты со временем, предметы-ответы или текст целиком.
  function exampleBody(g) {
    const x = g.extra;
    if (x && x.items && x.items.length) {
      const what = [x.kills ? `убил тебя ${x.kills} ${plural(x.kills, 'раз', 'раза', 'раз')}` : '', x.share >= 0.3 ? `${Math.round(x.share * 100)}% урона по тебе` : ''].filter(Boolean).join(' · ');
      return h('div.leak-ex-counter',
        h('div.small', h('b', heroName(x.hero)), what ? ` — ${what}` : ''),
        h('div.counter-items', h('span.dim.small', 'Топы против него берут:'), x.items.map((it) => h('span.counter-item', { title: `${itemName(it.id)}: против ${heroName(x.hero)} берут в ${String(it.lift).replace('.', ',')} раза чаще, чем обычно` },
          itemImg(it.id), h('span', itemName(it.id)), h('b.num', `×${String(Math.round(it.lift * 10) / 10).replace('.', ',')}`)))));
    }
    return h('div.leak-ex-text', g.text);
  }

  function renderGrowth() {
    const v = $('view-growth');
    if (!v) return;
    const G = S.growth;
    const d = G.data;
    const head = h('div.page-head',
      h('div', h('div.crumbs', 'Моя игра / Ошибки'), h('h1', 'Что мешает тебе расти'),
        h('div.sub', 'Разбор твоих последних игр: какие ошибки повторяются, сколько они стоят и что делать. Сравниваю с топами на твоих героях и с игроками высоких рангов.')),
      h('div.row', h('button.btn', { onclick: loadGrowth, disabled: G.loading || null }, G.loading ? h('span.spin') : Icon('refresh'), 'Проверить новые игры')));
    if (!S.auth) return void v.replaceChildren(head, h('div.empty', h('strong', 'Войди через Steam'), 'Разбор ошибок строится по твоим матчам.', h('div', { style: { marginTop: '14px' } }, h('button.btn.steam', { onclick: login }, 'Войти через Steam'))));
    if (G.loading && !d) return void v.replaceChildren(head, skeleton('Скачиваю твои матчи и ищу повторяющиеся ошибки — в первый раз это займёт пару минут'));
    if (G.error && !d) return void v.replaceChildren(head, h('div.empty', h('strong', 'Не получилось'), G.error, h('div', { style: { marginTop: '12px' } }, h('button.btn', { onclick: loadGrowth }, 'Попробовать ещё раз'))));
    if (!d) return void v.replaceChildren(head);

    const rows = d.profile.rows;
    const n = d.profile.games;
    const notes = [];
    if (d.fresh < d.total) {
      notes.push(h('div.note', Icon('info'), h('div', d.fresh
        ? `Подробные данные (лес, коробки, постоянные бафы, драки по секундам) есть для ${d.fresh} из ${d.total} игр. Остальные скачаются заново при следующих проверках — разбор станет точнее.`
        : 'Твои матчи сохранены старой версией программы — в них нет леса, коробок, постоянных бафов и драк по секундам. Нажми «Проверить новые игры»: программа перекачает их.')));
    }
    if (!n) return void v.replaceChildren(head, ...notes, h('div.empty', h('strong', 'Пока нечего разбирать'), 'Нужны матчи с подробными данными. Сыграй пару игр или нажми «Проверить новые игры».'));

    // ---------- главное сейчас ----------
    const top = rows[0];
    const goal = d.profile.goal;
    const nextGoal = goal ? h('section.panel.kraft', h('h2', 'Цель на следующий матч'), h('b', goal.title),
      h('p', goal.action), h('div.hint', goal.check),
      h('div.hint', `Основание — «${goal.reason}» в ${goal.count} из ${goal.eligible} матчей, которые можно было проверить.`),
      h('div.row',
        h('button.btn.small', { onclick: () => openGrowthEpisode(goal.episode) }, `Открыть эпизод · ${F.time(goal.episode.t)}`),
        ['lane_trades', 'lost_souls', 'solo_deaths'].includes(goal.key) ? h('button.btn.small', { disabled: S.coach.loading || null, onclick: () => {
          loadCoach(false, { ...goal.episode, key: goal.key === 'lane_trades' ? undefined : goal.key });
          setView('coach');
        } }, 'Отслеживать в тренере') : null)) : null;
    const focus = top ? h('section.leak-focus',
      h('div.leak-focus-main',
        h('div.leak-kicker', Icon('flame'), 'Главное сейчас'),
        h('h2.leak-focus-title', top.title),
        h('div.leak-focus-freq', h('b.num', `${top.count} из ${top.eligible}`), ' проверяемых матчей'),
        top.unknown ? h('div.hint', `Для проверки этого замечания не хватило данных в ${top.unknown} из ${n} разобранных матчей.`) : null,
        leakCost(top),
        wrCompare(top),
        h('div.leak-fix', h('div.leak-fix-title', 'Как исправить'), h('ol', (top.fix || []).map((x) => h('li', x))))),
      h('div.leak-focus-side', h('div.leak-side-title', 'Где это было'), leakExamples(top))) : h('div.empty', h('strong', 'Повторяющихся ошибок не нашёл'), 'В последних играх нет ошибки, которая повторялась бы. Продолжай — и смотри разбор каждой игры в «Моих матчах».');

    // ---------- все ошибки ----------
    const list = rows.length > 1 ? h('section.panel', h('h2', 'Все замечания'),
      h('div.hint', { style: { marginBottom: '12px' } }, 'По важности: как часто случается и насколько дорого обходится. Нажми, чтобы раскрыть.'),
      h('div.leak-list', rows.map((r, i) => {
        const open = G.open === r.key;
        return h(`div.leak-row${open ? '.open' : ''}`,
          h('button.leak-row-head', { onclick: () => { G.open = open ? null : r.key; renderGrowth(); }, 'aria-expanded': open ? 'true' : 'false' },
            h('span.leak-rank.num', String(i + 1)),
            h('div.grow', h('div.leak-area', r.area), h('div.leak-title', r.title)),
            h('div.leak-freq', { title: 'Из матчей, которые можно было проверить' }, h('div.leak-freq-bar', h('span', { style: { width: `${Math.round(r.share * 100)}%` } })), h('span.num', `${r.count} из ${r.eligible}`)),
            r.wrWith !== null && r.wrWithout !== null ? h(`span.pill.${r.wrWith < r.wrWithout - 0.05 ? 'bad' : ''}`, { title: 'Доля побед в играх с этой ошибкой и без неё' }, `${F.pct(r.wrWith)} / ${F.pct(r.wrWithout)}`) : null),
          open ? h('div.leak-row-body', r.unknown ? h('div.hint', `Пропущено матчей из-за нехватки данных: ${r.unknown} из ${n}.`) : null, leakCost(r), wrCompare(r),
            h('div.leak-fix', h('div.leak-fix-title', 'Как исправить'), h('ol', (r.fix || []).map((x) => h('li', x)))),
            h('div.leak-side-title', 'Примеры'), leakExamples(r)) : null);
      }))) : null;

    // ---------- привычки первых минут ----------
    const rankLabel = d.rank ? rankName(d.rank.tier) : 'твой ранг';
    const habits = h('section.panel', h('h2', 'Первые 10 минут: ты, твой ранг и высокий ранг'),
      h('div.hint', { style: { marginBottom: '14px' } }, 'Сравнение с сохранённой выборкой рейтинговых игр. В последней колонке показана доля побед игроков Arcanist–Emissary с таким показателем.'),
      h('div.habit-grid',
        h('div.habit-head', h('span', ''), h('span', 'Ты'), h('span', rankLabel), h('span', 'Ascendant+'), h('span', 'Доля побед')),
        d.habits.filter((x) => HABITS[x.key]).map((x) => {
          const H = HABITS[x.key];
          // красный — хуже твоего ранга, зелёный — на уровне Ascendant+, без цвета — между ними
          const worse = x.mine !== null && x.rank !== null && (H.lower ? x.mine > x.rank : x.mine < x.rank * 0.9);
          const great = x.mine !== null && x.top !== null && (H.lower ? x.mine <= x.top : x.mine >= x.top * 0.95);
          const link = x.link && x.link.mine ? `${F.pct(x.link.mine.wr)} → ${F.pct(x.link.best[1])}` : '—';
          return h('div.habit-row',
            h('div', h('div.habit-label', H.label), H.why ? h('div.habit-why', H.why) : null),
            h(`b.num${worse ? '.bad' : great ? '.ok' : ''}`, x.mine === null ? '—' : H.fmt(x.mine)),
            h('span.num.muted', x.rank === null ? '—' : H.fmt(x.rank)),
            h('span.num', x.top === null ? '—' : H.fmt(x.top)),
            h('span.num.habit-link', { title: x.link ? `С твоим показателем — ${link.split(' → ')[0]}, с лучшим — ${link.split(' → ')[1] || '—'}` : null }, link));
        })));

    v.replaceChildren(head, ...notes, nextGoal, focus, list, habits);
  }

  // ================= НАСТРОЙКИ =================
  function renderSettings() {
    const s = S.settings;
    const f = {};
    let fieldIndex = 0;
    const field = (label, el, hint) => {
      const id = `settings-field-${++fieldIndex}`;
      const control = el.matches('input, select, textarea') ? el : el.querySelector('input');
      control.id = id;
      if (hint) control.setAttribute('aria-describedby', `${id}-hint`);
      return [h('label', { for: id }, label), h('div', el, hint ? h('div.hint', { id: `${id}-hint` }, hint) : null)];
    };
    f.region = h('select.select', ['Europe', 'NAmerica', 'SAmerica', 'Asia', 'Oceania'].map((r) => h('option', { value: r, selected: s.region === r }, { Europe: 'Европа', NAmerica: 'Северная Америка', SAmerica: 'Южная Америка', Asia: 'Азия', Oceania: 'Океания' }[r])));
    f.topN = h('select.select', [50, 100].map((n) => h('option', { value: n, selected: Number(s.topN) === n || null }, `Топ-${n}`)));
    f.topSource = h('select.select',
      h('option', { value: 'auto', selected: s.topSource !== 'list' || null }, 'Ладдер текущего сезона'),
      h('option', { value: 'list', selected: s.topSource === 'list' || null }, 'Только мой список игроков'));
    f.days = h('select.select', [1, 2, 3, 5, 7, 10, 14].map((n) => h('option', { value: n, selected: Number(s.days) === n || null }, `${n} ${plural(n, 'день', 'дня', 'дней')}`)));
    f.onlyRanked = h('input', { type: 'checkbox', checked: s.onlyRanked || null });
    f.benchmarkSource = h('select.select', h('option', { value: 'top', selected: s.benchmarkSource === 'top' }, 'Только игроки из топа'), h('option', { value: 'lobby', selected: s.benchmarkSource === 'lobby' }, 'Все игроки в матчах топов (больше данных)'));
    f.winsOnly = h('input', { type: 'checkbox', checked: s.winsOnly || null });
    f.autoRefreshHours = h('input.input', { type: 'number', min: 0, max: 24, value: s.autoRefreshHours });
    f.keepDays = h('input.input', { type: 'number', min: 1, max: 60, value: s.keepDays });
    f.apiKey = h('input.input', { type: 'password', value: s.apiKey || '', placeholder: 'не обязательно', style: { width: '320px' } });
    f.manualTop = h('textarea.input', { rows: 4, placeholder: 'по одному на строку: ссылка на профиль Steam или ID', style: { width: '420px', resize: 'vertical' } }, s.manualTop || '');
    f.steamDir = h('input.input', { value: s.steamDir || '', placeholder: 'найдётся автоматически', style: { width: '320px' } });
    const save = async () => {
      try {
        const patch = {
          region: f.region.value,
          topN: Number(f.topN.value) || 50,
          topSource: f.topSource.value,
          days: Number(f.days.value),
          onlyRanked: f.onlyRanked.checked,
          benchmarkSource: f.benchmarkSource.value,
          winsOnly: f.winsOnly.checked,
          autoRefreshHours: Number(f.autoRefreshHours.value),
          keepDays: Number(f.keepDays.value),
          apiKey: f.apiKey.value.trim(),
          steamDir: f.steamDir.value.trim(),
          manualTop: f.manualTop.value.trim(),
        };
        const regionChanged = patch.region !== s.region || patch.topN !== s.topN || patch.topSource !== s.topSource;
        const r = await dc.saveSettings(patch);
        S.settings = r.settings;
        if (r.meta) S.meta = r.meta;
        toast(regionChanged ? 'Сохранено. Нажми «Обновить данные» на вкладке меты.' : 'Сохранено');
        renderSettings();
      } catch (e) {
        toast(e.message, true);
      }
    };
    $('view-settings').replaceChildren(
      h('div.page-head', h('div', h('div.crumbs', 'Приложение'), h('h1', 'Настройки'))),
      h('div.panel', h('div.settings-grid',
        field('Регион ладдера', f.region),
        field('Сколько топов брать', f.topN, 'Топ-100 даёт больше игр на редких героях, топ-50 — только самые сильные игроки.'),
        field('Источник топа', f.topSource, 'Только текущий сезон. Если ладдер ещё короткий, недостающие игроки добираются из свежих матчей этого сезона с самым высоким рангом.'),
        field('За сколько дней матчи топов', f.days, 'По умолчанию неделя. Меньше дней — свежее мета, больше — больше игр на редких героях. После смены нажми «Обновить данные».'),
        field('Только рейтинговые матчи', h('label.check', f.onlyRanked, 'учитывать только ranked')),
        field('С кем сравнивать мои матчи', f.benchmarkSource, '«Все игроки в матчах топов» — это тоже очень высокий уровень, а данных в несколько раз больше.'),
        field('Сравнивать только с победами', h('label.check', f.winsOnly, 'показывать, как играют топы, когда выигрывают')),
        field('Автообновление, часов', f.autoRefreshHours, '0 — выключено. Обновление идёт, пока приложение открыто.'),
        field('Хранить матчи топов, дней', f.keepDays, 'Старые матчи топов удаляются. Твои матчи не удаляются никогда.'),
        field('Ключ deadlock-api', f.apiKey, 'Не обязателен. С ключом выше лимиты запросов — бесплатно выдают в Discord проекта deadlock-api.'),
        field('Папка Steam', f.steamDir, 'Нужна для поиска матчей в кэше Steam. Обычно находится сама.'),
        field('Свой список топов', f.manualTop, 'Используется, когда ладдер пуст (первые дни нового сезона). Можно вставить ссылки на профили сильных игроков с сайтов статистики.'),
        h('div'), h('div', h('button.btn.primary', { onclick: save }, 'Сохранить')))),
      updatesPanel(),
      overlaySettingsPanel(),
      h('div.panel', h('h2', 'О данных'),
        h('p.muted', 'Все данные — из открытого сервиса deadlock-api.com (не связан с Valve). Статистика матчей топов, их предметы, души и урон по минутам берутся из метаданных матчей.'),
        h('p.muted', 'Не каждый матч сразу есть в сервисе. Чтобы твои игры попадали туда надёжно, используй кнопку «Найти в кэше Steam» в «Моих матчах» или поставь официальную утилиту сбора.'),
        h('div.row', h('button.btn', { onclick: () => dc.openUrl('https://deadlock-api.com/ingest-cache') }, 'Утилита сбора матчей'), h('button.btn', { onclick: () => dc.openUrl('https://deadlock-api.com') }, 'deadlock-api.com')),
        h('p.dim', `Версия ${S.version || ''}`)),
      S.status && S.status.report ? diagnosticsPanel(S.status.report) : null);
  }

  // ---------- обновления ----------
  const UP = { info: null, state: 'idle', pct: 0, error: null, hidden: false, checking: false };

  // «Что нового» из описания релиза: простые строки и пункты списка.
  function releaseNotes(text, max = 8) {
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^#/.test(l) && !/^[-=*_]{3,}$/.test(l))
      .map((l) => l.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1'));
    if (!lines.length) return null;
    const shown = lines.slice(0, max);
    return h('ul.up-notes', shown.map((l) => h('li', l.replace(/^[-*•]\s*/, ''))), lines.length > max ? h('li.dim', `и ещё ${lines.length - max}…`) : null);
  }

  async function startUpdate() {
    UP.state = 'downloading';
    UP.pct = 0;
    UP.error = null;
    renderUpdate();
    try {
      await dc.updateDownload();
      UP.state = 'ready';
    } catch (e) {
      UP.state = 'error';
      UP.error = e.message;
    }
    renderUpdate();
    if (S.view === 'settings') renderSettings();
  }

  function updateActions(compact = false) {
    const r = UP.info;
    if (!r || !r.available) return null;
    if (r.mode !== 'installed') {
      return h('div.row', { style: { gap: '8px', flexWrap: 'wrap' } },
        h('button.btn.primary', { onclick: () => dc.openUrl(r.release.page) }, 'Открыть страницу релиза'),
        h('span.hint', r.mode === 'portable' ? 'Переносную версию обновляют вручную: скачай новый .exe со страницы релиза.' : 'Эта копия запущена из исходников — скачай установщик со страницы релиза.'));
    }
    if (UP.state === 'downloading') {
      return h('div', h('div.up-bar', h('span', { style: { width: `${Math.max(3, UP.pct)}%` } })), h('div.hint', `Скачиваю… ${UP.pct > 0 ? UP.pct + '%' : ''}`));
    }
    if (UP.state === 'ready') {
      return h('div.row', { style: { gap: '8px' } },
        h('button.btn.primary', { onclick: () => dc.updateInstall().catch((e) => toast(e.message, true)) }, Icon('refresh'), 'Перезапустить и обновить'),
        compact ? null : h('span.hint', 'Программа закроется на несколько секунд и откроется уже новой.'));
    }
    return h('div', h('div.row', { style: { gap: '8px', flexWrap: 'wrap' } },
      h('button.btn.primary', { onclick: startUpdate }, Icon('download'), r.release.setup ? `Обновить${r.release.setup.size ? ` · ${Math.round(r.release.setup.size / 1048576)} МБ` : ''}` : 'Обновить'),
      compact ? h('button.btn.ghost', { onclick: () => { UP.hidden = true; renderUpdate(); } }, 'Позже') : null,
      compact ? h('button.btn.ghost', { onclick: () => { dc.updateSkip(r.release.version); UP.hidden = true; renderUpdate(); } }, 'Пропустить версию') : null),
      UP.state === 'error' ? h('div.hint', { style: { color: 'var(--bad)', marginTop: '6px' } }, UP.error) : null);
  }

  function renderUpdate() {
    let box = $('update-card');
    if (!box) {
      box = h('div#update-card');
      document.body.appendChild(box);
    }
    const r = UP.info;
    if (!r || !r.available || UP.hidden) return void box.replaceChildren();
    box.replaceChildren(h('div.up-card', { role: 'dialog', 'aria-label': 'Доступно обновление' },
      h('div.up-head', h('span.up-dot'), h('b', `Вышла версия ${r.release.version}`), h('span.dim', `у тебя ${r.current}`)),
      releaseNotes(r.release.notes, 5),
      updateActions(true)));
  }

  dc.on('update:available', (r) => {
    UP.info = r;
    UP.hidden = false;
    renderUpdate();
  });
  dc.on('update:progress', (p) => {
    UP.pct = p.pct >= 0 ? p.pct : UP.pct;
    renderUpdate();
    if (S.view === 'settings') renderSettings();
  });

  function updatesPanel() {
    const r = UP.info;
    const check = async () => {
      UP.checking = true;
      renderSettings();
      try {
        UP.info = await dc.updateCheck();
        UP.hidden = false;
        if (UP.info.available) renderUpdate();
        else toast(UP.info.reason || 'У тебя последняя версия');
      } catch (e) {
        toast(`Не получилось проверить: ${e.message}`, true);
      } finally {
        UP.checking = false;
        renderSettings();
      }
    };
    const auto = h('input', { type: 'checkbox', checked: S.settings.autoUpdateCheck !== false || null, onchange: async (e) => {
      const res = await dc.saveSettings({ autoUpdateCheck: e.target.checked });
      S.settings = res.settings;
    } });
    return h('div.panel', h('h2', 'Обновления'),
      h('div.settings-grid',
        h('label', 'Версия'), h('div', h('b', S.version || '—'), r && r.mode ? h('span.dim', ` · ${{ installed: 'установленная', portable: 'переносная', dev: 'из исходников' }[r.mode] || ''}`) : null),
        h('label', 'Проверка'), h('div', h('div.row', { style: { gap: '10px' } }, h('button.btn', { onclick: check, disabled: UP.checking || null }, UP.checking ? h('span.spin') : Icon('refresh'), 'Проверить обновления'),
          h('label.check', auto, 'проверять при запуске')),
          r && !r.available && r.reason ? h('div.hint', r.reason) : r && !r.available ? h('div.hint', 'У тебя последняя версия.') : null),
        r && r.available ? h('label', `Новая версия ${r.release.version}`) : null,
        r && r.available ? h('div', releaseNotes(r.release.notes, 12), updateActions(false)) : null));
  }

  // ---------- оверлей «Пик против состава»: настройки ----------
  const OV = { data: null, loading: false, error: null, log: null, logLoading: false, recording: false, key: null };

  async function loadOverlayData() {
    if (OV.loading || !S.auth) return;
    OV.loading = true;
    try {
      OV.data = await dc.pickAdvise({});
      OV.key = await dc.overlayKey().catch(() => null);
      OV.rec = await dc.recStatus().catch(() => null);
      OV.error = null;
    } catch (e) {
      OV.error = e.message;
    } finally {
      OV.loading = false;
      if (S.view === 'settings') renderSettings();
    }
  }

  // Клавиши в формате Electron: Ctrl+Shift+D, Alt+F2 и т. п.
  function accelFromEvent(e) {
    const k = e.key;
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return null;
    let key = k.length === 1 ? k.toUpperCase() : k;
    if (/^F\d{1,2}$/.test(k)) key = k;
    else if (k === ' ') key = 'Space';
    else if (e.code && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
    else if (e.code && /^Digit\d$/.test(e.code)) key = e.code.slice(5);
    else if (!/^[A-Z0-9]$/.test(key) && !['Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Delete'].includes(key)) return null;
    const mods = [e.ctrlKey ? 'Ctrl' : null, e.altKey ? 'Alt' : null, e.shiftKey ? 'Shift' : null].filter(Boolean);
    if (!mods.length && !/^F\d{1,2}$/.test(key)) return null; // одиночная буква мешала бы играть
    return [...mods, key].join('+');
  }

  function overlaySettingsPanel() {
    if (!S.auth) return h('div.panel', h('h2', 'Оверлей «Пик против состава»'), h('p.muted', 'Войди через Steam — оверлей подбирает пик из твоих героев.'));
    if (!OV.data && !OV.loading && !OV.error) loadOverlayData();
    const s = S.settings;
    const keyBox = h('input.input.key-input', { readonly: true, value: s.overlayKey || '', placeholder: 'нажми сочетание клавиш', style: { width: '200px' },
      onfocus: () => { OV.recording = true; },
      onblur: () => { OV.recording = false; },
      onkeydown: async (e) => {
        e.preventDefault();
        if (e.key === 'Escape') return e.target.blur();
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.target.value = '';
          return;
        }
        const acc = accelFromEvent(e);
        if (acc) e.target.value = acc;
      } });
    const saveKey = async () => {
      try {
        const r = await dc.saveSettings({ overlayKey: keyBox.value.trim() || null });
        S.settings = r.settings;
        const k = r.overlayKey;
        if (k && !k.ok && keyBox.value.trim()) toast('Это сочетание занято другой программой — выбери другое', true);
        else toast(keyBox.value.trim() ? `Готово: ${keyBox.value.trim()} показывает и прячет оверлей` : 'Горячая клавиша выключена');
        OV.key = await dc.overlayKey().catch(() => null);
        renderSettings();
      } catch (e) {
        toast(e.message, true);
      }
    };
    const d = OV.data;
    let poolBlock;
    if (OV.loading && !d) poolBlock = h('div.row', h('span.spin'), 'Загружаю твоих героев…');
    else if (OV.error) poolBlock = h('div.muted', OV.error);
    else if (d) {
      const inPool = new Set(d.pool);
      const toggle = async (id) => {
        const next = inPool.has(id) ? d.pool.filter((x) => x !== id) : [...d.pool, id];
        try {
          const r = await dc.saveSettings({ pickPool: next.length ? next : null });
          S.settings = r.settings;
          OV.data = null;
          loadOverlayData();
        } catch (e) {
          toast(e.message, true);
        }
      };
      const list = d.allHeroes.filter((x) => x.games >= 1 || inPool.has(x.hero_id));
      const rankedText = (x) => x.rankedEvidence === 'points' ? 'По истории набран порог' : x.rankedEvidence === 'played' ? 'Есть матчи в рейтинге' : 'Недостаточно данных о допуске';
      poolBlock = h('div',
        h('div.hint', { style: { marginBottom: '8px' } }, `${d.manual ? 'Список задан вручную. ' : ''}Бета-сезон 2: ${d.rankedThreshold} очков на герое в Standard. Победа — 2, поражение — 1. Здесь очки по доступным матчам сезона. Точный допуск смотри в игре.`),
        h('div.pool-grid', list.map((x) => {
          const label = `${heroName(x.hero_id)}. Очков по истории: ${x.unlockPoints}. ${rankedText(x)}.`;
          return h(`button.pool-hero${inPool.has(x.hero_id) ? '.on' : ''}`, { onclick: () => toggle(x.hero_id), title: label, 'aria-label': label },
            heroIcon(x.hero_id, '.sm'), h('span', heroName(x.hero_id)), h('span.num.dim', `${x.unlockPoints} очк.${x.rankedEvidence === 'unknown' ? ' · ?' : ''}`));
        })),
        d.manual ? h('button.btn.small', { style: { marginTop: '10px' }, onclick: async () => { const r = await dc.saveSettings({ pickPool: null }); S.settings = r.settings; OV.data = null; loadOverlayData(); } }, 'Вернуть автоматический список') : null,
        h('div.hint', { style: { marginTop: '8px' } }, d.metaInfo ? `Совет считается по ${d.metaInfo.games.toLocaleString('ru-RU')} матчам ${d.metaInfo.badge >= 91 ? 'Фантом и выше' : 'Оракул и выше'} за 2 недели (статистика deadlock-api) и твоим играм.` : `Статистика deadlock-api пока не загрузилась (${d.metaError || 'нет связи'}) — совет считается по скачанным матчам.`));
    }
    const lg = OV.log;
    let logBlock = null;
    if (OV.logLoading) logBlock = h('div.row', h('span.spin'), 'Читаю лог игры…');
    else if (lg) {
      logBlock = !lg.found
        ? h('div.note', Icon('info'), h('div', lg.reason, lg.gameDir ? h('div.dim', lg.gameDir) : null))
        : h('div.log-res',
          h('div', h('b', 'Файл найден: '), h('span.dim', lg.file), ` · ${F.num(lg.size / 1024)} КБ · изменён ${F.clock(Math.round(lg.modified / 1000))}`),
          lg.heroes.length
            ? h('div', { style: { marginTop: '6px' } }, h('b', 'Герои в последних строках: '), lg.heroes.slice(0, 20).map((x) => `${heroName(x.id)} (${x.n})`).join(', '))
            : h('div', { style: { marginTop: '6px' } }, 'Имён героев в логе не нашёл.'),
          lg.samples.length ? h('pre.log-pre', lg.samples.map((x) => x.text).join('\n')) : h('pre.log-pre', lg.last.join('\n')),
          h('div.hint', 'Сыграй матч с -condebug, потом нажми проверку и пришли мне скриншот этого блока — по нему станет ясно, можно ли узнавать состав автоматически.'));
    }
    return h('div.panel',
      h('h2', 'Оверлей «Пик против состава»'),
      h('p.muted', { style: { marginTop: 0 } }, 'Окно поверх игры для паузы перед рейтинговым матчем: отмечаешь стартовых героев соперников — получаешь лучший пик из своих героев. Видно поверх игры в режиме «В окне без рамки» (Borderless). Игру не трогает: не читает память и не меняет файлы.'),
      h('div.settings-grid',
        h('label', 'Горячая клавиша'), h('div', h('div.row', keyBox, h('button.btn', { onclick: saveKey }, 'Сохранить клавишу'), h('button.btn.primary', { onclick: () => dc.toggleOverlay(true) }, 'Открыть оверлей')),
          h('div.hint', OV.key && OV.key.key ? `Работает: ${OV.key.key}. Нажми в поле и зажми новое сочетание; Backspace — выключить.` : 'Клавиша не активна — нажми в поле и зажми сочетание, например Ctrl+Shift+D.')),
        h('label', 'Мои герои для рейтинга'), h('div', poolBlock),
        h('label', 'Узнавать состав сам'), h('div', recSettings(logBlock)),
        h('label', 'Игровой режим'), h('div', gameModeSettings()),
        h('label', 'Матчи топов'), h('div',
          h('button.btn.small.danger', { onclick: async (e) => {
            const b = e.currentTarget;
            if (b.dataset.sure !== '1') {
              b.dataset.sure = '1';
              b.lastChild.textContent = 'Точно сбросить? Нажми ещё раз';
              setTimeout(() => { b.dataset.sure = ''; b.lastChild.textContent = 'Сбросить матчи топов'; }, 4000);
              return;
            }
            b.disabled = true;
            try {
              const r = await dc.resetTop();
              S.top = null;
              toast(`Удалено ${F.num(r.removed)} матчей топов. Твои матчи на месте (${F.num(r.kept)}). Нажми «Обновить данные», чтобы собрать мету заново.`);
            } catch (err) {
              toast(err.message);
            }
            b.disabled = false;
            b.dataset.sure = '';
            b.lastChild.textContent = 'Сбросить матчи топов';
          } }, Icon('refresh'), h('span', 'Сбросить матчи топов')),
          h('div.hint', { style: { margin: '6px 0 0' } }, 'Удаляет все скачанные матчи топов и посчитанную по ним мету — например, когда начался новый сезон или сменился патч. Твои собственные матчи не трогает.')),
        h('label', 'Журнал зависаний'), h('div',
          h('button.btn.small', { onclick: async () => {
            const t = await dc.lagLog().catch(() => '');
            if (!t) return toast('Журнал пуст — зависаний не записано');
            await dc.copy(t).catch(() => {});
            toast('Журнал скопирован — вставь его в чат');
          } }, Icon('copy'), 'Скопировать журнал'),
          h('div.hint', { style: { margin: '6px 0 0' } }, 'Если программа подвисает, она записывает сюда, когда и на чём. Скопируй и пришли — по нему видно причину.'))));
  }

  // Игровой режим: фоновые загрузки ждут конца игры, оверлей работает.
  function gameModeSettings() {
    const m = S.gameMode;
    const box = h('input', { type: 'checkbox', checked: S.settings.gameMode !== false || null, onchange: async (e) => {
      const r = await dc.saveSettings({ gameMode: e.target.checked });
      S.settings = r.settings;
      if (S.gameMode) applyGameMode({ ...S.gameMode, enabled: r.settings.gameMode !== false });
    } });
    const state = !m ? null
      : m.active ? (m.enabled ? 'Deadlock запущен — игровой режим включён.' : 'Deadlock запущен, но игровой режим выключен.')
        : 'Deadlock не запущен.';
    return h('div',
      h('label.check', box, 'пока идёт Deadlock, не нагружать компьютер'),
      h('div.hint', { style: { margin: '6px 0 0' } }, 'Обновление меты и поиск новых матчей ждут, пока ты не закроешь игру, и доделываются через минуту после неё. Оверлей, горячая клавиша и распознавание состава работают как обычно. Обновление по кнопке «Обновить данные» не ждёт.'),
      state ? h('div.dim', { style: { marginTop: '6px' } }, state, m && m.pending ? ' Отложено обновление меты.' : '') : null);
  }

  // Распознавание состава по портретам: включение, состояние, сброс выученного.
  function recSettings(logBlock) {
    const st = OV.rec;
    const w = st && st.watch;
    const watchText = !w ? '…'
      : w.status === 'watching' ? `Слежу за игрой${w.lastEvent ? ` · последнее событие: ${{ match: 'матч найден', pregame: 'пауза перед игрой', started: 'игра началась', ended: 'игра закончилась', left: 'вышел из матча' }[w.lastEvent.type] || w.lastEvent.type}` : ''}.`
        : w.status === 'no-log' ? 'Лог игры не найден. В Steam: Deadlock → Свойства → Параметры запуска → добавь -condebug и запускай игру из Steam. Без этого оверлей сам не откроется, но горячая клавиша всё равно узнаёт состав.'
          : 'Запускаю слежение…';
    const auto = h('input', { type: 'checkbox', checked: S.settings.autoRecognize !== false || null, onchange: async (e) => {
      const r = await dc.saveSettings({ autoRecognize: e.target.checked });
      S.settings = r.settings;
    } });
    const hide = h('input', { type: 'checkbox', checked: S.settings.overlayAutoHide !== false || null, onchange: async (e) => {
      const r = await dc.saveSettings({ overlayAutoHide: e.target.checked });
      S.settings = r.settings;
    } });
    return h('div',
      h('label.check', auto, 'узнавать героев по портретам на верхней панели'),
      h('div.hint', { style: { margin: '6px 0 10px' } }, 'Как только в логе игры начинается пауза перед матчем, программа делает снимок экрана, узнаёт обе команды и сама показывает оверлей с советом — не забирая фокус у игры. По горячей клавише — то же самое в любой момент матча. Нужен режим «В окне без рамки».'),
      h('label.check', hide, 'прятать оверлей через несколько секунд после начала игры'),
      h('div.note', { style: { marginTop: '10px' } }, Icon('info'), h('div', watchText,
        st ? h('div.dim', { style: { marginTop: '4px' } }, `Выучено портретов: ${st.learned}.${st.last ? ` Последнее распознавание: ${st.last.ok ? `${st.last.slots} портретов, не уверен в ${st.last.unsure}, ${st.last.ms} мс` : 'не получилось'}.` : ''}`) : null)),
      h('div.row', { style: { gap: '8px', flexWrap: 'wrap' } },
        h('button.btn', { onclick: async () => { OV.logLoading = true; renderSettings(); try { OV.log = await dc.gameLogCheck(); } catch (e) { toast(e.message, true); } finally { OV.logLoading = false; renderSettings(); } } }, 'Проверить лог игры'),
        h('button.btn.ghost', { onclick: async () => { await dc.recForget(); OV.rec = await dc.recStatus().catch(() => null); toast('Выученные портреты забыты'); renderSettings(); } }, 'Забыть выученные портреты')),
      logBlock);
  }

  // ---------- старт ----------
  (async function start() {
    try {
      const init = await dc.init();
      S.settings = init.settings;
      S.auth = init.auth;
      S.meta = init.meta;
      S.status = init.status;
      S.version = init.version;
      if (init.assets && (init.assets.fetchedAt || 0) >= (S.assets.fetchedAt || 0)) S.assets = init.assets;
      S.favs = await dc.favorites().catch(() => []);
      dc.gameModeStatus().then(applyGameMode).catch(() => {});
    } catch (e) {
      toast(e.message, true);
    }
    setView('home');
    if (S.meta && S.meta.source === 'prev_season') {
      toast('Топ был собран по прошлому сезону — собираю топ текущего сезона');
      refreshTop();
    }
  })();
})();
