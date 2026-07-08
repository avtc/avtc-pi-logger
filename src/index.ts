// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * avtc-pi-logger — file-based logging library for pi extensions.
 *
 * Per-extension, date-partitioned logs under `~/.pi/logs/{name}/YYYY-MM-DD.log` with size
 * roll-over + age-based retention. Best-effort: a logging failure never throws to the host.
 *
 * Usage:
 *   import { createLogger } from "avtc-pi-logger";
 *   const log = createLogger("avtc-pi-subagent");
 *   log.info("started");
 */

export { createLogger } from "./logger.js";
export {
  dateKey,
  listDayFiles,
  resolveBaseDir,
  resolveLogPath,
} from "./paths.js";
export {
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_MESSAGE_BYTES,
  DEFAULT_RETENTION_DAYS,
  type Logger,
  type LoggerOptions,
  type LogLevel,
  NO_ERROR,
  TRUNCATED_MARKER,
} from "./types.js";
