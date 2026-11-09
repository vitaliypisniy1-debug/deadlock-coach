'use strict';
// Распознавание героев по портретам на верхней панели Deadlock.
// Работает с «сырыми» картинками: { w, h, data: RGBA (Uint8 / Buffer) }.
// Ничего не знает про Electron — его можно проверить и в браузере, и в Node.
//
// 1) findSlots: под каждым портретом есть плашка душ цвета команды (янтарная или
//    сапфировая) на одной высоте. Ищем эти плашки в верхней части экрана — они
//    дают число игроков, центр каждого портрета и команду.
// 2) slotFeature: вырезаем портрет над плашкой, берём центр (по краям значки «!»)
//    и сжимаем в маленькую сетку цветов.
// 3) Сравнение с образцами: картинки героев из справочника (с прозрачностью,
//    подбираем масштаб и сдвиг) и портреты, которые пользователь подтвердил сам.

const GW = 24; // сетка признаков
const GH = 30;

function px(img, x, y) {
  const i = (y * img.w + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

// Цвета команд на плашках душ (на скриншотах 2560×1600 янтарь ≈ (220,140,20), сапфир ≈ (80,130,210)).
function teamColor(r, g, b) {
  if (r > 185 && g > 95 && g < 180 && b < 80 && r - b > 130) return 'amber';
  if (b > 165 && r < 140 && g > 85 && g < 175 && b - r > 60) return 'sapphire';
  return null;
}

// Поиск плашек: строки в полосе 8–13% высоты, отрезки одного цвета шириной ≈ 3% высоты.
function findSlots(img) {
  const H = img.h;
  const W = img.w;
  const minW = Math.round(H * 0.022);
  const maxW = Math.round(H * 0.045);
  const found = [];
  for (let y = Math.round(H * 0.08); y <= Math.round(H * 0.13); y += Math.max(1, Math.round(H / 400))) {
    let cur = null;
    const segs = [];
    for (let x = Math.round(W * 0.15); x < Math.round(W * 0.85); x++) {
      const [r, g, b] = px(img, x, y);
      const t = teamColor(r, g, b);
      if (t && cur && cur.t === t && x - cur.b <= 2) cur.b = x;
      else {
        if (cur) segs.push(cur);
        cur = t ? { t, a: x, b: x } : null;
      }
    }
    if (cur) segs.push(cur);
    for (const s of segs) {
      const w = s.b - s.a + 1;
      if (w >= minW && w <= maxW) found.push({ y, team: s.t, cx: (s.a + s.b) / 2, w });
    }
  }
  // объединяем одинаковые плашки с разных строк
  const slots = [];
  for (const f of found) {
    const s = slots.find((o) => o.team === f.team && Math.abs(o.cxSum / o.n - f.cx) < H * 0.012);
    if (s) {
      s.n += 1;
      s.cxSum += f.cx;
      s.yMin = Math.min(s.yMin, f.y);
    } else slots.push({ team: f.team, cxSum: f.cx, n: 1, yMin: f.y });
  }
  return slots
    .filter((s) => s.n >= 2)
    .map((s) => ({ team: s.team, cx: s.cxSum / s.n, labelTop: s.yMin }))
    .sort((a, b) => a.cx - b.cx);
}

// Прямоугольник портрета над плашкой.
function slotBox(img, slot) {
  const H = img.h;
  const w = Math.round(H * 0.07);
  const h = Math.round(Math.min(slot.labelTop, H * 0.088));
  return { x: Math.round(slot.cx - w / 2), y: 0, w, h };
}

// Средний цвет области (x0..x1, y0..y1) в долях — для «моей» квадратной подложки.
function meanColor(img, box, fx0, fy0, fx1, fy1) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = Math.round(box.y + box.h * fy0); y < Math.round(box.y + box.h * fy1); y++) {
    for (let x = Math.round(box.x + box.w * fx0); x < Math.round(box.x + box.w * fx1); x++) {
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
      const p = px(img, x, y);
      r += p[0];
      g += p[1];
      b += p[2];
      n += 1;
    }
  }
  return n ? [r / n, g / n, b / n] : [0, 0, 0];
}

// Свой портрет стоит на квадратной подложке цвета команды: верхние углы окрашены.
function isOwnSlot(img, slot) {
  const box = slotBox(img, slot);
  const tl = meanColor(img, box, 0.62, 0.02, 0.98, 0.12);
  return !!teamColor(...tl);
}

// Сетка GW×GH из центральной части портрета (по краям — значки «!»).
const INNER = { x0: 0.22, x1: 0.78, y0: 0.1, y1: 0.98 };

function gridFrom(img, box) {
  const out = new Float32Array(GW * GH * 3);
  const bx = box.x + box.w * INNER.x0;
  const by = box.y + box.h * INNER.y0;
  const bw = box.w * (INNER.x1 - INNER.x0);
  const bh = box.h * (INNER.y1 - INNER.y0);
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      const x0 = Math.floor(bx + (gx * bw) / GW);
      const x1 = Math.max(x0 + 1, Math.floor(bx + ((gx + 1) * bw) / GW));
      const y0 = Math.floor(by + (gy * bh) / GH);
      const y1 = Math.max(y0 + 1, Math.floor(by + ((gy + 1) * bh) / GH));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
          const i = (y * img.w + x) * 4;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          n += 1;
        }
      }
      const k = (gy * GW + gx) * 3;
      out[k] = n ? r / n : 0;
      out[k + 1] = n ? g / n : 0;
      out[k + 2] = n ? b / n : 0;
    }
  }
  return out;
}

// Признаки слота: сетка цветов центральной части портрета.
function slotFeature(img, slot) {
  return gridFrom(img, slotBox(img, slot));
}

// Нормированная корреляция двух сеток (по маске, если она есть). 1 — одинаковые.
function ncc(a, b, mask = null) {
  let n = 0;
  const ma = [0, 0, 0];
  const mb = [0, 0, 0];
  for (let i = 0; i < GW * GH; i++) {
    if (mask && !mask[i]) continue;
    n += 1;
    for (let c = 0; c < 3; c++) {
      ma[c] += a[i * 3 + c];
      mb[c] += b[i * 3 + c];
    }
  }
  if (n < GW * GH * 0.2) return -1;
  for (let c = 0; c < 3; c++) {
    ma[c] /= n;
    mb[c] /= n;
  }
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < GW * GH; i++) {
    if (mask && !mask[i]) continue;
    for (let c = 0; c < 3; c++) {
      const x = a[i * 3 + c] - ma[c];
      const y = b[i * 3 + c] - mb[c];
      sab += x * y;
      saa += x * x;
      sbb += y * y;
    }
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : -1;
}

// Образцы из картинки справочника (RGBA с прозрачностью): набор вариантов
// масштаба и сдвига, каждый — сетка + маска непрозрачных клеток.
function refVariants(ref, { scales = [0.85, 1, 1.15, 1.3], shifts = [-0.08, 0, 0.08], vshifts = [-0.1, 0, 0.1] } = {}) {
  const out = [];
  // «виртуальный слот» с соотношением сторон как у портрета в игре (0.07 : 0.088)
  const aspect = 0.07 / 0.088;
  for (const s of scales) {
    for (const dx of shifts) {
      for (const dy of vshifts) {
        // размер слота в пикселях картинки-образца: подгоняем ширину образца под s ширин слота
        const bw = ref.w / s;
        const bh = bw / aspect;
        const box = { x: (ref.w - bw) / 2 + dx * bw, y: (ref.h - bh) / 2 + dy * bh, w: bw, h: bh };
        const grid = new Float32Array(GW * GH * 3);
        const mask = new Uint8Array(GW * GH);
        const bx = box.x + box.w * INNER.x0;
        const by = box.y + box.h * INNER.y0;
        const iw = box.w * (INNER.x1 - INNER.x0);
        const ih = box.h * (INNER.y1 - INNER.y0);
        for (let gy = 0; gy < GH; gy++) {
          for (let gx = 0; gx < GW; gx++) {
            let r = 0;
            let g = 0;
            let b = 0;
            let n = 0;
            let opaque = 0;
            const x0 = Math.floor(bx + (gx * iw) / GW);
            const x1 = Math.max(x0 + 1, Math.floor(bx + ((gx + 1) * iw) / GW));
            const y0 = Math.floor(by + (gy * ih) / GH);
            const y1 = Math.max(y0 + 1, Math.floor(by + ((gy + 1) * ih) / GH));
            for (let y = y0; y < y1; y++) {
              for (let x = x0; x < x1; x++) {
                n += 1;
                if (x < 0 || y < 0 || x >= ref.w || y >= ref.h) continue;
                const i = (y * ref.w + x) * 4;
                if (ref.data[i + 3] < 200) continue;
                r += ref.data[i];
                g += ref.data[i + 1];
                b += ref.data[i + 2];
                opaque += 1;
              }
            }
            const k = gy * GW + gx;
            if (n && opaque / n > 0.8) {
              mask[k] = 1;
              grid[k * 3] = r / opaque;
              grid[k * 3 + 1] = g / opaque;
              grid[k * 3 + 2] = b / opaque;
            }
          }
        }
        out.push({ grid, mask });
      }
    }
  }
  return out;
}

// Сравнение признаков слота с героем: лучший из вариантов образцов справочника и выученных образцов.
function scoreHero(feature, hero) {
  let best = -1;
  for (const v of hero.variants || []) best = Math.max(best, ncc(feature, v.grid, v.mask));
  for (const l of hero.learned || []) best = Math.max(best, ncc(feature, l) + 0.05); // свои образцы чуть важнее
  return best;
}

// Распределяем героев по слотам: каждый герой — не больше одного раза (жадно по уверенности).
function assignHeroes(features, heroes) {
  const cand = [];
  features.forEach((f, si) => {
    for (const h of heroes) cand.push({ si, id: h.id, s: scoreHero(f, h) });
  });
  const bySlot = features.map((_, si) => cand.filter((c) => c.si === si).sort((a, b) => b.s - a.s));
  cand.sort((a, b) => b.s - a.s);
  const usedS = new Set();
  const usedH = new Set();
  const res = features.map(() => null);
  for (const c of cand) {
    if (usedS.has(c.si) || usedH.has(c.id)) continue;
    usedS.add(c.si);
    usedH.add(c.id);
    const top = bySlot[c.si];
    const second = top.find((x) => x.id !== c.id);
    res[c.si] = { id: c.id, score: c.s, margin: second ? c.s - second.s : 1, top3: top.slice(0, 3).map((x) => ({ id: x.id, s: Math.round(x.s * 1000) / 1000 })) };
  }
  return res;
}

// Уверенность: насколько похоже вообще и насколько выше второго варианта.
// По проверке на реальных снимках: верный герой по картинке справочника ≈ 0,87
// при отрыве ≥ 0,3; выученный образец ≈ 0,97+; «не тот» — до ~0,55 с отрывом ~0,03.
function confident(r) {
  return !!r && r.score >= 0.68 && r.margin >= 0.1;
}

module.exports = { GW, GH, teamColor, findSlots, slotBox, isOwnSlot, slotFeature, gridFrom, ncc, refVariants, scoreHero, assignHeroes, confident };
