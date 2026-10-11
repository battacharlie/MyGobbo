const { contextBridge, ipcRenderer } = require('electron');
const ndi = require('../ndi');
const { MAX_FPS } = require('../shared/layers');

// I fotogrammi NDI vengono ricevuti qui e disegnati direttamente in un
// <canvas> della pagina (il DOM è condiviso con la pagina), così le immagini
// non passano dal processo principale.
// Una sola ricezione per sorgente, anche se compare in più scene: ogni
// fotogramma viene disegnato nel canvas di ogni comparsa.
const receivers = new Map(); // sorgente|qualità -> { active, canvasIds }

// Come il resto dell'uscita, NDI non supera i 25 fps: i fotogrammi in più
// vengono scartati senza disegnarli.
const FRAME_MS = 1000 / MAX_FPS;

async function receiveLoop(entry, source, quality) {
  const g = ndi.grandiose;
  let receiver;
  try {
    receiver = await g.receive({
      source,
      colorFormat: g.COLOR_FORMAT_RGBX_RGBA,
      bandwidth: quality === 'low' ? g.BANDWIDTH_LOWEST : g.BANDWIDTH_HIGHEST,
      allowVideoFields: false,
      name: 'IGOR - ABit/s'
    });
  } catch (err) {
    console.error('Ricezione NDI non avviata:', err);
    return;
  }
  let nextDue = 0;
  while (entry.active) {
    let frame;
    try {
      frame = await receiver.video(1000);
    } catch {
      continue; // nessun fotogramma entro il timeout: riprova
    }
    if (!entry.active) break;
    const now = performance.now();
    // Piccola tolleranza per non perdere fotogrammi di una sorgente a 25 fps.
    if (now < nextDue - 3) continue;
    nextDue = Math.max(nextDue + FRAME_MS, now);
    const { xres, yres, lineStrideBytes, data } = frame;
    const canvases = entry.canvasIds.map((id) => document.getElementById(id)).filter(Boolean);
    if (!canvases.length) continue;
    const rowBytes = xres * 4;
    let pixels;
    if (lineStrideBytes === rowBytes) {
      // Usa direttamente la memoria del fotogramma, senza copiarla.
      pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, rowBytes * yres);
    } else {
      pixels = new Uint8ClampedArray(rowBytes * yres);
      for (let y = 0; y < yres; y++) {
        pixels.set(data.subarray(y * lineStrideBytes, y * lineStrideBytes + rowBytes), y * rowBytes);
      }
    }
    const image = new ImageData(pixels, xres, yres);
    canvases.forEach((canvas, i) => {
      const resized = canvas.width !== xres || canvas.height !== yres;
      if (resized) {
        canvas.width = xres;
        canvas.height = yres;
      }
      // alpha: false ignora il quarto byte (X) di RGBX e rende più veloce il disegno.
      const ctx = canvas.getContext('2d', { alpha: false });
      // Il primo canvas riceve i pixel, gli altri copiano dal primo (lavoro della scheda video).
      if (i === 0) ctx.putImageData(image, 0, 0);
      else ctx.drawImage(canvases[0], 0, 0);
      if (resized || !canvas.dataset.ready) {
        canvas.dataset.ready = '1';
        canvas.dispatchEvent(new Event('ndi-resize'));
      }
    });
  }
}

contextBridge.exposeInMainWorld('countdown', {
  getState: () => ipcRenderer.invoke('get-state'),
  onState: (cb) => ipcRenderer.on('state', (_evt, state) => cb(state))
});

contextBridge.exposeInMainWorld('ndi', {
  // Elenco completo delle sorgenti da ricevere: [{ key, source, quality, canvasIds }].
  // Avvia quelle nuove, ferma quelle non più usate, aggiorna i canvas.
  sync(list) {
    const keys = new Set();
    for (const item of list) {
      keys.add(item.key);
      const current = receivers.get(item.key);
      if (current) {
        current.canvasIds = item.canvasIds;
        continue;
      }
      if (!ndi.available || !item.source) continue;
      const entry = { active: true, canvasIds: item.canvasIds };
      receivers.set(item.key, entry);
      receiveLoop(entry, item.source, item.quality);
    }
    for (const [key, entry] of receivers) {
      if (keys.has(key)) continue;
      entry.active = false;
      receivers.delete(key);
    }
  }
});
