import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import type { BotConfig, RawConfig } from "./types.js";

const configSchema = z.object({
  token: z.string().min(1, "token is required"),
  workspace: z.string().min(1, "workspace is required"),
  whitelist: z.array(z.number()).default([]),
  permission_mode: z
    .enum([
      "default",
      "acceptEdits",
      "bypassPermissions",
      "delegate",
      "dontAsk",
      "plan",
    ])
    .default("acceptEdits"),
  claude_path: z.string().default("claude"),
  timeout: z.number().positive().default(300),
  model: z.string().optional(),
  system_prompt: z.string().optional(),
  add_dirs: z.array(z.string()).optional(),
  tools: z.union([z.string(), z.array(z.string())]).optional(),
  allowed_tools: z.array(z.string()).optional(),
  disallowed_tools: z.array(z.string()).optional(),
  disable_slash_commands: z.boolean().optional(),
  setting_sources: z
    .union([
      z.string(),
      z.array(z.enum(["user", "project", "local"])),
    ])
    .optional(),
  strict_mcp_config: z.boolean().optional(),
  mcp_config: z.array(z.string()).optional(),
  modules: z
    .array(
      z.union([
        z.string(),
        z.object({
          import: z.string().min(1, "modules[].import is required"),
          enabled: z.boolean().optional(),
          options: z.record(z.unknown()).optional(),
        }),
      ])
    )
    .optional(),
});

/**
 * Interpolate ${ENV_VAR} references in a string.
 */
function interpolateEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => {
    const val = process.env[name];
    if (val === undefined) {
      throw new Error(`Environment variable ${name} is not set`);
    }
    return val;
  });
}

/**
 * Recursively interpolate env vars in all string values.
 */
function interpolateDeep(obj: unknown): unknown {
  if (typeof obj === "string") return interpolateEnv(obj);
  if (Array.isArray(obj)) return obj.map(interpolateDeep);
  if (obj !== null && typeof obj === "object") {
    // Use a null-prototype object to avoid prototype pollution via "__proto__".
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = interpolateDeep(value);
    }
    return result;
  }
  return obj;
}

/**
 * Load and validate config from a YAML file.
 */
export function loadConfig(configPath?: string): BotConfig {
  const resolvedPath = configPath
    ? resolve(configPath)
    : resolve("claude-telegram.yaml");

  if (!existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  const raw = readFileSync(resolvedPath, "utf-8");
  // Restrict YAML features to JSON-compatible types to avoid surprises from tags.
  const parsed = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as RawConfig;
  const interpolated = interpolateDeep(parsed) as RawConfig;
  const validated = configSchema.parse(interpolated);

  const workspace = resolve(validated.workspace);
  if (!existsSync(workspace)) {
    throw new Error(`Workspace directory does not exist: ${workspace}`);
  }

  return {
    token: validated.token,
    workspace,
    whitelist: validated.whitelist,
    permissionMode: validated.permission_mode,
    claudePath: validated.claude_path,
    timeout: validated.timeout,
    model: validated.model,
    systemPrompt: validated.system_prompt,
    addDirs: validated.add_dirs?.map((d) => resolve(d)),
    modules: validated.modules,
    tools:
      validated.tools === undefined
        ? undefined
        : Array.isArray(validated.tools)
          ? validated.tools
          : [validated.tools],
    allowedTools: validated.allowed_tools,
    disallowedTools: validated.disallowed_tools,
    disableSlashCommands: validated.disable_slash_commands,
    settingSources: Array.isArray(validated.setting_sources)
      ? validated.setting_sources.join(",")
      : validated.setting_sources,
    strictMcpConfig: validated.strict_mcp_config,
    mcpConfig: validated.mcp_config,
  };
}
