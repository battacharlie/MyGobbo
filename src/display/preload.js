const { contextBridge, ipcRenderer } = require('electron');
const ndi = require('../ndi');
const { MAX_FPS, DEFAULT_FPS } = require('../shared/layers');
let fps = DEFAULT_FPS;

// I fotogrammi NDI vengono ricevuti qui e disegnati direttamente in un
// <canvas> della pagina (il DOM è condiviso con la pagina), così le immagini
// non passano dal processo principale.
// Una sola ricezione per sorgente, anche se compare in più scene: ogni
// fotogramma viene disegnato nel canvas di ogni comparsa.
const receivers = new Map(); // sorgente|qualità -> { active, canvasIds }

// Come il resto dell'uscita, NDI non supera i fotogrammi al secondo scelti
// (quelli del monitor o meno, se scelti): quelli in più vengono scartati senza disegnarli.

// Conversione dei colori sulla scheda video. NDI trasporta le immagini in
// UYVY (2 byte per pixel): le riceviamo così, senza far convertire al
// processore, e le carichiamo sulla scheda video com'è. Un piccolo programma
// WebGL le trasforma in RGB mentre le disegna. Rispetto a RGBA i dati da
// copiare e caricare sono la metà e il processore non converte nulla.
// Le sorgenti con trasparenza arrivano in BGRA e vengono solo riordinate.
// Se WebGL 2 non c'è, si torna al metodo di prima (RGBA + putImageData).
const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D frame;
uniform int mode;   // 0 = UYVY, 1 = BGRA
uniform int height;
uniform int hd;     // 1 = BT.709 (HD), 0 = BT.601 (SD)
out vec4 color;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  p.y = height - 1 - p.y;
  if (mode == 1) {
    vec4 t = texelFetch(frame, p, 0);
    color = vec4(t.b, t.g, t.r, 1.0);
    return;
  }
  // Ogni texel contiene due pixel: U, Y0, V, Y1.
  vec4 t = texelFetch(frame, ivec2(p.x >> 1, p.y), 0);
  float y = ((p.x & 1) == 0 ? t.g : t.a) * 255.0;
  y = (y - 16.0) / 219.0;
  float u = (t.r * 255.0 - 128.0) / 224.0;
  float v = (t.b * 255.0 - 128.0) / 224.0;
  vec3 rgb = hd == 1
    ? vec3(y + 1.5748 * v, y - 0.1873 * u - 0.4681 * v, y + 1.8556 * u)
    : vec3(y + 1.402 * v, y - 0.344136 * u - 0.714136 * v, y + 1.772 * u);
  color = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

// Un convertitore per sorgente: disegna in un canvas fuori pagina, da cui
// i canvas delle comparse copiano (copia interna alla scheda video).
function createGpuConverter() {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const canvas = new OffscreenCanvas(16, 16);
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  let program;
  try {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  } catch (err) {
    console.error('Conversione NDI su scheda video non disponibile:', err);
    return null;
  }
  gl.useProgram(program);
  const loc = {
    mode: gl.getUniformLocation(program, 'mode'),
    height: gl.getUniformLocation(program, 'height'),
    hd: gl.getUniformLocation(program, 'hd')
  };
  gl.uniform1i(gl.getUniformLocation(program, 'frame'), 0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  let texW = 0;
  let texH = 0;
  return {
    canvas,
    get lost() { return gl.isContextLost(); },
    // Libera subito il contesto WebGL (Chromium ne tiene pochi aperti).
    destroy() {
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    },
    // Restituisce false se il formato del fotogramma non è gestito.
    draw(frame, g) {
      const { xres, yres, lineStrideBytes, data, fourCC } = frame;
      let mode;
      let w;
      if (fourCC === g.FOURCC_UYVY) { mode = 0; w = xres >> 1; }
      else if (fourCC === g.FOURCC_BGRA || fourCC === g.FOURCC_BGRX) { mode = 1; w = xres; }
      else return false;
      if (canvas.width !== xres || canvas.height !== yres) {
        canvas.width = xres;
        canvas.height = yres;
      }
      gl.viewport(0, 0, xres, yres);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, lineStrideBytes / 4);
      const pixels = new Uint8Array(data.buffer, data.byteOffset, lineStrideBytes * yres);
      if (w !== texW || yres !== texH) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, yres, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        texW = w;
        texH = yres;
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, yres, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      }
      gl.uniform1i(loc.mode, mode);
      gl.uniform1i(loc.height, yres);
      gl.uniform1i(loc.hd, yres >= 720 ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    }
  };
}

let gpuOk = null; // si verifica una volta sola se WebGL 2 funziona
function gpuAvailable() {
  if (gpuOk === null) {
    const test = createGpuConverter();
    gpuOk = !!test;
    if (test) test.destroy();
  }
  return gpuOk;
}

// Copia i pixel RGBA (metodo di riserva) togliendo l'eventuale spazio a fine riga.
function rgbaImage(frame) {
  const { xres, yres, lineStrideBytes, data } = frame;
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
  return new ImageData(pixels, xres, yres);
}

async function receiveLoop(entry, source, quality) {
  const g = ndi.grandiose;
  const useGpu = gpuAvailable();
  let gpu = useGpu ? createGpuConverter() : null;
  let receiver;
  try {
    receiver = await g.receive({
      source,
      colorFormat: useGpu ? g.COLOR_FORMAT_UYVY_BGRA : g.COLOR_FORMAT_RGBX_RGBA,
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
    nextDue = Math.max(nextDue + 1000 / fps, now);
    const { xres, yres } = frame;
    const canvases = entry.canvasIds.map((id) => document.getElementById(id)).filter(Boolean);
    if (!canvases.length) continue;
    if (useGpu && (!gpu || gpu.lost)) {
      if (gpu) gpu.destroy();
      gpu = createGpuConverter();
    }
    // Sulla scheda video: un solo caricamento, poi ogni comparsa copia.
    const onGpu = useGpu && gpu && gpu.draw(frame, g);
    if (useGpu && !onGpu) continue; // formato inatteso o scheda video non pronta
    const image = onGpu ? null : rgbaImage(frame);
    canvases.forEach((canvas, i) => {
      const resized = canvas.width !== xres || canvas.height !== yres;
      if (resized) {
        canvas.width = xres;
        canvas.height = yres;
      }
      // alpha: false ignora il quarto byte (X) di RGBX e rende più veloce il disegno.
      const ctx = canvas.getContext('2d', { alpha: false });
      if (onGpu) ctx.drawImage(gpu.canvas, 0, 0);
      // Il primo canvas riceve i pixel, gli altri copiano dal primo (lavoro della scheda video).
      else if (i === 0) ctx.putImageData(image, 0, 0);
      else ctx.drawImage(canvases[0], 0, 0);
      if (resized || !canvas.dataset.ready) {
        canvas.dataset.ready = '1';
        canvas.dispatchEvent(new Event('ndi-resize'));
      }
    });
  }
  if (gpu) gpu.destroy();
}

contextBridge.exposeInMainWorld('countdown', {
  getState: () => ipcRenderer.invoke('get-state'),
  onState: (cb) => ipcRenderer.on('state', (_evt, state) => cb(state))
});

contextBridge.exposeInMainWorld('ndi', {
  // Elenco completo delle sorgenti da ricevere: [{ key, source, quality, canvasIds }].
  // Avvia quelle nuove, ferma quelle non più usate, aggiorna i canvas.
  sync(list, outputFps) {
    fps = Math.max(1, Math.min(MAX_FPS, Number(outputFps) || DEFAULT_FPS));
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
