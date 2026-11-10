/**
 * The slot-ring writer: one logger's file lifecycle over an injected fs
 * adapter. The mods fs noun has no append, no rename and no unlink, so the
 * pi day-file layout (append + roll + prune) becomes a round-robin ring:
 * fixed filenames `<slot>.log` under `<baseDir>/<name>/`, whole-file read-modify-write appends,
 * advance at `maxFileBytes`, wrap at K — retention IS the ring (total bound
 * K x maxFileBytes, nothing ever deleted).
 *
 * All operations are best-effort: a failure is swallowed (one-line stderr
 * warning at most) and never propagates to the logger caller.
 * Lines are queued and flushed through a single in-flight chain, so
 * concurrent `writeLine` calls coalesce and keep their order.
 */
import type { LogFsAdapter } from "./types.js";
export interface SlotRingWriterOptions {
  /** Directory the ring files live in (consumer-provided absolute path). */
  baseDir: string;
  /** Logger name; its ring lives in the directory `<baseDir>/<name>/`. */
  name: string;
  /** Ring size K (slots 0..K-1). */
  slotCount: number;
  /** Per-slot byte cap; the ring advances when the current slot exceeds it. */
  maxFileBytes: number;
  /** Agglomeration window (ms): lines queue and ONE whole-file write lands
   *  per window instead of one per quiet line (0 = write on every line).
   *  Collapses to immediate when `schedule` is absent — the hooks sandbox
   *  has no host clocks, so the timer authority is injected. */
  bufferMs: number;
  /** Arm the window timer; returns a cancel (or null when it cannot cancel).
   *  A stable closure: the host may install its $.clock seam later. */
  schedule: ((ms: number, fn: () => void) => (() => void) | null) | null;
  /** The fs adapter (the host's $.fs-backed adapter, or a test double). */
  backend: LogFsAdapter;
}
export declare class SlotRingWriter {
  private readonly opts;
  /** Formatted lines waiting for the next flush. */
  private queue;
  /** The in-flight flush chain (null when idle). */
  private flushing;
  /** Cached current slot index; null until resolved by a flush. */
  private currentSlot;
  /** Lines dropped by failed batches and the last failure's reason. The
   *  console has no sink in a hooks sandbox, so an in-memory counter would
   *  make every loss invisible — the next successful write carries the
   *  acknowledgment INTO the ring, where the file log is the only place
   *  failures can be seen. */
  private droppedLines;
  private droppedReason;
  /** The last listing failure's detail — the deferred-resolution error
   *  carries it so the in-ring acknowledgment can name the REAL cause. */
  private resolutionDetail;
  /** The window's armed timer (one at a time — later lines just queue). */
  private armed;
  /** The retained last-slot state (see RetainedSlot). */
  private retained;
  /** Emit at most one warning per writer instance. */
  private warned;
  constructor(opts: SlotRingWriterOptions);
  /**
   * Queue a fully-formatted line (including trailing newline). `now` is
   * passed in (not read here) so the clock stays caller-controlled. Returns
   * immediately; the flush chain is scheduled.
   */
  writeLine(line: string, now: Date): void;
  /** Start the flush chain when idle; a finished chain with leftovers restarts itself. */
  private scheduleFlush;
  /** Wait for all queued lines to be on disk (tests + drain points) — a
   *  drain never waits out an armed window. */
  flush(): Promise<void>;
  private runFlush;
  private writeBatch;
  /** Whether the stat authority is usable: an adapter without stat, or a
   *  stat that THREW (identity must never rest on a broken authority),
   *  disables retention — every batch then reads, the pre-guard behavior.
   *  Set in the constructor (field initializers run before this.opts). */
  private statOk;
  /** One identity read; null = file absent (or the authority is out). */
  private statOf;
  /** The slot's raw text with the retained fast-path: while the identity
   *  (mtime + size) still matches what a bracketed read observed, the read
   *  is skipped — a whole-file read is the per-flush cost and an unchanged
   *  slot needs no freshness. A foreign writer's change moves the identity
   *  → a fresh read merges its lines instead of clobbering them. */
  private readRetained;
  /** Remember the bytes just written as the slot's retained state (the
   *  writer knows the exact content — no read to validate identity twice; a
   *  foreign write in the same instant degrades to the accepted RMW class). */
  private retain;
  /** Read a file's text, or "" when missing. */
  private readExisting;
  /**
   * Cold start: find the mtime-newest ring file and resume appending to it;
   * a ring with no files starts at slot 0. Sizes come from listing the
   * directory (the adapter carries mtimeMs per entry). Returns null when the
   * listing itself fails — the caller must NOT cache a default in that case.
   */
  private resolveCurrentSlot;
  private warnOnce;
}
