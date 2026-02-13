# claude-telegram

A simple and modular Telegram orchestrator on top of Claude Code CLI.

One npm package that connects a Telegram bot to Claude Code via `--resume` sessions, with whitelist access control and live activity status.

## Why not OpenClaw (and why you shouldn't either)

[OpenClaw](https://github.com/openclaw/openclaw) is an open-source personal AI assistant with Telegram, Discord, Slack and 50+ integrations. A great starting point.

**Some numbers**: over the last 7 days, OpenClaw's main branch received an average of 90 commits per day. On the peak day — 67,000 lines of code.

This is a massive success in terms of turning ideas into reality and shipping progress. But it's maximally unstable for a system you want to trust with your life.

Ask yourself:
- Do I know what changes are landing there?
- What will land next week?
- What's the goal, and how aligned are all the contributors to that goal?
- Do I need all those features?
- How do I add my own changes, and are they aligned with the rest of the system?

It's fine that there are no answers right now — not from you, not from OpenClaw. These are growing pains of a young project, and some of them will definitely get fixed.

**This project takes a different approach.** claude-telegram has been in development for several months as its own orchestration system. Instead of competing with OpenClaw head-on, the best mechanics and architectures were taken from their repo and made part of this system — while keeping control. A daily task monitors OpenClaw updates to continuously adopt the best ideas.

**The philosophy**: we live in a world where the cost of replication approaches zero. The most effective strategy is not to be the innovator who invests in finding solutions, but to quickly find and adopt others' best practices into your own system that you control.

OpenClaw is a great starting point, and it's perfectly fine to begin there with all due precautions. But: too large a repo, unclear who, unclear where.

## Installation

**1. Get a server** — a VPS, a home PC, anything with internet access.

**2. Install Claude Code:**
```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**3. Give Claude the link and ask it to install:**
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

## License

MIT
