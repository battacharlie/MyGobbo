const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('countdown', {
  getState: () => ipcRenderer.invoke('get-state'),
  onState: (cb) => ipcRenderer.on('state', (_evt, state) => cb(state)),
  send: (cmd) => ipcRenderer.send('command', cmd)
});
