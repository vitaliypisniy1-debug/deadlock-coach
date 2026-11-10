'use strict';
// Оверлей «Пик против состава»: отмечаешь стартовых героев соперников —
// получаешь лучший пик из своих героев. Все расчёты — из заранее готовых таблиц.
(function () {
  const dc = window.dc;
  const h = F.h;
  const $ = (id) => document.getElementById(id);

  const S = {
    assets: null,
    auth: null,
    mode: 'enemies', // enemies | allies | me
    enemies: [],
    allies: [],
    me: null,
    q: '',
    advice: null,
    error: null,
    loading: false,
    progress: null,
    lastEdit: 0,
    timerStart: 0,
    rec: null, // результат распознавания портретов
    fixSlot: null, // портрет, который сейчас исправляем
    recBusy: false,
  };
  const LIMIT = { enemies: 6, allies: 5 };

  const itemName = (id) => (S.assets && S.assets.items && S.assets.items[id] ? S.assets.items[id].name : `Предмет ${id}`);
  const itemImg = (id) => {
    const it = S.assets && S.assets.items && S.assets.items[id];
    return it && it.img ? h('img', { src: it.img, alt: '' }) : null;
  };
  const heroName = (id) => (S.assets && S.assets.heroes[id] ? S.assets.heroes[id].name : `Герой ${id}`);
  const heroImg = (id, cls = '') => {
    const hero = S.assets && S.assets.heroes[id];
    if (hero && hero.img) return h(`img.hi${cls}`, { src: hero.img, alt: '', draggable: 'false' });
    return h(`span.hi.ph${cls}`, heroName(id).slice(0, 2));
  };
  const heroes = () =>
    Object.values((S.assets && S.assets.heroes) || {})
      .filter((x) => !x.disabled && !x.inDev)
      .sort((a, b) => a.name.localeCompare(b.name));
  const pts = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(x * 100))}`;
  const ochki = (x) => {
    const n = Math.abs(Math.round(x * 100));
    const a = n % 100;
    const b = n % 10;
    return `${n} ${a > 10 && a < 20 ? 'очков' : b === 1 ? 'очко' : b >= 2 && b <= 4 ? 'очка' : 'очков'}`;
  };
  const SCORE_TIP = 'Оценка — сумма: насколько чаще обычного побеждают на этом герое против каждого соперника (в процентах, каждый максимум ±15) плюс сила героя. Вес данных: 80% — игры топового уровня, 20% — твои игры.';

  // ---------- выбор героев ----------
  function where(id) {
    if (S.enemies.includes(id)) return 'enemies';
    if (S.allies.includes(id)) return 'allies';
    if (S.me === id) return 'me';
    return null;
  }

  function removeHero(id) {
    S.enemies = S.enemies.filter((x) => x !== id);
    S.allies = S.allies.filter((x) => x !== id);
    if (S.me === id) S.me = null;
  }

  // Исправление портрета: герой встаёт в роль этого слота, а программа запоминает образец.
  async function fixSlot(index, id) {
    const slot = S.rec && S.rec.slots[index];
    if (!slot) return;
    const role = slot.own ? 'me' : slot.ally ? 'allies' : 'enemies';
    if (slot.hero && slot.confident) removeHero(slot.hero);
    removeHero(id);
    // этот герой был у другого портрета — тот портрет теперь под вопросом
    for (const o of S.rec.slots) {
      if (o !== slot && o.hero === id) {
        o.hero = null;
        o.confident = false;
      }
    }
    if (role === 'me') S.me = id;
    else if (S[role].length < LIMIT[role]) S[role].push(id);
    slot.hero = id;
    slot.confident = true;
    slot.learned = true;
    S.fixSlot = null;
    changed();
    try {
      await dc.recLearn(index, id);
    } catch (e) {
      S.error = null;
    }
  }

  function assign(id, mode = S.mode) {
    if (S.fixSlot !== null) return fixSlot(S.fixSlot, id);
    const was = where(id);
    removeHero(id);
    if (was === mode) return changed(); // повторный клик — убрать
    if (mode === 'me') S.me = id;
    else if (S[mode].length < LIMIT[mode]) S[mode].push(id);
    if (mode === 'enemies' && !S.timerStart) S.timerStart = Date.now();
    if (mode === 'enemies' && S.enemies.length === LIMIT.enemies && !S.me) S.mode = 'me';
    changed();
  }

  let adviseTimer = null;
  function changed() {
    S.lastEdit = Date.now();
    S.q = '';
    $('search').value = '';
    renderLeft();
    clearTimeout(adviseTimer);
    adviseTimer = setTimeout(advise, 60);
  }

  async function advise() {
    if (!S.auth) return renderRight();
    S.loading = true;
    try {
      S.advice = await dc.pickAdvise({ enemies: S.enemies, allies: S.allies, current: S.me });
      S.error = null;
    } catch (e) {
      S.error = e.message;
    } finally {
      S.loading = false;
      renderRight();
    }
  }

  function reset() {
    S.enemies = [];
    S.allies = [];
    S.me = null;
    S.mode = 'enemies';
    S.timerStart = 0;
    changed();
  }

  // ---------- левая часть ----------
  function slot(id, kind, i) {
    if (!id) return h(`div.slot.empty.${kind}`, h('span', kind === 'me' ? 'ты' : String(i + 1)));
    return h(`button.slot.${kind}`, { title: `${heroName(id)} — убрать`, onclick: () => { removeHero(id); changed(); } }, heroImg(id), h('span.slot-name', heroName(id)));
  }

  function recStrip() {
    const r = S.rec;
    if (S.recBusy) return h('div.rec.busy', h('span.spin'), 'Узнаю героев по портретам…');
    if (!r) return null;
    if (!r.ok) {
      return h('div.rec.err', h('b', 'Не получилось узнать состав. '), r.reason || '', ' ',
        h('button.ov-btn.ghost.small', { onclick: rerun }, 'Попробовать снова'));
    }
    const thumb = (x) => h(`button.rthumb${x.own ? '.own' : ''}${x.ally ? '.ally' : '.enemy'}${x.confident ? '' : '.unsure'}${S.fixSlot === x.index ? '.fixing' : ''}`, {
      title: x.confident ? `${heroName(x.hero)} — нажми, чтобы исправить` : 'Не уверен — нажми и выбери героя ниже',
      onclick: () => { S.fixSlot = S.fixSlot === x.index ? null : x.index; renderLeft(); $('search').focus(); },
    }, x.thumb ? h('img', { src: x.thumb, alt: '' }) : null,
      h('span.rt-name', x.confident && x.hero ? heroName(x.hero) : '?'));
    const mine = r.slots.filter((x) => x.ally);
    const theirs = r.slots.filter((x) => !x.ally);
    const unsure = r.slots.filter((x) => !x.confident).length;
    return h('div.rec',
      h('div.rec-head',
        h('b', S.fixSlot !== null ? 'Выбери героя для отмеченного портрета ↓' : unsure ? `Не уверен в ${unsure} — нажми на портрет и выбери героя` : S.rec.slots.length < 12 ? `Нашёл только ${S.rec.slots.length} из 12 портретов — нажми «Узнать заново»` : 'Состав узнан по портретам'),
        h('span.grow'),
        h('button.ov-btn.ghost.small', { onclick: rerun, title: 'Сделать новый снимок экрана' }, 'Узнать заново')),
      h('div.rec-row', h('div.rec-team', mine.map(thumb)), h('span.rec-vs', 'vs'), h('div.rec-team', theirs.map(thumb))));
  }

  async function rerun() {
    S.recBusy = true;
    S.fixSlot = null;
    renderLeft();
    try {
      await dc.recRun(); // результат придёт событием overlay:recognized
    } catch (e) {
      S.recBusy = false;
      S.rec = { ok: false, reason: e.message };
      renderLeft();
    }
  }

  function applyRecognition(r) {
    S.recBusy = false;
    S.rec = r;
    S.fixSlot = null;
    if (r && r.ok) {
      S.enemies = r.enemies.slice(0, LIMIT.enemies);
      S.allies = r.allies.slice(0, LIMIT.allies);
      S.me = r.me || null;
      S.mode = 'enemies';
      if (!S.timerStart && r.reason2 === 'pregame') S.timerStart = Date.now();
    }
    changed();
  }

  function renderLeft() {
    const enemySlots = [...Array(LIMIT.enemies)].map((_, i) => slot(S.enemies[i], 'enemy', i));
    const allySlots = [...Array(LIMIT.allies)].map((_, i) => slot(S.allies[i], 'ally', i));
    $('rec').replaceChildren(...[recStrip()].filter(Boolean));
    $('slots').replaceChildren(
      h('div.slot-group', h('div.slot-label', 'Соперники'), h('div.slot-row', enemySlots)),
      h('div.slot-group.small', h('div.slot-label', 'Союзники ', h('span', '(не обязательно)')), h('div.slot-row', allySlots)),
      h('div.slot-group.small', h('div.slot-label', 'Твой герой'), h('div.slot-row', slot(S.me, 'me', 0))),
    );
    const modes = [
      ['enemies', `Соперники ${S.enemies.length}/6`],
      ['allies', `Союзники ${S.allies.length}/5`],
      ['me', 'Мой герой'],
    ];
    $('modes').replaceChildren(...modes.map(([k, label]) => h(`button.mode.${k}${S.mode === k ? '.on' : ''}`, { role: 'tab', 'aria-selected': String(S.mode === k), onclick: () => { S.mode = k; renderLeft(); $('search').focus(); } }, label)));
    const q = S.q.trim().toLowerCase();
    const list = heroes().filter((x) => !q || x.name.toLowerCase().includes(q));
    const pool = new Set((S.advice && S.advice.pool) || []);
    $('grid').replaceChildren(...list.map((x, i) => {
      const w = where(x.id);
      return h(`button.gh${w ? '.' + w : ''}${q && i === 0 ? '.first' : ''}${pool.has(x.id) ? '.mine' : ''}`, {
        title: `${x.name}${pool.has(x.id) ? ' · твой герой для рейтинга' : ''}`,
        onclick: (e) => assign(x.id, e.shiftKey ? 'me' : S.mode),
        oncontextmenu: (e) => { e.preventDefault(); assign(x.id, 'allies'); },
      }, heroImg(x.id), h('span', x.name));
    }));
  }

  // ---------- правая часть: совет ----------
  function chip(x, good) {
    return h(`span.chip.${good ? 'good' : 'bad'}`, { title: `${good ? 'Удобный' : 'Неудобный'} соперник: ${pts(x.d)} к победам` }, heroImg(x.hero_id, '.xs'), pts(x.d));
  }

  function mateChip(x, good) {
    return h(`span.chip.mate.${good ? 'good' : 'bad'}`, { title: `${good ? 'Хорошая' : 'Слабая'} связка с союзником ${heroName(x.hero_id)}: ${pts(x.d)} к победам` }, 'с', heroImg(x.hero_id, '.xs'), pts(x.d));
  }

  // План на игру: что важно помнить именно в этом матче.
  function planCard(p) {
    const names = (list) => list.map((x) => heroName(x.hero_id)).join(' и ');
    const rows = [];
    if (p.hard.length) rows.push(h('div.plan-row.bad', h('b', 'Опасны'), h('span', `${names(p.hard)} — у топов ${heroName(p.hero_id)} против ${p.hard.length > 1 ? 'них' : 'него'} выигрывает реже. Попался на линии — играй от крипов, не начинай размен первым.`)));
    if (p.easy.length) rows.push(h('div.plan-row.good', h('b', 'Дави'), h('span', `${names(p.easy)} — удобные соперники: против ${p.easy.length > 1 ? 'них' : 'него'} можно разменяться и забирать линию.`)));
    if (p.items.length) rows.push(h('div.plan-row', h('b', 'Собери'), h('span.plan-items', p.items.map((it) => h('span.plan-item', { title: `Против ${heroName(it.vs)} берут в ${String(it.lift).replace('.', ',')} раза чаще обычного` }, itemImg(it.id), itemName(it.id), h('i', `от ${heroName(it.vs)}`))))));
    if (p.mates.length) rows.push(h('div.plan-row.good', h('b', 'Связка'), h('span', `Играй рядом с ${names(p.mates)} — вместе вы выигрываете чаще.`)));
    if (p.leak && p.leak.title) rows.push(h('div.plan-row.warn', h('b', 'Твоя ошибка'), h('span', `${p.leak.title} (${p.leak.count} из ${p.leak.games} игр).${p.leak.fix ? ' ' + p.leak.fix : ''}`)));
    if (!rows.length) return h('div');
    return h('div.plan', h('div.plan-head', `План на игру за ${heroName(p.hero_id)}`), rows);
  }

  function renderRight() {
    const r = $('right');
    if (!S.auth) {
      r.replaceChildren(h('div.ov-empty', h('b', 'Войди через Steam в основном окне'), 'Совет строится по твоим героям и твоим играм.'));
      return;
    }
    if (S.error) {
      r.replaceChildren(h('div.ov-empty', h('b', 'Не получилось посчитать'), S.error));
      return;
    }
    const a = S.advice;
    if (!a) {
      r.replaceChildren(h('div.ov-empty', h('span.spin'), 'Загружаю твоих героев…'));
      return;
    }
    const parts = [];
    if (!a.poolSize) {
      parts.push(h('div.ov-empty', h('b', 'Нет героев для рейтинга'), 'В рейтинге можно играть героями с 15 победами. Если список неверный — выбери своих героев в основном окне: Настройки → «Мои герои для рейтинга».'));
      r.replaceChildren(...parts);
      return;
    }
    const best = a.rows[0];
    if (!S.enemies.length) {
      parts.push(h('div.verdict.idle', h('div.v-kicker', 'Жду состав соперников'), h('div.v-text', 'Отметь стартовых героев соперников — их видно в паузе перед игрой. Хватит и 2–3, совет обновляется сразу.')));
    } else if (best) {
      const v = a.verdict;
      const keep = v && v.keep;
      const hid = keep ? v.hero_id : best.hero_id;
      const row = a.all.find((x) => x.hero_id === hid) || best;
      parts.push(h(`div.verdict${keep ? '.keep' : ''}`,
        heroImg(hid, '.big'),
        h('div.v-main',
          h('div.v-kicker', keep ? 'Оставайся' : v ? `Меняй ${heroName(v.from)} на` : 'Лучший пик'),
          h('div.v-name', heroName(hid)),
          h('div.v-sub', keep
            ? v.gap > 0.005 ? `${heroName(best.hero_id)} сильнее всего на ${ochki(v.gap)} — менять не стоит.` : 'Твой герой — лучший из доступных против этого состава.'
            : v ? `Сильнее, чем ${heroName(v.from)}, на ${ochki(v.gap)} против этого состава.` : 'Сильнее всего против этого состава из твоих героев.')),
        h('div.v-score', { title: SCORE_TIP }, h('b', pts(row.score)), h('span', 'оценка'))));
      if (a.plan) parts.push(planCard(a.plan));
    }
    const list = a.rows.map((x, i) => h(`div.pick${S.me === x.hero_id ? '.cur' : ''}`,
      h('span.pk-n', String(i + 1)),
      heroImg(x.hero_id, '.md'),
      h('div.pk-main',
        h('div.pk-name', heroName(x.hero_id), S.me === x.hero_id ? h('em', 'сейчас') : null),
        h('div.pk-why',
          x.pros.map((p) => chip(p, true)),
          x.cons.map((p) => chip(p, false)),
          (x.mates || []).map((p) => mateChip(p, true)),
          (x.matesBad || []).map((p) => mateChip(p, false)),
          h('span.pk-rec', { title: 'Твои игры на этом герое' }, x.games ? `ты ${x.wins}–${x.games - x.wins}` : 'нет твоих игр'),
          x.noTable ? h('span.pk-warn', 'считаю…') : null)),
      h(`b.pk-score${Math.abs(x.score) < 0.005 ? '' : x.score > 0 ? '.pos' : '.neg'}`, pts(x.score))));
    parts.push(h('div.picks-head', h('span', 'Твои герои'), h('span', { title: SCORE_TIP }, 'оценка ⓘ')), h('div.picks', list));
    const taken = a.all.filter((x) => x.taken).map((x) => heroName(x.hero_id));
    if (taken.length) parts.push(h('div.ov-note', `Заняты: ${taken.join(', ')}.`));
    const notReady = a.poolSize - a.ready;
    parts.push(h('div.ov-foot',
      h('span', S.progress && S.progress.stage === 'pick' ? S.progress.text : notReady > 0 ? `Готовлю таблицы: ${a.ready} из ${a.poolSize} героев` : `Таблицы готовы для ${a.poolSize} ${a.poolSize === 1 ? 'героя' : 'героев'}${a.tablesAt ? ` · ${ago(a.tablesAt)}` : ''}`),
      h('button.ov-btn.ghost.small', { onclick: () => dc.pickPrepare(true).then(() => { S.progress = { stage: 'pick', text: 'Пересчитываю…' }; renderRight(); }) }, 'Пересчитать')));
    r.replaceChildren(...parts);
  }

  function ago(ms) {
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return 'только что';
    if (m < 60) return `${m} мин назад`;
    return `${Math.round(m / 60)} ч назад`;
  }

  // ---------- таймер паузы перед игрой (~30 с) ----------
  setInterval(() => {
    const t = $('timer');
    if (!S.timerStart) {
      t.hidden = true;
      return;
    }
    const left = Math.max(0, 30 - Math.floor((Date.now() - S.timerStart) / 1000));
    t.hidden = false;
    t.textContent = left ? `≈ ${left} с на смену героя` : 'пауза, скорее всего, закончилась';
    t.classList.toggle('hot', left <= 10);
  }, 250);

  // ---------- клавиатура ----------
  $('search').addEventListener('input', (e) => {
    S.q = e.target.value;
    renderLeft();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (S.fixSlot !== null) {
        S.fixSlot = null;
        renderLeft();
        return;
      }
      dc.toggleOverlay(false);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const order = ['enemies', 'allies', 'me'];
      S.mode = order[(order.indexOf(S.mode) + (e.shiftKey ? 2 : 1)) % 3];
      renderLeft();
      return;
    }
    if (e.key === 'Enter') {
      const first = document.querySelector('#grid .gh.first') || (S.q ? document.querySelector('#grid .gh') : null);
      if (first) first.click();
      return;
    }
    if (e.key === 'Backspace' && !S.q) {
      const list = S.mode === 'me' ? (S.me ? [S.me] : []) : S[S.mode];
      const last = list[list.length - 1];
      if (last) {
        removeHero(last);
        changed();
      }
    }
  });
  $('close').onclick = () => dc.toggleOverlay(false);
  $('reset').onclick = reset;

  dc.on('progress', (p) => {
    if (p.stage === 'pick') {
      S.progress = p;
      renderRight();
    } else if (p.stage === 'done' && S.progress) {
      S.progress = null;
      advise();
    }
  });
  dc.on('overlay:recognized', (r) => applyRecognition(r));
  dc.on('overlay:shown', () => {
    // новый матч: если с последней правки прошло больше 4 минут — начинаем с чистого листа
    if (S.lastEdit && Date.now() - S.lastEdit > 4 * 60e3) reset();
    else advise();
    $('search').focus();
  });

  async function start() {
    try {
      const init = await dc.init();
      S.assets = init.assets;
      S.auth = init.auth;
    } catch (e) {
      S.error = e.message;
    }
    try {
      const k = await dc.overlayKey();
      $('key').textContent = k.key ? `${k.key} — показать/скрыть` : 'горячая клавиша не задана';
    } catch {}
    renderLeft();
    renderRight();
    if (S.auth) advise();
    $('search').focus();
  }
  start();
})();
