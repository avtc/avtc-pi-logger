// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { afterEach, describe, expect, test } from "vitest";
import { getDefaultBackend, setDefaultBackend } from "../src/fs-adapter.js";
import { createLogger, flushLogger } from "../src/logger.js";
import { DEFAULT_MAX_FILE_BYTES, type LogFsAdapter, MAX_FILE_BYTES_CEILING } from "../src/types.js";

class MemoryAdapter {
  files = new Map<string, { text: string; mtimeMs: number }>();

  async read(path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f.text;
  }

  async write(path: string, text: string): Promise<void> {
    this.files.set(path, { text, mtimeMs: this.files.size + 1 });
  }

  async list(dir: string) {
    const prefix = `${dir}/`;
    return [...this.files.entries()]
      .filter(([p]) => p.startsWith(prefix))
      .map(([p, f]) => ({ name: p.slice(prefix.length), kind: "file", size: f.text.length, mtimeMs: f.mtimeMs }));
  }
}

const FIXED = new Date("2026-06-20T13:37:45.123Z");
const clock = (): Date => FIXED;

afterEach(() => {
  setDefaultBackend(null);
});

describe("createLogger", () => {
  test("levels + timestamp + line shape (pi line format kept)", async () => {
    const adapter = new MemoryAdapter();
    const log = createLogger("owl", { baseDir: "L", backend: adapter, clock });
    log.info("hello");
    log.warn("careful");
    log.error("boom", new Error("x"));
    log.debug("hidden"); // debug off by default
    await flushLogger(log);
    const text = adapter.files.get("L/owl/0.log")?.text ?? "";
    expect(text).toContain("2026-06-20T13:37:45 [INFO] hello\n");
    expect(text).toContain("[WARN] careful\n");
    // the error suffix carries the sanitized stack (newlines collapsed), pi line shape
    expect(text).toContain("[ERROR] boom — Error: x");
    expect(text).not.toContain("hidden");
  });

  test("debug lines land when enabled", async () => {
    const adapter = new MemoryAdapter();
    const log = createLogger("owl", { baseDir: "L", backend: adapter, clock, debug: true });
    log.debug("visible");
    await flushLogger(log);
    expect(adapter.files.get("L/owl/0.log")?.text).toContain("[DEBUG] visible\n");
  });

  test("child scopes tag lines with dot-paths", async () => {
    const adapter = new MemoryAdapter();
    const log = createLogger("owl", { baseDir: "L", backend: adapter, clock });
    log.child("observer").child("rows").info("tagged");
    await flushLogger(log);
    expect(adapter.files.get("L/owl/0.log")?.text).toContain("[INFO] [observer.rows] tagged\n");
  });

  test("the host-installed default backend resolves baseDir + adapter", async () => {
    const adapter = new MemoryAdapter();
    setDefaultBackend({ adapter, baseDir: "DEF" });
    const log = createLogger("owl", { clock });
    log.info("via default");
    await flushLogger(log);
    expect(adapter.files.get("DEF/owl/0.log")?.text).toContain("via default");
  });

  test("explicit options override the default backend", async () => {
    const defAdapter = new MemoryAdapter();
    const ownAdapter = new MemoryAdapter();
    setDefaultBackend({ adapter: defAdapter, baseDir: "DEF" });
    const log = createLogger("owl", { baseDir: "OWN", backend: ownAdapter, clock });
    log.info("routed");
    await flushLogger(log);
    expect(ownAdapter.files.get("OWN/owl/0.log")?.text).toContain("routed");
    expect(defAdapter.files.size).toBe(0);
  });

  test("no destination at all throws (wiring bug surfaces at creation)", () => {
    setDefaultBackend(null);
    expect(() => createLogger("owl", { clock })).toThrow(/setDefaultBackend/u);
  });

  test("the default per-slot cap stays under the 4 MiB platform read limit", () => {
    expect(DEFAULT_MAX_FILE_BYTES).toBeLessThan(MAX_FILE_BYTES_CEILING);
  });

  test("an oversized caller cap is clamped to the ceiling (reads stay possible)", async () => {
    const adapter = new MemoryAdapter();
    const log = createLogger("owl", {
      baseDir: "L",
      backend: adapter,
      clock,
      maxFileBytes: 5 * 1024 * 1024,
    });
    log.info("x");
    await flushLogger(log);
    expect(adapter.files.get("L/owl/0.log")?.text).toContain("[INFO] x");
  });

  test("a message with a newline stays one line (log injection)", async () => {
    const adapter = new MemoryAdapter();
    const log = createLogger("owl", { baseDir: "L", backend: adapter, clock });
    log.info("forged\n[INFO] fake");
    await flushLogger(log);
    const lines = (adapter.files.get("L/owl/0.log")?.text ?? "").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("forged [INFO] fake");
  });

  test("flushLogger of an unrelated object resolves (no throw)", async () => {
    await expect(flushLogger({} as never)).resolves.toBeUndefined();
  });
});

describe("setDefaultBackend", () => {
  test("installs and clears; getDefaultBackend reflects it", () => {
    expect(getDefaultBackend()).toBeNull();
    const adapter: LogFsAdapter = {
      read: async () => "",
      write: async () => {},
      list: async () => [],
    };
    setDefaultBackend({ adapter, baseDir: "X" });
    expect(getDefaultBackend()?.baseDir).toBe("X");
    setDefaultBackend(null);
    expect(getDefaultBackend()).toBeNull();
  });
});
