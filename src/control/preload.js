const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('countdown', {
  getState: () => ipcRenderer.invoke('get-state'),
  onState: (cb) => ipcRenderer.on('state', (_evt, state) => cb(state)),
  send: (cmd) => ipcRenderer.send('command', cmd),
  setMinWidth: (w) => ipcRenderer.send('set-min-width', w),
  onVideoTimes: (cb) => ipcRenderer.on('video-times', (_evt, list) => cb(list)),
  ndiSources: () => ipcRenderer.invoke('ndi-sources'),
  cameraAccess: () => ipcRenderer.invoke('camera-access'),
  pickColor: () => ipcRenderer.invoke('pick-color'),
  importText: () => ipcRenderer.invoke('import-text'),
  outputSourceId: () => ipcRenderer.invoke('output-source-id'),
  outputFrame: () => ipcRenderer.invoke('output-frame'),
  qrCode: (text) => ipcRenderer.invoke('qr-code', text),
  platform: process.platform,
  onRemoteAction: (cb) => ipcRenderer.on('remote-action', (_evt, action) => cb(action))
});
