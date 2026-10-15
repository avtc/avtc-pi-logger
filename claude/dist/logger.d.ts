import { type Logger, type LoggerOptions } from "./types.js";
/**
 * Create a {@link Logger} that writes leveled records into the slot ring
 * `<baseDir>/<name>-<slot>.log`. The returned logger is best-effort: it
 * never throws.
 *
 * Destination resolution: explicit `options.backend`/`options.baseDir` win;
 * otherwise the host-installed default backend supplies both. With neither
 * present the call throws (a wiring bug — the host must install the backend
 * before any logger is created), surfacing at wiring time rather than
 * silently dropping every line.
 *
 * Use {@link Logger.child} to derive scoped loggers that tag lines without a
 * second ring.
 */
export declare function createLogger(name: string, options: LoggerOptions | null): Logger;
/** Wait until a logger's queued lines are on disk (drain points + tests). */
export declare function flushLogger(logger: Logger): Promise<void>;
