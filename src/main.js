const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// Stato condiviso: il processo principale è l'unica fonte di verità del timer,
// le due finestre ricevono lo stesso stato e lo mostrano.
const DEFAULT_SETTINGS = {
  durationSec: 10 * 60,
  title: '',
  message: '',
  endText: 'TEMPO SCADUTO',
  warningSec: 60,
  overtime: true,
  showTitle: true,
  showMessage: true,
  colors: {
    background: '#000000',
    text: '#ffffff',
    warning: '#ffb020',
    end: '#ff3b30'
  },
  presets: [5, 10, 15, 20, 30, 45, 60],
  displayId: null
};

let settings = loadSettings();
let timer = {
  running: false,
  remainingMs: settings.durationSec * 1000, // valido quando non è in corsa
  endAt: 0 // timestamp di fine quando è in corsa
};

let controlWin = null;
let displayWin = null;
let tickHandle = null;

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return { ...DEFAULT_SETTINGS, ...raw, colors: { ...DEFAULT_SETTINGS.colors, ...(raw.colors || {}) } };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Impossibile salvare le impostazioni:', err);
  }
}

function remainingMs() {
  return timer.running ? timer.endAt - Date.now() : timer.remainingMs;
}

function snapshot() {
  return {
    settings,
    running: timer.running,
    remainingMs: remainingMs(),
    displays: screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: `Monitor ${i + 1} (${d.size.width}×${d.size.height})${d.id === screen.getPrimaryDisplay().id ? ' – principale' : ''}`
    })),
    displayId: displayWin ? targetDisplay().id : null
  };
}

function broadcast() {
  const state = snapshot();
  for (const win of [controlWin, displayWin]) {
    if (win && !win.isDestroyed()) win.webContents.send('state', state);
  }
}

function startTicking() {
  if (tickHandle) return;
  tickHandle = setInterval(() => {
    if (!timer.running) return;
    if (!settings.overtime && remainingMs() <= 0) {
      timer.running = false;
      timer.remainingMs = 0;
    }
    broadcast();
  }, 100);
}

// Monitor di destinazione: quello scelto dall'utente se ancora collegato,
// altrimenti il primo monitor che non è il principale.
function targetDisplay() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  return (
    displays.find((d) => d.id === settings.displayId) ||
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
    const { x, y, width, height } = target.workArea;
    const w = Math.round(width * 0.5);
    const h = Math.round(w * 9 / 16);
    displayWin.setBounds({ x: x + width - w - 20, y: y + 20, width: w, height: h });
    displayWin.setAlwaysOnTop(false);
  } else {
    displayWin.setBounds(target.bounds);
    displayWin.setFullScreen(true);
  }
}

function createWindows() {
  const primary = screen.getPrimaryDisplay();
  const { x, y, width, height } = primary.workArea;

  controlWin = new BrowserWindow({
    x: x + Math.round((width - 900) / 2),
    y: y + Math.round((height - 760) / 2),
    width: 900,
    height: 760,
    minWidth: 640,
    minHeight: 520,
    title: 'Mio Countdown – Controllo',
    backgroundColor: '#15171c',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  controlWin.loadFile(path.join(__dirname, 'control', 'control.html'));
  controlWin.on('closed', () => {
    controlWin = null;
    app.quit();
  });

  displayWin = new BrowserWindow({
    frame: false,
    show: false,
    title: 'Mio Countdown – Schermo',
    backgroundColor: settings.colors.background,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
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

// --- IPC dalla finestra di controllo -------------------------------------

ipcMain.handle('get-state', () => snapshot());

ipcMain.on('command', (_evt, cmd) => {
  switch (cmd.type) {
    case 'start':
      if (!timer.running) {
        let ms = timer.remainingMs;
        if (ms <= 0 && !settings.overtime) ms = settings.durationSec * 1000;
        timer.endAt = Date.now() + ms;
        timer.running = true;
      }
      break;
    case 'pause':
      if (timer.running) {
        timer.remainingMs = remainingMs();
        timer.running = false;
      }
      break;
    case 'reset':
      timer.running = false;
      timer.remainingMs = settings.durationSec * 1000;
      break;
    case 'set-duration': {
      const sec = Math.max(0, Math.round(Number(cmd.seconds) || 0));
      settings.durationSec = sec;
      timer.running = false;
      timer.remainingMs = sec * 1000;
      saveSettings();
      break;
    }
    case 'adjust': {
      // Aggiunge o toglie secondi anche a timer in corsa.
      const delta = Math.round(Number(cmd.seconds) || 0) * 1000;
      if (timer.running) timer.endAt += delta;
      else timer.remainingMs = Math.max(0, timer.remainingMs + delta);
      break;
    }
    case 'update-settings': {
      const patch = cmd.patch || {};
      settings = {
        ...settings,
        ...patch,
        colors: { ...settings.colors, ...(patch.colors || {}) }
      };
      saveSettings();
      if ('displayId' in patch) placeDisplayWindow();
      break;
    }
    case 'toggle-display':
      if (displayWin) {
        if (displayWin.isVisible()) displayWin.hide();
        else displayWin.showInactive();
      }
      break;
  }
  broadcast();
});

// --- Avvio ---------------------------------------------------------------

app.whenReady().then(() => {
  createWindows();
  startTicking();

  const onDisplaysChanged = () => {
    placeDisplayWindow();
    broadcast();
  };
  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
  screen.on('display-metrics-changed', onDisplaysChanged);
});

app.on('window-all-closed', () => app.quit());
