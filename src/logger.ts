// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { formatError, formatTimestamp, sanitizeForLine, truncateMessage } from "./format.js";
import { resolveBaseDir } from "./paths.js";
import {
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_MESSAGE_BYTES,
  DEFAULT_RETENTION_DAYS,
  type Logger,
  type LoggerOptions,
  type LogLevel,
} from "./types.js";
import { LogWriter } from "./writer.js";

/** Shared write + format context; root and child loggers reuse one writer/sink. */
interface EmitContext {
  writer: LogWriter;
  clock: () => Date;
  maxMessageBytes: number;
  debug: boolean;
}

/**
 * Build a {@link Logger} that writes through {@link ctx} with an optional {@link scopeTag}.
 * A child logger (non-empty tag) prefixes each line with `[scope]`; the root logger omits it.
 * Children share their parent's writer, so all scopes land in the same day file.
 */
/** Root logger scope tag: empty string = no `[scope]` prefix on log lines. */
const NO_SCOPE_TAG = "";

function makeLogger(ctx: EmitContext, scopeTag: string): Logger {
  function emit(level: LogLevel, message: string): void {
    const tag = scopeTag ? `[${scopeTag}] ` : "";
    // Sanitize FIRST: an embedded newline in `message` would forge extra log lines (log injection).
    // Every record stays a single line regardless of what a caller interpolates.
    const safe = sanitizeForLine(message);
    const line = `${formatTimestamp(ctx.clock())} [${level.toUpperCase()}] ${tag}${truncateMessage(safe, ctx.maxMessageBytes)}\n`;
    ctx.writer.writeLine(line, ctx.clock());
  }

  return {
    info(message: string): void {
      emit("info", message);
    },
    warn(message: string): void {
      emit("warn", message);
    },
    error(message: string, err: unknown | null): void {
      const suffix = err ? ` — ${formatError(err)}` : "";
      emit("error", message + suffix);
    },
    debug(message: string): void {
      if (!ctx.debug) return;
      emit("debug", message);
    },
    child(scope: string): Logger {
      const nextTag = scopeTag ? `${scopeTag}.${scope}` : scope;
      return makeLogger(ctx, nextTag);
    },
  };
}

/**
 * Create a {@link Logger} that writes leveled, date-partitioned files under
 * `<baseDir>/<name>/<YYYY-MM-DD>.log`. The returned logger is best-effort: it never throws.
 *
 * Composes a {@link LogWriter} (file lifecycle) with level/option resolution (facade) —
 * the caller depends only on the {@link Logger} contract, not the file backend.
 * Use {@link Logger.child} to derive scoped loggers that tag lines without a second sink.
 */
export function createLogger(name: string, options: LoggerOptions | null): Logger {
  // Base directory precedence: explicit option > PI_LOGGER_DIR env override > default ~/.pi/logs.
  // The env override lets tests redirect all logs to a temp dir globally (no per-file mocks),
  // and lets a user relocate logs without code changes.
  const baseDir = options?.baseDir ?? process.env.PI_LOGGER_DIR ?? resolveBaseDir(options?.homeDir ?? null);
  const debug = options?.debug ?? false;
  const maxFileBytes = options?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const retentionDays = options?.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const maxMessageBytes = options?.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  const clock = options?.clock ?? (() => new Date());

  const writer = new LogWriter({ baseDir, name, maxFileBytes, retentionDays });
  const ctx: EmitContext = { writer, clock, maxMessageBytes, debug };
  return makeLogger(ctx, NO_SCOPE_TAG);
}
