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
    lane: [], // соперники на твоей линии (до 2)
    partner: null, // напарник по линии
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
  const SCORE_TIP = 'Шанс победы: 50% плюс сила героя в патче, плюс поправка за каждого соперника (на твоей линии — цифры именно для линии), за союзников и за состав команды. Вес данных: 80% — все игры топового уровня за 2 недели, 20% — твои игры.';
  const pct = (x) => `${Math.round(x * 100)}%`;
  // проценты с одной цифрой после запятой: +0,4
  const pts1 = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${(Math.round(Math.abs(x) * 1000) / 10).toFixed(1).replace('.', ',')}`;
  const souls = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n)).toLocaleString('ru-RU')}`;
  const ROLE = { tank: 'танк', support: 'поддержка', spirit: 'урон способностями', gun: 'урон пулями' };
  const ROLE_SHORT = { tank: 'танк', support: 'саппорт', spirit: 'дух', gun: 'пули' };
  const roleOf = (id) => (S.advice && S.advice.roles && S.advice.roles[id]) || null;

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
    S.lane = S.lane.filter((x) => x !== id);
    if (S.partner === id) S.partner = null;
    if (S.me === id) S.me = null;
  }

  // Отметка «на моей линии» (соперники, до 2) и «напарник» (один союзник).
  function toggleLane(id) {
    if (S.lane.includes(id)) S.lane = S.lane.filter((x) => x !== id);
    else S.lane = [...S.lane, id].slice(-2);
    changed();
  }

  function togglePartner(id) {
    S.partner = S.partner === id ? null : id;
    changed();
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
      S.advice = await dc.pickAdvise({ enemies: S.enemies, allies: S.allies, current: S.me, laneEnemies: S.lane, partner: S.partner });
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
    S.lane = [];
    S.partner = null;
    S.mode = 'enemies';
    S.timerStart = 0;
    changed();
  }

  // ---------- левая часть ----------
  function slot(id, kind, i) {
    if (!id) return h(`div.slot.empty.${kind}`, h('span', kind === 'me' ? 'ты' : String(i + 1)));
    const role = roleOf(id);
    const btn = h(`button.slot.${kind}`, { title: `${heroName(id)}${role ? ` · ${ROLE[role]}` : ''} — убрать`, onclick: () => { removeHero(id); changed(); } }, heroImg(id), h('span.slot-name', heroName(id)));
    if (kind === 'enemy') {
      const on = S.lane.includes(id);
      return h('div.slot-col', btn, h(`button.lane-tg${on ? '.on' : ''}`, { title: 'Этот соперник стоит на твоей линии', onclick: () => toggleLane(id) }, on ? 'на линии' : 'линия?'));
    }
    if (kind === 'ally') {
      const on = S.partner === id;
      return h('div.slot-col', btn, h(`button.lane-tg.ally${on ? '.on' : ''}`, { title: 'Это твой напарник по линии', onclick: () => togglePartner(id) }, on ? 'напарник' : 'пара?'));
    }
    return btn;
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
      h('div.slot-group', h('div.slot-label', 'Соперники ', h('span', S.enemies.length ? '— отметь, кто на твоей линии (видно в начале игры)' : '')), h('div.slot-row', enemySlots)),
      h('div.slot-group.small', h('div.slot-label', 'Союзники ', h('span', S.allies.length ? '— отметь напарника по линии' : '(не обязательно)')), h('div.slot-row', allySlots)),
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
    return h(`span.chip.${good ? 'good' : 'bad'}`, { title: `${good ? 'Удобный' : 'Неудобный'} соперник: ${pts1(x.d)}% к шансу победы (сверх силы самих героев)` }, heroImg(x.hero_id, '.xs'), pts1(x.d));
  }

  // Соперник на твоей линии: души к 9-й минуте.
  function laneChip(x) {
    const cls = x.souls >= 250 ? 'good' : x.souls <= -250 ? 'bad' : 'even';
    return h(`span.chip.lane.${cls}`, { title: `На линии против ${heroName(x.hero_id)}: в среднем ${souls(x.souls)} душ к 9-й минуте у игроков Оракул+` }, 'линия', heroImg(x.hero_id, '.xs'), souls(x.souls));
  }

  function mateChip(x, good) {
    return h(`span.chip.mate.${good ? 'good' : 'bad'}`, { title: `${good ? 'Хорошая' : 'Слабая'} связка с ${x.partner ? 'напарником по линии' : 'союзником'} ${heroName(x.hero_id)}: ${pts1(x.d)}% к шансу победы` }, 'с', heroImg(x.hero_id, '.xs'), pts1(x.d));
  }

  // План на игру: что важно помнить именно в этом матче.
  function planCard(p) {
    const names = (list) => list.map((x) => heroName(x.hero_id)).join(' и ');
    const rows = [];
    if (p.hard.length) rows.push(h('div.plan-row.bad', h('b', 'Неудобные'), h('span', `${names(p.hard)} — у топов ${heroName(p.hero_id)} против ${p.hard.length > 1 ? 'них' : 'него'} выигрывает чуть реже обычного. Не лезь к ${p.hard.length > 1 ? 'ним' : 'нему'} в одиночку.`)));
    if (p.easy.length) rows.push(h('div.plan-row.good', h('b', 'Удобные'), h('span', `${names(p.easy)} — против ${p.easy.length > 1 ? 'них' : 'него'} ${heroName(p.hero_id)} выигрывает чуть чаще обычного: ищи с ${p.easy.length > 1 ? 'ними' : 'ним'} драки.`)));
    const L = p.lane;
    if (L && L.known && L.list.length) {
      const bad = L.list.filter((x) => x.souls <= -250);
      const good = L.list.filter((x) => x.souls >= 250);
      const s9 = (list) => list.map((x) => `${souls(x.souls)} душ`).join(', ');
      const even = L.list.filter((x) => !bad.includes(x) && !good.includes(x));
      const t = [];
      if (bad.length) t.push(`Против ${names(bad)} ${heroName(p.hero_id)} на линии обычно отстаёт (${s9(bad)} к 9-й минуте) — добивай крипов из-за волны, не меняйся уроном первым.`);
      if (good.length) t.push(`Против ${names(good)} у ${heroName(p.hero_id)} преимущество (${s9(good)}) — дави: размены, отказ в душах, охранник.`);
      if (even.length) t.push(`С ${names(even)} — ровно (${s9(even)}), решает добивание.`);
      const text = t.join(' ');
      rows.push(h(`div.plan-row${bad.length ? '.bad' : good.length ? '.good' : ''}`, h('b', 'Линия'), h('span', text)));
    } else if (L && !L.known && (L.hard.length || L.easy.length)) {
      const t = [];
      if (L.hard.length) t.push(`тяжело против ${L.hard.map((x) => `${heroName(x.hero_id)} (${souls(x.souls)} душ)`).join(' и ')}`);
      if (L.easy.length) t.push(`легко против ${L.easy.map((x) => `${heroName(x.hero_id)} (${souls(x.souls)} душ)`).join(' и ')}`);
      rows.push(h('div.plan-row', h('b', 'Если на линии'), h('span', `${t.join(', ')}. Как увидишь, кто против тебя, — отметь «линия?» под соперником.`)));
    }
    if (p.items.length) rows.push(h('div.plan-row', h('b', 'Собери'), h('span.plan-items', p.items.map((it) => h('span.plan-item', { title: `Против ${heroName(it.vs)} берут в ${String(it.lift).replace('.', ',')} раза чаще обычного` }, itemImg(it.id), itemName(it.id), h('i', `от ${heroName(it.vs)}`))))));
    if (p.mates.length) rows.push(h('div.plan-row.good', h('b', 'Связка'), h('span', `Играй рядом с ${names(p.mates)} — вместе вы выигрываете чаще.`)));
    if (p.leak && p.leak.title) rows.push(h('div.plan-row.warn', h('b', 'Твоя ошибка'), h('span', `${p.leak.title} (${p.leak.count} из ${p.leak.games} игр).${p.leak.fix ? ' ' + p.leak.fix : ''}`)));
    if (!rows.length) return h('div');
    return h('div.plan', h('div.plan-head', `План на игру за ${heroName(p.hero_id)}`), rows);
  }

  // Состав твоей команды: роли и чего не хватает.
  function compCard(c) {
    const n = c.counts;
    const cell = (k, label) => h(`span.comp-cell${n[k] ? '' : '.miss'}`, h('b', String(n[k])), label);
    const notes = [];
    if (!n.tank) notes.push('Нет танка — команды без него выигрывают на 2% реже. Если есть свой танк — подумай о нём.');
    if (!n.support) notes.push('Нет поддержки — саппорты в этом патче в среднем выигрывают чаще остальных.');
    if (n.gun >= 3) notes.push('Уже 3+ стрелка: соперники соберут броню от пуль — лучше урон способностями.');
    if (n.spirit >= 3) notes.push('Уже 3+ героя на способностях: соперники соберут защиту от духа — лучше урон пулями.');
    return h('div.comp',
      h('div.plan-head', `Твоя команда (без тебя): ${c.known} из 5`),
      h('div.comp-row', cell('tank', 'танк'), cell('support', 'поддержка'), cell('gun', 'пули'), cell('spirit', 'способности')),
      notes.length ? h('div.comp-notes', notes.map((t) => h('div', t))) : h('div.comp-notes.ok', 'Состав сбалансирован.'));
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
      parts.push(h('div.ov-empty', h('b', 'Нет героев для рейтинга'), 'Показываю героев, доступных в рейтинге, на которых ты играл последние 2 месяца. Если список неверный — выбери своих героев в основном окне: Настройки → «Мои герои для рейтинга».'));
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
      const cur = v && !keep ? a.all.find((x) => x.hero_id === v.from) : null;
      parts.push(h(`div.verdict${keep ? '.keep' : ''}`,
        heroImg(hid, '.big'),
        h('div.v-main',
          h('div.v-kicker', keep ? 'Оставайся' : v ? `Меняй ${heroName(v.from)} на` : 'Лучший пик'),
          h('div.v-name', heroName(hid)),
          h('div.v-sub', keep
            ? v.gap > 0.002 ? `${heroName(best.hero_id)} лучше всего на ${pts1(v.gap)}% — менять не стоит.` : 'Твой герой — лучший из доступных против этого состава.'
            : cur ? `Шанс победы ${pct(row.chance)} против ${pct(cur.chance)} на ${heroName(v.from)}.` : 'Лучший из твоих героев против этого состава.')),
        h('div.v-score', { title: SCORE_TIP }, h('b', pct(row.chance)), h('span', 'шанс победы'))));
      if (a.plan) parts.push(planCard(a.plan));
    }
    if (a.comp && a.comp.known >= 3) parts.push(compCard(a.comp));
    const list = a.rows.map((x, i) => h(`div.pick${S.me === x.hero_id ? '.cur' : ''}`,
      h('span.pk-n', String(i + 1)),
      heroImg(x.hero_id, '.md'),
      h('div.pk-main',
        h('div.pk-name', heroName(x.hero_id), x.role ? h('i.pk-role', ROLE_SHORT[x.role]) : null, S.me === x.hero_id ? h('em', 'сейчас') : null),
        h('div.pk-why',
          (x.lanes || []).map(laneChip),
          x.pros.map((p) => chip(p, true)),
          x.cons.map((p) => chip(p, false)),
          (x.mates || []).map((p) => mateChip(p, true)),
          (x.matesBad || []).map((p) => mateChip(p, false)),
          x.compWhy === 'tank' ? h('span.chip.good.tag', { title: 'В команде нет танка — команды без него выигрывают на 2% реже' }, 'нужен танк +2') : null,
          x.compWhy === 'gunHeavy' ? h('span.chip.bad.tag', { title: 'В команде уже 3 стрелка — с четвёртым выигрывают на 1,5% реже' }, 'много стрелков') : null,
          x.weak ? h('span.chip.bad.tag', { title: 'В матчах топового уровня за 2 недели этот герой выигрывает реже 48%' }, `слабый в патче ${(Math.round(x.metaWr * 1000) / 10).toFixed(1).replace('.', ',')}%`) : null,
          x.stale ? h('span.pk-warn', { title: 'Давно не играл на этом герое' }, `не играл ${x.stale} дн.`) : null,
          h('span.pk-rec', { title: 'Твои игры на этом герое за 2 месяца / всего' }, x.games ? `ты ${x.wins}–${x.games - x.wins}${x.recent ? ` · ${x.recent} игр за 2 мес.` : ''}` : 'нет твоих игр'))),
      h(`b.pk-score${x.chance >= 0.52 ? '.pos' : x.chance <= 0.48 ? '.neg' : ''}`, { title: SCORE_TIP }, pct(x.chance))));
    parts.push(h('div.picks-head', h('span', 'Твои герои'), h('span', { title: SCORE_TIP }, 'шанс победы ⓘ')), h('div.picks', list));
    if (a.inactive && a.inactive.length) parts.push(h('div.ov-note', `Не показываю — давно не играл: ${a.inactive.map((x) => heroName(x.hero_id)).join(', ')}. Свой список — в Настройках, «Мои герои для рейтинга».`));
    const taken = a.all.filter((x) => x.taken).map((x) => heroName(x.hero_id));
    if (taken.length) parts.push(h('div.ov-note', `Заняты: ${taken.join(', ')}.`));
    const notReady = a.poolSize - a.ready;
    const metaTxt = a.metaInfo ? `Мета: ${a.metaInfo.games.toLocaleString('ru-RU')} матчей ${a.metaInfo.badge >= 91 ? 'Фантом+' : 'Оракул+'} за 2 недели` : `Мета не загружена (${a.metaError || 'нет связи'}) — считаю по скачанным матчам`;
    parts.push(h('div.ov-foot',
      h('span', S.progress && S.progress.stage === 'pick' ? S.progress.text : notReady > 0 ? `${metaTxt} · твои игры: ${a.ready} из ${a.poolSize} героев` : `${metaTxt} · твои игры готовы${a.tablesAt ? ` (${ago(a.tablesAt)})` : ''}`),
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
