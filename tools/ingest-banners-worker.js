'use strict';
// Рабочая часть приёма баннеров. Запускается скриптом tools/ingest-banners.js внутри Electron (своего окна не показывает):
// читает картинки, проверяет прозрачность по краям, при необходимости уменьшает и пересохраняет в webp.
// Электрон нужен только потому, что в нём уже есть кодеки изображений, отдельных программ ставить не надо.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');

const jobFile = process.argv[process.argv.length - 1];
const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
app.disableHardwareAcceleration();

const PAGE = `(async (files, maxW, targetBytes) => {
  const out = [];
  for (const f of files) {
    try {
      const img = new Image();
      img.src = f.url;
      await img.decode();
      const w = img.naturalWidth, h = img.naturalHeight;
      const scale = w > maxW ? maxW / w : 1;
      const W = Math.round(w * scale), H = Math.round(h * scale);
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, W, H);
      const px = ctx.getImageData(0, 0, W, H).data;
      let any = false, left = 0, leftN = 0, right = 0, rightN = 0;
      const strip = Math.max(2, Math.floor(W * 0.05));
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const a = px[(y * W + x) * 4 + 3];
          if (a < 250) any = true;
          if (x < strip) { left += a; leftN++; }
          if (x >= W - strip) { right += a; rightN++; }
        }
      }
      let blob = null, q = 0.86;
      for (const quality of [0.86, 0.8, 0.74, 0.68, 0.62]) {
        q = quality;
        blob = await new Promise((r) => cv.toBlob(r, 'image/webp', quality));
        if (blob && blob.size <= targetBytes) break;
      }
      if (!blob) throw new Error('не удалось сохранить в webp');
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      out.push({ name: f.name, ok: true, w, h, W, H, hasAlpha: any, leftAlpha: left / leftN / 255, rightAlpha: right / rightN / 255, bytes: buf.length, q, b64: btoa(bin) });
    } catch (e) {
      out.push({ name: f.name, ok: false, error: String(e && e.message || e) });
    }
  }
  return out;
})`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { webSecurity: false, contextIsolation: false, nodeIntegration: false } });
  await win.loadURL('about:blank');
  const results = await win.webContents.executeJavaScript(`${PAGE}(${JSON.stringify(job.files)}, ${job.maxWidth}, ${job.targetBytes})`);
  fs.mkdirSync(job.tmpDir, { recursive: true });
  for (const r of results) {
    if (r.ok) { fs.writeFileSync(`${job.tmpDir}/${r.name}.webp`, Buffer.from(r.b64, 'base64')); delete r.b64; }
  }
  fs.writeFileSync(job.reportFile, JSON.stringify(results, null, 1));
  app.quit();
}).catch((e) => { fs.writeFileSync(job.reportFile, JSON.stringify({ fatal: String(e && e.stack || e) })); app.quit(); });
