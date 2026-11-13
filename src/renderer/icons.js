'use strict';
// Иконки Lucide (ISC, vendor/lucide-icons.js). Icon('flame') → <span class="ico"><svg…></span>
(function () {
  const ALIAS = { bulb: 'lightbulb', refresh: 'refresh-cw', logout: 'log-out', close: 'x', arrow: 'arrow-right' };
  function svg(name) {
    const key = ALIAS[name] || name;
    const body = (window.LUCIDE && window.LUCIDE[key]) || '';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  }
  function Icon(name, cls = '') {
    const span = document.createElement('span');
    span.className = 'ico' + (cls ? ' ' + cls : '');
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = svg(name);
    return span;
  }
  window.Icon = Icon;
  window.iconSvg = svg;
  // иконки, заданные в разметке: <span class="ico" data-icon="house">
  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = svg(el.dataset.icon); });
})();
