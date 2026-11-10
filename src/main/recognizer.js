'use strict';
// Распознавание состава по портретам на верхней панели игры (через снимок экрана).
// Игру не трогает: делает обычный снимок экрана, как OBS или Steam (F12).
// Работает в режиме «В окне без рамки»; в эксклюзивном полноэкранном режиме
// Windows отдаёт чёрный снимок — тогда портретов не найдём и скажем об этом.

const fs = require('fs');
const path = require('path');
const P = require('../core/portraits');

const MAX_LEARNED = 4; // сколько своих образцов храним на героя

// BGRA (как отдаёт Chromium на Windows) → RGBA, с отменой предумножения альфы.
function bgraToRgba(buf, { unpremultiply = false } = {}) {
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length; i += 4) {
    let b = buf[i];
    let g = buf[i + 1];
    let r = buf[i + 2];
    const a = buf[i + 3];
    if (unpremultiply && a > 0 && a < 255) {
      r = Math.min(255, Math.round((r * 255) / a));
      g = Math.min(255, Math.round((g * 255) / a));
      b = Math.min(255, Math.round((b * 255) / a));
    }
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = a;
  }
  return out;
}

class Recognizer {
  constructor({ store, getAssets, electron, log = () => {} }) {
    this.store = store;
    this.getAssets = getAssets;
    this.electron = electron; // { desktopCapturer, screen, nativeImage }
    this.log = log;
    this.refs = null; // Map heroId -> { variants }
    this.refsLoading = null;
    this.last = null; // последний результат (с признаками — для обучения)
    this.dir = path.join(store.dir, 'recognition');
  }

  learnedAll() {
    return this.store.read('portraits.json', {});
  }

  // Картинки героев из справочника → варианты образцов. Один раз за запуск.
  async loadRefs() {
    if (this.refs) return this.refs;
    if (this.refsLoading) return this.refsLoading;
    this.refsLoading = (async () => {
      const assets = this.getAssets();
      const heroes = Object.values((assets && assets.heroes) || {}).filter((h) => !h.disabled && h.card);
      const refs = new Map();
      const { nativeImage } = this.electron;
      await Promise.all(
        heroes.map(async (h) => {
          try {
            const res = await fetch(h.card, { headers: { 'User-Agent': 'DeadlockCoach/1.0' }, signal: AbortSignal.timeout(6000) });
            if (!res.ok) return;
            const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
            const size = img.getSize();
            if (!size.width) return;
            const data = bgraToRgba(img.toBitmap(), { unpremultiply: true });
            refs.set(h.id, { variants: P.refVariants({ w: size.width, h: size.height, data }) });
          } catch (e) {
            this.log(`portrait ref ${h.id}: ${e.message}`);
          }
        }),
      );
      this.refs = refs;
      return refs;
    })();
    try {
      return await this.refsLoading;
    } finally {
      this.refsLoading = null;
    }
  }

  // Снимок экрана: сначала основной монитор, потом остальные — где нашлись портреты.
  async captureScreens() {
    const { desktopCapturer, screen } = this.electron;
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    // Снимаем не больше 1080 строк (распознаванию хватает, а снимок вдвое-втрое легче)
    // и сразу оставляем только верхнюю полосу с портретами — в 7 раз меньше данных.
    const scale = (d) => Math.min(1, 1080 / Math.max(1, d.size.height * d.scaleFactor));
    const maxW = Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor * scale(d))));
    const maxH = Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor * scale(d))));
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: maxW, height: maxH } });
    const ordered = sources.slice().sort((a, b) => (String(b.display_id) === String(primary.id)) - (String(a.display_id) === String(primary.id)));
    return ordered.map((s) => {
      const size = s.thumbnail.getSize();
      const stripH = Math.max(1, Math.round(size.height * 0.14));
      const strip = s.thumbnail.crop({ x: 0, y: 0, width: size.width, height: stripH });
      // h — высота всего экрана (от неё считаются размеры портретов), данные — только полоса
      return { id: s.display_id, w: size.width, h: size.height, data: bgraToRgba(strip.toBitmap()), image: strip };
    });
  }

  // Главная функция: снимок → слоты → герои.
  async recognize({ save = true } = {}) {
    const t0 = Date.now();
    const assets = this.getAssets();
    const [refs, shots] = await Promise.all([this.loadRefs(), this.captureScreens()]);
    const learned = this.learnedAll();
    const heroes = Object.values((assets && assets.heroes) || {})
      .filter((h) => !h.disabled)
      .map((h) => ({
        id: h.id,
        variants: (refs.get(h.id) || {}).variants || [],
        learned: (learned[h.id] || []).map((a) => Float32Array.from(a)),
      }));
    const evaluate = (shot, sl) => {
      const features = sl.map((x) => P.slotFeature(shot, x));
      const picks = P.assignHeroes(features, heroes);
      return { features, picks, sure: picks.filter((p) => P.confident(p)).length };
    };
    let img = null;
    let slots = [];
    let ev = null;
    for (const s of shots) {
      // 1) плашки душ под портретами (идёт матч); 2) фиксированные места портретов
      //    (пауза перед матчем: плашек ещё нет) — годится, если узнали хотя бы двух героев
      const plates = P.findSlots(s);
      if (plates.length >= 12) {
        img = s;
        slots = plates;
        break;
      }
      const layout = P.layoutSlots(s);
      const le = evaluate(s, layout);
      if (le.sure >= 2) {
        img = s;
        slots = layout;
        ev = le;
        break;
      }
      if (plates.length >= 2) {
        img = s;
        slots = plates;
        break;
      }
    }
    if (!img) {
      const dark = shots.length && this.isDark(shots[0]);
      // сохраняем, что было на экране, когда не получилось, — чтобы разобраться
      try {
        if (shots.length) {
          fs.mkdirSync(this.dir, { recursive: true });
          fs.writeFileSync(path.join(this.dir, 'fail-top.png'), shots[0].image.toPNG());
        }
      } catch {}
      return {
        ok: false,
        reason: dark
          ? 'Снимок экрана получился чёрным — игра, похоже, в полноэкранном режиме. Включи в настройках Deadlock режим «В окне без рамки».'
          : 'Не нашёл портреты героев вверху экрана. Распознавание работает в матче и в паузе перед ним, когда видна верхняя панель с портретами.',
        ms: Date.now() - t0,
      };
    }
    if (!ev) ev = evaluate(img, slots);
    const { features, picks } = ev;
    const own = slots.map((s) => P.isOwnSlot(img, s));
    const ownIdx = own.indexOf(true);
    const center = img.w / 2;
    const myTeam = ownIdx >= 0 ? slots[ownIdx].team : (slots.find((s) => s.cx < center) || slots[0]).team;
    const result = slots.map((s, i) => {
      const p = picks[i];
      const box = P.slotBox(img, s);
      let thumb = null;
      try {
        thumb = img.image.crop({ x: Math.max(0, box.x), y: 0, width: box.w, height: box.h }).resize({ height: 72 }).toDataURL();
      } catch {}
      return {
        index: i,
        team: s.team,
        ally: s.team === myTeam,
        own: own[i],
        hero: p ? p.id : null,
        score: p ? Math.round(p.score * 1000) / 1000 : null,
        margin: p ? Math.round(p.margin * 1000) / 1000 : null,
        confident: P.confident(p),
        top3: p ? p.top3 : [],
        thumb,
      };
    });
    const sure = (r) => r.confident && r.hero;
    const out = {
      ok: true,
      at: Date.now(),
      ms: Date.now() - t0,
      screen: { w: img.w, h: img.h },
      slots: result,
      me: result.find((r) => r.own && sure(r))?.hero || null,
      allies: result.filter((r) => r.ally && !r.own && sure(r)).map((r) => r.hero),
      enemies: result.filter((r) => !r.ally && sure(r)).map((r) => r.hero),
      unsure: result.filter((r) => !sure(r)).length,
    };
    this.last = { out, features, img: { w: img.w, h: img.h } };
    if (save) this.saveDebug(img, slots, out);
    return out;
  }

  isDark(shot) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < shot.data.length; i += 4 * 997) {
      sum += shot.data[i] + shot.data[i + 1] + shot.data[i + 2];
      n += 1;
    }
    return n && sum / n < 6;
  }

  // Пользователь подтвердил героя на портрете → запоминаем образец.
  learn(slotIndex, heroId) {
    if (!this.last || !this.last.features[slotIndex]) throw new Error('Сначала распознай экран');
    const all = this.learnedAll();
    const id = Number(heroId);
    const list = all[id] || [];
    list.unshift(Array.from(this.last.features[slotIndex], (v) => Math.round(v)));
    all[id] = list.slice(0, MAX_LEARNED);
    this.store.write('portraits.json', all);
    const slot = this.last.out.slots[slotIndex];
    if (slot) {
      slot.hero = id;
      slot.confident = true;
      slot.learned = true;
    }
    return { learned: Object.keys(all).length };
  }

  forget() {
    this.store.write('portraits.json', {});
    return true;
  }

  // Для разбора ошибок: верхняя полоса последнего снимка и результат.
  saveDebug(img, slots, out) {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(path.join(this.dir, 'last-top.png'), img.image.toPNG());
      const { slots: s, ...rest } = out;
      fs.writeFileSync(path.join(this.dir, 'last.json'), JSON.stringify({ ...rest, slots: s.map(({ thumb, ...x }) => x), raw: slots }, null, 2));
    } catch (e) {
      this.log(`recognition debug: ${e.message}`);
    }
  }
}

module.exports = { Recognizer, bgraToRgba };
