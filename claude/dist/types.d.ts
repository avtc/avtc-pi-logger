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
export declare const NO_ERROR: unknown;
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
  list(dir: string): Promise<
    ReadonlyArray<{
      name: string;
      kind: string;
      size: number;
      mtimeMs: number;
    }>
  >;
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
export declare const DEFAULT_MAX_FILE_BYTES: number;
/** Hard ceiling on any per-slot cap: the platform fs rejects reads over 4 MiB. */
export declare const MAX_FILE_BYTES_CEILING: number;
/** Default slot count: 2 slots (4 MiB total bound at the default cap). */
export declare const DEFAULT_SLOT_COUNT = 2;
/** Default single-message cap: 10 KB. */
export declare const DEFAULT_MAX_MESSAGE_BYTES: number;
/** Marker appended when a message is truncated. */
export declare const TRUNCATED_MARKER = "...(truncated)";
/** One slot-ring log file: `<slot>.log` under the logger's own directory
 * `<baseDir>/<name>/` (the pi layout's per-logger grouping). */
export declare function slotFileName(slot: number): string;
