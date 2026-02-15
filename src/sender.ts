import type { Context } from "grammy";
import telegramifyMarkdown from "telegramify-markdown";

const TELEGRAM_CHUNK_LENGTH = 3800;

/**
 * Convert markdown tables to monospace text format.
 * Telegram doesn't support tables natively.
 */
function convertTables(text: string): string {
  const tableRegex = /(\|[^\n]+\|\n\|[-:\s|]+\|\n(?:\|[^\n]+\|\n?)+)/g;

  return text.replace(tableRegex, (table) => {
    const lines = table.trim().split("\n");
    if (lines.length < 2) return table;

    const rows = lines
      .filter((line) => !line.match(/^\|[-:\s|]+\|$/))
      .map((line) =>
        line
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim())
      );

    if (rows.length === 0) return table;

    const colWidths = rows[0].map((_, colIndex) =>
      Math.max(...rows.map((row) => (row[colIndex] || "").length))
    );

    const formattedRows = rows.map((row) =>
      row.map((cell, i) => cell.padEnd(colWidths[i])).join("  ")
    );

    return "```\n" + formattedRows.join("\n") + "\n```";
  });
}

/**
 * Convert markdown to Telegram MarkdownV2.
 */
function toTelegramMarkdown(text: string): string {
  try {
    const withTables = convertTables(text);
    return telegramifyMarkdown(withTables, "escape");
  } catch {
    // Fallback: escape all special characters
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
  }
}

/**
 * Split content into chunks that fit Telegram's 4096 char limit.
 */
function splitIntoChunks(
  content: string,
  maxLength: number = TELEGRAM_CHUNK_LENGTH
): string[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return ["(empty response)"];

  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n\n", maxLength);
    if (splitAt < Math.floor(maxLength * 0.5)) {
      splitAt = remaining.lastIndexOf("\n", maxLength);
    }
    if (splitAt < Math.floor(maxLength * 0.5)) {
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitAt <= 0) {
      splitAt = maxLength;
    }

    const chunk = remaining.slice(0, splitAt).trimEnd();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * Send a potentially long message, splitting into chunks
 * and formatting as MarkdownV2.
 */
export async function sendMessage(
  ctx: Context,
  text: string,
  options?: { footer?: string }
): Promise<void> {
  if (!text.trim()) {
    await ctx.reply("(empty response)");
    return;
  }

  const chunks = splitIntoChunks(text);
  const total = chunks.length;

  for (let i = 0; i < total; i++) {
    let chunk = chunks[i];

    // Chunk indicator when message is split into multiple parts
    if (total > 1) {
      chunk += `\n\n— ${i + 1}/${total} —`;
    }

    // Append footer to the last chunk
    if (options?.footer && i === total - 1) {
      chunk += `\n\n${options.footer}`;
    }

    const formatted = toTelegramMarkdown(chunk);
    try {
      await ctx.reply(formatted, { parse_mode: "MarkdownV2" });
    } catch {
      // Fallback to plain text if MarkdownV2 fails
      await ctx.reply(chunk);
    }
  }
}
