/**
 * UTF-8 byte length of a string without Node's Buffer. Counts continuation
 * bytes per code point; lone surrogates encode as 3 bytes (WTF-8), matching
 * Buffer for the strings a log line can carry.
 */
export declare function utf8ByteLength(text: string): number;
/**
 * Compact second-precision UTC timestamp, e.g. `2026-06-20T13:37:45`.
 * Milliseconds + trailing `Z` are stripped to keep log lines short.
 */
export declare function formatTimestamp(date: Date): string;
/**
 * Render an unknown error value as a single-line suffix (no trailing
 * newline). `err.stack` when present, else name/message, else String().
 * `instanceof Error` is avoided: cross-realm error objects (the host's
 * errors inside a mod) would fall to the string branch otherwise.
 */
export declare function formatError(err: unknown): string;
/**
 * Collapse line-breaking + other C0 control chars and DEL to single spaces so an emitted log
 * record can never be forged into extra log lines (log injection). Carriage return, line feed,
 * tab, NUL and other controls all become a space; printable text (incl. the truncation marker)
 * is preserved. Pure helper — no I/O.
 */
export declare function sanitizeForLine(message: string): string;
/**
 * Truncate a message to at most `maxBytes` UTF-8 bytes, appending {@link TRUNCATED_MARKER}
 * when shortened. Returns the original string unchanged if within the cap.
 */
export declare function truncateMessage(message: string, maxBytes: number): string;
