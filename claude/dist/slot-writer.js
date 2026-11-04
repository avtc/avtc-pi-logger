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
  /** Emit at most one warning per writer instance. */
  warned = false;
  constructor(opts) {
    this.opts = opts;
  }
  /**
   * Queue a fully-formatted line (including trailing newline). `now` is
   * passed in (not read here) so the clock stays caller-controlled. Returns
   * immediately; the flush chain is scheduled.
   */
  writeLine(line, now) {
    this.queue.push({ text: line, now });
    this.scheduleFlush();
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
  /** Wait for all queued lines to be written (tests + drain points). */
  flush() {
    return this.flushing === null ? Promise.resolve() : this.flushing;
  }
  async runFlush() {
    while (this.queue.length > 0) {
      const batch = this.queue;
      this.queue = [];
      try {
        await this.writeBatch(batch);
      } catch (err) {
        this.warnOnce(err);
        // lines lost by design (best-effort); keep the chain alive
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
        throw new Error("slot ring: listing unavailable, resolution deferred");
      }
      this.currentSlot = resolved;
    }
    let slot = this.currentSlot;
    let path = `${baseDir}/${name}/${slotFileName(slot)}`;
    let content = await this.readExisting(path);
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
