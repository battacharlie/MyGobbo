// Schermo di uscita: mostra la scena in onda e apre le sorgenti video.
//
// Le sorgenti si aprono per tutti gli input, anche quelli delle scene non in
// onda: così il cambio di scena è immediato. Un input ripetuto in più scene
// (o due input con la stessa sorgente) usa una sola sorgente: una sola
// apertura della periferica, una sola ricezione NDI, una sola decodifica del
// video. Ogni comparsa ha solo il proprio riquadro.
const { allLayers, composeLayers, fps, setFps } = Layers;
const sourcesBox = document.getElementById('sources');
const frameMs = () => 1000 / fps();

// --- Periferiche di acquisizione ----------------------------------------------
const streams = new Map(); // deviceId -> { stream, dead }
const captureViews = new Map(); // layerId -> { deviceId, video }

function openStream(deviceId) {
  if (streams.has(deviceId)) return streams.get(deviceId);
  const entry = { stream: null, dead: false };
  streams.set(deviceId, entry);
  const video = {
    deviceId: { exact: deviceId },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: fps(), max: fps() }
  };
  (async () => {
    let stream;
    try {
      // Chromium scarta i fotogrammi in più: il video non supera fps().
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
    } catch (err) {
      if (err.name !== 'OverconstrainedError') throw err;
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...video, frameRate: { ideal: fps() } } });
      await stream.getVideoTracks()[0].applyConstraints({ frameRate: { max: fps() } }).catch(() => {});
    }
    if (entry.dead) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    entry.stream = stream;
    for (const view of captureViews.values()) if (view.deviceId === deviceId) attachStream(view);
  })().catch((err) => console.error('Periferica non disponibile:', err));
  return entry;
}

function attachStream(view) {
  const entry = streams.get(view.deviceId);
  if (!entry || !entry.stream || view.video.srcObject === entry.stream) return;
  view.video.srcObject = entry.stream;
  view.video.play().catch(() => {});
}

function captureView(layer) {
  let view = captureViews.get(layer.id);
  if (view && view.deviceId !== layer.deviceId) {
    view.video.srcObject = null;
    captureViews.delete(layer.id);
    view = null;
  }
  if (!layer.deviceId) return;
  if (!view) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.addEventListener('loadedmetadata', () => stage.relayout());
    video.addEventListener('resize', () => stage.relayout());
    view = { deviceId: layer.deviceId, video };
    captureViews.set(layer.id, view);
  }
  openStream(layer.deviceId);
  attachStream(view);
}

// --- Media: video e immagini dal disco ----------------------------------------
// Le immagini si mostrano così come sono. I video vengono riprodotti fuori
// vista e copiati nel <canvas> di ogni comparsa al massimo fps() volte al
// secondo, come il resto dell'uscita.
const videos = new Map(); // chiave -> { src, video, ready, canvases: Map(layerId -> canvas) }
const images = new Map(); // layerId -> { src, img, ready }

function videoKey(layer) {
  return `${layer.link || layer.id}|${layer.src}`;
}

function openVideo(layer) {
  const key = videoKey(layer);
  let entry = videos.get(key);
  if (!entry) {
    const video = document.createElement('video');
    video.playsInline = true;
    video.preload = 'auto';
    entry = { key, src: layer.src, video, ready: false, alive: true, restartAt: layer.restartAt, canvases: new Map() };
    video.addEventListener('loadedmetadata', () => {
      entry.ready = true;
      for (const c of entry.canvases.values()) sizeCanvas(entry, c);
      drawFrame(entry);
      stage.relayout();
    });
    video.addEventListener('seeked', () => drawFrame(entry));
    video.addEventListener('play', () => startDrawing(entry));
    video.src = layer.src;
    sourcesBox.appendChild(video);
    videos.set(key, entry);
  }
  return entry;
}

function sizeCanvas(entry, canvas) {
  if (canvas.width !== entry.video.videoWidth || canvas.height !== entry.video.videoHeight) {
    canvas.width = entry.video.videoWidth;
    canvas.height = entry.video.videoHeight;
  }
}

// Impostazioni di riproduzione: le copie collegate le condividono.
// onAir: almeno una comparsa del video è in onda (visibile in uscita).
function controlVideo(entry, layer, onAir) {
  const video = entry.video;
  video.loop = !!layer.loop;
  // Audio: sempre, mai, oppure solo quando il video è in onda.
  video.muted = !(layer.audioMode === 'on' || (layer.audioMode === 'follow' && onAir));
  if (entry.restartAt !== layer.restartAt) {
    entry.restartAt = layer.restartAt;
    video.currentTime = 0;
  }
  // Riavvolgi quando esce dall'onda.
  if (layer.playMode === 'restart' && entry.onAir && !onAir) video.currentTime = 0;
  entry.onAir = onAir;
  const shouldPlay = layer.playing && (layer.playMode === 'always' || onAir);
  if (shouldPlay && video.paused && !(video.ended && !layer.loop)) video.play().catch(() => {});
  if (!shouldPlay && !video.paused) video.pause();
}

function drawFrame(entry) {
  if (!entry.ready || entry.video.readyState < 2) return;
  for (const c of entry.canvases.values()) {
    sizeCanvas(entry, c);
    c.getContext('2d', { alpha: false }).drawImage(entry.video, 0, 0, c.width, c.height);
  }
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
    next += frameMs();
    const now = performance.now();
    if (next < now) next = now + frameMs();
    entry.timer = setTimeout(loop, next - now);
  };
  loop();
}

function closeVideo(entry) {
  entry.alive = false;
  clearTimeout(entry.timer);
  entry.video.pause();
  entry.video.removeAttribute('src');
  entry.video.load();
  entry.video.remove();
  videos.delete(entry.key);
}

function openImage(layer) {
  let entry = images.get(layer.id);
  if (entry && entry.src === layer.src) return;
  const img = new Image();
  img.decoding = 'async';
  entry = { src: layer.src, img, ready: false };
  img.addEventListener('load', () => { entry.ready = true; stage.relayout(); });
  img.src = layer.src;
  images.set(layer.id, entry);
}

// --- NDI -----------------------------------------------------------------------
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

// --- Scena ---------------------------------------------------------------------

const stage = createStage(document.getElementById('stage'), {
  // Restituisce l'elemento della sorgente: la scena lo inserisce nel livello
  // e lo posiziona con CSS, senza ridisegnarlo a ogni fotogramma.
  getMedia(layer) {
    if (layer.type === 'capture') {
      const view = captureViews.get(layer.id);
      const v = view && view.video;
      if (v && v.videoWidth > 0) return { el: v, width: v.videoWidth, height: v.videoHeight };
    } else if (layer.type === 'media' && layer.mediaKind === 'image') {
      const entry = images.get(layer.id);
      if (entry && entry.ready && entry.img.naturalWidth > 0) return { el: entry.img, width: entry.img.naturalWidth, height: entry.img.naturalHeight };
    } else if (layer.type === 'media') {
      const entry = videos.get(videoKey(layer));
      const c = entry && entry.canvases.get(layer.id);
      if (entry && entry.ready && c && c.width > 0) return { el: c, width: c.width, height: c.height };
    } else if (layer.type === 'ndi') {
      const c = document.getElementById(ndiCanvasId(layer.id));
      if (c && c.dataset.ready) return { el: c, width: c.width, height: c.height };
    }
    return null;
  }
});

// Apre le sorgenti di tutti gli input e chiude quelle non più usate.
// onAirIds: gli input visibili in uscita in questo momento.
function syncSources(layers, onAirIds) {
  const onAirVideos = new Set(layers.filter((l) => l.type === 'media' && onAirIds.has(l.id)).map(videoKey));
  const devices = new Set();
  const videoKeys = new Set();
  const imageIds = new Set();
  const ndiIds = new Set();
  const ndiList = new Map(); // sorgente -> { source, quality, canvasIds }
  for (const layer of layers) {
    if (layer.type === 'capture') {
      captureView(layer);
      if (layer.deviceId) devices.add(layer.deviceId);
    } else if (layer.type === 'media' && layer.src && layer.mediaKind === 'image') {
      openImage(layer);
      imageIds.add(layer.id);
    } else if (layer.type === 'media' && layer.src) {
      const entry = openVideo(layer);
      if (!videoKeys.has(entry.key)) controlVideo(entry, layer, onAirVideos.has(entry.key));
      videoKeys.add(entry.key);
      if (!entry.canvases.has(layer.id)) {
        const c = document.createElement('canvas');
        entry.canvases.set(layer.id, c);
        if (entry.ready) drawFrame(entry);
      }
    } else if (layer.type === 'ndi') {
      ensureNdiCanvas(layer.id);
      ndiIds.add(layer.id);
      if (layer.source) {
        const key = `${layer.source.name}|${layer.quality}`;
        if (!ndiList.has(key)) ndiList.set(key, { key, source: layer.source, quality: layer.quality, canvasIds: [] });
        ndiList.get(key).canvasIds.push(ndiCanvasId(layer.id));
      }
    }
  }
  const ids = new Set(layers.map((l) => l.id));
  for (const [id, view] of captureViews) {
    if (!ids.has(id)) {
      view.video.srcObject = null;
      captureViews.delete(id);
    }
  }
  for (const [deviceId, entry] of streams) {
    if (devices.has(deviceId)) continue;
    entry.dead = true;
    if (entry.stream) entry.stream.getTracks().forEach((t) => t.stop());
    streams.delete(deviceId);
  }
  for (const entry of [...videos.values()]) {
    if (!videoKeys.has(entry.key)) closeVideo(entry);
    else for (const id of [...entry.canvases.keys()]) if (!ids.has(id) || videoKey(layers.find((l) => l.id === id)) !== entry.key) entry.canvases.delete(id);
  }
  for (const id of [...images.keys()]) if (!imageIds.has(id)) images.delete(id);
  for (const c of [...sourcesBox.querySelectorAll('canvas[id^="ndi-"]')]) {
    if (!ndiIds.has(c.id.slice(4))) c.remove();
  }
  window.ndi.sync([...ndiList.values()], fps());
}

let lastFps = null;

function render(state) {
  document.body.style.background = state.background;
  setFps(state.fps);
  if (lastFps !== null && lastFps !== fps()) {
    // Nuovi fotogrammi al secondo: le periferiche già aperte si adeguano.
    for (const entry of streams.values()) {
      if (entry.stream) entry.stream.getVideoTracks().forEach((t) => t.applyConstraints({ frameRate: { max: fps() } }).catch(() => {}));
    }
  }
  lastFps = fps();
  const t = state.transition;
  const sceneIds = t ? [t.from, t.to].filter(Boolean) : state.program ? [state.program] : [];
  const fades = {};
  if (t) {
    for (const scene of state.layers) {
      if (scene.type !== 'scene') continue;
      const fade = scene.id === t.to ? { from: 0, to: 1 } : scene.id === t.from ? { from: 1, to: 0 } : null;
      if (fade) for (const c of scene.children) fades[c.id] = { ...fade, startedAt: t.startedAt, durationMs: t.durationMs };
    }
  }
  const shown = composeLayers(state.layers, sceneIds);
  syncSources(allLayers(state.layers), new Set(shown.filter((l) => l.visible).map((l) => l.id)));
  stage.update(shown, state.background, fades);
}

window.countdown.onState(render);
window.countdown.getState().then(render);
