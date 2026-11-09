'use strict';
// Вход через Steam: открываем официальную страницу входа Steam в отдельном окне.
// Пароль вводится только на сайте Steam — приложение его не видит.
// После входа Steam перенаправляет на localhost; мы перехватываем этот адрес,
// не поднимая сервер, и проверяем подпись у самого Steam.

const { BrowserWindow, session } = require('electron');
const { buildLoginUrl, parseOpenIdReturn, verifyOpenId, steamIdToAccountId } = require('./steamIds');

const RETURN_TO = 'http://localhost:47821/auth';

function loginWithSteam(parent) {
  return new Promise((resolve, reject) => {
    const ses = session.fromPartition('steam-login'); // без сохранения куки на диск
    const win = new BrowserWindow({
      width: 820,
      height: 760,
      parent,
      modal: !!parent,
      title: 'Вход через Steam',
      autoHideMenuBar: true,
      backgroundColor: '#171a21',
      webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    let done = false;

    const finish = async (url) => {
      if (done) return;
      done = true;
      ses.webRequest.onBeforeRequest(null);
      try {
        const { steamId64, params } = parseOpenIdReturn(url, RETURN_TO);
        const ok = await verifyOpenId(params);
        if (!ok) throw new Error('Steam не подтвердил вход');
        resolve({ steamId64, accountId: steamIdToAccountId(steamId64) });
      } catch (e) {
        reject(e);
      } finally {
        if (!win.isDestroyed()) win.close();
      }
    };

    ses.webRequest.onBeforeRequest({ urls: ['http://localhost:47821/*'] }, (details, cb) => {
      cb({ cancel: true });
      finish(details.url);
    });

    win.on('closed', () => {
      if (!done) {
        done = true;
        ses.webRequest.onBeforeRequest(null);
        reject(new Error('Окно входа закрыто'));
      }
    });

    // Внешние ссылки со страницы Steam не открываем внутри окна входа.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.loadURL(buildLoginUrl(RETURN_TO));
  });
}

module.exports = { loginWithSteam };
