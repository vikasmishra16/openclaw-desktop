# OpenClaw Desktop

A powerful desktop interface for the OpenClaw CLI, built with Tauri, React, and Rust.

## Features

- **Natural Language Interface**: Chat with your local `llama3:8b` via Ollama or `gpt-4-turbo` via OpenAI to control OpenClaw.
- **Dual Mode**:
  - 🟢 **Cloud Mode**: Uses your OpenAI API Key.
  - 🟡 **Local Mode**: Runs entirely offline using Ollama.
- **Command Sanitization**: Automatically validates and fixes `openclaw` commands before execution.
- **History & Logging**: Tracks executed commands and outputs in a local SQLite database.
- **Secure Execution**: Validates commands against a strict allowlist.

## Prerequisites

Before running OpenClaw Desktop, ensure you have the following installed:

- **[OpenClaw CLI](https://github.com/Start-OpenClaw/openclaw)**: accessible in your system PATH.
- **[Ollama](https://ollama.com/)** (Optional): for local mode. Pull the model: `ollama pull llama3:8b`.
- **Node.js & npm**: for frontend dependencies.
- **Rust & Cargo**: for Tauri backend.

## Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/openclaw-desktop.git
    cd openclaw-desktop
    ```

2.  **Install frontend dependencies:**
    ```bash
    npm install
    ```

3.  **Run the application (Development Mode):**
    ```bash
    npm run tauri dev
    ```

4.  **Build for Production:**
    ```bash
    npm run tauri build
    ```

## Technlogy Stack

- **Frontend**: React, TypeScript, TailwindCSS, Vite
- **Backend**: Rust (Tauri), SQLite (Rusqlite)
- **AI**: OpenAI API, Ollama (Local)

## Usage

1.  **Launch the App**: Run `npm run tauri dev`.
2.  **Set API Key (Optional)**: Enter your OpenAI API key in the top right for Cloud Mode. Leave empty for Local Mode.
3.  **Chat**: Type instructions like "Check trending topics on LinkedIn" or "Create a new agent".
4.  **Execute**: The app will propose `openclaw` commands. It will execute valid commands and show the output.

## License

[MIT](LICENSE)
