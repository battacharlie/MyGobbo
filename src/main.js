const { app, BrowserWindow, ipcMain, screen, session, dialog, shell, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { createLayer, timerElapsedMs, prompterY, TIMER_COLORS, TYPE_LABELS, MAX_FPS, DEFAULT_FPS, VIDEO_EXT, IMAGE_EXT, PER_ITEM, KEEP_ON_RESET, allLayers, findNode, composeLayers, newId, isVisual } = require('./shared/layers');
const ndi = require('./ndi');
const { readTextFile, TEXT_EXT } = require('./textimport');
const { pickColor } = require('./picker/main');
const displayNumbers = require('./displaynumbers');
const ndiOut = require('./ndisend');

// Mini manuale (italiano e inglese) sul sito del progetto.
const MANUAL_URL = 'https://github.com/battacharlie/MyGobbo/blob/main/docs/MANUALE.md';
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
  fps: 0, // fotogrammi al secondo dell'uscita: 0 = Auto (come il monitor di uscita)
  fpsAuto: true, // presente dalla 0.4.11: prima 25 era il massimo e il valore iniziale
  // Modalità light: niente scene né modalità studio. Gli input della scena
  // che era in onda diventano un elenco semplice; le scene restano da parte
  // in parked (con le loro sorgenti chiuse) e tornano con la modalità full.
  light: false,
  parked: null,
  // Preferenze della regia (non finiscono nei file di configurazione).
  lang: 'it',
  showHelp: true,
  midi: [], // associazioni MIDI: { key, action, arg }
  http: { enabled: false, port: 8765, lan: false }, // comandi per Companion / Stream Deck
  ndiOut: false // uscita inviata in rete come sorgente NDI
};
// Parti dello stato salvate in "Esporta configurazione".
const CONFIG_KEYS = ['layers', 'background', 'displayId', 'studio', 'program', 'preview', 'fadeMs', 'fps', 'light', 'parked'];
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
  if (loaded.parked && Array.isArray(loaded.parked.scenes)) {
    loaded.parked.scenes = loaded.parked.scenes
      .filter((p) => p && p.scene && p.scene.type === 'scene')
      .map((p) => ({ index: Number(p.index) || 0, scene: upgrade([p.scene], false)[0] }));
  } else {
    loaded.parked = null;
  }
  loaded.light = !!loaded.light && !!loaded.parked;
  if (loaded.light) loaded.studio = false;
  // Timer e TelePrompt rimasti in corsa ripartono in pausa.
  const parkedLayers = loaded.parked ? allLayers(loaded.parked.scenes.map((p) => p.scene)) : [];
  for (const l of [...allLayers(loaded.layers), ...parkedLayers]) {
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
  // Fino alla 0.4.10 l'uscita era bloccata a 25: chi l'aveva lasciata così
  // passa ad Auto (frequenza del monitor).
  if (!('fpsAuto' in raw) && Number(loaded.fps) === 25) loaded.fps = 0;
  loaded.fpsAuto = true;
  loaded.fps = Number(loaded.fps) > 0 ? Math.max(1, Math.min(MAX_FPS, Number(loaded.fps))) : 0;
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
  // Video: dal menu "Riproduzione" a tre caselle separate.
  if (l.type === 'media' && 'playMode' in l) {
    l.playOnAir = l.playMode !== 'always';
    l.pauseOffAir = l.playMode !== 'always';
    l.rewindOffAir = l.playMode === 'restart';
    delete l.playMode;
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

function monitorHz() {
  return Math.round(targetDisplay().displayFrequency || 0);
}

function outputFps() {
  return state.fps > 0 ? state.fps : Math.min(MAX_FPS, monitorHz() || DEFAULT_FPS);
}

function snapshot() {
  const primaryId = screen.getPrimaryDisplay().id;
  const target = targetDisplay();
  return {
    ...state,
    // fps: quelli usati davvero; fpsChoice: la scelta (0 = Auto); monitorHz:
    // la frequenza del monitor di uscita.
    fps: outputFps(),
    fpsChoice: state.fps,
    monitorHz: monitorHz(),
    transition,
    now: Date.now(),
    ndiAvailable: ndi.available,
    ndiError: ndi.error,
    ndiOutStatus: ndiOut.status(),
    output: { width: target.size.width, height: target.size.height, fullscreen: target.id !== primaryId },
    displays: displayList(),
    httpStatus: remote.status(),
    activeDisplayId: target.id,
    displayVisible: !!(displayWin && displayWin.isVisible())
  };
}

// TelePrompt e video che partono quando vanno in onda (il TelePrompt si
// ferma anche quando esce; i video li ferma la finestra di uscita).
// Si guarda il cambiamento rispetto all'ultima volta: chi lo avvia o lo
// ferma a mano mentre è in onda (o fuori) resta libero di farlo.
let prompterOnAir = new Map(); // id del TelePrompt (o del gruppo di copie) -> in onda
function syncPrompterOnAir() {
  const on = new Set(composeLayers(state.layers, state.program ? [state.program] : [])
    .filter((l) => l.visible && (l.type === 'prompter' || l.type === 'media')).map((l) => l.link || l.id));
  const next = new Map();
  for (const l of allLayers(state.layers)) {
    if (l.type !== 'prompter' && l.type !== 'media') continue;
    const key = l.link || l.id;
    if (next.has(key)) continue;
    const now = on.has(key);
    next.set(key, now);
    const was = prompterOnAir.get(key);
    if (was === undefined || was === now) continue;
    if (l.type === 'media') {
      if (now && l.playOnAir && !l.playing) for (const c of linkedLayers(l)) c.playing = true;
      continue;
    }
    let action = null;
    if (!now && l.pauseOffAir && l.run.running) action = 'pause';
    if (now && l.playOnAir && !l.run.running) action = 'start';
    if (!action) continue;
    prompterAction(l, { action });
    for (const c of linkedLayers(l)) c.run = { ...l.run };
  }
  prompterOnAir = next;
}

function broadcast() {
  syncPrompterOnAir();
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
  setOutputFullScreen(false);

  if (isPrimary) {
    // Un solo monitor: anteprima in finestra, così il controllo resta usabile.
    const { x, y, width } = target.workArea;
    const w = Math.round(width * 0.45);
    displayWin.setBounds({ x: x + width - w - 20, y: y + 20, width: w, height: Math.round(w * 9 / 16) });
  } else {
    displayWin.setBounds(target.bounds);
    setOutputFullScreen(true);
  }
}

// Sul Mac lo schermo intero normale apre uno "spazio" nuovo con
// un'animazione: per l'uscita si usa quello semplice, immediato e fermo
// sul monitor scelto.
function setOutputFullScreen(on) {
  if (process.platform === 'darwin') {
    if (displayWin.isSimpleFullScreen() !== on) displayWin.setSimpleFullScreen(on);
  } else if (on || displayWin.isFullScreen()) {
    displayWin.setFullScreen(on);
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
  // La regia parte a tutto schermo; ridotta non scende sotto la larghezza
  // che serve alla barra in basso per stare su una riga (la calcola la regia).
  controlWin.maximize();
  controlWin.loadFile(path.join(__dirname, 'control', 'control.html'));
  // Schede dei dettagli aperte in una finestra a parte (pagina vuota che la
  // regia riempie da sé). Ogni altro indirizzo si apre nel browser.
  controlWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { icon: ICON, backgroundColor: '#15171c', autoHideMenuBar: true, minWidth: 260, minHeight: 160 }
      };
    }
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
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
    syncNdiOut();
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

// Incolla copie indipendenti degli input copiati o tagliati in regia: davanti
// all'elemento cliccato (dentro la scena, se è una scena), altrimenti in
// primo piano. Le scene restano nel livello principale.
function pasteLayers(layers, refId) {
  if (!Array.isArray(layers)) return;
  const ref = refId && findNode(state.layers, refId);
  const fresh = (l) => {
    const copy = { ...upgradeLayer({ ...createLayer(l.type), ...structuredClone(l) }), id: newId() };
    delete copy.link;
    if (copy.type === 'timer' && copy.run.running) copy.run = { running: false, baseMs: timerElapsedMs(copy), startedAt: 0 };
    if (copy.type === 'prompter' && copy.run.running) copy.run = { running: false, y: prompterY(copy), startedAt: 0 };
    if (copy.type === 'scene') copy.children = (copy.children || []).filter((c) => c.type !== 'scene').map(fresh);
    return copy;
  };
  for (const l of layers) {
    if (!l || !TYPE_LABELS[l.type] || (l.type === 'scene' && state.light)) continue;
    const copy = fresh(l);
    let list = state.layers;
    let index = null;
    if (ref && ref.layer.type === 'scene' && copy.type !== 'scene') {
      list = ref.layer.children;
    } else if (ref && !(copy.type === 'scene' && ref.list !== state.layers)) {
      list = ref.list;
      index = list.indexOf(ref.layer) + 1;
    }
    if (index == null) insertLayer(list, copy);
    else list.splice(index, 0, copy);
  }
}

// "Copia attributi": come è personalizzato un input (colori, caratteri,
// opzioni...), senza il contenuto (file, testo, sorgente), il nome, la
// posizione e lo stato di timer, TelePrompt e video.
const NOT_ATTRIBUTES = new Set(['id', 'type', 'name', 'visible', 'link', 'children', 'x', 'y', 'w', 'h', 'crop',
  'source', 'deviceId', 'deviceLabel', 'file', 'src', 'mediaKind', 'text', 'html', 'run', 'playing', 'restartAt',
  'seekTo', 'inPoint', 'outPoint', 'durationSec']);
function attributesOf(values) {
  const out = {};
  for (const [k, v] of Object.entries(values || {})) if (!NOT_ATTRIBUTES.has(k)) out[k] = structuredClone(v);
  return out;
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

// --- Modalità light / full --------------------------------------------------------

// Passa alla modalità light: gli input della scena in onda prendono il posto
// della scena (stesse posizioni, l'uscita non cambia), le scene vanno da parte.
function enterLight() {
  if (state.light) return;
  endTransition();
  const scenes = [];
  const layers = [];
  state.layers.forEach((l, index) => {
    if (l.type !== 'scene') {
      layers.push(l);
    } else if (l.id === state.program) {
      for (const c of l.children) layers.push(Object.assign(c, { fromScene: l.id }));
      scenes.push({ index, scene: { ...l, children: [] } });
    } else {
      scenes.push({ index, scene: l });
    }
  });
  state.parked = { scenes, program: state.program, preview: state.preview, studio: state.studio };
  state.layers = layers;
  state.light = true;
  state.studio = false;
  state.program = null;
  state.preview = null;
}

// Torna alla modalità full: le scene tornano al loro posto e gli input che
// venivano dalla scena in onda rientrano in quella scena, che resta in onda.
function enterFull() {
  if (!state.light) return;
  const parked = state.parked || { scenes: [] };
  const sceneById = new Map(parked.scenes.map((p) => [p.scene.id, p.scene]));
  // Input usati in modalità light: le loro impostazioni sono le più recenti.
  const current = new Map();
  for (const l of state.layers) if (l.link) current.set(l.link, l);
  const layers = [];
  for (const l of state.layers) {
    const scene = l.fromScene && sceneById.get(l.fromScene);
    delete l.fromScene;
    if (scene) scene.children.push(l);
    else layers.push(l);
  }
  // Le copie collegate rimaste nelle altre scene prendono le impostazioni
  // cambiate nel frattempo (sorgente, testi, colori…).
  for (const p of parked.scenes) {
    for (const c of p.scene.children) {
      const src = c.link && current.get(c.link);
      if (!src || src === c) continue;
      for (const [k, v] of Object.entries(src)) if (!PER_ITEM.includes(k)) c[k] = structuredClone(v);
    }
  }
  for (const p of [...parked.scenes].sort((a, b) => a.index - b.index)) {
    layers.splice(Math.min(p.index, layers.length), 0, p.scene);
  }
  state.layers = layers;
  const isScene = (id) => sceneById.has(id);
  state.program = isScene(parked.program) ? parked.program : null;
  state.preview = isScene(parked.preview) ? parked.preview : null;
  state.studio = !!parked.studio;
  state.parked = null;
  state.light = false;
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

// Posizione dei video (dall'uscita) per la timeline nella regia.
ipcMain.on('video-times', (_evt, list) => {
  if (controlWin && !controlWin.isDestroyed()) controlWin.webContents.send('video-times', list);
});

ipcMain.on('set-min-width', (_evt, w) => {
  if (!controlWin || controlWin.isDestroyed()) return;
  const min = Math.max(900, Math.ceil(Number(w) || 0));
  controlWin.setMinimumSize(min, 600);
  const [width, height] = controlWin.getSize();
  if (width < min && !controlWin.isMaximized()) controlWin.setSize(min, height);
});

ipcMain.on('command', (_evt, cmd) => {
  switch (cmd.type) {
    case 'add-layer':
      if (state.light && cmd.layerType === 'scene') break;
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
        updateLayer(layer, { ...media, playing: true, restartAt: Date.now(), inPoint: 0, outPoint: 0 });
        saveState();
        broadcast();
      });
      return;
    }
    case 'pick-beep': {
      const id = cmd.id;
      dialog.showOpenDialog(controlWin, {
        title: t('Scegli un file audio'),
        properties: ['openFile'],
        filters: [{ name: t('Audio'), extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'webm'] }]
      }).then((res) => {
        const layer = findLayer(id);
        if (res.canceled || !res.filePaths.length || !layer) return;
        const file = res.filePaths[0];
        updateLayer(layer, { beepFile: file, beepSrc: pathToFileURL(file).href });
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
    case 'paste-layers':
      pasteLayers(cmd.layers, cmd.refId);
      break;
    case 'paste-attributes':
      for (const id of cmd.ids || []) {
        const layer = findLayer(id);
        if (layer && cmd.attrs && layer.type === cmd.attrs.type) updateLayer(layer, attributesOf(cmd.attrs.values));
      }
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
      if (state.light && cmd.parentId) break;
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
      if (state.light) break;
      // Senza modalità studio: la scena va subito in onda (di nuovo = la toglie).
      endTransition();
      // Da MIDI o Companion (force) la scena va in onda senza fare da interruttore.
      state.program = !cmd.force && state.program === cmd.id ? null : cmd.id;
      break;
    }
    case 'preview':
      if (state.light) break;
      state.preview = cmd.id;
      break;
    case 'take':
      if (!state.light) take(cmd.kind);
      break;
    case 'set-light':
      if (cmd.on) enterLight();
      else enterFull();
      break;
    case 'set-ndi-out':
      state.ndiOut = !!cmd.on;
      syncNdiOut();
      break;
    case 'set-studio':
      if (state.light) break;
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
      state.fps = Number(cmd.fps) > 0 ? Math.max(1, Math.min(MAX_FPS, Number(cmd.fps))) : 0;
      break;
    case 'set-lang':
      state.lang = cmd.lang === 'en' ? 'en' : 'it';
      i18n.setLang(state.lang);
      break;
    case 'open-manual':
      shell.openExternal(MANUAL_URL);
      return;
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

// --- Uscita in NDI --------------------------------------------------------------

function syncNdiOut() {
  if (state.ndiOut && displayWin && !displayWin.isDestroyed()) ndiOut.start(displayWin, outputFps, broadcast);
  else ndiOut.stop(broadcast);
}

// --- Avvio -----------------------------------------------------------------

app.whenReady().then(() => {
  // Permette alle finestre di usare le periferiche di acquisizione e i controller MIDI.
  const allowed = ['media', 'midi', 'midiSysex'];
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.includes(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.includes(permission));

  // Sul Mac il sistema chiede una volta il permesso di usare le telecamere
  // e le schede di acquisizione.
  if (process.platform === 'darwin') systemPreferences.askForMediaAccess('camera').catch(() => {});

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
  ndiOut.stop();
  remote.stop();
});
