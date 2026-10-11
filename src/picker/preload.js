const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('picker', {
  onInit: (cb) => ipcRenderer.once('picker-init', (_evt, data) => cb(data)),
  done: (color) => ipcRenderer.send('picker-done', color),
  openImage: () => ipcRenderer.invoke('picker-open-image')
});
