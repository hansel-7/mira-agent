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

Point the desktop pet at your local agent by setting `pixel-cat/config.json`'s `agentUrl` to `http://localhost:8080`.

### Deploy (GreenNode AgentBase)

The agent runs as a container (`Dockerfile` → port 8080, `/health` check). Build and push the image, then create/update an AgentBase runtime; its `DEFAULT` endpoint URL goes in `pixel-cat/config.json` so the shipped desktop app reaches it. See the AgentBase skills under `greennode-agentbase-skills/` (cloned separately, gitignored) for the deploy/runtime commands.

## The desktop pet

A transparent always-on-top pixel cat that chats with the agent and layers on productivity tools — reminders (one-off/daily/weekly), a Pomodoro HUD, and a tasks+subtasks checklist with progress bars — several creatable by just talking to her. Full details, controls, and architecture: [`pixel-cat/README.md`](pixel-cat/README.md).

```bash
cd pixel-cat
npm install --ignore-scripts
npm start
```

## Configuration

Secrets live in a `.env` at the repo root (never committed — see `.gitignore`):

| Variable | Purpose |
|----------|---------|
| `HACKATHON_API_KEY` | API key for the VNG MaaS LLM endpoint used by `app.py` / `chatbot.py` |
| `GREENNODE_CLIENT_ID` / `GREENNODE_CLIENT_SECRET` | IAM credentials for AgentBase deployment |

The desktop pet keeps its own per-user state (profile, reminders, tasks, settings) in `%APPDATA%/Mira/`, not in this repo.

## Status

Built for the VNG GreenNode Claw-a-thon 2026. The agent is deployed and the desktop pet connects to it; packaging the pet as a distributable `.exe` (electron-builder) is in progress — see the pixel-cat README's roadmap.
