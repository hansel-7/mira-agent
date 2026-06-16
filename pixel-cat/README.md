# pixel-cat

Mira — an AI desktop pet: black pixel cat with an idle rig (blink, ear flicks, tail sway, eye-follow), a popcat yapping animation while she "speaks", and a typing reaction driven by global keystrokes.

## Run

```
cd pixel-cat
npm install --ignore-scripts
npm start
```

`--ignore-scripts` matters: this folder lives under a path containing `&`, which breaks npm lifecycle scripts on Windows (cmd.exe treats `&` as a command separator). The only native dependency (`uiohook-napi`) ships prebuilt binaries, so skipping scripts is safe. The `start` script invokes electron via `node node_modules/electron/cli.js` for the same reason.

The cat appears near the bottom-right of your screen.

## Features

- **Idle presence** — eyes and head follow your cursor anywhere on screen; periodic blinks, ear flicks, tail sway, whisker twitches. Drag to move, scroll to resize, double-click to quit. Always-on-top and click-through except over the cat and chat UI.
- **Chat** — click the cat to open the input and chat with the deployed Mira agent (default URL in bundled `config.json`; override it in `%APPDATA%/Mira/config.json`, or point it at `http://localhost:8080` for a local `python app.py`). Replies stream into a speech bubble while she does the popcat yap, then settle back to idle.
- **Image input** — attach an image with the 📎 button or by pasting (Ctrl+V); it's downscaled and sent so Mira can describe / answer questions about it.
- **Typing reaction** — type in any app and the cat hammers a keyboard; yapping takes priority while she's replying.
- **Overheat** — sustained fast typing gradually reddens the cat on a gradient; it cools back down when you stop.
- **Reminders** — one-off, daily, or weekly. The Reminders… window lists/adds/deletes them; Mira pops a bubble at the remind-before time and at the deadline (one-offs auto-remove, recurring roll forward across restarts).
- **Checklist** — tasks with subtasks, a per-task progress bar, and deadlines (overdue styling). The Checklist… window adds/checks/deletes; Mira can read the list back in chat.
- **Pomodoro** — set focus/break/long-break/intervals; a small timer HUD sits above Mira's head (follows her, bubble lifts to clear it) and she announces each phase. Timer colour is configurable.
- **Talk to create** — "remind me to submit the report at 5pm tomorrow" or "create a Financial Model task with subtasks revenue, costs, valuation due Friday" creates the reminder/task straight from chat; Mira can also generate the subtasks for you.
- **Right-click menu** — Checklist…, Reminders…, Start/Stop Pomodoro…, Timer color ▸, Edit profile…, Quit.
- **Personalized** — a first-run onboarding (name/department/hobbies/behaviour) plus a quick feature tour; your profile personalizes replies and is editable via Edit profile…. Returning users skip onboarding.

## Architecture

- `main.js` — transparent always-on-top frameless window; polls global cursor every 50ms; global key hook via `uiohook-napi` (fails soft if unavailable); manual window dragging, resize, and click-through over IPC; relays chat to the agent (`POST /chat`, SSE) and streams chunks to the renderer — the `file://` renderer can't call the endpoint itself (no CORS on the backend)
- `preload.js` — exposes `catAPI` (cursor/key/layout events, drag, resize, quit, menu, profile, notify)
- Right-click menu is built in `main.js` and popped natively; menu items that need input open small framed form windows in `dialogs/` (`profile.html`, `reminders.html`, `pomodoro.html`, `checklist.html`) via the shared `dialog-preload.js`. The Pomodoro timer HUD is a separate transparent click-through window (`clock.html` + `clock-preload.js`) positioned above Mira. (Dialog scripts that alias `window.api` must run in an IIFE — a top-level `const api` collides with the non-configurable global the bridge exposes.)
- State in `userData` (`%APPDATA%/Mira/`): `config.json` (agent endpoint override), `profile.json` (onboarding), `reminders.json` (reminder engine — two `setTimeout`s each, recurring rolls forward), `tasks.json` (checklist), `settings.json` (clock colour). `backgroundThrottling: false` on the pet + clock windows so neither freezes when a dialog/menu is focused
- **Natural-language create** — `main.js` injects one client-side system message into every `/chat` request (profile + current local time + reminder/task protocols + a read-only checklist summary), so Mira can create reminders/tasks and answer questions about them with no backend change. When asked, the agent appends a hidden `[[REMINDER]]{…}` or `[[TASK]]{…}` block; the renderer strips it from the bubble mid-stream and dispatches to the local engines. Bad/past/malformed data is dropped client-side
- `index.html` — all rendering and behavior. Draw priority: speaking (yap frames) > typing (keyboard frames) > idle rig
  - Idle: composites `assets/mira_base.png` + patch regions from `assets/mira_rig.png` (ears/tail/whiskers/mouth/blink, per `assets/rig-meta.json`) on an 80×80 buffer; pupils drawn dynamically to track the cursor; upscales nearest-neighbor with a slight body lean
  - Speaking: draws `assets/mira_yapping.png` (2 frames @ 320×320, closed/pop) directly, alternating every 170ms
  - Typing: draws `assets/mira_typing_80x80.png` (2 frames @ 80×80), frame flips per keystroke, decays to idle 450ms after the last key

## Assets

- `assets/mira_still.png` — source sheet for the rig; frame 5 (open eyes) is the base
- `tools/generate_rig.py` — rebuilds `mira_base.png`, `mira_rig.png`, `rig-meta.json` from `mira_still.png` (run from this folder; requires Pillow)
- `assets/mira_yapping.png`, `assets/mira_typing_80x80.png` — hand-made sheets, no generator

## Tweaks

- Cat size: `scale` in `main.js` (default 3, clamps 1–8; scroll wheel changes it at runtime)
- Bubble size: `#bubble` width + `#bubbleText` `max-height` in `index.html`, and `BUBBLE_H`/`MIN_W` in `main.js` (window room around it). Long replies scroll inside `#bubbleText`
- Reply typing: `printLoop` in `index.html` — 35ms/tick, types faster the further behind the stream it is (so long replies don't yap forever)
- Yap speed: the `170`ms interval in `index.html`'s `mouthLoop`
- Typing decay: the `450`ms window in the `onKey` handler
- Overheat feel: `HEAT_GAIN` (per-keystroke ramp), `HEAT_COOL` (cooldown/sec), `HEAT_MAX_ALPHA` (red intensity at full heat) in `index.html`. Red reaches full only under sustained fast typing of roughly `HEAT_COOL/HEAT_GAIN` keys/sec (~9/sec at defaults); casual typing drains before it builds up

## Packaging

Portable Windows build: `npm run dist` → `dist/Mira-0.1.0-portable.exe` (run from a path **without** `&` for local builds). `asarUnpack` for the `uiohook-napi` native module is configured, and `npmRebuild: false` (the N-API binary is ABI-stable). The GitHub workflow builds the same portable `.exe` and attaches it to `v*` tag releases.

## Credits

- App icon: [Cat Footprint](https://icons8.com/icon/9603/cat-footprint) icon by [Icons8](https://icons8.com).
