const { app, BrowserWindow, ipcMain, screen, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { createLayer, timerElapsedMs, prompterY, TIMER_COLORS, TYPE_LABELS, VIDEO_EXT, IMAGE_EXT, PER_ITEM, KEEP_ON_RESET, allLayers, findNode, newId, isVisual } = require('./shared/layers');
const ndi = require('./ndi');
const { readTextFile, TEXT_EXT } = require('./textimport');
const { pickColor } = require('./picker/main');
const displayNumbers = require('./displaynumbers');
const i18n = require('./shared/i18n');
const remote = require('./remote');
const t = i18n.t;

const ICON = path.join(__dirname, 'assets', 'igor.png');

// Stato condiviso: il processo principale è l'unica fonte di verità della
// scena; le due finestre ricevono lo stesso stato e lo mostrano. I timer
// salvano solo quando sono partiti, così ogni finestra calcola da sé il
// valore corrente senza aggiornamenti continui.
const DEFAULT_STATE = {
  layers: [createLayer('timer', { x: 0, y: 0, w: 100, h: 100 })],
  background: '#000000',
  displayId: null,
  // Scene: program = scena in onda, preview = scena in anteprima (modalità
  // studio), fadeMs = durata della dissolvenza tra le scene.
  studio: false,
  program: null,
  preview: null,
  fadeMs: 1000,
  fps: 25, // fotogrammi al secondo dell'uscita (al massimo 25)
  // Preferenze della regia (non finiscono nei file di configurazione).
  lang: 'it',
  showHelp: true,
  midi: [], // associazioni MIDI: { key, action, arg }
  http: { enabled: false, port: 8765, lan: false } // comandi per Companion / Stream Deck
};
// Parti dello stato salvate in "Esporta configurazione".
const CONFIG_KEYS = ['layers', 'background', 'displayId', 'studio', 'program', 'preview', 'fadeMs', 'fps'];
// Dissolvenza in corso tra due scene (non viene salvata).
let transition = null;
let transitionTimer = null;

migrateOldState();
let state = loadState();
let controlWin = null;
let displayWin = null;

function statePath() {
  return path.join(app.getPath('userData'), 'scene.json');
}

// Prima di chiamarsi IGOR l'app si chiamava "Mio Countdown": se la scena
// salvata è ancora nella vecchia cartella, la porta in quella nuova.
function migrateOldState() {
  if (fs.existsSync(statePath())) return;
  for (const oldName of ['Mio Countdown', 'mio-countdown']) {
    const oldPath = path.join(app.getPath('appData'), oldName, 'scene.json');
    if (!fs.existsSync(oldPath)) continue;
    try {
      fs.mkdirSync(path.dirname(statePath()), { recursive: true });
      fs.copyFileSync(oldPath, statePath());
    } catch (err) {
      console.error('Impossibile recuperare la scena precedente:', err);
    }
    return;
  }
}

function loadState() {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(statePath(), 'utf8')));
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

// Porta una scena letta da disco (salvataggio automatico o configurazione
// aperta dall'utente) nella forma attuale. Lancia un errore se non è valida.
function normalizeState(raw) {
  if (!raw || !Array.isArray(raw.layers)) throw new Error('Il file non contiene una configurazione di IGOR.');
  const loaded = { ...structuredClone(DEFAULT_STATE), ...raw };
  // Le scene salvate da versioni precedenti ricevono le nuove proprietà.
  const upgrade = (list, nested) => list
    .filter((l) => l && TYPE_LABELS[l.type] && !(nested && l.type === 'scene'))
    .map((l) => {
      const layer = upgradeLayer({ ...createLayer(l.type), ...l });
      if (layer.type === 'scene') layer.children = upgrade(Array.isArray(l.children) ? l.children : [], true);
      return layer;
    });
  loaded.layers = upgrade(loaded.layers, false);
  // Timer e TelePrompt rimasti in corsa ripartono in pausa.
  for (const l of allLayers(loaded.layers)) {
    if (l.type === 'timer' && l.run.running) {
      l.run = { running: false, baseMs: timerElapsedMs(l), startedAt: 0 };
    }
    if (l.type === 'prompter' && l.run.running) {
      l.run = { running: false, y: prompterY(l), startedAt: 0 };
    }
  }
  const isScene = (id) => loaded.layers.some((l) => l.id === id && l.type === 'scene');
  if (!isScene(loaded.program)) loaded.program = null;
  if (!isScene(loaded.preview)) loaded.preview = null;
  loaded.fps = Math.max(1, Math.min(25, Number(loaded.fps) || 25));
  loaded.http = { ...DEFAULT_STATE.http, ...(raw.http || {}) };
  if (!Array.isArray(loaded.midi)) loaded.midi = [];
  return loaded;
}

// --- Configurazioni salvate dall'utente --------------------------------------

const configFilters = () => [{ name: t('Configurazione IGOR'), extensions: ['igor'] }, { name: t('Tutti i file'), extensions: ['*'] }];

async function saveConfig() {
  const res = await dialog.showSaveDialog(controlWin, {
    title: t('Esporta configurazione'),
    defaultPath: path.join(app.getPath('documents'), `${t('Configurazione')}.igor`),
    filters: configFilters()
  });
  if (res.canceled || !res.filePath) return;
  const data = {
    app: 'IGOR - ABit/s',
    version: require('../package.json').version,
    savedAt: new Date().toISOString()
  };
  for (const k of CONFIG_KEYS) data[k] = state[k];
  try {
    fs.writeFileSync(res.filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    dialog.showMessageBox(controlWin, { type: 'error', title: t('Esporta configurazione'), message: t('Impossibile salvare la configurazione.'), detail: String(err.message || err) });
  }
}

async function openConfig() {
  const res = await dialog.showOpenDialog(controlWin, {
    title: t('Importa configurazione'),
    defaultPath: app.getPath('documents'),
    properties: ['openFile'],
    filters: configFilters()
  });
  if (res.canceled || !res.filePaths.length) return;
  try {
    const loaded = normalizeState(JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8')));
    // Le preferenze della regia (lingua, MIDI, Companion) restano quelle attuali.
    for (const k of CONFIG_KEYS) state[k] = loaded[k];
    endTransition();
    placeDisplayWindow();
    saveState();
    broadcast();
  } catch (err) {
    dialog.showMessageBox(controlWin, { type: 'error', title: t('Importa configurazione'), message: t('Impossibile importare la configurazione.'), detail: String(err.message || err) });
  }
}

// I timer con i vecchi colori predefiniti (bianco, arancio, rosso) passano
// ai nuovi: verde, giallo, rosso.
function upgradeLayer(l) {
  // La "Frase" che scorre si chiama ora Banner di Testo.
  if (l.type === 'ticker' && (l.name === 'Frase' || l.name === 'Banner')) l.name = TYPE_LABELS.ticker;
  // Audio dei video: da sì/no a attivo / disattivo / segue l'onda.
  if (l.type === 'media' && typeof l.audio === 'boolean') {
    l.audioMode = l.audio ? 'on' : 'off';
    delete l.audio;
  }
  if (l.type === 'timer' && l.color === '#ffffff' && l.warningColor === '#ffb020' && l.endColor === '#ff3b30') {
    Object.assign(l, TIMER_COLORS);
  }
  return l;
}

let saveTimeout = null;
function saveState() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
    } catch (err) {
      console.error('Impossibile salvare la scena:', err);
    }
  }, 300);
}

// Monitor con il numero che usa Windows, in ordine di numero.
function displayList() {
  const primaryId = screen.getPrimaryDisplay().id;
  const displays = screen.getAllDisplays();
  const numbers = displayNumbers.numbers(displays);
  return displays.map((d) => ({
    id: d.id,
    index: numbers.get(d.id),
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
    hz: Math.round(d.displayFrequency || 0),
    primary: d.id === primaryId
  })).sort((a, b) => a.index - b.index);
}

function snapshot() {
  const primaryId = screen.getPrimaryDisplay().id;
  const target = targetDisplay();
  return {
    ...state,
    transition,
    now: Date.now(),
    ndiAvailable: ndi.available,
    ndiError: ndi.error,
    output: { width: target.size.width, height: target.size.height, fullscreen: target.id !== primaryId },
    displays: displayList(),
    httpStatus: remote.status(),
    activeDisplayId: target.id,
    displayVisible: !!(displayWin && displayWin.isVisible())
  };
}

function broadcast() {
  const s = snapshot();
  for (const win of [controlWin, displayWin]) {
    if (win && !win.isDestroyed()) win.webContents.send('state', s);
  }
}

// Monitor di uscita: quello scelto se ancora collegato, altrimenti il primo
// monitor che non è il principale.
function targetDisplay() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  return (
    displays.find((d) => d.id === state.displayId) ||
    displays.find((d) => d.id !== primary.id) ||
    primary
  );
}

function placeDisplayWindow() {
  if (!displayWin || displayWin.isDestroyed()) return;
  const target = targetDisplay();
  const isPrimary = target.id === screen.getPrimaryDisplay().id;
  if (displayWin.isFullScreen()) displayWin.setFullScreen(false);

  if (isPrimary) {
    // Un solo monitor: anteprima in finestra, così il controllo resta usabile.
    const { x, y, width } = target.workArea;
    const w = Math.round(width * 0.45);
    displayWin.setBounds({ x: x + width - w - 20, y: y + 20, width: w, height: Math.round(w * 9 / 16) });
  } else {
    displayWin.setBounds(target.bounds);
    displayWin.setFullScreen(true);
  }
}

function createWindows() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  const w = Math.min(1280, width - 40);
  const h = Math.min(860, height - 40);

  controlWin = new BrowserWindow({
    x: x + Math.round((width - w) / 2),
    y: y + Math.round((height - h) / 2),
    width: w,
    height: h,
    minWidth: 900,
    minHeight: 600,
    title: 'IGOR - ABit/s – Regia',
    icon: ICON,
    backgroundColor: '#15171c',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'control', 'preload.js'), spellcheck: false }
  });
  controlWin.loadFile(path.join(__dirname, 'control', 'control.html'));
  controlWin.on('closed', () => {
    controlWin = null;
    app.quit();
  });

  displayWin = new BrowserWindow({
    frame: false,
    show: false,
    title: 'IGOR - ABit/s – Uscita',
    icon: ICON,
    backgroundColor: state.background,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'display', 'preload.js'),
      // Il preload dell'uscita riceve i flussi NDI con un modulo nativo.
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  });
  displayWin.loadFile(path.join(__dirname, 'display', 'display.html'));
  displayWin.once('ready-to-show', () => {
    placeDisplayWindow();
    displayWin.showInactive();
    broadcast();
  });
  displayWin.on('closed', () => {
    displayWin = null;
  });
}

// --- Comandi dalla regia ---------------------------------------------------

// Chiede un video o un'immagine dal disco e restituisce le proprietà del
// livello Media, oppure null se l'utente annulla.
async function pickMediaFile() {
  const res = await dialog.showOpenDialog(controlWin, {
    title: t('Scegli un video o un\'immagine'),
    properties: ['openFile'],
    filters: [
      { name: t('Video e immagini'), extensions: [...VIDEO_EXT, ...IMAGE_EXT] },
      { name: t('Video'), extensions: VIDEO_EXT },
      { name: t('Immagini'), extensions: IMAGE_EXT }
    ]
  });
  if (res.canceled || !res.filePaths.length) return null;
  const file = res.filePaths[0];
  const ext = path.extname(file).slice(1).toLowerCase();
  return {
    file,
    src: pathToFileURL(file).href,
    mediaKind: IMAGE_EXT.includes(ext) ? 'image' : 'video',
    name: path.basename(file)
  };
}

function findLayer(id) {
  const node = findNode(state.layers, id);
  return node && node.layer;
}

// Lo stesso input può comparire in più scene: le copie hanno lo stesso
// "link" e condividono sorgente e impostazioni (non posizione e misure).
function linkedLayers(layer) {
  return layer.link ? allLayers(state.layers).filter((l) => l.link === layer.link) : [layer];
}

// Gli input nuovi vanno nella scena indicata (quella selezionata in regia),
// altrimenti nel livello principale. Le scene stanno sempre nel livello principale.
function addLayer(layer, sceneId) {
  const scene = layer.type !== 'scene' && findLayer(sceneId);
  const list = scene && scene.type === 'scene' ? scene.children : state.layers;
  insertLayer(list, layer);
  // Nome e testi iniziali nella lingua dell'interfaccia.
  if (layer.type !== 'media' && layer.name === TYPE_LABELS[layer.type]) layer.name = t(layer.name);
  if (layer.type === 'ticker') layer.text = t(layer.text);
  if (layer.type === 'prompter') layer.html = t(layer.html);
  if (layer.type === 'scene') {
    const names = new Set(state.layers.map((l) => l.name));
    const label = t(TYPE_LABELS.scene);
    let n = 1;
    while (names.has(`${label} ${n}`)) n++;
    layer.name = `${label} ${n}`;
    if (state.studio && !state.preview) state.preview = layer.id;
  }
}

// Posto di un nuovo elemento nell'elenco (dal fondo al primo piano).
function insertLayer(list, layer) {
  if (layer.type === 'timer' || layer.type === 'ticker' || layer.type === 'prompter') {
    list.push(layer); // in primo piano
  } else if (layer.type === 'scene') {
    list.unshift(layer); // le scene stanno sotto a tutto
  } else {
    // Video e immagini: sopra agli altri video e immagini (e alle scene),
    // sotto agli elementi grafici come timer e banner.
    let i = list.length;
    while (i > 0 && !isVisual(list[i - 1].type) && list[i - 1].type !== 'scene') i--;
    list.splice(i, 0, layer);
  }
}

// Copia collegata di un input (stessa sorgente, condivisa).
function linkedCopy(layer) {
  if (!layer.link) layer.link = layer.id;
  return { ...structuredClone(layer), id: newId() };
}

// Sposta (o copia) un elemento nell'elenco: parentId = scena di
// destinazione (null = livello principale), refId/where = accanto a quale
// elemento (front = davanti, behind = dietro), oppure in primo piano.
function moveNode({ id, parentId, refId, where, copy }) {
  const node = findNode(state.layers, id);
  if (!node || refId === id) return;
  let target = state.layers;
  if (parentId) {
    const scene = findLayer(parentId);
    if (!scene || scene.type !== 'scene' || node.layer.type === 'scene') return;
    target = scene.children;
  }
  const layer = copy && node.layer.type !== 'scene' ? linkedCopy(node.layer) : node.layer;
  if (layer === node.layer) node.list.splice(node.list.indexOf(layer), 1);
  const ref = refId ? target.findIndex((l) => l.id === refId) : -1;
  if (ref < 0) insertLayer(target, layer);
  else target.splice(where === 'behind' ? ref : ref + 1, 0, layer);
}

function removeLayer(id) {
  const node = findNode(state.layers, id);
  if (!node) return;
  node.list.splice(node.list.indexOf(node.layer), 1);
  if (state.program === id) state.program = null;
  if (state.preview === id) state.preview = null;
  if (transition && (transition.from === id || transition.to === id)) endTransition();
}

// Riporta l'elemento ai valori iniziali, tenendo sorgente e contenuto.
function resetLayer(layer) {
  const fresh = createLayer(layer.type);
  const patch = {};
  for (const [k, v] of Object.entries(fresh)) if (!KEEP_ON_RESET.includes(k)) patch[k] = v;
  updateLayer(layer, patch);
}

function updateLayer(layer, patch) {
  if (patch.crop) patch.crop = { ...layer.crop, ...patch.crop };
  // Il TelePrompt che cambia velocità mentre scorre riparte dal punto attuale.
  if (layer.type === 'prompter' && 'speed' in patch && layer.run.running) {
    const now = Date.now();
    patch.run = { running: true, y: prompterY(layer, now), startedAt: now };
  }
  const shared = {};
  for (const [k, v] of Object.entries(patch)) {
    if (PER_ITEM.includes(k)) layer[k] = v;
    else shared[k] = v;
  }
  for (const l of linkedLayers(layer)) Object.assign(l, structuredClone(shared));
}

// --- Scene in onda e dissolvenze ----------------------------------------------

function endTransition() {
  clearTimeout(transitionTimer);
  transition = null;
}

// Manda in onda la scena in anteprima; quella che era in onda passa in
// anteprima (come in OBS), così CUT ripetuti alternano le due scene.
function take(kind) {
  const to = state.preview;
  const from = state.program;
  if (to === from) return;
  endTransition();
  state.program = to;
  state.preview = from;
  if (kind === 'fade' && state.fadeMs > 0) {
    transition = { from, to, startedAt: Date.now(), durationMs: state.fadeMs };
    transitionTimer = setTimeout(() => {
      transition = null;
      broadcast();
    }, state.fadeMs + 50);
  }
}

function timerAction(layer, action, seconds) {
  const r = layer.run;
  const now = Date.now();
  switch (action) {
    case 'start':
      if (!r.running) layer.run = { running: true, baseMs: r.baseMs, startedAt: now };
      break;
    case 'pause':
      if (r.running) layer.run = { running: false, baseMs: timerElapsedMs(layer, now), startedAt: 0 };
      break;
    case 'reset':
      layer.run = { running: false, baseMs: 0, startedAt: 0 };
      break;
    case 'adjust': {
      // Aggiunge tempo a quello mostrato, in entrambe le direzioni.
      const deltaMs = (Number(seconds) || 0) * 1000;
      const sign = layer.direction === 'up' ? 1 : -1;
      layer.run = { ...r, baseMs: r.baseMs + sign * deltaMs };
      if (layer.direction === 'up' && timerElapsedMs(layer, now) < 0) {
        layer.run.baseMs -= timerElapsedMs(layer, now);
      }
      break;
    }
  }
}

// Comandi del TelePrompt. La regia misura il testo e passa le posizioni
// (y) in pixel su 1080: inizio dei paragrafi e fine del testo (maxY).
function prompterAction(layer, cmd) {
  const now = Date.now();
  const y = prompterY(layer, now);
  const maxY = Number.isFinite(cmd.maxY) ? cmd.maxY : Infinity;
  const clampY = (v) => Math.max(0, Math.min(maxY, v));
  const running = layer.run.running;
  switch (cmd.action) {
    case 'start':
      // Arrivato in fondo, riparte dall'inizio.
      layer.run = { running: true, y: y >= maxY ? 0 : clampY(y), startedAt: now };
      break;
    case 'pause':
      layer.run = { running: false, y: clampY(y), startedAt: 0 };
      break;
    case 'top':
      layer.run = { running: false, y: 0, startedAt: 0 };
      break;
    case 'goto':
      layer.run = { running, y: clampY(Number(cmd.y) || 0), startedAt: running ? now : 0 };
      break;
    case 'nudge':
      layer.run = { running, y: clampY(y + (Number(cmd.dy) || 0)), startedAt: running ? now : 0 };
      break;
  }
}

ipcMain.handle('get-state', () => snapshot());
ipcMain.handle('ndi-sources', () => ndi.sources());
ipcMain.handle('output-source-id', () => (displayWin && !displayWin.isDestroyed() ? displayWin.getMediaSourceId() : null));
ipcMain.handle('pick-color', () => pickColor(controlWin, t));
ipcMain.handle('import-text', async () => {
  const res = await dialog.showOpenDialog(controlWin, {
    title: t('Importa testo per il TelePrompt'),
    properties: ['openFile'],
    filters: [{ name: t('Testi'), extensions: TEXT_EXT }, { name: t('Tutti i file'), extensions: ['*'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  try {
    return readTextFile(res.filePaths[0]);
  } catch (err) {
    dialog.showMessageBox(controlWin, { type: 'error', title: t('Importa testo'), message: t('Impossibile leggere il file.'), detail: String(err.message || err) });
    return null;
  }
});

ipcMain.on('command', (_evt, cmd) => {
  switch (cmd.type) {
    case 'add-layer':
      addLayer(createLayer(cmd.layerType, cmd.extra), cmd.sceneId);
      break;
    case 'save-config':
      saveConfig();
      return;
    case 'open-config':
      openConfig();
      return;
    case 'add-media':
      // La finestra di scelta del file è asincrona: il livello arriva dopo.
      pickMediaFile().then((media) => {
        if (!media) return;
        addLayer(createLayer('media', media), cmd.sceneId);
        saveState();
        broadcast();
      });
      return;
    case 'pick-media': {
      const id = cmd.id;
      pickMediaFile().then((media) => {
        const layer = findLayer(id);
        if (!media || !layer) return;
        updateLayer(layer, { ...media, playing: true, restartAt: Date.now() });
        saveState();
        broadcast();
      });
      return;
    }
    case 'update-layer': {
      const layer = findLayer(cmd.id);
      if (layer) updateLayer(layer, cmd.patch || {});
      break;
    }
    case 'reset-layer': {
      const layer = findLayer(cmd.id);
      if (layer) resetLayer(layer);
      break;
    }
    case 'remove-layer':
      removeLayer(cmd.id);
      break;
    case 'move-layer': {
      // dir +1 = più in primo piano, -1 = più dietro (dentro lo stesso elenco)
      const node = findNode(state.layers, cmd.id);
      if (!node) break;
      const list = node.list;
      const i = list.indexOf(node.layer);
      const j = i + cmd.dir;
      if (j < 0 || j >= list.length) break;
      [list[i], list[j]] = [list[j], list[i]];
      break;
    }
    case 'move-node':
      moveNode(cmd);
      break;
    case 'solo': {
      const node = findNode(state.layers, cmd.id);
      if (node) for (const l of node.list) if (l.type !== 'scene') l.visible = l.id === cmd.id;
      break;
    }
    case 'show-all':
      for (const l of allLayers(state.layers)) l.visible = true;
      break;
    case 'timer': {
      const layer = findLayer(cmd.id);
      if (layer && layer.type === 'timer') {
        timerAction(layer, cmd.action, cmd.seconds);
        for (const l of linkedLayers(layer)) l.run = { ...layer.run };
      }
      break;
    }
    case 'prompter': {
      const layer = findLayer(cmd.id);
      if (layer && layer.type === 'prompter') {
        prompterAction(layer, cmd);
        for (const l of linkedLayers(layer)) l.run = { ...layer.run };
      }
      break;
    }
    case 'program': {
      // Senza modalità studio: la scena va subito in onda (di nuovo = la toglie).
      endTransition();
      // Da MIDI o Companion (force) la scena va in onda senza fare da interruttore.
      state.program = !cmd.force && state.program === cmd.id ? null : cmd.id;
      break;
    }
    case 'preview':
      state.preview = cmd.id;
      break;
    case 'take':
      take(cmd.kind);
      break;
    case 'set-studio':
      state.studio = !!cmd.on;
      if (state.studio && !state.preview) {
        const other = state.layers.find((l) => l.type === 'scene' && l.id !== state.program);
        state.preview = other ? other.id : state.program;
      }
      break;
    case 'set-fade':
      state.fadeMs = Math.max(0, Math.min(10000, Number(cmd.ms) || 0));
      break;
    case 'set-background':
      state.background = cmd.color;
      break;
    case 'set-fps':
      state.fps = Math.max(1, Math.min(25, Number(cmd.fps) || 25));
      break;
    case 'set-lang':
      state.lang = cmd.lang === 'en' ? 'en' : 'it';
      i18n.setLang(state.lang);
      break;
    case 'set-help':
      state.showHelp = !!cmd.on;
      break;
    case 'set-midi':
      state.midi = Array.isArray(cmd.midi) ? cmd.midi : [];
      break;
    case 'set-http':
      state.http = { ...state.http, ...cmd.http };
      state.http.port = Math.max(1024, Math.min(65535, Number(state.http.port) || 8765));
      startRemote();
      break;
    case 'set-display':
      state.displayId = cmd.displayId;
      placeDisplayWindow();
      break;
    case 'toggle-display':
      if (displayWin) {
        if (displayWin.isVisible()) displayWin.hide();
        else displayWin.showInactive();
      }
      break;
  }
  saveState();
  broadcast();
});

// --- Comandi a distanza (Companion / Stream Deck) -------------------------------
// Le richieste HTTP arrivano qui e vengono eseguite dalla regia, che conosce
// anche le misure del TelePrompt: così MIDI e Companion fanno le stesse cose.
function startRemote() {
  remote.configure(state.http, (action) => {
    if (!controlWin || controlWin.isDestroyed()) return false;
    controlWin.webContents.send('remote-action', action);
    return true;
  }, () => broadcast());
}

// --- Avvio -----------------------------------------------------------------

app.whenReady().then(() => {
  // Permette alle finestre di usare le periferiche di acquisizione e i controller MIDI.
  const allowed = ['media', 'midi', 'midiSysex'];
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.includes(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.includes(permission));

  i18n.setLang(state.lang);
  ndi.startDiscovery();
  createWindows();
  startRemote();
  displayNumbers.refresh().then(broadcast);

  const onDisplaysChanged = () => {
    placeDisplayWindow();
    broadcast();
    displayNumbers.refresh().then(broadcast);
  };
  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
  screen.on('display-metrics-changed', onDisplaysChanged);
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  ndi.stopDiscovery();
  remote.stop();
});
