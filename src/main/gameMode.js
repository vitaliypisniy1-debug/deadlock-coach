'use strict';
// Игровой режим: понимаем, что Deadlock запущен, чтобы на это время отложить
// фоновые загрузки. Оверлей и распознавание состава при этом работают как обычно.
//
// Как узнаём: процесс deadlock.exe в списке задач Windows (раз в 15 с, одна
// короткая команда) или свежие строки в логе игры (если включён -condebug).

const { execFile } = require('child_process');
const { EventEmitter } = require('events');

const PROCESS = 'deadlock.exe';

// Есть ли процесс в выводе tasklist /FO CSV /NH (чистая функция — для теста).
function hasProcess(tasklistOutput, name = PROCESS) {
  const want = `"${name.toLowerCase()}"`;
  return String(tasklistOutput || '')
    .split(/\r?\n/)
    .some((line) => line.trim().toLowerCase().startsWith(want));
}

function processRunning(name = PROCESS) {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (err, out) => {
      resolve(!err && hasProcess(out, name));
    });
  });
}

class GameMode extends EventEmitter {
  // logActiveAt: () => время (мс) последней новой строки лога игры или 0
  constructor({ intervalMs = 15000, logActiveAt = () => 0, check = processRunning } = {}) {
    super();
    this.intervalMs = intervalMs;
    this.logActiveAt = logActiveAt;
    this.check = check;
    this.active = false;
    this.since = null;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    let running = false;
    try {
      running = await this.check();
    } catch {}
    if (!running) running = Date.now() - (this.logActiveAt() || 0) < 60e3;
    this.set(running);
  }

  set(running) {
    if (running === this.active) return;
    this.active = running;
    this.since = Date.now();
    this.emit('change', running);
  }

  info() {
    return { active: this.active, since: this.since };
  }
}

module.exports = { GameMode, hasProcess, processRunning };
