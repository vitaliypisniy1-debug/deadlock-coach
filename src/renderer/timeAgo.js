'use strict';
// «Сколько прошло»: только что / N минут назад / N часов назад / N дней назад, с русскими склонениями.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.agoRu = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  };
  // seconds: сколько секунд прошло. Нет числа или оно отрицательное (часы разошлись): null, подпись не показываем.
  return function agoRu(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
    if (seconds < 60) return 'только что';
    const min = Math.floor(seconds / 60);
    if (min < 60) return `${min} ${plural(min, 'минуту', 'минуты', 'минут')} назад`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours} ${plural(hours, 'час', 'часа', 'часов')} назад`;
    const days = Math.floor(hours / 24);
    return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
  };
});
