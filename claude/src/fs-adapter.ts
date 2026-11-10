// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Host-side backend installation. The library itself never touches Node or
 * engine globals: the host (the mod's wiring) installs the `$.fs`-backed
 * adapter once at session start, and every {@link createLogger} without an
 * explicit `backend`/`baseDir` uses it.
 */

import type { LogFsAdapter, ScheduleFn } from "./types.js";

/** What the host installs: where logs land and what writes them. */
export interface DefaultBackend {
  adapter: LogFsAdapter;
  baseDir: string;
  /** The window timer for every logger over this backend (a stable closure
   *  — the host may install its $.clock seam later than this install). */
  schedule?: ScheduleFn;
}

let installed: DefaultBackend | null = null;

/**
 * Install the process-wide default backend (idempotent; the host re-installs
 * at each session start with fresh paths). Pass `null` to clear (tests).
 */
export function setDefaultBackend(backend: DefaultBackend | null): void {
  installed = backend;
}

/** The installed default backend, or null when the host has not wired one. */
export function getDefaultBackend(): DefaultBackend | null {
  return installed;
}
