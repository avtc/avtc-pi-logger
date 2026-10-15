# avtc-claude-logger

File-based logging library for Claude mods — fixed total size limit, oldest log files overwritten.

## Features

- **Bounded slot ring** — fixed filenames `<slot>.log` under `<baseDir>/<name>/`; when a slot exceeds `maxFileBytes` the ring advances, past the last slot it wraps to the oldest
- **Fixed total size** — capped at `slotCount × maxFileBytes` (default `2` slots × `2 MiB`); the oldest log files are overwritten
- **Buffered writes** — records buffer in memory and flush as whole-file appends
- **Leveled records** — `info` / `warn` / `error(message, err)` / `debug` (suppressed unless enabled)
- **Scoped child loggers** — `log.child("scope")` derives a child that tags lines with `[scope]`; nested children compose into dot-paths (`[agents.discovery]`)
- **Best-effort I/O** — any failure is swallowed after a single console warning; logging never crashes the host
- **Message truncation** — messages over `maxMessageBytes` (default 10 KB) are truncated with a marker
- **Single-line output** — embedded newlines and control characters collapse to spaces, so a message can never forge extra log lines
- **Test seam** — inject a custom `clock` function for deterministic tests; an in-memory adapter for assertions

## Installation

```bash
npm install avtc-claude-logger
```

## Usage

The hooks module has no file access of its own — `$.fs` exists only inside hooks, where `$` lives — so the library takes both the fs seam and the base directory from the host. The host installs a default backend once at session start (wrapping the session's `$.fs`; the adapter is exactly its `read` / `write` / `list` shapes), and every bare `createLogger(name)` resolves through it:

```ts
import { createLogger, NO_ERROR, setDefaultBackend } from "avtc-claude-logger";

const configDir = (await $.env.get("CLAUDE_CONFIG_DIR")) ?? "~/.claude";

setDefaultBackend({
  adapter: {
    read: (path) => $.fs.read(path),
    write: (path, text) => $.fs.write(path, text),
    list: (dir) => $.fs.list(dir),
  },
  baseDir: `${configDir}/logs`,
});
```

`$.fs` itself can't be handed over — the platform rejects `$` and its nouns as values across a call boundary — so each method is spelled as a closure.

```ts
const log = createLogger("my-extension");
log.info("started");
log.warn("slow query");
log.error("request failed", new Error("timeout"));
log.error("no error object", NO_ERROR);
log.debug("only when debug enabled"); // suppressed unless { debug: true }

// Scoped child loggers tag each line with a `[scope]` and share the root's ring:
const agentsLog = log.child("agents");
agentsLog.info("discovered agent");
```

`createLogger` throws until a backend is installed or `baseDir`/`backend` is passed — wiring bugs surface at creation. Multiple processes writing to the same ring may lose lines when flushes interleave.

Writes land at `~/.claude/logs/<name>/<slot>.log` as:

```
2026-06-20T13:37:45 [INFO] started
2026-06-20T13:37:45 [WARN] slow query
2026-06-20T13:37:45 [ERROR] request failed — Error: timeout
2026-06-20T13:37:45 [INFO] [agents] discovered agent
```

Nested children compose into a dot-path scope (`log.child("agents").child("discovery")` → `[agents.discovery]`).

## API

| Export | Description |
|--------|-------------|
| `createLogger(name, options \| null)` | Returns a `Logger { info, warn, error, debug, child }` writing to `<baseDir>/<name>/<slot>.log` |
| `Logger.child(scope)` | Derives a scoped child that tags lines `[scope]` and shares the root's ring (dot-paths when nested) |
| `setDefaultBackend({ adapter, baseDir })` | Host-side default backend installation |
| `getDefaultBackend()` | Reads the installed default (if any) |
| `flushLogger(logger)` | Await a logger's queued lines (drain points, tests) |
| `SlotRingWriter` | The ring writer, usable directly |
| `slotFileName(slot)` | Pure slot-file helper (`<slot>.log`) |
| Types | `Logger`, `LoggerOptions`, `LogLevel`, `LogFsAdapter` |
| Constants | `DEFAULT_MAX_FILE_BYTES`, `DEFAULT_SLOT_COUNT`, `DEFAULT_MAX_MESSAGE_BYTES`, `TRUNCATED_MARKER`, `NO_ERROR` |

### `LoggerOptions`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `baseDir` | string | — | Root directory for the ring (or via the installed default backend) |
| `debug` | boolean | `false` | Enable debug-level logging |
| `maxFileBytes` | number | `2097152` (2 MiB) | Max slot file size before the ring advances (hard ceiling: the platform fs rejects reads over 4 MiB) |
| `slotCount` | number | `2` | Number of slot files in the ring |
| `maxMessageBytes` | number | `10240` (10 KB) | Max message length before truncation |
| `clock` | () → Date | `() => new Date()` | Test seam for deterministic timestamps |
| `backend` | backend | — | Explicit backend (overrides the installed default) |

### Base directory

Resolution: an explicit `options.baseDir` > the installed default backend's `baseDir`; otherwise `createLogger` throws. The library itself reads nothing — to relocate all logs (tests, custom roots), read the location where you call `setDefaultBackend` and pass it as `baseDir`.

## Package shape

The shipped `dist/` is plain ESM with relative-internal imports only — the form a mod's hooks closure can load.

## Full suite

Check out the full suite of related extensions, [avtc-pi](https://github.com/avtc/avtc-pi) — deterministic feature development, subagent delegation, working-memory, behavioral learning, parallel-work guardrails, durable decisions, notifications, and more.

Developed with [Z.ai](https://z.ai/subscribe?ic=N5IV4LLOOV) — get 10% off your subscription via this referral link.

## License

MIT
