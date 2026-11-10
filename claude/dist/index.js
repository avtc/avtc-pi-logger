// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>
export { getDefaultBackend, setDefaultBackend } from "./fs-adapter.js";
export { createLogger, flushLogger } from "./logger.js";
export { SlotRingWriter } from "./slot-writer.js";
export {
  DEFAULT_BUFFER_MS,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_MESSAGE_BYTES,
  DEFAULT_SLOT_COUNT,
  NO_ERROR,
  slotFileName,
  TRUNCATED_MARKER,
} from "./types.js";
