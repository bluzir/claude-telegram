import { execFileSync } from "node:child_process";
import { loadConfig } from "./config.js";

export function runCheck(configPath?: string): void {
  console.log("[check] Validating config...");

  let config;
  try {
    config = loadConfig(configPath);
    console.log(`  ✓ Config loaded`);
    console.log(`  ✓ Workspace: ${config.workspace}`);
    if (config.whitelist.length === 0) {
      console.log(`  ⚠ Whitelist: empty (no one can use the bot)`);
    } else {
      console.log(
        `  ✓ Whitelist: ${config.whitelist.length} user(s)`
      );
    }
    console.log(`  ✓ Permission mode: ${config.permissionMode}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ Config error: ${msg}`);
    throw new Error(msg);
  }

  // Check Claude CLI
  try {
    const version = execFileSync(config.claudePath, ["--version"], {
      encoding: "utf-8",
    }).trim();
    console.log(`  ✓ Claude CLI: ${version}`);
  } catch {
    const msg = `Claude CLI not found or not executable: ${config.claudePath}`;
    console.error(`  ✗ ${msg}`);
    throw new Error(msg);
  }

  // Sanity-check required flags used by this package (no API calls).
  let help: string;
  try {
    help = execFileSync(config.claudePath, ["--help"], {
      encoding: "utf-8",
    });
  } catch {
    const msg = "Failed to validate Claude CLI help output";
    console.error(`  ✗ ${msg}`);
    throw new Error(msg);
  }

  const required = [
    "--output-format",
    "stream-json",
    "--permission-mode",
    "--resume",
    "--session-id",
  ];
  const missing = required.filter((s) => !help.includes(s));
  if (missing.length > 0) {
    const msg = `Claude CLI is missing required flags: ${missing.join(", ")}`;
    console.error(`  ✗ ${msg}`);
    throw new Error(msg);
  }
  console.log("  ✓ Claude CLI flags look compatible");

  console.log("\nAll checks passed.");
}
