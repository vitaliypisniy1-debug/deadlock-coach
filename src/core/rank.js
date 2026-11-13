'use strict';
// Ранг игры: значок = уровень * 10 + ступень (71 — Oracle 1).
// В свежих рейтинговых матчах средний значок матча в метаданных равен 0 (проверено: все 10 100 матчей ноября 2026 и все
// личные матчи с 30.10.2026), поэтому «ранг по значку команды» там пустой. Запасной источник — собственный значок игрока
// из истории матчей (ranked_display_badge); для остальных игроков матча ранг есть только в SQL API (player_rank_initial_display_rank).

// Значок команды из матча, если он есть (> 0), иначе собственный значок игрока; иначе null.
function gameBadge(match, me, ownBadge = null) {
  const team = match && Array.isArray(match.badge) && me && Number.isInteger(me.team) ? match.badge[me.team] : null;
  if (typeof team === 'number' && team > 0) return team;
  const own = Number(ownBadge);
  return own > 0 ? own : null;
}

// Уровень (1–11) по значку; 0 и пусто — «неизвестно», а не «самый низкий ранг».
const tierOfBadge = (b) => (Number(b) > 0 ? Math.floor(Number(b) / 10) : null);

module.exports = { gameBadge, tierOfBadge };
