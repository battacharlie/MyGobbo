// Contagocce: fotografa gli schermi e apre una finestra a tutto schermo sul
// monitor della regia dove si clicca il colore da prelevare. Si può anche
// aprire un'immagine dal disco e prelevare il colore da lì. La finestra non
// copre mai il monitor di uscita, così il pubblico non vede nulla.
const { BrowserWindow, desktopCapturer, screen, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const displayNumbers = require('../displaynumbers');

let active = null;

async function captureScreens(t) {
  const displays = screen.getAllDisplays();
  const maxW = Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor)));
  const maxH = Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor)));
  let sources = [];
  try {
    sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: maxW, height: maxH } });
  } catch (err) {
    console.error('Impossibile fotografare lo schermo:', err);
  }
  // Stessi numeri dei monitor di Windows.
  const numbers = displayNumbers.numbers(displays);
  return sources
    .filter((s) => !s.thumbnail.isEmpty())
    .map((s, i) => {
      const d = displays.find((x) => String(x.id) === s.display_id);
      const n = d ? numbers.get(d.id) : 100 + i;
      return { label: `${t('Monitor')} ${d ? n : i + 1}`, order: n, displayId: s.display_id, url: s.thumbnail.toDataURL() };
    })
    .sort((a, b) => a.order - b.order);
}

const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' };

async function pickColor(parent, t = (s) => s) {
  if (active) {
    active.focus();
    return null;
  }
  const shots = await captureScreens(t);
  const display = parent && !parent.isDestroyed() ? screen.getDisplayMatching(parent.getBounds()) : screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    ...display.bounds,
    frame: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    backgroundColor: '#000000',
    title: `IGOR - ${t('Preleva colore')}`,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), spellcheck: false }
  });
  active = win;
  return new Promise((resolve) => {
    let result = null;
    const onDone = (evt, color) => {
      if (evt.sender !== win.webContents) return;
      result = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null;
      win.close();
    };
    const onOpen = async (evt) => {
      if (evt.sender !== win.webContents) return null;
      const res = await dialog.showOpenDialog(win, {
        title: t('Apri un\'immagine da cui prelevare il colore'),
        properties: ['openFile'],
        filters: [{ name: t('Immagini'), extensions: Object.keys(IMAGE_MIME) }]
      });
      if (res.canceled || !res.filePaths.length) return null;
      const file = res.filePaths[0];
      const mime = IMAGE_MIME[path.extname(file).slice(1).toLowerCase()] || 'image/png';
      return { label: path.basename(file), url: `data:${mime};base64,${fs.readFileSync(file).toString('base64')}` };
    };
    ipcMain.on('picker-done', onDone);
    ipcMain.handle('picker-open-image', onOpen);
    win.on('closed', () => {
      ipcMain.removeListener('picker-done', onDone);
      ipcMain.removeHandler('picker-open-image');
      active = null;
      if (parent && !parent.isDestroyed()) parent.focus();
      resolve(result);
    });
    win.webContents.once('did-finish-load', () => {
      // Prima lo schermo della regia: sembra di cliccare sullo schermo vero.
      const first = shots.findIndex((s) => s.displayId === String(display.id));
      win.webContents.send('picker-init', {
        shots,
        first: Math.max(0, first),
        texts: {
          hint: t('Clicca sul colore da prelevare (B sposta questa barra)'),
          open: t('Apri immagine…'),
          cancel: t('Annulla (Esc)')
        }
      });
      win.setFullScreen(true);
      win.show();
      win.focus();
    });
    win.loadFile(path.join(__dirname, 'picker.html'));
  });
}

module.exports = { pickColor };
