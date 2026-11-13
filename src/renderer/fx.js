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

// ---------- параллакс шапок, наклон карточек, искры на фоне ----------
(function () {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  document.addEventListener('pointermove', (e) => {
    const head = e.target.closest && e.target.closest('.page-head, .dash-banner');
    if (head) {
      const r = head.getBoundingClientRect();
      head.style.setProperty('--px', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
      head.style.setProperty('--py', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
    }
    const card = e.target.closest && e.target.closest('.hpick, .hl-tile');
    if (card) {
      const r = card.getBoundingClientRect();
      const k = card.classList.contains('hpick') ? 9 : 4;
      card.style.setProperty('--ry', (((e.clientX - r.left) / r.width - 0.5) * k).toFixed(2) + 'deg');
      card.style.setProperty('--rx', ((0.5 - (e.clientY - r.top) / r.height) * k).toFixed(2) + 'deg');
    }
  }, { passive: true });
  document.addEventListener('pointerout', (e) => {
    const card = e.target.closest && e.target.closest('.hpick, .hl-tile');
    if (card && !card.contains(e.relatedTarget)) { card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); }
  }, { passive: true });

  // искры: лёгкий холст, 55 частиц, останавливается когда окно скрыто
  const cv = document.createElement('canvas');
  cv.id = 'ambient';
  document.body.prepend(cv);
  const ctx = cv.getContext('2d');
  let w = 0, h = 0, parts = [], raf = 0;
  const resize = () => { w = cv.width = window.innerWidth; h = cv.height = window.innerHeight; };
  const mk = () => ({ x: Math.random() * w, y: Math.random() * h, r: 0.6 + Math.random() * 1.8, vy: 0.12 + Math.random() * 0.4, ph: Math.random() * 6.28, sp: 0.4 + Math.random(), warm: Math.random() < 0.7, a: 0.12 + Math.random() * 0.45 });
  resize();
  parts = Array.from({ length: 55 }, mk);
  window.addEventListener('resize', resize);
  const tick = (t) => {
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.y -= p.vy; p.x += Math.sin(t / 1800 * p.sp + p.ph) * 0.25;
      if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
      const tw = 0.6 + 0.4 * Math.sin(t / 700 * p.sp + p.ph);
      ctx.beginPath();
      ctx.fillStyle = p.warm ? `rgba(255,153,102,${(p.a * tw).toFixed(3)})` : `rgba(95,212,238,${(p.a * tw).toFixed(3)})`;
      ctx.shadowColor = p.warm ? 'rgba(255,122,69,0.8)' : 'rgba(95,212,238,0.8)';
      ctx.shadowBlur = 8;
      ctx.arc(p.x, p.y, p.r, 0, 6.283);
      ctx.fill();
    }
    raf = requestAnimationFrame(tick);
  };
  const run = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(tick); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else run(); });
  run();
})();
