'use strict';

const { setTimeout: delay } = require('node:timers/promises');
const { Decompress } = require('fzstd');
const { lossPerDeath, SOUL_LOSS_THRESHOLD } = require('../core/leaks');

const QUERY = 'SELECT tick, victim_team_number FROM HeroKilledEvent ORDER BY tick LIMIT 1001';
const MAX_BYTES = 128 * 1024;

async function readEvents(resultUrl, jobId, signal) {
  const url = new URL(resultUrl);
  if (url.origin !== 'https://demo-extracts.deadlock-api.com' || url.pathname !== `/${jobId}.ndjson.zst`) {
    throw new Error('Сервис вернул неизвестный адрес результата.');
  }
  const response = await fetch(url, { signal, redirect: 'error' });
  if (!response.ok || !response.body) throw new Error('Не удалось скачать результат разбора.');
  const chunks = [];
  let outputSize = 0;
  const decompress = new Decompress((chunk) => {
    outputSize += chunk.length;
    if (outputSize > MAX_BYTES) throw new Error('Результат разбора слишком большой.');
    chunks.push(Buffer.from(chunk));
  });
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error('Результат разбора слишком большой.');
    decompress.push(chunk);
  }
  decompress.push(new Uint8Array(), true);
  return Buffer.concat(chunks).toString('utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
}

async function replayEvents(api, matchId, signal) {
  let job;
  try {
    job = await api.post('/v1/matches/demo/query', { match_id: matchId, query: QUERY, format: 'ndjson' }, { signal });
  } catch (error) {
    if (error.code === 404) throw new Error('Реплей этого матча пока недоступен в Deadlock API.');
    throw error;
  }
  if (!/^[a-f0-9]{32}$/.test(job?.job_id || '')) throw new Error('Сервис не вернул номер задания.');
  while (true) {
    await delay(2000, undefined, { signal });
    const status = await api.get(`/v1/matches/demo/query/${job.job_id}`, { signal });
    if (status.status === 'done' && status.match_id === matchId) return readEvents(status.result_url, job.job_id, signal);
    if (status.status !== 'queued' && status.status !== 'running') throw new Error('Сервис не смог обработать реплей.');
  }
}

function summarizeReplay(events, match, player) {
  if (!events.length || events.length > 1000 || !events.every((event, i) =>
    Number.isSafeInteger(event.tick) && event.tick >= (events[i - 1]?.tick ?? 0)
    && (event.victim_team_number === 2 || event.victim_team_number === 3))) {
    throw new Error('В реплее нет подходящего журнала смертей.');
  }
  const deaths = match.players.flatMap((p) => (p.deaths_t || []).map((t) => ({ t, team: p.team })))
    .sort((a, b) => a.t - b.t);
  const aligned = deaths.length === events.length && deaths.length >= 2
    && deaths.every(({ t, team }, i) => Number.isFinite(t) && t >= 0 && t <= match.duration_s
      && team === events[i].victim_team_number - 2
      && Math.abs(t - deaths[0].t - (events[i].tick - events[0].tick) / 64) <= 2);
  const losses = aligned ? lossPerDeath(player)
    .filter(({ t, lost }) => t > 0 && t <= match.duration_s && lost >= SOUL_LOSS_THRESHOLD) : [];
  const bosses = aligned ? (match.midBoss || []).filter(([, , t]) => t > 0 && t <= match.duration_s)
    .map(([, , t]) => {
      const nearby = deaths.filter((d) => d.t >= t - 30 && d.t < t);
      return {
        t,
        allies: nearby.filter((d) => d.team === player.team).length,
        opponents: nearby.filter((d) => d.team !== player.team).length,
      };
    }) : [];
  return { count: events.length, aligned, losses, bosses };
}

module.exports = { replayEvents, summarizeReplay };
