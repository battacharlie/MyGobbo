// Regia: menu, anteprima dell'uscita (o i due schermi della modalità studio),
// proprietà dell'elemento selezionato ed elenco degli elementi.
// I testi sono in italiano e passano da t() per la traduzione in inglese.
const { TYPE_LABELS, TIMER_COLORS, FPS_CHOICES, isVisual, timerValueMs, formatTime, timerColor, timerShowsClock, formatClock, allLayers, findNode, composeLayers, prompterY } = window.Layers;
const t = (text, vars) => I18n.t(text, vars);
const api = window.countdown;
const send = (cmd) => api.send(cmd);
// Gli elementi restano raggiungibili anche quando la sezione dettagli è
// spostata in una finestra separata.
const elCache = {};
const $ = (id) => {
  const cached = elCache[id];
  if (cached && cached.isConnected) return cached;
  const el = document.getElementById(id);
  if (el) elCache[id] = el;
  return el;
};
const typeLabel = (type) => t(TYPE_LABELS[type]);

let state = null;
let selectedId = null;
let panelKey = null; // id+tipo dell'elemento mostrato nel pannello
let bindings = []; // campi del pannello da aggiornare quando cambia lo stato
let panelTick = null; // aggiornamento periodico del pannello (timer, sorgenti)

// Preferenze della regia che restano su questo computer (disposizione,
// schede chiuse, unità di misura).
const prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`igor.${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`igor.${key}`, JSON.stringify(value));
    } catch { /* memoria locale non disponibile */ }
  }
};

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

// Spiegazione che si può nascondere dal menu Visualizza.
function help(text) {
  return h('p', { class: 'muted small help' }, text);
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

// Scene nell'ordine dell'elenco (dall'alto): il numero usato da MIDI e Companion.
function scenesInOrder() {
  return [...state.layers].reverse().filter((l) => l.type === 'scene');
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

// Elementi in onda adesso (visibili in uscita).
function onAirLayers() {
  return composeLayers(state.layers, state.program ? [state.program] : []).filter((l) => l.visible);
}

// Quante comparse ha lo stesso input (copie collegate in più scene).
function linkCount(layer) {
  return layer.link ? allLayers(state.layers).filter((l) => l.link === layer.link).length : 1;
}

function updateLayer(patch, layer = selectedLayer()) {
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
  return h('label', { class: 'field' }, h('span', {}, t(label)), input);
}

function numberInput(get, set, attrs = {}) {
  return bound(h('input', { type: 'number', step: 'any', ...attrs }), get, set);
}

function textInput(prop, attrs = {}) {
  return bound(h('input', { type: 'text', ...attrs }), (l) => l[prop], (v) => updateLayer({ [prop]: v }));
}

// Cursore con il numero accanto.
function rangeField(label, prop, min, max, step, clampMin = min, clampMax = max) {
  return field(label, h('div', { class: 'row' },
    bound(h('input', { type: 'range', min, max, step }), (l) => l[prop], (v) => updateLayer({ [prop]: v })),
    numberInput((l) => l[prop], (v) => updateLayer({ [prop]: clamp(v, clampMin, clampMax) }), { min: clampMin, max: clampMax, step, style: 'width:72px' })));
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
    title: t('Preleva il colore da qualsiasi punto dello schermo o da un\'immagine'),
    onclick: async (e) => {
      e.preventDefault();
      const color = await api.pickColor();
      if (color) onColor(color);
    }
  }, '💧');
}

function checkbox(label, prop) {
  const input = bound(h('input', { type: 'checkbox' }), (l) => l[prop], (v) => updateLayer({ [prop]: v }), 'change');
  return h('label', { class: 'check' }, input, t(label));
}

function select(options, get, set) {
  const el = h('select', {}, options.map(([value, label]) => h('option', { value }, t(label))));
  return bound(el, get, set, 'change');
}

function refreshBindings() {
  const layer = selectedLayer();
  if (!layer) return;
  for (const b of bindings) {
    if (b.html) {
      // L'editor del TelePrompt si aggiorna solo quando non ci si sta scrivendo.
      if (b.el.ownerDocument.activeElement !== b.el && b.el.dataset.html !== b.get(layer)) {
        b.el.dataset.html = b.get(layer);
        b.el.innerHTML = b.get(layer);
      }
      continue;
    }
    if (b.text) {
      const text = b.get(layer);
      if (b.el.textContent !== text) b.el.textContent = text;
      continue;
    }
    if (b.el.ownerDocument.activeElement === b.el) continue;
    const v = b.get(layer);
    if (b.isCheck) b.el.checked = !!v;
    else if (b.el.value !== String(v ?? '')) b.el.value = v ?? '';
  }
}

// --- Schede del pannello -------------------------------------------------------
// Le schede dei dettagli sono finestrelle libere: all'inizio sono disposte su
// 4 colonne (2 righe se sono più di 4), poi ognuna si sposta trascinando il
// titolo e si ridimensiona dai bordi, indipendentemente dalle altre. Vicino ai
// bordi delle altre schede si aggancia come una calamita. Se escono dallo
// spazio visibile compare la barra di scorrimento.
// - Clic sul titolo senza trascinare, o linguetta ▾: riduce a barra.
// - Pulsante ⧉: apre la scheda in una finestra separata (si può portare su un
//   altro monitor). Chiudendo la finestra la scheda torna nella regia.
// Posizioni, misure e schede ridotte restano memorizzate per ogni tipo di input.

const CARD_GAP = 12;
const CARD_MIN_W = 200;
const CARD_MIN_H = 120;
const CARD_SNAP = 10;
const collapsedCards = new Set(prefs.get('collapsedCards2', []));
const cardPos = prefs.get('cardPos', {}); // chiave -> { x, y, w, h } in pixel
const poppedCards = new Map(); // chiave -> finestra separata
let panelType = ''; // tipo dell'input mostrato, per memorizzare le scelte
let cardZ = 10;

function card(title, ...children) {
  const key = `${panelType}:${title}`;
  const el = h('section', { class: `card ${collapsedCards.has(key) ? 'collapsed' : ''}`, 'data-card': title, 'data-key': key });
  const popBtn = h('button', { class: 'card-tab card-pop', title: t('Apri la scheda in una finestra separata') }, '⧉');
  const tab = h('button', { class: 'card-tab card-fold', title: t('Riduci o apri la scheda') }, '');
  const head = h('h3', { class: 'card-head', title: t('Clic per ridurre o aprire la scheda, tieni premuto e trascina per spostarla') },
    h('span', { class: 'card-title' }, t(title)), h('span', { class: 'card-btns' }, popBtn, tab));
  for (const b of [popBtn, tab]) b.addEventListener('pointerdown', (e) => e.stopPropagation());
  tab.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCard(el);
  });
  popBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (poppedCards.has(key)) returnCard(key);
    else popOutCard(key, title);
  });
  head.addEventListener('pointerdown', (e) => startCardMove(e, el));
  const body = h('div', { class: 'card-body' }, children.flat().filter((c) => c != null));
  el.append(head, body);
  for (const edge of ['r', 'b', 'rb']) {
    const handle = h('div', { class: `card-edge edge-${edge}`, title: t('Trascina per cambiare le misure della scheda') });
    handle.addEventListener('pointerdown', (e) => startCardResize(e, el, edge));
    el.append(handle);
  }
  return el;
}

function toggleCard(el) {
  el.classList.toggle('collapsed');
  if (el.classList.contains('collapsed')) collapsedCards.add(el.dataset.key);
  else collapsedCards.delete(el.dataset.key);
  prefs.set('collapsedCards2', [...collapsedCards]);
  layoutCards();
}

// Schede nella regia (non quelle aperte in una finestra separata).
function boardCards() {
  return [...$('cards').querySelectorAll(':scope > .card')];
}

function cardArea() {
  const panel = $('panel');
  return { W: Math.max(CARD_MIN_W, panel.clientWidth - 2), H: Math.max(CARD_MIN_H, panel.clientHeight - 2) };
}

// Posizioni iniziali: 4 colonne a tutta altezza, 2 righe con più di 4 schede.
function defaultCardRects(n) {
  const { W, H } = cardArea();
  const w = Math.max(CARD_MIN_W, Math.floor((W - CARD_GAP * 3) / 4));
  const rows = n > 4 ? 2 : 1;
  const hh = Math.max(CARD_MIN_H * 1.5, Math.floor((H - CARD_GAP * (rows - 1)) / rows));
  return Array.from({ length: n }, (_, i) => ({
    x: (i % 4) * (w + CARD_GAP),
    y: Math.floor(i / 4) * (hh + CARD_GAP),
    w,
    h: hh
  }));
}

// Mette ogni scheda al suo posto: quello memorizzato o, per le schede mai
// spostate, quello iniziale (sotto le altre se qualcuna è già stata spostata).
function layoutCards() {
  const cards = boardCards();
  const defaults = defaultCardRects(cards.length);
  const anySaved = cards.some((el) => cardPos[el.dataset.key]);
  let bottom = 0;
  for (const el of cards) {
    const p = cardPos[el.dataset.key];
    if (p) bottom = Math.max(bottom, p.y + p.h);
  }
  let extra = 0;
  const { W } = cardArea();
  cards.forEach((el, i) => {
    let r = cardPos[el.dataset.key];
    if (!r) {
      r = defaults[i];
      if (anySaved) {
        const w = defaults[0].w;
        r = { x: (extra % 4) * (w + CARD_GAP), y: bottom + CARD_GAP + Math.floor(extra / 4) * (CARD_MIN_H * 2 + CARD_GAP), w, h: CARD_MIN_H * 2 };
        extra++;
      }
    }
    el.style.left = `${Math.min(r.x, Math.max(0, W - 60))}px`;
    el.style.top = `${r.y}px`;
    el.style.width = `${r.w}px`;
    el.style.height = el.classList.contains('collapsed') ? '' : `${r.h}px`;
  });
  updateCardsHeight();
}

// L'area delle schede è alta quanto serve: se è più alta dello spazio
// visibile compare la barra di scorrimento.
function updateCardsHeight() {
  let bottom = 0;
  for (const el of boardCards()) bottom = Math.max(bottom, el.offsetTop + el.offsetHeight);
  $('cards').style.height = `${bottom + 4}px`;
}

function cardRect(el) {
  return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
}

function saveCardRect(el) {
  const r = cardRect(el);
  const saved = cardPos[el.dataset.key];
  // Una scheda ridotta conserva l'altezza che aveva da aperta.
  if (el.classList.contains('collapsed') && saved) r.h = saved.h;
  cardPos[el.dataset.key] = r;
  // Fissa anche le altre schede dove sono adesso, così non si spostano più.
  for (const other of boardCards()) {
    if (!cardPos[other.dataset.key]) {
      const o = cardRect(other);
      if (other.classList.contains('collapsed')) o.h = parseFloat(other.dataset.openH) || CARD_MIN_H * 2;
      cardPos[other.dataset.key] = o;
    }
  }
  prefs.set('cardPos', cardPos);
}

// Calamita: aggancia un valore ai bordi delle altre schede.
function snapValue(v, targets) {
  let best = v;
  let dist = CARD_SNAP;
  for (const tv of targets) {
    if (Math.abs(v - tv) < dist) {
      dist = Math.abs(v - tv);
      best = tv;
    }
  }
  return best;
}

function snapTargets(el) {
  const xs = [0];
  const ys = [0];
  for (const o of boardCards()) {
    if (o === el) continue;
    const r = cardRect(o);
    xs.push(r.x, r.x + r.w, r.x + r.w + CARD_GAP, r.x - CARD_GAP);
    ys.push(r.y, r.y + r.h, r.y + r.h + CARD_GAP, r.y - CARD_GAP);
  }
  return { xs, ys };
}

// Trascinamento dal titolo: sotto i 5 pixel di movimento è un clic, che
// riduce o apre la scheda; oltre, la scheda si sposta dove si vuole.
function startCardMove(e, el) {
  if (e.button !== 0) return;
  e.preventDefault();
  el.style.zIndex = ++cardZ;
  const win = el.ownerDocument.defaultView;
  const popped = !el.parentElement || el.parentElement !== $('cards');
  const startX = e.clientX;
  const startY = e.clientY;
  const start = cardRect(el);
  let moving = false;
  let targets = null;
  const move = (ev) => {
    if (!moving) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5 || popped) return;
      moving = true;
      targets = snapTargets(el);
      el.classList.add('moving');
      el.ownerDocument.body.classList.add('card-dragging');
    }
    const { W } = cardArea();
    let x = clamp(start.x + ev.clientX - startX, 0, Math.max(0, W - 60));
    let y = Math.max(0, start.y + ev.clientY - startY);
    // Aggancia il bordo sinistro o destro, quello alto o basso.
    const sx = snapValue(x, targets.xs);
    const sxr = snapValue(x + start.w, targets.xs) - start.w;
    x = sx !== x ? sx : sxr;
    const sy = snapValue(y, targets.ys);
    const syb = snapValue(y + el.offsetHeight, targets.ys) - el.offsetHeight;
    y = sy !== y ? sy : syb;
    el.style.left = `${Math.max(0, x)}px`;
    el.style.top = `${Math.max(0, y)}px`;
    updateCardsHeight();
  };
  const up = () => {
    win.removeEventListener('pointermove', move);
    el.classList.remove('moving');
    el.ownerDocument.body.classList.remove('card-dragging');
    if (!moving) {
      if (!popped) toggleCard(el);
      return;
    }
    saveCardRect(el);
  };
  win.addEventListener('pointermove', move);
  win.addEventListener('pointerup', up, { once: true });
}

// Bordi della scheda: destro = larghezza, inferiore = altezza, angolo = entrambe.
// Le schede attaccate sotto (o a destra) si accorciano per fare spazio, e si
// allungano quando la scheda si rimpicciolisce; le altre colonne non cambiano.
function startCardResize(e, el, edge) {
  e.preventDefault();
  e.stopPropagation();
  if (el.parentElement !== $('cards')) return; // nella finestra separata decide la finestra
  if (el.classList.contains('collapsed')) toggleCard(el);
  el.style.zIndex = ++cardZ;
  const win = el.ownerDocument.defaultView;
  const start = cardRect(el);
  const startX = e.clientX;
  const startY = e.clientY;
  const targets = snapTargets(el);
  const { W } = cardArea();
  const near = CARD_GAP + 6;
  const others = boardCards().filter((o) => o !== el && !o.classList.contains('collapsed')).map((o) => ({ el: o, r: cardRect(o) }));
  // Schede attaccate sotto: si sovrappongono in orizzontale e iniziano subito dopo.
  const below = others.filter(({ r }) => r.x < start.x + start.w - 2 && r.x + r.w > start.x + 2 && Math.abs(r.y - (start.y + start.h)) <= near);
  // Schede attaccate a destra: si sovrappongono in verticale e iniziano subito dopo.
  const right = others.filter(({ r }) => r.y < start.y + start.h - 2 && r.y + r.h > start.y + 2 && Math.abs(r.x - (start.x + start.w)) <= near);
  el.ownerDocument.body.classList.add('resizing', edge === 'b' ? 'rows' : edge === 'r' ? 'cols' : 'both');
  const move = (ev) => {
    if (edge !== 'b') {
      // La scheda a destra non può scendere sotto la larghezza minima.
      const limit = Math.min(W, ...right.map(({ r }) => r.x + r.w - CARD_GAP - CARD_MIN_W));
      const edgeX = snapValue(clamp(start.x + start.w + ev.clientX - startX, start.x + CARD_MIN_W, Math.max(start.x + CARD_MIN_W, limit)), targets.xs.concat([W]));
      el.style.width = `${edgeX - start.x}px`;
      for (const { el: o, r } of right) {
        o.style.left = `${edgeX + CARD_GAP}px`;
        o.style.width = `${r.x + r.w - edgeX - CARD_GAP}px`;
      }
    }
    if (edge !== 'r') {
      const edgeY = snapValue(Math.max(start.y + CARD_MIN_H, start.y + start.h + ev.clientY - startY), targets.ys);
      el.style.height = `${edgeY - start.y}px`;
      for (const { el: o, r } of below) {
        // Il bordo inferiore della scheda sotto resta fermo finché c'è spazio.
        const top = edgeY + CARD_GAP;
        o.style.top = `${top}px`;
        o.style.height = `${Math.max(CARD_MIN_H, r.y + r.h - top)}px`;
      }
    }
    updateCardsHeight();
  };
  const up = () => {
    win.removeEventListener('pointermove', move);
    el.ownerDocument.body.classList.remove('resizing', 'rows', 'cols', 'both');
    saveCardRect(el);
    for (const { el: o } of below.concat(right)) saveCardRect(o);
  };
  win.addEventListener('pointermove', move);
  win.addEventListener('pointerup', up, { once: true });
}

// --- Finestre separate ---------------------------------------------------------

// Apre una finestra vuota con gli stessi stili della regia.
function openSideWindow(name, title, width, height) {
  const win = window.open('about:blank', name, `width=${Math.round(width)},height=${Math.round(height)}`);
  if (!win) return null;
  const doc = win.document;
  doc.title = `IGOR - ${title}`;
  doc.documentElement.lang = I18n.getLang();
  const css = [...document.styleSheets].map((sheet) => {
    try {
      return [...sheet.cssRules].map((r) => r.cssText).join('\n');
    } catch {
      return '';
    }
  }).join('\n');
  doc.head.append(Object.assign(doc.createElement('style'), { textContent: css }));
  doc.body.className = `side-window ${document.body.classList.contains('hide-help') ? 'hide-help' : ''}`;
  // Gli stessi tasti della regia (spazio, TelePrompt) funzionano anche qui.
  doc.addEventListener('keydown', onControlKey);
  return win;
}

function popOutCard(key, title) {
  const el = $('cards').querySelector(`.card[data-key="${CSS.escape(key)}"]`);
  const r = el ? el.getBoundingClientRect() : { width: 360, height: 420 };
  const win = openSideWindow(`card-${key}`, t(title), Math.max(320, r.width + 40), Math.max(260, r.height + 80));
  if (!win) return;
  const doc = win.document;
  doc.body.append(
    h('div', { class: 'side-bar' },
      h('span', { class: 'muted small side-for' }, ''),
      h('button', { class: 'small-btn', onclick: () => win.close() }, t('Riporta nella regia'))),
    h('div', { class: 'side-content' }));
  win.cardTitle = title;
  win.addEventListener('beforeunload', () => {
    poppedCards.delete(key);
    buildPanel();
  });
  poppedCards.set(key, win);
  buildPanel();
}

function returnCard(key) {
  const win = poppedCards.get(key);
  if (win && !win.closed) win.close();
  poppedCards.delete(key);
  buildPanel();
}

// Dopo aver costruito il pannello: le schede aperte in una finestra separata
// vanno lì, le altre restano nella regia.
function distributePoppedCards() {
  for (const [key, win] of poppedCards) {
    if (win.closed) {
      poppedCards.delete(key);
      continue;
    }
    const box = win.document.querySelector('.side-content');
    const label = win.document.querySelector('.side-for');
    const el = $('cards').querySelector(`.card[data-key="${CSS.escape(key)}"]`);
    const layer = selectedLayer();
    label.textContent = layer ? `${typeLabel(layer.type)}: ${layer.name}` : '';
    if (el) {
      el.classList.remove('collapsed');
      el.removeAttribute('style');
      box.replaceChildren(el);
      el.querySelector('.card-pop').title = t('Riporta la scheda nella regia');
    } else {
      const [type] = key.split(':');
      box.replaceChildren(h('p', { class: 'empty' }, t('Questa scheda compare quando selezioni un input di tipo "{type}".', { type: typeLabel(type) })));
    }
    win.document.body.classList.toggle('hide-help', document.body.classList.contains('hide-help'));
  }
}

// Tutta la sezione dettagli in una finestra separata.
let detailsWin = null;

function popOutDetails() {
  if (detailsWin && !detailsWin.closed) {
    detailsWin.focus();
    return;
  }
  const zone = $('zone-details');
  const r = zone.getBoundingClientRect();
  const win = openSideWindow('details', t('Dettagli input'), r.width, r.height + 40);
  if (!win) return;
  detailsWin = win;
  const panel = $('panel');
  const footer = $('panel-footer');
  win.document.body.classList.add('side-details');
  win.document.body.append(panel, footer);
  zone.append(h('div', { class: 'details-away', id: 'details-away' },
    h('p', { class: 'muted' }, t('I dettagli degli input sono aperti in una finestra separata.')),
    h('button', { onclick: () => win.close() }, t('Riporta nella regia'))));
  new win.ResizeObserver(() => win.requestAnimationFrame(layoutCards)).observe(panel);
  win.addEventListener('beforeunload', () => {
    zone.append(panel, footer);
    const away = $('details-away');
    if (away) away.remove();
    detailsWin = null;
    requestAnimationFrame(layoutCards);
  });
  requestAnimationFrame(layoutCards);
}

new ResizeObserver(() => requestAnimationFrame(layoutCards)).observe($('panel'));

// Testo che si aggiorna da solo quando cambia l'elemento (anche durante il
// trascinamento nell'anteprima).
function liveText(get, attrs = {}) {
  const el = h('div', attrs);
  bindings.push({ el, get, text: true });
  return el;
}

// --- Pannello proprietà ------------------------------------------------------

function placeCards() {
  distributePoppedCards();
  layoutCards();
}

function buildPanel() {
  const panel = $('cards');
  const layer = selectedLayer();
  bindings = [];
  clearInterval(panelTick);
  panelTick = null;
  panel.innerHTML = '';
  panelKey = panelKeyOf(layer);
  panelType = layer ? layer.type : '';

  if (!layer) {
    panel.append(h('p', { class: 'empty' }, t('Seleziona un elemento dall\'elenco o dall\'anteprima, oppure aggiungine uno nuovo.')));
    return;
  }

  if (layer.type === 'scene') {
    panel.append(...sceneSection(layer).filter(Boolean));
    placeCards();
    refreshBindings();
    return;
  }

  const scene = sceneOf(layer.id);
  const copies = linkCount(layer);
  panel.append(card(TYPE_LABELS[layer.type],
    field('Nome', textInput('name')),
    scene ? h('p', { class: 'muted small' }, t('Nella scena "{name}".', { name: scene.name })) : null,
    copies > 1 ? h('p', { class: 'muted small' }, t('🔗 Input presente in {n} punti: sorgente e impostazioni sono condivise, posizione e misure no.', { n: copies })) : null,
    h('div', { class: 'row' },
      checkbox(scene ? 'Visibile nella scena' : 'In onda (visibile in uscita)', 'visible')),
    h('div', { class: 'row' },
      h('button', { onclick: () => send({ type: 'solo', id: layer.id }), title: t('Mostra solo questo elemento (tra quelli dello stesso elenco)') }, t('Solo questo')),
      h('button', { onclick: () => send({ type: 'move-layer', id: layer.id, dir: 1 }), title: t('Porta sopra agli altri elementi (più in primo piano)') }, t('Sopra')),
      h('button', { onclick: () => send({ type: 'move-layer', id: layer.id, dir: -1 }), title: t('Porta sotto agli altri elementi (più verso lo sfondo)') }, t('Sotto')))
  ));

  if (layer.type === 'timer') panel.append(...timerSection(layer));
  if (layer.type === 'ticker') panel.append(...tickerSection());
  if (layer.type === 'prompter') panel.append(...prompterSection(layer));
  if (layer.type === 'ndi') panel.append(...ndiSection());
  if (layer.type === 'capture') panel.append(...captureSection());
  if (layer.type === 'media') panel.append(...mediaSection());

  panel.append(...geometrySection(layer));
  placeCards();
  refreshBindings();
}

// Misure in pixel dell'elemento sullo schermo di uscita, aggiornate in tempo
// reale mentre lo si sposta o ridimensiona.
function pixelInfo(l) {
  const out = state.output;
  const px = (v, total) => Math.round(v * total / 100);
  let text = t('{w} × {h} px · posizione {x}, {y} px', { w: px(l.w, out.width), h: px(l.h, out.height), x: px(l.x, out.width), y: px(l.y, out.height) });
  if (isVisual(l.type)) {
    const c = l.crop;
    const parts = [['sinistra', c.left], ['destra', c.right], ['alto', c.top], ['basso', c.bottom]]
      .filter(([, v]) => v > 0).map(([k, v]) => `${t(k)} ${round(v)}%`);
    text += parts.length ? ` · ${t('ritaglio')} ${parts.join(', ')}` : ` · ${t('nessun ritaglio')}`;
  }
  return text;
}

// Posizione e misure in % dello schermo oppure in pixel dell'uscita.
function geometrySection(layer) {
  const unit = prefs.get('unit', '%');
  const out = state.output;
  const toUnit = (pct, total) => (unit === 'px' ? Math.round((pct * total) / 100) : round(pct));
  const fromUnit = (v, total) => (unit === 'px' ? (v * 100) / total : v);
  const num = (prop, total, min) => numberInput(
    (l) => toUnit(l[prop], total),
    (v) => updateLayer({ [prop]: min != null ? Math.max(min, round(fromUnit(v, total))) : round(fromUnit(v, total)) }),
    unit === 'px' ? { step: 1 } : { min: min != null ? min : -100, max: 400, step: 0.5 });
  const unitBtn = (u) => h('button', {
    class: unit === u ? 'on' : '',
    onclick: () => {
      prefs.set('unit', u);
      buildPanel();
    }
  }, u);
  const suffix = unit === 'px' ? 'px' : '%';
  const nodes = [card('Posizione e misure',
    liveText(pixelInfo, { class: 'px-info' }),
    h('div', { class: 'row' }, h('span', { class: 'muted small' }, t('Unità di misura')), h('span', { class: 'unit-switch' }, unitBtn('%'), unitBtn('px'))),
    h('div', { class: 'grid2' },
      field(`${t('Sinistra (X)')}, ${suffix}`, num('x', out.width)),
      field(`${t('Alto (Y)')}, ${suffix}`, num('y', out.height)),
      field(`${t('Larghezza')}, ${suffix}`, num('w', out.width, 1)),
      field(`${t('Altezza')}, ${suffix}`, num('h', out.height, 1))),
    h('div', { class: 'row' },
      h('button', { onclick: () => updateLayer({ x: 0, y: 0, w: 100, h: 100 }) }, t('Schermo intero')),
      h('button', { onclick: () => center() }, t('Centra')),
      h('button', { onclick: () => fitToSource() }, t('Proporzioni 16:9')))
  )];
  if (isVisual(layer.type)) {
    nodes.push(card('Adattamento e ritaglio',
      field('Adattamento', select(
        [['contain', 'Adatta (mantiene le proporzioni)'], ['cover', 'Riempi (mantiene le proporzioni, taglia)'], ['stretch', 'Deforma (riempie tutto)']],
        (l) => l.fit, (v) => updateLayer({ fit: v }))),
      help(t('Per ritagliare trascina nell\'anteprima le maniglie arancioni a metà dei lati.')),
      h('div', { class: 'row' },
        h('button', { onclick: () => updateLayer({ crop: { top: 0, right: 0, bottom: 0, left: 0 } }) }, t('Togli ritaglio')))
    ));
  }
  return nodes;
}

function timerSection(layer) {
  const big = h('div', { class: 'big-time' }, '00:00');
  const startBtn = h('button', { class: 'primary', onclick: () => {
    const l = selectedLayer();
    send({ type: 'timer', id: l.id, action: l.run.running ? 'pause' : 'start' });
  } }, `▶ ${t('Avvia')}`);
  const adj = (s, label) => h('button', { onclick: () => send({ type: 'timer', id: selectedId, action: 'adjust', seconds: s }) }, label);

  const durMin = numberInput((l) => Math.floor(l.durationSec / 60), (v) => setDuration(v, null), { min: 0, max: 999, step: 1 });
  const durSec = numberInput((l) => l.durationSec % 60, (v) => setDuration(null, v), { min: 0, max: 59, step: 1 });

  const tick = () => {
    const l = selectedLayer();
    if (!l || l.type !== 'timer') return;
    const clock = timerShowsClock(l);
    const value = timerValueMs(l);
    const text = clock ? formatClock(l) : formatTime(value, l.direction);
    if (big.textContent !== text) big.textContent = text;
    big.style.color = clock ? l.color : timerColor(l, value);
    const label = l.run.running ? `❚❚ ${t('Pausa')}` : `▶ ${t('Avvia')}`;
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
        h('button', { onclick: () => send({ type: 'timer', id: selectedId, action: 'reset' }) }, `↺ ${t('Azzera')}`)),
      h('div', { class: 'row' }, adj(-60, '−1 min'), adj(-10, '−10 s'), adj(10, '+10 s'), adj(60, '+1 min')),
      help(t('Barra spaziatrice: avvia/pausa del timer selezionato.'))),
    card('Conteggio',
      field('Direzione', select([['down', 'All\'indietro (countdown)'], ['up', 'In avanti (cronometro)']],
        (l) => l.direction, (v) => updateLayer({ direction: v }))),
      h('div', { class: 'grid2' }, field('Durata: minuti', durMin), field('secondi', durSec)),
      h('div', { class: 'row' }, [5, 10, 15, 30, 45, 60].map((m) =>
        h('button', { class: 'small-btn', onclick: () => { updateLayer({ durationSec: m * 60 }); refreshBindings(); } }, `${m}′`))),
      help(t('All\'indietro, oltre lo zero il tempo continua con il segno +. In avanti la durata è il limite (0 = nessun limite).'))),
    card('Quando il timer è fermo',
      checkbox('Mostra data e ora', 'idleClock'),
      h('div', { class: 'grid2' },
        checkbox('Data', 'clockDate'),
        checkbox('Ore', 'clockHours'),
        checkbox('Minuti', 'clockMinutes'),
        checkbox('Secondi', 'clockSeconds'),
        checkbox('Millesimi', 'clockMs')),
      help(t('Prima dell\'avvio e dopo "Azzera" il timer mostra l\'orologio. Quando parte torna il conteggio.'))),
    card('Colori',
      h('div', { class: 'grid3' },
        field('Partenza', colorInput('color')),
        field('Scadenza vicina', colorInput('warningColor')),
        field('Tempo superato', colorInput('endColor'))),
      field('Scadenza vicina negli ultimi (secondi)', numberInput((l) => l.warningSec, (v) => updateLayer({ warningSec: Math.max(0, v) }), { min: 0, step: 1 })),
      h('div', { class: 'row' },
        h('button', { class: 'small-btn', onclick: () => updateLayer({ ...TIMER_COLORS }) }, t('Verde, giallo, rosso')))),
    card('Tempo superato',
      checkbox('Numeri lampeggianti', 'blink'),
      checkbox('Cornice lungo i bordi dello schermo', 'frame'),
      h('div', { class: 'grid2' },
        field('Colore cornice', colorInput('frameColor')),
        field('Spessore (px)', numberInput((l) => l.frameWidth, (v) => updateLayer({ frameWidth: clamp(v, 1, 200) }), { min: 1, max: 200, step: 1 }))),
      h('div', { class: 'grid2' },
        field('Linea', select([['dashed', 'Tratteggiata'], ['solid', 'Continua']], (l) => l.frameStyle, (v) => updateLayer({ frameStyle: v }))),
        field('Movimento', select([['run', 'Scorre lungo i bordi'], ['blink', 'Lampeggia da ferma'], ['still', 'Fissa']], (l) => l.frameMotion, (v) => updateLayer({ frameMotion: v })))),
      rangeField('Velocità (1 = normale)', 'frameSpeed', 0.25, 5, 0.25),
      help(t('Spessore in pixel su uno schermo Full HD (1080 righe). Una linea continua non può scorrere: sceglila con "Lampeggia" o "Fissa".'))),
    card('Aspetto',
      h('div', { class: 'grid2' },
        field('Colore sfondo', colorInput('background')),
        h('div', {}, checkbox('Sfondo trasparente', 'transparent'))),
      rangeField('Misura carattere (% altezza schermo)', 'fontSize', 2, 60, 0.5, 1, 100),
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
    card('Testo del banner',
      field('Testo', bound(h('textarea', { rows: 3 }), (l) => l.text, (v) => updateLayer({ text: v.replace(/\n/g, ' ') }))),
      help(t('Se il testo è più lungo dello spazio disponibile, scorre da destra a sinistra.')),
      rangeField('Velocità di scorrimento (px/s)', 'speed', 20, 600, 10, 5, 2000),
      h('div', { class: 'row' },
        h('button', { onclick: () => updateLayer({ x: 0, y: 86, w: 100, h: 14 }) }, t('Riporta in basso')))),
    card('Aspetto',
      h('div', { class: 'grid2' },
        field('Colore testo', colorInput('color')),
        field('Colore fascia', colorInput('background'))),
      field('Opacità fascia', bound(h('input', { type: 'range', min: 0, max: 1, step: 0.05 }), (l) => l.opacity, (v) => updateLayer({ opacity: v }))),
      checkbox('Fascia trasparente', 'transparent'),
      rangeField('Misura carattere (% altezza schermo)', 'fontSize', 2, 30, 0.5, 1, 100),
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
  bindings.push({ el: playBtn, get: (l) => (l.playing ? `❚❚ ${t('Pausa')}` : `▶ ${t('Riproduci')}`), text: true });
  const videoControls = [
    h('div', { class: 'row' }, playBtn,
      h('button', { onclick: () => updateLayer({ playing: true, restartAt: Date.now() }) }, `⏮ ${t('Da capo')}`)),
    checkbox('Ripeti all\'infinito', 'loop'),
    field('Riproduzione', select([
      ['always', 'Continua anche quando non è in onda'],
      ['onair', 'Riproduci solo quando è in onda'],
      ['restart', 'Riproduci in onda e riavvolgi quando esce']
    ], (l) => l.playMode, (v) => updateLayer({ playMode: v }))),
    field('Audio (sull\'uscita)', select([
      ['off', 'Disattivato'],
      ['on', 'Attivo'],
      ['follow', 'Segue l\'onda (attivo solo quando è in onda)']
    ], (l) => l.audioMode, (v) => updateLayer({ audioMode: v }))),
    help(t('"In onda" vuol dire visibile sul secondo schermo: nella scena in onda oppure fuori dalle scene.'))
  ];
  return [
    card('File',
      liveText((l) => l.file || t('Nessun file scelto'), { class: 'px-info' }),
      h('div', { class: 'row' },
        h('button', { onclick: () => send({ type: 'pick-media', id: selectedId }) }, t('Scegli file…'))),
      isVideo() ? videoControls : help(t('Immagine fissa.')),
      help(t('I video vanno in uscita con i fotogrammi al secondo scelti nel menu Uscita (al massimo 25), come gli altri input.')))
  ];
}

// --- TelePrompt ------------------------------------------------------------

// Misure del testo come apparirà in uscita: inizio dei paragrafi e fine.
function prompterMetrics(layer) {
  return measurePrompter(layer, state.output.width, state.output.height);
}

function sendPrompter(action, extra = {}, layer = selectedLayer()) {
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

function jumpParagraph(delta, layer = selectedLayer()) {
  if (!layer || layer.type !== 'prompter') return;
  const m = prompterMetrics(layer);
  if (!m.paragraphs.length) return;
  const i = clamp(currentParagraph(layer, m) + delta, 0, m.paragraphs.length - 1);
  sendPrompter('goto', { y: m.paragraphs[i].y }, layer);
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
  const startBtn = h('button', { class: 'primary', onclick: () => sendPrompter(selectedLayer().run.running ? 'pause' : 'start') }, `▶ ${t('Avvia')}`);
  const progress = h('div', { class: 'progress' }, h('div', {}));
  const paraList = h('ol', { class: 'para-list' });
  let paraSig = '';

  const tick = () => {
    const l = selectedLayer();
    if (!l || l.type !== 'prompter') return;
    const m = prompterMetrics(l);
    const label = l.run.running ? `❚❚ ${t('Pausa')}` : `▶ ${t('Avvia')}`;
    if (startBtn.textContent !== label) startBtn.textContent = label;
    startBtn.className = l.run.running ? 'warn' : 'primary';
    const pct = m.height ? clamp(prompterY(l) / m.height, 0, 1) * 100 : 0;
    progress.firstChild.style.width = `${pct}%`;
    const sig = m.paragraphs.map((p) => p.y + p.text).join('|');
    if (sig !== paraSig) {
      paraSig = sig;
      paraList.replaceChildren(...m.paragraphs.map((p, i) => h('li', {
        title: t('Vai a questo paragrafo'),
        onclick: () => sendPrompter('goto', { y: prompterMetrics(selectedLayer()).paragraphs[i].y })
      }, p.text.length > 70 ? `${p.text.slice(0, 70)}…` : p.text)));
      if (!m.paragraphs.length) paraList.append(h('li', { class: 'muted' }, t('Nessun paragrafo')));
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
    editor.ownerDocument.execCommand('insertHTML', false, clean);
    save();
  });
  bindings.push({ el: editor, get: (l) => l.html, html: true });

  const fmt = (cmd, label, title, value) => h('button', {
    class: 'small-btn',
    title: t(title),
    onmousedown: (e) => e.preventDefault(),
    onclick: () => {
      editor.focus();
      editor.ownerDocument.execCommand(cmd, false, value);
      save();
    }
  }, label);
  const colorBtn = h('input', { type: 'color', value: '#ffcc00', title: t('Colore del testo selezionato') });
  const applyColor = (c) => {
    editor.focus();
    editor.ownerDocument.execCommand('foreColor', false, c);
    save();
  };
  colorBtn.addEventListener('input', () => applyColor(colorBtn.value));
  const en = I18n.getLang() === 'en';
  const toolbar = h('div', { class: 'row toolbar' },
    fmt('bold', en ? 'B' : 'G', 'Grassetto'), fmt('italic', en ? 'I' : 'C', 'Corsivo'), fmt('underline', en ? 'U' : 'S', 'Sottolineato'), fmt('strikeThrough', 'ab̶', 'Barrato'),
    h('span', { class: 'color-pick' }, colorBtn, pickButton((c) => { colorBtn.value = c; applyColor(c); })),
    fmt('removeFormat', t('Togli stile'), 'Toglie lo stile dal testo selezionato'));

  return [
    card('TelePrompt',
      progress,
      h('div', { class: 'row' }, startBtn,
        h('button', { onclick: () => sendPrompter('top'), title: t('Torna all\'inizio (Home)') }, `⏮ ${t('Inizio')}`),
        h('button', { onclick: () => jumpParagraph(-1), title: t('Paragrafo precedente (Pagina su)') }, `⇞ ${t('Par.')}`),
        h('button', { onclick: () => jumpParagraph(1), title: t('Paragrafo successivo (Pagina giù)') }, `⇟ ${t('Par.')}`)),
      h('div', { class: 'row' },
        h('button', { onclick: () => sendPrompter('nudge', { dy: -60 }), title: t('Indietro di poco (freccia su)') }, `▲ ${t('Indietro')}`),
        h('button', { onclick: () => sendPrompter('nudge', { dy: 60 }), title: t('Avanti di poco (freccia giù)') }, `▼ ${t('Avanti')}`)),
      field('Velocità (pixel al secondo su 1080)', h('div', { class: 'row' },
        h('button', { class: 'small-btn', onclick: () => updateLayer({ speed: Math.max(0, selectedLayer().speed - 5) }) }, '−'),
        bound(h('input', { type: 'range', min: 0, max: 300, step: 1 }), (l) => l.speed, (v) => updateLayer({ speed: v })),
        h('button', { class: 'small-btn', onclick: () => updateLayer({ speed: selectedLayer().speed + 5 }) }, '+'),
        numberInput((l) => l.speed, (v) => updateLayer({ speed: clamp(v, 0, 2000) }), { min: 0, step: 1, style: 'width:70px' }))),
      help(t('Tasti: spazio avvia/pausa, Pagina su/giù cambia paragrafo, frecce su/giù spostano il testo, Home torna all\'inizio.'))),
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
        } }, t('Importa file…')),
        h('span', { class: 'muted small' }, t('Word (.docx), RTF (TextEdit, WordPad), testo (.txt), HTML'))),
      toolbar,
      editor,
      help(t('Puoi anche copiare e incollare da Word, Blocco note, Pages o TextEdit: grassetto, corsivo, colori e grandezze restano.'))),
    card('Aspetto',
      field('Carattere', fontSelect()),
      rangeField('Misura carattere (% altezza schermo)', 'fontSize', 1, 25, 0.5, 0.5, 100),
      checkbox('Grassetto', 'bold'),
      h('div', { class: 'grid2' },
        field('Colore testo', colorInput('color')),
        field('Colore sfondo', colorInput('background'))),
      checkbox('Sfondo trasparente', 'transparent'),
      rangeField('Interlinea', 'lineHeight', 0.8, 3, 0.05, 0.5, 5),
      rangeField('Spaziatura tra le lettere (px)', 'letterSpacing', -5, 40, 0.5, -20, 200),
      rangeField('Margini a destra e sinistra (%)', 'margin', 0, 40, 1, 0, 45),
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
  const el = h('select', {}, fonts.map((f) => h('option', { value: f }, f)));
  return bound(el, (l) => l.fontFamily, (v) => updateLayer({ fontFamily: v }), 'change');
}

function ndiSection() {
  const nodes = [];
  if (!state.ndiAvailable) {
    nodes.push(h('div', { class: 'notice' },
      t('NDI non è disponibile in questa installazione: il modulo NDI non è stato caricato. Vedi il README per installarlo.'),
      state.ndiError ? h('div', { class: 'muted small' }, state.ndiError) : null));
  }
  const sel = h('select', {});
  const status = h('div', { class: 'muted small' }, t('Ricerca delle sorgenti in rete…'));
  sel.addEventListener('change', () => {
    const [name, urlAddress] = JSON.parse(sel.value || 'null') || [];
    updateLayer({ source: name ? { name, urlAddress } : null, name: name ? shortNdiName(name) : selectedLayer().name });
  });

  const refresh = async () => {
    const layer = selectedLayer();
    if (!layer || layer.type !== 'ndi' || sel.ownerDocument.activeElement === sel) return;
    const sources = await api.ndiSources();
    const current = layer.source;
    const list = [...sources];
    if (current && !list.some((s) => s.name === current.name)) list.push({ ...current, missing: true });
    const opts = [h('option', { value: '' }, t('— nessuna —')),
      ...list.map((s) => h('option', { value: JSON.stringify([s.name, s.urlAddress]) }, s.missing ? `${s.name} (${t('non trovata')})` : s.name))];
    const signature = list.map((s) => s.name + s.missing).join('|');
    if (sel.dataset.sig !== signature) {
      sel.dataset.sig = signature;
      sel.replaceChildren(...opts);
    }
    sel.value = current ? JSON.stringify([current.name, current.urlAddress]) : '';
    status.textContent = sources.length ? t('{n} sorgenti trovate in rete', { n: sources.length }) : t('Nessuna sorgente NDI trovata (la ricerca continua)');
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
        s.getTracks().forEach((tr) => tr.stop());
        devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      } catch { /* nessuna periferica o permesso negato */ }
    }
    const layer = selectedLayer();
    if (!layer || layer.type !== 'capture') return;
    const opts = [h('option', { value: '' }, t('— nessuna —')),
      ...devices.map((d, i) => h('option', { value: d.deviceId }, d.label || `${t('Periferica')} ${i + 1}`))];
    if (layer.deviceId && !devices.some((d) => d.deviceId === layer.deviceId)) {
      opts.push(h('option', { value: layer.deviceId }, `${layer.deviceLabel || t('Periferica')} (${t('non collegata')})`));
    }
    sel.replaceChildren(...opts);
    sel.value = layer.deviceId || '';
    status.textContent = devices.length ? t('{n} periferiche video trovate', { n: devices.length }) : t('Nessuna periferica video trovata');
  };
  setTimeout(() => refresh(true));

  return [card('Periferica di acquisizione',
    field('Periferica', sel),
    h('div', { class: 'row' }, status, h('button', { class: 'small-btn', onclick: () => refresh(true) }, t('Aggiorna elenco'))),
    help(t('Schede di acquisizione, webcam e convertitori HDMI/SDI → USB.'))
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
  $('remove-name').textContent = `${typeLabel(layer.type)}: ${layer.name}`;
  $('btn-remove').textContent = layer.type === 'scene' ? `✕ ${t('Elimina scena')}` : `✕ ${t('Elimina input')}`;
  $('btn-reset').hidden = layer.type === 'scene';
}

function removeSelected() {
  const layer = selectedLayer();
  if (!layer) return;
  const msg = layer.type === 'scene' && layer.children.length
    ? t('Eliminare la scena "{name}" e i {n} input che contiene?', { name: layer.name, n: layer.children.length })
    : t('Eliminare "{name}"?', { name: layer.name });
  if (!confirm(msg)) return;
  send({ type: 'remove-layer', id: layer.id });
  selectedId = null;
}

// Riporta l'input ai valori iniziali (sorgente, file e testo restano).
function resetSelected() {
  const layer = selectedLayer();
  if (!layer || layer.type === 'scene') return;
  if (!confirm(t('Riportare "{name}" alle misure e impostazioni iniziali?', { name: layer.name }))) return;
  send({ type: 'reset-layer', id: layer.id });
}

// --- Elenco elementi (trascinabili) --------------------------------------------

const collapsed = new Set(); // scene chiuse nell'elenco

function renderList() {
  const list = $('layer-list');
  const rows = [];
  const numbers = new Map(scenesInOrder().map((s, i) => [s.id, i + 1]));
  for (const layer of [...state.layers].reverse()) {
    rows.push(listRow(layer, null, numbers.get(layer.id)));
    if (layer.type === 'scene' && !collapsed.has(layer.id)) {
      for (const child of [...layer.children].reverse()) rows.push(listRow(child, layer));
      if (!layer.children.length) rows.push(h('li', { class: 'child empty-scene', 'data-scene': layer.id }, t('Scena vuota: trascina qui gli input')));
    }
  }
  list.replaceChildren(...rows);
  if (!state.layers.length) list.append(h('li', { class: 'empty' }, t('Nessun elemento: aggiungine uno.')));
}

function listRow(layer, parent, sceneNumber) {
  const isScene = layer.type === 'scene';
  let button;
  if (isScene) {
    const live = state.program === layer.id;
    const pvw = state.studio && state.preview === layer.id;
    if (state.studio) {
      button = h('button', {
        class: `small-btn ${live ? 'live' : pvw ? 'pvw' : ''}`,
        title: live ? t('Questa scena è in onda') : t('Metti in anteprima: poi CUT o FADE la manda in onda'),
        onclick: (e) => { e.stopPropagation(); send({ type: 'preview', id: layer.id }); }
      }, live ? t('In onda') : t('Anteprima'));
    } else {
      button = h('button', {
        class: `small-btn ${live ? 'live' : ''}`,
        title: live ? t('In onda: clic per toglierla') : t('Manda subito in onda questa scena'),
        onclick: (e) => { e.stopPropagation(); send({ type: 'program', id: layer.id }); }
      }, live ? t('In onda') : t('Manda in onda'));
    }
  } else {
    button = h('button', {
      class: `small-btn ${layer.visible ? 'on' : ''}`,
      title: layer.visible ? t('Visibile: clic per nascondere') : t('Nascosto: clic per mostrare'),
      onclick: (e) => { e.stopPropagation(); send({ type: 'update-layer', id: layer.id, patch: { visible: !layer.visible } }); }
    }, layer.visible ? t('Visibile') : t('Nascosto'));
  }
  const caret = isScene
    ? h('span', {
      class: 'caret',
      title: t('Apri/chiudi la scena'),
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
  h('span', { class: 'tag' }, isScene ? `${typeLabel('scene')} ${sceneNumber}` : typeLabel(layer.type)),
  h('span', { class: 'name' }, layer.name, isScene ? h('span', { class: 'muted' }, ` (${layer.children.length})`) : null),
  copies > 1 ? h('span', { class: 'link', title: t('Stesso input in {n} punti: la sorgente è condivisa', { n: copies }) }, '🔗') : null,
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

function showDropTarget(target) {
  const line = $('drop-line');
  for (const el of document.querySelectorAll('#layer-list li.drop-into')) el.classList.remove('drop-into');
  if (!target) {
    line.hidden = true;
    return;
  }
  if (target.into) {
    line.hidden = true;
    const row = $('layer-list').querySelector(`li[data-id="${target.into}"]`);
    if (row) row.classList.add('drop-into');
    return;
  }
  const wrap = $('list-wrap').getBoundingClientRect();
  let ref = target.row.getBoundingClientRect();
  let y = target.before ? ref.top : ref.bottom;
  if (target.end) ref = $('layer-list').getBoundingClientRect();
  if (target.afterGroup) {
    // Dopo tutto il gruppo della scena (scena + suoi input).
    let last = target.row;
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
  const target = d.target;
  if (!target || target.refId === d.layer.id) return;
  send({ type: 'move-node', id: d.layer.id, parentId: target.parentId, refId: target.refId, where: target.where, copy: e.ctrlKey || d.copy });
}

// --- Scene e modalità studio ---------------------------------------------------

function sceneSection(scene) {
  const live = state.program === scene.id;
  const number = scenesInOrder().indexOf(scene) + 1;
  const actions = state.studio
    ? h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: () => send({ type: 'preview', id: scene.id }) }, t('Metti in anteprima')),
      h('span', { class: 'muted small' }, live ? t('Questa scena è in onda.') : t('Poi CUT o FADE la manda in onda.')))
    : h('div', { class: 'row' },
      h('button', { class: live ? 'live' : 'primary', onclick: () => send({ type: 'program', id: scene.id }) }, live ? t('Togli dall\'onda') : t('Manda in onda')),
      h('span', { class: 'muted small' }, live ? t('Questa scena è in onda.') : t('Il cambio di scena è immediato.')));
  return [
    card('Scena',
      field('Nome', textInput('name')),
      actions,
      h('p', { class: 'muted small' }, t('Scena numero {n} (per MIDI e Companion). Contiene {count} input.', { n: number, count: scene.children.length })),
      help(t('In onda va una scena alla volta, insieme agli input che non sono in nessuna scena (per esempio un logo sempre presente).'))),
    // Con le istruzioni nascoste la scheda "Come si usa" non serve.
    !state.showHelp ? null : card('Come si usa',
      help(t('Con la scena selezionata, il pulsante + propone di mettere i nuovi input dentro la scena.')),
      help(t('Trascina un input sulla scena per spostarlo dentro. Tieni premuto Ctrl mentre rilasci per usare lo stesso input anche in questa scena: la sorgente (videocamera, NDI, video) resta una sola e la CPU non lavora il doppio.')),
      help(t('Modalità studio (menu Visualizza o pulsante in alto a destra): sopra l\'anteprima della prossima scena e quella in onda, con CUT e FADE in mezzo.')))
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
      stream.getTracks().forEach((tr) => tr.stop());
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
  if (programStream) programStream.getTracks().forEach((tr) => tr.stop());
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
}
new ResizeObserver(fitScreens).observe($('preview-wrap'));
new ResizeObserver(fitScreens).observe($('program-wrap'));

function renderStudio() {
  const studio = !!state.studio;
  const changed = document.body.classList.contains('studio') !== studio;
  document.body.classList.toggle('studio', studio);
  if (changed) applyLayout();
  $('btn-studio').classList.toggle('on', studio);
  $('btn-studio').textContent = studio ? t('Modalità studio: attiva') : t('Modalità studio');
  $('switcher').hidden = !studio;
  $('mon-program').hidden = !studio;
  if (document.activeElement !== $('sel-fade')) $('sel-fade').value = String(state.fadeMs);
  const viewId = viewSceneId();
  const viewScene = layerById(viewId);
  const program = layerById(state.program);
  const title = $('preview-title');
  title.classList.remove('live', 'off', 'pvw');
  if (studio) {
    title.textContent = viewScene ? t('Anteprima: {name}', { name: viewScene.name }) : t('Anteprima: nessuna scena');
    title.classList.add('pvw');
    $('program-title').textContent = program ? t('In onda: {name}', { name: program.name }) : t('In onda: nessuna scena');
    programStage.update(composeLayers(state.layers, program ? [program.id] : []), state.background);
    startProgramMonitor();
  } else {
    if (viewScene && viewId !== state.program) {
      title.textContent = t('Scena "{name}" (non in onda)', { name: viewScene.name });
      title.classList.add('off');
    } else {
      title.textContent = program ? t('Uscita: {name}', { name: program.name }) : t('Uscita');
      title.classList.add('live');
    }
    stopProgramMonitor();
  }
  fitScreens();
}

// Scena in cui finiscono i nuovi input: quella selezionata (o dell'input selezionato).
function addTargetScene() {
  return sceneOf(selectedId);
}

// --- Zone ridimensionabili -------------------------------------------------------
// I bordi tra anteprima, dettagli e colonna degli input si trascinano; vicino
// alle posizioni "naturali" (misura predefinita, bordi degli schermi) si
// agganciano come una calamita. La disposizione è memorizzata separatamente
// per la modalità normale e per la modalità studio.

const SNAP = 14;

function layoutKey() {
  return document.body.classList.contains('studio') ? 'layout.studio' : 'layout.normal';
}

// Altezza della zona anteprima che fa stare gli schermi senza spazio vuoto.
function fittedTop(rightW) {
  const L = $('layout').getBoundingClientRect();
  const studio = document.body.classList.contains('studio');
  const out = state ? state.output : { width: 16, height: 9 };
  const avail = studio ? L.width - 32 - 112 - 24 : L.width - rightW - 6 - 32;
  const screenW = studio ? avail / 2 : avail;
  const helpH = document.body.classList.contains('hide-help') ? 0 : $('hint').offsetHeight + 6;
  return Math.round(screenW * (out.height / out.width) + 22 + 14 + helpH);
}

function defaultLayout() {
  const L = $('layout').getBoundingClientRect();
  const studio = document.body.classList.contains('studio');
  const right = 360;
  const top = studio ? Math.min(fittedTop(right), Math.round(L.height * 0.5)) : Math.max(200, Math.round(window.innerHeight * 0.36));
  return { top, right };
}

function applyLayout() {
  const L = $('layout').getBoundingClientRect();
  if (!L.height) return;
  const saved = prefs.get(layoutKey(), null);
  const d = defaultLayout();
  const top = clamp(saved ? saved.top : d.top, 120, Math.max(120, L.height - 160));
  const right = clamp(saved ? saved.right : d.right, 240, Math.max(240, L.width - 320));
  $('layout').style.setProperty('--top-h', `${top}px`);
  $('layout').style.setProperty('--right-w', `${right}px`);
  fitScreens();
}

function snapTo(value, targets) {
  let best = value;
  let dist = SNAP;
  for (const target of targets) {
    if (Math.abs(value - target) < dist) {
      dist = Math.abs(value - target);
      best = target;
    }
  }
  return best;
}

function startSplit(e, kind) {
  e.preventDefault();
  const L = $('layout').getBoundingClientRect();
  const splitter = e.currentTarget;
  splitter.classList.add('dragging');
  document.body.classList.add('resizing', kind === 'h' ? 'rows' : 'cols');
  const cur = () => ({
    top: parseFloat($('layout').style.getPropertyValue('--top-h')) || defaultLayout().top,
    right: parseFloat($('layout').style.getPropertyValue('--right-w')) || 360
  });
  const move = (ev) => {
    const d = defaultLayout();
    if (kind === 'h') {
      let top = clamp(ev.clientY - L.top, 120, L.height - 160);
      top = snapTo(top, [d.top, fittedTop(cur().right)]);
      $('layout').style.setProperty('--top-h', `${top}px`);
    } else {
      let right = clamp(L.right - ev.clientX, 240, L.width - 320);
      // Calamita: larghezza predefinita e allineamento con i bordi degli schermi.
      const targets = [d.right];
      for (const id of ['preview', 'program', 'switcher']) {
        const el = $(id);
        if (!el.offsetParent) continue;
        const r = el.getBoundingClientRect();
        targets.push(Math.round(L.right - r.left + 8), Math.round(L.right - r.right - 8));
      }
      right = snapTo(right, targets);
      $('layout').style.setProperty('--right-w', `${right}px`);
    }
    fitScreens();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    splitter.classList.remove('dragging');
    document.body.classList.remove('resizing', 'rows', 'cols');
    prefs.set(layoutKey(), cur());
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up, { once: true });
}

$('split-h').addEventListener('pointerdown', (e) => startSplit(e, 'h'));
$('split-v').addEventListener('pointerdown', (e) => startSplit(e, 'v'));
window.addEventListener('resize', () => applyLayout());

function resetLayout() {
  prefs.set('layout.normal', null);
  prefs.set('layout.studio', null);
  prefs.set('cardPos', {});
  for (const k of Object.keys(cardPos)) delete cardPos[k];
  prefs.set('collapsedCards2', []);
  collapsedCards.clear();
  applyLayout();
  buildPanel();
}

// --- Menu ------------------------------------------------------------------------

let openMenu = null;

function closeMenus() {
  for (const sub of document.querySelectorAll('.menu-sub.open')) sub.classList.remove('open');
  if (openMenu) openMenu.classList.remove('open');
  openMenu = null;
}

for (const menu of document.querySelectorAll('.menu')) {
  const title = menu.querySelector('.menu-title');
  title.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = openMenu === menu;
    closeMenus();
    if (!wasOpen) {
      menu.classList.add('open');
      openMenu = menu;
    }
  });
  // Con un menu aperto, passando sopra un altro titolo si apre quello.
  title.addEventListener('mouseenter', () => {
    if (openMenu && openMenu !== menu) {
      closeMenus();
      menu.classList.add('open');
      openMenu = menu;
    }
  });
  for (const sub of menu.querySelectorAll('.menu-sub-title')) {
    sub.addEventListener('click', (e) => {
      e.stopPropagation();
      sub.parentElement.classList.toggle('open');
    });
  }
  menu.querySelector('.menu-list').addEventListener('click', (e) => {
    const item = e.target.closest('button[data-cmd]');
    if (!item) return;
    menuCommand(item.dataset.cmd, item.dataset);
    closeMenus();
  });
}
document.addEventListener('click', (e) => {
  if (openMenu && !openMenu.contains(e.target)) closeMenus();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenus();
});

function menuCommand(cmd, data) {
  switch (cmd) {
    case 'open-config': send({ type: 'open-config' }); break;
    case 'save-config': send({ type: 'save-config' }); break;
    case 'toggle-display': send({ type: 'toggle-display' }); break;
    case 'display': send({ type: 'set-display', displayId: Number(data.id) }); break;
    case 'fps': send({ type: 'set-fps', fps: Number(data.fps) }); break;
    case 'studio': send({ type: 'set-studio', on: !state.studio }); break;
    case 'help': send({ type: 'set-help', on: !state.showHelp }); break;
    case 'reset-layout': resetLayout(); break;
    case 'popout-details': popOutDetails(); break;
    case 'manual': send({ type: 'open-manual' }); break;
    case 'lang': send({ type: 'set-lang', lang: data.lang }); break;
    case 'midi': openMidiDialog(); break;
    case 'http': openHttpDialog(); break;
  }
}

function renderMenus() {
  const displays = $('menu-displays');
  const sig = JSON.stringify([state.displays, state.activeDisplayId, I18n.getLang()]);
  if (displays.dataset.sig !== sig) {
    displays.dataset.sig = sig;
    displays.replaceChildren(...state.displays.map((d) => h('button', {
      'data-cmd': 'display',
      'data-id': d.id,
      class: `check ${d.id === state.activeDisplayId ? 'checked' : ''}`
    }, `${t('Monitor')} ${d.index} · ${d.width}×${d.height}${d.hz ? ` · ${d.hz} Hz` : ''}${d.primary ? ` · ${t('principale')}` : ''}`)));
  }
  $('menu-fps').replaceChildren(...FPS_CHOICES.map((f) => h('button', {
    'data-cmd': 'fps', 'data-fps': f, class: `check ${state.fps === f ? 'checked' : ''}`
  }, `${f} fps`)));
  $('menu-studio').classList.toggle('checked', !!state.studio);
  $('menu-help').classList.toggle('checked', !!state.showHelp);
  $('menu-lang-it').classList.toggle('checked', I18n.getLang() === 'it');
  $('menu-lang-en').classList.toggle('checked', I18n.getLang() === 'en');
  $('menu-toggle-display').textContent = state.displayVisible ? t('Nascondi l\'uscita') : t('Mostra l\'uscita');
}

// Testi fissi della pagina (attributi data-i18n e data-i18n-title).
function translateStatic() {
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  document.documentElement.lang = I18n.getLang();
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
        handles.push(h('div', { class: `handle crop c-${side}`, 'data-crop': side, title: t('Trascina per ritagliare') }));
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
  for (const target of [0, 50, 100]) if (Math.abs(v - target) < 1) return target;
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

let currentLang = null;

function render(next) {
  state = next;
  if (selectedId && !selectedLayer()) selectedId = null;
  // Lingua e fotogrammi al secondo arrivano con lo stato.
  Layers.setFps(state.fps);
  if (currentLang !== state.lang) {
    currentLang = state.lang;
    I18n.setLang(state.lang);
    translateStatic();
    panelKey = null; // ricostruisce il pannello nella nuova lingua
  }
  document.body.classList.toggle('hide-help', !state.showHelp);
  if (drag) return; // durante il trascinamento comanda l'anteprima locale

  $('output-info').textContent = state.output.fullscreen
    ? t('Uscita a tutto schermo {w}×{h} · {fps} fps', { w: state.output.width, h: state.output.height, fps: state.fps })
    : t('Un solo monitor: uscita in finestra di anteprima · {fps} fps', { fps: state.fps });
  if (document.activeElement !== $('col-background')) $('col-background').value = state.background;

  renderMenus();
  renderStudio();
  stage.update(previewLayers(), state.background);
  renderOverlay();
  if (!listDrag || !listDrag.active) renderList();
  renderFooter();

  const layer = selectedLayer();
  const key = panelKeyOf(layer);
  if (key !== panelKey) buildPanel();
  else refreshBindings();
  if (typeof Remote !== 'undefined') Remote.onState(state);
}

let pendingSelect = null;

// --- Finestra "Aggiungi" ---------------------------------------------------------
// Il pulsante + apre una finestra: si sceglie il tipo di input, poi (se serve)
// la sorgente NDI, la periferica o il file, e la scena in cui metterlo.

const ADD_TYPES = [
  { type: 'scene', ico: '🎬', label: 'Scena', hint: 'Raccoglie più input' },
  { type: 'ndi', ico: '📡', label: 'Segnale NDI', hint: 'Sorgente video in rete' },
  { type: 'capture', ico: '🎥', label: 'Periferica di acquisizione', hint: 'Scheda, webcam, HDMI/SDI → USB' },
  { type: 'media', ico: '🖼', label: 'Media (video o immagine)', hint: 'File dal disco' },
  { type: 'timer', ico: '⏱', label: 'Timer', hint: 'Countdown, cronometro, orologio' },
  { type: 'ticker', ico: '💬', label: 'Banner di Testo', hint: 'Testo in sovraimpressione' },
  { type: 'prompter', ico: '📜', label: 'TelePrompt', hint: 'Testo che scorre in verticale' }
];
const addDlg = { type: null, source: null, sceneId: null, items: [], loading: false };

function openAddDialog() {
  const target = addTargetScene();
  Object.assign(addDlg, { type: null, source: null, items: [], loading: false, sceneId: target ? target.id : null });
  renderAddDialog();
  $('dlg-add').showModal();
}

async function chooseAddType(type) {
  Object.assign(addDlg, { type, source: null, items: [], loading: type === 'ndi' || type === 'capture' });
  if (type === 'scene') addDlg.sceneId = null;
  renderAddDialog();
  if (type === 'ndi') {
    addDlg.items = (await api.ndiSources()).map((s) => ({ value: s, label: s.name }));
  } else if (type === 'capture') {
    let devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    if (devices.some((d) => !d.label)) {
      try {
        const st = await navigator.mediaDevices.getUserMedia({ video: true });
        st.getTracks().forEach((tr) => tr.stop());
        devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      } catch { /* nessuna periferica o permesso negato */ }
    }
    addDlg.items = devices.map((d, i) => ({ value: d, label: d.label || `${t('Periferica')} ${i + 1}` }));
  }
  if (addDlg.type !== type) return;
  addDlg.loading = false;
  if (addDlg.items.length === 1) addDlg.source = addDlg.items[0];
  renderAddDialog();
}

function confirmAdd() {
  const { type, source, sceneId } = addDlg;
  if (!type) return;
  pendingSelect = new Set(allLayers(state.layers).map((l) => l.id));
  if (type === 'media') {
    // La finestra di Windows per scegliere il file si apre subito dopo.
    send({ type: 'add-media', sceneId });
  } else {
    let extra;
    if (type === 'ndi' && source) extra = { source: { name: source.value.name, urlAddress: source.value.urlAddress }, name: shortNdiName(source.value.name) };
    if (type === 'capture' && source) extra = { deviceId: source.value.deviceId, deviceLabel: source.label, name: source.label };
    send({ type: 'add-layer', layerType: type, sceneId, extra });
  }
  $('dlg-add').close();
}

function renderAddDialog() {
  const d = addDlg;
  const types = h('div', { class: 'add-types' }, ADD_TYPES.map((a) => h('button', {
    class: d.type === a.type ? 'on' : '',
    'data-type': a.type,
    onclick: () => chooseAddType(a.type)
  }, h('span', { class: 'ico' }, a.ico), h('strong', {}, t(a.label)), h('span', { class: 'muted small' }, t(a.hint)))));

  let sourcePart = null;
  if (d.type === 'ndi' || d.type === 'capture') {
    const title = d.type === 'ndi' ? t('Sorgente NDI') : t('Periferica');
    let list;
    if (d.loading) list = h('p', { class: 'muted small' }, d.type === 'ndi' ? t('Ricerca delle sorgenti in rete…') : t('Ricerca delle periferiche…'));
    else if (!d.items.length) list = h('p', { class: 'muted small' }, d.type === 'ndi' ? t('Nessuna sorgente NDI trovata (la ricerca continua)') : t('Nessuna periferica video trovata'));
    else list = h('div', { class: 'add-sources' }, d.items.map((it, i) => h('button', {
      class: d.source === it ? 'on' : '',
      'data-index': i,
      onclick: () => { d.source = it; renderAddDialog(); }
    }, it.label)));
    sourcePart = h('div', {},
      h('h2', {}, title),
      list,
      h('div', { class: 'row' },
        h('button', { class: 'small-btn', onclick: () => chooseAddType(d.type) }, t('Aggiorna elenco')),
        h('span', { class: 'muted small' }, t('Puoi anche sceglierla dopo, nei dettagli dell\'input.'))));
  } else if (d.type === 'media') {
    sourcePart = help(t('Premendo "Aggiungi" si apre la finestra per scegliere il video o l\'immagine dal disco.'));
  }

  let scenePart = null;
  if (d.type && d.type !== 'scene') {
    const scenes = scenesInOrder();
    const sel = h('select', {},
      h('option', { value: '' }, t('Fuori dalle scene (sempre in onda)')),
      scenes.map((s, i) => h('option', { value: s.id }, `${t('Scena')} ${i + 1}: ${s.name}`)));
    sel.value = d.sceneId || '';
    sel.addEventListener('change', () => { d.sceneId = sel.value || null; });
    if (scenes.length) scenePart = field('Dove', sel);
  }

  const canAdd = !!d.type && !d.loading;
  $('dlg-add').replaceChildren(...[
    h('h2', {}, t('Aggiungi')),
    help(t('Scegli il tipo di input (doppio clic per aggiungerlo subito).')),
    types,
    sourcePart,
    scenePart,
    h('div', { class: 'row end' },
      h('button', { onclick: () => $('dlg-add').close() }, t('Annulla')),
      h('button', { class: 'primary', disabled: !canAdd, onclick: confirmAdd },
        d.type === 'media' ? t('Scegli file e aggiungi…') : t('Aggiungi')))
  ].filter(Boolean));
}

// Doppio clic: aggiunge subito (sul tipo, se non serve scegliere la sorgente,
// oppure sulla sorgente). Il primo clic ridisegna la finestra, per questo il
// doppio clic si ascolta sulla finestra intera.
$('dlg-add').addEventListener('dblclick', (e) => {
  const typeBtn = e.target.closest('.add-types button');
  if (typeBtn && !['ndi', 'capture'].includes(typeBtn.dataset.type)) {
    addDlg.type = typeBtn.dataset.type;
    if (addDlg.type === 'scene') addDlg.sceneId = null;
    confirmAdd();
    return;
  }
  const srcBtn = e.target.closest('.add-sources button');
  if (srcBtn && addDlg.items[srcBtn.dataset.index]) {
    addDlg.source = addDlg.items[srcBtn.dataset.index];
    confirmAdd();
  }
});
$('btn-add').onclick = () => openAddDialog();

$('btn-show-all').onclick = () => send({ type: 'show-all' });
$('btn-remove').onclick = () => removeSelected();
$('btn-popout-details').onclick = () => (detailsWin && !detailsWin.closed ? detailsWin.close() : popOutDetails());
$('btn-reset').onclick = () => resetSelected();
$('btn-studio').onclick = () => send({ type: 'set-studio', on: !state.studio });
$('btn-cut').onclick = () => send({ type: 'take', kind: 'cut' });
$('btn-fade').onclick = () => send({ type: 'take', kind: 'fade' });
$('sel-fade').onchange = (e) => send({ type: 'set-fade', ms: Number(e.target.value) });
$('col-background').oninput = (e) => send({ type: 'set-background', color: e.target.value });
$('btn-pick-background').onclick = async (e) => {
  e.preventDefault();
  e.stopPropagation();
  closeMenus();
  const color = await api.pickColor();
  if (color) send({ type: 'set-background', color });
};

// Tasti della regia (anche nelle finestre separate delle schede).
function onControlKey(e) {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
  if (document.querySelector('dialog[open]')) return;
  const layer = selectedLayer();
  if (layer && layer.type === 'prompter' && prompterKey(e, layer)) return;
  if (e.code === 'Space') {
    e.preventDefault();
    const timer = layer && layer.type === 'timer' ? layer : allLayers(state.layers).find((l) => l.type === 'timer');
    if (timer) send({ type: 'timer', id: timer.id, action: timer.run.running ? 'pause' : 'start' });
  }
}
document.addEventListener('keydown', onControlKey);

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
  applyLayout();
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
  const extra = layer.type === 'scene' ? `${state.studio}:${state.program}:${layer.children.length}:${scenesInOrder().indexOf(layer)}:${state.showHelp}` : linkCount(layer);
  return `${layer.id}:${layer.type}:${layer.mediaKind || ''}:${extra}`;
}
