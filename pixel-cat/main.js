const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let agentUrl = 'http://localhost:8080';
try {
  agentUrl = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')).agentUrl;
} catch (e) {
  console.error('config.json missing/invalid, falling back to', agentUrl);
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
const BUBBLE_H = 150; // space reserved above the cat for the speech bubble
const INPUT_H = 56;   // space reserved below the cat for the chat input
const MIN_W = 340;

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
    const res = await fetch(agentUrl + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history }),
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
});

app.whenReady().then(() => {
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
});
app.on('window-all-closed', () => app.quit());
