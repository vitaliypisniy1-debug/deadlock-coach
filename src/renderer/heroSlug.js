'use strict';
// Имя файла героя для баннеров: английское имя строчными буквами, слова через дефис.
// «Mo & Krill» → mo-krill, «Lady Geist» → lady-geist, «The Doorman» → the-doorman.
// Один файл для интерфейса и для скрипта приёма баннеров (tools/ingest-banners.js).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.heroSlug = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return function heroSlug(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/&/g, ' ')
      .replace(/['’`]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  };
});
