import { spawn, type ChildProcess } from "node:child_process";
import type { BotConfig, ClaudeResult, StreamJsonEvent } from "./types.js";
import type { SessionStore } from "./session.js";
import { killProcessTree } from "./shutdown.js";

export interface RunClaudeOptions {
  config: BotConfig;
  sessionStore: SessionStore;
  /**
   * Conversation identity used to key the Claude session. In private chats
   * this is the user ID; in group chats it is the (negative) chat ID so the
   * whole group shares one conversation.
   */
  sessionKey: number;
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

  if (config.effort) {
    args.push("--effort", config.effort);
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
 * Collect assistant text blocks streamed so far. Serves both as the result
 * fallback and as the partial answer surfaced when a run is interrupted.
 */
function collectAssistantText(events: StreamJsonEvent[]): string {
  const texts: string[] = [];
  for (const event of events) {
    if (event.type === "assistant" && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === "text" && block.text) texts.push(block.text);
      }
    }
  }
  return texts.join("\n");
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

  // Fallback: collect streamed assistant text.
  return { output: collectAssistantText(events) };
}

/**
 * Run Claude CLI as a subprocess with stream-json parsing.
 */
export function runClaude(options: RunClaudeOptions): {
  promise: Promise<ClaudeResult>;
  child: ChildProcess;
} {
  const { config, sessionStore, sessionKey, message, onEvent } = options;
  const { sessionId, isNew } = sessionStore.getSession(sessionKey);
  const args = buildArgs(config, sessionId, isNew, message);

  const child = spawn(config.claudePath, args, {
    cwd: config.workspace,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group so a stop/timeout can kill Claude together with the
    // MCP servers it spawns (see killProcessTree). Without this, killing only
    // Claude's PID orphans the MCP children — they leak and keep the session
    // locked.
    detached: true,
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
      killProcessTree(child, "SIGTERM");
      setTimeout(() => {
        if (!child.killed) killProcessTree(child, "SIGKILL");
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
            // The CLI has now created the session on disk, so the next run must
            // --resume it and must never pass --session-id again. Confirm here
            // rather than on a successful close: a run interrupted by the stop
            // button, /cancel or the timeout leaves the session file behind,
            // and a retry with --session-id then fails with "Session ID … is
            // already in use" — permanently, since nothing clears the flag.
            if (isNew) sessionStore.confirmSession(sessionKey);
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

      // Assistant text captured so far — surfaced as a partial answer when the
      // run was interrupted (external stop / timeout / non-zero exit).
      const partialOutput = collectAssistantText(events);

      if (killed) {
        resolve({
          success: false,
          output: "",
          error: `Claude took too long (>${Math.floor(config.timeout / 60)}min). Try a simpler request or send again.`,
          sessionId: detectedSessionId || sessionId,
          durationMs,
          partialOutput,
        });
        return;
      }

      // Session couldn't be resumed — drop it and let the next message start
      // fresh. Covers a lost/expired session ("not found", ENOENT) and a
      // session still locked by a previous run ("already in use"), e.g. after a
      // hard stop. Case-insensitive: the CLI prints "Session ID … is already in
      // use" with a capital S.
      const stderr = stderrChunks.join("");
      const stderrLc = stderr.toLowerCase();
      // A locked session must be rotated even on an `isNew` run: the id is
      // already taken on disk, so retrying it would fail the same way forever.
      const sessionLocked = stderrLc.includes("already in use");
      const sessionLost =
        stderrLc.includes("session") ||
        stderrLc.includes("not found") ||
        stderrLc.includes("enoent");
      if (code !== 0 && (sessionLocked || (!isNew && sessionLost))) {
        // Session lost or locked — refresh and let caller retry or handle
        sessionStore.refreshSession(sessionKey);
        resolve({
          success: false,
          output: "",
          error: "Conversation couldn't be restored (session was busy or expired). Send your message again to start fresh.",
          sessionId: detectedSessionId || sessionId,
          durationMs,
          partialOutput,
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
          partialOutput,
        });
        return;
      }

      const { output, costUsd } = extractResult(events);
      if (isNew) sessionStore.confirmSession(sessionKey);
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
