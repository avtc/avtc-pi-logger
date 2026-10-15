// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>
/**
 * Pure message-formatting helpers (SRP: formatting is independent of I/O).
 * No Node APIs: byte counting is hand-rolled UTF-8 so the module loads in
 * any environment (the mods hooks env has no Buffer).
 */
import { TRUNCATED_MARKER } from "./types.js";
/**
 * UTF-8 byte length of a string without Node's Buffer. Counts continuation
 * bytes per code point; lone surrogates encode as 3 bytes (WTF-8), matching
 * Buffer for the strings a log line can carry.
 */
export function utf8ByteLength(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      // surrogate pair -> one 4-byte code point
      i += 1;
      bytes += 4;
    } else {
      // lone surrogate or BMP -> 3 bytes
      bytes += 3;
    }
  }
  return bytes;
}
/**
 * Compact second-precision UTC timestamp, e.g. `2026-06-20T13:37:45`.
 * Milliseconds + trailing `Z` are stripped to keep log lines short.
 */
export function formatTimestamp(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "");
}
/**
 * Render an unknown error value as a single-line suffix (no trailing
 * newline). `err.stack` when present, else name/message, else String().
 * `instanceof Error` is avoided: cross-realm error objects (the host's
 * errors inside a mod) would fall to the string branch otherwise.
 */
export function formatError(err) {
  if (typeof err === "object" && err !== null && "stack" in err && typeof err.stack === "string") {
    return err.stack;
  }
  if (typeof err === "object" && err !== null && "message" in err) {
    const e = err;
    const name = typeof e.name === "string" ? e.name : "Error";
    return typeof e.message === "string" ? `${name}: ${e.message}` : String(err);
  }
  return String(err);
}
/**
 * Collapse line-breaking + other C0 control chars and DEL to single spaces so an emitted log
 * record can never be forged into extra log lines (log injection). Carriage return, line feed,
 * tab, NUL and other controls all become a space; printable text (incl. the truncation marker)
 * is preserved. Pure helper — no I/O.
 */
export function sanitizeForLine(message) {
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
export function truncateMessage(message, maxBytes) {
  if (utf8ByteLength(message) <= maxBytes) return message;
  // Reserve space for the marker; slice by characters then trim back under the byte cap.
  const budget = Math.max(0, maxBytes - utf8ByteLength(TRUNCATED_MARKER));
  let sliced = message.slice(0, budget);
  while (utf8ByteLength(sliced) > budget) {
    sliced = sliced.slice(0, -1);
  }
  return sliced + TRUNCATED_MARKER;
}
