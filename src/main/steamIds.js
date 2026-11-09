'use strict';
// Преобразования Steam ID и разбор ответа входа через Steam (OpenID 2.0).
// Модуль без Electron — его можно проверять обычным node.

const STEAM64_BASE = 76561197960265728n;

function steamIdToAccountId(steamId64) {
  return Number(BigInt(String(steamId64)) - STEAM64_BASE);
}

function accountIdToSteamId(accountId) {
  return (BigInt(accountId) + STEAM64_BASE).toString();
}

// Принимает: ссылку на профиль /profiles/7656..., SteamID64, account id (steam32), [U:1:N].
// Ссылки вида /id/имя разбирает vanityOf + resolveVanity (через публичный XML профиля).
function parseSteamInput(input) {
  const s = String(input || '').trim();
  let m = s.match(/steamcommunity\.com\/profiles\/(\d{17})/);
  if (m) return { accountId: steamIdToAccountId(m[1]), steamId64: m[1] };
  m = s.match(/^\[U:1:(\d+)\]$/);
  if (m) return { accountId: Number(m[1]), steamId64: accountIdToSteamId(m[1]) };
  m = s.match(/^(\d{17})$/);
  if (m && BigInt(m[1]) > STEAM64_BASE) return { accountId: steamIdToAccountId(m[1]), steamId64: m[1] };
  m = s.match(/^(\d{1,10})$/);
  if (m && Number(m[1]) > 0) return { accountId: Number(m[1]), steamId64: accountIdToSteamId(m[1]) };
  return null;
}

// Короткое имя из ссылки steamcommunity.com/id/<имя>/ (или просто имя).
function vanityOf(input) {
  const s = String(input || '').trim();
  const m = s.match(/steamcommunity\.com\/id\/([A-Za-z0-9_-]{2,64})/i);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{2,64}$/.test(s) && !/^\d+$/.test(s)) return s;
  return null;
}

// Узнаёт SteamID64 по короткому имени: страница профиля отдаёт XML с <steamID64>.
async function resolveVanity(name, fetchImpl = fetch) {
  const url = `https://steamcommunity.com/id/${encodeURIComponent(name)}/?xml=1`;
  const res = await fetchImpl(url, { headers: { Accept: 'text/xml,application/xml' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const text = await res.text();
  const m = text.match(/<steamID64>\s*(\d{17})\s*<\/steamID64>/);
  if (!m) return null;
  return { accountId: steamIdToAccountId(m[1]), steamId64: m[1] };
}

const OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';

function buildLoginUrl(returnTo) {
  const realm = new URL(returnTo).origin;
  const p = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': realm,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `${OPENID_ENDPOINT}?${p.toString()}`;
}

// Разбирает адрес, на который Steam вернул пользователя после входа.
function parseOpenIdReturn(url, expectedReturnTo) {
  const u = new URL(url);
  const params = {};
  for (const [k, v] of u.searchParams) params[k] = v;
  if (params['openid.mode'] !== 'id_res') throw new Error('Вход через Steam отменён');
  if (params['openid.return_to'] !== expectedReturnTo) throw new Error('Неверный адрес возврата от Steam');
  const m = String(params['openid.claimed_id'] || '').match(/^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/);
  if (!m) throw new Error('Steam не вернул ID аккаунта');
  return { steamId64: m[1], params };
}

// Проверка подписи у самого Steam: без неё ответ можно подделать.
async function verifyOpenId(params, fetchImpl = fetch) {
  const body = new URLSearchParams({ ...params, 'openid.mode': 'check_authentication' });
  const res = await fetchImpl(OPENID_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  return /is_valid\s*:\s*true/.test(text);
}

module.exports = { vanityOf, resolveVanity, steamIdToAccountId, accountIdToSteamId, parseSteamInput, buildLoginUrl, parseOpenIdReturn, verifyOpenId, OPENID_ENDPOINT };
