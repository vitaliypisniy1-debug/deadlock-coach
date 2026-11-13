'use strict';
// Графики на Apache ECharts (vendor/echarts.min.js). Подменяют lineChart и formChart из charts.js,
// интерфейс прежний: функции возвращают элемент div.chart-wrap. Если ECharts не загрузился,
// остаются прежние SVG-графики.
(function () {
  if (!window.echarts || !window.Charts) return;
  const E = window.echarts;
  const old = window.Charts;
  const css = getComputedStyle(document.documentElement);
  const v = (name, fb) => (css.getPropertyValue(name) || '').trim() || fb;
  const col = {
    you: () => v('--accent-2', '#ff9966'), accent: () => v('--accent', '#ff7a45'), top: () => v('--sky', '#5fd4ee'),
    good: () => v('--good', '#5fe3a1'), bad: () => v('--bad', '#ff7b7b'), muted: () => v('--muted', '#8da6aa'), dim: () => v('--dim', '#66808a'),
    text: () => v('--text', '#eef4f3'), line: () => 'rgba(255,255,255,0.07)',
  };
  const live = new Set();
  function gc() { for (const c of live) if (!c.wrap.isConnected) { try { c.chart.dispose(); } catch (e) { /* уже удалён */ } live.delete(c); } }

  // Создаёт график, когда у контейнера появился размер (элемент ещё может быть не в документе).
  function mount(wrap, build, ready) {
    gc();
    let chart = null;
    const init = () => {
      if (chart || !wrap.clientWidth) return;
      chart = E.init(wrap, null, { renderer: 'canvas' });
      live.add({ wrap, chart });
      chart.setOption(build());
      wrap._chart = chart;
      if (ready) ready(chart);
    };
    new ResizeObserver(() => { if (!chart) init(); else chart.resize(); }).observe(wrap);
    return () => chart;
  }
  const axisCommon = () => ({
    axisLine: { show: false }, axisTick: { show: false },
    axisLabel: { color: col.dim(), fontFamily: "Jost, 'Segoe UI', sans-serif", fontSize: 12 },
    splitLine: { lineStyle: { color: col.line(), type: [4, 6] } },
  });
  const tipBase = () => ({
    trigger: 'axis', confine: true, backgroundColor: 'rgba(5,12,15,0.96)', borderColor: 'rgba(255,255,255,0.14)', borderWidth: 1,
    padding: [10, 12], textStyle: { color: col.text(), fontFamily: "Jost, 'Segoe UI', sans-serif", fontSize: 13 },
    extraCssText: 'border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.6);',
    axisPointer: { type: 'line', lineStyle: { color: 'rgba(255,255,255,0.35)', width: 1 } },
  });
  const grad = (c1, c2) => new E.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: c1 }, { offset: 1, color: c2 }]);
  const rgba = (hex, a) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return `rgba(255,153,102,${a})`;
    const n = parseInt(m[1], 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  };

  // ---------- ты против топов по минутам ----------
  function lineChart(series, { yFmt = (x) => F.k(x), unit = '', height = 280, markers = [], meLabel = 'Ты', topLabel = 'Топы', onSeek = null } = {}) {
    const wrap = F.h('div.chart-wrap.ec');
    wrap.style.height = `${height}px`;
    const len = Math.max(series.me.length, series.med.length);
    const mins = Array.from({ length: len }, (_, i) => i);
    const hasBand = series.p25.some((x) => x !== null && x !== undefined) && series.p75.some((x) => x !== null && x !== undefined);
    const nn = (x) => (x === undefined ? null : x);
    let pendingTime = null;
    let getChart = () => null;
    const build = () => {
      const youC = col.you();
      const s = [];
      if (hasBand) {
        s.push({ id: 'b0', type: 'line', stack: 'band', symbol: 'none', silent: true, lineStyle: { opacity: 0 }, data: series.p25.map(nn), tooltip: { show: false } });
        s.push({ id: 'b1', type: 'line', stack: 'band', symbol: 'none', silent: true, lineStyle: { opacity: 0 }, areaStyle: { color: rgba('#5fd4ee', 0.13) }, data: series.p75.map((x, i) => (x === null || x === undefined || series.p25[i] === null || series.p25[i] === undefined ? null : x - series.p25[i])), tooltip: { show: false } });
      }
      s.push({ id: 'top', name: topLabel, type: 'line', smooth: 0.25, symbol: 'none', data: series.med.map(nn), lineStyle: { color: col.top(), width: 2.5, type: [7, 5] }, itemStyle: { color: col.top() } });
      s.push({
        id: 'me', name: meLabel, type: 'line', smooth: 0.25, symbol: 'circle', symbolSize: 8, showSymbol: false, data: series.me.map(nn),
        lineStyle: { color: youC, width: 3.5, shadowColor: rgba('#ff7a45', 0.55), shadowBlur: 12 }, itemStyle: { color: youC, borderColor: '#081216', borderWidth: 2 },
        areaStyle: { color: grad(rgba('#ff7a45', 0.34), rgba('#ff7a45', 0)) },
        markLine: { silent: true, symbol: 'none', label: { show: false }, data: markers.filter((m) => m.minute !== null && m.minute !== undefined && m.minute < len).map((m) => ({ xAxis: Math.round(m.minute), lineStyle: { color: m.color || 'rgba(255,255,255,0.25)', type: [2, 4], width: 1 } })) },
      });
      s.push({ id: 'cur', type: 'line', data: [], silent: true, markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: col.accent(), width: 2, type: [4, 3] }, data: [] } });
      return {
        animationDuration: 900, animationEasing: 'cubicOut', backgroundColor: 'transparent',
        grid: { left: 52, right: 18, top: 16, bottom: 28 },
        tooltip: {
          ...tipBase(),
          formatter: (ps) => {
            const i = ps[0].dataIndex;
            const vMe = nn(series.me[i]); const vTop = nn(series.med[i]);
            const diff = vMe !== null && vTop ? (vMe - vTop) / vTop : null;
            const band = series.p25[i] !== null && series.p25[i] !== undefined;
            return `<b style="font-size:14px">${i}:00</b><br>` +
              `<span style="color:${col.you()}">● ${F.esc(meLabel)}: <b>${F.esc(F.num(vMe))}${unit}</b></span><br>` +
              `<span style="color:${col.top()}">● ${F.esc(topLabel)}: <b>${F.esc(F.num(vTop))}${unit}</b></span>` +
              (band ? `<br><span style="color:${col.muted()}">обычно ${F.esc(F.num(series.p25[i]))}–${F.esc(F.num(series.p75[i]))}</span>` : '') +
              (diff !== null ? `<br><b style="color:${diff >= 0 ? col.good() : col.bad()}">${F.signedPct(diff)}</b>` : '') +
              (series.n && series.n[i] ? `<br><span style="color:${col.dim()}">игр в сравнении: ${series.n[i]}</span>` : '');
          },
        },
        xAxis: { type: 'category', data: mins, boundaryGap: false, ...axisCommon(), splitLine: { show: false }, axisLabel: { ...axisCommon().axisLabel, formatter: (x) => `${x}:00`, interval: (i) => i % (len > 40 ? 10 : 5) === 0 } },
        yAxis: { type: 'value', ...axisCommon(), axisLabel: { ...axisCommon().axisLabel, formatter: (x) => yFmt(x) } },
        series: s,
      };
    };
    getChart = mount(wrap, build, (chart) => {
      if (onSeek) {
        chart.getZr().on('click', (e) => {
          const p = [e.offsetX, e.offsetY];
          if (!chart.containPixel('grid', p)) return;
          const i = chart.convertFromPixel({ xAxisIndex: 0 }, p)[0];
          onSeek(Math.round(Math.max(0, Math.min(len - 1, i))) * 60);
        });
        chart.getZr().setCursorStyle('pointer');
      }
      if (pendingTime !== null) wrap.setTime(pendingTime);
    });
    if (onSeek) {
      wrap.setTime = (t) => {
        pendingTime = t;
        const chart = getChart();
        if (!chart) return;
        const minute = Math.round(t / 60);
        chart.setOption({ series: [{ id: 'cur', markLine: { data: minute <= len - 1 ? [{ xAxis: minute }] : [] } }] });
      };
    }
    return wrap;
  }

  // ---------- форма: скользящий винрейт и результаты игр ----------
  function formChart(form, { heroName = (id) => String(id) } = {}) {
    const wrap = F.h('div.chart-wrap.ec');
    wrap.style.height = '360px';
    const n = form.rolling.length;
    const idx = Array.from({ length: n }, (_, i) => i);
    const build = () => ({
      animationDuration: 1000, backgroundColor: 'transparent',
      grid: { left: 14, right: 56, top: 16, bottom: 12, containLabel: false },
      tooltip: {
        ...tipBase(),
        formatter: (ps) => {
          const i = ps[0].dataIndex; const g = form.results[i];
          if (!g) return '';
          return `<b>Игра ${i + 1} из ${n}</b><br>${F.esc(heroName(g.hero_id))} — <b style="color:${g.won ? col.good() : col.bad()}">${g.won ? 'победа' : 'поражение'}</b><br><span style="color:${col.muted()}">винрейт последних ${form.window}: ${Math.round(form.rolling[i] * 100)}%</span>`;
        },
      },
      xAxis: { type: 'category', data: idx, boundaryGap: n <= 1, show: false },
      yAxis: { type: 'value', min: -0.14, max: 1, position: 'right', ...axisCommon(), splitNumber: 4, interval: 0.25, axisLabel: { ...axisCommon().axisLabel, formatter: (x) => (x < 0 ? '' : `${Math.round(x * 100)}%`) }, splitLine: { lineStyle: { color: col.line(), type: [4, 6] } } },
      series: [
        {
          type: 'line', smooth: 0.3, data: form.rolling, symbol: 'circle', symbolSize: 9, showSymbol: false,
          lineStyle: { color: col.you(), width: 3.5, shadowColor: rgba('#ff7a45', 0.55), shadowBlur: 12 }, itemStyle: { color: col.you(), borderColor: '#081216', borderWidth: 2 },
          areaStyle: { color: grad(rgba('#ff7a45', 0.34), rgba('#ff7a45', 0)), origin: 0 },
          markLine: form.overall === null || form.overall === undefined ? undefined : { silent: true, symbol: 'none', lineStyle: { color: col.muted(), type: [5, 5], width: 1.2 }, label: { formatter: `Итог ${Math.round(form.overall * 100)}%`, position: 'insideStartTop', color: col.text(), fontFamily: "Jost, 'Segoe UI', sans-serif", backgroundColor: 'rgba(8,18,22,0.85)', padding: [4, 8], borderRadius: 8 }, data: [{ yAxis: form.overall }] },
          markPoint: n > 0 ? { symbol: 'circle', symbolSize: 12, silent: true, itemStyle: { color: col.you(), borderColor: '#fff', borderWidth: 2, shadowColor: rgba('#ff7a45', 0.9), shadowBlur: 14 }, label: { show: false }, data: [{ coord: [n - 1, form.rolling[n - 1]] }] } : undefined,
        },
        { type: 'scatter', symbol: 'roundRect', symbolSize: Math.min(16, Math.max(6, 520 / Math.max(1, n))), z: 5, silent: true, data: form.results.map((r, i) => ({ value: [i, -0.07], itemStyle: { color: r.won ? col.good() : col.bad(), opacity: 0.9 } })) },
      ],
    });
    mount(wrap, build);
    return wrap;
  }

  // ---------- ранг: ступенчатая линия, клик по точке открывает матч ----------
  function rankChart(points, { label = (b) => String(b), onOpen = null } = {}) {
    const wrap = F.h('div.chart-wrap.ec');
    wrap.style.height = '200px';
    const levels = [...new Set(points.map((p) => p.badge))].sort((a, b) => a - b);
    const pos = (b) => levels.indexOf(b);
    const names = levels.map((b) => label(b));
    const data = points.map((p) => ({ value: [p.time * 1000, label(p.badge)], p }));
    const build = () => ({
      animationDuration: 1000, backgroundColor: 'transparent',
      grid: { left: 70, right: 24, top: 14, bottom: 26 },
      tooltip: {
        trigger: 'item', confine: true, backgroundColor: 'rgba(5,12,15,0.96)', borderColor: 'rgba(255,255,255,0.14)', padding: [8, 12],
        textStyle: { color: col.text(), fontFamily: "Jost, 'Segoe UI', sans-serif", fontSize: 13 }, extraCssText: 'border-radius:12px;',
        formatter: (p) => `<b>${F.esc(label(p.data.p.badge))}</b><br><span style="color:${col.muted()}">${new Date(p.data.p.time * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} · нажми, чтобы открыть матч</span>`,
      },
      xAxis: { type: 'time', ...axisCommon(), splitLine: { show: false }, axisLabel: { ...axisCommon().axisLabel, hideOverlap: true } },
      yAxis: { type: 'category', data: names, boundaryGap: true, ...axisCommon() },
      series: [{
        type: 'line', step: 'end', data, symbol: 'circle', symbolSize: 7, cursor: onOpen ? 'pointer' : 'default',
        lineStyle: { color: col.you(), width: 3, shadowColor: rgba('#ff7a45', 0.6), shadowBlur: 12 }, itemStyle: { color: '#fff', borderColor: col.accent(), borderWidth: 2 },
        areaStyle: { color: grad(rgba('#ff7a45', 0.26), rgba('#ff7a45', 0)), origin: 'start' },
        emphasis: { scale: 1.6 },
      }],
    });
    mount(wrap, build, (chart) => {
      if (onOpen) chart.on('click', (e) => { if (e.data && e.data.p) onOpen(e.data.p.matchId); });
    });
    return wrap;
  }

  window.Charts = { ...old, lineChart, formChart, rankChart };
})();
