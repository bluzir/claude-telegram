# Security Notes

This project bridges Telegram to **Claude Code CLI** by spawning `claude` on the host machine. It is intentionally minimal and **does not provide a hard sandbox** (e.g. Docker/VM). Treat it like remote-control for your workstation/server.

## Threat Model (Prompt / Skill Injection)

Primary risks come from **prompt injection** (malicious text telling the model to ignore policies) and **skill injection** (malicious instructions living in workspace files like `CLAUDE.md`, `.claude/skills/`, agents, plugins, MCP configs).

Because `claude-telegram` runs Claude Code in **non-interactive `-p/--print` mode**, you should assume:

- The CLI "workspace trust" prompt is skipped. Only use trusted workspaces.
- If dangerous tools are enabled, injected instructions can attempt to read files, modify files, run commands, or exfiltrate data.

## Security Boundaries

- **Telegram whitelist** is the first boundary. A compromised whitelisted account is equivalent to full bot access.
- **Workspace** is a trust root. Untrusted repos can contain agent/skill instructions that change behavior.
- **Modules** are arbitrary JS loaded via dynamic `import()`. Only load trusted modules.
- **Claude Code tools** are the main capability surface: `Bash`, `Edit/Write`, `WebFetch/WebSearch`, MCP tools, etc.

## Recommended Mitigations (Defense In Depth)

1. **Least privilege tools**
   - Use `tools` to restrict built-in tools.
   - Use `allowed_tools` / `disallowed_tools` to further constrain capabilities (including patterns like `Bash(git:*)`).
2. **Disable skills (slash commands)**
   - Set `disable_slash_commands: true` to reduce exposure to skill-driven behavior.
3. **Control settings sources**
   - Use `setting_sources: ["user", "project"]` to ignore workspace-local settings (e.g. `.claude/settings.local.json`) if you do not rely on them.
4. **Lock down MCP**
   - Set `strict_mcp_config: true` and provide `mcp_config` explicitly if you want MCP at all; otherwise keep it disabled.
5. **Operational hardening**
   - Run the bot under a dedicated OS user with minimal permissions.
   - Keep secrets out of the workspace; do not export extra tokens in the bot process environment.
   - Keep `modules` empty unless you fully trust what you load.

## Example "Safer" Config Profiles

### Chat-only (no tools)

```yaml
permission_mode: default
tools: ""                       # disables all tools
disable_slash_commands: true
strict_mcp_config: true
```

### Read-only workspace helper

```yaml
permission_mode: default
tools: ["Read", "Grep", "Glob"]
disable_slash_commands: true
strict_mcp_config: true
```

## Non-Goals

- A container-grade sandbox is not implemented in this repo.
- If you need hard isolation, run the bot inside your preferred sandboxing solution at the OS level (VM, container, system service restrictions).

