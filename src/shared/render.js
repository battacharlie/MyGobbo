// Disegna la scena (i livelli) dentro un contenitore. Usato sia dallo schermo
// di uscita sia dall'anteprima nella regia: le misure sono in percentuale e i
// caratteri in percentuale dell'altezza del contenitore, quindi la resa è la
// stessa a qualsiasi grandezza.
(function (root) {
  const { formatTime, timerValueMs, timerColor, videoRects, hexToRgba, TYPE_LABELS } = root.Layers;

  function createStage(container, opts = {}) {
    const getVideoSource = opts.getVideoSource || (() => null);
    const els = new Map(); // layerId -> { el, ... }
    let layers = [];
    let background = '#000';
    let lastFrame = performance.now();

    container.style.containerType = 'size';
    container.style.overflow = 'hidden';

    function build(layer) {
      const el = document.createElement('div');
      el.className = `layer layer-${layer.type}`;
      el.style.position = 'absolute';
      el.style.overflow = 'hidden';
      const entry = { el, type: layer.type };

      if (layer.type === 'ndi' || layer.type === 'capture') {
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
        el.appendChild(canvas);
        entry.canvas = canvas;
      } else if (layer.type === 'timer') {
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        const span = document.createElement('span');
        span.style.cssText = 'font-variant-numeric:tabular-nums;line-height:1;white-space:nowrap';
        el.appendChild(span);
        entry.text = span;
      } else if (layer.type === 'ticker') {
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        const span = document.createElement('span');
        span.style.cssText = 'white-space:pre;line-height:1.1;position:absolute;left:0;will-change:transform';
        el.appendChild(span);
        entry.text = span;
        entry.pos = null;
      }
      container.appendChild(el);
      els.set(layer.id, entry);
      return entry;
    }

    function update(next, bg) {
      layers = next;
      background = bg || background;
      container.style.background = background;
      const ids = new Set(layers.map((l) => l.id));
      for (const [id, entry] of els) {
        if (!ids.has(id)) {
          entry.el.remove();
          els.delete(id);
          if (opts.onRemove) opts.onRemove(id);
        }
      }
      layers.forEach((layer, index) => {
        const entry = els.get(layer.id) || build(layer);
        const s = entry.el.style;
        s.left = `${layer.x}%`;
        s.top = `${layer.y}%`;
        s.width = `${layer.w}%`;
        s.height = `${layer.h}%`;
        s.zIndex = String(index + 1);
        s.display = layer.visible || opts.showHidden ? (entry.type === 'timer' || entry.type === 'ticker' ? 'flex' : 'block') : 'none';
        s.opacity = layer.visible ? '1' : '0.35';

        if (layer.type === 'timer' || layer.type === 'ticker') {
          const alpha = layer.transparent ? 0 : (layer.type === 'ticker' ? layer.opacity : 1);
          s.background = hexToRgba(layer.background, alpha);
          const t = entry.text.style;
          t.fontSize = `${layer.fontSize}cqh`;
          t.fontFamily = `"${layer.fontFamily}", "Segoe UI", system-ui, sans-serif`;
          t.fontWeight = layer.bold ? '700' : '400';
          t.color = layer.color;
        }
        if (layer.type === 'ticker' && entry.text.textContent !== layer.text) {
          entry.text.textContent = layer.text;
          entry.pos = null; // ricomincia lo scorrimento
        }
      });
    }

    function drawVideo(layer, entry) {
      const canvas = entry.canvas;
      const w = Math.max(1, Math.round(entry.el.clientWidth * devicePixelRatio));
      const h = Math.max(1, Math.round(entry.el.clientHeight * devicePixelRatio));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      const src = getVideoSource(layer);
      if (src && src.width > 0 && src.height > 0) {
        const r = videoRects(src.width, src.height, layer.crop, layer.fit, w, h);
        ctx.drawImage(src.image, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
      } else if (opts.placeholders) {
        // Anteprima: riquadro con il nome dell'input al posto del video.
        ctx.fillStyle = layer.type === 'ndi' ? '#1d3557' : '#264d33';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `${Math.max(10, Math.min(h * 0.12, 28 * devicePixelRatio))}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = `${TYPE_LABELS[layer.type]}: ${layer.name}`;
        ctx.fillText(label, w / 2, h / 2, w * 0.9);
      }
    }

    function frame(t) {
      const dt = Math.min(0.1, (t - lastFrame) / 1000);
      lastFrame = t;
      const now = Date.now();
      for (const layer of layers) {
        const entry = els.get(layer.id);
        if (!entry || (!layer.visible && !opts.showHidden)) continue;
        if (layer.type === 'timer') {
          const value = timerValueMs(layer, now);
          const text = formatTime(value, layer.direction);
          if (entry.text.textContent !== text) entry.text.textContent = text;
          const color = timerColor(layer, value);
          if (entry.text.style.color !== color) entry.text.style.color = color;
          // Se i numeri non entrano nel riquadro (es. segno meno o ore) li
          // rimpicciolisce invece di tagliarli.
          const fit = Math.min(1, (entry.el.clientWidth * 0.96) / Math.max(1, entry.text.offsetWidth));
          const scale = `scale(${fit.toFixed(3)})`;
          if (entry.text.style.transform !== scale) entry.text.style.transform = scale;
        } else if (layer.type === 'ticker') {
          // La frase scorre solo se è più lunga dello spazio disponibile.
          const boxW = entry.el.clientWidth;
          const textW = entry.text.scrollWidth;
          if (textW <= boxW) {
            entry.pos = (boxW - textW) / 2;
          } else {
            if (entry.pos === null || entry.pos > boxW) entry.pos = boxW;
            // La velocità è in pixel al secondo su un'uscita larga 1920 px,
            // così l'anteprima piccola scorre in proporzione.
            entry.pos -= layer.speed * dt * (container.clientWidth / 1920);
            if (entry.pos < -textW) entry.pos = boxW;
          }
          entry.text.style.transform = `translateX(${entry.pos}px)`;
        } else {
          drawVideo(layer, entry);
        }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return { update, elementFor: (id) => els.get(id) && els.get(id).el };
  }

  root.createStage = createStage;
})(window);
