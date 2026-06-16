# Mira — QA Checklist

The **desktop cat** (`pixel-cat/`) is the product; most of this checklist covers it.
The agent backend is tested briefly at the end (the pet depends on it). Mark each item
Pass / Fail / N/A and note anything odd.

Run the pet with `cd pixel-cat && npm install --ignore-scripts && npm start`.
Per-user state lives in `%APPDATA%/Mira/` (`profile.json`, `mood.json`,
`reminders.json`, `tasks.json`, `settings.json`) — delete a file to reset that feature.

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

## 4. Cat color customization

- [ ] Right-click Mira -> **Cat color...** opens an RGB customization window
- [ ] R/G/B sliders accept the full **0-255** range and stay synced with the number inputs
- [ ] Changing RGB values updates the preview swatch and Mira's body color live
- [ ] The color applies in idle, yapping, and typing animations
- [ ] **Classic black** restores the original black cat
- [ ] Close and relaunch -> selected cat color persists via `%APPDATA%/Mira/settings.json`

## 5. Chat

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

## 6. First-run onboarding + feature tour

Delete `%APPDATA%/Mira/profile.json` to re-trigger.

- [ ] On first launch she asks the 4 onboarding questions (name → department → hobbies → behaviour)
- [ ] Question 2 greets you by the name you gave
- [ ] The flow **can't be dismissed** mid-way (Esc/click/blur don't close it)
- [ ] After the last answer she runs the **feature tour** (several blurbs)
- [ ] Feature tour mentions mood tracking and the Friday summary
- [ ] Feature tour mentions Cat color customization in the right-click menu
- [ ] **Enter or click** advances the tour; **Esc** skips it; input is read-only during it
- [ ] After the tour she drops into normal chat; `profile.json` is written
- [ ] On the **next** launch onboarding/tour do **not** run (returning user)

## 7. Right-click menu

- [ ] Right-clicking the cat opens a native menu: Checklist…, Reminders…, Start Pomodoro…, Timer color ▸, Cat color…, Edit profile…, Quit
- [ ] When Pomodoro is running the item reads **Stop Pomodoro**
- [ ] Each item opens its window / performs its action

## 8. Reminders (`Reminders…`)

- [ ] The window lists existing reminders (sorted by next time) and has an add form
- [ ] Add a **one-off** ~1 min out -> at the time, Mira pops `⏰ "..." is due now!` and it stays visible as completed for the current workweek
- [ ] Add with a **remind-before** (e.g. 15 min) far enough out -> the pre-warning fires too
- [ ] Add a **daily** and a **weekly** -> shown as "Daily at HH:MM" / "Weekly · Day HH:MM"
- [ ] **Hide** removes a reminder from the Reminders window but keeps its local weekly record for the Friday recap
- [ ] Completed one-off reminders survive an app restart during the same workweek
- [ ] Recurring reminders survive an app restart (missed ones roll forward, no backlog spam)

## 9. Checklist (`Checklist…`)

- [ ] **Add task** with a title + deadline and no subtasks -> appears with a top-level **Done** button and a 0/1 progress bar
- [ ] Click top-level **Done** -> task marks complete, progress becomes 1/1, and **Undo** returns it to active
- [ ] **Add subtasks** via the inline field on the card
- [ ] **Check/uncheck** subtasks → progress bar fills proportionally (`2/3 · 67%`), checked items strike through
- [ ] A **past deadline** on an incomplete task shows "overdue" in red
- [ ] Hide task (×) / hide subtask (×) removes it from the Checklist window but keeps the local weekly record
- [ ] Completed tasks/subtasks remain visible during the current workweek unless hidden
- [ ] Tasks persist across an app restart

## 10. Mood check-ins + Friday recap

Delete `%APPDATA%/Mira/mood.json` to reset mood data. To test schedules without waiting, set the Windows clock to the target weekday/time and launch Mira.

- [ ] Set clock to a weekday at **09:29**, launch Mira, wait until **09:30** -> Mira opens chat and asks how you're feeling
- [ ] Answer the prompt -> Mira responds normally via chat and `%APPDATA%/Mira/mood.json` records today's entry
- [ ] Relaunch later the same day -> the 09:30 prompt does **not** repeat after today's mood response is recorded
- [ ] Set previous workday, answer with a low mood (e.g. "bad/stressed"), then set the clock to the next workday after 09:30 and relaunch -> Mira's prompt references yesterday's mood
- [ ] Complete or hide at least one checklist item and let at least one reminder complete during the same workweek
- [ ] Set clock to **Friday 16:59**, launch Mira, wait until **17:00** -> Mira opens the **Friday recap** window
- [ ] Mood trail shows five weekday emoji cells (Mon-Fri), with missing days shown as no-check-in cells
- [ ] Conquered section lists completed or hidden checklist/reminder activity where available
- [ ] Encouragement section reflects the mood trend and completed/cleared activity without sounding clinical
- [ ] Relaunch after Friday 17:00 in the same workweek -> weekly summary does **not** repeat
- [ ] If the agent endpoint is unreachable at Friday 17:00, Mira still opens the recap with a local fallback encouragement instead of hanging

## 11. Pomodoro (`Start Pomodoro…`)

- [ ] Config dialog takes focus / short break / long break / intervals
- [ ] A small transparent **timer HUD** appears **above Mira's head** and counts down
- [ ] **Dragging** Mira moves the timer with her; **resizing** re-anchors it
- [ ] At 0 it advances phase (focus → break → … → long break after N) and Mira **announces** each phase
- [ ] When a bubble shows during Pomodoro it **lifts above** the timer (no overlap)
- [ ] Timer keeps ticking smoothly while a **dialog or the menu** is open (no freeze)
- [ ] **Timer color ▸** changes the clock colour live; "Auto" tints by phase (focus red / break green); choice persists
- [ ] **Stop Pomodoro** closes the HUD and the menu item flips back

## 12. Natural-language create (via chat)

- [ ] "remind me to … at 5pm tomorrow" creates a **reminder** (check Reminders…); no raw `[[…]]` text flashes in the bubble
- [ ] "create a Financial Model task with subtasks revenue, costs, valuation due Friday" creates a **task with those subtasks**
- [ ] "create a … task and break it into subtasks" → Mira **generates** a sensible subtask list
- [ ] "remind me…" makes a *reminder* and "create a task…" makes a *task* (no cross-firing)
- [ ] An unsupported recurrence ("every weekday") → she declines and creates nothing
- [ ] "what's on my task list?" / "how's the … task going?" → answered from the actual checklist
- [ ] A normal chat message creates nothing (no phantom reminder/task)

## 13. Image input (attach)

- [ ] With the chat open, the **📎 button** opens a file picker; choosing an image shows an "Image attached" thumbnail chip above the input
- [ ] **Paste** (Ctrl+V) a copied image / screenshot → same chip appears
- [ ] The chip's **×** removes the pending image; closing the chat also clears it
- [ ] Send with an image + question (e.g. "what's in this image?") → Mira answers about it
- [ ] **Image-only** send works (Enter with an attached image and no text)
- [ ] A **follow-up** question about the same image still works (image kept in session history)
- [ ] Large images don't error or stall (downscaled to ~1024px JPEG before sending)

## 14. Edit profile (`Edit profile…`)

- [ ] Opens prefilled with current values; Save updates them (Ctrl+Enter saves, Esc cancels)
- [ ] After editing, a new chat reply reflects the change (e.g. new tone/name)

## 15. Persistence & multi-window

- [ ] Quit and relaunch -> profile, mood data, reminders, tasks, timer-colour, and cat colour are all retained
- [ ] Opening multiple dialogs and the menu doesn't freeze the cat animation or the timer

## 16. Packaging (optional — only if testing the ZIP release)

- [ ] `npm run dist` produces `dist/Mira-<version>-win.zip` (from a path **without** `&` for local builds)
- [ ] Extract the ZIP and run `Mira.exe`
- [ ] The packaged app launches and chats with the live endpoint
- [ ] **Typing reaction + overheat work in the packaged app** (confirms the `uiohook-napi` native module was unpacked)

---

# Agent backend (supporting)

The pet talks to the deployed agent over `POST /chat` (SSE). Quick checks:

- [ ] Deployed DEFAULT endpoint `/health` returns ok over HTTPS
- [ ] `/chat` streams a reply (`curl -N -X POST <url>/chat -H "Content-Type: application/json" -d '{"history":[{"role":"user","content":"hi"}]}'`)
- [ ] **Cold start** — after idle (replicas → 0), the first request still succeeds (note the latency; the pet shows "…" meanwhile)
- [ ] Bundled `pixel-cat/config.json` `agentUrl` points at the current endpoint; `%APPDATA%/Mira/config.json` can override it
- [ ] Local fallback: setting `agentUrl` to `http://localhost:8080` with `python app.py` running also works
- [ ] `.env` and secrets are not committed; no secrets echoed in replies/logs

---

# Known gaps / not yet implemented

- **Pokémon-style "!" alert** for reminders — planned, sprite pending.
- **Skins** (swappable sprite sets) — planned, not started.
- **Signing / trust** — the ZIP release contains an unsigned Windows app, so Windows may show SmartScreen warnings.

---

_Last updated: 2026-06-16. Add rows as features land._
