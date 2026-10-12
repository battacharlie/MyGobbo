const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('countdown', {
  getState: () => ipcRenderer.invoke('get-state'),
  onState: (cb) => ipcRenderer.on('state', (_evt, state) => cb(state)),
  send: (cmd) => ipcRenderer.send('command', cmd),
  setMinWidth: (w) => ipcRenderer.send('set-min-width', w),
  onVideoTimes: (cb) => ipcRenderer.on('video-times', (_evt, list) => cb(list)),
  ndiSources: () => ipcRenderer.invoke('ndi-sources'),
  pickColor: () => ipcRenderer.invoke('pick-color'),
  importText: () => ipcRenderer.invoke('import-text'),
  outputSourceId: () => ipcRenderer.invoke('output-source-id'),
  onRemoteAction: (cb) => ipcRenderer.on('remote-action', (_evt, action) => cb(action))
});
