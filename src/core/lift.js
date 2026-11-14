'use strict';
// «Lift» контрпредмета: насколько винрейт игроков с предметом против героя X отличается от
// обычного винрейта этого предмета, с поправкой на силу самого героя X.
//
//   lift = (винрейт предмета против X) − (винрейт предмета вообще) − сдвиг
//   сдвиг = взвешенный по играм средний (против X − вообще) по ВСЕМ предметам:
//           слабый герой даёт любому предмету плюс к винрейту, сильный — минус.
//
// Это статистическая связь, а не причина: предмет покупают те, кто уже выигрывает (или проигрывает
// и пытается спастись), против героя берут сразу набор предметов, момент покупки разный.
// Lift лишь подтверждает механику способностей — порядок рекомендаций он не меняет.
//
// Пороги проверены на двух независимых периодах по 14 дней, 44 героя × 156 предметов
// (src docs: docs/CURRENT_STATE.md, раздел Lift): при таких порогах знак сохраняется в 90% пар.

const MIN_GAMES = 1000;   // меньше игр против героя — числа нет («мало данных»)
const Z99 = 2.576;        // 99%-й доверительный интервал
const MIN_EFFECT = 0.015; // 1,5 п.п.: меньшие различия не показываем даже при значимости

// enemyRows — строки item-stats с фильтром enemy_hero_ids=X; baseRows — те же без фильтра героя.
// Строки: { item_id, wins, matches }. Возвращает { byItem: Map(item_id → stats), shift, games }.
function computeLift(enemyRows, baseRows) {
  const base = new Map();
  for (const r of baseRows || []) {
    if (r && (r.bucket === 0 || r.bucket === undefined) && r.matches > 0) base.set(r.item_id, r);
  }
  const items = [];
  for (const r of enemyRows || []) {
    if (!r || !(r.bucket === 0 || r.bucket === undefined) || !(r.matches > 0)) continue;
    const b = base.get(r.item_id);
    if (!b) continue;
    items.push({ id: r.item_id, n: r.matches, w: r.wins / r.matches, bw: b.wins / b.matches, bn: b.matches });
  }
  const total = items.reduce((s, x) => s + x.n, 0);
  if (!total) return { byItem: new Map(), shift: 0, games: 0 };
  const shift = items.reduce((s, x) => s + (x.w - x.bw) * x.n, 0) / total;
  const byItem = new Map();
  for (const x of items) {
    const lift = x.w - x.bw - shift;
    const se = Math.sqrt((x.w * (1 - x.w)) / x.n + (x.bw * (1 - x.bw)) / x.bn);
    const lo = lift - Z99 * se;
    const hi = lift + Z99 * se;
    let status = 'none'; // разница в пределах шума или меньше порога
    if (x.n < MIN_GAMES) status = 'few';
    else if (lift >= MIN_EFFECT && lo > 0) status = 'confirmed';
    else if (lift <= -MIN_EFFECT && hi < 0) status = 'warning';
    byItem.set(x.id, { status, n: x.n, wr: x.w, baseWr: x.bw, lift, lo, hi });
  }
  return { byItem, shift, games: total };
}

// Подпись для интерфейса: числа только при подтверждённой разнице (confirmed/warning).
function liftLabel(s) {
  if (!s) return null;
  if (s.status === 'few') return { text: 'мало данных', numbers: false };
  if (s.status === 'none') return { text: 'статистически не подтверждено: разница в пределах шума', numbers: false };
  return { text: s.status === 'confirmed' ? 'выигрывали чаще обычного' : 'выигрывали реже обычного', numbers: true };
}

module.exports = { computeLift, liftLabel, MIN_GAMES, MIN_EFFECT, Z99 };
