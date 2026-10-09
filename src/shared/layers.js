// Funzioni condivise tra processo principale e finestre (caricato come <script>
// nelle finestre e con require() nel processo principale).
(function (root) {
  // Fotogrammi al secondo massimi di tutto ciò che compare in uscita.
  const MAX_FPS = 25;

  const TYPE_LABELS = {
    ndi: 'NDI',
    capture: 'Acquisizione',
    timer: 'Timer',
    ticker: 'Frase',
    media: 'Media'
  };

  // Colori predefiniti del timer: partenza, scadenza vicina, tempo superato.
  const TIMER_COLORS = { color: '#22c55e', warningColor: '#facc15', endColor: '#ef4444' };

  // Video e immagini che si possono aggiungere come elemento Media.
  const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv'];
  const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];

  // Tipi che mostrano una sorgente video o immagine (con ritaglio e adattamento).
  function isVisual(type) {
    return type === 'ndi' || type === 'capture' || type === 'media';
  }

  function newId() {
    return Math.random().toString(36).slice(2, 10);
  }

  // Valori iniziali di ogni tipo di elemento. Posizione, misure e crop sono
  // in percentuale dello schermo di uscita / della sorgente.
  function createLayer(type, extra = {}) {
    const base = {
      id: newId(),
      type,
      name: TYPE_LABELS[type] || type,
      visible: true,
      x: 0, y: 0, w: 100, h: 100,
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      fit: 'contain' // contain = adatta, cover = riempi, stretch = deforma
    };
    switch (type) {
      case 'ndi':
        Object.assign(base, { source: null, quality: 'high' });
        break;
      case 'capture':
        Object.assign(base, { deviceId: '', deviceLabel: '' });
        break;
      case 'media':
        // file: percorso sul disco; src: lo stesso come indirizzo file://
        Object.assign(base, { file: '', src: '', mediaKind: 'video', loop: true, audio: false, playing: true, restartAt: 0 });
        break;
      case 'timer':
        Object.assign(base, {
          x: 30, y: 30, w: 40, h: 40,
          direction: 'down',
          durationSec: 10 * 60,
          fontSize: 20, // in % dell'altezza dello schermo
          fontFamily: 'Segoe UI',
          bold: true,
          ...TIMER_COLORS,
          background: '#000000',
          transparent: false,
          warningSec: 60,
          // A tempo superato: numeri lampeggianti e cornice che corre lungo
          // i bordi dello schermo.
          blink: true,
          frame: true,
          frameColor: '#ef4444',
          frameWidth: 12, // pixel su uno schermo alto 1080
          run: { running: false, baseMs: 0, startedAt: 0 }
        });
        break;
      case 'ticker':
        Object.assign(base, {
          x: 0, y: 86, w: 100, h: 14,
          text: 'Scrivi qui la frase da mostrare in sovraimpressione',
          fontSize: 7,
          fontFamily: 'Segoe UI',
          bold: true,
          color: '#ffffff',
          background: '#000000',
          transparent: false,
          opacity: 0.75,
          speed: 120 // pixel al secondo
        });
        break;
    }
    return Object.assign(base, extra);
  }

  // Millisecondi trascorsi dall'avvio del timer, considerando le pause.
  function timerElapsedMs(layer, now = Date.now()) {
    const r = layer.run;
    return r.baseMs + (r.running ? now - r.startedAt : 0);
  }

  // Valore da mostrare: tempo rimanente (all'indietro, può andare sotto zero)
  // oppure tempo trascorso (in avanti).
  function timerValueMs(layer, now = Date.now()) {
    const elapsed = timerElapsedMs(layer, now);
    return layer.direction === 'up' ? elapsed : layer.durationSec * 1000 - elapsed;
  }

  // Tempo oltre il limite: all'indietro quando il conto arriva a zero, in
  // avanti quando il cronometro raggiunge la durata.
  // Lampeggio e cornice compaiono solo quando il tempo è scaduto davvero:
  // serve che il timer sia partito (un timer azzerato non lampeggia mai).
  function timerOvertime(layer, valueMs) {
    if (!(timerElapsedMs(layer) > 0)) return false;
    return layer.direction === 'up' ? layer.durationSec > 0 && valueMs >= layer.durationSec * 1000 : valueMs <= 0;
  }

  // Formatta come MM:SS, o H:MM:SS oltre l'ora; all'indietro il segno più
  // indica il tempo passato oltre la scadenza.
  function formatTime(ms, direction = 'down') {
    const negative = ms < 0;
    // All'indietro arrotonda per eccesso (si vede 00:00 solo a zero),
    // in avanti per difetto (si vede 00:01 dopo un secondo pieno).
    const abs = Math.abs(ms) / 1000;
    const total = negative || direction === 'up' ? Math.floor(abs) : Math.ceil(abs);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    const body = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    return (negative && total > 0 ? '+' : '') + body;
  }

  // Tre colori: alla partenza, negli ultimi secondi prima del limite e
  // oltre il limite (all'indietro il limite è lo zero, in avanti la durata).
  function timerColor(layer, valueMs) {
    const remaining = layer.direction === 'up' ? layer.durationSec * 1000 - valueMs : valueMs;
    if (layer.direction === 'up' && !(layer.durationSec > 0)) return layer.color;
    if (remaining <= 0) return layer.endColor;
    if (remaining <= layer.warningSec * 1000) return layer.warningColor;
    return layer.color;
  }

  // Rettangoli sorgente/destinazione per disegnare un video ritagliato
  // dentro un riquadro di misure boxW×boxH, secondo la modalità fit.
  function videoRects(srcW, srcH, crop, fit, boxW, boxH) {
    const sx = srcW * crop.left / 100;
    const sy = srcH * crop.top / 100;
    const sw = Math.max(1, srcW * (1 - (crop.left + crop.right) / 100));
    const sh = Math.max(1, srcH * (1 - (crop.top + crop.bottom) / 100));
    if (fit === 'stretch') return { sx, sy, sw, sh, dx: 0, dy: 0, dw: boxW, dh: boxH };
    const scale = fit === 'cover'
      ? Math.max(boxW / sw, boxH / sh)
      : Math.min(boxW / sw, boxH / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    return { sx, sy, sw, sh, dx: (boxW - dw) / 2, dy: (boxH - dh) / 2, dw, dh };
  }

  function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  const api = { MAX_FPS, TYPE_LABELS, TIMER_COLORS, VIDEO_EXT, IMAGE_EXT, isVisual, newId, createLayer, timerElapsedMs, timerValueMs, timerOvertime, formatTime, timerColor, videoRects, hexToRgba };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Layers = api;
})(typeof window !== 'undefined' ? window : globalThis);
