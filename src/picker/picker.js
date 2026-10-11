// Finestra del contagocce: mostra la foto di uno schermo (o un'immagine) e
// restituisce il colore del punto cliccato. La lente ingrandisce i pixel
// intorno al puntatore.
const view = document.getElementById('view');
const ctx = view.getContext('2d');
const loupe = document.getElementById('loupe');
const lctx = loupe.querySelector('canvas').getContext('2d');
const bar = document.getElementById('bar');
// La barra si sposta in basso con il tasto B per prelevare anche sotto di lei.
let images = [];
let current = null; // { width, height, data, img }
let fit = { scale: 1, x: 0, y: 0 };

function hex(r, g, b) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function show(index) {
  const item = images[index];
  if (!item.loaded) {
    const img = await loadImage(item.url);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    item.loaded = { img, width: c.width, height: c.height, data: cx.getImageData(0, 0, c.width, c.height).data };
  }
  current = item.loaded;
  for (const [i, b] of [...document.querySelectorAll('#sources button')].entries()) b.classList.toggle('on', i === index);
  draw();
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  view.width = Math.round(innerWidth * dpr);
  view.height = Math.round(innerHeight * dpr);
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, view.width, view.height);
  if (!current) return;
  // La foto dello schermo è già alla risoluzione reale: a scala 1 coincide
  // con lo schermo. Le immagini più grandi vengono rimpicciolite.
  const scale = Math.min(view.width / current.width, view.height / current.height, 1);
  const w = current.width * scale;
  const h = current.height * scale;
  fit = { scale: scale / dpr, x: (view.width - w) / 2 / dpr, y: (view.height - h) / 2 / dpr };
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(current.img, (view.width - w) / 2, (view.height - h) / 2, w, h);
}

function pixelAt(clientX, clientY) {
  if (!current) return null;
  const x = Math.floor((clientX - fit.x) / fit.scale);
  const y = Math.floor((clientY - fit.y) / fit.scale);
  if (x < 0 || y < 0 || x >= current.width || y >= current.height) return null;
  return { x, y };
}

function colorAt(x, y) {
  const i = (y * current.width + x) * 4;
  const d = current.data;
  return hex(d[i], d[i + 1], d[i + 2]);
}

window.addEventListener('mousemove', (e) => {
  const p = !bar.contains(e.target) && pixelAt(e.clientX, e.clientY);
  if (!p) {
    loupe.style.display = 'none';
    return;
  }
  const img = lctx.createImageData(11, 11);
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
      const x = Math.min(current.width - 1, Math.max(0, p.x + dx));
      const y = Math.min(current.height - 1, Math.max(0, p.y + dy));
      const s = (y * current.width + x) * 4;
      const t = ((dy + 5) * 11 + dx + 5) * 4;
      img.data.set(current.data.subarray(s, s + 3), t);
      img.data[t + 3] = 255;
    }
  }
  lctx.putImageData(img, 0, 0);
  const color = colorAt(p.x, p.y);
  loupe.querySelector('b').textContent = color;
  loupe.querySelector('i').style.background = color;
  loupe.style.display = 'block';
  const left = e.clientX + 20 + 136 > innerWidth ? e.clientX - 156 : e.clientX + 20;
  const top = e.clientY + 20 + 170 > innerHeight ? e.clientY - 190 : e.clientY + 20;
  loupe.style.left = `${left}px`;
  loupe.style.top = `${top}px`;
});

view.addEventListener('click', (e) => {
  const p = pixelAt(e.clientX, e.clientY);
  if (p) window.picker.done(colorAt(p.x, p.y));
});

document.getElementById('cancel').onclick = () => window.picker.done(null);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.picker.done(null);
  if (e.key === 'b' || e.key === 'B') bar.classList.toggle('bottom');
});
document.getElementById('open').onclick = async () => {
  const item = await window.picker.openImage();
  if (!item) return;
  images.push(item);
  addSourceButton(item, images.length - 1);
  show(images.length - 1);
};
window.addEventListener('resize', draw);

function addSourceButton(item, index) {
  const b = document.createElement('button');
  b.textContent = item.label;
  b.onclick = () => show(index);
  document.getElementById('sources').appendChild(b);
}

window.picker.onInit(({ shots, first }) => {
  images = shots;
  images.forEach(addSourceButton);
  if (images.length) show(first);
});
