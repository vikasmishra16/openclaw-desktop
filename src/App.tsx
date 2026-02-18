import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import ReactMarkdown from "react-markdown";
import {
  Send, Shield, Zap, CheckCircle, Loader2,
  Rocket, Settings, X, Clock, AlertTriangle, Key, Monitor, Bot, Edit, Trash2
} from "lucide-react";

// ================= TYPES =================
type ActionType = "reply" | "browser" | "schedule";
type AgentPayload = {
  task?: string;
  content?: string;
  confirm?: boolean;
  cron?: string;
  job_name?: string;
  task_type?: string;
  task_payload?: any;
  text?: string;
  instruction?: string;
  query?: string;
};

type AppMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  action?: ActionType;
  payload?: AgentPayload;
  status?: "pending" | "executing" | "done" | "error";
  result?: string;
};

type LogEntry = {
  id: number;
  command: string;
  output: string;
  timestamp: string;
};

// ================= INTENT DETECTION =================
// Since local LLMs can't reliably output structured JSON actions,
// we detect intent on the frontend and create action cards directly.

function detectIntent(userText: string, llmContent: string): { action: ActionType; payload: AgentPayload } | null {
  const lower = userText.toLowerCase();

  // LinkedIn Comment intent (MUST be checked before post — "comment on posts" has "post" in it)
  if (lower.includes("comment") && (lower.includes("linkedin") || lower.includes("#"))) {
    const query = extractSearchQuery(userText);
    const content = extractPostContent(llmContent) || "Check out OpenClaw — the open-source AI automation framework! 🚀 Great for building agents without code. https://github.com/openclaw";
    return {
      action: "browser",
      payload: { task: "comment_linkedin", query, content }
    };
  }

  // LinkedIn Post intent (only if NOT a comment or like request)
  if ((lower.includes("post") || lower.includes("draft")) && lower.includes("linkedin") && !lower.includes("comment") && !lower.includes("like")) {
    const content = extractPostContent(llmContent) || `Generated post about: ${userText}`;
    return {
      action: "browser",
      payload: { task: "post_linkedin", content, confirm: true }
    };
  }

  // LinkedIn Search intent
  if (lower.includes("search") && lower.includes("linkedin")) {
    const query = extractSearchQuery(userText);
    return {
      action: "browser",
      payload: { task: "search_linkedin", query }
    };
  }

  // LinkedIn Like/Interact intent
  if (lower.includes("like") && (lower.includes("linkedin") || lower.includes("post"))) {
    return {
      action: "browser",
      payload: { task: "interact_linkedin", instruction: userText }
    };
  }

  // Schedule intent
  if (lower.includes("schedule") || lower.includes("every hour") || lower.includes("every day") || lower.includes("daily")) {
    const cron = normalizeCron(extractCron(lower));
    return {
      action: "schedule",
      payload: {
        cron,
        job_name: `Scheduled: ${userText.slice(0, 30)}`,
        task_type: "browser",
        task_payload: { task: "search_linkedin", query: "#openclaw" }
      }
    };
  }

  return null;
}

function extractPostContent(llmText: string): string {
  // Try to parse as JSON first
  try {
    const parsed = JSON.parse(llmText);
    if (parsed.payload?.content) return parsed.payload.content;
    if (parsed.payload?.text) return parsed.payload.text;
    if (parsed.thought) return parsed.thought;
  } catch { /* not JSON */ }

  // Return LLM text directly if it looks like post content
  if (llmText.length > 20 && llmText.length < 2000) return llmText;
  return "";
}

function extractSearchQuery(text: string): string {
  // Extract hashtags or search terms
  const hashMatch = text.match(/#\w+/);
  if (hashMatch) return hashMatch[0];

  // Extract quoted text
  const quoteMatch = text.match(/["']([^"']+)["']/);
  if (quoteMatch) return quoteMatch[1];

  // Extract after "search for" or "search"
  const searchMatch = text.match(/search\s+(?:for\s+)?(.+?)(?:\s+on|\s*$)/i);
  if (searchMatch) return searchMatch[1].trim();

  return text.replace(/search|linkedin|on|and/gi, "").trim() || "#openclaw";
}

function extractCron(text: string): string {
  // tokio-cron-scheduler uses 6-field cron: sec min hour day month weekday
  if (text.includes("every hour")) return "0 0 * * * *";
  if (text.includes("every day") || text.includes("daily")) {
    const timeMatch = text.match(/(\d{1,2})\s*(am|pm)/i);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1]);
      if (timeMatch[2].toLowerCase() === "pm" && hour < 12) hour += 12;
      if (timeMatch[2].toLowerCase() === "am" && hour === 12) hour = 0;
      return `0 0 ${hour} * * *`;
    }
    return "0 0 9 * * *"; // Default 9 AM
  }
  if (text.includes("every 30 min")) return "0 */30 * * * *";
  return "0 0 * * * *"; // Default hourly
}

// Ensure cron is always 6-field (sec min hour day month weekday)
// tokio-cron-scheduler requires this format; LLMs often return 5-field
function normalizeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length === 5) return `0 ${cron.trim()}`; // Prepend seconds
  if (parts.length === 7) return parts.slice(0, 6).join(" "); // Drop year
  if (parts.length === 6) return cron.trim();
  return "0 0 9 * * *"; // Fallback: daily 9 AM
}

// ================= COMPONENTS =================

const ActionCard = ({ msg, onExecute, sandboxMode, onUpdatePayload }: {
  msg: AppMessage;
  onExecute: () => void;
  sandboxMode: boolean;
  onUpdatePayload?: (field: string, value: string) => void;
}) => {
  const [editing, setEditing] = useState<string | null>(null);

  if (msg.status === "done") {
    return (
      <div className="mt-3 p-3 bg-green-900/30 border border-green-700/50 rounded-lg flex items-center gap-2 text-green-200">
        <CheckCircle size={18} />
        <span className="text-sm font-medium">Task Completed</span>
        {msg.result && <span className="text-xs opacity-75 ml-auto">{msg.result.slice(0, 80)}</span>}
      </div>
    );
  }

  if (msg.status === "executing") {
    return (
      <div className="mt-3 p-3 bg-blue-900/30 border border-blue-700/50 rounded-lg flex items-center gap-2 text-blue-200 animate-pulse">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm font-medium">Executing... (browser will open)</span>
      </div>
    );
  }

  if (msg.status === "error") {
    return (
      <div className="mt-3 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-200 text-sm">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle size={16} />
          <strong>Failed</strong>
        </div>
        <p className="text-xs opacity-80">{msg.result}</p>
      </div>
    );
  }

  // Safe Mode badge
  const SafeModeBadge = () => (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium mb-3 w-fit ${sandboxMode
      ? "bg-emerald-900/40 border border-emerald-700/50 text-emerald-300"
      : "bg-red-900/40 border border-red-700/50 text-red-300"
      }`}>
      <Shield size={10} />
      {sandboxMode ? "🛡️ Content will be typed but NOT submitted" : "⚡ Will submit automatically (LIVE)"}
    </div>
  );

  // Editable field helper
  const EditableField = ({ label, field, value, color }: { label: string; field: string; value: string; color: string }) => (
    <div className="mt-1">
      <div className="flex items-center gap-1.5">
        <strong className={`text-${color}-300`}>{label}:</strong>
        {editing !== field && onUpdatePayload && (
          <button onClick={() => setEditing(field)} className={`text-${color}-500 hover:text-${color}-300 transition-colors`} title="Edit">
            <Edit size={11} />
          </button>
        )}
      </div>
      {editing === field ? (
        <div className="mt-1 space-y-1">
          <textarea
            defaultValue={value}
            rows={field === "content" ? 4 : 1}
            className="w-full bg-black/40 border border-slate-600 rounded-lg p-2 text-xs text-slate-200 focus:border-blue-500 outline-none resize-none"
            onBlur={(e) => {
              onUpdatePayload?.(field, e.target.value);
              setEditing(null);
            }}
            autoFocus
          />
          <p className="text-xs text-slate-500">Click outside to save</p>
        </div>
      ) : (
        field === "content" && value ? (
          <div className="mt-1 text-xs italic border-l-2 border-blue-700 pl-2 text-slate-400">
            "{value.slice(0, 150)}{value.length > 150 ? "..." : ""}"
          </div>
        ) : value ? (
          <span className="text-sm text-slate-300 ml-1">{value}</span>
        ) : null
      )}
    </div>
  );

  // Pending Actions
  if (msg.action === "browser") {
    return (
      <div className="mt-3 p-4 bg-gradient-to-br from-blue-950 to-slate-900 border border-blue-700/40 rounded-xl shadow-lg">
        <div className="flex items-center gap-2 mb-3 text-blue-400 font-semibold text-sm">
          <Monitor size={16} />
          <span>Browser Automation Ready</span>
        </div>
        <SafeModeBadge />
        <div className="text-sm text-slate-300 mb-3 bg-black/20 p-3 rounded-lg space-y-1">
          <div><strong className="text-blue-300">Task:</strong> {msg.payload?.task?.replace(/_/g, " ")}</div>
          {msg.payload?.content && <EditableField label="Content" field="content" value={msg.payload.content} color="blue" />}
          {msg.payload?.query && <EditableField label="Query" field="query" value={msg.payload.query} color="blue" />}
          {msg.payload?.instruction && <div><strong className="text-blue-300">Action:</strong> {msg.payload.instruction}</div>}
        </div>
        <button
          onClick={onExecute}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-all flex justify-center items-center gap-2 shadow-md hover:shadow-blue-500/20 active:scale-[0.98]"
        >
          <Zap size={16} /> Approve & Run
        </button>
      </div>
    );
  }

  if (msg.action === "schedule") {
    return (
      <div className="mt-3 p-4 bg-gradient-to-br from-purple-950 to-slate-900 border border-purple-700/40 rounded-xl shadow-lg">
        <div className="flex items-center gap-2 mb-3 text-purple-400 font-semibold text-sm">
          <Clock size={16} />
          <span>Schedule Ready</span>
        </div>
        <SafeModeBadge />
        <div className="text-sm text-slate-300 mb-3 bg-black/20 p-3 rounded-lg space-y-1">
          <div><strong className="text-purple-300">Cron:</strong> <code className="bg-black/30 px-1.5 py-0.5 rounded text-xs">{msg.payload?.cron}</code></div>
          <div><strong className="text-purple-300">Job:</strong> {msg.payload?.job_name}</div>
        </div>
        <button
          onClick={onExecute}
          className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 rounded-lg font-medium transition-all flex justify-center items-center gap-2 shadow-md hover:shadow-purple-500/20 active:scale-[0.98]"
        >
          <CheckCircle size={16} /> Confirm Schedule
        </button>
      </div>
    );
  }

  return null;
};

// ================= MAIN APP =================

export default function App() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AppMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sandboxMode, setSandboxMode] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<"checking" | "online" | "offline">("checking");
  const [showOnboarding, setShowOnboarding] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastActionTime = useRef<number>(0);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ===== INIT =====
  useEffect(() => {
    // Load API Key
    invoke<string>("get_api_key")
      .then((k) => { setApiKey(k || ""); if (k) setShowOnboarding(false); })
      .catch(() => { });

    // Load saved chat messages
    invoke<string>("load_messages")
      .then((json) => {
        try {
          const saved = JSON.parse(json);
          if (Array.isArray(saved) && saved.length > 0) {
            setMessages(saved);
            setShowOnboarding(false);
          }
        } catch { }
      })
      .catch(() => { });

    // Check Ollama
    invoke<string>("check_ollama")
      .then(() => { setOllamaStatus("online"); })
      .catch(() => { setOllamaStatus("offline"); });
  }, []);

  // ===== CRON EVENT LISTENER =====
  useEffect(() => {
    const unlisten = listen<{ type: string; payload: string }>("cron-event", async (event) => {
      const { type, payload } = event.payload;
      console.log("⏰ Cron event received:", type, payload);

      // Show a system message that the cron fired
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: `⏰ **Scheduled task firing!**\n\nType: \`${type}\``,
        status: "executing" as const,
        action: "browser" as ActionType,
        payload: JSON.parse(payload || "{}")
      }]);

      try {
        const payloadWithSandbox = JSON.stringify({ ...JSON.parse(payload || "{}"), sandbox: sandboxMode });
        const result = await invoke<string>("run_browser_action", { payload: payloadWithSandbox });

        setMessages((prev) => {
          const newMsgs = [...prev];
          // Update the last cron message to done
          const lastIdx = newMsgs.length - 1;
          if (newMsgs[lastIdx]?.content?.includes("Scheduled task firing")) {
            newMsgs[lastIdx] = { ...newMsgs[lastIdx], status: "done", result };
          }
          newMsgs.push({ role: "assistant", content: `✅ **Scheduled task completed!**\n\n${result || "Done."}` });
          return newMsgs;
        });

        try { await invoke("log_action", { commandStr: `cron: ${type}`, outputStr: (result || "").slice(0, 200) }); } catch { }
      } catch (e: any) {
        setMessages((prev) => {
          const newMsgs = [...prev];
          const lastIdx = newMsgs.length - 1;
          if (newMsgs[lastIdx]?.content?.includes("Scheduled task firing")) {
            newMsgs[lastIdx] = { ...newMsgs[lastIdx], status: "error", result: String(e) };
          }
          return newMsgs;
        });

        try { await invoke("log_action", { commandStr: `cron FAILED: ${type}`, outputStr: String(e).slice(0, 200) }); } catch { }
      }
    });

    return () => { unlisten.then((fn) => fn()); };
  }, [sandboxMode]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const saveKey = async (val: string) => {
    setApiKey(val);
    try { await invoke("save_api_key", { key: val }); } catch { }
  };

  const loadLogs = async () => {
    try {
      const entries = await invoke<LogEntry[]>("get_logs");
      setLogs(entries);
    } catch { }
  };

  const completeOnboarding = () => {
    setShowOnboarding(false);
    setMessages([{
      role: "assistant",
      content: "👋 **Welcome to OpenClaw Desktop!**\n\nI'm your AI automation assistant. Try the quick commands below, or type anything:\n\n🔹 **\"Draft a LinkedIn post about AI trends\"**\n🔹 **\"Search LinkedIn for #openclaw\"**\n🔹 **\"Comment on #openclaw posts promoting GitHub\"**\n🔹 **\"Schedule daily LinkedIn post at 9 AM\"**\n\n🛡️ **Safe Mode is ON** — Nothing will be posted without your approval.",
    }]);
  };

  // ===== SEND MESSAGE =====
  const handleSend = async () => {
    if (!input.trim()) return;

    const userText = input;
    setInput("");
    setLoading(true);

    const newMsg: AppMessage = { role: "user", content: userText };
    setMessages((prev) => [...prev, newMsg]);

    try {
      // 1. Send to LLM (with timeout via backend)
      const responseStr = await invoke<string>("send_chat", {
        prompt: userText,
        apiKey: apiKey || null
      });
      console.log("LLM Raw:", responseStr);

      // 2. Try to parse LLM JSON response
      let llmText = responseStr;
      let llmAction: ActionType | undefined;
      let llmPayload: AgentPayload | undefined;

      try {
        const parsed = JSON.parse(responseStr);
        llmText = parsed.thought || parsed.payload?.text || responseStr;
        if (parsed.action && parsed.action !== "reply") {
          llmAction = parsed.action;
          llmPayload = parsed.payload;
          // Normalize cron from LLM (may be 5-field, needs 6-field)
          if (llmAction === "schedule" && llmPayload?.cron) {
            llmPayload = { ...llmPayload, cron: normalizeCron(llmPayload.cron) };
          }
        }
      } catch {
        // LLM didn't return JSON — use smart intent detection
      }

      // 3. Smart Intent Detection (Frontend fallback)
      // If LLM didn't give us an action, detect from user's words + LLM content
      let finalAction = llmAction;
      let finalPayload = llmPayload;

      if (!finalAction || finalAction === ("reply" as ActionType)) {
        const detected = detectIntent(userText, llmText);
        if (detected) {
          finalAction = detected.action;
          finalPayload = detected.payload;
          // Use LLM's generated content if available and this is a post task
          if (detected.payload.task === "post_linkedin" && llmText.length > 30) {
            finalPayload = { ...detected.payload, content: llmText };
          }
        }
      }

      const assistantMsg: AppMessage = {
        role: "assistant",
        content: llmText,
        action: finalAction,
        payload: finalPayload,
        status: finalAction && finalAction !== "reply" ? "pending" : "done"
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // Log the interaction
      try { await invoke("log_action", { commandStr: `chat: ${userText} `, outputStr: llmText.slice(0, 200) }); } catch { }

    } catch (e: any) {
      console.error("LLM Error:", e);
      const errorMsg = String(e);

      // Even on LLM error, try intent detection so user isn't stuck
      const detected = detectIntent(userText, "");
      if (detected) {
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: `⚠️ LLM unavailable(${errorMsg.slice(0, 60)}), but I detected your intent.You can still run this action: `,
          action: detected.action,
          payload: detected.payload,
          status: "pending"
        }]);
      } else {
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: `❌ ** Error **: ${errorMsg} \n\n💡 ** Tip **: Make sure Ollama is running(\`ollama serve\`) or set an API key in Settings.`
        }]);
      }
    } finally {
      setLoading(false);
    }
  };

  // ===== EXECUTE ACTION =====
  const executeAction = async (index: number) => {
    const msg = messages[index];
    if (!msg.payload) return;

    // Rate limiting — 10 second cooldown
    const now = Date.now();
    const elapsed = now - lastActionTime.current;
    if (elapsed < 10000) {
      const remaining = Math.ceil((10000 - elapsed) / 1000);
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: `⏳ **Rate limited** — please wait ${remaining}s before running another action.`
      }]);
      return;
    }
    lastActionTime.current = now;

    setMessages((prev) => {
      const newMsgs = [...prev];
      newMsgs[index] = { ...newMsgs[index], status: "executing" };
      return newMsgs;
    });

    try {
      let result = "";

      if (msg.action === "browser") {
        const payloadStr = JSON.stringify({ ...msg.payload, sandbox: sandboxMode });
        result = await invoke("run_browser_action", { payload: payloadStr });
      }
      else if (msg.action === "schedule") {
        await invoke("schedule_job", {
          jobDef: {
            id: `job-${Date.now()}`,
            cron_exp: msg.payload.cron,
            task_type: msg.payload.task_type || "browser",
            payload: JSON.stringify(msg.payload.task_payload)
          }
        });
        result = "✅ Scheduled successfully!";
      }

      // Log it
      try { await invoke("log_action", { commandStr: `action: ${msg.action} ${msg.payload.task || ""}`, outputStr: result.slice(0, 200) }); } catch { }

      setMessages((prev) => {
        const newMsgs = [...prev];
        newMsgs[index] = { ...newMsgs[index], status: "done", result };
        newMsgs.push({ role: "assistant", content: `✅ **Action completed!**\n\n${result || "Done."}` });
        return newMsgs;
      });

    } catch (e: any) {
      try { await invoke("log_action", { commandStr: `FAILED: ${msg.action}`, outputStr: String(e).slice(0, 200) }); } catch { }

      setMessages((prev) => {
        const newMsgs = [...prev];
        newMsgs[index] = { ...newMsgs[index], status: "error", result: String(e) };
        return newMsgs;
      });
    }
  };

  // ===== UPDATE PAYLOAD (for inline editing) =====
  const updatePayload = (index: number, field: string, value: string) => {
    setMessages((prev) => {
      const newMsgs = [...prev];
      const msg = newMsgs[index];
      if (msg.payload) {
        newMsgs[index] = { ...msg, payload: { ...msg.payload, [field]: value } };
      }
      return newMsgs;
    });
  };

  // ===== AUTO-SAVE MESSAGES (debounced) =====
  useEffect(() => {
    if (messages.length === 0) return;
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      // Strip executing status before saving (avoid restoring stale states)
      const toSave = messages.map(m => ({
        ...m,
        status: m.status === "executing" ? "error" as const : m.status
      }));
      invoke("save_messages", { messagesJson: JSON.stringify(toSave) }).catch(() => { });
    }, 2000);
  }, [messages]);
  // ===== NEW CHAT / CLEAR =====
  const clearChat = async () => {
    setMessages([]);
    try { await invoke("save_messages", { messagesJson: "[]" }); } catch { }
    // Re-show welcome message
    setMessages([{
      role: "assistant",
      content: "👋 **Welcome to OpenClaw Desktop!**\n\nI'm your AI automation assistant. Try the quick commands below, or type anything:\n\n🔹 **\"Draft a LinkedIn post about AI trends\"**\n🔹 **\"Search LinkedIn for #openclaw\"**\n🔹 **\"Comment on #openclaw posts promoting GitHub\"**\n🔹 **\"Schedule daily LinkedIn post at 9 AM\"**\n\n🛡️ **Safe Mode is ON** — Nothing will be posted without your approval.",
    }]);
  };

  // ================= ONBOARDING =================
  if (showOnboarding) {
    return (
      <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans items-center justify-center p-8">
        <div className="max-w-lg w-full space-y-6">
          <div className="text-center space-y-3">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-purple-600 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-blue-500/20">
              <Rocket size={32} className="text-white" />
            </div>
            <h1 className="text-3xl font-bold">OpenClaw Desktop</h1>
            <p className="text-slate-400">Your AI-powered automation assistant</p>
          </div>

          {/* Status Checks */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h2 className="font-semibold text-sm text-slate-300 uppercase tracking-wider">System Check</h2>

            <div className="flex items-center gap-3">
              {ollamaStatus === "checking" && <Loader2 size={18} className="animate-spin text-yellow-400" />}
              {ollamaStatus === "online" && <CheckCircle size={18} className="text-green-400" />}
              {ollamaStatus === "offline" && <AlertTriangle size={18} className="text-yellow-400" />}
              <div>
                <p className="text-sm font-medium">
                  Local AI (Ollama) — {ollamaStatus === "online" ? "Running ✓" : ollamaStatus === "offline" ? "Not detected" : "Checking..."}
                </p>
                {ollamaStatus === "offline" && (
                  <p className="text-xs text-slate-500">Run <code className="bg-slate-800 px-1 rounded">ollama serve</code> or add an API key below</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Bot size={18} className="text-blue-400" />
              <div>
                <p className="text-sm font-medium">Browser Automation — Playwright</p>
                <p className="text-xs text-slate-500">Ready for LinkedIn automation</p>
              </div>
            </div>
          </div>

          {/* API Key (Optional) */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-300 uppercase tracking-wider">
              <Key size={14} />
              <span>API Key (Optional)</span>
            </div>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => saveKey(e.target.value)}
              placeholder="sk-... (OpenAI key for better AI responses)"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm focus:border-blue-500 outline-none"
            />
            <p className="text-xs text-slate-500">
              {apiKey ? "✓ Using GPT-4o-mini (Cloud)" : "Using Llama-3 (Local) — No key needed"}
            </p>
          </div>

          <button
            onClick={completeOnboarding}
            disabled={ollamaStatus === "checking"}
            className="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-xl font-semibold text-lg transition-all shadow-lg hover:shadow-blue-500/20 active:scale-[0.98] disabled:opacity-50"
          >
            {ollamaStatus === "offline" && !apiKey ? "Continue without AI (Limited)" : "Get Started →"}
          </button>
        </div>
      </div>
    );
  }

  // ================= MAIN UI =================
  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans relative">

      {/* SETTINGS MODAL */}
      {showSettings && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-xl w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold flex items-center gap-2"><Settings size={20} /> Settings</h2>
              <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-slate-800 rounded"><X size={20} /></button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">OpenAI API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => saveKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm focus:border-blue-500 outline-none"
                />
                <p className="text-xs text-slate-500 mt-2">
                  {apiKey ? "✓ Using GPT-4o-mini (Cloud)" : "Empty = Local Llama-3 via Ollama"}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">LLM Status</label>
                <div className="flex items-center gap-2 text-sm">
                  <div className={`w-2 h-2 rounded-full ${ollamaStatus === "online" ? "bg-green-400" : "bg-yellow-400"}`} />
                  {ollamaStatus === "online" ? "Ollama Online" : "Ollama Offline"}
                  {apiKey && <span className="ml-auto text-blue-400">Cloud Active</span>}
                </div>
              </div>
            </div>

            <button onClick={() => setShowSettings(false)} className="mt-6 w-full py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium">
              Done
            </button>
          </div>
        </div>
      )}

      {/* LOGS MODAL */}
      {showLogs && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-xl w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold flex items-center gap-2"><Clock size={20} /> Execution Logs</h2>
              <button onClick={() => setShowLogs(false)} className="p-1 hover:bg-slate-800 rounded"><X size={20} /></button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
              {logs.length === 0 && <p className="text-sm text-slate-500 text-center py-8">No logs yet. Run some actions first!</p>}
              {logs.map((log) => (
                <div key={log.id} className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs">
                  <div className="flex justify-between text-slate-500 mb-1">
                    <span className="font-mono">{log.command}</span>
                    <span>{log.timestamp}</span>
                  </div>
                  <p className="text-slate-400 truncate">{log.output}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="flex justify-between items-center px-4 py-3 border-b border-slate-800 bg-slate-900/50 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center shadow-md">
            <Rocket size={18} className="text-white" />
          </div>
          <h1 className="font-bold text-lg tracking-tight">OpenClaw <span className="text-slate-400 font-normal">Desktop</span></h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setSandboxMode(!sandboxMode)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${sandboxMode
              ? "bg-emerald-900/30 border-emerald-700/50 text-emerald-400"
              : "bg-red-900/30 border-red-700/50 text-red-300 animate-pulse"
              }`}
          >
            <Shield size={12} />
            {sandboxMode ? "Safe Mode" : "LIVE"}
          </button>

          <button
            onClick={clearChat}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white"
            title="New Chat"
          >
            <Trash2 size={18} />
          </button>

          <button
            onClick={() => { setShowLogs(true); loadLogs(); }}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white"
            title="Logs"
          >
            <Clock size={18} />
          </button>

          <button
            onClick={() => setShowSettings(true)}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white"
            title="Settings"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      {/* CHAT AREA */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 scroll-smooth">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>

            {m.role === "assistant" && (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-900 to-purple-900 flex items-center justify-center mr-3 mt-1 shrink-0 shadow-sm">
                <Bot size={14} className="text-blue-300" />
              </div>
            )}

            <div className={`max-w-[85%] ${m.role === "user" ? "" : ""}`}>
              <div className={`p-3.5 rounded-2xl ${m.role === "user"
                ? "bg-blue-600 text-white rounded-tr-sm shadow-md"
                : "bg-slate-900 border border-slate-800 rounded-tl-sm shadow-sm text-slate-200"
                }`}>
                <div className="prose prose-invert prose-sm leading-relaxed max-w-none">
                  <ReactMarkdown>
                    {m.content}
                  </ReactMarkdown>
                </div>

                {/* ACTION CARD */}
                {(m.action === "browser" || m.action === "schedule") && (
                  <ActionCard
                    msg={m}
                    onExecute={() => executeAction(i)}
                    sandboxMode={sandboxMode}
                    onUpdatePayload={(field, value) => updatePayload(i, field, value)}
                  />
                )}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-900 to-purple-900 flex items-center justify-center mr-3 shrink-0">
              <Loader2 size={14} className="text-blue-300 animate-spin" />
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl rounded-tl-sm p-4 text-slate-500 text-sm animate-pulse">
              Thinking...
            </div>
          </div>
        )}

        <div ref={scrollRef} />
      </div>

      {/* INPUT */}
      <div className="p-4 bg-slate-900/80 backdrop-blur border-t border-slate-800">
        <div className="max-w-3xl mx-auto relative">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !loading && handleSend()}
            placeholder="Ask OpenClaw to do something..."
            className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3.5 pl-4 pr-12 focus:outline-none focus:border-blue-500 transition-colors shadow-inner"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="absolute right-2 top-2 p-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-lg transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
        <div className="text-center mt-2 text-xs text-slate-600 flex items-center justify-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${apiKey ? "bg-blue-400" : ollamaStatus === "online" ? "bg-green-400" : "bg-yellow-400"}`} />
          {apiKey ? "GPT-4o-mini" : ollamaStatus === "online" ? "Llama-3 (Local)" : "LLM Offline"} • Playwright
          {sandboxMode && " • 🛡️ Safe Mode"}
        </div>
      </div>
    </div>
  );
}
