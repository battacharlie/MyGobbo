const { contextBridge, ipcRenderer } = require('electron');
const ndi = require('../ndi');
const { MAX_FPS } = require('../shared/layers');

// I fotogrammi NDI vengono ricevuti qui e disegnati direttamente in un
// <canvas> della pagina (il DOM è condiviso con la pagina), così le immagini
// non passano dal processo principale.
const receivers = new Map(); // layerId -> { key, active }

// Come il resto dell'uscita, NDI non supera i 25 fps: i fotogrammi in più
// vengono scartati senza disegnarli.
const FRAME_MS = 1000 / MAX_FPS;

async function receiveLoop(entry, source, quality, canvasId) {
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
    const canvas = document.getElementById(canvasId);
    if (!canvas) continue;
    const { xres, yres, lineStrideBytes, data } = frame;
    const resized = canvas.width !== xres || canvas.height !== yres;
    if (resized) {
      canvas.width = xres;
      canvas.height = yres;
    }
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
    // alpha: false ignora il quarto byte (X) di RGBX e rende più veloce il disegno.
    canvas.getContext('2d', { alpha: false }).putImageData(new ImageData(pixels, xres, yres), 0, 0);
    if (resized || !canvas.dataset.ready) {
      canvas.dataset.ready = '1';
      canvas.dispatchEvent(new Event('ndi-resize'));
    }
  }
}

contextBridge.exposeInMainWorld('countdown', {
  getState: () => ipcRenderer.invoke('get-state'),
  onState: (cb) => ipcRenderer.on('state', (_evt, state) => cb(state))
});

contextBridge.exposeInMainWorld('ndi', {
  // Avvia (o cambia) la ricezione di una sorgente per un livello.
  attach(layerId, source, quality, canvasId) {
    const key = `${source && source.name}|${quality}`;
    const current = receivers.get(layerId);
    if (current && current.key === key) return;
    if (current) current.active = false;
    if (!ndi.available || !source) {
      receivers.delete(layerId);
      return;
    }
    const entry = { key, active: true };
    receivers.set(layerId, entry);
    receiveLoop(entry, source, quality, canvasId);
  },
  detach(layerId) {
    const current = receivers.get(layerId);
    if (current) current.active = false;
    receivers.delete(layerId);
  }
});
