// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>
import { slotFileName } from "./types.js";
export class SlotRingWriter {
  opts;
  /** Formatted lines waiting for the next flush. */
  queue = [];
  /** The in-flight flush chain (null when idle). */
  flushing = null;
  /** Cached current slot index; null until resolved by a flush. */
  currentSlot = null;
  /** Lines dropped by failed batches and the last failure's reason. The
   *  console has no sink in a hooks sandbox, so an in-memory counter would
   *  make every loss invisible — the next successful write carries the
   *  acknowledgment INTO the ring, where the file log is the only place
   *  failures can be seen. */
  droppedLines = 0;
  droppedReason = "";
  /** The last listing failure's detail — the deferred-resolution error
   *  carries it so the in-ring acknowledgment can name the REAL cause. */
  resolutionDetail = null;
  /** The window's armed timer (one at a time — later lines just queue). */
  armed = false;
  /** The retained last-slot state (see RetainedSlot). */
  retained = null;
  /** Emit at most one warning per writer instance. */
  warned = false;
  constructor(opts) {
    this.opts = opts;
    this.statOk = opts.backend.stat !== undefined;
  }
  /**
   * Queue a fully-formatted line (including trailing newline). `now` is
   * passed in (not read here) so the clock stays caller-controlled. Returns
   * immediately; the flush chain is scheduled.
   */
  writeLine(line, now) {
    this.queue.push({ text: line, now });
    if (this.opts.bufferMs <= 0 || this.opts.schedule === null) {
      this.scheduleFlush();
      return;
    }
    if (this.armed) return; // the window is running — this line joins it
    this.armed = true;
    const fire = () => {
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
  scheduleFlush() {
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
  flush() {
    if (this.flushing === null) this.scheduleFlush();
    return this.flushing === null ? Promise.resolve() : this.flushing;
  }
  async runFlush() {
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
  async writeBatch(batch) {
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
  statOk = false;
  /** One identity read; null = file absent (or the authority is out). */
  async statOf(path) {
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
  async readRetained(path) {
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
  async retain(path, text) {
    if (!this.statOk) {
      this.retained = null;
      return;
    }
    const identity = await this.statOf(path);
    if (this.statOk) this.retained = { path, identity, text };
  }
  /** Read a file's text, or "" when missing. */
  async readExisting(path) {
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
  async resolveCurrentSlot() {
    const { backend, baseDir, name, slotCount } = this.opts;
    this.resolutionDetail = null;
    let entries = [];
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
    let best = null;
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
  warnOnce(err) {
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
function byteLength(text) {
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
function warnSink(message) {
  try {
    console?.error(message);
  } catch {
    // no console — give up silently (best-effort by contract)
  }
}
/** Two identities naming the same unchanging file. */
function equalStat(a, b) {
  if (a === null || b === null) return a === null && b === null;
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}
/** The dropped-batch reason recorded for the in-ring acknowledgment. */
function detailOf(err) {
  return err instanceof Error ? err.message : String(err);
}
