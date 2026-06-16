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
  getTasks: () => ipcRenderer.invoke('tasks:get'),
  addTask: (t) => ipcRenderer.send('task:add', t),
  removeTask: (id) => ipcRenderer.send('task:remove', id),
  addSubtask: (s) => ipcRenderer.send('subtask:add', s),
  removeSubtask: (s) => ipcRenderer.send('subtask:remove', s),
  toggleSubtask: (s) => ipcRenderer.send('subtask:toggle', s),
  onTasksChanged: (cb) => ipcRenderer.on('tasks:changed', () => cb()),
  close: () => ipcRenderer.send('dialog:close'),
});
