# Mira — QA Checklist

The **desktop cat** (`pixel-cat/`) is the product; most of this checklist covers it.
The agent backend is tested briefly at the end (the pet depends on it). Mark each item
Pass / Fail / N/A and note anything odd.

Run the pet with `cd pixel-cat && npm install --ignore-scripts && npm start`.
Per-user state lives in `%APPDATA%/Mira/` (`profile.json`, `reminders.json`,
`tasks.json`, `settings.json`) — delete a file to reset that feature.

---

# Desktop cat

## 1. Launch & window basics

- [ ] Launches and the cat appears near the bottom-right of the screen
- [ ] Window is transparent/frameless; only the cat (and chat UI) is clickable — clicks pass through elsewhere
- [ ] **Drag** the cat moves it; it stays where dropped
- [ ] **Scroll** on the cat resizes it (grows/shrinks, clamped); feet stay anchored
- [ ] **Double-click** quits
- [ ] Always-on-top over other windows

## 2. Idle animation rig

- [ ] **Eyes follow** the cursor as it moves around the screen
- [ ] Body **leans** slightly toward the cursor when it's off to a side
- [ ] **Blinks** periodically
- [ ] **Ears** flick, **tail** sways, **whiskers** twitch over time
- [ ] Pixel art stays crisp at all sizes (nearest-neighbor, no blur)

## 3. Typing reaction & overheat

- [ ] Typing in **any** app makes the cat play the keyboard/paw animation
- [ ] Sustained **fast** typing gradually reddens the cat (gradient, not instant)
- [ ] Stopping typing lets the red **cool back** to normal
- [ ] Casual/slow typing does **not** redden her much
- [ ] If a reply is streaming, **yapping takes priority** over the typing animation

## 4. Chat

- [ ] **Click** the cat opens the input box (placeholder "Say something to Mira…")
- [ ] Typing + **Enter** sends; an empty input does nothing
- [ ] While waiting for the first token she stays idle with a "…" bubble (no premature yapping)
- [ ] Once the reply starts, she **yaps** (popcat) and the text **types out** in the bubble
- [ ] **Long replies** scroll inside the bubble; the typewriter catches up so yapping ends promptly
- [ ] When the reply finishes she holds the closed mouth ~2s, then returns to idle; **bubble stays**
- [ ] **Click elsewhere** while waiting/replying does **not** dismiss the bubble (only an idle, empty input closes on blur)
- [ ] **Esc** or clicking the cat dismisses an open chat/bubble
- [ ] Multi-turn context is kept (she remembers earlier messages in the session)
- [ ] Replies reflect the **profile** (uses your name / matches the tone you set)
- [ ] Agent unreachable → she says "Mrrp?! (can't reach my brain: …)" instead of hanging

## 5. First-run onboarding + feature tour

Delete `%APPDATA%/Mira/profile.json` to re-trigger.

- [ ] On first launch she asks the 4 onboarding questions (name → department → hobbies → behaviour)
- [ ] Question 2 greets you by the name you gave
- [ ] The flow **can't be dismissed** mid-way (Esc/click/blur don't close it)
- [ ] After the last answer she runs the **feature tour** (several blurbs)
- [ ] **Enter or click** advances the tour; **Esc** skips it; input is read-only during it
- [ ] After the tour she drops into normal chat; `profile.json` is written
- [ ] On the **next** launch onboarding/tour do **not** run (returning user)

## 6. Right-click menu

- [ ] Right-clicking the cat opens a native menu: Checklist…, Reminders…, Start Pomodoro…, Timer color ▸, Edit profile…, Quit
- [ ] When Pomodoro is running the item reads **Stop Pomodoro**
- [ ] Each item opens its window / performs its action

## 7. Reminders (`Reminders…`)

- [ ] The window lists existing reminders (sorted by next time) and has an add form
- [ ] Add a **one-off** ~1 min out → at the time, Mira pops `⏰ "…" is due now!` and it disappears from the list + storage
- [ ] Add with a **remind-before** (e.g. 15 min) far enough out → the pre-warning fires too
- [ ] Add a **daily** and a **weekly** → shown as "Daily at HH:MM" / "Weekly · Day HH:MM"
- [ ] **Delete** removes a reminder; list live-refreshes on add/delete/fire
- [ ] Recurring reminders survive an app restart (missed ones roll forward, no backlog spam)

## 8. Checklist (`Checklist…`)

- [ ] **Add task** with a title + deadline → appears as a card with a 0/0 progress bar
- [ ] **Add subtasks** via the inline field on the card
- [ ] **Check/uncheck** subtasks → progress bar fills proportionally (`2/3 · 67%`), checked items strike through
- [ ] A **past deadline** on an incomplete task shows "overdue" in red
- [ ] **Delete** task (×) / delete subtask (×) work; list live-refreshes
- [ ] Tasks persist across an app restart

## 9. Pomodoro (`Start Pomodoro…`)

- [ ] Config dialog takes focus / short break / long break / intervals
- [ ] A small transparent **timer HUD** appears **above Mira's head** and counts down
- [ ] **Dragging** Mira moves the timer with her; **resizing** re-anchors it
- [ ] At 0 it advances phase (focus → break → … → long break after N) and Mira **announces** each phase
- [ ] When a bubble shows during Pomodoro it **lifts above** the timer (no overlap)
- [ ] Timer keeps ticking smoothly while a **dialog or the menu** is open (no freeze)
- [ ] **Timer color ▸** changes the clock colour live; "Auto" tints by phase (focus red / break green); choice persists
- [ ] **Stop Pomodoro** closes the HUD and the menu item flips back

## 10. Natural-language create (via chat)

- [ ] "remind me to … at 5pm tomorrow" creates a **reminder** (check Reminders…); no raw `[[…]]` text flashes in the bubble
- [ ] "create a Financial Model task with subtasks revenue, costs, valuation due Friday" creates a **task with those subtasks**
- [ ] "create a … task and break it into subtasks" → Mira **generates** a sensible subtask list
- [ ] "remind me…" makes a *reminder* and "create a task…" makes a *task* (no cross-firing)
- [ ] An unsupported recurrence ("every weekday") → she declines and creates nothing
- [ ] "what's on my task list?" / "how's the … task going?" → answered from the actual checklist
- [ ] A normal chat message creates nothing (no phantom reminder/task)

## 11. Image input (attach)

- [ ] With the chat open, the **📎 button** opens a file picker; choosing an image shows an "Image attached" thumbnail chip above the input
- [ ] **Paste** (Ctrl+V) a copied image / screenshot → same chip appears
- [ ] The chip's **×** removes the pending image; closing the chat also clears it
- [ ] Send with an image + question (e.g. "what's in this image?") → Mira answers about it
- [ ] **Image-only** send works (Enter with an attached image and no text)
- [ ] A **follow-up** question about the same image still works (image kept in session history)
- [ ] Large images don't error or stall (downscaled to ~1024px JPEG before sending)

## 12. Edit profile (`Edit profile…`)

- [ ] Opens prefilled with current values; Save updates them (Ctrl+Enter saves, Esc cancels)
- [ ] After editing, a new chat reply reflects the change (e.g. new tone/name)

## 13. Persistence & multi-window

- [ ] Quit and relaunch → profile, reminders, tasks, and timer-colour are all retained
- [ ] Opening multiple dialogs and the menu doesn't freeze the cat animation or the timer

## 14. Packaging (optional — only if testing the .exe)

- [ ] `npm run pack` / `npm run dist` produces a runnable build (from a path **without** `&`)
- [ ] The packaged app launches and chats
- [ ] **Typing reaction + overheat work in the packaged app** (confirms the `uiohook-napi` native module was unpacked)

---

# Agent backend (supporting)

The pet talks to the deployed agent over `POST /chat` (SSE). Quick checks:

- [ ] Deployed DEFAULT endpoint `/health` returns ok over HTTPS
- [ ] `/chat` streams a reply (`curl -N -X POST <url>/chat -H "Content-Type: application/json" -d '{"history":[{"role":"user","content":"hi"}]}'`)
- [ ] **Cold start** — after idle (replicas → 0), the first request still succeeds (note the latency; the pet shows "…" meanwhile)
- [ ] `pixel-cat/config.json` `agentUrl` points at the current endpoint
- [ ] Local fallback: setting `agentUrl` to `http://localhost:8080` with `python app.py` running also works
- [ ] `.env` and secrets are not committed; no secrets echoed in replies/logs

---

# Known gaps / not yet implemented

- **Pokémon-style "!" alert** for reminders — planned, sprite pending.
- **Skins** (swappable sprite sets) — planned, not started.
- **Distributable .exe** — local `--dir` build works; signed installer + CI not done.

---

_Last updated: 2026-06-16. Add rows as features land._
