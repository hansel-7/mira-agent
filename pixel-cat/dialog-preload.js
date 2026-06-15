const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the small form windows (profile / reminders / pomodoro).
contextBridge.exposeInMainWorld('api', {
  getProfile: () => ipcRenderer.invoke('profile:get'),
  saveProfile: (p) => ipcRenderer.send('profile:save', p),
  addReminder: (r) => ipcRenderer.send('reminder:add', r),
  getReminders: () => ipcRenderer.invoke('reminders:get'),
  removeReminder: (id) => ipcRenderer.send('reminder:remove', id),
  onRemindersChanged: (cb) => ipcRenderer.on('reminders:changed', () => cb()),
  startPomodoro: (cfg) => ipcRenderer.send('pomodoro:start', cfg),
  close: () => ipcRenderer.send('dialog:close'),
});
