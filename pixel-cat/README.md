# pixel-cat

Mira — a Comnyang-style desktop pet: black pixel cat with an idle rig (blink, ear flicks, tail sway, eye-follow), a popcat yapping animation while she "speaks", and a typing reaction driven by global keystrokes.

## Run

```
cd pixel-cat
npm install --ignore-scripts
npm start
```

`--ignore-scripts` matters: this folder lives under a path containing `&`, which breaks npm lifecycle scripts on Windows (cmd.exe treats `&` as a command separator). The only native dependency (`uiohook-napi`) ships prebuilt binaries, so skipping scripts is safe. The `start` script invokes electron via `node node_modules/electron/cli.js` for the same reason.

The cat appears near the bottom-right of your screen.

- **Eyes + head follow** your mouse anywhere on screen
- **Click** the cat to open the chat input — it chats with the deployed Mira agent (URL in `config.json`; point it at `http://localhost:8080` to use a local `python app.py`); while the reply streams in, it plays the popcat yap, then holds the closed-mouth frame for 2s before returning to idle
- **Type anywhere** (any app) and the cat hammers its keyboard; each keystroke alternates the paw frames. Yapping takes priority over typing
- **Overheat** — sustained fast typing gradually reddens the cat on a gradient (heat builds per keystroke, cools when you stop); a red `source-atop` overlay tints the silhouette, scaling with heat
- **Drag** the cat to move it, **scroll** on it to resize
- **Double-click** to quit
- **Right-click** for a menu: Checklist…, Reminders…, Start/Stop Pomodoro…, Timer color ▸, Edit profile…, Quit
- **First run** — Mira runs a scripted onboarding (name/department/hobbies/behaviour) then a quick feature tour (Enter/click to advance, Esc to skip); returning users skip both
- **Reminders** — one-off, daily, or weekly; the Reminders… window lists/adds/deletes them and Mira pops a bubble at the remind-before time and at the deadline (one-offs auto-remove)
- **Checklist** — tasks with subtasks, a per-task progress bar and deadline (overdue styling); the Checklist… window adds/checks/deletes; Mira can read the list back in chat
- **Pomodoro** — set focus/break/long-break/intervals; a small transparent timer HUD sits above Mira's head (follows her when dragged/resized, bubble lifts to clear it) and she announces each phase; menu flips to Stop Pomodoro
- **Talk to create** — "remind me to submit the report at 5pm tomorrow" or "create a Financial Model task with subtasks revenue, costs, valuation due Friday" creates the reminder/task straight from chat (Mira can also generate the subtasks); see Architecture for how
- The window is larger than the cat (room for the speech bubble + input) but is click-through everywhere except the cat and the chat UI

## Architecture

- `main.js` — transparent always-on-top frameless window; polls global cursor every 50ms; global key hook via `uiohook-napi` (fails soft if unavailable); manual window dragging, resize, and click-through over IPC; relays chat to the agent (`POST /chat`, SSE) and streams chunks to the renderer — the `file://` renderer can't call the endpoint itself (no CORS on the backend)
- `preload.js` — exposes `catAPI` (cursor/key/layout events, drag, resize, quit, menu, profile, notify)
- Right-click menu is built in `main.js` and popped natively; menu items that need input open small framed form windows in `dialogs/` (`profile.html`, `reminders.html`, `pomodoro.html`, `checklist.html`) via the shared `dialog-preload.js`. The Pomodoro timer HUD is a separate transparent click-through window (`clock.html` + `clock-preload.js`) positioned above Mira. (Dialog scripts that alias `window.api` must run in an IIFE — a top-level `const api` collides with the non-configurable global the bridge exposes.)
- State in `userData` (`%APPDATA%/Mira/`): `profile.json` (onboarding), `reminders.json` (reminder engine — two `setTimeout`s each, recurring rolls forward), `tasks.json` (checklist), `settings.json` (clock colour). `backgroundThrottling: false` on the pet + clock windows so neither freezes when a dialog/menu is focused
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

## Roadmap

### Personalization (onboarding + profile) — implemented

First-run experience that personalizes Mira per user.

1. **Onboarding sequence** — on first launch (no profile), Mira runs a *scripted* Q&A through the chat UI (name → department → hobbies → behaviour), one question per bubble, advancing on Enter (`QUESTIONS` + `handleAnswer` in `index.html`). It can't be dismissed mid-flow (guarded `closeChat`/Escape/blur/click). Scripted, not LLM-driven — deterministic, no token cost.
2. **Profile file** — raw answers saved to `profile.json` in `app.getPath('userData')` (`%APPDATA%/Mira/`, since `main.js` calls `app.setName('Mira')`), **not** the app folder. The packaged .exe bundles the app read-only (asar), so runtime-writable data must live in `userData`. Distinction to keep: `config.json` = bundled/read-only (agent URL); `profile.json` = runtime/writable/per-user. Only raw answers are stored; the personalization sentence is derived at request time (no stale copy).
3. **Personalized chat** — the agent is stateless/remote and can't read the local file, so context is injected client-side: `main.js` builds a `{role:"system"}` message from the profile (`profileSystemMessage()`) and **prepends it to the history of every `/chat` request** — no backend change. (If a model ever mishandles two system messages, the alternative is a `userContext` field that `app.py` merges into one prompt; would need a redeploy.)

Profile is editable via the right-click **Edit profile…** dialog. After onboarding, first-run users get a scripted feature tour (`INTRO` in `index.html`).

### Right-click menu — implemented

Native context menu (`Menu.buildFromTemplate` + `popup()`) via a `contextmenu` listener → IPC → main. Items: Reminders…, Start/Stop Pomodoro…, Timer color ▸, Edit profile…, Quit. Form dialogs live in `dialogs/`; see the Architecture section. Reminders support once/daily/weekly with a manage list; Pomodoro drives the HUD clock window. A **Skin ▸** entry will be added with the skins feature below.

### Alert indicator (Pokémon-style "!")

A Pokémon-style exclamation-mark bubble that pops above Mira's head when a task reminder fires (the NPC "!" spotting effect) — a quick attention-grab before/with the reminder bubble.

- **Sprite:** hand-drawn, *pending* (to be added). Likely a tiny 2–3 frame pop-in sheet, drawn over Mira's head independent of the body skin (so it works across skins).
- **Render:** draw it above the cat in the reserved bubble area, with a short pop + bounce then either auto-dismiss or hold until acknowledged. Composites on top regardless of current state (idle/typing/speaking).
- **Trigger:** fired by the reminders feature (right-click menu); could also signal other "Mira wants your attention" events later.

### Skins (swappable sprite sets)

Let users replace the default black cat with other sprite sets. Decided approach: **a per-skin manifest with two modes**, because the three current sprite systems aren't uniform and found art won't match the bespoke idle rig.

- **Two modes.** `mode: "rig"` = the current default Mira (layered `base` + patch atlas + `rig-meta.json`, dynamic pupils, eye-follow). `mode: "frames"` = simple frame-sheet animations (idle/talk/type loops) — this is what sprites found online actually look like, and the realistic target for user skins.
- **Manifest** (`skin.json` per skin folder) declares mode, native frame size, and an animation table (`{ file, frames, fps, loop }`) mapping the renderer's states (idle / speaking / typing) to sheets. Generalize the existing draw-priority loop (speaking > typing > idle) to be manifest-driven; keep the hardcoded Mira as the `rig` special case.
- **Storage** — bundled default skins in the app (read-only asar) + user-dropped skins in `%APPDATA%/Mira/skins/` (writable), same split as the profile file. Selection saved to settings, chosen via the right-click **Skin ▸** submenu.
- **Free / degrades:** overheat tint works on any skin automatically (it's a composite over whatever's drawn). Eye-follow does **not** carry to `frames` skins (fixed art) — graceful, expected downgrade. Per-skin native size handles mixed resolutions.
- **Open decision (deferred):** whether non-default skins need full rig interactivity (eye-follow) — that requires rig authoring per skin, which found art won't provide. Defaulting to frame animation unless revisited.

Build effort ~1 day (the draw-loop refactor); not started — revisit after the personalization + right-click features land.

### Other

Mochi drag stretch, reminders/Pomodoro behaviors.

**Distribution:** local `--dir` build works (`npm run pack`; outputs `dist/win-unpacked/Mira.exe`). Remaining: the single-file installer/portable (`npm run dist`) and a GitHub Actions release workflow. Notes — `asarUnpack` for the `uiohook-napi` native module is configured and verified; `npmRebuild: false` (N-API binary is ABI-stable); build from a path **without `&`** (the `Tools & Scripts` path breaks the toolchain); local Windows builds need a workaround for electron-builder's `winCodeSign` extraction (macOS symlinks fail without admin/Developer Mode) — a CI Windows runner avoids this.
