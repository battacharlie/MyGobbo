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
//   dei fotogrammi al secondo scelti (quelli del monitor o meno, come i video);
// - le misure si rileggono solo quando cambiano scena o dimensioni.
(function (root) {
  const { fps, formatTime, timerValueMs, timerElapsedMs, timerColor, timerOvertime, timerShowsClock, formatClock, isVisual, videoRects, hexToRgba, prompterY, TYPE_LABELS } = root.Layers;

  // Lampeggio dei numeri a tempo superato e cornice che corre lungo i bordi.
  // Le animazioni vanno a scatti (steps) per non superare i fotogrammi al
  // secondo scelti (fps()).
  const FRAME_LOOP_MS = 480; // un giro del tratteggio a velocità normale
  if (!document.getElementById('igor-anim')) {
    const style = document.createElement('style');
    style.id = 'igor-anim';
    style.textContent = '@keyframes igor-blink { 0%, 50% { opacity: 1 } 50.01%, 100% { opacity: 0 } }'
      + '.igor-blink { animation: igor-blink 1s steps(1, end) infinite; }'
      // Paragrafi del TelePrompt.
      + '.igor-prompter > * { margin: 0 0 0.6em; min-height: 1em; }';
    document.head.appendChild(style);
  }
  const PLACEHOLDER_BG = { ndi: '#1d3557', capture: '#264d33', media: '#4a2d5c' };

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

      if (isVisual(layer.type)) {
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
        // Cornice sui bordi dello schermo, fuori dal riquadro del timer.
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:100000;display:none';
        const rect = document.createElementNS(ns, 'rect');
        for (const [k, v] of Object.entries({ x: 0, y: 0, width: '100%', height: '100%', fill: 'none', pathLength: 1000, 'stroke-dasharray': '30 20' })) rect.setAttribute(k, v);
        svg.appendChild(rect);
        container.appendChild(svg);
        entry.frame = svg;
        entry.frameRect = rect;
      } else if (layer.type === 'prompter') {
        // Il testo è impaginato come su uno schermo alto 1080 e poi
        // rimpicciolito: anteprima e uscita vanno a capo negli stessi punti.
        const flip = document.createElement('div');
        flip.style.cssText = 'position:absolute;inset:0';
        const page = document.createElement('div');
        page.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden';
        const content = document.createElement('div');
        content.className = 'igor-prompter';
        content.style.cssText = 'position:absolute;left:0;top:0;width:100%;will-change:transform';
        const guide = document.createElement('div');
        guide.style.cssText = 'position:absolute;left:0;right:0;pointer-events:none';
        page.appendChild(content);
        flip.append(page, guide);
        el.appendChild(flip);
        Object.assign(entry, { flip, page, content, guide });
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

    // fades: dissolvenze in corso tra le scene, { layerId: { from, to, startedAt, durationMs } }.
    function update(next, bg, fades = {}) {
      layers = next;
      background = bg || background;
      container.style.background = background;
      const ids = new Set(layers.map((l) => l.id));
      for (const [id, entry] of els) {
        if (!ids.has(id)) {
          if (entry.anim) entry.anim.cancel();
          if (entry.scroll) entry.scroll.cancel();
          if (entry.frame) entry.frame.remove();
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
        if (layer.type === 'prompter') {
          s.background = hexToRgba(layer.background, layer.transparent ? 0 : 1);
          if (entry.html !== layer.html) {
            entry.html = layer.html;
            entry.htmlVer = (entry.htmlVer || 0) + 1;
            entry.content.innerHTML = layer.html;
          }
          stylePrompter(entry.content, layer);
          entry.flip.style.transform = `scale(${layer.mirrorX ? -1 : 1}, ${layer.mirrorY ? -1 : 1})`;
          const g = entry.guide.style;
          g.display = layer.guide ? 'block' : 'none';
          g.top = `${layer.guideY}%`;
          g.borderTop = `max(1px, 0.25cqh) solid ${hexToRgba(layer.guideColor, 0.85)}`;
        }
        applyFade(entry, fades[layer.id]);
        if (entry.label) {
          s.background = PLACEHOLDER_BG[layer.type];
          const text = `${root.I18n ? root.I18n.t(TYPE_LABELS[layer.type]) : TYPE_LABELS[layer.type]}: ${layer.name}`;
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
        else if (layer.type === 'prompter') layoutPrompter(entry, layer);
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
      const key = `${boxW}|${textW}|${speed}|${fps()}`;
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
      // L'andamento a gradini fa avanzare la frase solo fps() volte al
      // secondo anche se lo schermo si aggiorna più spesso.
      const duration = ((boxW + textW) / speed) * 1000;
      const steps = Math.max(1, Math.round((duration / 1000) * fps()));
      entry.anim = entry.text.animate(
        [{ transform: `translateX(${boxW}px)` }, { transform: `translateX(${-textW}px)` }],
        { duration, iterations: Infinity, easing: `steps(${steps}, end)` }
      );
    }

    // Scorrimento del TelePrompt: un'animazione dalla posizione attuale
    // alla fine del testo, a scatti di fps() al secondo.
    function layoutPrompter(entry, layer) {
      const k = container.clientHeight / 1080 || 1;
      const refW = entry.el.clientWidth / k;
      const refH = entry.el.clientHeight / k;
      Object.assign(entry.page.style, { width: `${refW}px`, height: `${refH}px`, transform: `scale(${k})` });
      const maxY = entry.content.offsetHeight;
      const readY = (layer.guideY / 100) * refH;
      const r = layer.run;
      const key = `${r.running}|${r.y}|${r.startedAt}|${layer.speed}|${maxY}|${readY}|${refW}|${entry.htmlVer}|${fps()}`;
      if (entry.scrollKey === key) return;
      entry.scrollKey = key;
      if (entry.scroll) {
        entry.scroll.cancel();
        entry.scroll = null;
      }
      const y0 = Math.max(0, Math.min(maxY, prompterY(layer)));
      entry.content.style.transform = `translateY(${readY - y0}px)`;
      if (!r.running || layer.speed <= 0 || y0 >= maxY) return;
      const duration = ((maxY - y0) / layer.speed) * 1000;
      const steps = Math.max(1, Math.round((duration / 1000) * fps()));
      entry.scroll = entry.content.animate(
        [{ transform: `translateY(${readY - y0}px)` }, { transform: `translateY(${readY - maxY}px)` }],
        { duration, easing: `steps(${steps}, end)`, fill: 'forwards' }
      );
    }

    // Dissolvenza tra scene (opacità a scatti di fps() al secondo).
    function applyFade(entry, fade) {
      const key = fade ? `${fade.startedAt}|${fade.durationMs}|${fade.from}|${fade.to}` : null;
      if (entry.fadeKey === key) return;
      entry.fadeKey = key;
      for (const a of entry.fadeAnims || []) a.cancel();
      entry.fadeAnims = [];
      if (!fade) return;
      const steps = Math.max(1, Math.round((fade.durationMs / 1000) * fps()));
      for (const target of [entry.el, entry.frame]) {
        if (!target) continue;
        const a = target.animate([{ opacity: fade.from }, { opacity: fade.to }],
          { duration: fade.durationMs, easing: `steps(${steps}, end)`, fill: 'forwards' });
        a.currentTime = Math.max(0, Math.min(fade.durationMs, Date.now() - fade.startedAt));
        entry.fadeAnims.push(a);
      }
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
        if (timerShowsClock(layer)) {
          // Timer fermo: data e ora al posto del conteggio.
          const text = formatClock(layer, new Date(now));
          if (entry.text.textContent !== text) entry.text.textContent = text;
          entry.text.style.color = layer.color;
          entry.text.classList.remove('igor-blink');
          showFrame(entry, layer, false);
          fitTimer(entry);
          next = Math.min(next, layer.clockMs ? 1000 / fps() : 1000 - (now % 1000));
          continue;
        }
        const value = timerValueMs(layer, now);
        const text = formatTime(value, layer.direction);
        if (entry.text.textContent !== text) entry.text.textContent = text;
        const color = timerColor(layer, value);
        if (entry.text.style.color !== color) entry.text.style.color = color;
        const over = timerOvertime(layer, value);
        entry.text.classList.toggle('igor-blink', over && layer.blink);
        showFrame(entry, layer, over && layer.frame);
        fitTimer(entry);
        if (layer.run.running) {
          const elapsed = timerElapsedMs(layer, now);
          next = Math.min(next, 1000 - (((elapsed % 1000) + 1000) % 1000));
        }
      }
      // I timer nascosti non mostrano la cornice.
      for (const layer of layers) {
        const entry = els.get(layer.id);
        if (entry && entry.frame && !layer.visible && !opts.showHidden) showFrame(entry, layer, false);
      }
      if (next !== Infinity) timerHandle = setTimeout(tickTimers, next + 15);
    }

    function showFrame(entry, layer, on) {
      const svg = entry.frame;
      if (!on) {
        if (entry.frameAnim) {
          entry.frameAnim.cancel();
          entry.frameAnim = null;
          entry.frameKey = null;
        }
        svg.style.display = 'none';
        return;
      }
      // Lo spessore è in pixel di uno schermo alto 1080: nell'anteprima
      // piccola si riduce in proporzione. Metà del tratto cade fuori dallo
      // schermo, per questo è raddoppiato.
      const px = Math.max(1, layer.frameWidth * container.clientHeight / 1080);
      const rect = entry.frameRect;
      rect.setAttribute('stroke', layer.frameColor);
      rect.setAttribute('stroke-width', String(px * 2));
      if (layer.frameStyle === 'solid') rect.removeAttribute('stroke-dasharray');
      else rect.setAttribute('stroke-dasharray', '30 20');
      svg.style.opacity = layer.visible ? '1' : '0.35';
      svg.style.display = 'block';
      // Movimento: scorre lungo i bordi, lampeggia da ferma oppure resta fissa.
      const speed = Math.max(0.1, Number(layer.frameSpeed) || 1);
      const key = `${layer.frameMotion}|${layer.frameStyle}|${speed}|${fps()}`;
      if (entry.frameKey === key) return;
      entry.frameKey = key;
      if (entry.frameAnim) entry.frameAnim.cancel();
      entry.frameAnim = null;
      if (layer.frameMotion === 'blink') {
        entry.frameAnim = svg.animate([{ opacity: 1 }, { opacity: 0 }],
          { duration: 1000 / speed, iterations: Infinity, easing: 'steps(2, jump-none)' });
      } else if (layer.frameMotion === 'run' && layer.frameStyle !== 'solid') {
        const duration = FRAME_LOOP_MS / speed;
        const steps = Math.max(2, Math.round((duration / 1000) * fps()));
        entry.frameAnim = rect.animate(
          [{ strokeDashoffset: '0px' }, { strokeDashoffset: '-50px' }],
          { duration, iterations: Infinity, easing: `steps(${steps}, end)` }
        );
      }
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

  // Stile del testo del TelePrompt, in pixel di uno schermo alto 1080.
  function stylePrompter(content, layer) {
    Object.assign(content.style, {
      fontSize: `${layer.fontSize * 10.8}px`,
      fontFamily: `"${layer.fontFamily}", "Segoe UI", system-ui, sans-serif`,
      fontWeight: layer.bold ? '700' : '400',
      color: layer.color,
      lineHeight: String(layer.lineHeight),
      letterSpacing: `${layer.letterSpacing}px`,
      textAlign: layer.align,
      padding: `0 ${layer.margin}%`,
      boxSizing: 'border-box',
      overflowWrap: 'break-word'
    });
  }

  // Misura il testo del TelePrompt come apparirà in uscita (schermo outW×outH):
  // inizio di ogni paragrafo e altezza totale, in pixel su 1080.
  let measureHost = null;
  const measureCache = new Map();
  function measurePrompter(layer, outW, outH) {
    const refW = (layer.w / 100) * outW * (1080 / outH);
    const key = [layer.html, refW, layer.fontSize, layer.fontFamily, layer.bold, layer.lineHeight, layer.letterSpacing, layer.margin, layer.align].join('|');
    if (measureCache.has(key)) return measureCache.get(key);
    if (!measureHost) {
      measureHost = document.createElement('div');
      measureHost.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none';
      document.body.appendChild(measureHost);
    }
    // Stessa struttura dell'uscita: pagina larga refW e testo al 100%.
    const page = document.createElement('div');
    page.style.cssText = `position:relative;width:${refW}px`;
    const content = document.createElement('div');
    content.className = 'igor-prompter';
    content.style.cssText = 'position:absolute;left:0;top:0;width:100%';
    stylePrompter(content, layer);
    content.innerHTML = layer.html;
    page.appendChild(content);
    measureHost.replaceChildren(page);
    const paragraphs = [...content.children]
      .filter((p) => p.textContent.trim())
      .map((p) => ({ y: p.offsetTop, text: p.textContent.trim() }));
    const result = { paragraphs, height: content.offsetHeight };
    if (measureCache.size > 20) measureCache.clear();
    measureCache.set(key, result);
    return result;
  }

  root.createStage = createStage;
  root.measurePrompter = measurePrompter;
})(window);
