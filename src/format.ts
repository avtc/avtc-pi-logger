// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { TRUNCATED_MARKER } from "./types.js";

/**
 * Pure message-formatting helpers (SRP: formatting is independent of I/O).
 */

/**
 * Compact second-precision UTC timestamp, e.g. `2026-06-20T13:37:45`.
 * Milliseconds + trailing `Z` are stripped to keep log lines short.
 */
export function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "");
}

/** Render an unknown error value as a single-line suffix (no trailing newline). */
export function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? `${err.name}: ${err.message}`;
  }
  return String(err);
}

/**
 * Collapse line-breaking + other C0 control chars and DEL to single spaces so an emitted log
 * record can never be forged into extra log lines (log injection). Carriage return, line feed,
 * tab, NUL and other controls all become a space; printable text (incl. the truncation marker)
 * is preserved. Pure helper — no I/O.
 */
export function sanitizeForLine(message: string): string {
  let out = "";
  for (const ch of message) {
    const code = ch.charCodeAt(0);
    out += code < 32 || code === 127 ? " " : ch; // C0 controls + DEL → space
  }
  return out;
}

/**
 * Truncate a message to at most `maxBytes` UTF-8 bytes, appending {@link TRUNCATED_MARKER}
 * when shortened. Returns the original string unchanged if within the cap.
 */
export function truncateMessage(message: string, maxBytes: number): string {
  if (Buffer.byteLength(message, "utf-8") <= maxBytes) return message;
  // Reserve space for the marker; slice by characters then trim back under the byte cap.
  const budget = Math.max(0, maxBytes - Buffer.byteLength(TRUNCATED_MARKER, "utf-8"));
  let sliced = message.slice(0, budget);
  while (Buffer.byteLength(sliced, "utf-8") > budget) {
    sliced = sliced.slice(0, -1);
  }
  return sliced + TRUNCATED_MARKER;
}
