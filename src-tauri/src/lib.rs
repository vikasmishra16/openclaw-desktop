// src-tauri/src/lib.rs
mod scheduler;

use tauri::{command, Manager, State};
use std::process::Command;
use serde::{Deserialize, Serialize};
use rusqlite::{params, Connection, Result as SqlResult};
use std::sync::Mutex;
use std::time::Duration;
use crate::scheduler::{SchedulerManager, CronJobDef};

// ================= DATABASE =================

struct DbState {
    conn: Mutex<Connection>,
}

#[derive(Serialize, Deserialize, Clone)]
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

    conn.execute(
        "CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY,
            messages_json TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
fn log_action(command_str: String, output_str: String, state: State<DbState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO logs (command, output) VALUES (?1, ?2)",
        params![command_str, output_str],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
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

// ================= CHAT PERSISTENCE =================

#[command]
fn save_messages(messages_json: String, state: State<DbState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    // Always update row 1 (single conversation slot)
    conn.execute(
        "INSERT OR REPLACE INTO chat_messages (id, messages_json) VALUES (1, ?1)",
        params![messages_json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
fn load_messages(state: State<DbState>) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT messages_json FROM chat_messages WHERE id = 1")
        .map_err(|e| e.to_string())?;

    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;

    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        Ok(row.get(0).map_err(|e| e.to_string())?)
    } else {
        Ok("[]".to_string())
    }
}

// ================= HEALTH CHECK =================

#[command]
async fn check_ollama() -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get("http://localhost:11434/api/tags")
        .send()
        .await
        .map_err(|e| format!("Ollama not reachable: {}", e))?;

    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(serde_json::to_string(&body).unwrap_or_default())
}

// ================= 🧠 LLM (JSON MODE) =================

#[command]
async fn send_chat(prompt: String, api_key: Option<String>) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120)) // 120s: first call loads model into VRAM
        .build()
        .map_err(|e| e.to_string())?;

    // 🔥 STRICT JSON SYSTEM PROMPT
    let system_prompt = r#"You are OpenClaw Desktop Assistant.
You control a browser automation engine and a scheduler.
You MUST output strictly Valid JSON. No markdown, no explanations outside JSON.

FORMAT:
{
  "thought": "Your reasoning...",
  "action": "reply" | "browser" | "schedule",
  "payload": { ... }
}

ACTIONS:
1. "reply": Just answering the user.
   Payload: { "text": "Hello! How can I help?" }

2. "browser": Execute a browser task.
   Payload: { 
     "task": "post_linkedin" | "search_linkedin" | "interact_linkedin", 
     "content": "Post text...", 
     "instruction": "like the first post",
     "query": "search query",
     "confirm": true 
   }

3. "schedule": Schedule a recurring task.
   Payload: { 
     "cron": "0 0 9 * * *", 
     "job_name": "Daily Post", 
     "task_type": "browser", 
     "task_payload": { "task": "post_linkedin", "content": "Daily update" } 
   }
   IMPORTANT: Cron MUST be 6-field with seconds: "sec min hour day month weekday"
   Example: "0 0 9 * * *" = daily at 9 AM, "0 */30 * * * *" = every 30 min

IMPORTANT RULES:
- If the user wants to post, search, like, or do anything on LinkedIn → use action "browser"
- If the user wants something scheduled or repeated → use action "schedule"  
- If the user is just asking a question → use action "reply"
- ALWAYS include "thought" explaining your reasoning
- NEVER output markdown. ONLY valid JSON."#;

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

    // ===== CLOUD (OpenAI) =====
    if let Some(ref key) = api_key {
        if !key.is_empty() {
            let res = client
                .post("https://api.openai.com/v1/chat/completions")
                .header("Authorization", format!("Bearer {}", key))
                .json(&serde_json::json!({
                    "model": "gpt-4o-mini",
                    "messages": messages,
                    "response_format": { "type": "json_object" }
                }))
                .send()
                .await
                .map_err(|e| format!("OpenAI request failed: {}", e))?;

            let body: serde_json::Value =
                res.json().await.map_err(|e| format!("OpenAI response parse error: {}", e))?;

            if let Some(error) = body.get("error") {
                return Err(format!("OpenAI API Error: {}", error));
            }

            return Ok(body["choices"][0]["message"]["content"]
                .as_str()
                .unwrap_or("{\"action\":\"reply\",\"payload\":{\"text\":\"Error parsing API response\"}}")
                .to_string());
        }
    }

    // ===== LOCAL (Ollama) =====
    let res = client
        .post("http://localhost:11434/api/chat")
        .json(&serde_json::json!({
            "model": "llama3:8b",
            "messages": messages,
            "stream": false,
            "format": "json"
        }))
        .send()
        .await
        .map_err(|e| format!("Ollama request failed (is Ollama running?): {}", e))?;

    let body: serde_json::Value =
        res.json().await.map_err(|e| format!("Ollama response parse error: {}", e))?;

    Ok(body["message"]["content"]
        .as_str()
        .unwrap_or("{\"action\":\"reply\",\"payload\":{\"text\":\"Error parsing Local LLM\"}}")
        .to_string())
}

// ================= 🚀 ROBUST EXECUTOR =================

#[command]
async fn run_browser_action(payload: String) -> Result<String, String> {
    // Resolve script path relative to the executable's directory
    let exe_dir = std::env::current_exe()
        .map_err(|e| format!("Cannot find executable path: {}", e))?
        .parent()
        .ok_or("Cannot find executable directory")?
        .to_path_buf();

    // Try multiple candidate paths for the browser script
    let candidates = vec![
        exe_dir.join("../scripts/browser-automator.js"),
        exe_dir.join("../../scripts/browser-automator.js"),
        exe_dir.join("../../../scripts/browser-automator.js"),
        std::path::PathBuf::from("scripts/browser-automator.js"),
        std::path::PathBuf::from("../scripts/browser-automator.js"),
    ];

    let script_path = candidates
        .iter()
        .find(|p| p.exists())
        .ok_or_else(|| format!(
            "Browser script not found. Searched: {:?}",
            candidates.iter().map(|p| p.display().to_string()).collect::<Vec<_>>()
        ))?
        .to_path_buf();

    let mut cmd = Command::new("node");
    cmd.arg(&script_path)
       .env("BROWSER_PAYLOAD", &payload);

    let output = cmd.output();

    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).to_string();
            let stderr = String::from_utf8_lossy(&o.stderr).to_string();
            
            if !o.status.success() {
                return Err(format!("Script failed: {}{}", stdout, stderr));
            }
            
            if !stderr.is_empty() && stdout.trim().is_empty() {
                return Err(stderr);
            }
            Ok(stdout)
        }
        Err(e) => Err(format!("Failed to launch browser script: {}", e)),
    }
}

#[command]
async fn schedule_job(
    scheduler: State<'_, SchedulerManager>,
    app: tauri::AppHandle,
    job_def: CronJobDef
) -> Result<String, String> {
    scheduler.add_job(app, job_def).await
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
            
            // Initialize Scheduler
            let scheduler = tauri::async_runtime::block_on(SchedulerManager::new());
            app.manage(scheduler);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            send_chat,
            run_browser_action,
            schedule_job,
            get_logs,
            log_action,
            save_api_key,
            get_api_key,
            save_messages,
            load_messages,
            check_ollama
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
