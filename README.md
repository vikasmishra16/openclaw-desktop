---
# OpenClaw Desktop

> AI-powered desktop automation assistant — control LinkedIn with natural 
language, powered by local or cloud LLMs.

![Tauri](https://img.shields.io/badge/Tauri_2.0-blue?style=flat-square)
![React](https://img.shields.io/badge/React_19-61dafb?style=flat-square)
![Rust](https://img.shields.io/badge/Rust-orange?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?style=flat-square)
![Playwright](https://img.shields.io/badge/Playwright-45ba63?style=flat-square)

## What it does

OpenClaw is a cross-platform desktop app that lets you automate LinkedIn 
actions (post, search, comment, like) through a conversational chat interface.
No manual browser interaction needed — just type what you want to do.

## Architecture
┌─────────────────────────────────────┐
│       React Frontend (Chat UI)      │
│  Onboarding · Settings · Logs      │
│  Smart Intent Detection            │
│  Action Cards (Approve & Run)      │
└───────────┬─────────────────────────┘
│  Tauri IPC (invoke)
┌───────────▼─────────────────────────┐
│       Rust Backend (lib.rs)         │
│  LLM Router (Local ↔ Cloud)        │
│  SQLite DB (logs, preferences)     │
│  Scheduler (tokio-cron-scheduler)  │
│  Browser Action Executor           │
└───────────┬─────────────────────────┘
│  Node.js subprocess
┌───────────▼─────────────────────────┐
│     Playwright (browser-automator)  │
│  Post · Search · Comment · Like    │
│  Persistent login sessions         │
└─────────────────────────────────────┘

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop Framework | Tauri 2.0 (Rust) |
| Frontend | React 19 + TypeScript |
| Styling | TailwindCSS 4 |
| LLM (Local) | Ollama + Llama-3:8b |
| LLM (Cloud) | OpenAI GPT-4o-mini |
| Browser Automation | Playwright (Chrome) |
| Database | SQLite (rusqlite) |
| Scheduler | tokio-cron-scheduler |

## Key Features

- **Local-first AI** — runs fully offline via Ollama, no API key needed
- **Cloud fallback** — add an OpenAI key to switch to GPT-4o-mini automatically
- **Safe Mode** (default ON) — previews every action before execution, nothing 
  posts without your approval
- **Action Cards** — review and edit generated content inline before running
- **Persistent sessions** — log in to LinkedIn once, reuse forever
- **Cron scheduling** — natural language scheduling ("post daily at 9 AM")
- **Full execution logs** — timestamped history of all actions

## Setup

### Prerequisites
- Node.js v18+
- Rust (stable) — [rustup.rs](https://rustup.rs/)
- Ollama — [ollama.ai](https://ollama.ai/) (for local AI)
- Google Chrome

### Install & Run
```bash
# 1. Clone and install dependencies
npm install

# 2. Install Playwright browsers
npx playwright install chromium

# 3. Pull local LLM
ollama pull llama3:8b

# 4. Start Ollama (keep running in background)
ollama serve

# 5. Launch the app
npm run tauri dev
```

### Optional: Cloud AI
Open Settings (⚙️) → Enter OpenAI API key → app switches to GPT-4o-mini.

## Usage Examples

| You type | What happens |
|---|---|
| "Draft a LinkedIn post about AI trends" | LLM generates post → Action Card → Approve → Chrome posts it |
| "Search LinkedIn for #openclaw" | Chrome opens, searches hashtag |
| "Comment on #openclaw posts promoting my GitHub" | Finds posts, types comment |
| "Schedule daily LinkedIn post at 9 AM" | Creates cron job, runs in background |

## Project Structure
openclaw-desktop/
├── src/                     # React UI (chat, onboarding, settings, logs)
├── src-tauri/src/
│   ├── lib.rs               # Rust backend (LLM router, DB, executor)
│   └── scheduler.rs         # Cron job scheduler
└── scripts/
└── browser-automator.js # Playwright Chrome automation

## Contact

Built by [Vikas Mishra](https://github.com/vikasmishra16)
---
