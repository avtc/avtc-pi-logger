// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { readdirSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Pure path resolution for the file backend.
 *
 * Kept separate from writing (SRP) so path layout is testable + reusable independently of
 * the I/O layer. Layout: `<baseDir>/<name>/<YYYY-MM-DD>.log`.
 *
 * Date-partitioning gives natural per-day rotation with no cross-process coordination: a
 * long-running process that crosses midnight simply resolves a new path on the next write.
 */

/** Default log root: `~/.pi/logs` (matches pi's existing logs convention). */
export function resolveBaseDir(homeDir: string | null): string {
  return path.join(homeDir ?? os.homedir(), ".pi", "logs");
}

/** Format a Date as the `YYYY-MM-DD` partition key (UTC, lexically sortable). */
export function dateKey(date: Date): string {
  const iso = date.toISOString();
  return iso.slice(0, 10); // YYYY-MM-DD (toISOString is always UTC + that form)
}

/**
 * Resolve the absolute log file path for `name` on `date` under `baseDir`.
 * Pure: performs no I/O.
 */
export function resolveLogPath(name: string, baseDir: string, date: Date): string {
  return path.join(baseDir, name, `${dateKey(date)}.log`);
}

/**
 * Enumerate existing day-files for `name` (basename only, e.g. `2026-06-20.log`).
 * Returns `[]` if the directory does not exist. Pure-ish: one readdir, no mutation.
 */
export function listDayFiles(name: string, baseDir: string): string[] {
  const dir = path.join(baseDir, name);
  try {
    return readdirSync(dir) as string[];
  } catch {
    return [];
  }
}
