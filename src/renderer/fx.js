'use strict';
// Анимации интерфейса на GSAP (vendor/gsap.min.js): появление блоков, счётчики, подсветка под курсором.
// Если GSAP не загрузился или включено «уменьшить движение», страница просто показывается без анимации.
(function () {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ok = () => window.gsap && !reduce;

  // Бегущее число: <span data-count="43" data-suffix="%" data-decimals="0">
  function countUp(root) {
    root.querySelectorAll('[data-count]').forEach((el) => {
      const to = Number(el.dataset.count);
      if (!Number.isFinite(to)) return;
      const dec = Number(el.dataset.decimals || 0);
      const suffix = el.dataset.suffix || '';
      const fmt = (n) => n.toLocaleString('ru-RU', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suffix;
      if (!ok()) { el.textContent = fmt(to); return; }
      const o = { v: 0 };
      el.textContent = fmt(0);
      window.gsap.to(o, { v: to, duration: 0.9, ease: 'power2.out', onUpdate: () => { el.textContent = fmt(o.v); }, onComplete: () => { el.textContent = fmt(to); } });
    });
  }

  // Появление раздела: блоки по очереди снизу вверх.
  function enter(view) {
    if (!view) return;
    countUp(view);
    if (!ok()) return;
    const items = [...view.children].filter((el) => !el.hidden);
    window.gsap.killTweensOf(items);
    window.gsap.fromTo(items, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.55, ease: 'power3.out', stagger: 0.07, clearProps: 'opacity,transform' });
    const tiles = view.querySelectorAll('.hl-tile, .kpi, .dash-hero-row');
    if (tiles.length) {
      window.gsap.fromTo(tiles, { opacity: 0, y: 10, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: 'power3.out', stagger: 0.05, delay: 0.12, clearProps: 'opacity,transform' });
    }
  }

  // Подсветка карточки под курсором: CSS читает --mx и --my.
  let raf = 0;
  document.addEventListener('pointermove', (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const card = e.target.closest && e.target.closest('.panel, .hl-tile, .kpi, .leak-focus, .hpick, .match, .btn');
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  }, { passive: true });

  window.FX = { enter, countUp };
})();
