/**
 * avtc-claude-logger — leveled logging for Claude mods over an injected fs
 * adapter, in a bounded slot ring.
 *
 * Usage (host wiring):
 *   import { createLogger, setDefaultBackend } from "avtc-claude-logger";
 *   setDefaultBackend({ adapter: fsAdapter, baseDir: `${configDir}/session-owl/logs` });
 *   const log = createLogger("avtc-session-owl", { debug: true });
 *   log.info("started");
 */
export type { DefaultBackend } from "./fs-adapter.js";
export { getDefaultBackend, setDefaultBackend } from "./fs-adapter.js";
export { createLogger, flushLogger } from "./logger.js";
export type { SlotRingWriterOptions } from "./slot-writer.js";
export { SlotRingWriter } from "./slot-writer.js";
export {
  DEFAULT_BUFFER_MS,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_MESSAGE_BYTES,
  DEFAULT_SLOT_COUNT,
  type LogFsAdapter,
  type Logger,
  type LoggerOptions,
  type LogLevel,
  NO_ERROR,
  type ScheduleFn,
  slotFileName,
  TRUNCATED_MARKER,
} from "./types.js";
