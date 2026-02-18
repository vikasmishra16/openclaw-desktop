# OpenClaw Desktop

> AI-powered automation assistant — a conversational desktop app that makes OpenClaw accessible to non-technical users.

![Tauri](https://img.shields.io/badge/Tauri_2-blue?style=flat-square) ![React](https://img.shields.io/badge/React_19-61dafb?style=flat-square) ![Playwright](https://img.shields.io/badge/Playwright-45ba63?style=flat-square) ![Ollama](https://img.shields.io/badge/Ollama-black?style=flat-square)

---

## Architecture Overview

```
┌─────────────────────────────────────┐
│       React Frontend (Chat UI)      │
│  • Onboarding • Settings • Logs    │
│  • Smart Intent Detection          │
│  • Action Cards (Approve & Run)    │
└───────────┬─────────────────────────┘
            │  Tauri IPC (invoke)
┌───────────▼─────────────────────────┐
│       Rust Backend (lib.rs)         │
│  • LLM Router (Local ↔ Cloud)      │
│  • SQLite DB (logs, preferences)   │
│  • Scheduler (tokio-cron-scheduler) │
│  • Browser Action Executor         │
└───────────┬─────────────────────────┘
            │  Node.js subprocess
┌───────────▼─────────────────────────┐
│  Playwright Script (browser-automator.js)     │
│  • Post to LinkedIn                │
│  • Search LinkedIn                 │
│  • Comment on LinkedIn posts       │
│  • Like/Interact with posts        │
│  • Persistent login sessions       │
└─────────────────────────────────────┘
```

## Features

### Local-First AI
- **Default**: Ollama + Llama-3 (runs locally, no API key needed)
- **Cloud**: OpenAI GPT-4o-mini (add API key in Settings)
- **Smart Switching**: Detects which LLM is available and routes automatically

### Browser Automation
- Real Chrome (not test browser) via Playwright `channel: 'chrome'`
- Persistent login sessions — log in once, reuse forever
- Sandbox (Safe) Mode — previews actions without executing
- Tasks: Post, Search, Comment, Like on LinkedIn

### Scheduling
- Cron-based recurring tasks via `tokio-cron-scheduler`
- Background execution with event emission to frontend
- Natural language: "Schedule daily post at 9 AM"

### Safety & Transparency
- **Safe Mode** (default ON) — nothing is posted without explicit approval
- **Action Cards** — preview and approve every automation before execution
- **Execution Logs** — full history of all actions with timestamps

---

## Setup

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- [Rust](https://rustup.rs/) (stable)
- [Ollama](https://ollama.ai/) (for local AI)
- Google Chrome installed

### Install & Run

```bash
# 1. Clone and install
cd openclaw-desktop
npm install

# 2. Install Playwright browsers
npx playwright install chromium

# 3. Pull local LLM model
ollama pull llama3:8b

# 4. Start Ollama server (keep running in background)
ollama serve

# 5. Launch app
npm run tauri dev
```

### Optional: Cloud AI
Open **Settings** (⚙️) → Enter your OpenAI API key → App switches to GPT-4o-mini automatically.

---

## Demo Scenarios

### Demo 1 — Trending LinkedIn Agent
**Goal**: Find trending topics → Generate LinkedIn post → Preview → Approve → Post

1. Launch app → Complete onboarding
2. Type: **"Draft a LinkedIn post about AI trends"**
3. LLM generates a post → Review the content in the Action Card
4. Edit content inline if needed (click ✏️ icon)
5. Click **"Approve & Run"** → Chrome opens, navigates to LinkedIn, types the post
6. In Safe Mode: content is typed but NOT submitted
7. To schedule daily: type `"Schedule daily LinkedIn post at 9 AM"`

### Demo 2 — Hashtag Promo Agent
**Goal**: Search #openclaw → Comment promoting GitHub repo

1. Launch app → Type: **"Comment on #openclaw posts promoting GitHub"**
2. Action Card shows: search query `#openclaw` + promotional comment
3. Edit the comment text inline if needed
4. Click **"Approve & Run"** → Chrome searches LinkedIn, finds posts, opens comment box, types promo message
5. In Safe Mode: comment is typed but NOT submitted
6. To schedule hourly: type `"Schedule every hour search #openclaw and comment"`

---

## Project Structure

```
openclaw-desktop/
├── src/
│   └── App.tsx              # React UI (chat, onboarding, settings, logs)
├── src-tauri/
│   └── src/
│       ├── lib.rs           # Rust backend (LLM, DB, executor)
│       └── scheduler.rs     # Cron job scheduler
├── scripts/
│   └── browser-automator.js # Playwright automation script
└── package.json
```

## Model Switching Logic

```
User provides API key?
  ├── YES → Use OpenAI GPT-4o-mini (cloud, JSON mode)
  └── NO  → Use Ollama Llama-3:8b (local, JSON format)

LLM returns valid JSON action?
  ├── YES → Use LLM's action directly
  └── NO  → Frontend Smart Intent Detection kicks in
            (parses user's words to determine action)
```

## Key Commands (Chat)

| Command | Action |
|---------|--------|
| `Draft a LinkedIn post about AI` | Generates post → Action Card |
| `Search LinkedIn for #openclaw` | Opens browser, searches |
| `Comment on #openclaw posts promoting GitHub` | Search → Comment |
| `Like the first post on LinkedIn` | Opens feed, likes first post |
| `Schedule daily LinkedIn post at 9 AM` | Creates cron job |
| `Schedule every hour search #openclaw` | Hourly search schedule |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Framework | Tauri 2.0 (Rust) |
| Frontend | React 19 + TypeScript |
| Styling | TailwindCSS 4 |
| LLM (Local) | Ollama + Llama-3:8b |
| LLM (Cloud) | OpenAI GPT-4o-mini |
| Browser Automation | Playwright (Chrome) |
| Database | SQLite (rusqlite) |
| Scheduler | tokio-cron-scheduler |
