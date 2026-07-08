// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createLogger, type Logger, NO_ERROR, resolveLogPath } from "../src/index.js";

const TMP: string[] = [];

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `avtc-pi-logger-${prefix}-`));
  TMP.push(dir);
  return dir;
}

/** Fixed date for deterministic tests: 2026-06-20 13:37:45 UTC */
const FIXED = new Date("2026-06-20T13:37:45.123Z");
const clock = (): Date => FIXED;

afterEach(() => {
  while (TMP.length) {
    const dir = TMP.pop();
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  }
});

describe("resolveLogPath", () => {
  test("lays out ~/.pi/logs/{name}/{YYYY-MM-DD}.log under a base dir", () => {
    const base = makeTemp("base");
    const p = resolveLogPath("avtc-pi-subagent", base, clock());
    expect(p).toBe(path.join(base, "avtc-pi-subagent", "2026-06-20.log"));
  });

  test("date partition changes the file per day", () => {
    const base = makeTemp("base");
    const day1 = resolveLogPath("x", base, new Date("2026-06-20T01:00:00Z"));
    const day2 = resolveLogPath("x", base, new Date("2026-06-21T01:00:00Z"));
    expect(day1).not.toBe(day2);
    expect(day1.endsWith("2026-06-20.log")).toBe(true);
    expect(day2.endsWith("2026-06-21.log")).toBe(true);
  });
});

describe("createLogger", () => {
  test("info writes a timestamped line to the day file under {base}/{name}", () => {
    const base = makeTemp("logs");
    const log = createLogger("avtc-pi-todo", { baseDir: base, clock });
    log.info("hello world");

    const file = path.join(base, "avtc-pi-todo", "2026-06-20.log");
    const contents = readFileSync(file, "utf-8");
    // timestamp stripped of ms + level + message
    expect(contents).toContain("[INFO] hello world");
    expect(contents).toContain("2026-06-20T13:37:45"); // ms stripped
    expect(contents.endsWith("\n")).toBe(true);
  });

  test("control chars / embedded newlines in the message are sanitized (no log forging)", () => {
    const base = makeTemp("logs");
    const log = createLogger("x", { baseDir: base, clock });
    // A crafted message with newlines + a fake-looking second log line must NOT create extra records.
    // Control chars built via char codes (no literal control chars in source).
    const NL = String.fromCharCode(10); // newline
    const TAB = String.fromCharCode(9); // tab
    const NUL = String.fromCharCode(0); // NUL
    log.info("before" + NL + "injected [ERROR] fake line" + TAB + "after" + NUL + "end");

    const contents = readFileSync(path.join(base, "x", "2026-06-20.log"), "utf-8");
    // Exactly ONE line was written (one trailing newline).
    expect(contents.split("\n").filter((l) => l.length > 0).length).toBe(1);
    // No raw newline/control char survived; the injected fake line is not a separate record.
    expect(contents).not.toContain("\n[ERROR]");
    expect(contents).toContain("before injected [ERROR] fake line after end");
  });

  test("warn/error/debug all write at their level", () => {
    const base = makeTemp("logs");
    const log = createLogger("x", { baseDir: base, clock, debug: true });
    log.warn("w");
    log.error("e", NO_ERROR);
    log.debug("d");

    const contents = readFileSync(path.join(base, "x", "2026-06-20.log"), "utf-8");
    expect(contents).toContain("[WARN] w");
    expect(contents).toContain("[ERROR] e");
    expect(contents).toContain("[DEBUG] d");
  });

  test("debug is suppressed unless debug:true", () => {
    const base = makeTemp("logs");
    const log = createLogger("x", { baseDir: base, clock });
    log.debug("hidden");
    expect(() => readFileSync(path.join(base, "x", "2026-06-20.log"), "utf-8")).toThrow();
  });

  test("error appends the formatted error", () => {
    const base = makeTemp("logs");
    const log = createLogger("x", { baseDir: base, clock });
    log.error("boom", new Error("the message"));
    const contents = readFileSync(path.join(base, "x", "2026-06-20.log"), "utf-8");
    expect(contents).toContain("[ERROR] boom — Error: the message");
  });

  test("error with no err writes the bare message", () => {
    const base = makeTemp("logs");
    const log = createLogger("x", { baseDir: base, clock });
    log.error("bare", NO_ERROR);
    const contents = readFileSync(path.join(base, "x", "2026-06-20.log"), "utf-8");
    expect(contents).toContain("[ERROR] bare\n");
    expect(contents).not.toContain("—");
  });

  test("truncates overly long messages", () => {
    const base = makeTemp("logs");
    const log = createLogger("x", {
      baseDir: base,
      clock,
      maxMessageBytes: 20,
    });
    const big = "x".repeat(200);
    log.info(big);
    const contents = readFileSync(path.join(base, "x", "2026-06-20.log"), "utf-8");
    expect(contents).toContain("...(truncated)");
    expect(contents.length).toBeLessThan(big.length);
  });

  test("rolls to a.1 suffix when a day file exceeds maxFileBytes", () => {
    const base = makeTemp("logs");
    // pre-seed a day file that is already over the cap
    const file = path.join(base, "x", "2026-06-20.log");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "x".repeat(1024), "utf-8");
    const log = createLogger("x", { baseDir: base, clock, maxFileBytes: 512 });
    log.info("after-cap");

    expect(readdirSync(path.join(base, "x"))).toContain("2026-06-20.log.1");
    const fresh = readFileSync(file, "utf-8");
    expect(fresh).toContain("[INFO] after-cap");
  });

  test("deletes logs older than retentionDays", () => {
    const base = makeTemp("logs");
    const dir = path.join(base, "x");
    mkdirSync(dir, { recursive: true });
    // an old file (well beyond retention) + today's
    writeFileSync(path.join(dir, "2020-01-01.log"), "ancient", "utf-8");
    const log = createLogger("x", { baseDir: base, clock, retentionDays: 7 });
    log.info("today");

    const files = readdirSync(dir);
    expect(files).toContain("2026-06-20.log");
    expect(files).not.toContain("2020-01-01.log");
  });

  test("never throws on write failure (logs are best-effort)", () => {
    const log = createLogger("x", {
      baseDir: "/nonexistent-root/cannot-create-here",
      clock,
    });
    expect(() => log.info("nope")).not.toThrow();
  });

  test("writes to a new day file when the date rolls over mid-process", () => {
    const base = makeTemp("logs");
    let now = new Date("2026-06-20T23:59:00Z");
    const log = createLogger("x", { baseDir: base, clock: () => now });
    log.info("day1");
    now = new Date("2026-06-21T00:01:00Z");
    log.info("day2");

    expect(readFileSync(path.join(base, "x", "2026-06-20.log"), "utf-8")).toContain("day1");
    expect(readFileSync(path.join(base, "x", "2026-06-21.log"), "utf-8")).toContain("day2");
  });
});

describe("PI_LOGGER_DIR override", () => {
  test("when set, logs are written under the env dir instead of the default", () => {
    const envBase = makeTemp("env");
    process.env.PI_LOGGER_DIR = envBase;
    try {
      const log = createLogger("x", { clock });
      log.info("redirected");
      expect(readFileSync(path.join(envBase, "x", "2026-06-20.log"), "utf-8")).toContain("[INFO] redirected");
    } finally {
      delete process.env.PI_LOGGER_DIR;
    }
  });

  test("an explicit options.baseDir takes precedence over the env override", () => {
    const envBase = makeTemp("env");
    const optBase = makeTemp("opt");
    process.env.PI_LOGGER_DIR = envBase;
    try {
      const log = createLogger("x", { baseDir: optBase, clock });
      log.info("wins");
      // lands in optBase, NOT envBase
      expect(readFileSync(path.join(optBase, "x", "2026-06-20.log"), "utf-8")).toContain("[INFO] wins");
      expect(() => readFileSync(path.join(envBase, "x", "2026-06-20.log"), "utf-8")).toThrow();
    } finally {
      delete process.env.PI_LOGGER_DIR;
    }
  });
});

describe("child loggers", () => {
  test("child returns a Logger that writes a [scope] tag to the same file", () => {
    const base = makeTemp("logs");
    const log = createLogger("avtc-pi-subagent", { baseDir: base, clock });
    const child = log.child("agents");
    child.info("discovered agent");

    // SAME destination as the root logger — child only adds a tag, not a sink.
    const contents = readFileSync(path.join(base, "avtc-pi-subagent", "2026-06-20.log"), "utf-8");
    expect(contents).toContain("[INFO] [agents] discovered agent");
  });

  test("nested children compose into a dot-path scope tag", () => {
    const base = makeTemp("logs");
    const log = createLogger("x", { baseDir: base, clock });
    log.child("agents").child("discovery").warn("slow");

    const contents = readFileSync(path.join(base, "x", "2026-06-20.log"), "utf-8");
    expect(contents).toContain("[WARN] [agents.discovery] slow");
  });

  test("root logger writes no scope tag (unchanged)", () => {
    const base = makeTemp("logs");
    const log = createLogger("x", { baseDir: base, clock });
    log.info("plain");
    const contents = readFileSync(path.join(base, "x", "2026-06-20.log"), "utf-8");
    expect(contents).toContain("[INFO] plain\n");
    expect(contents).not.toMatch(/\] \[[^\]]+\] plain/);
  });

  test("child error still appends the formatted error after the tag", () => {
    const base = makeTemp("logs");
    const log = createLogger("x", { baseDir: base, clock });
    log.child("fork").error("boom", new Error("oops"));
    const contents = readFileSync(path.join(base, "x", "2026-06-20.log"), "utf-8");
    expect(contents).toContain("[ERROR] [fork] boom — Error: oops");
  });
});

describe("Logger interface", () => {
  test("createLogger returns a Logger satisfying the info/warn/error/debug/child interface", () => {
    const base = makeTemp("logs");
    const log: Logger = createLogger("x", { baseDir: base, clock });
    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
    expect(typeof log.debug).toBe("function");
    expect(typeof log.child).toBe("function");
  });
});
