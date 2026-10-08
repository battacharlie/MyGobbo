// Regia: elenco degli elementi, anteprima dell'uscita e proprietà
// dell'elemento selezionato.
const { TYPE_LABELS, timerValueMs, formatTime, timerColor } = window.Layers;
const api = window.countdown;
const send = (cmd) => api.send(cmd);
const $ = (id) => document.getElementById(id);

let state = null;
let selectedId = null;
let panelKey = null; // id+tipo dell'elemento mostrato nel pannello
let bindings = []; // campi del pannello da aggiornare quando cambia lo stato
let panelTick = null; // aggiornamento periodico del pannello (timer, sorgenti)

// --- Piccoli aiuti per costruire l'interfaccia -------------------------------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function selectedLayer() {
  return state && state.layers.find((l) => l.id === selectedId);
}

function updateLayer(patch) {
  const layer = selectedLayer();
  if (!layer) return;
  Object.assign(layer, patch.crop ? { ...patch, crop: { ...layer.crop, ...patch.crop } } : patch);
  send({ type: 'update-layer', id: layer.id, patch });
}

// Campo collegato a una proprietà dell'elemento selezionato.
function bound(el, get, set, event = 'input') {
  const isCheck = el.type === 'checkbox';
  el.addEventListener(event, () => {
    const v = isCheck ? el.checked : el.value;
    set(el.type === 'number' || el.type === 'range' ? Number(v) : v);
  });
  bindings.push({ el, get, isCheck });
  return el;
}

function field(label, input) {
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

function numberInput(get, set, attrs = {}) {
  return bound(h('input', { type: 'number', step: 'any', ...attrs }), get, set);
}

function textInput(prop, attrs = {}) {
  return bound(h('input', { type: 'text', ...attrs }), (l) => l[prop], (v) => updateLayer({ [prop]: v }));
}

function colorInput(prop) {
  return bound(h('input', { type: 'color' }), (l) => l[prop], (v) => updateLayer({ [prop]: v }));
}

function checkbox(label, prop) {
  const input = bound(h('input', { type: 'checkbox' }), (l) => l[prop], (v) => updateLayer({ [prop]: v }), 'change');
  return h('label', { class: 'check' }, input, label);
}

function select(options, get, set) {
  const el = h('select', {}, options.map(([value, label]) => h('option', { value }, label)));
  return bound(el, get, set, 'change');
}

function refreshBindings() {
  const layer = selectedLayer();
  if (!layer) return;
  for (const b of bindings) {
    if (document.activeElement === b.el) continue;
    const v = b.get(layer);
    if (b.isCheck) b.el.checked = !!v;
    else if (b.el.value !== String(v ?? '')) b.el.value = v ?? '';
  }
}

// --- Pannello proprietà ------------------------------------------------------

function buildPanel() {
  const panel = $('panel');
  const layer = selectedLayer();
  bindings = [];
  clearInterval(panelTick);
  panelTick = null;
  panel.innerHTML = '';
  panelKey = layer ? `${layer.id}:${layer.type}` : null;

  if (!layer) {
    panel.append(h('p', { class: 'empty' }, 'Seleziona un elemento dall\'elenco o dall\'anteprima, oppure aggiungine uno nuovo.'));
    return;
  }

  panel.append(
    h('h2', {}, TYPE_LABELS[layer.type]),
    field('Nome', textInput('name')),
    h('div', { class: 'row' },
      checkbox('In onda (visibile in uscita)', 'visible')),
    h('div', { class: 'row' },
      h('button', { onclick: () => send({ type: 'solo', id: layer.id }), title: 'Mostra solo questo elemento in uscita' }, 'Solo questo'),
      h('button', { onclick: () => send({ type: 'move-layer', id: layer.id, dir: 1 }) }, '↑ Avanti'),
      h('button', { onclick: () => send({ type: 'move-layer', id: layer.id, dir: -1 }) }, '↓ Indietro'),
      h('button', { class: 'danger', onclick: () => removeSelected() }, 'Elimina'))
  );

  if (layer.type === 'timer') panel.append(...timerSection(layer));
  if (layer.type === 'ticker') panel.append(...tickerSection());
  if (layer.type === 'ndi') panel.append(...ndiSection());
  if (layer.type === 'capture') panel.append(...captureSection());

  panel.append(...geometrySection(layer));
  refreshBindings();
}

function geometrySection(layer) {
  const pct = { min: -100, max: 200, step: 0.5 };
  const nodes = [
    h('h3', {}, 'Posizione e misure (% dello schermo)'),
    h('div', { class: 'grid2' },
      field('Sinistra (X)', numberInput((l) => round(l.x), (v) => updateLayer({ x: v }), pct)),
      field('Alto (Y)', numberInput((l) => round(l.y), (v) => updateLayer({ y: v }), pct)),
      field('Larghezza', numberInput((l) => round(l.w), (v) => updateLayer({ w: Math.max(1, v) }), { min: 1, max: 400, step: 0.5 })),
      field('Altezza', numberInput((l) => round(l.h), (v) => updateLayer({ h: Math.max(1, v) }), { min: 1, max: 400, step: 0.5 }))),
    h('div', { class: 'row' },
      h('button', { onclick: () => updateLayer({ x: 0, y: 0, w: 100, h: 100 }) }, 'Schermo intero'),
      h('button', { onclick: () => center() }, 'Centra'),
      h('button', { onclick: () => fitToSource() }, 'Proporzioni 16:9'))
  ];
  if (layer.type === 'ndi' || layer.type === 'capture') {
    nodes.push(
      field('Adattamento', select(
        [['contain', 'Adatta (mantiene le proporzioni)'], ['cover', 'Riempi (mantiene le proporzioni, taglia)'], ['stretch', 'Deforma (riempie tutto)']],
        (l) => l.fit, (v) => updateLayer({ fit: v }))),
      h('h3', {}, 'Ritaglio (crop, % della sorgente)'),
      h('div', { class: 'grid4' },
        ['top', 'right', 'bottom', 'left'].map((side) => field(
          { top: 'Alto', right: 'Destra', bottom: 'Basso', left: 'Sinistra' }[side],
          numberInput((l) => l.crop[side], (v) => updateLayer({ crop: { [side]: clamp(v, 0, 95) } }), { min: 0, max: 95, step: 0.5 })))),
      h('div', { class: 'row' },
        h('button', { onclick: () => updateLayer({ crop: { top: 0, right: 0, bottom: 0, left: 0 } }) }, 'Togli ritaglio'))
    );
  }
  return nodes;
}

function timerSection(layer) {
  const big = h('div', { class: 'big-time' }, '00:00');
  const startBtn = h('button', { class: 'primary', onclick: () => {
    const l = selectedLayer();
    send({ type: 'timer', id: l.id, action: l.run.running ? 'pause' : 'start' });
  } }, '▶ Avvia');
  const adj = (s, label) => h('button', { onclick: () => send({ type: 'timer', id: selectedId, action: 'adjust', seconds: s }) }, label);

  const durMin = numberInput((l) => Math.floor(l.durationSec / 60), (v) => setDuration(v, null), { min: 0, max: 999, step: 1 });
  const durSec = numberInput((l) => l.durationSec % 60, (v) => setDuration(null, v), { min: 0, max: 59, step: 1 });

  const tick = () => {
    const l = selectedLayer();
    if (!l || l.type !== 'timer') return;
    const value = timerValueMs(l);
    big.textContent = formatTime(value, l.direction);
    big.style.color = timerColor(l, value);
    startBtn.textContent = l.run.running ? '❚❚ Pausa' : '▶ Avvia';
    startBtn.className = l.run.running ? 'warn' : 'primary';
  };
  panelTick = setInterval(tick, 100);
  setTimeout(tick);

  return [
    h('h3', {}, 'Comandi'),
    big,
    h('div', { class: 'row' }, startBtn,
      h('button', { onclick: () => send({ type: 'timer', id: selectedId, action: 'reset' }) }, '↺ Azzera')),
    h('div', { class: 'row' }, adj(-60, '−1 min'), adj(-10, '−10 s'), adj(10, '+10 s'), adj(60, '+1 min')),
    h('p', { class: 'muted small' }, 'Barra spaziatrice: avvia/pausa del timer selezionato.'),
    h('h3', {}, 'Conteggio'),
    field('Direzione', select([['down', 'All\'indietro (countdown)'], ['up', 'In avanti (cronometro)']],
      (l) => l.direction, (v) => updateLayer({ direction: v }))),
    h('div', { class: 'grid2' }, field('Durata: minuti', durMin), field('secondi', durSec)),
    h('div', { class: 'row' }, [5, 10, 15, 30, 45, 60].map((m) =>
      h('button', { class: 'small-btn', onclick: () => { updateLayer({ durationSec: m * 60 }); refreshBindings(); } }, `${m}′`))),
    h('p', { class: 'muted small' }, 'In avanti la durata non conta: il cronometro parte da zero.'),
    h('h3', {}, 'Aspetto'),
    h('div', { class: 'grid2' },
      field('Colore numeri', colorInput('color')),
      field('Colore sfondo', colorInput('background'))),
    checkbox('Sfondo trasparente', 'transparent'),
    field('Misura carattere (% altezza schermo)', h('div', { class: 'row' },
      bound(h('input', { type: 'range', min: 2, max: 60, step: 0.5 }), (l) => l.fontSize, (v) => updateLayer({ fontSize: v })),
      numberInput((l) => l.fontSize, (v) => updateLayer({ fontSize: clamp(v, 1, 100) }), { min: 1, max: 100, step: 0.5, style: 'width:80px' }))),
    field('Carattere', fontSelect()),
    checkbox('Grassetto', 'bold'),
    h('div', { class: 'grid2' },
      field('Avviso negli ultimi (s)', numberInput((l) => l.warningSec, (v) => updateLayer({ warningSec: Math.max(0, v) }), { min: 0, step: 1 })),
      field('Colore avviso', colorInput('warningColor'))),
    field('Colore a tempo scaduto', colorInput('endColor'))
  ];
}

function setDuration(min, sec) {
  const l = selectedLayer();
  const m = min != null ? Math.max(0, Math.floor(min)) : Math.floor(l.durationSec / 60);
  const s = sec != null ? clamp(Math.floor(sec), 0, 59) : l.durationSec % 60;
  updateLayer({ durationSec: m * 60 + s });
}

function tickerSection() {
  return [
    h('h3', {}, 'Frase'),
    field('Testo', bound(h('textarea', { rows: 3 }), (l) => l.text, (v) => updateLayer({ text: v.replace(/\n/g, ' ') }))),
    h('p', { class: 'muted small' }, 'Se il testo è più lungo dello spazio disponibile, scorre da destra a sinistra.'),
    field('Velocità di scorrimento (px/s)', h('div', { class: 'row' },
      bound(h('input', { type: 'range', min: 20, max: 600, step: 10 }), (l) => l.speed, (v) => updateLayer({ speed: v })),
      numberInput((l) => l.speed, (v) => updateLayer({ speed: clamp(v, 5, 2000) }), { min: 5, step: 5, style: 'width:80px' }))),
    h('h3', {}, 'Aspetto'),
    h('div', { class: 'grid2' },
      field('Colore testo', colorInput('color')),
      field('Colore fascia', colorInput('background'))),
    field('Opacità fascia', bound(h('input', { type: 'range', min: 0, max: 1, step: 0.05 }), (l) => l.opacity, (v) => updateLayer({ opacity: v }))),
    checkbox('Fascia trasparente', 'transparent'),
    field('Misura carattere (% altezza schermo)', h('div', { class: 'row' },
      bound(h('input', { type: 'range', min: 2, max: 30, step: 0.5 }), (l) => l.fontSize, (v) => updateLayer({ fontSize: v })),
      numberInput((l) => l.fontSize, (v) => updateLayer({ fontSize: clamp(v, 1, 100) }), { min: 1, max: 100, step: 0.5, style: 'width:80px' }))),
    field('Carattere', fontSelect()),
    checkbox('Grassetto', 'bold'),
    h('div', { class: 'row' },
      h('button', { onclick: () => updateLayer({ x: 0, y: 86, w: 100, h: 14 }) }, 'Riporta in basso'))
  ];
}

function fontSelect() {
  const fonts = ['Segoe UI', 'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Consolas', 'Georgia', 'Impact', 'Tahoma', 'Trebuchet MS', 'Verdana'];
  return select(fonts.map((f) => [f, f]), (l) => l.fontFamily, (v) => updateLayer({ fontFamily: v }));
}

function ndiSection() {
  const nodes = [h('h3', {}, 'Sorgente NDI')];
  if (!state.ndiAvailable) {
    nodes.push(h('div', { class: 'notice' },
      'NDI non è disponibile in questa installazione: il modulo NDI non è stato caricato. ',
      'Vedi il README per installarlo. ',
      state.ndiError ? h('div', { class: 'muted small' }, state.ndiError) : null));
  }
  const sel = h('select', {});
  const status = h('div', { class: 'muted small' }, 'Ricerca delle sorgenti in rete…');
  sel.addEventListener('change', () => {
    const [name, urlAddress] = JSON.parse(sel.value || 'null') || [];
    updateLayer({ source: name ? { name, urlAddress } : null, name: name ? shortNdiName(name) : selectedLayer().name });
  });

  const refresh = async () => {
    const layer = selectedLayer();
    if (!layer || layer.type !== 'ndi' || document.activeElement === sel) return;
    const sources = await api.ndiSources();
    const current = layer.source;
    const list = [...sources];
    if (current && !list.some((s) => s.name === current.name)) list.push({ ...current, missing: true });
    const opts = [h('option', { value: '' }, '— nessuna —'),
      ...list.map((s) => h('option', { value: JSON.stringify([s.name, s.urlAddress]) }, s.missing ? `${s.name} (non trovata)` : s.name))];
    const signature = list.map((s) => s.name + s.missing).join('|');
    if (sel.dataset.sig !== signature) {
      sel.dataset.sig = signature;
      sel.replaceChildren(...opts);
    }
    sel.value = current ? JSON.stringify([current.name, current.urlAddress]) : '';
    status.textContent = sources.length ? `${sources.length} sorgenti trovate in rete` : 'Nessuna sorgente NDI trovata (la ricerca continua)';
  };
  panelTick = setInterval(refresh, 2000);
  setTimeout(refresh);

  nodes.push(
    field('Sorgente', sel),
    status,
    field('Qualità', select([['high', 'Piena risoluzione'], ['low', 'Bassa (anteprima, meno banda)']],
      (l) => l.quality, (v) => updateLayer({ quality: v })))
  );
  return nodes;
}

function shortNdiName(name) {
  const m = name.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : name;
}

function captureSection() {
  const sel = h('select', {});
  const status = h('div', { class: 'muted small' }, '');
  sel.addEventListener('change', () => {
    const opt = sel.selectedOptions[0];
    updateLayer({ deviceId: sel.value, deviceLabel: opt ? opt.textContent : '', name: opt && sel.value ? opt.textContent : selectedLayer().name });
  });

  const refresh = async (askPermission) => {
    let devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    // Senza permesso i nomi sono vuoti: lo chiediamo una volta sola.
    if (askPermission && devices.some((d) => !d.label)) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true });
        s.getTracks().forEach((t) => t.stop());
        devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      } catch { /* nessuna periferica o permesso negato */ }
    }
    const layer = selectedLayer();
    if (!layer || layer.type !== 'capture') return;
    const opts = [h('option', { value: '' }, '— nessuna —'),
      ...devices.map((d, i) => h('option', { value: d.deviceId }, d.label || `Periferica ${i + 1}`))];
    if (layer.deviceId && !devices.some((d) => d.deviceId === layer.deviceId)) {
      opts.push(h('option', { value: layer.deviceId }, `${layer.deviceLabel || 'Periferica'} (non collegata)`));
    }
    sel.replaceChildren(...opts);
    sel.value = layer.deviceId || '';
    status.textContent = devices.length ? `${devices.length} periferiche video trovate` : 'Nessuna periferica video trovata';
  };
  setTimeout(() => refresh(true));

  return [
    h('h3', {}, 'Periferica di acquisizione'),
    field('Periferica', sel),
    h('div', { class: 'row' }, status, h('button', { class: 'small-btn', onclick: () => refresh(true) }, 'Aggiorna elenco')),
    h('p', { class: 'muted small' }, 'Schede di acquisizione, webcam e convertitori HDMI/SDI → USB.')
  ];
}

function center() {
  const l = selectedLayer();
  updateLayer({ x: round((100 - l.w) / 2), y: round((100 - l.h) / 2) });
}

// Imposta l'altezza perché il riquadro abbia proporzioni 16:9 sullo schermo.
function fitToSource() {
  const l = selectedLayer();
  const out = state.output;
  const hPct = l.w * (out.width / out.height) * (9 / 16);
  updateLayer({ h: round(hPct) });
}

function removeSelected() {
  const layer = selectedLayer();
  if (!layer) return;
  if (!confirm(`Eliminare "${layer.name}"?`)) return;
  send({ type: 'remove-layer', id: layer.id });
  selectedId = null;
}

// --- Elenco elementi -----------------------------------------------------------

function renderList() {
  const list = $('layer-list');
  list.replaceChildren(...[...state.layers].reverse().map((layer) => {
    const eye = h('button', {
      class: `small-btn ${layer.visible ? 'on' : ''}`,
      title: layer.visible ? 'In onda: clic per nascondere' : 'Nascosto: clic per mostrare',
      onclick: (e) => { e.stopPropagation(); send({ type: 'update-layer', id: layer.id, patch: { visible: !layer.visible } }); }
    }, layer.visible ? 'In onda' : 'Nascosto');
    return h('li', {
      class: `${layer.id === selectedId ? 'selected' : ''} ${layer.visible ? '' : 'hidden-layer'}`,
      onclick: () => select_(layer.id)
    }, h('span', { class: 'tag' }, TYPE_LABELS[layer.type]), h('span', { class: 'name' }, layer.name), eye);
  }));
  if (!state.layers.length) list.append(h('li', { class: 'empty' }, 'Nessun elemento: aggiungine uno.'));
}

function select_(id) {
  selectedId = id;
  render(state);
}

// --- Anteprima con trascinamento -----------------------------------------------

const stage = createStage($('stage'), { placeholders: true, showHidden: true });
const overlay = $('overlay');
let drag = null;

function renderOverlay() {
  const boxes = state.layers.map((layer, i) => {
    const box = h('div', {
      class: `box ${layer.id === selectedId ? 'selected' : ''}`,
      style: `left:${layer.x}%;top:${layer.y}%;width:${layer.w}%;height:${layer.h}%;z-index:${layer.id === selectedId ? 1000 : i + 1}`
    }, h('div', { class: 'handle' }));
    box.addEventListener('pointerdown', (e) => startDrag(e, layer, e.target.classList.contains('handle') ? 'resize' : 'move'));
    return box;
  });
  overlay.replaceChildren(...boxes);
}

function startDrag(e, layer, mode) {
  e.preventDefault();
  e.stopPropagation();
  if (selectedId !== layer.id) select_(layer.id);
  const rect = overlay.getBoundingClientRect();
  drag = { id: layer.id, mode, startX: e.clientX, startY: e.clientY, rect, orig: { x: layer.x, y: layer.y, w: layer.w, h: layer.h }, pending: null };
  window.addEventListener('pointermove', onDrag);
  window.addEventListener('pointerup', endDrag, { once: true });
}

function snap(v) {
  for (const t of [0, 50, 100]) if (Math.abs(v - t) < 1) return t;
  return round(v);
}

function onDrag(e) {
  if (!drag) return;
  const dx = (e.clientX - drag.startX) / drag.rect.width * 100;
  const dy = (e.clientY - drag.startY) / drag.rect.height * 100;
  const o = drag.orig;
  let patch;
  if (drag.mode === 'move') {
    let x = o.x + dx;
    let y = o.y + dy;
    // Aggancio ai bordi e al centro dello schermo.
    const sx = snap(x), sxr = snap(x + o.w) - o.w, sxc = snap(x + o.w / 2) - o.w / 2;
    x = sx !== round(x) ? sx : sxr !== round(x + o.w) - o.w ? sxr : sxc;
    const sy = snap(y), syb = snap(y + o.h) - o.h, syc = snap(y + o.h / 2) - o.h / 2;
    y = sy !== round(y) ? sy : syb !== round(y + o.h) - o.h ? syb : syc;
    patch = { x: round(x), y: round(y) };
  } else {
    let w = Math.max(2, o.w + dx);
    let hh = Math.max(2, o.h + dy);
    if (e.shiftKey) hh = w * (o.h / o.w);
    patch = { w: round(snap(o.x + w) - o.x), h: round(snap(o.y + hh) - o.y) };
  }
  const layer = state.layers.find((l) => l.id === drag.id);
  Object.assign(layer, patch);
  stage.update(state.layers, state.background);
  renderOverlay();
  refreshBindings();
  if (!drag.pending) {
    drag.pending = requestAnimationFrame(() => {
      if (!drag) return;
      drag.pending = null;
      const l = state.layers.find((x) => x.id === drag.id);
      send({ type: 'update-layer', id: drag.id, patch: { x: l.x, y: l.y, w: l.w, h: l.h } });
    });
  }
}

function endDrag() {
  window.removeEventListener('pointermove', onDrag);
  if (drag) {
    const l = state.layers.find((x) => x.id === drag.id);
    if (l) send({ type: 'update-layer', id: drag.id, patch: { x: l.x, y: l.y, w: l.w, h: l.h } });
  }
  drag = null;
}

overlay.addEventListener('pointerdown', () => { select_(null); });

// --- Stato generale ----------------------------------------------------------

function render(next) {
  state = next;
  if (selectedId && !selectedLayer()) selectedId = null;
  if (drag) return; // durante il trascinamento comanda l'anteprima locale

  $('preview').style.aspectRatio = `${state.output.width} / ${state.output.height}`;
  $('output-info').textContent = state.output.fullscreen
    ? `Uscita a tutto schermo ${state.output.width}×${state.output.height}`
    : 'Un solo monitor: uscita in finestra di anteprima';
  if (document.activeElement !== $('col-background')) $('col-background').value = state.background;

  const sel = $('sel-display');
  const sig = state.displays.map((d) => d.id + d.label).join('|');
  if (sel.dataset.sig !== sig) {
    sel.dataset.sig = sig;
    sel.replaceChildren(...state.displays.map((d) => h('option', { value: d.id }, d.label)));
  }
  sel.value = String(state.activeDisplayId);

  stage.update(state.layers, state.background);
  renderOverlay();
  renderList();

  const layer = selectedLayer();
  const key = layer ? `${layer.id}:${layer.type}` : null;
  if (key !== panelKey) buildPanel();
  else refreshBindings();
}

for (const b of document.querySelectorAll('[data-add]')) {
  b.addEventListener('click', () => {
    const before = new Set(state.layers.map((l) => l.id));
    send({ type: 'add-layer', layerType: b.dataset.add });
    // Seleziona il nuovo elemento appena arriva lo stato aggiornato.
    pendingSelect = before;
  });
}
let pendingSelect = null;

$('btn-show-all').onclick = () => send({ type: 'show-all' });
$('btn-toggle-display').onclick = () => send({ type: 'toggle-display' });
$('sel-display').onchange = (e) => send({ type: 'set-display', displayId: Number(e.target.value) });
$('col-background').oninput = (e) => send({ type: 'set-background', color: e.target.value });

document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    const layer = selectedLayer();
    const timer = layer && layer.type === 'timer' ? layer : state.layers.find((l) => l.type === 'timer');
    if (timer) send({ type: 'timer', id: timer.id, action: timer.run.running ? 'pause' : 'start' });
  }
});

api.onState((next) => {
  if (pendingSelect) {
    const added = next.layers.find((l) => !pendingSelect.has(l.id));
    if (added) selectedId = added.id;
    pendingSelect = null;
  }
  render(next);
});
api.getState().then((s) => {
  if (!selectedId && s.layers.length) selectedId = s.layers[s.layers.length - 1].id;
  render(s);
});

function round(v) {
  return Math.round(v * 10) / 10;
}
function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
