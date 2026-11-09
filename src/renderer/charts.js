'use strict';
// Простой линейный график на SVG: ты против топов (медиана + "коридор" 25–75%).
(function () {
  const NS = 'http://www.w3.org/2000/svg';

  function niceStep(max, count) {
    const raw = max / count;
    const pow = 10 ** Math.floor(Math.log10(raw || 1));
    const n = raw / pow;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * pow;
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    return el;
  }

  // series: { me:[], med:[], p25:[], p75:[], n:[] } — значения по минутам
  function lineChart(series, { yFmt = (v) => F.k(v), unit = '', height = 280, markers = [], meLabel = 'Ты', topLabel = 'Топы' } = {}) {
    const W = 900;
    const H = height;
    const m = { l: 54, r: 18, t: 14, b: 28 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const len = Math.max(series.me.length, series.med.length);
    const maxX = Math.max(1, len - 1);
    let maxY = 0;
    for (const arr of [series.me, series.p75, series.med]) for (const v of arr) if (v !== null && v > maxY) maxY = v;
    maxY = maxY || 1;
    const step = niceStep(maxY * 1.05, 5);
    const top = Math.ceil((maxY * 1.05) / step) * step;
    const x = (i) => m.l + (i / maxX) * iw;
    const y = (v) => m.t + ih - (v / top) * ih;

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });

    // сетка
    for (let v = 0; v <= top + 1e-9; v += step) {
      svg.appendChild(svgEl('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), style: 'stroke: var(--line); stroke-width:1' }));
      const t = svgEl('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', style: 'fill: var(--dim); font-size: 12px' });
      t.textContent = yFmt(v);
      svg.appendChild(t);
    }
    const xStep = maxX > 40 ? 10 : 5;
    for (let i = 0; i <= maxX; i += xStep) {
      const t = svgEl('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', style: 'fill: var(--dim); font-size: 12px' });
      t.textContent = `${i}:00`;
      svg.appendChild(t);
    }

    // коридор 25–75% у топов
    let seg = [];
    const flushBand = () => {
      if (seg.length > 1) {
        const pts = seg.map((i) => `${x(i)},${y(series.p75[i])}`).concat(seg.slice().reverse().map((i) => `${x(i)},${y(series.p25[i])}`));
        svg.appendChild(svgEl('polygon', { points: pts.join(' '), style: 'fill: var(--top); opacity: 0.12' }));
      }
      seg = [];
    };
    for (let i = 0; i < len; i++) {
      if (series.p25[i] !== null && series.p75[i] !== null && series.p25[i] !== undefined) seg.push(i);
      else flushBand();
    }
    flushBand();

    const path = (arr, style) => {
      let d = '';
      let pen = false;
      arr.forEach((v, i) => {
        if (v === null || v === undefined) {
          pen = false;
          return;
        }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      });
      if (!d) return null;
      const pe = svgEl('path', { d, style: `fill:none; ${style}` });
      svg.appendChild(pe);
      return pe;
    };
    path(series.med, 'stroke: var(--top); stroke-width: 2.5; stroke-dasharray: 6 4');
    const meLine = path(series.me, 'stroke: var(--you); stroke-width: 3');
    if (meLine) {
      meLine.setAttribute('pathLength', '1');
      meLine.setAttribute('class', 'draw');
    }

    for (const mk of markers) {
      if (mk.minute === null || mk.minute === undefined || mk.minute > maxX) continue;
      svg.appendChild(svgEl('line', { x1: x(mk.minute), x2: x(mk.minute), y1: m.t, y2: m.t + ih, style: `stroke: ${mk.color || 'var(--line-2)'}; stroke-width: 1; stroke-dasharray: 2 3` }));
    }

    // наведение
    const cross = svgEl('line', { x1: 0, x2: 0, y1: m.t, y2: m.t + ih, style: 'stroke: var(--muted); stroke-width: 1; opacity: 0' });
    const dotMe = svgEl('circle', { r: 4.5, style: 'fill: var(--you); opacity: 0' });
    const dotTop = svgEl('circle', { r: 4.5, style: 'fill: var(--top); opacity: 0' });
    svg.append(cross, dotMe, dotTop);
    const hit = svgEl('rect', { x: m.l, y: m.t, width: iw, height: ih, style: 'fill: transparent' });
    svg.appendChild(hit);

    const wrap = F.h('div.chart-wrap');
    const tip = F.h('div.chart-tip');
    tip.hidden = true;
    wrap.append(svg, tip);

    hit.addEventListener('mousemove', (ev) => {
      const r = svg.getBoundingClientRect();
      const sx = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(maxX, Math.round(((sx - m.l) / iw) * maxX)));
      const vMe = series.me[i];
      const vTop = series.med[i];
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      cross.style.opacity = 0.6;
      const place = (dot, v) => {
        if (v === null || v === undefined) {
          dot.style.opacity = 0;
          return;
        }
        dot.setAttribute('cx', x(i));
        dot.setAttribute('cy', y(v));
        dot.style.opacity = 1;
      };
      place(dotMe, vMe);
      place(dotTop, vTop);
      const diff = vMe !== null && vTop ? (vMe - vTop) / vTop : null;
      tip.innerHTML =
        `<b>${i}:00</b><br>` +
        `<span class="you">${F.esc(meLabel)}: ${F.esc(F.num(vMe))}${unit}</span><br>` +
        `<span class="top">${F.esc(topLabel)}: ${F.esc(F.num(vTop))}${unit}</span>` +
        (series.p25[i] !== null && series.p25[i] !== undefined ? `<br><span class="muted">обычно ${F.esc(F.num(series.p25[i]))}–${F.esc(F.num(series.p75[i]))}</span>` : '') +
        (diff !== null ? `<br>${diff >= 0 ? '<span class="diff-pos">' : '<span class="diff-neg">'}${F.signedPct(diff)}</span>` : '') +
        (series.n && series.n[i] ? `<br><span class="dim">игр в сравнении: ${series.n[i]}</span>` : '');
      tip.hidden = false;
      const wr = wrap.getBoundingClientRect();
      tip.style.left = `${Math.min(wr.width - 80, Math.max(80, ev.clientX - wr.left))}px`;
      tip.style.top = `${(y(Math.max(vMe ?? 0, vTop ?? 0)) / H) * r.height - 8}px`;
    });
    hit.addEventListener('mouseleave', () => {
      tip.hidden = true;
      cross.style.opacity = 0;
      dotMe.style.opacity = 0;
      dotTop.style.opacity = 0;
    });
    return wrap;
  }

  // Плавная линия через точки (Catmull-Rom → кривые Безье).
  function smoothPath(pts, clampY = null) {
    const cy = (v) => (clampY ? Math.max(clampY[0], Math.min(clampY[1], v)) : v);
    if (!pts.length) return '';
    if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, cy(p1[1] + (p2[1] - p0[1]) / 6)];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, cy(p2[1] - (p3[1] - p1[1]) / 6)];
      d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  }

  // «Форма»: скользящий винрейт + квадратики побед/поражений под графиком.
  function formChart(form, { heroName = (id) => String(id) } = {}) {
    const W = 900;
    const H = 400;
    const m = { l: 14, r: 56, t: 16, b: 52 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const n = form.rolling.length;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Винрейт по играм' });
    const lo = 0;
    const hi = 1;
    const x = (i) => m.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;
    const defs = svgEl('defs');
    const grad = svgEl('linearGradient', { id: 'formFill', x1: 0, x2: 0, y1: 0, y2: 1 });
    grad.append(svgEl('stop', { offset: '0%', 'stop-color': 'var(--accent)', 'stop-opacity': 0.28 }), svgEl('stop', { offset: '100%', 'stop-color': 'var(--accent)', 'stop-opacity': 0 }));
    defs.appendChild(grad);
    const pat = svgEl('pattern', { id: 'dots', width: 14, height: 14, patternUnits: 'userSpaceOnUse' });
    pat.appendChild(svgEl('circle', { cx: 1, cy: 1, r: 1, style: 'fill: var(--line-2)' }));
    defs.appendChild(pat);
    svg.appendChild(defs);
    svg.appendChild(svgEl('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'url(#dots)', opacity: 0.6 }));
    for (const v of [0.25, 0.5, 0.75]) {
      svg.appendChild(svgEl('line', { x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v), style: 'stroke: var(--line); stroke-width: 1' }));
      const t = svgEl('text', { x: W - m.r + 10, y: y(v) + 4, style: 'fill: var(--muted); font: 500 12px var(--mono)' });
      t.textContent = `${Math.round(v * 100)}%`;
      svg.appendChild(t);
    }
    if (form.overall !== null && form.overall !== undefined) {
      const yo = y(form.overall);
      svg.appendChild(svgEl('line', { x1: m.l, x2: m.l + iw, y1: yo, y2: yo, style: 'stroke: var(--muted); stroke-width: 1.2; stroke-dasharray: 5 5' }));
      const label = `Итог ${Math.round(form.overall * 100)}%`;
      const bx = m.l + 8;
      const bw = label.length * 7.4 + 16;
      svg.appendChild(svgEl('rect', { x: bx, y: yo - 11, width: bw, height: 22, rx: 5, style: 'fill: var(--bg-2); stroke: var(--line-2)' }));
      const t = svgEl('text', { x: bx + 8, y: yo + 4, style: 'fill: var(--text-2); font: 500 12px var(--mono)' });
      t.textContent = label;
      svg.appendChild(t);
    }
    const pts = form.rolling.map((v, i) => [x(i), y(v)]);
    if (pts.length > 1) {
      const line = smoothPath(pts, [m.t, m.t + ih]);
      svg.appendChild(svgEl('path', { d: `${line}L${x(n - 1)},${m.t + ih}L${x(0)},${m.t + ih}Z`, fill: 'url(#formFill)' }));
      svg.appendChild(svgEl('path', { d: line, pathLength: 1, class: 'draw', style: 'fill: none; stroke: var(--accent); stroke-width: 2.5' }));
      const last = pts[pts.length - 1];
      svg.appendChild(svgEl('circle', { cx: last[0], cy: last[1], r: 9, style: 'fill: var(--accent); opacity: 0.18' }));
      svg.appendChild(svgEl('circle', { cx: last[0], cy: last[1], r: 4.5, style: 'fill: var(--bg); stroke: var(--accent); stroke-width: 2.5' }));
    }
    // квадратики побед/поражений
    const sq = Math.min(16, Math.max(5, iw / Math.max(1, n) - 3));
    const step = n <= 1 ? 0 : iw / (n - 1);
    form.results.forEach((r, i) => {
      const cx = n <= 1 ? m.l + iw / 2 : m.l + i * step;
      const rect = svgEl('rect', { x: cx - sq / 2, y: H - m.b + 16, width: sq, height: sq, rx: 3, style: `fill: ${r.won ? 'var(--good)' : 'var(--bad)'}; opacity: 0.85` });
      const title = svgEl('title');
      title.textContent = `${r.won ? 'Победа' : 'Поражение'} · ${heroName(r.hero_id)} · ${F.clock(r.t)}`;
      rect.appendChild(title);
      svg.appendChild(rect);
    });
    // подсказка при наведении на линию
    const wrap = F.h('div.chart-wrap');
    const tip = F.h('div.chart-tip');
    tip.hidden = true;
    const hit = svgEl('rect', { x: m.l, y: m.t, width: iw, height: ih, style: 'fill: transparent' });
    const dot = svgEl('circle', { r: 4.5, style: 'fill: var(--accent); opacity: 0' });
    svg.append(dot, hit);
    hit.addEventListener('mousemove', (ev) => {
      if (!n) return;
      const r = svg.getBoundingClientRect();
      const sx = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((sx - m.l) / iw) * (n - 1))));
      dot.setAttribute('cx', x(i));
      dot.setAttribute('cy', y(form.rolling[i]));
      dot.style.opacity = 1;
      const g = form.results[i];
      tip.innerHTML = `<b>Игра ${i + 1} из ${n}</b><br>${F.esc(heroName(g.hero_id))} — ${g.won ? '<span class="diff-pos">победа</span>' : '<span class="diff-neg">поражение</span>'}<br><span class="muted">винрейт последних ${form.window}: ${Math.round(form.rolling[i] * 100)}%</span>`;
      tip.hidden = false;
      const wr = wrap.getBoundingClientRect();
      tip.style.left = `${Math.min(wr.width - 90, Math.max(90, ev.clientX - wr.left))}px`;
      tip.style.top = `${(y(form.rolling[i]) / H) * r.height - 8}px`;
    });
    hit.addEventListener('mouseleave', () => {
      tip.hidden = true;
      dot.style.opacity = 0;
    });
    wrap.append(svg, tip);
    return wrap;
  }

  // Маленький график в плитке: значения по играм + пунктир эталона.
  function sparkline(values, { ref = null, color = 'var(--text-2)' } = {}) {
    const W = 220;
    const H = 46;
    const vals = values.filter((v) => v !== null && Number.isFinite(v));
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'spark', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    if (vals.length < 2) return svg;
    // сглаживаем скользящим средним по 3 играм, чтобы линия читалась
    const sm = values.map((_, i) => {
      const part = values.slice(Math.max(0, i - 2), i + 1).filter((v) => v !== null && Number.isFinite(v));
      return part.length ? part.reduce((s, v) => s + v, 0) / part.length : null;
    }).filter((v) => v !== null);
    const all = ref !== null ? sm.concat([ref]) : sm;
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    if (hi - lo < 1e-9) {
      hi += 1;
      lo -= 1;
    }
    const pad = (hi - lo) * 0.15;
    lo -= pad;
    hi += pad;
    const x = (i) => 4 + (i / (sm.length - 1)) * (W - 12);
    const y = (v) => 4 + (H - 8) - ((v - lo) / (hi - lo)) * (H - 8);
    if (ref !== null) svg.appendChild(svgEl('line', { x1: 0, x2: W, y1: y(ref), y2: y(ref), style: 'stroke: var(--muted); stroke-width: 1; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke' }));
    const pts = sm.map((v, i) => [x(i), y(v)]);
    svg.appendChild(svgEl('path', { d: smoothPath(pts), style: `fill: none; stroke: ${color}; stroke-width: 1.8; vector-effect: non-scaling-stroke` }));
    const l = pts[pts.length - 1];
    svg.appendChild(svgEl('circle', { cx: l[0], cy: l[1], r: 3, style: `fill: ${color}` }));
    return svg;
  }

  // Кольцо с процентом.
  function ring(value, { size = 112, stroke = 10, color = 'var(--good)' } = {}) {
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, 'aria-hidden': 'true' });
    svg.appendChild(svgEl('circle', { cx: size / 2, cy: size / 2, r, style: `fill: none; stroke: var(--line); stroke-width: ${stroke}` }));
    const v = Math.max(0, Math.min(1, value || 0));
    svg.appendChild(svgEl('circle', { cx: size / 2, cy: size / 2, r, transform: `rotate(-90 ${size / 2} ${size / 2})`, style: `fill: none; stroke: ${color}; stroke-width: ${stroke}; stroke-linecap: round; stroke-dasharray: ${(c * v).toFixed(1)} ${c.toFixed(1)}` }));
    return svg;
  }

  // Прогресс цели: столбик на каждую игру, зелёный — цель выполнена, красный — нет; пунктир — цель.
  function goalChart(rows, cmp) {
    const W = 360;
    const H = 90;
    const pad = 6;
    const vals = rows.map((r) => r.value).concat(rows.map((r) => r.target)).filter((v) => v !== null && Number.isFinite(v));
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'goal-chart', role: 'img', 'aria-label': 'Значения по играм и цель' });
    if (!vals.length) return svg;
    const max = Math.max(...vals) * 1.1 || 1;
    const n = rows.length;
    const bw = Math.max(4, Math.min(22, (W - pad * 2) / n - 4));
    const step = (W - pad * 2) / n;
    const y = (v) => H - pad - (Math.max(0, v) / max) * (H - pad * 2);
    rows.forEach((r, i) => {
      const x = pad + i * step + (step - bw) / 2;
      const top = y(r.value);
      const rect = svgEl('rect', { x: x.toFixed(1), y: top.toFixed(1), width: bw.toFixed(1), height: Math.max(2, H - pad - top).toFixed(1), rx: 2, class: `gc-bar ${r.pass === true ? 'ok' : r.pass === false ? 'no' : ''}${r.afterStart ? '' : ' before'}`, style: `animation-delay: ${i * 25}ms` });
      const t = svgEl('title');
      t.textContent = `${r.pass === true ? 'выполнено' : r.pass === false ? 'не выполнено' : ''}${r.afterStart ? '' : ' (до плана)'}`;
      rect.appendChild(t);
      svg.appendChild(rect);
      if (r.target !== null && Number.isFinite(r.target)) {
        svg.appendChild(svgEl('line', { x1: (x - 2).toFixed(1), x2: (x + bw + 2).toFixed(1), y1: y(r.target).toFixed(1), y2: y(r.target).toFixed(1), class: 'gc-target' }));
      }
    });
    return svg;
  }

  window.Charts = { lineChart, formChart, sparkline, ring, smoothPath, goalChart };
})();
