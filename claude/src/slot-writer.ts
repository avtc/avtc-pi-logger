// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

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
import { slotFileName } from "./types.js";

/** One queued, fully-formatted log line. */
type PendingLine = { text: string; now: Date };

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

/** The retained state of the writer's LAST written slot: the identity the
 *  fast-path compares (a foreign writer's change moves it → fresh read) and
 *  the bytes as written — the whole-file read is the per-flush cost, and an
 *  unchanged ring slot means it can be skipped. */
interface RetainedSlot {
  path: string;
  /** null = the file does not exist (yet). */
  identity: { mtimeMs: number; size: number } | null;
  text: string;
}

export class SlotRingWriter {
  private readonly opts: SlotRingWriterOptions;
  /** Formatted lines waiting for the next flush. */
  private queue: PendingLine[] = [];
  /** The in-flight flush chain (null when idle). */
  private flushing: Promise<void> | null = null;
  /** Cached current slot index; null until resolved by a flush. */
  private currentSlot: number | null = null;
  /** Lines dropped by failed batches and the last failure's reason. The
   *  console has no sink in a hooks sandbox, so an in-memory counter would
   *  make every loss invisible — the next successful write carries the
   *  acknowledgment INTO the ring, where the file log is the only place
   *  failures can be seen. */
  private droppedLines = 0;
  private droppedReason = "";
  /** The last listing failure's detail — the deferred-resolution error
   *  carries it so the in-ring acknowledgment can name the REAL cause. */
  private resolutionDetail: string | null = null;
  /** The window's armed timer (one at a time — later lines just queue). */
  private armed = false;
  /** The retained last-slot state (see RetainedSlot). */
  private retained: RetainedSlot | null = null;
  /** Emit at most one warning per writer instance. */
  private warned = false;

  constructor(opts: SlotRingWriterOptions) {
    this.opts = opts;
    this.statOk = opts.backend.stat !== undefined;
  }

  /**
   * Queue a fully-formatted line (including trailing newline). `now` is
   * passed in (not read here) so the clock stays caller-controlled. Returns
   * immediately; the flush chain is scheduled.
   */
  writeLine(line: string, now: Date): void {
    this.queue.push({ text: line, now });
    if (this.opts.bufferMs <= 0 || this.opts.schedule === null) {
      this.scheduleFlush();
      return;
    }
    if (this.armed) return; // the window is running — this line joins it
    this.armed = true;
    const fire = (): void => {
      this.armed = false;
      this.scheduleFlush();
    };
    try {
      this.opts.schedule(this.opts.bufferMs, fire);
    } catch {
      this.armed = false;
      this.scheduleFlush(); // no timer authority — degrade to immediate
    }
  }

  /** Start the flush chain when idle; a finished chain with leftovers restarts itself. */
  private scheduleFlush(): void {
    if (this.flushing !== null) return;
    this.flushing = this.runFlush()
      .catch(() => {
        // runFlush already swallows write errors; this guards the loop itself
      })
      .finally(() => {
        this.flushing = null;
        if (this.queue.length > 0) {
          this.scheduleFlush();
        }
      });
  }

  /** Wait for all queued lines to be on disk (tests + drain points) — a
   *  drain never waits out an armed window. */
  flush(): Promise<void> {
    if (this.flushing === null) this.scheduleFlush();
    return this.flushing === null ? Promise.resolve() : this.flushing;
  }

  private async runFlush(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue;
      this.queue = [];
      try {
        await this.writeBatch(batch);
      } catch (err) {
        this.droppedLines += batch.length;
        this.droppedReason = detailOf(err);
        // the failure can be the wrap write — the cached slot is then wrong
        // and would re-wrap into the same failing write forever: invalidate
        // so the next batch re-resolves mtime-newest and retries
        this.currentSlot = null;
        this.warnOnce(err);
        // lines lost by design (best-effort); the chain stays alive and the
        // next successful write acknowledges the loss in-ring
      }
    }
  }

  private async writeBatch(batch: PendingLine[]): Promise<void> {
    const { backend, baseDir, name, slotCount, maxFileBytes } = this.opts;
    if (this.currentSlot === null) {
      const resolved = await this.resolveCurrentSlot();
      if (resolved === null) {
        // the listing is unavailable (the backend rejects before the host
        // wires it): drop this batch per the best-effort contract and keep
        // the slot UNRESOLVED — caching a default here would pin the ring
        // to slot 0 for the process lifetime and wipe the newest slot on
        // every advance
        const reason = this.resolutionDetail === null ? "unwired backend" : this.resolutionDetail;
        throw new Error(`slot ring: listing unavailable (${reason}), resolution deferred`);
      }
      this.currentSlot = resolved;
    }
    let slot = this.currentSlot;
    let path = `${baseDir}/${name}/${slotFileName(slot)}`;
    let content = await this.readRetained(path);
    const acknowledging = this.droppedLines > 0;
    if (acknowledging) {
      content += `[avtc-claude-logger] ${String(this.droppedLines)} line(s) previously lost: ${this.droppedReason}\n`;
    }
    for (const line of batch) {
      const lineBytes = byteLength(line.text);
      if (content.length > 0 && byteLength(content) + lineBytes > maxFileBytes) {
        // slot full: write what accumulated, then advance the ring — the
        // next slot's old content is the oldest and gets overwritten whole
        await backend.write(path, content);
        slot = (slot + 1) % slotCount;
        path = `${baseDir}/${name}/${slotFileName(slot)}`;
        content = "";
      }
      content += line.text;
    }
    await backend.write(path, content);
    this.currentSlot = slot;
    await this.retain(path, content);
    if (acknowledging) {
      // the acknowledgment landed — the loss is recorded in-ring
      this.droppedLines = 0;
      this.droppedReason = "";
    }
  }

  /** Whether the stat authority is usable: an adapter without stat, or a
   *  stat that THREW (identity must never rest on a broken authority),
   *  disables retention — every batch then reads, the pre-guard behavior.
   *  Set in the constructor (field initializers run before this.opts). */
  private statOk = false;

  /** One identity read; null = file absent (or the authority is out). */
  private async statOf(path: string): Promise<{ mtimeMs: number; size: number } | null> {
    if (!this.statOk || this.opts.backend.stat === undefined) return null;
    try {
      const s = await this.opts.backend.stat(path);
      if (s === null) return null;
      return { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      this.statOk = false;
      return null;
    }
  }

  /** The slot's raw text with the retained fast-path: while the identity
   *  (mtime + size) still matches what a bracketed read observed, the read
   *  is skipped — a whole-file read is the per-flush cost and an unchanged
   *  slot needs no freshness. A foreign writer's change moves the identity
   *  → a fresh read merges its lines instead of clobbering them. */
  private async readRetained(path: string): Promise<string> {
    if (!this.statOk) return this.readExisting(path);
    const kept = this.retained;
    if (kept !== null && kept.path === path) {
      const now = await this.statOf(path);
      const same =
        now === null && kept.identity === null
          ? true
          : now !== null &&
            kept.identity !== null &&
            now.mtimeMs === kept.identity.mtimeMs &&
            now.size === kept.identity.size;
      if (same) return kept.text;
    }
    // bracketed read: identity before and after must agree, else the read
    // raced a foreign write and must not become the retained state
    const before = await this.statOf(path);
    const text = await this.readExisting(path);
    const after = await this.statOf(path);
    if (this.statOk && equalStat(before, after)) {
      this.retained = { path, identity: before, text };
    } else {
      this.retained = null;
    }
    return text;
  }

  /** Remember the bytes just written as the slot's retained state (the
   *  writer knows the exact content — no read to validate identity twice; a
   *  foreign write in the same instant degrades to the accepted RMW class). */
  private async retain(path: string, text: string): Promise<void> {
    if (!this.statOk) {
      this.retained = null;
      return;
    }
    const identity = await this.statOf(path);
    if (this.statOk) this.retained = { path, identity, text };
  }

  /** Read a file's text, or "" when missing. */
  private async readExisting(path: string): Promise<string> {
    try {
      return await this.opts.backend.read(path);
    } catch {
      return "";
    }
  }

  /**
   * Cold start: find the mtime-newest ring file and resume appending to it;
   * a ring with no files starts at slot 0. Sizes come from listing the
   * directory (the adapter carries mtimeMs per entry). Returns null when the
   * listing itself fails — the caller must NOT cache a default in that case.
   */
  private async resolveCurrentSlot(): Promise<number | null> {
    const { backend, baseDir, name, slotCount } = this.opts;
    this.resolutionDetail = null;
    let entries: ReadonlyArray<{ name: string; mtimeMs: number }> = [];
    let listed = false;
    try {
      entries = await backend.list(`${baseDir}/${name}`);
      listed = true;
    } catch (err) {
      // a MISSING directory is not an unknown ring: no directory means no
      // files, so the ring is provably empty and slot 0 is its truth (the
      // write itself creates the directory). Any other failure — the
      // backend rejecting before the host wires it — leaves the ring state
      // unknown and must resolve null, never a cached default
      const detail = err instanceof Error ? err.message : String(err);
      this.resolutionDetail = detail;
      if (/ENOENT|no such file/i.test(detail)) listed = true;
    }
    if (!listed) return null;
    let best: { slot: number; mtimeMs: number } | null = null;
    for (const entry of entries) {
      const m = entry.name.match(/^(\d+)\.log$/);
      if (!m) continue;
      const slot = Number(m[1]);
      if (slot < 0 || slot >= slotCount) continue;
      if (best === null || entry.mtimeMs >= best.mtimeMs) {
        best = { slot, mtimeMs: entry.mtimeMs };
      }
    }
    return best === null ? 0 : best.slot;
  }

  private warnOnce(err: unknown): void {
    if (this.warned) return;
    this.warned = true;
    const detail = err instanceof Error ? err.message : String(err);
    try {
      warnSink(
        `[avtc-claude-logger] logging failed for "${this.opts.name}": ${detail}. Further errors will be silenced.`,
      );
    } catch {
      // even console is broken — truly give up silently
    }
  }
}

/** UTF-8 byte length without Node's Buffer (matches format.utf8ByteLength). */
function byteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      i += 1;
      bytes += 4;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** Best-effort warning sink: console.error when it exists, else silent. */
declare const console: { error(...args: unknown[]): void } | undefined;
function warnSink(message: string): void {
  try {
    console?.error(message);
  } catch {
    // no console — give up silently (best-effort by contract)
  }
}

/** Two identities naming the same unchanging file. */
function equalStat(a: { mtimeMs: number; size: number } | null, b: { mtimeMs: number; size: number } | null): boolean {
  if (a === null || b === null) return a === null && b === null;
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

/** The dropped-batch reason recorded for the in-ring acknowledgment. */
function detailOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
