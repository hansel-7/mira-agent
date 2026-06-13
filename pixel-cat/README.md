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
- **Drag** the cat to move it, **scroll** on it to resize
- **Double-click** to quit
- The window is larger than the cat (room for the speech bubble + input) but is click-through everywhere except the cat and the chat UI

## Architecture

- `main.js` — transparent always-on-top frameless window; polls global cursor every 50ms; global key hook via `uiohook-napi` (fails soft if unavailable); manual window dragging, resize, and click-through over IPC; relays chat to the agent (`POST /chat`, SSE) and streams chunks to the renderer — the `file://` renderer can't call the endpoint itself (no CORS on the backend)
- `preload.js` — exposes `catAPI` (cursor/key/layout events, drag, resize, quit)
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
- Yap speed: the `170`ms interval in `index.html`'s `mouthLoop`
- Typing decay: the `450`ms window in the `onKey` handler

## Next steps

Overheat mode, mochi drag stretch, reminders/Pomodoro, package as a distributable .exe (electron-builder; remember `asarUnpack` for `uiohook-napi`).
