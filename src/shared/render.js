// Disegna la scena (i livelli) dentro un contenitore. Usato sia dallo schermo
// di uscita sia dall'anteprima nella regia: le misure sono in percentuale e i
// caratteri in percentuale dell'altezza del contenitore, quindi la resa è la
// stessa a qualsiasi grandezza.
//
// Per consumare poco non c'è un ciclo che ridisegna a ogni fotogramma:
// - i video (periferiche e NDI) sono elementi della pagina posizionati con
//   CSS, li compone la scheda video senza lavoro in JavaScript;
// - il timer si aggiorna solo quando cambia il secondo mostrato;
// - la frase scorre con un'animazione CSS gestita dal compositore, a scatti
//   di MAX_FPS al secondo (come i video, non supera i 25 fps);
// - le misure si rileggono solo quando cambiano scena o dimensioni.
(function (root) {
  const { MAX_FPS, formatTime, timerValueMs, timerElapsedMs, timerColor, videoRects, hexToRgba, TYPE_LABELS } = root.Layers;

  function createStage(container, opts = {}) {
    const getMedia = opts.getMedia || (() => null);
    const els = new Map(); // layerId -> { el, ... }
    let layers = [];
    let background = '#000';
    let timerHandle = null;

    container.style.containerType = 'size';
    container.style.overflow = 'hidden';

    function build(layer) {
      const el = document.createElement('div');
      el.className = `layer layer-${layer.type}`;
      el.style.position = 'absolute';
      el.style.overflow = 'hidden';
      const entry = { el, type: layer.type };

      if (layer.type === 'ndi' || layer.type === 'capture') {
        if (opts.placeholders) {
          // Anteprima in regia: riquadro con il nome dell'input al posto del
          // video, così la regia non decodifica i flussi una seconda volta.
          el.style.display = 'flex';
          const label = document.createElement('span');
          label.style.cssText = 'margin:auto;padding:0 4%;text-align:center;color:rgba(255,255,255,0.85);font:4cqh "Segoe UI",sans-serif;overflow:hidden;white-space:nowrap;text-overflow:ellipsis';
          el.appendChild(label);
          entry.label = label;
        } else {
          // Riquadro che ritaglia la zona visibile della sorgente.
          const clip = document.createElement('div');
          clip.style.cssText = 'position:absolute;overflow:hidden';
          el.appendChild(clip);
          entry.clip = clip;
        }
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
          if (entry.anim) entry.anim.cancel();
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
        const flex = entry.type === 'timer' || entry.type === 'ticker' || entry.label;
        s.display = layer.visible || opts.showHidden ? (flex ? 'flex' : 'block') : 'none';
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
        }
        if (entry.label) {
          s.background = layer.type === 'ndi' ? '#1d3557' : '#264d33';
          const text = `${TYPE_LABELS[layer.type]}: ${layer.name}`;
          if (entry.label.textContent !== text) entry.label.textContent = text;
        }
      });
      layout();
      tickTimers();
    }

    // Rilegge le misure e risistema video, timer e frase.
    function layout() {
      for (const layer of layers) {
        const entry = els.get(layer.id);
        if (!entry || (!layer.visible && !opts.showHidden)) continue;
        if (entry.clip) layoutMedia(entry, layer);
        else if (layer.type === 'ticker') layoutTicker(entry, layer);
        else if (layer.type === 'timer') entry.fitKey = null; // ricalcola al prossimo aggiornamento
      }
    }

    function layoutMedia(entry, layer) {
      const media = getMedia(layer);
      const clip = entry.clip;
      if (!media || !(media.width > 0 && media.height > 0)) {
        clip.style.display = 'none';
        return;
      }
      if (media.el.parentNode !== clip) clip.replaceChildren(media.el);
      clip.style.display = 'block';
      const boxW = entry.el.clientWidth;
      const boxH = entry.el.clientHeight;
      const r = videoRects(media.width, media.height, layer.crop, layer.fit, boxW, boxH);
      const sx = r.dw / r.sw;
      const sy = r.dh / r.sh;
      Object.assign(clip.style, { left: `${r.dx}px`, top: `${r.dy}px`, width: `${r.dw}px`, height: `${r.dh}px` });
      Object.assign(media.el.style, {
        position: 'absolute',
        left: `${-r.sx * sx}px`,
        top: `${-r.sy * sy}px`,
        width: `${media.width * sx}px`,
        height: `${media.height * sy}px`,
        objectFit: 'fill',
        display: 'block'
      });
    }

    function layoutTicker(entry, layer) {
      // La frase scorre solo se è più lunga dello spazio disponibile.
      const boxW = entry.el.clientWidth;
      const textW = entry.text.scrollWidth;
      // La velocità è in pixel al secondo su un'uscita larga 1920 px, così
      // l'anteprima piccola scorre in proporzione.
      const speed = Math.max(1, layer.speed * (container.clientWidth / 1920));
      const key = `${boxW}|${textW}|${speed}`;
      if (entry.tickerKey === key) return;
      entry.tickerKey = key;
      if (entry.anim) {
        entry.anim.cancel();
        entry.anim = null;
      }
      if (textW <= boxW) {
        entry.text.style.transform = `translateX(${(boxW - textW) / 2}px)`;
        return;
      }
      entry.text.style.transform = '';
      // L'andamento a gradini fa avanzare la frase solo MAX_FPS volte al
      // secondo anche se lo schermo si aggiorna più spesso.
      const duration = ((boxW + textW) / speed) * 1000;
      const steps = Math.max(1, Math.round((duration / 1000) * MAX_FPS));
      entry.anim = entry.text.animate(
        [{ transform: `translateX(${boxW}px)` }, { transform: `translateX(${-textW}px)` }],
        { duration, iterations: Infinity, easing: `steps(${steps}, end)` }
      );
    }

    // Aggiorna i timer e programma il prossimo aggiornamento al cambio del
    // secondo mostrato (niente lavoro tra un secondo e l'altro).
    function tickTimers() {
      clearTimeout(timerHandle);
      timerHandle = null;
      const now = Date.now();
      let next = Infinity;
      for (const layer of layers) {
        if (layer.type !== 'timer') continue;
        const entry = els.get(layer.id);
        if (!entry || (!layer.visible && !opts.showHidden)) continue;
        const value = timerValueMs(layer, now);
        const text = formatTime(value, layer.direction);
        if (entry.text.textContent !== text) entry.text.textContent = text;
        const color = timerColor(layer, value);
        if (entry.text.style.color !== color) entry.text.style.color = color;
        fitTimer(entry);
        if (layer.run.running) {
          const elapsed = timerElapsedMs(layer, now);
          next = Math.min(next, 1000 - (((elapsed % 1000) + 1000) % 1000));
        }
      }
      if (next !== Infinity) timerHandle = setTimeout(tickTimers, next + 15);
    }

    // Se i numeri non entrano nel riquadro (es. segno meno o ore) li
    // rimpicciolisce invece di tagliarli. Misura solo quando cambia il numero
    // di caratteri o la scena.
    function fitTimer(entry) {
      const key = `${entry.text.textContent.length}|${entry.text.style.fontSize}|${entry.text.style.fontFamily}|${entry.text.style.fontWeight}`;
      if (entry.fitKey === key) return;
      entry.fitKey = key;
      const fit = Math.min(1, (entry.el.clientWidth * 0.96) / Math.max(1, entry.text.offsetWidth));
      entry.text.style.transform = `scale(${fit.toFixed(3)})`;
    }

    function relayout() {
      layout();
      tickTimers();
    }

    new ResizeObserver(relayout).observe(container);
    if (document.fonts) document.fonts.ready.then(relayout);

    return { update, relayout, elementFor: (id) => els.get(id) && els.get(id).el };
  }

  root.createStage = createStage;
})(window);
