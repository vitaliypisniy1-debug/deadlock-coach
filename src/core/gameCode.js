'use strict';
// Код билда для вставки в Deadlock.
// В редакторе билдов игры есть кнопка вставки из буфера обмена: игра принимает
// текст Base64( Zstandard-кадр( Protocol Buffers-сообщение билда ) ).
// Формат не документирован Valve; описание взято из открытого проекта
// github.com/JoniSmiff/Deadlock-Browser-Build-Maker (MIT). Игра принимает
// несжатый («raw block») Zstandard-кадр, поэтому сжатие не нужно.
//
// Сообщение билда:
//   1 build_id (varint, любой), 2 hero_id, 5 name, 6 description, 7 = 0, 8 = 0,
//   10 details { 1 категория*, 2 порядок способностей }, 11 метки (до 3)
//   категория { 1 предмет*, 2 name, 3 description, 4 width (float, 600), 5 height (float), 6 необязательная }
//   предмет   { 1 item_id, 2 заметка, 4 = 0 (вместе с заметкой), 5 способность для «улучшения» }
//   порядок способностей { 1 шаг* { 1 ability_id, 2 тип очка, 3 изменение (отрицательное) } }
//   шаг: открытие — тип 2, −1; улучшения — тип 1, −1 / −2 / −5 очков.
// ID предметов и способностей — те же числа, что в данных матчей и справочниках deadlock-api.

const MAX_BYTES = 16000; // с обновления 6.10.2026 игра не публикует билды больше этого

class W {
  constructor() {
    this.a = [];
  }
  varint(v) {
    let x = BigInt.asUintN(64, BigInt(v));
    while (x > 0x7fn) {
      this.a.push(Number(x & 0x7fn) | 0x80);
      x >>= 7n;
    }
    this.a.push(Number(x));
    return this;
  }
  V(f, v) {
    return this.varint(f << 3).varint(v);
  }
  B(f, bytes) {
    this.varint((f << 3) | 2).varint(bytes.length);
    for (const b of bytes) this.a.push(b);
    return this;
  }
  S(f, str) {
    return this.B(f, Buffer.from(String(str || ''), 'utf8'));
  }
  F(f, x) {
    this.varint((f << 3) | 5);
    const b = Buffer.alloc(4);
    b.writeFloatLE(x, 0);
    for (const v of b) this.a.push(v);
    return this;
  }
  bytes() {
    return Uint8Array.from(this.a);
  }
}

// Несжатый Zstandard-кадр с одним raw-блоком.
function zstdRaw(p) {
  const n = p.length;
  if (n > 120000) throw new Error('Билд слишком большой для кода');
  let head;
  if (n <= 255) head = [0x20, n];
  else if (n <= 65791) head = [0x60, (n - 256) & 255, (n - 256) >> 8];
  else head = [0xa0, n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const bh = (n << 3) | 1; // последний блок, тип raw
  const out = new Uint8Array(4 + head.length + 3 + n);
  out.set([0x28, 0xb5, 0x2f, 0xfd], 0);
  out.set(head, 4);
  out.set([bh & 255, (bh >> 8) & 255, (bh >> 16) & 255], 4 + head.length);
  out.set(p, 7 + head.length);
  return out;
}

const STEP = {
  1: { t: 2, d: -1 }, // открытие
  2: { t: 1, d: -1 },
  3: { t: 1, d: -2 },
  4: { t: 1, d: -5 },
};

// build: { heroId, name, description, categories: [{ name, description, items: [{ id, note }] }], abilities: [{ id, level }] }
function payload(build) {
  const details = new W();
  for (const c of build.categories || []) {
    if (!c.items || !c.items.length) continue;
    const cw = new W();
    for (const it of c.items) {
      const mw = new W().V(1, it.id >>> 0);
      if (it.note) mw.S(2, it.note).V(4, 0);
      cw.B(1, mw.bytes());
    }
    cw.S(2, c.name || '').S(3, c.description || '').F(4, 600);
    if (c.optional) cw.V(6, 1);
    details.B(1, cw.bytes());
  }
  const steps = (build.abilities || []).filter((s) => STEP[s.level]);
  if (steps.length) {
    const aw = new W();
    for (const s of steps) aw.B(1, new W().V(1, s.id >>> 0).V(2, STEP[s.level].t).V(3, STEP[s.level].d).bytes());
    details.B(2, aw.bytes());
  }
  return new W()
    .V(1, 1)
    .V(2, build.heroId)
    .S(5, String(build.name || '').slice(0, 120))
    .S(6, String(build.description || '').slice(0, 1500))
    .V(7, 0)
    .V(8, 0)
    .B(10, details.bytes())
    .bytes();
}

function encodeBuildCode(build) {
  const p = payload(build);
  return { code: Buffer.from(zstdRaw(p)).toString('base64'), bytes: p.length, tooBig: p.length > MAX_BYTES };
}

// --- разбор (для проверки своих кодов; поддерживает только несжатые кадры) ---
function readVarint(d, pos) {
  let v = 0n;
  let sh = 0n;
  let c;
  do {
    if (pos.i >= d.length) throw new Error('обрезано');
    c = d[pos.i++];
    v |= BigInt(c & 0x7f) << sh;
    sh += 7n;
  } while (c & 0x80);
  return v;
}
function readFields(d) {
  const pos = { i: 0 };
  const out = [];
  while (pos.i < d.length) {
    const key = Number(readVarint(d, pos));
    const f = key >>> 3;
    const w = key & 7;
    let v;
    if (w === 0) v = readVarint(d, pos);
    else if (w === 2) {
      const l = Number(readVarint(d, pos));
      v = d.subarray(pos.i, pos.i + l);
      pos.i += l;
    } else if (w === 5) {
      v = d.subarray(pos.i, pos.i + 4);
      pos.i += 4;
    } else throw new Error('неизвестный тип поля');
    out.push({ f, w, v });
  }
  return out;
}
function decodeBuildCode(code) {
  const raw = Buffer.from(String(code).trim(), 'base64');
  if (raw[0] !== 0x28 || raw[1] !== 0xb5 || raw[2] !== 0x2f || raw[3] !== 0xfd) throw new Error('Это не код билда Deadlock');
  const fhd = raw[4];
  const fcsSize = [fhd >> 6 === 0 && fhd & 0x20 ? 1 : 0, 2, 4, 8][fhd >> 6];
  const singleSeg = (fhd >> 5) & 1;
  let i = 5 + (singleSeg ? 0 : 1) + fcsSize;
  const bh = raw[i] | (raw[i + 1] << 8) | (raw[i + 2] << 16);
  if (((bh >> 1) & 3) !== 0) throw new Error('Разбор сжатых кодов не поддерживается');
  const p = raw.subarray(i + 3, i + 3 + (bh >> 3));
  const b = { heroId: 0, name: '', description: '', categories: [], abilities: [] };
  const td = (x) => Buffer.from(x).toString('utf8');
  for (const x of readFields(p)) {
    if (x.f === 2) b.heroId = Number(x.v);
    else if (x.f === 5) b.name = td(x.v);
    else if (x.f === 6) b.description = td(x.v);
    else if (x.f === 10) {
      for (const y of readFields(x.v)) {
        if (y.f === 1) {
          const c = { name: '', items: [] };
          for (const z of readFields(y.v)) {
            if (z.f === 1) {
              const it = { id: 0, note: '' };
              for (const m of readFields(z.v)) {
                if (m.f === 1) it.id = Number(m.v);
                else if (m.f === 2) it.note = td(m.v);
              }
              c.items.push(it);
            } else if (z.f === 2) c.name = td(z.v);
          }
          b.categories.push(c);
        } else if (y.f === 2) {
          for (const z of readFields(y.v)) {
            const s = {};
            for (const m of readFields(z.v)) {
              if (m.f === 1) s.id = Number(m.v);
              else if (m.f === 2) s.t = Number(m.v);
              else if (m.f === 3) s.d = Number(BigInt.asIntN(64, m.v));
            }
            b.abilities.push(s);
          }
        }
      }
    }
  }
  return b;
}

module.exports = { encodeBuildCode, decodeBuildCode, payload, zstdRaw, MAX_BYTES };
