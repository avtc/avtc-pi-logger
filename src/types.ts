// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Public types for avtc-pi-logger.
 *
 * Design: a {@link Logger} is a leveled, best-effort sink. Concrete loggers produced by
 * {@link createLogger} write to date-partitioned files under `~/.pi/logs/{name}/`; the
 * level/message contract is intentionally minimal so any pi extension can depend on it
 * without coupling to the file backend.
 */

/** Severity levels supported by every {@link Logger}. */
export type LogLevel = "info" | "warn" | "error" | "debug";

/**
 * Minimal leveled logger interface.
 * Implementations MUST be best-effort: a logging failure must never throw to the caller.
 *
 * `err` is required (pass {@link NO_ERROR} when absent) to enforce explicit caller intent —
 * matches the avtc-pi suite convention of required params over optional fallbacks.
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, err: unknown | null): void;
  debug(message: string): void;
  /**
   * Derive a scoped child logger that writes to the SAME destination, tagging each line
   * with the scope (dot-paths for nested children). The pino/bunyan idiom for per-module
   * logging without a second sink.
   */
  child(scope: string): Logger;
}

/** Sentinel passed to {@link Logger.error} when no error object is available. */
export const NO_ERROR: unknown = null;

/**
 * Options for {@link createLogger}.
 * All fields optional; sensible defaults are applied internally.
 */
export interface LoggerOptions {
  /** Root directory for all logs. Defaults to `~/.pi/logs`. */
  baseDir?: string;
  /** Enable DEBUG-level writes. Default: false (debug is suppressed unless requested). */
  debug?: boolean;
  /** Per-file size cap (bytes). When today's file exceeds it, it rolls to `.1`. Default: 5 MB. */
  maxFileBytes?: number;
  /** Delete day-files older than N days on each write. 0 = keep everything. Default: 14. */
  retentionDays?: number;
  /** Hard cap on a single message's byte length. Default: 10 KB. */
  maxMessageBytes?: number;
  /** Inject a custom clock (testing / fixed time). Default: real wall clock. */
  clock?: () => Date;
  /** Inject a custom home directory (used to derive the default baseDir). Default: os.homedir(). */
  homeDir?: string;
}

/** Default per-file size cap: 5 MB. */
export const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Default retention window: 2 days. */
export const DEFAULT_RETENTION_DAYS = 2;

/** Default single-message cap: 10 KB. */
export const DEFAULT_MAX_MESSAGE_BYTES = 10 * 1024;

/** Marker appended when a message is truncated. */
export const TRUNCATED_MARKER = "...(truncated)";
