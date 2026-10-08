const { app, BrowserWindow, ipcMain, screen, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { createLayer, timerElapsedMs } = require('./shared/layers');
const ndi = require('./ndi');

// Stato condiviso: il processo principale è l'unica fonte di verità della
// scena; le due finestre ricevono lo stesso stato e lo mostrano. I timer
// salvano solo quando sono partiti, così ogni finestra calcola da sé il
// valore corrente senza aggiornamenti continui.
const DEFAULT_STATE = {
  layers: [createLayer('timer', { x: 0, y: 0, w: 100, h: 100 })],
  background: '#000000',
  displayId: null
};

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
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    const loaded = { ...structuredClone(DEFAULT_STATE), ...raw };
    // Un timer rimasto in corsa alla chiusura riparte in pausa.
    for (const l of loaded.layers) {
      if (l.type === 'timer' && l.run.running) {
        l.run = { running: false, baseMs: timerElapsedMs(l), startedAt: 0 };
      }
    }
    return loaded;
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
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

function snapshot() {
  const primaryId = screen.getPrimaryDisplay().id;
  const target = targetDisplay();
  return {
    ...state,
    now: Date.now(),
    ndiAvailable: ndi.available,
    ndiError: ndi.error,
    output: { width: target.size.width, height: target.size.height, fullscreen: target.id !== primaryId },
    displays: screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: `Monitor ${i + 1} (${d.size.width}×${d.size.height})${d.id === primaryId ? ' – principale' : ''}`
    })),
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
    backgroundColor: '#15171c',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'control', 'preload.js') }
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
    backgroundColor: state.background,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'display', 'preload.js'),
      // Il preload dell'uscita riceve i flussi NDI con un modulo nativo.
      sandbox: false,
      backgroundThrottling: false
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

function findLayer(id) {
  return state.layers.find((l) => l.id === id);
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

ipcMain.handle('get-state', () => snapshot());
ipcMain.handle('ndi-sources', () => ndi.sources());

ipcMain.on('command', (_evt, cmd) => {
  switch (cmd.type) {
    case 'add-layer': {
      const layer = createLayer(cmd.layerType, cmd.extra);
      if (cmd.layerType === 'timer' || cmd.layerType === 'ticker') {
        state.layers.push(layer); // in primo piano
      } else {
        state.layers.unshift(layer); // i video vanno sotto agli elementi grafici
      }
      break;
    }
    case 'update-layer': {
      const layer = findLayer(cmd.id);
      if (!layer) break;
      const patch = cmd.patch || {};
      if (patch.crop) patch.crop = { ...layer.crop, ...patch.crop };
      Object.assign(layer, patch);
      break;
    }
    case 'remove-layer':
      state.layers = state.layers.filter((l) => l.id !== cmd.id);
      break;
    case 'move-layer': {
      // dir +1 = più in primo piano, -1 = più dietro
      const i = state.layers.findIndex((l) => l.id === cmd.id);
      const j = i + cmd.dir;
      if (i < 0 || j < 0 || j >= state.layers.length) break;
      [state.layers[i], state.layers[j]] = [state.layers[j], state.layers[i]];
      break;
    }
    case 'solo':
      for (const l of state.layers) l.visible = l.id === cmd.id;
      break;
    case 'show-all':
      for (const l of state.layers) l.visible = true;
      break;
    case 'timer': {
      const layer = findLayer(cmd.id);
      if (layer && layer.type === 'timer') timerAction(layer, cmd.action, cmd.seconds);
      break;
    }
    case 'set-background':
      state.background = cmd.color;
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

// --- Avvio -----------------------------------------------------------------

app.whenReady().then(() => {
  // Permette alle finestre di usare le periferiche di acquisizione.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  ndi.startDiscovery();
  createWindows();

  const onDisplaysChanged = () => {
    placeDisplayWindow();
    broadcast();
  };
  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
  screen.on('display-metrics-changed', onDisplaysChanged);
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => ndi.stopDiscovery());
