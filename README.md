# OpenClaw Desktop

> AI-powered desktop automation assistant for LinkedIn workflows using local or cloud LLMs.

![Tauri](https://img.shields.io/badge/Tauri_2.0-blue?style=flat-square)
![React](https://img.shields.io/badge/React_19-61dafb?style=flat-square)
![Rust](https://img.shields.io/badge/Rust-orange?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?style=flat-square)
![Playwright](https://img.shields.io/badge/Playwright-45ba63?style=flat-square)

---

## Overview

OpenClaw is a cross-platform desktop automation assistant that enables LinkedIn interactions through natural language commands.

The application combines:
- a React/Tauri desktop interface,
- Rust backend orchestration,
- Playwright browser automation,
- and local/cloud LLM routing

to automate actions such as:
- posting,
- searching,
- commenting,
- liking,
- and scheduled workflows.

The system is designed with a local-first architecture while supporting optional cloud inference.

---

## Architecture

```text
┌─────────────────────────────────────┐
│       React Frontend (Chat UI)      │
│  Onboarding · Settings · Logs       │
│  Smart Intent Detection             │
│  Action Cards (Approve & Run)       │
└───────────┬─────────────────────────┘
            │  Tauri IPC (invoke)
┌───────────▼─────────────────────────┐
│       Rust Backend (lib.rs)         │
│  LLM Router (Local ↔ Cloud)         │
│  SQLite DB (logs, preferences)      │
│  Scheduler (tokio-cron-scheduler)   │
│  Browser Action Executor            │
└───────────┬─────────────────────────┘
            │  Node.js subprocess
┌───────────▼─────────────────────────┐
│     Playwright Automation Layer     │
│  Post · Search · Comment · Like     │
│  Persistent Browser Sessions        │
└─────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop Framework | Tauri 2.0 (Rust) |
| Frontend | React 19 + TypeScript |
| Styling | TailwindCSS 4 |
| Local LLM | Ollama + Llama 3 8B |
| Cloud LLM | OpenAI GPT-4o-mini |
| Browser Automation | Playwright |
| Database | SQLite (rusqlite) |
| Scheduler | tokio-cron-scheduler |

---

## Key Features

- **Local-first AI execution** using Ollama and Llama 3
- **Cloud fallback support** via OpenAI GPT-4o-mini
- **Safe Mode** with approval workflow before execution
- **Action Cards** for reviewing generated content
- **Persistent LinkedIn sessions** using Playwright
- **Natural language scheduling** for recurring automation
- **Execution logs** with timestamped action history

---

## Setup

### Prerequisites

- Node.js v18+
- Rust (stable)
- Google Chrome
- Ollama (optional for local inference)

---

### Installation

```bash
# Install dependencies
npm install

# Install Playwright browser
npx playwright install chromium

# Pull local model
ollama pull llama3:8b

# Start Ollama
ollama serve

# Launch application
npm run tauri dev
```

---

## Optional Cloud AI

Open:

```text
Settings → Enter OpenAI API Key
```

The application will automatically switch to GPT-4o-mini inference.

---

## Usage Examples

| Command | Result |
|---|---|
| "Draft a LinkedIn post about AI trends" | Generates content → approval card → posts to LinkedIn |
| "Search LinkedIn for #openclaw" | Opens browser and performs search |
| "Comment on AI creator posts" | Finds posts and generates comments |
| "Schedule daily post at 9 AM" | Creates recurring scheduled workflow |

---

## Project Structure

```text
openclaw-desktop/
├── src/
│   └── React frontend (chat, onboarding, settings, logs)
│
├── src-tauri/
│   └── src/
│       ├── lib.rs
│       └── scheduler.rs
│
└── scripts/
    └── browser-automator.js
```

---

## Technical Design Decisions

- **Tauri + Rust backend** chosen for lightweight desktop performance and system-level control
- **Playwright** used for reliable browser automation with persistent sessions
- **LLM routing layer** supports both local and cloud inference providers
- **Safe Mode approval system** prevents unintended automated posting
- **SQLite persistence** stores logs, preferences, and execution history locally

---

## Limitations

- LinkedIn UI changes may affect automation reliability
- Requires Chrome and Playwright installation
- Local inference performance depends on system hardware
- Designed primarily for desktop environments

---

## Future Improvements

- Multi-platform social media support
- Workflow chaining and agent memory
- Voice-command interaction
- Multi-account automation
- Analytics dashboard for engagement tracking

---

## License

MIT License

---

## Contact

Built by [Vikas Mishra](https://github.com/vikasmishra16)
