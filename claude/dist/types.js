// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>
/** Sentinel passed to {@link Logger.error} when no error object is available. */
export const NO_ERROR = null;
/** Default per-slot size cap: 2 MiB (the read-modify-write ring stays well under the fs read cap). */
export const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Hard ceiling on any per-slot cap: the platform fs rejects reads over 4 MiB. */
export const MAX_FILE_BYTES_CEILING = 4 * 1024 * 1024;
/** Default slot count: 2 slots (4 MiB total bound at the default cap). */
export const DEFAULT_SLOT_COUNT = 2;
/** Default single-message cap: 10 KB. */
export const DEFAULT_MAX_MESSAGE_BYTES = 10 * 1024;
/** Marker appended when a message is truncated. */
export const TRUNCATED_MARKER = "...(truncated)";
/** One slot-ring log file: `<slot>.log` under the logger's own directory
 * `<baseDir>/<name>/` (the pi layout's per-logger grouping). */
export function slotFileName(slot) {
  return `${slot}.log`;
}
