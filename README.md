# avtc-pi-logger

File-based logging library for pi extensions — date-partitioned with rotation.

## Features

- **Date-partitioned logs** — one file per day (`YYYY-MM-DD.log`, UTC); automatically starts a new file at midnight
- **Size roll-over** — when today's file exceeds `maxFileBytes` (default 5 MB), it is renamed to `.log.1` and a fresh file starts
- **Age-based retention** — day-files older than `retentionDays` (default 2; `0` = keep all) are pruned automatically
- **Message truncation** — messages over `maxMessageBytes` (default 10 KB) are truncated with a marker
- **Scoped child loggers** — `log.child("scope")` derives a child that tags lines with `[scope]`; nested children compose into dot-paths (`[agents.discovery]`)
- **Best-effort I/O** — any failure is swallowed after a single stderr warning; logging never crashes the host
- **Directory override** — `PI_LOGGER_DIR` environment variable or explicit `baseDir` option relocates all logs
- **Test seam** — inject a custom `clock` function for deterministic tests

## API

| Export | Description |
|--------|-------------|
| `createLogger(name, options \| null)` | Returns a `Logger { info, warn, error, debug, child }` writing to `<baseDir>/<name>/<date>.log` |
| `Logger.child(scope)` | Derives a scoped child that tags lines `[scope]` and shares the root's sink (dot-paths when nested) |
| `resolveLogPath(name, baseDir, date)` | Pure path resolver (`<baseDir>/<name>/<YYYY-MM-DD>.log`) |
| `Logger`, `LogLevel`, `LoggerOptions` | Types |
| `NO_ERROR` | Sentinel for `error(msg, NO_ERROR)` when no error object is available |

### `LoggerOptions`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `baseDir` | string | `~/.pi/logs` | Root directory for all extension logs |
| `debug` | boolean | `false` | Enable debug-level logging |
| `maxFileBytes` | number | `5_242_880` (5 MB) | Max log file size before roll-over |
| `retentionDays` | number | `2` | Days to keep old log files (`0` = keep all) |
| `maxMessageBytes` | number | `10_240` (10 KB) | Max message length before truncation |
| `clock` | () → Date | `() => new Date()` | Test seam for deterministic timestamps |
| `homeDir` | string | `os.homedir()` | Home directory for default base path resolution |

### Log directory override

Base-directory resolution precedence: an explicit `options.baseDir` > the `PI_LOGGER_DIR` environment variable > the default `~/.pi/logs`. Setting `PI_LOGGER_DIR` relocates all logs (for tests, point it at a temp dir; for users, a custom log root) with no code changes.

## Installation

Add it as a dependency of your extension:

```bash
npm install avtc-pi-logger
```

## Usage

```ts
import { createLogger, NO_ERROR } from "avtc-pi-logger";

const log = createLogger("my-extension");
log.info("started");
log.warn("slow query");
log.error("request failed", new Error("timeout"));
log.error("no error object", NO_ERROR);
log.debug("only when debug enabled"); // suppressed unless { debug: true }

// Scoped child loggers tag each line with a `[scope]` and share the root's sink:
const agentsLog = log.child("agents");
agentsLog.info("discovered agent");
```

Writes land at `~/.pi/logs/my-extension/2026-06-20.log` as:

```
2026-06-20T13:37:45 [INFO] started
2026-06-20T13:37:45 [WARN] slow query
2026-06-20T13:37:45 [ERROR] request failed — Error: timeout
2026-06-20T13:37:45 [INFO] [agents] discovered agent
```

Nested children compose into a dot-path scope (`log.child("agents").child("discovery")` → `[agents.discovery]`).

## Full suite

Check out the full suite of related extensions, [avtc-pi](https://github.com/avtc/avtc-pi) — deterministic feature development, subagent delegation, working-memory, behavioral learning, parallel-work guardrails, durable decisions, notifications, and more.

Developed with [Z.ai](https://z.ai/subscribe?ic=N5IV4LLOOV) — get 10% off your subscription via this referral link.

## License

MIT
