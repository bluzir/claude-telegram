# claude-telegram

[![npm](https://img.shields.io/npm/v/claude-telegram)](https://www.npmjs.com/package/claude-telegram)

A simple and modular Telegram orchestrator on top of Claude Code CLI.

One npm package that connects a Telegram bot to Claude Code via `--resume` sessions, with whitelist access control and live activity status.

```bash
npm install -g claude-telegram
```

## claude-telegram vs OpenClaw

| | claude-telegram | [OpenClaw](https://github.com/openclaw/openclaw) |
|---|---|---|
| Core | ~1500 LOC, one dependency (grammY) | 50+ integrations, large codebase |
| Approach | Minimal orchestrator — Claude Code does the work | Full-featured AI assistant platform |
| Extensibility | Module system — add anything you need | Built-in, growing feature set |
| Control | You own the code, easy to audit and modify | Community-driven, fast-moving |
| Setup | `npx claude-telegram start` | Multi-step setup |

> Both are valid choices. claude-telegram is for those who prefer a small, predictable core that they extend themselves.

## Installation

**1. Get a server** — a VPS, a home PC, anything with internet access.

**2. Install Claude Code:**
```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**3. Install claude-telegram:**
```bash
npm install -g claude-telegram
```
Or run without installing via `npx claude-telegram`.

Alternatively, give Claude the link and let it handle everything:
```bash
claude "install claude-telegram from github.com/bluzir/claude-telegram and set it up for my Telegram bot"
```

## Quick Start

```bash
mkdir my-agent && cd my-agent
echo "You are a helpful assistant." > CLAUDE.md

cat > claude-telegram.yaml << 'EOF'
token: ${MY_BOT_TOKEN}
workspace: .
whitelist: [YOUR_USER_ID]
permission_mode: acceptEdits
EOF

export MY_BOT_TOKEN="123456:ABC-DEF..."
npx claude-telegram start
```

Don't know your Telegram user ID? Run `npx claude-telegram whoami` and send a message to the bot.

## Config

Create `claude-telegram.yaml` in your project root:

```yaml
token: ${TELEGRAM_BOT_TOKEN}        # env var interpolation
workspace: /path/to/workspace        # cwd for Claude CLI

# Who can use the bot (Telegram user IDs)
# Empty list = NO ONE (secure by default)
whitelist:
  - 16643982

# What Claude can do
# default | acceptEdits | bypassPermissions
permission_mode: acceptEdits

# --- Optional ---
# claude_path: /usr/local/bin/claude   # default: "claude" from PATH
# timeout: 300                          # seconds, default: 300
# model: sonnet                         # model override
# system_prompt: "Reply in Russian"     # injected into every call
# add_dirs:                             # additional dirs for Claude
#   - /path/to/shared/data
#
# --- Optional: multi-instance ---
# session_namespace: my-bot               # unique seed for session IDs (required when
#                                         # multiple bots share the same whitelist user)
#
# --- Optional: security/capabilities (advanced) ---
# disable_slash_commands: true            # disable Claude Code "skills" (slash commands)
# setting_sources: ["user", "project"]    # ignore local settings in workspace (".claude/settings.local.json")
# strict_mcp_config: true                 # disable MCP unless explicitly configured
# mcp_config:                             # MCP server configs (paths or JSON strings)
#   - ./mcp.json
#
# tools: ["Read", "Grep", "Glob"]         # restrict built-in tools ("" disables all tools)
# allowed_tools:                          # allowlist with optional patterns (e.g. Bash(git:*))
#   - "Read"
# disallowed_tools:                       # explicit denylist
#   - "Bash"

# modules:                              # optional plugin modules (loaded at startup)
#   - import: ./modules/voice.mjs       # resolved relative to `workspace`
#     options:
#       provider: openai
#   - import: claude-telegram-whoop-module
#     options:
#       client_id: ${WHOOP_CLIENT_ID}
```

Environment variables are interpolated with `${VAR_NAME}` syntax.

## Workspace

The `workspace` field in config is just the working directory (`cwd`) for Claude CLI. It can be any directory — claude-telegram doesn't care what's inside. Claude Code will use whatever `CLAUDE.md`, `.claude/agents/`, `.claude/skills/`, and other project files it finds there, exactly as it would in the terminal.

### Simple setup

The simplest workspace is a directory with just a `CLAUDE.md`:

```
my-agent/
├── CLAUDE.md                    # Instructions for Claude
├── claude-telegram.yaml         # Bot config
└── data/                        # Runtime data (auto-created)
```

### Using an existing project

Any project that works with Claude Code works with claude-telegram — just point `workspace` at it:

```bash
# Clone any project that has CLAUDE.md / .claude/ setup
git clone https://github.com/bluzir/claude-pipe
```

```yaml
# claude-telegram.yaml
token: ${MY_BOT_TOKEN}
workspace: ./claude-pipe/examples/research-pipeline
whitelist: [YOUR_USER_ID]
permission_mode: acceptEdits
```

Claude will see the project's `CLAUDE.md`, agents, skills, commands, MCP servers — everything. You don't need to copy or restructure anything.

### Multi-agent setup

Run multiple bots, each pointing to its own project:

```yaml
# researcher.yaml
token: ${RESEARCHER_BOT_TOKEN}
workspace: ./research-pipeline
whitelist: [YOUR_USER_ID]
permission_mode: acceptEdits
timeout: 600
system_prompt: "You are a research agent. Be thorough and cite sources."
add_dirs:
  - ./shared
```

```yaml
# assistant.yaml
token: ${ASSISTANT_BOT_TOKEN}
workspace: ./assistant
whitelist: [YOUR_USER_ID]
permission_mode: acceptEdits
```

```bash
npx claude-telegram start --config researcher.yaml
npx claude-telegram start --config assistant.yaml
```

Each bot gets its own workspace, sessions, and Telegram token. They share nothing unless you explicitly use `add_dirs`.

## Modules

You can extend the bot without bloating the core by adding optional modules that register extra handlers (voice/video, API integrations, etc.).

Module import rules:
- Relative paths are resolved against `workspace`
- Anything else is treated as a package specifier and resolved by Node
- Modules must export a default object or a default factory function

Minimal module example (`{workspace}/modules/hello.mjs`):

```js
export default function createModule() {
  return {
    name: "hello",
    commands: [{ command: "/hi", description: "Say hi" }],
    register({ bot, dispatchToClaude }) {
      bot.command("hi", async (ctx) => {
        await dispatchToClaude(ctx, "Say hi in one sentence.");
      });
    },
  };
}
```

### Hooks (memory, security, post-processing)

Modules can also hook into the request pipeline:

- `beforeClaude(ctx, message)` — deny or transform the user's message before it is sent to Claude
- `afterClaude(ctx, result)` — observe/transform Claude result before it is sent back to Telegram

Security example (deny messages containing a secret keyword):

```js
export default function createModule() {
  return {
    name: "security",
    async beforeClaude(ctx, message) {
      if (message.includes("OPENAI_API_KEY")) {
        return { action: "deny", reply: "Denied: looks like a secret." };
      }
      return { action: "continue" };
    },
  };
}
```

Memory-ish example (prepend extra context):

```js
export default function createModule() {
  return {
    name: "memory",
    async beforeClaude(ctx, message) {
      const extraContext = "Context: you are talking to the same user as before.";
      return { action: "continue", message: `${extraContext}\n\n${message}` };
    },
    async afterClaude(ctx, result) {
      // Store result.output somewhere if you want (file/db/vector store).
      return result;
    },
  };
}
```

## CLI

```bash
npx claude-telegram start                    # uses claude-telegram.yaml in CWD
npx claude-telegram start --config ./my.yaml # custom config path
npx claude-telegram check                    # validate config + claude CLI
npx claude-telegram whoami                   # get your Telegram user ID
```

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/cancel` | Stop current request |
| `/clear` | Reset conversation (new session) |
| `/help` | Show available commands |

## How It Works

- Each user gets a persistent Claude session via `--resume <sessionId>`
- Sessions survive bot restarts (stored in `~/.claude/` by Claude CLI)
- Session mapping stored in `{workspace}/data/.claude-telegram/sessions.json`
- Bot responds in private chats only (ignores group/supergroup/channel)
- One message at a time per user (concurrent messages get "Still working..." reply)
- Live activity status shows what Claude is doing (reading, editing, searching, etc.)
- Messages are split at 3800 chars and formatted as Telegram MarkdownV2

## Programmatic API

```typescript
import { createBot, loadConfig } from "claude-telegram";

// From config file
const config = loadConfig("./claude-telegram.yaml");

// Or build config directly
const bot = createBot({
  token: process.env.BOT_TOKEN!,
  workspace: "/path/to/workspace",
  whitelist: [16643982],
  permissionMode: "acceptEdits",
  claudePath: "claude",
  timeout: 300,
});

await bot.start();
```

## What's NOT Included

This is intentionally minimal. Not included:

- Voice/photo messages
- Multi-bot routing or gateway
- Approval system (use Claude CLI's `--permission-mode`)
- Budget tracking
- Web dashboard
- Queue system (one message at a time, extras are rejected)

Any of these can be added as a [module](#modules) without touching the core.

## Security

Basic security is built into the core — whitelist, permission modes, tool restrictions, MCP lockdown, error sanitization. See [SECURITY.md](SECURITY.md) for details.

For advanced security (sandboxing, DLP, audit logging, and more), check out **[Radius](https://github.com/bluzir/radius)**.

## License

MIT
