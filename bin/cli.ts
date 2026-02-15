#!/usr/bin/env node

import { loadConfig } from "../src/config.js";
import { startBot } from "../src/bot.js";
import { runInit } from "../src/init.js";
import { runCheck } from "../src/check.js";
import { Bot } from "grammy";

const args = process.argv.slice(2);
const command = args[0];

function getConfigPath(): string | undefined {
  const configIdx = args.indexOf("--config");
  if (configIdx !== -1 && args[configIdx + 1]) {
    return args[configIdx + 1];
  }
  return undefined;
}

async function cmdStart() {
  const config = loadConfig(getConfigPath());
  await startBot(config);
}

function cmdCheck() {
  try {
    runCheck(getConfigPath());
  } catch {
    process.exit(1);
  }
}

async function cmdInit() {
  const target = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
  await runInit(target);
}

async function cmdWhoami() {
  // Determine token: from --config or env
  let token: string | undefined;

  try {
    const config = loadConfig(getConfigPath());
    token = config.token;
  } catch {
    // If no config, try env directly
    token = process.env.TELEGRAM_BOT_TOKEN;
  }

  if (!token) {
    console.error(
      "No bot token found. Provide a config file or set TELEGRAM_BOT_TOKEN."
    );
    process.exit(1);
  }

  const bot = new Bot(token);
  const timeoutMs = 5 * 60 * 1000;
  let done = false;
  const timer = setTimeout(() => {
    if (done) return;
    done = true;
    console.error(
      `[whoami] Timed out after ${Math.round(timeoutMs / 1000)}s (no message received).`
    );
    process.exitCode = 1;
    bot.stop();
  }, timeoutMs);

  bot.on("message", async (ctx) => {
    if (done) return;
    if (ctx.chat?.type !== "private") {
      try {
        await ctx.reply("Please message me in a private chat.");
      } catch {
        // Ignore
      }
      return;
    }

    done = true;
    clearTimeout(timer);

    const userId = ctx.from?.id;
    const username = ctx.from?.username || "(no username)";
    const name =
      [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") ||
      "(no name)";

    await ctx.reply(
      `Your Telegram info:\n\n` +
        `User ID: ${userId}\n` +
        `Username: @${username}\n` +
        `Name: ${name}\n\n` +
        `Add ${userId} to your whitelist config.`
    );

    bot.stop();
  });

  console.log("[whoami] Bot started. Send any message to get your user ID.");
  console.log("[whoami] Will stop after the first private message.");
  console.log(`[whoami] Timeout: ${Math.round(timeoutMs / 60000)} minutes.\n`);
  console.log("[whoami] Press Ctrl+C to stop.\n");

  try {
    await bot.start();
  } finally {
    clearTimeout(timer);
  }
}

// --- Main ---
switch (command) {
  case "start":
    cmdStart().catch((err) => {
      console.error("Fatal:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
    break;

  case "init":
    cmdInit().catch((err) => {
      console.error("Fatal:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
    break;

  case "check":
    cmdCheck();
    break;

  case "whoami":
    cmdWhoami().catch((err) => {
      console.error("Fatal:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
    break;

  default:
    console.log(`claude-telegram — Telegram bot for Claude Code CLI

Usage:
  claude-telegram init [directory]       Create a new workspace with config & examples
  claude-telegram start [--config path]  Start the bot
  claude-telegram check [--config path]  Validate config & dependencies
  claude-telegram whoami                 Get your Telegram user ID
`);
    if (command && command !== "help" && command !== "--help") {
      process.exit(1);
    }
    break;
}
