'use strict';
/* global F */
// Миникарта матча. Четыре понятных режима:
//   «Мои смерти»  — где и от кого ты умирал (номера на карте + список);
//   «Повтор»      — где были все герои в любую минуту (ползунок, табло, лента убийств);
//   «Где я бывал» — тепловая карта твоих перемещений и доля времени на своей/чужой половине;
//   «Все смерти»  — все смерти матча по фазам игры.
// Если картинка карты не загрузилась, фон рисуется из маршрутов всех 12 героев —
// видны линии и лес, по которым ходили игроки.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const S = 1000;
  const el = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) e.setAttribute(k, v);
    return e;
  };
  const txt = (tag, attrs, text) => {
    const e = el(tag, attrs);
    e.textContent = text;
    return e;
  };
  const CAL_KEY = 'dc.map.cal';
  const readCal = () => {
    try {
      return JSON.parse(localStorage.getItem(CAL_KEY)) || { flipX: false, flipY: false, rot: 0 };
    } catch (e) {
      return { flipX: false, flipY: false, rot: 0 };
    }
  };
  const saveCal = (c) => {
    try {
      localStorage.setItem(CAL_KEY, JSON.stringify(c));
    } catch (e) {
      // не страшно
    }
  };
  const PHASES = [
    { key: 'all', label: 'Весь матч', from: 0, to: 1e9 },
    { key: 'lane', label: 'Линия 0–10', from: 0, to: 600 },
    { key: 'mid', label: 'Середина 10–20', from: 600, to: 1200 },
    { key: 'late', label: 'Поздняя 20+', from: 1200, to: 1e9 },
  ];

  function snapAt(snaps, t) {
    if (!snaps || !snaps.length) return null;
    let prev = [0, 0, 0, 0, 0];
    for (const s of snaps) {
      if (s[0] >= t) {
        const f = s[0] === prev[0] ? 1 : (t - prev[0]) / (s[0] - prev[0]);
        return [t, prev[1] + (s[1] - prev[1]) * f, prev[2], prev[3], prev[4]];
      }
      prev = s;
    }
    return prev;
  }

  function MapView(data, opts) {
    const { focusSlot = null, focusName = 'Ты', heroName, heroImg, mapAsset = null, myTeam = null, compact = false } = opts;
    let moment = opts.moment || null;
    const R = (mapAsset && mapAsset.radius) || 10752;
    let cal = readCal();
    const hasPaths = !!(data.paths && data.paths.players && Object.keys(data.paths.players).length);
    const hasDeathPos = data.kills.some((k) => k.x !== null && k.x !== undefined);
    const bySlot = new Map(data.players.map((p) => [p.slot, p]));
    const me = focusSlot !== null ? bySlot.get(focusSlot) : null;
    const allyTeam = myTeam !== null ? myTeam : me ? me.team : 0;
    const isAlly = (p) => p && p.team === allyTeam;
    const teamColor = (team) => (team === allyTeam ? 'var(--ally)' : 'var(--enemy)');
    const myDeaths = data.kills.filter((k) => k.victim === focusSlot);
    const st = {
      mode: myDeaths.length && hasDeathPos ? 'mine' : hasPaths ? 'replay' : 'all',
      t: hasPaths ? Math.min(data.duration, 600) : data.duration,
      playing: false,
      speed: 10,
      selected: focusSlot,
      phase: 'all',
      picked: null,
    };

    // ---------- координаты ----------
    const toXY = (x, y) => {
      let u = (x + R) / (2 * R);
      let v = (y + R) / (2 * R);
      if (cal.flipX) u = 1 - u;
      if (cal.flipY) v = 1 - v;
      let px = u * S;
      let py = (1 - v) * S;
      for (let i = 0; i < (((cal.rot / 90) % 4) + 4) % 4; i++) [px, py] = [S - py, px];
      return [px, py];
    };
    const step = hasPaths ? data.paths.step || 5 : 5;
    const posAt = (slot, t) => {
      const pts = hasPaths ? data.paths.players[slot] : null;
      if (!pts || !pts.length) return null;
      if (compact && t > (pts.length - 1) * step) return null;
      const i = Math.min(pts.length - 1, Math.max(0, Math.floor(t / step)));
      const a = pts[i];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const f = Math.max(0, Math.min(1, t / step - i));
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2]];
    };
    // базы: где команды стоят в первые секунды матча
    const baseOf = (team) => {
      if (!hasPaths) return null;
      const pts = data.players.filter((p) => p.team === team).map((p) => posAt(p.slot, 2)).filter(Boolean);
      if (!pts.length) return null;
      return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    };
    const allyBase = baseOf(allyTeam);
    const enemyBase = baseOf(allyTeam === 0 ? 1 : 0);
    const onOwnHalf = (x, y) => {
      if (!allyBase || !enemyBase) return null;
      const d1 = (x - allyBase[0]) ** 2 + (y - allyBase[1]) ** 2;
      const d2 = (x - enemyBase[0]) ** 2 + (y - enemyBase[1]) ** 2;
      return d1 <= d2;
    };

    // ---------- холст ----------
    const svg = el('svg', { viewBox: `0 0 ${S} ${S}`, class: 'map-svg', role: 'img', 'aria-label': 'Миникарта матча' });
    const defs = el('defs');
    const clip = el('clipPath', { id: 'heroClip', clipPathUnits: 'objectBoundingBox' });
    clip.appendChild(el('circle', { cx: 0.5, cy: 0.5, r: 0.5 }));
    const blur = el('filter', { id: 'heatBlur', x: '-20%', y: '-20%', width: '140%', height: '140%' });
    blur.appendChild(el('feGaussianBlur', { stdDeviation: 16 }));
    const glow = el('filter', { id: 'mkGlow', x: '-50%', y: '-50%', width: '200%', height: '200%' });
    glow.appendChild(el('feGaussianBlur', { stdDeviation: 4, result: 'b' }));
    const merge = el('feMerge');
    merge.append(el('feMergeNode', { in: 'b' }), el('feMergeNode', { in: 'SourceGraphic' }));
    glow.appendChild(merge);
    defs.append(clip, blur, glow);
    svg.appendChild(defs);

    const gBg = el('g');
    const gRoads = el('g', { class: 'map-roads' });
    const gBases = el('g');
    const gHeat = el('g', { filter: 'url(#heatBlur)', class: 'map-heat' });
    const gLines = el('g');
    const gMarks = el('g');
    const gHeroes = el('g');
    svg.append(gBg, gRoads, gBases, gHeat, gLines, gMarks, gHeroes);

    let imageOk = false;
    gBg.appendChild(el('rect', { x: 0, y: 0, width: S, height: S, class: 'map-bgfill' }));
    if (mapAsset && mapAsset.img) {
      const img = el('image', { href: mapAsset.img, x: 0, y: 0, width: S, height: S, preserveAspectRatio: 'xMidYMid meet', class: 'map-img' });
      img.addEventListener('load', () => {
        imageOk = true;
        drawRoads();
        noteImg.hidden = true;
      });
      img.addEventListener('error', () => {
        img.remove();
        imageOk = false;
        noteImg.hidden = !hasPaths;
        drawRoads();
        renderLegend();
      });
      gBg.appendChild(img);
    }

    // «дороги»: где ходили все игроки — без картинки карты так видны линии и лес
    function drawRoads() {
      gRoads.replaceChildren();
      if (imageOk || !hasPaths) return;
      for (const p of data.players) {
        const pts = data.paths.players[p.slot] || [];
        const line = [];
        for (let i = 0; i < pts.length; i += 2) {
          if (!pts[i][2]) {
            if (line.length > 1) gRoads.appendChild(el('polyline', { points: line.join(' '), class: 'map-road' }));
            line.length = 0;
            continue;
          }
          const [x, y] = toXY(pts[i][0], pts[i][1]);
          line.push(`${x.toFixed(0)},${y.toFixed(0)}`);
        }
        if (line.length > 1) gRoads.appendChild(el('polyline', { points: line.join(' '), class: 'map-road' }));
      }
    }

    function drawBases() {
      gBases.replaceChildren();
      for (const [b, label, cls] of [[allyBase, 'Ваша база', 'ally'], [enemyBase, 'База врага', 'enemy']]) {
        if (!b) continue;
        const [x, y] = toXY(b[0], b[1]);
        const g = el('g', { class: `map-base ${cls}`, transform: `translate(${x.toFixed(0)},${y.toFixed(0)})` });
        g.appendChild(el('circle', { r: 46 }));
        g.appendChild(txt('text', { 'text-anchor': 'middle', y: 6 }, label));
        gBases.appendChild(g);
      }
    }

    // ---------- значки ----------
    function heroToken(p, x, y, { me: isMe = false, dead = false, size = 24 } = {}) {
      const g = el('g', { class: `map-hero${isMe ? ' me' : ''}${dead ? ' dead' : ''}`, transform: `translate(${x.toFixed(1)},${y.toFixed(1)})` });
      g.appendChild(el('circle', { r: size + 3, class: 'map-hero-ring', style: `stroke: ${isMe ? 'var(--text)' : teamColor(p.team)}` }));
      const src = heroImg(p.hero);
      if (src) g.appendChild(el('image', { href: src, x: -size, y: -size, width: size * 2, height: size * 2, 'clip-path': 'url(#heroClip)' }));
      else g.appendChild(txt('text', { 'text-anchor': 'middle', y: 6, class: 'map-hero-txt' }, heroName(p.hero).slice(0, 2)));
      if (isMe) {
        const tag = el('g', { transform: `translate(0,${-size - 18})` });
        tag.appendChild(el('rect', { x: -22, y: -13, width: 44, height: 22, rx: 6, class: 'map-me-tag' }));
        tag.appendChild(txt('text', { 'text-anchor': 'middle', y: 3, class: 'map-me-txt' }, 'ТЫ'));
        g.appendChild(tag);
      }
      g.appendChild(txt('title', {}, heroName(p.hero)));
      g.addEventListener('click', () => {
        st.selected = p.slot;
        render();
      });
      return g;
    }

    function deathX(k, color, big = false) {
      const [x, y] = toXY(k.x, k.y);
      const g = el('g', { class: `map-x${big ? ' big' : ''}`, transform: `translate(${x.toFixed(1)},${y.toFixed(1)})` });
      g.appendChild(el('circle', { r: big ? 15 : 11, class: 'map-x-bg' }));
      g.appendChild(el('path', { d: big ? 'M-7,-7L7,7M7,-7L-7,7' : 'M-5,-5L5,5M5,-5L-5,5', style: `stroke: ${color}` }));
      const v = bySlot.get(k.victim);
      const kl = k.killer !== null ? bySlot.get(k.killer) : null;
      g.appendChild(txt('title', {}, `${F.time(k.t)} — ${v ? heroName(v.hero) : ''} погиб${kl ? ' от ' + heroName(kl.hero) : ''}`));
      return g;
    }

    // ---------- отрисовка по режиму ----------
    function render() {
      gHeat.replaceChildren();
      gLines.replaceChildren();
      gMarks.replaceChildren();
      gHeroes.replaceChildren();
      const ph = PHASES.find((x) => x.key === st.phase) || PHASES[0];

      if (st.mode === 'mine') {
        myDeaths.forEach((k, i) => {
          if (k.x === null) return;
          const [x, y] = toXY(k.x, k.y);
          const picked = st.picked === i;
          if (k.kx !== null && k.kx !== undefined) {
            const [kx, ky] = toXY(k.kx, k.ky);
            if (picked || st.picked === null) {
              gLines.appendChild(el('line', { x1: kx, y1: ky, x2: x, y2: y, class: `map-kline${picked ? ' on' : ''}` }));
              const kl = k.killer !== null ? bySlot.get(k.killer) : null;
              if (picked && kl) gHeroes.appendChild(heroToken(kl, kx, ky, { size: 18 }));
            }
          }
          const g = el('g', { class: `map-death-num${picked ? ' on' : ''}`, transform: `translate(${x.toFixed(1)},${y.toFixed(1)})`, filter: picked ? 'url(#mkGlow)' : null });
          g.appendChild(el('circle', { r: picked ? 22 : 17 }));
          g.appendChild(txt('text', { 'text-anchor': 'middle', y: picked ? 7 : 6 }, String(i + 1)));
          g.addEventListener('click', () => {
            st.picked = st.picked === i ? null : i;
            render();
          });
          gMarks.appendChild(g);
        });
      }

      if (st.mode === 'all') {
        for (const k of data.kills) {
          if (k.x === null || k.t < ph.from || k.t >= ph.to) continue;
          const v = bySlot.get(k.victim);
          gMarks.appendChild(deathX(k, v ? teamColor(v.team) : 'var(--muted)', k.victim === focusSlot));
        }
      }

      if (st.mode === 'heat' && hasPaths && st.selected !== null) {
        const pts = data.paths.players[st.selected] || [];
        for (let i = 0; i < pts.length; i++) {
          const t = i * step;
          if (!pts[i][2] || t < ph.from || t >= ph.to) continue;
          const [x, y] = toXY(pts[i][0], pts[i][1]);
          gHeat.appendChild(el('circle', { cx: x.toFixed(0), cy: y.toFixed(0), r: 26, class: 'map-heat-dot' }));
        }
      }

      if (st.mode === 'replay' && hasPaths) {
        // след выбранного героя за 30 секунд
        if (st.selected !== null) {
          const line = [];
          for (let t = Math.max(0, st.t - 30); t <= st.t; t += step) {
            const p = posAt(st.selected, t);
            if (p && p[2]) line.push(toXY(p[0], p[1]).map((v) => v.toFixed(0)).join(','));
          }
          if (line.length > 1) gLines.appendChild(el('polyline', { points: line.join(' '), class: 'map-trail' }));
        }
        // смерти последних 15 секунд
        for (const k of data.kills) {
          if (k.x === null || k.t > st.t || st.t - k.t > 15) continue;
          const v = bySlot.get(k.victim);
          gMarks.appendChild(deathX(k, v ? teamColor(v.team) : 'var(--muted)', true));
        }
        const order = data.players.slice().sort((a, b) => (a.slot === focusSlot) - (b.slot === focusSlot));
        for (const p of order) {
          const pos = posAt(p.slot, st.t);
          if (!pos) continue;
          const [x, y] = toXY(pos[0], pos[1]);
          gHeroes.appendChild(heroToken(p, x, y, { me: p.slot === focusSlot, dead: !pos[2] }));
        }
      }
      if (compact) {
        if (Number.isFinite(moment?.x) && Number.isFinite(moment?.y)) {
          const [x, y] = toXY(moment.x, moment.y);
          gHeroes.appendChild(el('circle', { cx: x, cy: y, r: 27, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 4 }));
        }
        return;
      }
      renderSide();
      renderLegend();
    }

    // ---------- правая колонка ----------
    const side = F.h('div.map-side');
    const legend = F.h('div.map-legend');
    const swatch = (cls, label, color) => F.h('span', F.h(`i.${cls}`, color ? { style: { background: color, borderColor: color } } : null), label);
    function renderLegend() {
      const parts = [];
      if (st.mode === 'mine') parts.push(swatch('num', `место смерти (${focusName})`), swatch('line', 'откуда стрелял убийца'));
      if (st.mode === 'all') parts.push(swatch('x', 'погиб твой союзник', 'var(--ally)'), swatch('x', 'погиб соперник', 'var(--enemy)'));
      if (st.mode === 'replay') parts.push(swatch('dot', 'твоя команда', 'var(--ally)'), swatch('dot', 'соперники', 'var(--enemy)'), swatch('x', 'смерть за последние 15 с', 'var(--text)'));
      if (st.mode === 'heat') parts.push(swatch('heat', 'чем ярче — тем дольше там был'));
      if (!imageOk && hasPaths) parts.push(F.h('span.dim', 'серые линии — где ходили игроки (линии и лес)'));
      legend.replaceChildren(...parts);
    }

    const phaseChips = () => F.h('div.map-chips', PHASES.map((x) => F.h(`button.chip-toggle${st.phase === x.key ? '.on' : ''}`, { onclick: () => { st.phase = x.key; render(); } }, x.label)));

    function renderSide() {
      if (st.mode === 'mine') {
        const own = myDeaths.map((k) => (k.x !== null ? onOwnHalf(k.x, k.y) : null));
        const enemyHalf = own.filter((x) => x === false).length;
        const byKiller = new Map();
        for (const k of myDeaths) if (k.killer !== null) byKiller.set(k.killer, (byKiller.get(k.killer) || 0) + 1);
        const topKiller = [...byKiller.entries()].sort((a, b) => b[1] - a[1])[0];
        const facts = [];
        if (allyBase && myDeaths.length) facts.push(`${enemyHalf} из ${myDeaths.length} — на чужой половине карты`);
        if (topKiller && topKiller[1] >= 2) facts.push(`чаще всего убивал ${heroName(bySlot.get(topKiller[0]).hero)} (${topKiller[1]} ${topKiller[1] < 5 ? 'раза' : 'раз'})`);
        side.replaceChildren(
          F.h('div.map-side-head', F.h('b', myDeaths.length ? `Смертей: ${myDeaths.length}` : 'Ни одной смерти'), F.h('span.muted', 'нажми, чтобы показать на карте')),
          facts.length ? F.h('div.map-facts', facts.map((f) => F.h('div', f))) : null,
          F.h('div.map-dlist', myDeaths.map((k, i) => {
            const kl = k.killer !== null ? bySlot.get(k.killer) : null;
            const half = own[i];
            return F.h(`button.map-ditem${st.picked === i ? '.on' : ''}`, { onclick: () => { st.picked = st.picked === i ? null : i; render(); } },
              F.h('span.map-dnum', String(i + 1)),
              F.h('span.num.map-dtime', F.time(k.t)),
              kl ? F.h('span.map-dkiller', heroImg(kl.hero) ? F.h('img', { src: heroImg(kl.hero), alt: '' }) : null, heroName(kl.hero)) : F.h('span.muted', 'без убийцы'),
              half === null ? null : F.h(`span.map-dhalf${half ? '' : '.far'}`, half ? 'своя половина' : 'чужая половина'));
          })));
        return;
      }
      if (st.mode === 'all') {
        const list = data.kills.filter((k) => {
          const ph = PHASES.find((x) => x.key === st.phase);
          return k.t >= ph.from && k.t < ph.to;
        });
        const allyDead = list.filter((k) => isAlly(bySlot.get(k.victim))).length;
        side.replaceChildren(
          F.h('div.map-side-head', F.h('b', `Смертей: ${list.length}`), F.h('span.muted', 'за выбранную часть матча')),
          phaseChips(),
          F.h('div.map-split-bar', F.h('span.ally', { style: { flex: String(allyDead || 0.0001) } }, allyDead ? `наших ${allyDead}` : ''), F.h('span.enemy', { style: { flex: String(list.length - allyDead || 0.0001) } }, list.length - allyDead ? `их ${list.length - allyDead}` : '')),
          F.h('div.hint', 'Скопления крестиков — места, где команды чаще всего дерутся и погибают.'));
        return;
      }
      if (st.mode === 'heat') {
        const sel = st.selected !== null ? bySlot.get(st.selected) : null;
        const pts = sel && hasPaths ? data.paths.players[sel.slot] || [] : [];
        const ph = PHASES.find((x) => x.key === st.phase);
        let alive = 0;
        let dead = 0;
        let own = 0;
        pts.forEach((p, i) => {
          const t = i * step;
          if (t < ph.from || t >= ph.to) return;
          if (!p[2]) return void (dead += 1);
          alive += 1;
          if (onOwnHalf(p[0], p[1])) own += 1;
        });
        const total = alive + dead;
        side.replaceChildren(
          F.h('div.map-side-head', F.h('b', sel ? `Где бывал ${sel.slot === focusSlot ? focusName.toLowerCase() === 'ты' ? 'ты' : focusName : heroName(sel.hero)}` : 'Выбери героя'), F.h('span.muted', 'выбери другого героя в табло ниже')),
          phaseChips(),
          total ? F.h('div.map-stats',
            allyBase ? F.h('div', F.h('b.num', `${Math.round((own / Math.max(1, alive)) * 100)}%`), F.h('span', 'времени на своей половине')) : null,
            allyBase ? F.h('div', F.h('b.num', `${Math.round(((alive - own) / Math.max(1, alive)) * 100)}%`), F.h('span', 'на чужой половине')) : null,
            F.h('div', F.h('b.num', `${Math.round((dead / total) * 100)}%`), F.h('span', 'времени мёртв'))) : null,
          board());
        return;
      }
      // повтор
      side.replaceChildren(controls, board(), feed());
    }

    // ---------- управление повтором ----------
    const range = F.h('input.map-range', { type: 'range', min: 0, max: Math.round(data.duration), step: 1, value: Math.round(st.t), 'aria-label': 'Минута матча' });
    range.addEventListener('input', () => {
      st.t = Number(range.value);
      render();
    });
    const clock = F.h('span.map-clock.num', F.time(st.t));
    const playBtn = F.h('button.btn.small', { onclick: () => togglePlay() }, 'Пуск');
    let timer = null;
    function togglePlay() {
      st.playing = !st.playing;
      playBtn.textContent = st.playing ? 'Пауза' : 'Пуск';
      clearInterval(timer);
      if (st.playing) {
        if (st.t >= data.duration) st.t = 0;
        timer = setInterval(() => {
          if (!document.body.contains(wrap) || st.mode !== 'replay') {
            st.playing = false;
            playBtn.textContent = 'Пуск';
            return clearInterval(timer);
          }
          st.t = Math.min(data.duration, st.t + st.speed / 10);
          if (st.t >= data.duration) togglePlay();
          range.value = String(Math.round(st.t));
          clock.textContent = F.time(st.t);
          render();
        }, 100);
      }
    }
    range.addEventListener('input', () => (clock.textContent = F.time(st.t)));
    const speedSel = F.h('select.select.small', { 'aria-label': 'Скорость', onchange: (e) => (st.speed = Number(e.target.value)) },
      [5, 10, 20, 40].map((s) => F.h('option', { value: s, selected: s === st.speed || null }, `×${s}`)));
    const ticks = F.h('div.map-ticks', data.kills.map((k) => {
      const v = bySlot.get(k.victim);
      return F.h('span', { style: { left: `${(k.t / data.duration) * 100}%`, background: v ? teamColor(v.team) : 'var(--muted)' }, title: `${F.time(k.t)}: погиб ${v ? heroName(v.hero) : ''}`,
        onclick: () => { st.t = Math.max(0, k.t - 5); range.value = String(Math.round(st.t)); clock.textContent = F.time(st.t); render(); } });
    }));
    const controls = F.h('div.map-controls', playBtn, speedSel, clock, F.h('div.map-track', ticks, range), F.h('div.map-track-hint', 'Отметки над шкалой — убийства. Нажми на отметку, чтобы перейти к ней.'));

    function board() {
      const t = st.mode === 'replay' ? st.t : data.duration;
      const block = (team) => {
        const list = data.players.filter((p) => p.team === team).map((p) => ({ p, s: snapAt(p.snaps, t) || [0, 0, 0, 0, 0] })).sort((a, b) => b.s[1] - a.s[1]);
        const souls = list.reduce((x, r) => x + r.s[1], 0);
        return F.h('div.map-team',
          F.h('div.map-team-head', F.h('span', { style: { color: teamColor(team) } }, team === allyTeam ? 'Твоя команда' : 'Соперники'), F.h('span.num', `${F.k(souls)} душ`)),
          list.map(({ p, s }) => F.h(`button.map-row${p.slot === st.selected ? '.sel' : ''}`, { onclick: () => { st.selected = p.slot; render(); }, title: 'Показать этого героя' },
            heroImg(p.hero) ? F.h('img', { src: heroImg(p.hero), alt: '' }) : F.h('span.ph', heroName(p.hero).slice(0, 2)),
            F.h('span.map-row-name', heroName(p.hero), p.slot === focusSlot ? F.h('span.map-you', 'ты') : null),
            F.h('span.num', `${s[2]}/${s[3]}/${s[4]}`),
            F.h('span.num.muted', F.k(s[1])))));
      };
      return F.h('div.map-board', block(allyTeam), block(allyTeam === 0 ? 1 : 0));
    }
    function feed() {
      const list = data.kills.filter((k) => k.t <= st.t).slice(-6).reverse();
      const ic = (p) => (heroImg(p.hero) ? F.h('img', { src: heroImg(p.hero), alt: '' }) : null);
      return F.h('div.map-feed', F.h('div.map-feed-head', 'Последние убийства'),
        ...(list.length ? list.map((k) => {
          const v = bySlot.get(k.victim);
          const kl = k.killer !== null ? bySlot.get(k.killer) : null;
          return F.h('button.map-kill', { onclick: () => { st.t = Math.max(0, k.t - 5); range.value = String(Math.round(st.t)); clock.textContent = F.time(st.t); render(); } },
            F.h('span.num.muted', F.time(k.t)),
            kl ? F.h('span.map-kname', { style: { color: teamColor(kl.team) } }, ic(kl), heroName(kl.hero)) : F.h('span.muted', 'погиб'),
            F.h('span.map-karrow', '→'),
            v ? F.h('span.map-kname', { style: { color: teamColor(v.team) } }, ic(v), heroName(v.hero)) : null);
        }) : [F.h('div.dim', 'Пока никто не погиб')]));
    }

    // ---------- переключатель режимов ----------
    const MODES = [
      { key: 'mine', label: focusSlot !== null ? (focusName === 'Ты' ? 'Мои смерти' : `Смерти: ${focusName}`) : null, ok: hasDeathPos && focusSlot !== null, hint: 'Где и от кого ты умирал' },
      { key: 'replay', label: 'Повтор матча', ok: hasPaths, hint: 'Где были все герои в выбранную минуту' },
      { key: 'heat', label: focusName === 'Ты' ? 'Где я бывал' : 'Где бывал', ok: hasPaths, hint: 'Тепловая карта перемещений' },
      { key: 'all', label: 'Все смерти', ok: hasDeathPos, hint: 'Где команды погибали' },
    ].filter((m) => m.label);
    const modeBar = F.h('div.map-modes');
    function renderModes() {
      modeBar.replaceChildren(...MODES.map((m) => F.h(`button.map-mode${st.mode === m.key ? '.on' : ''}`, { disabled: !m.ok || null, title: m.ok ? m.hint : 'В данных этого матча нет нужных координат',
        onclick: () => {
          st.mode = m.key;
          st.picked = null;
          if (m.key === 'heat' && st.selected === null) st.selected = focusSlot;
          renderModes();
          render();
        } }, F.h('b', m.label), F.h('span', m.hint))));
    }

    const calBtns = F.h('details.map-cal',
      F.h('summary', 'Картинка карты повёрнута не так?'),
      F.h('div.row', { style: { gap: '6px', marginTop: '8px' } },
        F.h('button.btn.small', { onclick: () => { cal = { ...cal, rot: (cal.rot + 90) % 360 }; saveCal(cal); drawRoads(); drawBases(); render(); } }, 'Повернуть на 90°'),
        F.h('button.btn.small', { onclick: () => { cal = { ...cal, flipX: !cal.flipX }; saveCal(cal); drawRoads(); drawBases(); render(); } }, 'Отразить ⇆'),
        F.h('button.btn.small', { onclick: () => { cal = { ...cal, flipY: !cal.flipY }; saveCal(cal); drawRoads(); drawBases(); render(); } }, 'Отразить ⇅')));
    const noteImg = F.h('div.map-note', 'Картинка карты не загрузилась — вместо неё серым показаны пути всех игроков: так видны линии и лес.');
    noteImg.hidden = !(hasPaths && !(mapAsset && mapAsset.img));
    const noData = !hasPaths && !hasDeathPos ? F.h('div.map-note', 'В данных этого матча нет координат — карту построить нельзя. Табло и лента убийств работают.') : null;

    if (compact) {
      st.mode = hasPaths ? 'replay' : moment ? null : 'all';
      if (moment) st.t = moment.t;
      const box = F.h('div.map-compact', F.h('div.map-frame', svg), !hasPaths && !moment ? F.h('div.map-note', 'В этом матче нет маршрутов — показаны места смертей.') : null);
      box.setTime = (t) => {
        st.t = t;
        render();
      };
      box.setMoment = (t, point) => {
        moment = point;
        st.mode = hasPaths ? 'replay' : point ? null : 'all';
        box.setTime(t);
      };
      drawRoads();
      drawBases();
      render();
      return box;
    }
    const wrap = F.h('div.mapbox',
      modeBar,
      F.h('div.mapview',
        F.h('div.map-stage', F.h('div.map-frame', svg), legend, noteImg, noData, calBtns),
        side));
    renderModes();
    drawRoads();
    drawBases();
    render();
    return wrap;
  }

  window.MapView = MapView;
})();
