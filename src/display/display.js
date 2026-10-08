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

function releaseSources(layerId) {
  closeCapture(layerId);
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
    if (layer.type === 'ndi') {
      ensureNdiCanvas(layer.id);
      window.ndi.attach(layer.id, layer.source, layer.quality, ndiCanvasId(layer.id));
    }
  }
}

window.countdown.onState(render);
window.countdown.getState().then(render);
