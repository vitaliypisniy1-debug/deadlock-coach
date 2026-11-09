'use strict';
// Данные для миникарты: кто где умер, кто кого убил, маршруты героев по времени
// и снимки счёта (души, K/D/A) для табло на выбранной минуте.

function mapData(m) {
  if (!m) return null;
  const bySlot = new Map(m.players.map((p) => [p.slot, p]));
  const kills = [];
  for (const p of m.players) {
    for (const d of p.deaths || []) {
      const [t, x, y, killerSlot, kx, ky] = d;
      const killer = killerSlot !== null ? bySlot.get(killerSlot) : null;
      kills.push({ t, x, y, victim: p.slot, killer: killer ? killer.slot : null, kx, ky });
    }
  }
  kills.sort((a, b) => a.t - b.t);
  const hasPos = kills.some((k) => k.x !== null) || !!(m.paths && Object.keys(m.paths.players || {}).length);
  return {
    duration: m.duration_s,
    players: m.players.map((p) => ({
      slot: p.slot,
      hero: p.hero_id,
      team: p.team,
      account_id: p.account_id,
      snaps: (p.stats || []).map((s) => [s.t, s.nw, s.k, s.d, s.a]),
    })),
    kills,
    paths: m.paths || null,
    hasPos,
  };
}

module.exports = { mapData };
