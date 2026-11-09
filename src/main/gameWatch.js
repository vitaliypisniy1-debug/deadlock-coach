'use strict';
// Следим за логом консоли Deadlock (нужен параметр запуска -condebug), чтобы
// поймать момент паузы перед игрой. Порядок строк в настоящем матче:
//   Lobby … for Match <id> created  →  OnMatchFormed  →  WaitingForPlayersToJoin
//   →  MatchIntro  →  WaitForMapToLoad  →  PreGameWait (≈30 с, можно сменить героя)
//   →  GameInProgress  →  … PostGame
// В песочнице и матчах с ботами «Match … created» нет — их пропускаем.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const STATE_RE = /OnGameStateChanged:\s*([A-Za-z]+)/;
const MATCH_RE = /for Match (\d+) created/;
const HIDEOUT_RE = /Loading map "dl_hideout"/;

// Разбор строк лога в события (чистая функция — легко проверить тестом).
function parseLines(lines, state) {
  const events = [];
  for (const line of lines) {
    let m = line.match(MATCH_RE);
    if (m) {
      state.matchId = Number(m[1]);
      state.phase = 'formed';
      events.push({ type: 'match', matchId: state.matchId });
      continue;
    }
    if (HIDEOUT_RE.test(line)) {
      if (state.matchId) events.push({ type: 'left', matchId: state.matchId });
      state.matchId = null;
      state.phase = 'hideout';
      continue;
    }
    m = line.match(STATE_RE);
    if (m) {
      const s = m[1];
      state.phase = s;
      if (!state.matchId) continue; // песочница / боты
      if (s === 'PreGameWait') events.push({ type: 'pregame', matchId: state.matchId });
      else if (s === 'GameInProgress') events.push({ type: 'started', matchId: state.matchId });
      else if (s === 'PostGame' || s === 'GameOver') events.push({ type: 'ended', matchId: state.matchId });
    }
  }
  return events;
}

class GameWatch extends EventEmitter {
  constructor({ findFile, intervalMs = 1500, log = () => {} }) {
    super();
    this.findFile = findFile; // async () => путь к console.log или null
    this.intervalMs = intervalMs;
    this.log = log;
    this.file = null;
    this.pos = 0;
    this.rest = '';
    this.state = { matchId: null, phase: null };
    this.timer = null;
    this.lastEvent = null;
    this.status = 'off';
  }

  async start() {
    if (this.timer) return;
    this.status = 'searching';
    try {
      this.file = await this.findFile();
    } catch {
      this.file = null;
    }
    if (!this.file) this.status = 'no-log';
    else {
      try {
        this.pos = fs.statSync(this.file).size; // старое не читаем
      } catch {
        this.pos = 0;
      }
      this.status = 'watching';
    }
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.status = 'off';
  }

  async tick() {
    try {
      if (!this.file || !fs.existsSync(this.file)) {
        // лог появится, когда игру запустят с -condebug
        this.file = await this.findFile().catch(() => null);
        if (!this.file) {
          this.status = 'no-log';
          return;
        }
        this.pos = 0;
      }
      const size = fs.statSync(this.file).size;
      if (size < this.pos) {
        // игра перезапущена — лог начат заново
        this.pos = 0;
        this.rest = '';
        this.state = { matchId: null, phase: null };
      }
      if (size === this.pos) return;
      const len = Math.min(size - this.pos, 4 * 1024 * 1024);
      const fd = fs.openSync(this.file, 'r');
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, this.pos);
      fs.closeSync(fd);
      this.pos += len;
      const text = this.rest + buf.toString('utf8');
      const lines = text.split(/\r?\n/);
      this.rest = lines.pop() || '';
      this.status = 'watching';
      for (const ev of parseLines(lines, this.state)) {
        this.lastEvent = { ...ev, at: Date.now() };
        this.emit('event', ev);
      }
    } catch (e) {
      this.log(`game watch: ${e.message}`);
    }
  }

  info() {
    return { status: this.status, file: this.file, phase: this.state.phase, matchId: this.state.matchId, lastEvent: this.lastEvent };
  }
}

// Путь к логу: <библиотека Steam>/steamapps/common/Deadlock/game/citadel/console.log
function consoleLogPath(gameDir) {
  return gameDir ? path.join(gameDir, 'game', 'citadel', 'console.log') : null;
}

module.exports = { GameWatch, parseLines, consoleLogPath };
