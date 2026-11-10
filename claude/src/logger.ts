// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { formatError, formatTimestamp, sanitizeForLine, truncateMessage } from "./format.js";
import { getDefaultBackend } from "./fs-adapter.js";
import { SlotRingWriter } from "./slot-writer.js";
import {
  DEFAULT_BUFFER_MS,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_MESSAGE_BYTES,
  DEFAULT_SLOT_COUNT,
  type Logger,
  type LoggerOptions,
  type LogLevel,
  MAX_FILE_BYTES_CEILING,
} from "./types.js";

/** Shared write + format context; root and child loggers reuse one writer. */
interface EmitContext {
  writer: SlotRingWriter;
  clock: () => Date;
  maxMessageBytes: number;
  debug: boolean;
}

/**
 * Build a {@link Logger} that writes through {@link ctx} with an optional {@link scopeTag}.
 * A child logger (non-empty tag) prefixes each line with `[scope]`; the root logger omits it.
 * Children share their parent's writer, so all scopes land in the same ring.
 */
/** Root logger scope tag: empty string = no `[scope]` prefix on log lines. */
const NO_SCOPE_TAG = "";

/** The writer behind each created logger, for {@link flushLogger} (drain points + tests). */
const writers = new WeakMap<Logger, SlotRingWriter>();

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
      // emit() sanitizes the combined message once, suffix included
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
 * Create a {@link Logger} that writes leveled records into the slot ring
 * `<baseDir>/<name>-<slot>.log`. The returned logger is best-effort: it
 * never throws.
 *
 * Destination resolution: explicit `options.backend`/`options.baseDir` win;
 * otherwise the host-installed default backend supplies both. With neither
 * present the call throws (a wiring bug — the host must install the backend
 * before any logger is created), surfacing at wiring time rather than
 * silently dropping every line.
 *
 * Use {@link Logger.child} to derive scoped loggers that tag lines without a
 * second ring.
 */
export function createLogger(name: string, options: LoggerOptions | null): Logger {
  const fallback = getDefaultBackend();
  const baseDir = options?.baseDir ?? fallback?.baseDir;
  const backend = options?.backend ?? fallback?.adapter;
  if (baseDir === undefined || backend === undefined) {
    throw new Error(
      "avtc-claude-logger: no destination — pass options.baseDir/backend or install the host default via setDefaultBackend",
    );
  }
  const debug = options?.debug ?? false;
  const maxFileBytes = Math.min(options?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES, MAX_FILE_BYTES_CEILING);
  const slotCount = options?.slotCount ?? DEFAULT_SLOT_COUNT;
  const maxMessageBytes = options?.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  const clock = options?.clock ?? (() => new Date());
  const bufferMs = options?.bufferMs ?? DEFAULT_BUFFER_MS;
  const schedule = options?.schedule ?? fallback?.schedule ?? null;

  const writer = new SlotRingWriter({ baseDir, name, slotCount, maxFileBytes, bufferMs, schedule, backend });
  const ctx: EmitContext = { writer, clock, maxMessageBytes, debug };
  const logger = makeLogger(ctx, NO_SCOPE_TAG);
  writers.set(logger, writer);
  return logger;
}

/** Wait until a logger's queued lines are on disk (drain points + tests). */
export function flushLogger(logger: Logger): Promise<void> {
  const writer = writers.get(logger);
  return writer ? writer.flush() : Promise.resolve();
}
