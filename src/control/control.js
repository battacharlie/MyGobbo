// Regia: elenco degli elementi, anteprima dell'uscita e proprietà
// dell'elemento selezionato.
const { TYPE_LABELS, TIMER_COLORS, isVisual, timerValueMs, formatTime, timerColor, allLayers, findNode, composeLayers, prompterY } = window.Layers;
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
  const node = state && selectedId && findNode(state.layers, selectedId);
  return node ? node.layer : null;
}

function layerById(id) {
  const node = id && findNode(state.layers, id);
  return node ? node.layer : null;
}

// Scena che contiene l'elemento (o l'elemento stesso se è una scena).
function sceneOf(id) {
  const node = id && findNode(state.layers, id);
  if (!node) return null;
  return node.layer.type === 'scene' ? node.layer : node.parent;
}

// Scena mostrata nell'anteprima della regia: in modalità studio quella in
// anteprima; altrimenti la scena dell'elemento selezionato o quella in onda.
function viewSceneId() {
  if (state.studio) return state.preview;
  const scene = sceneOf(selectedId);
  return scene ? scene.id : state.program;
}

function previewLayers() {
  const id = viewSceneId();
  return composeLayers(state.layers, id ? [id] : []);
}

// Quante comparse ha lo stesso input (copie collegate in più scene).
function linkCount(layer) {
  return layer.link ? allLayers(state.layers).filter((l) => l.link === layer.link).length : 1;
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

// Colore con contagocce: preleva da qualsiasi punto dello schermo o da un'immagine.
function colorInput(prop) {
  const input = bound(h('input', { type: 'color' }), (l) => l[prop], (v) => updateLayer({ [prop]: v }));
  return h('span', { class: 'color-pick' }, input, pickButton((c) => {
    updateLayer({ [prop]: c });
    refreshBindings();
  }));
}

function pickButton(onColor) {
  return h('button', {
    class: 'pick',
    title: 'Preleva il colore da qualsiasi punto dello schermo o da un\'immagine',
    onclick: async (e) => {
      e.preventDefault();
      const color = await api.pickColor();
      if (color) onColor(color);
    }
  }, '💧');
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
    if (b.html) {
      // L'editor del TelePrompt si aggiorna solo quando non ci si sta scrivendo.
      if (document.activeElement !== b.el && b.el.dataset.html !== b.get(layer)) {
        b.el.dataset.html = b.get(layer);
        b.el.innerHTML = b.get(layer);
      }
      continue;
    }
    if (b.text) {
      const t = b.get(layer);
      if (b.el.textContent !== t) b.el.textContent = t;
      continue;
    }
    if (document.activeElement === b.el) continue;
    const v = b.get(layer);
    if (b.isCheck) b.el.checked = !!v;
    else if (b.el.value !== String(v ?? '')) b.el.value = v ?? '';
  }
}

// --- Pannello proprietà ------------------------------------------------------

// Una scheda del pannello: titolo e campi.
function card(title, ...children) {
  return h('section', { class: 'card' }, title ? h('h3', {}, title) : null, ...children);
}

// Testo che si aggiorna da solo quando cambia l'elemento (anche durante il
// trascinamento nell'anteprima).
function liveText(get, attrs = {}) {
  const el = h('div', attrs);
  bindings.push({ el, get, text: true });
  return el;
}

function buildPanel() {
  const panel = $('panel');
  const layer = selectedLayer();
  bindings = [];
  clearInterval(panelTick);
  panelTick = null;
  panel.innerHTML = '';
  panelKey = panelKeyOf(layer);

  if (!layer) {
    panel.append(h('p', { class: 'empty' }, 'Seleziona un elemento dall\'elenco o dall\'anteprima, oppure aggiungine uno nuovo.'));
    return;
  }

  if (layer.type === 'scene') {
    panel.append(...sceneSection(layer));
    refreshBindings();
    return;
  }

  const scene = sceneOf(layer.id);
  const copies = linkCount(layer);
  panel.append(card(TYPE_LABELS[layer.type],
    field('Nome', textInput('name')),
    scene ? h('p', { class: 'muted small' }, `Nella scena "${scene.name}".`) : null,
    copies > 1 ? h('p', { class: 'muted small' }, `🔗 Input presente in ${copies} punti: sorgente e impostazioni sono condivise, posizione e misure no.`) : null,
    h('div', { class: 'row' },
      checkbox(scene ? 'Visibile nella scena' : 'In onda (visibile in uscita)', 'visible')),
    h('div', { class: 'row' },
      h('button', { onclick: () => send({ type: 'solo', id: layer.id }), title: 'Mostra solo questo elemento (tra quelli dello stesso elenco)' }, 'Solo questo'),
      h('button', { onclick: () => send({ type: 'move-layer', id: layer.id, dir: 1 }) }, '↑ Avanti'),
      h('button', { onclick: () => send({ type: 'move-layer', id: layer.id, dir: -1 }) }, '↓ Indietro'))
  ));

  if (layer.type === 'timer') panel.append(...timerSection(layer));
  if (layer.type === 'ticker') panel.append(...tickerSection());
  if (layer.type === 'prompter') panel.append(...prompterSection(layer));
  if (layer.type === 'ndi') panel.append(...ndiSection());
  if (layer.type === 'capture') panel.append(...captureSection());
  if (layer.type === 'media') panel.append(...mediaSection());

  panel.append(...geometrySection(layer));
  refreshBindings();
}

// Misure in pixel dell'elemento sullo schermo di uscita, aggiornate in tempo
// reale mentre lo si sposta o ridimensiona.
function pixelInfo(l) {
  const out = state.output;
  const px = (v, total) => Math.round(v * total / 100);
  let text = `${px(l.w, out.width)} × ${px(l.h, out.height)} px · posizione ${px(l.x, out.width)}, ${px(l.y, out.height)} px`;
  if (isVisual(l.type)) {
    const c = l.crop;
    const parts = [['sinistra', c.left], ['destra', c.right], ['alto', c.top], ['basso', c.bottom]]
      .filter(([, v]) => v > 0).map(([k, v]) => `${k} ${round(v)}%`);
    text += parts.length ? ` · ritaglio ${parts.join(', ')}` : ' · nessun ritaglio';
  }
  return text;
}

function geometrySection(layer) {
  const pct = { min: -100, max: 200, step: 0.5 };
  const nodes = [card('Posizione e misure',
    liveText(pixelInfo, { class: 'px-info' }),
    h('div', { class: 'grid2' },
      field('Sinistra (X, %)', numberInput((l) => round(l.x), (v) => updateLayer({ x: v }), pct)),
      field('Alto (Y, %)', numberInput((l) => round(l.y), (v) => updateLayer({ y: v }), pct)),
      field('Larghezza (%)', numberInput((l) => round(l.w), (v) => updateLayer({ w: Math.max(1, v) }), { min: 1, max: 400, step: 0.5 })),
      field('Altezza (%)', numberInput((l) => round(l.h), (v) => updateLayer({ h: Math.max(1, v) }), { min: 1, max: 400, step: 0.5 }))),
    h('div', { class: 'row' },
      h('button', { onclick: () => updateLayer({ x: 0, y: 0, w: 100, h: 100 }) }, 'Schermo intero'),
      h('button', { onclick: () => center() }, 'Centra'),
      h('button', { onclick: () => fitToSource() }, 'Proporzioni 16:9'))
  )];
  if (isVisual(layer.type)) {
    nodes.push(card('Adattamento e ritaglio',
      field('Adattamento', select(
        [['contain', 'Adatta (mantiene le proporzioni)'], ['cover', 'Riempi (mantiene le proporzioni, taglia)'], ['stretch', 'Deforma (riempie tutto)']],
        (l) => l.fit, (v) => updateLayer({ fit: v }))),
      h('p', { class: 'muted small' }, 'Per ritagliare trascina nell\'anteprima le maniglie arancioni a metà dei lati.'),
      h('div', { class: 'row' },
        h('button', { onclick: () => updateLayer({ crop: { top: 0, right: 0, bottom: 0, left: 0 } }) }, 'Togli ritaglio'))
    ));
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
    const text = formatTime(value, l.direction);
    if (big.textContent !== text) big.textContent = text;
    big.style.color = timerColor(l, value);
    const label = l.run.running ? '❚❚ Pausa' : '▶ Avvia';
    if (startBtn.textContent !== label) startBtn.textContent = label;
    startBtn.className = l.run.running ? 'warn' : 'primary';
  };
  // Quattro aggiornamenti al secondo bastano per un orologio a secondi.
  panelTick = setInterval(tick, 250);
  setTimeout(tick);

  return [
    card('Comandi',
      big,
      h('div', { class: 'row' }, startBtn,
        h('button', { onclick: () => send({ type: 'timer', id: selectedId, action: 'reset' }) }, '↺ Azzera')),
      h('div', { class: 'row' }, adj(-60, '−1 min'), adj(-10, '−10 s'), adj(10, '+10 s'), adj(60, '+1 min')),
      h('p', { class: 'muted small' }, 'Barra spaziatrice: avvia/pausa del timer selezionato.')),
    card('Conteggio',
      field('Direzione', select([['down', 'All\'indietro (countdown)'], ['up', 'In avanti (cronometro)']],
        (l) => l.direction, (v) => updateLayer({ direction: v }))),
      h('div', { class: 'grid2' }, field('Durata: minuti', durMin), field('secondi', durSec)),
      h('div', { class: 'row' }, [5, 10, 15, 30, 45, 60].map((m) =>
        h('button', { class: 'small-btn', onclick: () => { updateLayer({ durationSec: m * 60 }); refreshBindings(); } }, `${m}′`))),
      h('p', { class: 'muted small' }, 'All\'indietro, oltre lo zero il tempo continua con il segno +. In avanti la durata è il limite (0 = nessun limite).')),
    card('Colori',
      h('div', { class: 'grid3' },
        field('Partenza', colorInput('color')),
        field('Scadenza vicina', colorInput('warningColor')),
        field('Tempo superato', colorInput('endColor'))),
      field('Scadenza vicina negli ultimi (secondi)', numberInput((l) => l.warningSec, (v) => updateLayer({ warningSec: Math.max(0, v) }), { min: 0, step: 1 })),
      h('div', { class: 'row' },
        h('button', { class: 'small-btn', onclick: () => updateLayer({ ...TIMER_COLORS }) }, 'Verde, giallo, rosso'))),
    card('Tempo superato',
      checkbox('Numeri lampeggianti', 'blink'),
      checkbox('Cornice che corre lungo i bordi dello schermo', 'frame'),
      h('div', { class: 'grid2' },
        field('Colore cornice', colorInput('frameColor')),
        field('Spessore (px)', numberInput((l) => l.frameWidth, (v) => updateLayer({ frameWidth: clamp(v, 1, 200) }), { min: 1, max: 200, step: 1 }))),
      h('p', { class: 'muted small' }, 'Spessore in pixel su uno schermo Full HD (1080 righe).')),
    card('Aspetto',
      h('div', { class: 'grid2' },
        field('Colore sfondo', colorInput('background')),
        h('div', {}, checkbox('Sfondo trasparente', 'transparent'))),
      field('Misura carattere (% altezza schermo)', h('div', { class: 'row' },
        bound(h('input', { type: 'range', min: 2, max: 60, step: 0.5 }), (l) => l.fontSize, (v) => updateLayer({ fontSize: v })),
        numberInput((l) => l.fontSize, (v) => updateLayer({ fontSize: clamp(v, 1, 100) }), { min: 1, max: 100, step: 0.5, style: 'width:80px' }))),
      field('Carattere', fontSelect()),
      checkbox('Grassetto', 'bold'))
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
    card('Banner',
      field('Testo', bound(h('textarea', { rows: 3 }), (l) => l.text, (v) => updateLayer({ text: v.replace(/\n/g, ' ') }))),
      h('p', { class: 'muted small' }, 'Se il testo è più lungo dello spazio disponibile, scorre da destra a sinistra.'),
      field('Velocità di scorrimento (px/s)', h('div', { class: 'row' },
        bound(h('input', { type: 'range', min: 20, max: 600, step: 10 }), (l) => l.speed, (v) => updateLayer({ speed: v })),
        numberInput((l) => l.speed, (v) => updateLayer({ speed: clamp(v, 5, 2000) }), { min: 5, step: 5, style: 'width:80px' }))),
      h('div', { class: 'row' },
        h('button', { onclick: () => updateLayer({ x: 0, y: 86, w: 100, h: 14 }) }, 'Riporta in basso'))),
    card('Aspetto',
      h('div', { class: 'grid2' },
        field('Colore testo', colorInput('color')),
        field('Colore fascia', colorInput('background'))),
      field('Opacità fascia', bound(h('input', { type: 'range', min: 0, max: 1, step: 0.05 }), (l) => l.opacity, (v) => updateLayer({ opacity: v }))),
      checkbox('Fascia trasparente', 'transparent'),
      field('Misura carattere (% altezza schermo)', h('div', { class: 'row' },
        bound(h('input', { type: 'range', min: 2, max: 30, step: 0.5 }), (l) => l.fontSize, (v) => updateLayer({ fontSize: v })),
        numberInput((l) => l.fontSize, (v) => updateLayer({ fontSize: clamp(v, 1, 100) }), { min: 1, max: 100, step: 0.5, style: 'width:80px' }))),
      field('Carattere', fontSelect()),
      checkbox('Grassetto', 'bold'))
  ];
}

function mediaSection() {
  const playBtn = h('button', { onclick: () => {
    const l = selectedLayer();
    updateLayer({ playing: !l.playing });
  } }, '');
  const isVideo = () => selectedLayer().mediaKind !== 'image';
  bindings.push({ el: playBtn, get: (l) => (l.playing ? '❚❚ Pausa' : '▶ Riproduci'), text: true });
  const videoControls = h('div', {},
    h('div', { class: 'row' }, playBtn,
      h('button', { onclick: () => updateLayer({ playing: true, restartAt: Date.now() }) }, '⏮ Da capo')),
    checkbox('Ripeti all\'infinito', 'loop'),
    checkbox('Audio (sull\'uscita)', 'audio'));
  return [
    card('File',
      liveText((l) => l.file || 'Nessun file scelto', { class: 'px-info' }),
      h('div', { class: 'row' },
        h('button', { onclick: () => send({ type: 'pick-media', id: selectedId }) }, 'Scegli file…')),
      isVideo() ? videoControls : h('p', { class: 'muted small' }, 'Immagine fissa.'),
      h('p', { class: 'muted small' }, 'I video vanno in uscita a 25 fps al massimo, come gli altri input.'))
  ];
}

// --- TelePrompt ------------------------------------------------------------

// Misure del testo come apparirà in uscita: inizio dei paragrafi e fine.
function prompterMetrics(layer) {
  return measurePrompter(layer, state.output.width, state.output.height);
}

function sendPrompter(action, extra = {}) {
  const layer = selectedLayer();
  if (!layer || layer.type !== 'prompter') return;
  send({ type: 'prompter', id: layer.id, action, maxY: prompterMetrics(layer).height, ...extra });
}

// Paragrafo attuale: l'ultimo il cui inizio ha superato la linea di lettura.
function currentParagraph(layer, metrics) {
  const y = prompterY(layer) + 1;
  let index = 0;
  metrics.paragraphs.forEach((p, i) => { if (p.y <= y) index = i; });
  return index;
}

function jumpParagraph(delta) {
  const layer = selectedLayer();
  const m = prompterMetrics(layer);
  if (!m.paragraphs.length) return;
  const i = clamp(currentParagraph(layer, m) + delta, 0, m.paragraphs.length - 1);
  sendPrompter('goto', { y: m.paragraphs[i].y });
}

// Tasti del TelePrompt (quando è selezionato e non si sta scrivendo).
function prompterKey(e, layer) {
  const actions = {
    Space: () => sendPrompter(layer.run.running ? 'pause' : 'start'),
    PageDown: () => jumpParagraph(1),
    PageUp: () => jumpParagraph(-1),
    ArrowDown: () => sendPrompter('nudge', { dy: 60 }),
    ArrowUp: () => sendPrompter('nudge', { dy: -60 }),
    Home: () => sendPrompter('top')
  };
  const fn = actions[e.code];
  if (!fn) return false;
  e.preventDefault();
  fn();
  return true;
}

function prompterSection(layer) {
  const startBtn = h('button', { class: 'primary', onclick: () => sendPrompter(selectedLayer().run.running ? 'pause' : 'start') }, '▶ Avvia');
  const progress = h('div', { class: 'progress' }, h('div', {}));
  const paraList = h('ol', { class: 'para-list' });
  let paraSig = '';

  const tick = () => {
    const l = selectedLayer();
    if (!l || l.type !== 'prompter') return;
    const m = prompterMetrics(l);
    const label = l.run.running ? '❚❚ Pausa' : '▶ Avvia';
    if (startBtn.textContent !== label) startBtn.textContent = label;
    startBtn.className = l.run.running ? 'warn' : 'primary';
    const pct = m.height ? clamp(prompterY(l) / m.height, 0, 1) * 100 : 0;
    progress.firstChild.style.width = `${pct}%`;
    const sig = m.paragraphs.map((p) => p.y + p.text).join('|');
    if (sig !== paraSig) {
      paraSig = sig;
      paraList.replaceChildren(...m.paragraphs.map((p, i) => h('li', {
        title: 'Vai a questo paragrafo',
        onclick: () => sendPrompter('goto', { y: prompterMetrics(selectedLayer()).paragraphs[i].y })
      }, p.text.length > 70 ? `${p.text.slice(0, 70)}…` : p.text)));
      if (!m.paragraphs.length) paraList.append(h('li', { class: 'muted' }, 'Nessun paragrafo'));
    }
    const cur = currentParagraph(l, m);
    [...paraList.children].forEach((li, i) => li.classList.toggle('current', i === cur && m.paragraphs.length > 0));
  };
  panelTick = setInterval(tick, 250);
  setTimeout(tick);

  // Editor del testo: si può scrivere, incollare da Word, Blocco note,
  // Pages, TextEdit (lo stile viene ripulito) o importare un file.
  const editor = h('div', { class: 'editor', contenteditable: 'true', spellcheck: 'false' });
  editor.innerHTML = layer.html;
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    const html = TextConv.sanitizeHtml(editor.innerHTML);
    if (html !== selectedLayer().html) updateLayer({ html });
  };
  editor.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  });
  editor.addEventListener('blur', () => {
    save();
    editor.innerHTML = selectedLayer().html;
  });
  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const rtf = e.clipboardData.getData('text/rtf');
    const text = e.clipboardData.getData('text/plain');
    const clean = html ? TextConv.sanitizeHtml(html) : rtf ? TextConv.rtfToHtml(rtf) : TextConv.textToHtml(text);
    document.execCommand('insertHTML', false, clean);
    save();
  });
  bindings.push({ el: editor, get: (l) => l.html, html: true });

  const fmt = (cmd, label, title, value) => h('button', {
    class: 'small-btn',
    title,
    onmousedown: (e) => e.preventDefault(),
    onclick: () => {
      editor.focus();
      document.execCommand(cmd, false, value);
      save();
    }
  }, label);
  const colorBtn = h('input', { type: 'color', value: '#ffcc00', title: 'Colore del testo selezionato' });
  const applyColor = (c) => {
    editor.focus();
    document.execCommand('foreColor', false, c);
    save();
  };
  colorBtn.addEventListener('input', () => applyColor(colorBtn.value));
  const toolbar = h('div', { class: 'row toolbar' },
    fmt('bold', 'G', 'Grassetto'), fmt('italic', 'C', 'Corsivo'), fmt('underline', 'S', 'Sottolineato'), fmt('strikeThrough', 'ab̶', 'Barrato'),
    h('span', { class: 'color-pick' }, colorBtn, pickButton((c) => { colorBtn.value = c; applyColor(c); })),
    fmt('removeFormat', 'Togli stile', 'Toglie lo stile dal testo selezionato'));

  return [
    card('TelePrompt',
      progress,
      h('div', { class: 'row' }, startBtn,
        h('button', { onclick: () => sendPrompter('top'), title: 'Torna all\'inizio (Home)' }, '⏮ Inizio'),
        h('button', { onclick: () => jumpParagraph(-1), title: 'Paragrafo precedente (Pagina su)' }, '⇞ Par.'),
        h('button', { onclick: () => jumpParagraph(1), title: 'Paragrafo successivo (Pagina giù)' }, '⇟ Par.')),
      h('div', { class: 'row' },
        h('button', { onclick: () => sendPrompter('nudge', { dy: -60 }), title: 'Indietro di poco (freccia su)' }, '▲ Indietro'),
        h('button', { onclick: () => sendPrompter('nudge', { dy: 60 }), title: 'Avanti di poco (freccia giù)' }, '▼ Avanti')),
      field('Velocità (pixel al secondo su 1080)', h('div', { class: 'row' },
        h('button', { class: 'small-btn', onclick: () => updateLayer({ speed: Math.max(0, selectedLayer().speed - 5) }) }, '−'),
        bound(h('input', { type: 'range', min: 0, max: 300, step: 1 }), (l) => l.speed, (v) => updateLayer({ speed: v })),
        h('button', { class: 'small-btn', onclick: () => updateLayer({ speed: selectedLayer().speed + 5 }) }, '+'),
        numberInput((l) => l.speed, (v) => updateLayer({ speed: clamp(v, 0, 2000) }), { min: 0, step: 1, style: 'width:70px' }))),
      h('p', { class: 'muted small' }, 'Tasti: spazio avvia/pausa, Pagina su/giù cambia paragrafo, frecce su/giù spostano il testo, Home torna all\'inizio.')),
    card('Paragrafi (clic per saltare)', paraList),
    card('Testo',
      h('div', { class: 'row' },
        h('button', { onclick: async () => {
          const file = await api.importText();
          if (!file) return;
          const html = TextConv.importToHtml(file);
          editor.innerHTML = html;
          updateLayer({ html });
          sendPrompter('top');
        } }, 'Importa file…'),
        h('span', { class: 'muted small' }, 'Word (.docx), RTF (TextEdit, WordPad), testo (.txt), HTML')),
      toolbar,
      editor,
      h('p', { class: 'muted small' }, 'Puoi anche copiare e incollare da Word, Blocco note, Pages o TextEdit: grassetto, corsivo, colori e grandezze restano.')),
    card('Aspetto',
      field('Carattere', fontSelect()),
      field('Misura carattere (% altezza schermo)', h('div', { class: 'row' },
        bound(h('input', { type: 'range', min: 1, max: 25, step: 0.5 }), (l) => l.fontSize, (v) => updateLayer({ fontSize: v })),
        numberInput((l) => l.fontSize, (v) => updateLayer({ fontSize: clamp(v, 0.5, 100) }), { min: 0.5, max: 100, step: 0.5, style: 'width:70px' }))),
      checkbox('Grassetto', 'bold'),
      h('div', { class: 'grid2' },
        field('Colore testo', colorInput('color')),
        field('Colore sfondo', colorInput('background'))),
      checkbox('Sfondo trasparente', 'transparent'),
      field('Interlinea', h('div', { class: 'row' },
        bound(h('input', { type: 'range', min: 0.8, max: 3, step: 0.05 }), (l) => l.lineHeight, (v) => updateLayer({ lineHeight: v })),
        numberInput((l) => l.lineHeight, (v) => updateLayer({ lineHeight: clamp(v, 0.5, 5) }), { min: 0.5, max: 5, step: 0.05, style: 'width:70px' }))),
      field('Spaziatura tra le lettere (px)', h('div', { class: 'row' },
        bound(h('input', { type: 'range', min: -5, max: 40, step: 0.5 }), (l) => l.letterSpacing, (v) => updateLayer({ letterSpacing: v })),
        numberInput((l) => l.letterSpacing, (v) => updateLayer({ letterSpacing: clamp(v, -20, 200) }), { step: 0.5, style: 'width:70px' }))),
      field('Margini a destra e sinistra (%)', h('div', { class: 'row' },
        bound(h('input', { type: 'range', min: 0, max: 40, step: 1 }), (l) => l.margin, (v) => updateLayer({ margin: v })),
        numberInput((l) => l.margin, (v) => updateLayer({ margin: clamp(v, 0, 45) }), { min: 0, max: 45, step: 1, style: 'width:70px' }))),
      field('Allineamento', select([['left', 'A sinistra'], ['center', 'Al centro'], ['right', 'A destra'], ['justify', 'Giustificato']],
        (l) => l.align, (v) => updateLayer({ align: v })))),
    card('Specchio e linea di lettura',
      checkbox('Specchia in orizzontale (vetro del teleprompter)', 'mirrorX'),
      checkbox('Capovolgi in verticale', 'mirrorY'),
      checkbox('Mostra la linea di lettura', 'guide'),
      field('Posizione della linea (% dall\'alto)', bound(h('input', { type: 'range', min: 5, max: 90, step: 1 }), (l) => l.guideY, (v) => updateLayer({ guideY: v }))),
      field('Colore della linea', colorInput('guideColor')))
  ];
}

function fontSelect() {
  const fonts = ['Segoe UI', 'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Helvetica', 'Impact',
    'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
  return select(fonts.map((f) => [f, f]), (l) => l.fontFamily, (v) => updateLayer({ fontFamily: v }));
}

function ndiSection() {
  const nodes = [];
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
  return [card('Sorgente NDI', ...nodes)];
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

  return [card('Periferica di acquisizione',
    field('Periferica', sel),
    h('div', { class: 'row' }, status, h('button', { class: 'small-btn', onclick: () => refresh(true) }, 'Aggiorna elenco')),
    h('p', { class: 'muted small' }, 'Schede di acquisizione, webcam e convertitori HDMI/SDI → USB.')
  )];
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

function renderFooter() {
  const layer = selectedLayer();
  $('panel-footer').hidden = !layer;
  if (!layer) return;
  $('remove-name').textContent = `${TYPE_LABELS[layer.type]}: ${layer.name}`;
  $('btn-remove').textContent = layer.type === 'scene' ? '✕ Elimina scena' : '✕ Elimina input';
  $('btn-reset').hidden = layer.type === 'scene';
}

function removeSelected() {
  const layer = selectedLayer();
  if (!layer) return;
  const msg = layer.type === 'scene' && layer.children.length
    ? `Eliminare la scena "${layer.name}" e i ${layer.children.length} input che contiene?`
    : `Eliminare "${layer.name}"?`;
  if (!confirm(msg)) return;
  send({ type: 'remove-layer', id: layer.id });
  selectedId = null;
}

// Riporta l'input ai valori iniziali (sorgente, file e testo restano).
function resetSelected() {
  const layer = selectedLayer();
  if (!layer || layer.type === 'scene') return;
  if (!confirm(`Riportare "${layer.name}" alle misure e impostazioni iniziali?`)) return;
  send({ type: 'reset-layer', id: layer.id });
}

// --- Elenco elementi (trascinabili) --------------------------------------------

const collapsed = new Set(); // scene chiuse nell'elenco

function renderList() {
  const list = $('layer-list');
  const rows = [];
  for (const layer of [...state.layers].reverse()) {
    rows.push(listRow(layer, null));
    if (layer.type === 'scene' && !collapsed.has(layer.id)) {
      for (const child of [...layer.children].reverse()) rows.push(listRow(child, layer));
      if (!layer.children.length) rows.push(h('li', { class: 'child empty-scene', 'data-scene': layer.id }, 'Scena vuota: trascina qui gli input'));
    }
  }
  list.replaceChildren(...rows);
  if (!state.layers.length) list.append(h('li', { class: 'empty' }, 'Nessun elemento: aggiungine uno.'));
}

function listRow(layer, parent) {
  const isScene = layer.type === 'scene';
  let button;
  if (isScene) {
    const live = state.program === layer.id;
    const pvw = state.studio && state.preview === layer.id;
    if (state.studio) {
      button = h('button', {
        class: `small-btn ${live ? 'live' : pvw ? 'on' : ''}`,
        title: live ? 'Questa scena è in onda' : 'Metti in anteprima: poi CUT o FADE la manda in onda',
        onclick: (e) => { e.stopPropagation(); send({ type: 'preview', id: layer.id }); }
      }, live ? 'In onda' : 'Anteprima');
    } else {
      button = h('button', {
        class: `small-btn ${live ? 'live' : ''}`,
        title: live ? 'In onda: clic per toglierla' : 'Manda subito in onda questa scena',
        onclick: (e) => { e.stopPropagation(); send({ type: 'program', id: layer.id }); }
      }, live ? 'In onda' : 'Manda in onda');
    }
  } else {
    button = h('button', {
      class: `small-btn ${layer.visible ? 'on' : ''}`,
      title: layer.visible ? 'Visibile: clic per nascondere' : 'Nascosto: clic per mostrare',
      onclick: (e) => { e.stopPropagation(); send({ type: 'update-layer', id: layer.id, patch: { visible: !layer.visible } }); }
    }, layer.visible ? 'Visibile' : 'Nascosto');
  }
  const caret = isScene
    ? h('span', {
      class: 'caret',
      title: 'Apri/chiudi la scena',
      onclick: (e) => {
        e.stopPropagation();
        if (collapsed.has(layer.id)) collapsed.delete(layer.id);
        else collapsed.add(layer.id);
        renderList();
      }
    }, collapsed.has(layer.id) ? '▸' : '▾')
    : null;
  const copies = linkCount(layer);
  const li = h('li', {
    class: [
      layer.id === selectedId ? 'selected' : '',
      !isScene && !layer.visible ? 'hidden-layer' : '',
      isScene ? 'scene' : '',
      parent ? 'child' : '',
      isScene && state.program === layer.id ? 'is-live' : ''
    ].join(' '),
    'data-id': layer.id
  },
  caret,
  h('span', { class: 'tag' }, TYPE_LABELS[layer.type]),
  h('span', { class: 'name' }, layer.name, isScene ? h('span', { class: 'muted' }, ` (${layer.children.length})`) : null),
  copies > 1 ? h('span', { class: 'link', title: `Stesso input in ${copies} punti: la sorgente è condivisa` }, '🔗') : null,
  button);
  li.addEventListener('pointerdown', (e) => startListDrag(e, layer, li));
  return li;
}

function select_(id) {
  selectedId = id;
  // In modalità studio scegliere una scena (o un suo input) la mette in anteprima.
  const scene = sceneOf(id);
  if (state.studio && scene && state.preview !== scene.id) send({ type: 'preview', id: scene.id });
  render(state);
}

// Trascinamento nell'elenco: una linea mostra dove finirà l'elemento,
// la scena sotto al puntatore si illumina se l'elemento andrà dentro.
// Lo spostamento avviene solo al rilascio del tasto.
let listDrag = null;

function startListDrag(e, layer, li) {
  if (e.button !== 0 || e.target.closest('button') || e.target.classList.contains('caret')) return;
  listDrag = { layer, li, startY: e.clientY, active: false, target: null };
  window.addEventListener('pointermove', onListDrag);
  window.addEventListener('pointerup', endListDrag, { once: true });
}

function onListDrag(e) {
  if (!listDrag) return;
  if (!listDrag.active) {
    if (Math.abs(e.clientY - listDrag.startY) < 5) return;
    listDrag.active = true;
    listDrag.li.classList.add('dragging');
    document.body.classList.add('list-dragging');
  }
  listDrag.copy = e.ctrlKey;
  listDrag.target = dropTarget(e.clientY);
  showDropTarget(listDrag.target);
}

// Calcola dove andrebbe l'elemento con il puntatore all'altezza y.
function dropTarget(y) {
  const dragged = listDrag.layer;
  const rows = [...$('layer-list').querySelectorAll('li[data-id], li.empty-scene')];
  // Sotto la fine dell'elenco: in fondo a tutto, fuori dalle scene.
  const lastRow = rows[rows.length - 1];
  if (lastRow && y > lastRow.getBoundingClientRect().bottom + 6 && state.layers.length) {
    const back = state.layers[0];
    if (back.id === dragged.id && state.layers.length === 1) return null;
    return { parentId: null, refId: back.id, where: 'behind', row: lastRow, before: false, end: true };
  }
  for (const row of rows) {
    const r = row.getBoundingClientRect();
    if (y > r.bottom && row !== rows[rows.length - 1]) continue;
    const rel = Math.min(1, Math.max(0, (y - r.top) / r.height));
    if (row.classList.contains('empty-scene')) {
      if (dragged.type === 'scene') return null;
      return { parentId: row.dataset.scene, refId: null, line: null, into: row.dataset.scene };
    }
    const layer = layerById(row.dataset.id);
    const node = findNode(state.layers, layer.id);
    if (layer.type === 'scene' && dragged.type !== 'scene' && rel > 0.25 && rel < 0.75) {
      // Dentro la scena (video e immagini sotto a timer e banner).
      return { parentId: layer.id, refId: null, into: layer.id };
    }
    let target = { parentId: node.parent ? node.parent.id : null, refId: layer.id, where: rel < 0.5 ? 'front' : 'behind', row, before: rel < 0.5 };
    // Sotto una scena aperta con input: si entra nella scena.
    if (!target.before && layer.type === 'scene' && dragged.type !== 'scene' && !collapsed.has(layer.id) && layer.children.length) {
      return { parentId: layer.id, refId: null, into: layer.id };
    }
    // Una scena non entra in un'altra scena: si mette accanto alla scena.
    if (dragged.type === 'scene' && node.parent) {
      const sceneRow = $('layer-list').querySelector(`li[data-id="${node.parent.id}"]`);
      target = { parentId: null, refId: node.parent.id, where: 'behind', row: sceneRow, before: false, afterGroup: true };
    }
    return target;
  }
  return null;
}

function showDropTarget(t) {
  const line = $('drop-line');
  for (const el of document.querySelectorAll('#layer-list li.drop-into')) el.classList.remove('drop-into');
  if (!t) {
    line.hidden = true;
    return;
  }
  if (t.into) {
    line.hidden = true;
    const row = $('layer-list').querySelector(`li[data-id="${t.into}"]`);
    if (row) row.classList.add('drop-into');
    return;
  }
  const wrap = $('list-wrap').getBoundingClientRect();
  let ref = t.row.getBoundingClientRect();
  let y = t.before ? ref.top : ref.bottom;
  if (t.end) ref = $('layer-list').getBoundingClientRect();
  if (t.afterGroup) {
    // Dopo tutto il gruppo della scena (scena + suoi input).
    let last = t.row;
    while (last.nextElementSibling && last.nextElementSibling.classList.contains('child')) last = last.nextElementSibling;
    ref = last.getBoundingClientRect();
    y = ref.bottom;
  }
  line.hidden = false;
  line.style.top = `${y - wrap.top - 1}px`;
  line.style.left = `${ref.left - wrap.left}px`;
  line.style.width = `${ref.width}px`;
}

function endListDrag(e) {
  window.removeEventListener('pointermove', onListDrag);
  const d = listDrag;
  listDrag = null;
  $('drop-line').hidden = true;
  document.body.classList.remove('list-dragging');
  for (const el of document.querySelectorAll('#layer-list li.drop-into, #layer-list li.dragging')) el.classList.remove('drop-into', 'dragging');
  if (!d || !d.active) {
    if (d) select_(d.layer.id);
    return;
  }
  const t = d.target;
  if (!t || t.refId === d.layer.id) return;
  send({ type: 'move-node', id: d.layer.id, parentId: t.parentId, refId: t.refId, where: t.where, copy: e.ctrlKey || d.copy });
}

// --- Scene e modalità studio ---------------------------------------------------

function sceneSection(scene) {
  const live = state.program === scene.id;
  const actions = state.studio
    ? h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: () => send({ type: 'preview', id: scene.id }) }, 'Metti in anteprima'),
      h('span', { class: 'muted small' }, live ? 'Questa scena è in onda.' : 'Poi CUT o FADE la manda in onda.'))
    : h('div', { class: 'row' },
      h('button', { class: live ? 'live' : 'primary', onclick: () => send({ type: 'program', id: scene.id }) }, live ? 'Togli dall\'onda' : 'Manda in onda'),
      h('span', { class: 'muted small' }, live ? 'Questa scena è in onda.' : 'Il cambio di scena è immediato.'));
  return [
    card('Scena',
      field('Nome', textInput('name')),
      actions,
      h('p', { class: 'muted small' }, `Contiene ${scene.children.length} input. In onda va una scena alla volta, insieme agli input che non sono in nessuna scena (per esempio un logo sempre presente).`)),
    card('Come si usa',
      h('p', { class: 'muted small' }, 'Con la scena selezionata, i pulsanti "Aggiungi" mettono i nuovi input dentro la scena.'),
      h('p', { class: 'muted small' }, 'Trascina un input sulla scena per spostarlo dentro. Tieni premuto Ctrl mentre rilasci per usare lo stesso input anche in questa scena: la sorgente (videocamera, NDI, video) resta una sola e la CPU non lavora il doppio.'),
      h('p', { class: 'muted small' }, 'Modalità studio (in alto a destra): a sinistra l\'anteprima della prossima scena, a destra quella in onda, e in mezzo CUT e FADE.'))
  ];
}

let programStream = null;
let programStarting = false;

async function startProgramMonitor() {
  if (programStream || programStarting) return;
  programStarting = true;
  const video = $('program-video');
  try {
    const id = await api.outputSourceId();
    if (!id) return;
    // Copia leggera dell'uscita: piccola e a 15 fotogrammi al secondo.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxWidth: 640, maxHeight: 360, maxFrameRate: 15 } }
    });
    if (!state.studio) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    programStream = stream;
    video.srcObject = stream;
    await video.play();
    $('program').classList.add('has-video');
  } catch (err) {
    console.error('Monitor del programma non disponibile:', err);
  } finally {
    programStarting = false;
  }
}

function stopProgramMonitor() {
  if (programStream) programStream.getTracks().forEach((t) => t.stop());
  programStream = null;
  $('program-video').srcObject = null;
  $('program').classList.remove('has-video');
}

// Riquadro con le proporzioni dell'uscita, il più grande possibile nello spazio.
function fitScreen(wrap, screen) {
  const out = state.output;
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;
  if (!W || !H) return;
  const ratio = out.width / out.height;
  const w = Math.min(W, H * ratio);
  screen.style.width = `${Math.floor(w)}px`;
  screen.style.height = `${Math.floor(w / ratio)}px`;
}

function fitScreens() {
  if (!state) return;
  fitScreen($('preview-wrap'), $('preview'));
  fitScreen($('program-wrap'), $('program'));
  // In modalità studio gli schermi sono più stretti: l'altezza avanzata va ai comandi.
  const mon = $('monitors');
  if (state.studio) {
    const need = $('preview').offsetHeight + $('preview-title').offsetHeight + 4;
    const max = Math.max(200, window.innerHeight * 0.36);
    const hgt = `${Math.min(max, Math.max(need, 160))}px`;
    if (mon.style.height !== hgt) mon.style.height = hgt;
  } else if (mon.style.height) {
    mon.style.height = '';
  }
}
new ResizeObserver(fitScreens).observe($('preview-wrap'));
new ResizeObserver(fitScreens).observe($('program-wrap'));

function renderStudio() {
  const studio = !!state.studio;
  document.body.classList.toggle('studio', studio);
  $('btn-studio').classList.toggle('on', studio);
  $('btn-studio').textContent = studio ? 'Modalità studio: attiva' : 'Modalità studio';
  $('switcher').hidden = !studio;
  $('mon-program').hidden = !studio;
  if (document.activeElement !== $('sel-fade')) $('sel-fade').value = String(state.fadeMs);
  const viewId = viewSceneId();
  const viewScene = layerById(viewId);
  const program = layerById(state.program);
  const title = $('preview-title');
  title.classList.remove('live', 'off');
  if (studio) {
    title.textContent = viewScene ? `Anteprima: ${viewScene.name}` : 'Anteprima: nessuna scena';
    title.classList.add('pvw');
    $('program-title').textContent = program ? `In onda: ${program.name}` : 'In onda: nessuna scena';
    programStage.update(composeLayers(state.layers, program ? [program.id] : []), state.background);
    startProgramMonitor();
  } else {
    title.classList.remove('pvw');
    if (viewScene && viewId !== state.program) {
      title.textContent = `Scena "${viewScene.name}" (non in onda)`;
      title.classList.add('off');
    } else {
      title.textContent = program ? `Uscita: ${program.name}` : 'Uscita';
      title.classList.add('live');
    }
    stopProgramMonitor();
  }
  const target = addTargetScene();
  $('add-target').textContent = target ? `I nuovi input vanno nella scena "${target.name}".` : '';
  fitScreens();
}

// Scena in cui finiscono i nuovi input: quella selezionata (o dell'input selezionato).
function addTargetScene() {
  return sceneOf(selectedId);
}

// --- Anteprima con trascinamento -----------------------------------------------

const stage = createStage($('stage'), { placeholders: true, showHidden: true });
const programStage = createStage($('program-stage'), { placeholders: true });
const overlay = $('overlay');
let drag = null;

function renderOverlay() {
  const boxes = previewLayers().map((layer, i) => {
    const handles = ['nw', 'ne', 'sw', 'se'].map((c) => h('div', { class: `handle ${c}`, 'data-corner': c }));
    if (isVisual(layer.type)) {
      for (const side of ['top', 'right', 'bottom', 'left']) {
        handles.push(h('div', { class: `handle crop c-${side}`, 'data-crop': side, title: 'Trascina per ritagliare' }));
      }
    }
    const box = h('div', {
      class: `box ${layer.id === selectedId ? 'selected' : ''}`,
      style: `left:${layer.x}%;top:${layer.y}%;width:${layer.w}%;height:${layer.h}%;z-index:${layer.id === selectedId ? 1000 : i + 1}`
    }, handles);
    box.addEventListener('pointerdown', (e) => {
      const d = e.target.dataset;
      if (d.corner) startDrag(e, layer, 'resize', d.corner);
      else if (d.crop) startDrag(e, layer, 'crop', d.crop);
      else startDrag(e, layer, 'move');
    });
    return box;
  });
  overlay.replaceChildren(...boxes);
}

function startDrag(e, layer, mode, handle) {
  e.preventDefault();
  e.stopPropagation();
  if (selectedId !== layer.id) select_(layer.id);
  const rect = overlay.getBoundingClientRect();
  drag = {
    id: layer.id, mode, handle, startX: e.clientX, startY: e.clientY, rect,
    orig: { x: layer.x, y: layer.y, w: layer.w, h: layer.h, crop: { ...layer.crop } }, pending: null
  };
  window.addEventListener('pointermove', onDrag);
  window.addEventListener('pointerup', endDrag, { once: true });
}

function snap(v) {
  for (const t of [0, 50, 100]) if (Math.abs(v - t) < 1) return t;
  return round(v);
}

// Ridimensiona da uno dei quattro angoli: l'angolo opposto resta fermo.
function resizePatch(o, corner, dx, dy, keepRatio) {
  const west = corner.includes('w');
  const north = corner.includes('n');
  let w = Math.max(2, o.w + (west ? -dx : dx));
  let hh = Math.max(2, o.h + (north ? -dy : dy));
  if (keepRatio) hh = w * (o.h / o.w);
  // Aggancia ai bordi e al centro il lato che si muove.
  if (west) w = (o.x + o.w) - snap(o.x + o.w - w);
  else w = snap(o.x + w) - o.x;
  if (!keepRatio) {
    if (north) hh = (o.y + o.h) - snap(o.y + o.h - hh);
    else hh = snap(o.y + hh) - o.y;
  }
  w = Math.max(2, w);
  hh = Math.max(2, hh);
  return {
    x: round(west ? o.x + o.w - w : o.x),
    y: round(north ? o.y + o.h - hh : o.y),
    w: round(w),
    h: round(hh)
  };
}

// Ritaglia un lato: il riquadro si accorcia insieme al ritaglio, così la
// parte che resta dell'immagine non si sposta.
function cropPatch(o, side, dx, dy) {
  const c = { ...o.crop };
  const visW = 100 - c.left - c.right;
  const visH = 100 - c.top - c.bottom;
  const horizontal = side === 'left' || side === 'right';
  const size = horizontal ? o.w : o.h;
  const vis = horizontal ? visW : visH;
  // Spostamento verso l'interno del riquadro, in % dello schermo.
  let inward = { left: dx, right: -dx, top: dy, bottom: -dy }[side];
  // Limiti: il riquadro resta almeno del 2% e il ritaglio tra 0 e il 95% in tutto.
  const other = { left: c.right, right: c.left, top: c.bottom, bottom: c.top }[side];
  const maxCrop = 95 - other;
  inward = Math.min(inward, size - 2, ((maxCrop - c[side]) / vis) * size);
  inward = Math.max(inward, (-c[side] / vis) * size);
  c[side] = round(Math.max(0, c[side] + (inward / size) * vis));
  const patch = { crop: c };
  if (side === 'left') Object.assign(patch, { x: round(o.x + inward), w: round(o.w - inward) });
  if (side === 'right') patch.w = round(o.w - inward);
  if (side === 'top') Object.assign(patch, { y: round(o.y + inward), h: round(o.h - inward) });
  if (side === 'bottom') patch.h = round(o.h - inward);
  return patch;
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
  } else if (drag.mode === 'resize') {
    patch = resizePatch(o, drag.handle, dx, dy, e.shiftKey);
  } else {
    patch = cropPatch(o, drag.handle, dx, dy);
  }
  const layer = layerById(drag.id);
  Object.assign(layer, patch);
  stage.update(previewLayers(), state.background);
  renderOverlay();
  refreshBindings();
  if (!drag.pending) {
    drag.pending = requestAnimationFrame(() => {
      if (!drag) return;
      drag.pending = null;
      sendGeometry(drag.id);
    });
  }
}

function sendGeometry(id) {
  const l = layerById(id);
  if (l) send({ type: 'update-layer', id, patch: { x: l.x, y: l.y, w: l.w, h: l.h, crop: { ...l.crop } } });
}

function endDrag() {
  window.removeEventListener('pointermove', onDrag);
  if (drag) sendGeometry(drag.id);
  drag = null;
}

overlay.addEventListener('pointerdown', () => { select_(null); });

// --- Stato generale ----------------------------------------------------------

function render(next) {
  state = next;
  if (selectedId && !selectedLayer()) selectedId = null;
  if (drag) return; // durante il trascinamento comanda l'anteprima locale

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

  renderStudio();
  stage.update(previewLayers(), state.background);
  renderOverlay();
  if (!listDrag || !listDrag.active) renderList();
  renderFooter();

  const layer = selectedLayer();
  const key = panelKeyOf(layer);
  if (key !== panelKey) buildPanel();
  else refreshBindings();
}

for (const b of document.querySelectorAll('[data-add]')) {
  b.addEventListener('click', () => {
    const before = new Set(allLayers(state.layers).map((l) => l.id));
    const target = addTargetScene();
    const sceneId = target ? target.id : null;
    // Per i media prima si sceglie il file, poi arriva il nuovo elemento.
    if (b.dataset.add === 'media') send({ type: 'add-media', sceneId });
    else send({ type: 'add-layer', layerType: b.dataset.add, sceneId });
    // Seleziona il nuovo elemento appena arriva lo stato aggiornato.
    pendingSelect = before;
  });
}
let pendingSelect = null;

$('btn-show-all').onclick = () => send({ type: 'show-all' });
$('btn-toggle-display').onclick = () => send({ type: 'toggle-display' });
$('btn-remove').onclick = () => removeSelected();
$('btn-reset').onclick = () => resetSelected();
$('btn-save-config').onclick = () => send({ type: 'save-config' });
$('btn-open-config').onclick = () => send({ type: 'open-config' });
$('btn-studio').onclick = () => send({ type: 'set-studio', on: !state.studio });
$('btn-cut').onclick = () => send({ type: 'take', kind: 'cut' });
$('btn-fade').onclick = () => send({ type: 'take', kind: 'fade' });
$('sel-fade').onchange = (e) => send({ type: 'set-fade', ms: Number(e.target.value) });
$('sel-display').onchange = (e) => send({ type: 'set-display', displayId: Number(e.target.value) });
$('col-background').oninput = (e) => send({ type: 'set-background', color: e.target.value });
$('btn-pick-background').onclick = async (e) => {
  e.preventDefault();
  const color = await api.pickColor();
  if (color) send({ type: 'set-background', color });
};

document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
  const layer = selectedLayer();
  if (layer && layer.type === 'prompter' && prompterKey(e, layer)) return;
  if (e.code === 'Space') {
    e.preventDefault();
    const timer = layer && layer.type === 'timer' ? layer : allLayers(state.layers).find((l) => l.type === 'timer');
    if (timer) send({ type: 'timer', id: timer.id, action: timer.run.running ? 'pause' : 'start' });
  }
});

api.onState((next) => {
  if (pendingSelect) {
    const added = allLayers(next.layers).find((l) => !pendingSelect.has(l.id));
    if (added) {
      selectedId = added.id;
      pendingSelect = null;
    }
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
// Il pannello si ricostruisce quando cambia l'elemento selezionato, il suo
// tipo o (per i media) il passaggio tra video e immagine; per le scene anche
// quando cambiano modalità studio, scena in onda e numero di input.
function panelKeyOf(layer) {
  if (!layer) return null;
  const extra = layer.type === 'scene' ? `${state.studio}:${state.program}:${layer.children.length}` : linkCount(layer);
  return `${layer.id}:${layer.type}:${layer.mediaKind || ''}:${extra}`;
}
