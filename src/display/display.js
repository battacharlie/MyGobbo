// Schermo di uscita: mostra i livelli visibili e apre le sorgenti video.
const sourcesBox = document.getElementById('sources');
const captures = new Map(); // layerId -> { deviceId, video, stream }

function ndiCanvasId(layerId) {
  return `ndi-${layerId}`;
}

function ensureNdiCanvas(layerId) {
  let canvas = document.getElementById(ndiCanvasId(layerId));
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = ndiCanvasId(layerId);
    // Il preload segnala quando cambia la risoluzione del flusso NDI.
    canvas.addEventListener('ndi-resize', () => stage.relayout());
    sourcesBox.appendChild(canvas);
  }
  return canvas;
}

async function openCapture(layer) {
  const current = captures.get(layer.id);
  if (current && current.deviceId === layer.deviceId) return;
  closeCapture(layer.id);
  if (!layer.deviceId) return;
  const entry = { deviceId: layer.deviceId, video: document.createElement('video'), stream: null };
  entry.video.addEventListener('loadedmetadata', () => stage.relayout());
  entry.video.addEventListener('resize', () => stage.relayout());
  captures.set(layer.id, entry);
  try {
    const video = {
      deviceId: { exact: layer.deviceId },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: Layers.MAX_FPS, max: Layers.MAX_FPS }
    };
    let stream;
    try {
      // Chromium scarta i fotogrammi in più: il video non supera MAX_FPS.
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
    } catch (err) {
      if (err.name !== 'OverconstrainedError') throw err;
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...video, frameRate: { ideal: Layers.MAX_FPS } } });
      await stream.getVideoTracks()[0].applyConstraints({ frameRate: { max: Layers.MAX_FPS } }).catch(() => {});
    }
    if (captures.get(layer.id) !== entry) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    entry.stream = stream;
    entry.video.muted = true;
    entry.video.srcObject = stream;
    await entry.video.play();
  } catch (err) {
    console.error('Periferica non disponibile:', err);
  }
}

function closeCapture(layerId) {
  const entry = captures.get(layerId);
  if (!entry) return;
  if (entry.stream) entry.stream.getTracks().forEach((t) => t.stop());
  entry.video.srcObject = null;
  captures.delete(layerId);
}

// --- Media: video e immagini dal disco ----------------------------------------
// Le immagini si mostrano così come sono. I video vengono riprodotti fuori
// vista e copiati in un <canvas> al massimo MAX_FPS volte al secondo, come
// il resto dell'uscita.
const medias = new Map(); // layerId -> { src, el, canvas?, video?, ... }
const FRAME_MS = 1000 / Layers.MAX_FPS;

function openMedia(layer) {
  let entry = medias.get(layer.id);
  if (entry && entry.src !== layer.src) {
    closeMedia(layer.id);
    entry = null;
  }
  if (!layer.src) return;
  if (!entry) {
    entry = { src: layer.src, kind: layer.mediaKind, restartAt: layer.restartAt, ready: false, alive: true };
    if (layer.mediaKind === 'image') {
      const img = new Image();
      img.decoding = 'async';
      img.addEventListener('load', () => { entry.ready = true; stage.relayout(); });
      img.src = layer.src;
      entry.el = img;
    } else {
      const video = document.createElement('video');
      video.playsInline = true;
      video.preload = 'auto';
      const canvas = document.createElement('canvas');
      entry.video = video;
      entry.el = canvas;
      entry.ctx = canvas.getContext('2d', { alpha: false });
      video.addEventListener('loadedmetadata', () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        entry.ready = true;
        drawFrame(entry);
        stage.relayout();
      });
      video.addEventListener('seeked', () => drawFrame(entry));
      video.addEventListener('play', () => startDrawing(entry));
      video.src = layer.src;
      sourcesBox.appendChild(video);
    }
    medias.set(layer.id, entry);
  }
  const video = entry.video;
  if (!video) return;
  video.loop = !!layer.loop;
  video.muted = !layer.audio;
  if (entry.restartAt !== layer.restartAt) {
    entry.restartAt = layer.restartAt;
    video.currentTime = 0;
  }
  if (layer.playing && video.paused && !(video.ended && !layer.loop)) video.play().catch(() => {});
  if (!layer.playing && !video.paused) video.pause();
}

function drawFrame(entry) {
  if (entry.ready && entry.video.readyState >= 2) entry.ctx.drawImage(entry.video, 0, 0, entry.el.width, entry.el.height);
}

function startDrawing(entry) {
  if (entry.drawing) return;
  entry.drawing = true;
  let next = performance.now();
  const loop = () => {
    const v = entry.video;
    if (!entry.alive) { entry.drawing = false; return; }
    if (v.paused || v.ended) { drawFrame(entry); entry.drawing = false; return; }
    drawFrame(entry);
    next += FRAME_MS;
    const now = performance.now();
    if (next < now) next = now + FRAME_MS;
    entry.timer = setTimeout(loop, next - now);
  };
  loop();
}

function closeMedia(layerId) {
  const entry = medias.get(layerId);
  if (!entry) return;
  entry.alive = false;
  clearTimeout(entry.timer);
  if (entry.video) {
    entry.video.pause();
    entry.video.removeAttribute('src');
    entry.video.load();
    entry.video.remove();
  }
  medias.delete(layerId);
}

function releaseSources(layerId) {
  closeCapture(layerId);
  closeMedia(layerId);
  window.ndi.detach(layerId);
  const canvas = document.getElementById(ndiCanvasId(layerId));
  if (canvas) canvas.remove();
}

const stage = createStage(document.getElementById('stage'), {
  // Restituisce l'elemento della sorgente: la scena lo inserisce nel livello
  // e lo posiziona con CSS, senza ridisegnarlo a ogni fotogramma.
  getMedia(layer) {
    if (layer.type === 'capture') {
      const entry = captures.get(layer.id);
      const v = entry && entry.video;
      if (v && v.videoWidth > 0) return { el: v, width: v.videoWidth, height: v.videoHeight };
    } else if (layer.type === 'media') {
      const entry = medias.get(layer.id);
      if (entry && entry.ready) {
        const el = entry.el;
        const w = entry.kind === 'image' ? el.naturalWidth : el.width;
        const h = entry.kind === 'image' ? el.naturalHeight : el.height;
        if (w > 0 && h > 0) return { el, width: w, height: h };
      }
    } else if (layer.type === 'ndi') {
      const c = document.getElementById(ndiCanvasId(layer.id));
      if (c && c.dataset.ready) return { el: c, width: c.width, height: c.height };
    }
    return null;
  },
  onRemove: releaseSources
});

function render(state) {
  document.body.style.background = state.background;
  stage.update(state.layers, state.background);
  for (const layer of state.layers) {
    // Le sorgenti restano aperte anche quando il livello è nascosto, così
    // ricompare subito quando lo si rimette in onda.
    if (layer.type === 'capture') openCapture(layer);
    if (layer.type === 'media') openMedia(layer);
    if (layer.type === 'ndi') {
      ensureNdiCanvas(layer.id);
      window.ndi.attach(layer.id, layer.source, layer.quality, ndiCanvasId(layer.id));
    }
  }
}

window.countdown.onState(render);
window.countdown.getState().then(render);
