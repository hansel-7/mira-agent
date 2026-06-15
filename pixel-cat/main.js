const { app, BrowserWindow, screen, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// Fix the app identity so userData (profile.json, future settings) resolves to
// the same %APPDATA%/Mira folder in dev and in the packaged .exe.
app.setName('Mira');

let agentUrl = 'http://localhost:8080';
try {
  agentUrl = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')).agentUrl;
} catch (e) {
  console.error('config.json missing/invalid, falling back to', agentUrl);
}

// per-user profile (onboarding answers) — lives only in userData, never bundled.
// Loaded after app is ready; injected into every chat request as a system message.
let profile = null;
let profilePath = null;
function loadProfile() {
  profilePath = path.join(app.getPath('userData'), 'profile.json');
  try {
    profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  } catch (e) {
    profile = null; // no profile yet -> renderer runs onboarding
  }
}
function profileSystemMessage() {
  if (!profile) return null;
  const bits = [];
  if (profile.name) bits.push(`The user's name is ${profile.name}.`);
  if (profile.department) bits.push(`They work in ${profile.department}.`);
  if (profile.hobbies) bits.push(`Their hobbies/interests: ${profile.hobbies}.`);
  if (profile.behavior) bits.push(`Preferred assistant tone/behaviour: ${profile.behavior}.`);
  if (!bits.length) return null;
  return { role: 'system', content: 'About the user you are chatting with — personalize accordingly. ' + bits.join(' ') };
}

// global key hook -> typing animation (fails soft if the native module won't load)
let uIOhook = null;
try {
  ({ uIOhook } = require('uiohook-napi'));
} catch (e) {
  console.error('uiohook-napi unavailable, typing animation disabled:', e.message);
}

const SPRITE = 80;
const MIN_SCALE = 1;
const MAX_SCALE = 8;
const BUBBLE_H = 270; // space reserved above the cat for the speech bubble (fits the scrollable bubble)
const INPUT_H = 56;   // space reserved below the cat for the chat input
const MIN_W = 420;

let scale = 3; // starting size (scroll wheel on the cat to change at runtime)
let win;
let dragOrigin = null;

const winW = () => Math.max(SPRITE * scale, MIN_W);
const winH = () => BUBBLE_H + SPRITE * scale + INPUT_H;

function sendLayout() {
  win.webContents.send('layout', {
    scale,
    bubbleH: BUBBLE_H,
    inputH: INPUT_H,
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: winW(),
    height: winH(),
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false, // keep animating while a dialog/menu is focused
    },
  });
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', sendLayout);

  // start near bottom-right; cat feet just above the taskbar
  const { workArea } = screen.getPrimaryDisplay();
  win.setPosition(
    workArea.x + workArea.width - winW() - 40,
    workArea.y + workArea.height - winH() - 4
  );

  // pass clicks through except where the renderer says otherwise
  win.setIgnoreMouseEvents(true, { forward: true });

  // poll global cursor position -> renderer (eye follow + body lean)
  const timer = setInterval(() => {
    if (win.isDestroyed()) return clearInterval(timer);
    const c = screen.getCursorScreenPoint();
    const b = win.getBounds();
    // relative to the cat's center (cat sits between bubble and input)
    const catCx = b.x + b.width / 2;
    const catCy = b.y + BUBBLE_H + (SPRITE * scale) / 2;
    win.webContents.send('cursor', { x: c.x - catCx, y: c.y - catCy });
  }, 50);
}

// manual window dragging (renderer detects drag on the cat itself)
ipcMain.on('drag-start', () => {
  const [x, y] = win.getPosition();
  const c = screen.getCursorScreenPoint();
  dragOrigin = { winX: x, winY: y, curX: c.x, curY: c.y };
});
ipcMain.on('drag-move', () => {
  if (!dragOrigin) return;
  const c = screen.getCursorScreenPoint();
  win.setPosition(
    dragOrigin.winX + (c.x - dragOrigin.curX),
    dragOrigin.winY + (c.y - dragOrigin.curY)
  );
  positionClock(); // keep the pomodoro HUD beside Mira while she's dragged
});
ipcMain.on('drag-end', () => (dragOrigin = null));
ipcMain.on('quit', () => app.quit());

// chat: relay to the agent from the main process (the file:// renderer
// can't call the endpoint itself — no CORS headers on the backend).
// Streams SSE chunks back to the renderer; a new request aborts the previous one.
let chatAbort = null;
ipcMain.on('chat-send', async (_e, { id, history }) => {
  if (chatAbort) chatAbort.abort();
  const ac = (chatAbort = new AbortController());
  const send = (payload) => {
    if (win && !win.isDestroyed()) win.webContents.send('chat-chunk', { id, ...payload });
  };
  try {
    // prepend the user profile so every request is personalized (client-side injection)
    const sys = profileSystemMessage();
    const messages = sys ? [sys, ...history] : history;
    const res = await fetch(agentUrl + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: messages }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let pending = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += dec.decode(value, { stream: true });
      let i;
      while ((i = pending.indexOf('\n\n')) !== -1) {
        const line = pending.slice(0, i).trim();
        pending = pending.slice(i + 2);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          send({ done: true });
          return;
        }
        try {
          const { content } = JSON.parse(data);
          if (content) send({ content });
        } catch {} // skip malformed events
      }
    }
    send({ done: true });
  } catch (err) {
    if (!ac.signal.aborted) send({ error: err.message });
  } finally {
    if (chatAbort === ac) chatAbort = null;
  }
});

// profile: renderer reads it on launch (null -> run onboarding) and writes it when done
ipcMain.handle('profile:get', () => profile);
ipcMain.on('profile:save', (_e, p) => {
  profile = p;
  try {
    fs.mkdirSync(path.dirname(profilePath), { recursive: true });
    fs.writeFileSync(profilePath, JSON.stringify(p, null, 2));
  } catch (err) {
    console.error('profile save failed:', err.message);
  }
});

// ---------- right-click menu + form dialogs ----------
const DIALOG_SIZE = {
  profile: { width: 380, height: 470 },
  reminders: { width: 400, height: 580 },
  pomodoro: { width: 380, height: 470 },
};
const dialogs = {}; // name -> BrowserWindow (one instance per dialog)
function openDialog(name) {
  if (dialogs[name] && !dialogs[name].isDestroyed()) {
    dialogs[name].focus();
    return;
  }
  const w = new BrowserWindow({
    ...DIALOG_SIZE[name],
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Mira',
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'dialog-preload.js') },
  });
  w.setMenuBarVisibility(false);
  w.loadFile(path.join(__dirname, 'dialogs', name + '.html'));
  dialogs[name] = w;
  w.on('closed', () => delete dialogs[name]);
}
ipcMain.on('dialog:close', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && !w.isDestroyed()) w.close();
});

// Mira speaks via her bubble (reminders firing, pomodoro phase changes)
function notify(text) {
  if (win && !win.isDestroyed()) win.webContents.send('notify', text);
}

// ---------- settings (userData/settings.json) ----------
let settingsPath = null;
let settings = { clockColor: 'auto' };
function loadSettings() {
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath, 'utf8')) };
  } catch (e) { /* defaults */ }
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('settings save failed:', err.message);
  }
}
function sendClockColor() {
  if (clockWin && !clockWin.isDestroyed()) clockWin.webContents.send('color', settings.clockColor);
}
function setClockColor(c) {
  settings.clockColor = c;
  saveSettings();
  sendClockColor();
}

// ---------- reminders (userData/reminders.json) ----------
const MAX_DELAY = 2147483647; // setTimeout cap (~24.8 days)
let remindersPath = null;
let reminders = [];
const reminderTimers = new Map(); // id -> [timeoutId, ...]

const PERIOD = { daily: 86400000, weekly: 7 * 86400000 };
function nextOccurrence(deadline, repeat) {
  let d = deadline;
  do { d += PERIOD[repeat]; } while (d <= Date.now());
  return d; // roll forward to the next future occurrence (fixed-period; ignores DST shifts)
}
function saveReminders() {
  try {
    fs.mkdirSync(path.dirname(remindersPath), { recursive: true });
    fs.writeFileSync(remindersPath, JSON.stringify(reminders, null, 2));
  } catch (err) {
    console.error('reminders save failed:', err.message);
  }
  const w = dialogs['reminders']; // live-refresh the manage list if it's open
  if (w && !w.isDestroyed()) w.webContents.send('reminders:changed');
}
function clearReminderTimers(id) {
  const t = reminderTimers.get(id);
  if (t) { t.forEach(clearTimeout); reminderTimers.delete(id); }
}
function removeReminder(id) {
  clearReminderTimers(id);
  reminders = reminders.filter((r) => r.id !== id);
  saveReminders();
}
function armReminder(r) {
  clearReminderTimers(r.id);
  const now = Date.now();
  const timers = [];
  const preAt = r.deadline - r.remindBefore * 60000;
  if (preAt > now && preAt - now <= MAX_DELAY) {
    timers.push(setTimeout(() => notify(`⏰ "${r.task}" is due in ${r.remindBefore} min.`), preAt - now));
  }
  const dueDelay = r.deadline - now;
  if (dueDelay <= MAX_DELAY) {
    timers.push(setTimeout(() => {
      notify(`⏰ "${r.task}" is due now!`);
      if (r.repeat && r.repeat !== 'once') {
        r.deadline = nextOccurrence(r.deadline, r.repeat); // recurring: schedule next, keep it
        saveReminders();
        armReminder(r);
      } else {
        removeReminder(r.id);
      }
    }, Math.max(0, dueDelay)));
  }
  reminderTimers.set(r.id, timers);
}
function loadReminders() {
  remindersPath = path.join(app.getPath('userData'), 'reminders.json');
  try {
    reminders = JSON.parse(fs.readFileSync(remindersPath, 'utf8'));
  } catch (e) {
    reminders = [];
  }
  // recurring: roll any missed ones forward; once: drop if its deadline passed
  reminders = reminders.filter((r) => {
    if (r.repeat && r.repeat !== 'once') {
      if (r.deadline <= Date.now()) r.deadline = nextOccurrence(r.deadline, r.repeat);
      return true;
    }
    return r.deadline > Date.now();
  });
  saveReminders();
  reminders.forEach(armReminder);
}
ipcMain.on('reminder:add', (_e, r) => {
  const rec = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    task: r.task,
    deadline: r.deadline,
    remindBefore: r.remindBefore,
    repeat: r.repeat || 'once',
  };
  reminders.push(rec);
  saveReminders();
  armReminder(rec);
});
ipcMain.handle('reminders:get', () => reminders);
ipcMain.on('reminder:remove', (_e, id) => removeReminder(id));

// ---------- pomodoro (timer state machine + HUD clock window) ----------
let pomo = { running: false };
let pomoTimer = null;
let clockWin = null;

function positionClock() {
  if (!clockWin || clockWin.isDestroyed() || !win || win.isDestroyed()) return;
  const b = win.getBounds();
  const cw = clockWin.getBounds();
  const catRight = b.x + Math.round(b.width / 2 + (SPRITE * scale) / 2);
  const catCy = b.y + BUBBLE_H + Math.round((SPRITE * scale) / 2);
  clockWin.setPosition(catRight + 6, catCy - Math.round(cw.height / 2));
}
function createClock() {
  clockWin = new BrowserWindow({
    width: 132,
    height: 76,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'clock-preload.js'),
      backgroundThrottling: false, // never focused -> would otherwise freeze
    },
  });
  clockWin.setIgnoreMouseEvents(true); // pure HUD, never grabs clicks
  clockWin.loadFile(path.join(__dirname, 'clock.html'));
  clockWin.webContents.once('did-finish-load', () => { sendTick(); sendClockColor(); });
  clockWin.on('closed', () => (clockWin = null));
  positionClock();
}
function sendTick() {
  if (clockWin && !clockWin.isDestroyed()) {
    clockWin.webContents.send('tick', { phase: pomo.phase, remaining: pomo.remaining });
  }
}
function enterPhase(phase) {
  pomo.phase = phase;
  const mins = phase === 'focus' ? pomo.cfg.focus : phase === 'long' ? pomo.cfg.longBreak : pomo.cfg.break;
  pomo.remaining = mins * 60;
  notify(phase === 'focus' ? '🍅 Focus time — let\'s go!' : phase === 'long' ? '🌴 Long break!' : '☕ Break time!');
  sendTick();
}
function pomoStep() {
  if (!pomo.running) return;
  pomo.remaining--;
  if (pomo.remaining <= 0) {
    if (pomo.phase === 'focus') {
      pomo.done++;
      enterPhase(pomo.done % pomo.cfg.intervals === 0 ? 'long' : 'break');
    } else {
      enterPhase('focus');
    }
  } else {
    sendTick();
  }
}
function startPomodoro(cfg) {
  stopPomodoro();
  pomo = { running: true, cfg, done: 0, phase: 'focus', remaining: cfg.focus * 60 };
  createClock();
  notify('🍅 Focus time — let\'s go!');
  pomoTimer = setInterval(pomoStep, 1000);
}
function stopPomodoro() {
  if (pomoTimer) { clearInterval(pomoTimer); pomoTimer = null; }
  if (clockWin && !clockWin.isDestroyed()) clockWin.close();
  clockWin = null;
  pomo = { running: false };
}
ipcMain.on('pomodoro:start', (_e, cfg) => startPomodoro(cfg));

const CLOCK_COLORS = [
  { label: 'Auto (by phase)', value: 'auto' },
  { label: 'White', value: '#ffffff' },
  { label: 'Yellow', value: '#ffe14d' },
  { label: 'Pink', value: '#ff8ad1' },
  { label: 'Cyan', value: '#5cd6ff' },
  { label: 'Green', value: '#4dd07a' },
  { label: 'Orange', value: '#ff9f43' },
];
function buildMenu() {
  const items = [{ label: 'Reminders…', click: () => openDialog('reminders') }];
  items.push(
    pomo.running
      ? { label: 'Stop Pomodoro', click: stopPomodoro }
      : { label: 'Start Pomodoro…', click: () => openDialog('pomodoro') }
  );
  items.push({
    label: 'Timer color',
    submenu: CLOCK_COLORS.map((c) => ({
      label: c.label,
      type: 'radio',
      checked: settings.clockColor === c.value,
      click: () => setClockColor(c.value),
    })),
  });
  items.push({ label: 'Edit profile…', click: () => openDialog('profile') });
  items.push({ type: 'separator' });
  items.push({ label: 'Quit Mira', click: () => app.quit() });
  return Menu.buildFromTemplate(items);
}
ipcMain.on('show-menu', () => {
  if (win && !win.isDestroyed()) buildMenu().popup({ window: win });
});

// renderer-controlled click-through (hover over cat/bubble/input = interactive)
ipcMain.on('set-ignore', (_e, ignore) => {
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(ignore, { forward: true });
});

// scroll wheel on the cat -> grow/shrink, cat feet stay anchored
ipcMain.on('resize', (_e, dir) => {
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale + dir));
  if (next === scale) return;
  const b = win.getBounds();
  const oldW = winW();
  const oldFeetY = b.y + BUBBLE_H + SPRITE * scale;
  scale = next;
  win.setBounds({
    x: b.x + Math.round((oldW - winW()) / 2),
    y: oldFeetY - BUBBLE_H - SPRITE * scale,
    width: winW(),
    height: winH(),
  });
  sendLayout();
  positionClock(); // re-anchor the pomodoro HUD after a size change
});

app.whenReady().then(() => {
  loadProfile();
  loadReminders();
  loadSettings();
  createWindow();
  if (uIOhook) {
    uIOhook.on('keydown', () => {
      if (win && !win.isDestroyed()) win.webContents.send('key');
    });
    uIOhook.start();
  }
});
app.on('will-quit', () => {
  if (uIOhook) uIOhook.stop();
  if (pomoTimer) clearInterval(pomoTimer);
  reminderTimers.forEach((timers) => timers.forEach(clearTimeout));
});
app.on('window-all-closed', () => app.quit());
