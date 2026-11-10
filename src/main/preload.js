'use strict';
// Мост между интерфейсом и основной частью приложения.
// Интерфейс не имеет доступа к диску и сети напрямую — только к этим функциям.
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) =>
  ipcRenderer.invoke(channel, ...args).then((r) => {
    if (!r.ok) throw new Error(r.error);
    return r.data;
  });

contextBridge.exposeInMainWorld('dc', {
  init: () => call('app:init'),
  login: () => call('auth:login'),
  loginManual: (input) => call('auth:manual', input),
  logout: () => call('auth:logout'),
  saveSettings: (patch) => call('settings:save', patch),
  refreshTop: () => call('top:refresh'),
  topList: () => call('top:list'),
  status: () => call('status:get'),
  overrideAccount: (name, accountId) => call('top:override', { name, accountId }),
  heroBuild: (heroId) => call('hero:build', heroId),
  playerDetail: (accountId) => call('player:detail', accountId),
  searchPlayers: (q) => call('players:search', q),
  matchDetail: (matchId, accountId) => call('match:detail', { matchId, accountId }),
  favorites: () => call('favorites:list'),
  addFavorite: (accountId, name) => call('favorites:add', { accountId, name }),
  removeFavorite: (accountId) => call('favorites:remove', accountId),
  myMatches: () => call('my:matches'),
  freshMatches: () => call('my:freshMatches'),
  coach: (opts) => call('coach:get', opts),
  myMatchups: () => call('mu:mine'),
  heroOutlook: (heroId) => call('mu:outlook', heroId),
  heroMatchups: (heroId) => call('mu:hero', heroId),
  prepareGame: (opts) => call('mu:prepare', opts),
  proCandidates: (matchId) => call('vs:candidates', matchId),
  versus: (opts) => call('vs:get', opts),
  overview: (days) => call('my:overview', days),
  myHeroes: () => call('my:heroes'),
  heroSummary: (heroId) => call('my:heroSummary', heroId),
  scanCache: () => call('my:scanCache'),
  campTargets: (heroId) => call('camp:targets', heroId),
  analyze: (opts) => call('camp:analyze', opts),
  openUrl: (url) => call('shell:open', url),
  copy: (text) => call('clipboard:write', text),
  updateCheck: () => call('update:check'),
  updateDownload: () => call('update:download'),
  updateInstall: () => call('update:install'),
  updateSkip: (version) => call('update:skip', version),
  toggleOverlay: (show) => call('overlay:toggle', show),
  overlayKey: () => call('overlay:key'),
  pickAdvise: (opts) => call('pick:advise', opts),
  pickPrepare: (force) => call('pick:prepare', force),
  gameLogCheck: () => call('game:logCheck'),
  recRun: () => call('rec:run'),
  recLearn: (slot, heroId) => call('rec:learn', { slot, heroId }),
  recForget: () => call('rec:forget'),
  recStatus: () => call('rec:status'),
  leaks: () => call('leaks:get'),
  lagLog: () => call('lag:get'),
  gameModeStatus: () => call('game:mode'),
  matchBuild: (matchId, accountId, slot) => call('build:get', { matchId, accountId, slot }),
  buildText: (b) => call('build:text', b),
  encodeGameBuild: (build) => call('build:encode', build),
  saveBuild: (name, content, kind) => call('build:save', { name, content, kind }),
  buildPng: (rect, name) => call('build:png', { rect, name }),
  copyBuildImage: (rect) => call('build:copyImage', { rect }),
  on: (channel, fn) => {
    const allowed = ['progress', 'log', 'meta:updated', 'overlay:shown', 'update:available', 'update:progress', 'overlay:recognized', 'game:event', 'game:mode'];
    if (!allowed.includes(channel)) return () => {};
    const h = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
});
