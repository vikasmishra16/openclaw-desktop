// src-tauri/src/lib.rs
use tauri::{command, Manager, State};
use std::process::Command;
use serde::{Deserialize, Serialize};
use rusqlite::{params, Connection, Result as SqlResult};
use std::sync::Mutex;


// ================= DATABASE =================

struct DbState {
    conn: Mutex<Connection>,
}

#[derive(Serialize, Deserialize)]
struct ChatRequest {
    model: String,
    messages: Vec<Message>,
    stream: bool,
}

#[derive(Serialize, Deserialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Serialize, Deserialize)]
struct LogEntry {
    id: i32,
    command: String,
    output: String,
    timestamp: String,
}

// ================= DB INIT =================

fn init_db(app_handle: &tauri::AppHandle) -> SqlResult<Connection> {
    let app_dir = app_handle.path().app_data_dir().unwrap();
    if !app_dir.exists() {
        std::fs::create_dir_all(&app_dir).unwrap();
    }
    let db_path = app_dir.join("openclaw.db");

    let conn = Connection::open(db_path)?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY,
            command TEXT NOT NULL,
            output TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS preferences (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;

    Ok(conn)
}

// ================= LOGS =================

#[command]
fn get_logs(state: State<DbState>) -> Result<Vec<LogEntry>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, command, output, timestamp FROM logs ORDER BY id DESC LIMIT 50")
        .map_err(|e| e.to_string())?;

    let log_iter = stmt
        .query_map([], |row| {
            Ok(LogEntry {
                id: row.get(0)?,
                command: row.get(1)?,
                output: row.get(2)?,
                timestamp: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut logs = Vec::new();
    for log in log_iter {
        logs.push(log.map_err(|e| e.to_string())?);
    }
    Ok(logs)
}

#[command]
fn save_api_key(key: String, state: State<DbState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO preferences (key, value) VALUES (?1, ?2)",
        params!["api_key", key],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
fn get_api_key(state: State<DbState>) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT value FROM preferences WHERE key = ?1")
        .map_err(|e| e.to_string())?;

    let mut rows = stmt.query(params!["api_key"]).map_err(|e| e.to_string())?;

    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        Ok(row.get(0).map_err(|e| e.to_string())?)
    } else {
        Ok("".to_string())
    }
}

// ================= 🧠 LLM (HARDENED) =================

#[command]
async fn send_chat(prompt: String, api_key: Option<String>) -> Result<String, String> {
    let client = reqwest::Client::new();

    // 🔥 HARD SYSTEM PROMPT (VERY IMPORTANT)
    let system_prompt = r#"You are OpenClaw Desktop Assistant.

STRICT RULES — MUST FOLLOW:

WHEN USER ASKS TO:

- Draft / Preview / Find trends → WRITE NORMAL TEXT ONLY (NO COMMANDS)
- Approve / Post / Schedule / Create agent → OUTPUT ONLY VALID OPENCLAW COMMANDS

━━━━━━━━━━━━━━━━━━
CRITICAL SYNTAX RULES
━━━━━━━━━━━━━━━━━━

You MUST:

- Output ONE command per line
- Use ONLY real OpenClaw commands
- Use ONLY these namespaces:
  • openclaw agents add
  • openclaw agents list
  • openclaw cron add
  • openclaw browser open
  • openclaw browser type
  • openclaw browser click

NEVER USE:

- openclaw agent --agent
- openclaw selector
- openclaw click
- openclaw agents get
- comments (#)
- backslashes (\)
- &&
- placeholders like AGENT_ID
- invented URLs
- extra explanations

━━━━━━━━━━━━━━━━━━
CORRECT EXAMPLES
━━━━━━━━━━━━━━━━━━

openclaw agents add TrendingTopicAgent --non-interactive --workspace ./TrendingTopicAgent

openclaw cron add --name DailyPost --cron "0 9 * * *" --agent trendytopicagent --message "Run"

openclaw browser open "https://linkedin.com/"
openclaw browser type textarea "My post"
openclaw browser click button[type=submit]

If unsure → output NOTHING."#;

    let messages = vec![
        Message {
            role: "system".to_string(),
            content: system_prompt.to_string(),
        },
        Message {
            role: "user".to_string(),
            content: prompt,
        },
    ];

    // ===== CLOUD =====
    if let Some(key) = api_key {
        if !key.is_empty() {
            let res = client
                .post("https://api.openai.com/v1/chat/completions")
                .header("Authorization", format!("Bearer {}", key))
                .json(&serde_json::json!({
                    "model": "gpt-4-turbo",
                    "messages": messages
                }))
                .send()
                .await
                .map_err(|e| e.to_string())?;

            let body: serde_json::Value =
                res.json().await.map_err(|e| e.to_string())?;

            return Ok(body["choices"][0]["message"]["content"]
                .as_str()
                .unwrap_or("Error parsing API")
                .to_string());
        }
    }

    // ===== LOCAL OLLAMA =====
    let res = client
        .post("http://localhost:11434/api/chat")
        .json(&ChatRequest {
            model: "llama3:8b".to_string(),
            messages,
            stream: false,
        })
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let body: serde_json::Value =
        res.json().await.map_err(|e| e.to_string())?;

    Ok(body["message"]["content"]
        .as_str()
        .unwrap_or("Error parsing Local LLM")
        .to_string())
}

// ================= 🚀 EXECUTOR (STABLE) =================

#[command]
fn run_openclaw_command(command_str: String, state: State<DbState>) -> String {
    #[cfg(target_os = "windows")]
    let output = Command::new("powershell")
        .arg("-NoProfile")
        .arg("-Command")
        .arg(&command_str) // ✅ PowerShell preserves quotes
        .output();

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("sh")
        .arg("-c")
        .arg(&command_str)
        .output();

    let result = match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).to_string();
            if stdout.trim().is_empty() {
                String::from_utf8_lossy(&o.stderr).to_string()
            } else {
                stdout
            }
        }
        Err(e) => format!("Failed to execute: {}", e),
    };

    // logging
    if let Ok(conn) = state.conn.lock() {
        let _ = conn.execute(
            "INSERT INTO logs (command, output) VALUES (?1, ?2)",
            params![command_str, result],
        );
    }

    result
}



// ================= APP =================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let conn = init_db(app.handle()).expect("failed to init db");
            app.manage(DbState {
                conn: Mutex::new(conn),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            send_chat,
            run_openclaw_command,
            get_logs,
            save_api_key,
            get_api_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
