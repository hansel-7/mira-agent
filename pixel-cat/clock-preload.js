const { contextBridge, ipcRenderer } = require('electron');

// HUD clock window: receives a {phase, remaining} tick once per second.
contextBridge.exposeInMainWorld('clock', {
  onTick: (cb) => ipcRenderer.on('tick', (_e, d) => cb(d)),
  onColor: (cb) => ipcRenderer.on('color', (_e, c) => cb(c)),
});
