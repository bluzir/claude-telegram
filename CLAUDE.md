# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
npm run build          # Compile TypeScript → dist/
npm run typecheck      # Type-check without emitting
npm run dev            # Watch mode with tsx
npm start              # Run: node dist/bin/cli.js start
```

No test suite exists yet. Validate changes with `npm run typecheck`.

## Architecture

Telegram bot orchestrator that bridges Telegram users to Claude Code CLI via persistent `--resume` sessions. Built on [grammY](https://grammy.dev/) (Telegram framework) and spawns Claude CLI as child processes with `--output-format stream-json`.

### Request Flow

1. Grammy bot receives a Telegram message
2. Middleware chain: private-chat-only filter → whitelist access control
3. Concurrency guard ensures one active request per user
4. `dispatchToClaude()` sends a placeholder status message, then spawns `claude` CLI
5. `claude.ts` parses stream-json events from stdout, feeding them to the activity tracker
6. `activity.ts` edits the Telegram status message every 3s with current tool activity + elapsed time
7. On completion, status message is deleted and response is sent via `sender.ts` (MarkdownV2, chunked at 3800 chars)

### Key Files

- **`src/bot.ts`** — Bot creation, middleware, commands (`/cancel`, `/clear`), `dispatchToClaude()`, job tracking (`busy` set + `running` map)
- **`src/claude.ts`** — Spawns Claude CLI subprocess, builds args (resume vs new session), parses stream-json, handles timeout/session-not-found
- **`src/config.ts`** — YAML config loader with `${ENV_VAR}` interpolation and Zod validation
- **`src/session.ts`** — JSON-file session store mapping userId → sessionId (UUIDv5 for deterministic, UUIDv4 on reset). Persists to `{workspace}/data/.claude-telegram/sessions.json`
- **`src/sender.ts`** — Markdown → Telegram MarkdownV2 conversion, table-to-monospace, smart chunking (paragraph → line → word breaks)
- **`src/activity.ts`** — 3s interval timer that maps tool_use events to emoji labels and edits the Telegram status message
- **`src/modules.ts`** — Dynamic module loader. Resolves file paths relative to workspace, packages via Node. Module lifecycle: `register()` → `init()` → `dispose()`
- **`src/shutdown.ts`** — ProcessTracker for child processes, graceful SIGINT/SIGTERM handling with 30s timeout
- **`bin/cli.ts`** — CLI commands: `start`, `check`, `whoami`

### Config (snake_case) vs Code (camelCase)

YAML config uses `snake_case` (`permission_mode`, `claude_path`, `system_prompt`, `add_dirs`). These are normalized to `camelCase` in `BotConfig` by `config.ts`. The `RawConfig` type matches the YAML shape; `BotConfig` is the internal interface.

### Module System

Modules extend the bot without modifying core. They receive `ModuleContext` (`bot`, `config`, `sessionStore`, `dispatchToClaude`) and can register Grammy handlers. Module exports are resolved flexibly: `default`, `module`, `createModule`, `create`, or the namespace itself. Factory functions receive `options` from config.

## Project Conventions

- ESM-only (`"type": "module"` in package.json, `NodeNext` module resolution)
- All internal imports use `.js` extension (required for NodeNext)
- Library exports from `src/index.ts`, CLI entry at `bin/cli.ts`
- Error handling pattern: try/catch with empty catch blocks for non-critical Telegram API failures (message edits, deletes)
- Console logging prefixed with `[claude-telegram]`
