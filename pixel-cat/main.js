const { app, BrowserWindow, screen, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DELAY = 2147483647; // setTimeout cap (~24.8 days)
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Fix the app identity so userData (profile.json, future settings) resolves to
// the same %APPDATA%/Mira folder in dev and in the packaged .exe.
app.setName('Mira');

const DEFAULT_AGENT_URL = 'http://localhost:8080';
let bundledAgentUrl = DEFAULT_AGENT_URL;
let agentUrl = DEFAULT_AGENT_URL;
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  if (typeof cfg.agentUrl === 'string' && cfg.agentUrl.trim()) {
    bundledAgentUrl = cfg.agentUrl.trim();
    agentUrl = bundledAgentUrl;
  }
} catch (e) {
  console.error('bundled config.json missing/invalid, falling back to', agentUrl);
}

// Runtime override: bundled config is read-only in packaged builds, so power users
// can point Mira at another agent by editing %APPDATA%/Mira/config.json.
let userConfigPath = null;
function loadUserConfig() {
  userConfigPath = path.join(app.getPath('userData'), 'config.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
    if (typeof cfg.agentUrl === 'string' && cfg.agentUrl.trim()) {
      agentUrl = cfg.agentUrl.trim();
    }
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error('user config.json invalid, using bundled endpoint:', e.message);
    } else {
      try {
        fs.mkdirSync(path.dirname(userConfigPath), { recursive: true });
        fs.writeFileSync(userConfigPath, JSON.stringify({ agentUrl: bundledAgentUrl }, null, 2));
      } catch (err) {
        console.error('user config save failed:', err.message);
      }
    }
  }
  agentUrl = agentUrl.replace(/\/+$/, '');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}
function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
function localWeekStart(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
function localWeekEnd(date = new Date()) {
  return new Date(localWeekStart(date).getTime() + 7 * DAY_MS);
}
function workweekKey(date = new Date()) {
  return localDateKey(localWeekStart(date));
}
function isWeekday(date = new Date()) {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}
function inCurrentWorkweek(ts, ref = new Date()) {
  if (!ts) return false;
  const start = localWeekStart(ref).getTime();
  const end = localWeekEnd(ref).getTime();
  return ts >= start && ts < end;
}
function previousWorkday(date = new Date()) {
  const d = new Date(date);
  do {
    d.setDate(d.getDate() - 1);
  } while (!isWeekday(d));
  return d;
}
function nextWeekdayAt(hour, minute, from = new Date()) {
  for (let i = 0; i < 10; i++) {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    d.setHours(hour, minute, 0, 0);
    if (isWeekday(d) && d > from) return d;
  }
  return new Date(from.getTime() + DAY_MS);
}
function nextFridayAt(hour, minute, from = new Date()) {
  for (let i = 0; i < 10; i++) {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    d.setHours(hour, minute, 0, 0);
    if (d.getDay() === 5 && d > from) return d;
  }
  return new Date(from.getTime() + 7 * DAY_MS);
}
function clampText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
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
function localNowString() {
  const d = new Date();
  return `${localDateKey(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())} (${WEEKDAY[d.getDay()]})`;
}

// ---------- mood check-ins (userData/mood.json) ----------
let moodPath = null;
let mood = { entries: [], lastWeeklySummaryWeek: null };
let moodTimers = [];
let weeklySummaryRunning = false;
let latestWeeklySummaryPayload = null;

const MOOD_WORDS = {
  positive: [
    'good', 'great', 'happy', 'calm', 'excited', 'energized', 'productive',
    'better', 'okay', 'ok', 'fine', 'confident', 'relaxed', 'proud',
  ],
  negative: [
    'bad', 'sad', 'stressed', 'stress', 'tired', 'exhausted', 'anxious',
    'overwhelmed', 'frustrated', 'angry', 'rough', 'terrible', 'awful',
    'burned', 'burnt', 'worried', 'low', 'sick',
  ],
};
function inferMood(text) {
  const lower = String(text || '').toLowerCase();
  let score = 0;
  for (const w of MOOD_WORDS.positive) {
    if (new RegExp(`\\b${w}\\b`).test(lower)) score += 1;
  }
  for (const w of MOOD_WORDS.negative) {
    if (new RegExp(`\\b${w}\\b`).test(lower)) score -= 1;
  }
  score = Math.max(-1, Math.min(1, score / 3));
  const label = score <= -0.34 ? 'low' : score >= 0.34 ? 'positive' : 'neutral';
  return { score, label };
}
function normalizeMood() {
  if (!mood || typeof mood !== 'object') mood = { entries: [], lastWeeklySummaryWeek: null };
  if (!Array.isArray(mood.entries)) mood.entries = [];
  mood.entries = mood.entries
    .filter((e) => e && typeof e.date === 'string')
    .map((e) => ({
      date: e.date,
      promptedAt: Number(e.promptedAt) || null,
      respondedAt: Number(e.respondedAt) || null,
      rawText: clampText(e.rawText, 1200),
      mood: e.mood || e.label || 'neutral',
      score: Number.isFinite(Number(e.score)) ? Number(e.score) : 0,
      summary: clampText(e.summary || e.rawText, 300),
    }));
}
function loadMood() {
  moodPath = path.join(app.getPath('userData'), 'mood.json');
  try {
    mood = JSON.parse(fs.readFileSync(moodPath, 'utf8'));
  } catch (e) {
    mood = { entries: [], lastWeeklySummaryWeek: null };
  }
  normalizeMood();
  saveMood();
}
function saveMood() {
  if (!moodPath) return;
  try {
    fs.mkdirSync(path.dirname(moodPath), { recursive: true });
    fs.writeFileSync(moodPath, JSON.stringify(mood, null, 2));
  } catch (err) {
    console.error('mood save failed:', err.message);
  }
}
function moodEntry(dateKey) {
  return mood.entries.find((e) => e.date === dateKey);
}
function currentWeekMoodEntries(ref = new Date()) {
  const start = localWeekStart(ref).getTime();
  const end = localWeekEnd(ref).getTime();
  return mood.entries.filter((e) => {
    if (!e.respondedAt) return false;
    const t = new Date(e.date + 'T12:00:00').getTime();
    return t >= start && t < end;
  });
}
function moodContextSummary() {
  const entries = currentWeekMoodEntries();
  if (!entries.length) return 'No weekday mood check-ins have been recorded for this workweek yet.';
  const lines = entries.map((e) => `- ${e.date}: ${e.mood} (${e.summary || e.rawText || 'no note'})`);
  return 'This workweek mood check-in data:\n' + lines.join('\n');
}
function buildMoodPrompt(now = new Date()) {
  const prev = moodEntry(localDateKey(previousWorkday(now)));
  if (!prev || !prev.respondedAt) return 'Good morning. How are you feeling today?';
  if (prev.score <= -0.34) {
    return `Good morning. Yesterday sounded a bit heavy: ${prev.summary || prev.rawText}. How did yesterday end up, and how are you feeling this morning?`;
  }
  if (prev.score >= 0.34) {
    return `Good morning. You sounded good yesterday: ${prev.summary || prev.rawText}. How are you feeling today?`;
  }
  return `Good morning. Yesterday sounded steady: ${prev.summary || prev.rawText}. How are you feeling today?`;
}
function recordMoodResponse({ dateKey, text }) {
  const rawText = clampText(text, 1200);
  if (!dateKey || !rawText) return;
  const inferred = inferMood(rawText);
  const existing = moodEntry(dateKey);
  const rec = existing || { date: dateKey, promptedAt: Date.now() };
  rec.respondedAt = Date.now();
  rec.rawText = rawText;
  rec.mood = inferred.label;
  rec.score = inferred.score;
  rec.summary = rawText.length > 220 ? rawText.slice(0, 217) + '...' : rawText;
  if (!existing) mood.entries.push(rec);
  mood.entries.sort((a, b) => a.date.localeCompare(b.date));
  saveMood();
}

// One client-side system message injected into every chat request: profile +
// current local time + the reminder-creation protocol (parsed back in the renderer).
function injectedSystemMessage() {
  const parts = [];
  if (profile) {
    const bits = [];
    if (profile.name) bits.push(`Their name is ${profile.name}.`);
    if (profile.department) bits.push(`They work in ${profile.department}.`);
    if (profile.hobbies) bits.push(`Hobbies/interests: ${profile.hobbies}.`);
    if (profile.behavior) bits.push(`Preferred tone/behaviour: ${profile.behavior}.`);
    if (bits.length) parts.push('About the user (personalize accordingly): ' + bits.join(' '));
  }
  parts.push(`Current local time: ${localNowString()}. Resolve relative times like "tomorrow" or "in 2 hours" against this.`);
  parts.push(moodContextSummary());
  parts.push(tasksSummary());
  parts.push(
    'If the latest user message is answering a scheduled mood check-in, respond warmly in 1-3 sentences. ' +
      'Acknowledge the feeling, avoid sounding clinical, and offer one gentle next step only if it fits.'
  );
  parts.push(
    'You can set reminders for the user. ONLY when they ask to be reminded of something or to set a reminder, do BOTH: ' +
      '(1) reply in one short friendly sentence confirming the task and when; ' +
      '(2) then on a new final line append exactly [[REMINDER]]{"task":"...","datetime":"YYYY-MM-DDTHH:MM","repeat":"once|daily|weekly","remindBefore":<minutes>}[[/REMINDER]] . ' +
      'datetime is LOCAL time and the next occurrence; repeat must be one of once, daily, weekly; remindBefore is minutes to pre-warn (default 15, 0 for none). ' +
      "If the requested schedule cannot be expressed as once/daily/weekly (e.g. monthly or weekdays-only), tell them you can't do that schedule yet and DO NOT append the block. " +
      'Never output the reminder block during normal conversation.'
  );
  parts.push(
    'You can also create checklist tasks (a task with subtasks). ONLY when the user asks to create/add a task, do BOTH: ' +
      '(1) reply in one short friendly sentence confirming the task; ' +
      '(2) then on a new final line append exactly [[TASK]]{"title":"...","deadline":"YYYY-MM-DDTHH:MM" or null,"subtasks":["...","..."]}[[/TASK]] . ' +
      'deadline is LOCAL time, or null if none was given. subtasks is an array of short subtask titles: use the ones the user listed; if they ask you to generate/break it down, produce a sensible 3-6 step breakdown; use [] if none apply. ' +
      'Never output the task block during normal conversation.'
  );
  return { role: 'system', content: parts.join('\n\n') };
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
  win.webContents.on('did-finish-load', () => {
    sendLayout();
    sendCatColor();
    startWellbeingTimers();
  });

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
    // prepend profile + current time + reminder protocol (client-side injection)
    const messages = [injectedSystemMessage(), ...history];
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
ipcMain.on('mood:response', (_e, payload) => recordMoodResponse(payload || {}));

// ---------- right-click menu + form dialogs ----------
const DIALOG_SIZE = {
  profile: { width: 380, height: 470 },
  reminders: { width: 400, height: 580 },
  pomodoro: { width: 380, height: 470 },
  checklist: { width: 460, height: 640 },
  'cat-color': { width: 400, height: 440 },
  'weekly-summary': { width: 520, height: 640 },
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
ipcMain.handle('weekly-summary:get', () => currentWeeklyRecapPayload());

// Mira speaks via her bubble (reminders firing, pomodoro phase changes)
function notify(text) {
  if (win && !win.isDestroyed()) win.webContents.send('notify', text);
}

function setManagedTimer(fn, delay) {
  const safeDelay = Math.max(0, Math.min(delay, MAX_DELAY));
  const timer = setTimeout(() => {
    if (delay > MAX_DELAY) {
      setManagedTimer(fn, delay - MAX_DELAY);
    } else {
      fn();
    }
  }, safeDelay);
  moodTimers.push(timer);
  return timer;
}
function clearMoodTimers() {
  moodTimers.forEach(clearTimeout);
  moodTimers = [];
}
function promptMoodCheckIfDue(now = new Date()) {
  if (!profile || !win || win.isDestroyed() || !isWeekday(now)) return;
  const ten = new Date(now);
  ten.setHours(9, 30, 0, 0);
  if (now < ten) return;
  const dateKey = localDateKey(now);
  const existing = moodEntry(dateKey);
  if (existing && existing.respondedAt) return;
  const rec = existing || { date: dateKey };
  rec.promptedAt = rec.promptedAt || Date.now();
  if (!existing) mood.entries.push(rec);
  saveMood();
  win.webContents.send('mood-prompt', { dateKey, prompt: buildMoodPrompt(now) });
}
function completedReminderEventsForWeek(start, end) {
  const events = [];
  for (const r of reminders) {
    if ((r.repeat || 'once') === 'once' && r.completedAt >= start && r.completedAt < end) {
      events.push({ task: r.task, completedAt: r.completedAt, action: 'completed', repeat: r.repeat || 'once' });
    } else if (r.hiddenAt >= start && r.hiddenAt < end) {
      events.push({ task: r.task, completedAt: r.hiddenAt, action: 'hidden from view', repeat: r.repeat || 'once' });
    }
    for (const c of r.completions || []) {
      if (c.completedAt >= start && c.completedAt < end) {
        events.push({ task: r.task, completedAt: c.completedAt, action: 'completed', repeat: r.repeat || 'once' });
      }
    }
  }
  events.sort((a, b) => a.completedAt - b.completedAt);
  return events;
}
function completedTaskEventsForWeek(start, end) {
  const events = [];
  for (const t of tasks) {
    if (t.completedAt >= start && t.completedAt < end) {
      events.push({ title: t.title, completedAt: t.completedAt, kind: 'task', action: 'completed' });
    } else if (t.hiddenAt >= start && t.hiddenAt < end) {
      events.push({ title: t.title, completedAt: t.hiddenAt, kind: 'task', action: 'hidden from view' });
    }
    for (const s of t.subtasks || []) {
      if (s.completedAt >= start && s.completedAt < end) {
        events.push({ title: `${t.title} - ${s.title}`, completedAt: s.completedAt, kind: 'subtask', action: 'completed' });
      } else if (s.hiddenAt >= start && s.hiddenAt < end) {
        events.push({ title: `${t.title} - ${s.title}`, completedAt: s.hiddenAt, kind: 'subtask', action: 'hidden from view' });
      }
    }
  }
  events.sort((a, b) => a.completedAt - b.completedAt);
  return events;
}
function weeklyActivity(ref = new Date()) {
  const startDate = localWeekStart(ref);
  const start = startDate.getTime();
  const end = localWeekEnd(ref).getTime();
  return {
    weekKey: workweekKey(ref),
    start,
    end,
    moods: currentWeekMoodEntries(ref),
    tasks: completedTaskEventsForWeek(start, end),
    reminders: completedReminderEventsForWeek(start, end),
  };
}
function moodEmoji(score, hasEntry) {
  if (!hasEntry) return '\u25FB\uFE0F';
  if (score >= 0.5) return '\uD83D\uDE04';
  if (score >= 0.15) return '\uD83D\uDE42';
  if (score > -0.15) return '\uD83D\uDE10';
  if (score > -0.5) return '\uD83D\uDE1F';
  return '\uD83D\uDE23';
}
function moodLabel(score, hasEntry) {
  if (!hasEntry) return 'No check-in';
  if (score >= 0.34) return 'Bright';
  if (score <= -0.34) return 'Heavy';
  return 'Steady';
}
function weeklyMoodDays(activity) {
  const byDate = new Map(activity.moods.map((m) => [m.date, m]));
  const start = new Date(activity.start);
  return [0, 1, 2, 3, 4].map((offset) => {
    const d = new Date(start);
    d.setDate(start.getDate() + offset);
    const date = localDateKey(d);
    const entry = byDate.get(date);
    const hasEntry = !!entry;
    const score = hasEntry ? Number(entry.score) || 0 : null;
    return {
      date,
      day: SHORT_WEEKDAY[d.getDay()],
      emoji: moodEmoji(score, hasEntry),
      mood: moodLabel(score, hasEntry),
      summary: hasEntry ? (entry.summary || entry.rawText || '') : '',
      score,
      hasEntry,
    };
  });
}
function weeklyMoodTrend(days) {
  const entries = days.filter((d) => d.hasEntry);
  if (!entries.length) return 'No mood check-ins landed this week, so Mira is keeping the recap gentle and task-focused.';
  const avg = entries.reduce((sum, d) => sum + d.score, 0) / entries.length;
  const first = entries[0].score;
  const last = entries[entries.length - 1].score;
  const tone = avg >= 0.34 ? 'mostly bright' : avg <= -0.34 ? 'pretty heavy' : 'mixed but steady';
  let direction = 'held fairly steady';
  if (last - first >= 0.34) direction = 'ended lighter than it started';
  if (last - first <= -0.34) direction = 'asked more from you toward the end';
  return `${entries.length}/5 check-ins recorded. Your week felt ${tone}, and it ${direction}.`;
}
function weeklyWinItems(activity) {
  const items = [];
  for (const t of activity.tasks) {
    items.push({
      title: clampText(t.title || 'Checklist item', 180),
      source: t.kind === 'subtask' ? 'Subtask' : 'Task',
      action: t.action === 'completed' ? 'Completed' : 'Cleared from view',
      when: formatEventDate(t.completedAt),
      at: t.completedAt,
    });
  }
  for (const r of activity.reminders) {
    items.push({
      title: clampText(r.task || 'Reminder', 180),
      source: (r.repeat || 'once') === 'once' ? 'Reminder' : 'Recurring reminder',
      action: r.action === 'completed' ? 'Completed' : 'Cleared from view',
      when: formatEventDate(r.completedAt),
      at: r.completedAt,
    });
  }
  items.sort((a, b) => a.at - b.at);
  return items;
}
function weeklyConqueredText(items) {
  if (!items.length) return 'No completed checklist or reminder items were recorded this week, but the recap still counts the fact that you showed up.';
  const completed = items.filter((i) => i.action === 'Completed').length;
  const cleared = items.length - completed;
  const parts = [];
  if (completed) parts.push(`${completed} completed`);
  if (cleared) parts.push(`${cleared} cleared from view`);
  return `You moved ${items.length} item${items.length === 1 ? '' : 's'} through the week: ${parts.join(', ')}.`;
}
function buildWeeklyRecapPayload(activity, encouragementText = '') {
  const days = weeklyMoodDays(activity);
  const items = weeklyWinItems(activity);
  const visibleItems = items.slice(-10);
  const weekStart = new Date(activity.start);
  const weekEnd = new Date(activity.start + 4 * DAY_MS);
  return {
    weekKey: activity.weekKey,
    generatedAt: Date.now(),
    weekLabel: `${SHORT_WEEKDAY[weekStart.getDay()]} ${pad2(weekStart.getMonth() + 1)}/${pad2(weekStart.getDate())} - ${SHORT_WEEKDAY[weekEnd.getDay()]} ${pad2(weekEnd.getMonth() + 1)}/${pad2(weekEnd.getDate())}`,
    days,
    moodTrend: weeklyMoodTrend(days),
    conqueredText: weeklyConqueredText(items),
    wins: visibleItems,
    hiddenWinCount: Math.max(0, items.length - visibleItems.length),
    encouragementText: clampText(encouragementText, 1400) || weeklySummaryFallback(activity),
  };
}
function currentWeeklyRecapPayload() {
  const week = workweekKey();
  if (latestWeeklySummaryPayload && latestWeeklySummaryPayload.weekKey === week) return latestWeeklySummaryPayload;
  if (mood.lastWeeklySummary && mood.lastWeeklySummary.weekKey === week) return mood.lastWeeklySummary;
  return buildWeeklyRecapPayload(weeklyActivity(new Date()), '');
}
function showWeeklySummary(activity, encouragementText) {
  const payload = buildWeeklyRecapPayload(activity, encouragementText);
  latestWeeklySummaryPayload = payload;
  mood.lastWeeklySummaryWeek = activity.weekKey;
  mood.lastWeeklySummary = payload;
  saveMood();
  notify('Your Friday recap is ready.');
  openDialog('weekly-summary');
}
function formatEventDate(ms) {
  const d = new Date(ms);
  return `${SHORT_WEEKDAY[d.getDay()]} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function weeklySummaryFallback(activity) {
  const moodCount = activity.moods.length;
  const taskCount = activity.tasks.length;
  const reminderCount = activity.reminders.length;
  const wins = [];
  if (taskCount) wins.push(`${taskCount} checklist activit${taskCount === 1 ? 'y' : 'ies'}`);
  if (reminderCount) wins.push(`${reminderCount} reminder activit${reminderCount === 1 ? 'y' : 'ies'}`);
  const moodLine = moodCount
    ? `You checked in ${moodCount} time${moodCount === 1 ? '' : 's'} this week.`
    : 'You made it through the week without mood check-in data.';
  const workLine = wins.length
    ? `You also moved through ${wins.join(' and ')}.`
    : 'There were not many completed checklist or reminder items recorded, but showing up still counts.';
  return `${moodLine} ${workLine} Nice work getting to Friday. Take a breath before next week.`;
}
function weeklySummaryPrompt(activity) {
  const moodLines = activity.moods.map((m) => `- ${m.date}: ${m.mood}; ${m.summary || m.rawText || 'no note'}`);
  const taskLines = activity.tasks.map((t) => `- ${formatEventDate(t.completedAt)}: ${t.title} (${t.action})`);
  const reminderLines = activity.reminders.map((r) => `- ${formatEventDate(r.completedAt)}: ${r.task} (${r.action})`);
  return [
    'Write the encouragement section for a visual Friday weekly recap from Mira.',
    'Tone: warm, specific, proud, and not clinical. Do not guilt the user.',
    'The visual already lists mood emoji and completed/cleared work, so do not repeat every item.',
    'Base the encouragement on the emotional trend and the checklist/reminder activity.',
    'Keep it to one short paragraph under 110 words.',
    '',
    'Mood check-ins:',
    moodLines.length ? moodLines.join('\n') : '- none recorded',
    '',
    'Checklist activity:',
    taskLines.length ? taskLines.join('\n') : '- none recorded',
    '',
    'Reminder activity:',
    reminderLines.length ? reminderLines.join('\n') : '- none recorded',
  ].join('\n');
}
async function fetchAgentText(messages) {
  const res = await fetch(agentUrl + '/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history: messages }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let pending = '';
  let text = '';
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
      if (data === '[DONE]') return text;
      try {
        const chunk = JSON.parse(data);
        if (chunk.content) text += chunk.content;
      } catch {}
    }
  }
  return text;
}
async function runWeeklySummaryIfDue(now = new Date()) {
  if (!profile || weeklySummaryRunning || now.getDay() !== 5) return;
  const five = new Date(now);
  five.setHours(17, 0, 0, 0);
  if (now < five) return;
  const week = workweekKey(now);
  if (mood.lastWeeklySummaryWeek === week) return;
  weeklySummaryRunning = true;
  const activity = weeklyActivity(now);
  try {
    const text = await fetchAgentText([
      { role: 'system', content: 'You are Mira, a supportive AI desktop pet.' },
      { role: 'user', content: weeklySummaryPrompt(activity) },
    ]);
    const summary = clampText(text, 1400) || weeklySummaryFallback(activity);
    showWeeklySummary(activity, summary);
  } catch (err) {
    console.error('weekly summary failed:', err.message);
    showWeeklySummary(activity, weeklySummaryFallback(activity));
  } finally {
    weeklySummaryRunning = false;
  }
}
function startWellbeingTimers() {
  clearMoodTimers();
  promptMoodCheckIfDue();
  runWeeklySummaryIfDue();
  const now = new Date();
  const nextMood = nextWeekdayAt(9, 30, now);
  const nextSummary = nextFridayAt(17, 0, now);
  setManagedTimer(() => startWellbeingTimers(), nextMood.getTime() - now.getTime());
  setManagedTimer(() => startWellbeingTimers(), nextSummary.getTime() - now.getTime());
}

// ---------- settings (userData/settings.json) ----------
let settingsPath = null;
let settings = { clockColor: 'auto', catColor: '#000000' };
function normalizeHexColor(value, fallback = '#000000') {
  const raw = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  return fallback;
}
function loadSettings() {
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath, 'utf8')) };
  } catch (e) { /* defaults */ }
  settings.catColor = normalizeHexColor(settings.catColor);
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
function sendCatColor() {
  if (win && !win.isDestroyed()) win.webContents.send('cat-color', settings.catColor);
}
function setClockColor(c) {
  settings.clockColor = c;
  saveSettings();
  sendClockColor();
}
function setCatColor(c) {
  settings.catColor = normalizeHexColor(c);
  saveSettings();
  sendCatColor();
}
ipcMain.handle('cat-color:get', () => settings.catColor);
ipcMain.on('cat-color:set', (_e, c) => setCatColor(c));

// ---------- reminders (userData/reminders.json) ----------
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
function hideReminder(id) {
  const r = reminders.find((x) => x.id === id);
  if (!r) return;
  clearReminderTimers(id);
  r.hiddenAt = Date.now();
  saveReminders();
}
function reminderVisible(r) {
  if (r.hiddenAt) return false;
  if (r.repeat && r.repeat !== 'once') return true;
  if (r.completedAt) return inCurrentWorkweek(r.completedAt);
  return r.deadline > Date.now();
}
function recordReminderCompletion(r, completedAt = Date.now()) {
  r.completions = Array.isArray(r.completions) ? r.completions : [];
  const deadline = Number(r.deadline) || completedAt;
  if (!r.completions.some((c) => c.deadline === deadline)) {
    r.completions.push({ deadline, completedAt });
  }
  r.completedAt = completedAt;
}
function armReminder(r) {
  clearReminderTimers(r.id);
  if (r.hiddenAt || (r.repeat === 'once' && r.completedAt)) return;
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
        recordReminderCompletion(r);
        r.deadline = nextOccurrence(r.deadline, r.repeat); // recurring: schedule next, keep it
        saveReminders();
        armReminder(r);
      } else {
        r.completedAt = Date.now();
        saveReminders();
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
  reminders = reminders.map((r) => ({
    ...r,
    createdAt: Number(r.createdAt) || Number(r.deadline) || Date.now(),
    deadline: Number(r.deadline) || Date.now(),
    remindBefore: Number(r.remindBefore) || 0,
    repeat: r.repeat || 'once',
    completions: Array.isArray(r.completions) ? r.completions : [],
  }));
  // recurring: roll any missed ones forward; once: mark due items complete and retain for the week
  reminders.forEach((r) => {
    if (r.repeat && r.repeat !== 'once') {
      while (!r.hiddenAt && r.deadline <= Date.now()) {
        recordReminderCompletion(r, r.deadline);
        r.deadline = nextOccurrence(r.deadline, r.repeat);
      }
      return;
    }
    if (!r.completedAt && r.deadline <= Date.now()) r.completedAt = r.deadline;
  });
  saveReminders();
  reminders.forEach(armReminder);
}
ipcMain.on('reminder:add', (_e, r) => {
  const rec = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    task: r.task,
    createdAt: Date.now(),
    deadline: r.deadline,
    remindBefore: r.remindBefore,
    repeat: r.repeat || 'once',
    completedAt: null,
    hiddenAt: null,
    completions: [],
  };
  reminders.push(rec);
  saveReminders();
  armReminder(rec);
});
ipcMain.handle('reminders:get', () => reminders.filter(reminderVisible));
ipcMain.on('reminder:remove', (_e, id) => hideReminder(id));

// ---------- checklist / tasks (userData/tasks.json) ----------
// task = { id, title, deadline, done, completedAt, hiddenAt, subtasks: [{ id, title, done, completedAt }] }
let tasksPath = null;
let tasks = [];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function loadTasks() {
  tasksPath = path.join(app.getPath('userData'), 'tasks.json');
  try {
    tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
  } catch (e) {
    tasks = [];
  }
  tasks = tasks.map(normalizeTask);
  saveTasks();
}
function saveTasks() {
  try {
    fs.mkdirSync(path.dirname(tasksPath), { recursive: true });
    fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2));
  } catch (err) {
    console.error('tasks save failed:', err.message);
  }
  const w = dialogs['checklist']; // live-refresh the checklist window if open
  if (w && !w.isDestroyed()) w.webContents.send('tasks:changed');
}
function normalizeTask(t) {
  const task = {
    ...t,
    id: t.id || uid(),
    title: clampText(t.title, 200),
    createdAt: Number(t.createdAt) || Date.now(),
    deadline: t.deadline || null,
    done: !!t.done,
    completedAt: t.completedAt || null,
    hiddenAt: t.hiddenAt || null,
    subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
  };
  task.subtasks = task.subtasks.map((s) => ({
    ...s,
    id: s.id || uid(),
    title: clampText(s.title, 200),
    done: !!s.done,
    completedAt: s.completedAt || (s.done ? Date.now() : null),
    hiddenAt: s.hiddenAt || null,
  }));
  updateTaskCompletion(task, false);
  return task;
}
function taskProgress(t) {
  const visibleSubs = t.subtasks.filter((s) => !s.hiddenAt);
  if (!visibleSubs.length) return { total: 1, done: t.done ? 1 : 0, pct: t.done ? 100 : 0 };
  const done = visibleSubs.filter((s) => s.done).length;
  return { total: visibleSubs.length, done, pct: Math.round((done / visibleSubs.length) * 100) };
}
function isTaskComplete(t) {
  const visibleSubs = t.subtasks.filter((s) => !s.hiddenAt);
  if (!visibleSubs.length) return !!t.done;
  return visibleSubs.every((s) => s.done);
}
function updateTaskCompletion(t, allowUncomplete = true) {
  const complete = isTaskComplete(t);
  if (complete && !t.completedAt) t.completedAt = Date.now();
  if (!complete && allowUncomplete) t.completedAt = null;
}
function taskVisible(t) {
  if (t.hiddenAt) return false;
  if (t.completedAt) return inCurrentWorkweek(t.completedAt);
  return true;
}
function taskForView(t) {
  return { ...t, subtasks: t.subtasks.filter((s) => !s.hiddenAt) };
}
function tasksSummary() {
  const visibleTasks = tasks.filter(taskVisible);
  if (!visibleTasks.length) return 'The user has no tasks on their checklist right now.';
  const lines = visibleTasks.map((t) => {
    const { total, done } = taskProgress(t);
    const dl = t.deadline ? new Date(t.deadline).toLocaleString() : 'no deadline';
    const status = t.completedAt ? 'complete' : 'active';
    const visibleSubs = t.subtasks.filter((s) => !s.hiddenAt);
    const subs = visibleSubs.length ? ' [' + visibleSubs.map((s) => `${s.done ? 'done' : 'todo'}: ${s.title}`).join('; ') + ']' : '';
    return `- ${t.title} (${status}; deadline ${dl}; ${done}/${total} done)${subs}`;
  });
  return "The user's checklist (answer questions about their tasks using this):\n" + lines.join('\n');
}

ipcMain.handle('tasks:get', () => tasks.filter(taskVisible).map(taskForView));
ipcMain.on('task:add', (_e, { title, deadline }) => {
  if (!title || !String(title).trim()) return;
  tasks.push({
    id: uid(),
    title: clampText(title, 200),
    createdAt: Date.now(),
    deadline: deadline || null,
    done: false,
    completedAt: null,
    hiddenAt: null,
    subtasks: [],
  });
  saveTasks();
});
ipcMain.on('task:remove', (_e, id) => {
  const t = tasks.find((x) => x.id === id);
  if (t) t.hiddenAt = Date.now();
  saveTasks();
});
ipcMain.on('subtask:add', (_e, { taskId, title }) => {
  const t = tasks.find((x) => x.id === taskId);
  if (!t || !title || !String(title).trim()) return;
  t.done = false;
  t.subtasks.push({ id: uid(), title: clampText(title, 200), done: false, completedAt: null, hiddenAt: null });
  updateTaskCompletion(t);
  saveTasks();
});
ipcMain.on('subtask:remove', (_e, { taskId, subId }) => {
  const t = tasks.find((x) => x.id === taskId);
  if (!t) return;
  const s = t.subtasks.find((x) => x.id === subId);
  if (s) s.hiddenAt = Date.now();
  updateTaskCompletion(t);
  saveTasks();
});
ipcMain.on('subtask:toggle', (_e, { taskId, subId }) => {
  const t = tasks.find((x) => x.id === taskId);
  const s = t && t.subtasks.find((y) => y.id === subId);
  if (s) {
    s.done = !s.done;
    s.completedAt = s.done ? Date.now() : null;
    updateTaskCompletion(t);
    saveTasks();
  }
});
ipcMain.on('task:toggle-done', (_e, id) => {
  const t = tasks.find((x) => x.id === id);
  if (!t || t.subtasks.length) return;
  t.done = !t.done;
  updateTaskCompletion(t);
  saveTasks();
});
// atomic create (task + subtasks) — used by the NL "create a task…" chat path
ipcMain.on('task:create', (_e, { title, deadline, subtasks }) => {
  if (!title || !String(title).trim()) return;
  const subs = (Array.isArray(subtasks) ? subtasks : [])
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((s) => ({ id: uid(), title: s.slice(0, 200), done: false, completedAt: null, hiddenAt: null }));
  tasks.push({
    id: uid(),
    title: clampText(title, 200),
    createdAt: Date.now(),
    deadline: deadline || null,
    done: false,
    completedAt: null,
    hiddenAt: null,
    subtasks: subs,
  });
  saveTasks();
});

// ---------- pomodoro (timer state machine + HUD clock window) ----------
let pomo = { running: false };
let pomoTimer = null;
let clockWin = null;

function positionClock() {
  if (!clockWin || clockWin.isDestroyed() || !win || win.isDestroyed()) return;
  const b = win.getBounds();
  const cw = clockWin.getBounds();
  const x = b.x + Math.round(b.width / 2 - cw.width / 2);
  const catTop = b.y + BUBBLE_H;
  clockWin.setPosition(x, catTop - cw.height + 16); // centered just above Mira's head
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
  if (win && !win.isDestroyed()) win.webContents.send('pomo-active', true); // lift the bubble
  notify('🍅 Focus time — let\'s go!');
  pomoTimer = setInterval(pomoStep, 1000);
}
function stopPomodoro() {
  if (pomoTimer) { clearInterval(pomoTimer); pomoTimer = null; }
  if (clockWin && !clockWin.isDestroyed()) clockWin.close();
  clockWin = null;
  pomo = { running: false };
  if (win && !win.isDestroyed()) win.webContents.send('pomo-active', false);
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
  const items = [
    { label: 'Checklist…', click: () => openDialog('checklist') },
    { label: 'Reminders…', click: () => openDialog('reminders') },
  ];
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
  items.push({ label: 'Cat color…', click: () => openDialog('cat-color') });
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
  loadUserConfig();
  loadProfile();
  loadMood();
  loadReminders();
  loadTasks();
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
  clearMoodTimers();
  reminderTimers.forEach((timers) => timers.forEach(clearTimeout));
});
app.on('window-all-closed', () => app.quit());
