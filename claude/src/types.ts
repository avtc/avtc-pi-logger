// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Public types for avtc-claude-logger.
 *
 * The {@link Logger} contract matches the pi sibling (avtc-pi-logger) so
 * consumers port unchanged; the FILE backend differs: the mods environment
 * has no Node fs (no rename, no unlink, no append), so logs land in a
 * bounded round-robin slot ring `<baseDir>/<name>/<slot>.log`, written as
 * whole-file rewrites through an injected {@link LogFsAdapter}.
 */

/** Severity levels supported by every {@link Logger}. */
export type LogLevel = "info" | "warn" | "error" | "debug";

/**
 * Minimal leveled logger interface.
 * Implementations MUST be best-effort: a logging failure must never throw to the caller.
 *
 * `err` is required (pass {@link NO_ERROR} when absent) to enforce explicit caller intent —
 * matches the avtc suite convention of required params over optional fallbacks.
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
 * The fs surface the slot-ring writer needs, injected by the host (the mods
 * `$.fs` adapter, or a Node fs shim in tests/tools). Shapes mirror the mods
 * fs noun: whole-file writes, listing with metadata, stat of one path.
 */
export interface LogFsAdapter {
  /** Read a file's full text. Rejects when the path does not exist. */
  read(path: string): Promise<string>;
  /** Write a file's full text (REPLACES the file when it exists). */
  write(path: string, text: string): Promise<void>;
  /** List a directory: `{ name, kind, size, mtimeMs }` per entry. */
  list(dir: string): Promise<ReadonlyArray<{ name: string; kind: string; size: number; mtimeMs: number }>>;
}

/**
 * Options for {@link createLogger}.
 * All fields optional; sensible defaults are applied internally.
 */
export interface LoggerOptions {
  /** Root directory for this logger's slot files. Default: the injected default baseDir. */
  baseDir?: string;
  /** Enable DEBUG-level writes. Default: false (debug is suppressed unless requested). */
  debug?: boolean;
  /**
   * Per-slot size cap (bytes). When the current slot exceeds it, the ring advances.
   * Default: 2 MiB. Capped at {@link MAX_FILE_BYTES_CEILING} — the host fs rejects
   * reads over 4 MiB, so a slot file beyond the ceiling could never be read
   * back for the ring's read-modify-write appends.
   */
  maxFileBytes?: number;
  /**
   * Slot count K of the ring (0..K-1); advancing past K-1 wraps to 0, overwriting the
   * oldest slot. Retention is the ring itself: total bytes bounded by K x maxFileBytes.
   * Default: 2.
   */
  slotCount?: number;
  /** Hard cap on a single message's byte length. Default: 10 KB. */
  maxMessageBytes?: number;
  /** Inject a custom clock (testing / fixed time). Default: real wall clock. */
  clock?: () => Date;
  /**
   * The fs adapter to write through. Default: the adapter installed by
   * {@link setDefaultBackend} (the host wires the `$.fs`-backed adapter there).
   */
  backend?: LogFsAdapter;
}

/** Default per-slot size cap: 2 MiB (the read-modify-write ring stays well under the fs read cap). */
export const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Hard ceiling on any per-slot cap: the platform fs rejects reads over 4 MiB. */
export const MAX_FILE_BYTES_CEILING = 4 * 1024 * 1024;

/** Default slot count: 2 slots (4 MiB total bound at the default cap). */
export const DEFAULT_SLOT_COUNT = 2;

/** Default single-message cap: 10 KB. */
export const DEFAULT_MAX_MESSAGE_BYTES = 10 * 1024;

/** Marker appended when a message is truncated. */
export const TRUNCATED_MARKER = "...(truncated)";

/** One slot-ring log file: `<slot>.log` under the logger's own directory
 * `<baseDir>/<name>/` (the pi layout's per-logger grouping). */
export function slotFileName(slot: number): string {
  return `${slot}.log`;
}
