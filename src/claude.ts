import { spawn, type ChildProcess } from "node:child_process";
import type { BotConfig, ClaudeResult, StreamJsonEvent } from "./types.js";
import type { SessionStore } from "./session.js";

export interface RunClaudeOptions {
  config: BotConfig;
  sessionStore: SessionStore;
  userId: number;
  message: string;
  onEvent?: (event: StreamJsonEvent) => void;
}

/**
 * Build Claude CLI arguments.
 */
function buildArgs(
  config: BotConfig,
  sessionId: string,
  isNew: boolean,
  message: string
): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
  ];

  if (isNew) {
    args.push("--session-id", sessionId);
  } else {
    args.push("--resume", sessionId);
  }

  args.push("--permission-mode", config.permissionMode);

  if (config.model) {
    args.push("--model", config.model);
  }

  if (config.systemPrompt) {
    args.push("--append-system-prompt", config.systemPrompt);
  }

  if (config.disableSlashCommands) {
    args.push("--disable-slash-commands");
  }

  if (config.settingSources) {
    args.push("--setting-sources", config.settingSources);
  }

  if (config.strictMcpConfig) {
    args.push("--strict-mcp-config");
  }

  if (config.tools && config.tools.length > 0) {
    args.push("--tools", ...config.tools);
  }

  if (config.allowedTools && config.allowedTools.length > 0) {
    args.push("--allowed-tools", ...config.allowedTools);
  }

  if (config.disallowedTools && config.disallowedTools.length > 0) {
    args.push("--disallowed-tools", ...config.disallowedTools);
  }

  if (config.mcpConfig && config.mcpConfig.length > 0) {
    args.push("--mcp-config", ...config.mcpConfig);
  }

  if (config.addDirs && config.addDirs.length > 0) {
    for (const dir of config.addDirs) {
      args.push("--add-dir", dir);
    }
  }

  // Important: prevent prompt injection via CLI flags (e.g. message="--help").
  args.push("--", message);
  return args;
}

/**
 * Parse a stream-json line from Claude CLI stdout.
 */
function parseStreamLine(line: string): StreamJsonEvent | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return null;

  try {
    return JSON.parse(trimmed) as StreamJsonEvent;
  } catch {
    return null;
  }
}

/**
 * Extract final result text from stream-json events.
 */
function extractResult(events: StreamJsonEvent[]): {
  output: string;
  costUsd?: number;
} {
  // Look for result event
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === "result") {
      return {
        output: event.result || "",
        costUsd: event.total_cost_usd,
      };
    }
  }

  // Fallback: collect text from assistant messages
  const texts: string[] = [];
  for (const event of events) {
    if (event.type === "assistant" && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === "text" && block.text) {
          texts.push(block.text);
        }
      }
    }
  }

  return { output: texts.join("\n") };
}

/**
 * Run Claude CLI as a subprocess with stream-json parsing.
 */
export function runClaude(options: RunClaudeOptions): {
  promise: Promise<ClaudeResult>;
  child: ChildProcess;
} {
  const { config, sessionStore, userId, message, onEvent } = options;
  const { sessionId, isNew } = sessionStore.getSession(userId);
  const args = buildArgs(config, sessionId, isNew, message);

  const child = spawn(config.claudePath, args, {
    cwd: config.workspace,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const promise = new Promise<ClaudeResult>((resolve) => {
    const events: StreamJsonEvent[] = [];
    const stderrChunks: string[] = [];
    const startTime = Date.now();
    let killed = false;
    let detectedSessionId: string | undefined;

    // Timeout
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5000);
    }, config.timeout * 1000);

    // Parse stdout stream-json
    let stdoutBuffer = "";
    child.stdout!.on("data", (data: Buffer) => {
      stdoutBuffer += data.toString("utf-8");
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        const event = parseStreamLine(line);
        if (event) {
          events.push(event);
          onEvent?.(event);

          // Capture session ID from init event
          if (
            event.type === "system" &&
            event.subtype === "init" &&
            event.session_id
          ) {
            detectedSessionId = event.session_id;
          }
        }
      }
    });

    // Capture stderr
    child.stderr!.on("data", (data: Buffer) => {
      stderrChunks.push(data.toString("utf-8"));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      // Process remaining buffer
      if (stdoutBuffer.trim()) {
        const event = parseStreamLine(stdoutBuffer);
        if (event) {
          events.push(event);
          onEvent?.(event);
        }
      }

      if (killed) {
        resolve({
          success: false,
          output: "",
          error: `Claude took too long (>${Math.floor(config.timeout / 60)}min). Try a simpler request or send again.`,
          sessionId: detectedSessionId || sessionId,
          durationMs,
        });
        return;
      }

      // Check for session-not-found in stderr and retry with new session
      const stderr = stderrChunks.join("");
      if (
        code !== 0 &&
        !isNew &&
        (stderr.includes("session") || stderr.includes("not found") || stderr.includes("ENOENT"))
      ) {
        // Session lost — refresh and let caller retry or handle
        sessionStore.refreshSession(userId);
        resolve({
          success: false,
          output: "",
          error: "Conversation couldn't be restored (session expired). Send your message again to start fresh.",
          sessionId: detectedSessionId || sessionId,
          durationMs,
        });
        return;
      }

      if (code !== 0) {
        const errorText = stderr.slice(-300) || `Process exited with code ${code}`;
        resolve({
          success: false,
          output: "",
          error: errorText,
          sessionId: detectedSessionId || sessionId,
          durationMs,
        });
        return;
      }

      const { output, costUsd } = extractResult(events);
      if (isNew) sessionStore.confirmSession(userId);
      resolve({
        success: true,
        output: output || "",
        sessionId: detectedSessionId || sessionId,
        costUsd,
        durationMs,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        output: "",
        error: err.message,
        durationMs: Date.now() - startTime,
      });
    });
  });

  return { promise, child };
}
