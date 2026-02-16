import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function App() {
  const [input, setInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "👋 Hi! I'm OpenClaw Desktop. I'm running locally on **llama3:8b**. Type 'Setup' to start!",
    },
  ]);
  const [loading, setLoading] = useState(false);

  // ================= LOAD API KEY =================
  useEffect(() => {
    invoke("get_api_key").then((key) => {
      if (key) setApiKey(key as string);
    });
  }, []);

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const key = e.target.value;
    setApiKey(key);
    invoke("save_api_key", { key });
  };

  // ================= MAIN SEND =================
  async function sendMessage() {
    if (!input.trim()) return;

    const userMsg: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    const userInput = input.trim();

    // 🚨 DIRECT COMMAND BYPASS
    if (userInput.toLowerCase().startsWith("openclaw ")) {
      await executeSingleCommand(userInput);
      setLoading(false);
      return;
    }

    const systemGuard = `
You are OpenClaw Desktop.

CRITICAL RULES:
- Output ONLY valid openclaw commands
- One command per line
- Never use &&
- Never use comments
- Never invent flags
- Never use placeholders

CRON:
Daily 9am = "0 9 * * *"
Monday noon = "0 12 * * 1"

LINKEDIN:
Use https://linkedin.com/
After opening browser ALWAYS wait before typing
Use selector textarea
Use selector button[type=submit]
One command per line

`;

    try {
      const response = await invoke("send_chat", {
        prompt: systemGuard + "\n\nUser: " + userInput,
        apiKey,
      });

      let fullResponse = response as string;

      // ✅ execute ONLY first valid command
      const lines = fullResponse.split("\n");
      let executed = false;

      for (let rawLine of lines) {
        if (executed) break;

        const cmd = sanitizeCommand(rawLine.trim());
        if (!cmd) continue;

        executed = true;

        fullResponse += `\n\n⚙️ *Executing: ${cmd}...*`;

        try {
          const result = await invoke("run_openclaw_command", {
            commandStr: cmd,
          });

          fullResponse += `\n\n✅ **Result:**\n\`\`\`\n${result}\n\`\`\``;
        } catch (err) {
          fullResponse += `\n\n❌ **Error:** ${err}`;
        }
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: fullResponse },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${e}` },
      ]);
    }

    setLoading(false);
  }

  // ================= SINGLE EXECUTOR =================
  async function executeSingleCommand(rawCmd: string) {
    const cleanedCmd = sanitizeCommand(rawCmd);
    if (!cleanedCmd) return;

    let fullResponse = `⚙️ *Executing: ${cleanedCmd}...*`;

    try {
      const result = await invoke("run_openclaw_command", {
        commandStr: cleanedCmd,
      });

      fullResponse += `\n\n✅ **Result:**\n\`\`\`\n${result}\n\`\`\``;
    } catch (e) {
      fullResponse += `\n\n❌ **Error:** ${e}`;
    }

    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: fullResponse },
    ]);
  }

  // ================= 🔥 FINAL SANITIZER =================
  function sanitizeCommand(inputCmd: string): string {
    if (!inputCmd) return "";

    let cmd = inputCmd.trim();

    // must start with openclaw
    if (!cmd.toLowerCase().startsWith("openclaw ")) return "";

    // remove chaining
    cmd = cmd.split(/[\n;&]/)[0];

    // normalize quotes
    cmd = cmd.replace(/[“”]/g, '"');

    // ================= AGENT ADD SAFETY =================
    if (cmd.startsWith("openclaw agents add")) {
      if (!cmd.includes("--workspace")) {
        const match = cmd.match(/openclaw agents add\s+(\S+)/i);
        const agentName = match?.[1] || "agent";
        cmd += ` --workspace ./${agentName}`;
      }
    }

    // ================= LINKEDIN FIX =================
    cmd = cmd.replace(
      /https:\/\/linkedin\.com(?!\/)/gi,
      "https://linkedin.com/"
    );

    // ================= 🚨 ULTRA CRON REPAIR =================
    if (cmd.startsWith("openclaw cron add")) {
      const cronRegex = /--cron\s+"([^"]*)"/i;
      const match = cmd.match(cronRegex);

      let fixedCron = "0 9 * * *";

      if (match) {
        let parts = match[1]
          .trim()
          .split(/\s+/)
          .filter(Boolean);

        // 🔥 AUTO-HEAL to exactly 5 fields
        while (parts.length < 5) parts.push("*");
        if (parts.length > 5) parts = parts.slice(0, 5);

        fixedCron = parts.join(" ");
      }

      // replace cron safely
      if (cmd.includes("--cron")) {
        cmd = cmd.replace(cronRegex, `--cron "${fixedCron}"`);
      } else {
        cmd += ` --cron "${fixedCron}"`;
      }
    }

    // collapse whitespace LAST
    cmd = cmd.replace(/\s+/g, " ").trim();

    return cmd;
  }


  // ================= UI =================
  return (
    <div className="flex flex-col h-screen bg-slate-900 text-slate-100 font-sans p-4">
      <div className="flex justify-between items-center bg-slate-800 p-3 rounded-lg mb-4 border border-slate-700">
        <h1 className="font-bold text-xl text-blue-400">
          OpenClaw Desktop
        </h1>

        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${apiKey ? "bg-green-500" : "bg-yellow-500"
              }`}
          />
          <span className="text-xs text-slate-400">
            {apiKey ? "Cloud Mode (API)" : "Local Mode (llama3:8b)"}
          </span>

          <input
            type="password"
            placeholder="API Key (Optional)"
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs w-32 ml-2"
            value={apiKey}
            onChange={handleApiKeyChange}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto space-y-4 mb-4 pr-2">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`p-4 rounded-xl max-w-[85%] ${m.role === "user"
              ? "ml-auto bg-blue-600"
              : "bg-slate-800 border border-slate-700"
              }`}
          >
            <ReactMarkdown>{m.content}</ReactMarkdown>
          </div>
        ))}

        {loading && (
          <div className="text-slate-500 animate-pulse">Thinking...</div>
        )}
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500"
          placeholder="Tell OpenClaw what to do..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        />

        <button
          onClick={sendMessage}
          className="bg-blue-500 hover:bg-blue-600 px-6 rounded-lg font-bold"
        >
          Send
        </button>
      </div>
    </div>
  );
}
