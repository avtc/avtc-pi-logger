// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>
let installed = null;
/**
 * Install the process-wide default backend (idempotent; the host re-installs
 * at each session start with fresh paths). Pass `null` to clear (tests).
 */
export function setDefaultBackend(backend) {
  installed = backend;
}
/** The installed default backend, or null when the host has not wired one. */
export function getDefaultBackend() {
  return installed;
}
