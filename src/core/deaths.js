'use strict';
// Смерти в одиночку: в момент смерти рядом не было ни одного живого союзника.
// Считается по маршрутам героев (extract.js: paths, шаг step секунд — позиция,
// жив ли). У матчей без маршрутов данных нет — null, а не «ноль смертей»:
// иначе игра без проверки выглядела бы образцовой (см. checked в leaks.js).

const NEAR = 2500; // единиц карты: ближе — союзник успевает помочь (≈8 с бега при 320/с)
const SINCE = 600; // после 10:00 начинается командная игра; до этого на линии стоят поодиночке

const dist = (x, y, pt) => Math.hypot(x - pt[0], y - pt[1]);

function pathsOf(m) {
  return m && m.paths && m.paths.players && Object.keys(m.paths.players).length ? m.paths : null;
}

// Союзники игрока (без него самого), у которых есть маршрут.
function alliesOf(m, me) {
  const paths = pathsOf(m);
  if (!paths || !me) return null;
  const others = (m.players || []).filter((p) => p !== me && p.team === me.team);
  if (!others.length) return null;
  // маршрут хотя бы одного союзника не записан — проверить «был ли кто-то рядом» нельзя
  if (others.some((q) => !(paths.players[q.slot] || []).length)) return null;
  return others;
}

/**
 * Смерти игрока после SINCE, для которых в момент смерти ни один живой союзник
 * не был ближе NEAR. Возвращает массив { t, x, y, killerSlot, allyDist, foes }
 * или null, если данных для проверки нет. allyDist === null — все союзники были мертвы.
 */
function soloDeathRows(m, me) {
  const allies = alliesOf(m, me);
  if (!allies) return null;
  const paths = m.paths;
  const step = paths.step || 5;
  const foes = (m.players || []).filter((p) => p.team !== me.team);
  const at = (slot, t) => {
    const pp = paths.players[slot];
    return pp[Math.min(pp.length - 1, Math.max(0, Math.round(t / step)))];
  };
  const out = [];
  for (const d of me.deaths || []) {
    const [t, x, y, killerSlot] = d;
    if (typeof t !== 'number' || t < SINCE || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    let near = false;
    let allyDist = null;
    for (const q of allies) {
      const pt = at(q.slot, t);
      if (!pt || !pt[2]) continue; // мёртв — помочь не мог
      const dd = dist(x, y, pt);
      if (dd <= NEAR) {
        near = true;
        break;
      }
      if (allyDist === null || dd < allyDist) allyDist = dd;
    }
    if (near) continue;
    let nearFoes = 0;
    for (const q of foes) {
      if (!(paths.players[q.slot] || []).length) continue;
      const pt = at(q.slot, t);
      if (pt && pt[2] && dist(x, y, pt) <= NEAR) nearFoes += 1;
    }
    out.push({ t, x, y, killerSlot: killerSlot ?? null, allyDist: allyDist === null ? null : Math.round(allyDist), foes: nearFoes });
  }
  return out;
}

// Сколько смертей в одиночку (метрика тренера); null — данных нет.
function soloDeaths(m, me) {
  const rows = soloDeathRows(m, me);
  return rows === null ? null : rows.length;
}

// Можно ли вообще проверить игру: все смерти после SINCE имеют координаты
// и попадают в покрытие маршрутов союзников. true/false; null — данных нет.
function soloDeathsVerifiable(m, me) {
  const allies = alliesOf(m, me);
  if (!allies || !me) return null;
  const step = m.paths.step || 5;
  const cover = Math.min(...allies.map((q) => (m.paths.players[q.slot] || []).length - 1)) * step;
  const late = (me.deaths || []).filter((d) => typeof d[0] === 'number' && d[0] >= SINCE);
  return late.every((d) => Number.isFinite(d[1]) && Number.isFinite(d[2]) && d[0] <= cover + step);
}

module.exports = { NEAR, SINCE, soloDeathRows, soloDeaths, soloDeathsVerifiable };
