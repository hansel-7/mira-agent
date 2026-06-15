const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('catAPI', {
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, pos) => cb(pos)),
  onKey: (cb) => ipcRenderer.on('key', () => cb()),
  chatSend: (payload) => ipcRenderer.send('chat-send', payload),
  onChatChunk: (cb) => ipcRenderer.on('chat-chunk', (_e, d) => cb(d)),
  getProfile: () => ipcRenderer.invoke('profile:get'),
  saveProfile: (p) => ipcRenderer.send('profile:save', p),
  onLayout: (cb) => ipcRenderer.on('layout', (_e, l) => cb(l)),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: () => ipcRenderer.send('drag-move'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  resize: (dir) => ipcRenderer.send('resize', dir),
  setIgnore: (v) => ipcRenderer.send('set-ignore', v),
  quit: () => ipcRenderer.send('quit'),
});
