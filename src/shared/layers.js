// Funzioni condivise tra processo principale e finestre (caricato come <script>
// nelle finestre e con require() nel processo principale).
(function (root) {
  const TYPE_LABELS = {
    ndi: 'NDI',
    capture: 'Acquisizione',
    timer: 'Timer',
    ticker: 'Frase'
  };

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
      case 'timer':
        Object.assign(base, {
          x: 30, y: 30, w: 40, h: 40,
          direction: 'down',
          durationSec: 10 * 60,
          fontSize: 20, // in % dell'altezza dello schermo
          fontFamily: 'Segoe UI',
          bold: true,
          color: '#ffffff',
          background: '#000000',
          transparent: false,
          warningSec: 60,
          warningColor: '#ffb020',
          endColor: '#ff3b30',
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

  // Formatta come MM:SS, o H:MM:SS oltre l'ora; il segno meno indica il tempo
  // oltre la scadenza.
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
    return (negative && total > 0 ? '−' : '') + body;
  }

  function timerColor(layer, valueMs) {
    if (layer.direction === 'up') return layer.color;
    if (valueMs <= 0) return layer.endColor;
    if (valueMs <= layer.warningSec * 1000) return layer.warningColor;
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

  const api = { TYPE_LABELS, newId, createLayer, timerElapsedMs, timerValueMs, formatTime, timerColor, videoRects, hexToRgba };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Layers = api;
})(typeof window !== 'undefined' ? window : globalThis);
