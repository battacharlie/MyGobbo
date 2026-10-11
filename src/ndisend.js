// Uscita in NDI: quello che mostra la finestra di uscita viene inviato in rete
// come sorgente NDI "IGOR - ABit/s" (Windows aggiunge davanti il nome del PC).
//
// I fotogrammi arrivano dalla finestra di uscita solo quando qualcosa cambia;
// l'ultimo viene inviato di continuo ai fotogrammi al secondo dell'uscita
// (al massimo 25), così chi riceve vede un flusso regolare anche con
// un'immagine ferma.
const ndi = require('./ndi');
const { MAX_FPS } = require('./shared/layers');

const NDI_NAME = 'IGOR - ABit/s';

let sender = null;
let win = null;
let tick = null;
let frame = null; // { data, width, height }
let busy = false;
let starting = false;
let wanted = false; // l'utente vuole l'invio attivo (può cambiare durante l'avvio)
let error = null;
let onChange = () => {};

function onFrame(image) {
  const { width, height } = image.getSize();
  if (!width || !height) return;
  frame = { data: image.toBitmap(), width, height };
}

function sendFrame(fps) {
  if (!sender || !frame || busy) return;
  const g = ndi.grandiose;
  busy = true;
  sender.video({
    xres: frame.width,
    yres: frame.height,
    frameRateN: fps * 1000,
    frameRateD: 1000,
    fourCC: g.FOURCC_BGRA,
    pictureAspectRatio: frame.width / frame.height,
    frameFormatType: g.FORMAT_TYPE_PROGRESSIVE,
    lineStrideBytes: frame.width * 4,
    data: frame.data
  }).catch((err) => {
    error = String(err.message || err);
  }).finally(() => {
    busy = false;
  });
}

async function start(displayWin, getFps, changed) {
  if (changed) onChange = changed;
  wanted = true;
  if (sender || starting) return;
  if (!ndi.available) {
    error = ndi.error || 'NDI non disponibile';
    onChange();
    return;
  }
  starting = true;
  error = null;
  try {
    sender = await ndi.grandiose.send({ name: NDI_NAME, clockVideo: false, clockAudio: false });
  } catch (err) {
    error = String(err.message || err);
    starting = false;
    onChange();
    return;
  }
  starting = false;
  if (!wanted || displayWin.isDestroyed()) {
    sender.destroy().catch(() => {});
    sender = null;
    onChange();
    return;
  }
  win = displayWin;
  win.webContents.beginFrameSubscription(false, onFrame);
  win.webContents.invalidate();
  let currentFps = 0;
  let lastConnections = 0;
  let lastCheck = 0;
  const schedule = () => {
    const fps = Math.max(1, Math.min(MAX_FPS, Number(getFps()) || MAX_FPS));
    if (fps === currentFps) return;
    currentFps = fps;
    clearInterval(tick);
    tick = setInterval(() => {
      schedule();
      sendFrame(currentFps);
      // Avvisa la regia quando cambia il numero di ricevitori collegati.
      const now = Date.now();
      if (sender && now - lastCheck > 2000) {
        lastCheck = now;
        const n = sender.connections();
        if (n !== lastConnections) {
          lastConnections = n;
          onChange();
        }
      }
    }, 1000 / fps);
  };
  schedule();
  win.once('closed', () => stop());
  onChange();
}

function stop(changed) {
  if (changed) onChange = changed;
  wanted = false;
  clearInterval(tick);
  tick = null;
  if (win && !win.isDestroyed()) {
    try { win.webContents.endFrameSubscription(); } catch { /* finestra già chiusa */ }
  }
  win = null;
  frame = null;
  const s = sender;
  sender = null;
  if (s) s.destroy().catch(() => {});
  onChange();
}

function status() {
  return {
    on: !!sender,
    name: sender ? (sender.sourcename && sender.sourcename()) || NDI_NAME : NDI_NAME,
    connections: sender && sender.connections ? sender.connections() : 0,
    width: frame ? frame.width : 0,
    height: frame ? frame.height : 0,
    error
  };
}

module.exports = { start, stop, status, NDI_NAME };
