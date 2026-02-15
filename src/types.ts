import type { ChildProcess } from "node:child_process";

export type ModuleConfig =
  | string
  | {
      import: string;
      enabled?: boolean;
      options?: Record<string, unknown>;
    };

export interface BotConfig {
  token: string;
  workspace: string;
  whitelist: number[];
  permissionMode:
    | "default"
    | "acceptEdits"
    | "bypassPermissions"
    | "delegate"
    | "dontAsk"
    | "plan";
  claudePath: string;
  timeout: number;
  model?: string;
  systemPrompt?: string;
  addDirs?: string[];
  modules?: ModuleConfig[];

  // Security / capability controls (forwarded to Claude Code CLI).
  tools?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  disableSlashCommands?: boolean;
  settingSources?: string; // e.g. "user,project"
  strictMcpConfig?: boolean;
  mcpConfig?: string[];
}

export interface RawConfig {
  token: string;
  workspace: string;
  whitelist?: number[];
  permission_mode?:
    | "default"
    | "acceptEdits"
    | "bypassPermissions"
    | "delegate"
    | "dontAsk"
    | "plan";
  claude_path?: string;
  timeout?: number;
  model?: string;
  system_prompt?: string;
  add_dirs?: string[];
  modules?: ModuleConfig[];

  tools?: string | string[];
  allowed_tools?: string[];
  disallowed_tools?: string[];
  disable_slash_commands?: boolean;
  setting_sources?: string | Array<"user" | "project" | "local">;
  strict_mcp_config?: boolean;
  mcp_config?: string[];
}

export interface ClaudeResult {
  success: boolean;
  output: string;
  error?: string;
  sessionId?: string;
  costUsd?: number;
  durationMs: number;
}

export interface ClaudeProcess {
  child: ChildProcess;
  userId: number;
  startTime: number;
}

export type ActivityKey =
  | "thinking"
  | "reading"
  | "editing"
  | "writing"
  | "searching"
  | "command"
  | "web"
  | "subagent"
  | "mcp";

export interface StreamJsonEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  result?: string;
  total_cost_usd?: number;
  message?: {
    content?: Array<{
      type: string;
      name?: string;
      text?: string;
    }>;
  };
}
