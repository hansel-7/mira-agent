# Mira

Mira is a personal AI assistant with two halves:

- **The brain** — a small Python/Flask agent that streams chat completions from an OpenAI-compatible LLM, deployed as a container on **GreenNode AgentBase**.
- **The body** — [`pixel-cat/`](pixel-cat/), an Electron desktop pet (a Comnyang-style pixel cat) that talks to the agent and adds reminders, a Pomodoro timer, and a checklist — many of them drivable in plain language.

The two communicate only over HTTP (`POST /chat`, server-sent events), so they deploy and version independently: the agent ships as a Docker image, the desktop pet ships as a downloadable app.

```
┌──────────────────────┐         POST /chat (SSE)        ┌──────────────────────┐
│  pixel-cat (Electron)│  ───────────────────────────▶   │  Flask agent (app.py)│
│  desktop pet / client│  ◀───────────────────────────   │  on GreenNode        │
└──────────────────────┘        streamed reply           └──────────┬───────────┘
                                                                     │ OpenAI-compatible
                                                                     ▼
                                                          VNG MaaS LLM (Gemma)
```

## Repo layout

| Path | What it is |
|------|------------|
| `app.py` | Flask agent: `POST /chat` (SSE stream), `GET /health`, and a web chat UI at `/` |
| `chatbot.py` | The same chat loop as a terminal REPL (handy for quick local testing) |
| `templates/index.html` | Web chat UI served by `app.py` |
| `Dockerfile`, `requirements.txt` | Container build for AgentBase deployment |
| `pixel-cat/` | The Electron desktop pet client — see [`pixel-cat/README.md`](pixel-cat/README.md) |

## The agent

OpenAI-compatible client pointed at the VNG MaaS LLM endpoint; the system prompt makes the model answer as "Mira". `app.py` exposes:

- `POST /chat` — body `{ "history": [{role, content}, ...] }`, responds with an SSE stream of `data: {"content": "..."}` chunks ending in `data: [DONE]`.
- `GET /health` — `{"status": "ok"}`.
- `GET /` — a simple web chat page.

### Run locally

```bash
pip install -r requirements.txt
# create a .env (see below), then:
python app.py        # serves on http://localhost:8080
# or, for a terminal chat:
python chatbot.py
```

Point the desktop pet at your local agent by setting `agentUrl` in `%APPDATA%/Mira/config.json` to `http://localhost:8080`. The bundled `pixel-cat/config.json` is the default used for packaged releases; the per-user config overrides it after first launch.

### Deploy (GreenNode AgentBase)

The agent runs as a container (`Dockerfile` → port 8080, `/health` check). Build and push the image, then create/update an AgentBase runtime; its `DEFAULT` endpoint URL goes in `pixel-cat/config.json` so the shipped desktop app reaches it by default. See the AgentBase skills under `greennode-agentbase-skills/` (cloned separately, gitignored) for the deploy/runtime commands.

## The desktop pet

A transparent always-on-top pixel cat that chats with the agent (with text or images) and layers on productivity tools — reminders (one-off/daily/weekly), a Pomodoro HUD, and a tasks+subtasks checklist with progress bars — several creatable by just talking to her. Full details, controls, and architecture: [`pixel-cat/README.md`](pixel-cat/README.md).

```bash
cd pixel-cat
npm install --ignore-scripts
npm start
```

## GitHub release

Tagged releases build Windows artifacts in GitHub Actions:

- `Mira-<version>-win.zip` - the full-feature Windows app packaged as a ZIP.

The hackathon build is currently unsigned. On some Windows machines, Defender or SmartScreen may flag a new unsigned Electron build before it has reputation, especially because Mira includes a global keyboard hook for the typing animation. If Defender flags a release, check Windows Security > Virus & threat protection > Protection history for the detection name, then submit the exact release file to [Microsoft Security Intelligence](https://www.microsoft.com/en-us/wdsi/filesubmission) as a software developer and mark it as incorrectly detected. The permanent production fix is to sign releases with an Authenticode code-signing certificate.

## Configuration

Secrets live in a `.env` at the repo root (never committed — see `.gitignore`):

| Variable | Purpose |
|----------|---------|
| `HACKATHON_API_KEY` | API key for the VNG MaaS LLM endpoint used by `app.py` / `chatbot.py` |
| `GREENNODE_CLIENT_ID` / `GREENNODE_CLIENT_SECRET` | IAM credentials for AgentBase deployment |

The desktop pet keeps its own per-user state (profile, reminders, tasks, settings) in `%APPDATA%/Mira/`, not in this repo.
On first launch it also creates `%APPDATA%/Mira/config.json`; edit that file to point the packaged app at a different agent endpoint without rebuilding.

## Status

Built for the VNG GreenNode Claw-a-thon 2026. The agent is deployed and the desktop pet connects to it; packaging is focused on a Windows ZIP release for GitHub, built locally or by the `Build Mira Windows ZIP` workflow.

## Credits

- App icon: [Cat Footprint](https://icons8.com/icon/9603/cat-footprint) icon by [Icons8](https://icons8.com).
