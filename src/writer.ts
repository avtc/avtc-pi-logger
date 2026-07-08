// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import * as path from "node:path";

import { dateKey } from "./paths.js";

/**
 * Owns the file lifecycle for one logger: append a line to the current day-file, roll it
 * to a `.1` suffix when it exceeds the size cap, and prune files older than the retention
 * window. (SRP: this module knows about files + nothing else.)
 *
 * All operations are best-effort + synchronous:
 * - Synchronous I/O keeps ordering guarantees for diagnostic logs (low volume).
 * - Any failure is swallowed; a one-shot stderr warning is emitted so the host is never
 *   crashed by logging and is alerted once if logging is broken.
 */
export class LogWriter {
  private readonly baseDir: string;
  private readonly name: string;
  private readonly maxFileBytes: number;
  private readonly retentionDays: number;
  /** Day-files older than this many days are pruned. 0 disables pruning. */
  private lastPruneKey: string | null = null;
  /** Emit at most one stderr warning per writer instance. */
  private warned = false;

  constructor(opts: {
    baseDir: string;
    name: string;
    maxFileBytes: number;
    retentionDays: number;
  }) {
    this.baseDir = opts.baseDir;
    this.name = opts.name;
    this.maxFileBytes = opts.maxFileBytes;
    this.retentionDays = opts.retentionDays;
  }

  /**
   * Append a fully-formatted line (including trailing newline) to today's file.
   * `now` is passed in (not read here) so the clock is controlled by the caller.
   */
  writeLine(line: string, now: Date): void {
    const file = path.join(this.baseDir, this.name, `${dateKey(now)}.log`);
    try {
      this.ensureDir(path.dirname(file));
      this.rollIfOversized(file);
      this.pruneOldFiles(now);
      appendFileSync(file, line, "utf-8");
    } catch (err) {
      this.warnOnce(err);
    }
  }

  /** Roll `file` to `file.1` if it exists and exceeds the size cap. */
  private rollIfOversized(file: string): void {
    if (!existsSync(file)) return;
    let size = 0;
    try {
      size = statSync(file).size;
    } catch {
      return; // stat failed — assume undersized, attempt the append anyway
    }
    if (size <= this.maxFileBytes) return;
    try {
      renameSync(file, `${file}.1`);
    } catch (err) {
      this.warnOnce(err);
    }
  }

  /** Delete day-files older than `retentionDays` (once per calendar day). */
  private pruneOldFiles(now: Date): void {
    if (this.retentionDays <= 0) return;
    const todayKey = dateKey(now);
    if (this.lastPruneKey === todayKey) return; // at most once per day
    this.lastPruneKey = todayKey;
    const dir = path.join(this.baseDir, this.name);
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    const cutoff = now.getTime() - this.retentionDays * 24 * 60 * 60 * 1000;
    for (const entry of entries) {
      const dayMatch = entry.match(/^(\d{4}-\d{2}-\d{2})\.log(\.\d+)?$/);
      if (!dayMatch) continue;
      const entryDate = new Date(`${dayMatch[1]}T00:00:00Z`).getTime();
      if (Number.isNaN(entryDate) || entryDate >= cutoff) continue;
      try {
        unlinkSync(path.join(dir, entry));
      } catch {
        // best-effort
      }
    }
  }

  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private warnOnce(err: unknown): void {
    if (this.warned) return;
    this.warned = true;
    const detail = err instanceof Error ? err.message : String(err);
    try {
      process.stderr.write(
        `[avtc-pi-logger] logging failed for "${this.name}": ${detail}. Further errors will be silenced.\n`,
      );
    } catch {
      // even stderr is broken — truly give up silently
    }
  }
}
