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
  /** Wait for all queued lines to be written (tests + drain points). */
  flush(): Promise<void>;
  private runFlush;
  private writeBatch;
  /** Read a file's text, or "" when missing. */
  private readExisting;
  /**
   * Cold start: find the mtime-newest ring file and resume appending to it;
   * a ring with no files starts at slot 0. Sizes come from listing the
   * directory (the adapter carries mtimeMs per entry).
   */
  private resolveCurrentSlot;
  private warnOnce;
}
