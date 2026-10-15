// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Guards the SHIPPED artifact. Consumers import this package from inside a
 * Claude mod's hooks closure, where the loader refuses every bare package
 * specifier and every node: builtin, closure-wide. These tests fail the
 * build if dist ever grows such an import (e.g. a dependency sneaking into
 * a helper) or stops importing cleanly under plain Node ESM.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const distDir = fileURLToPath(new URL("../dist", import.meta.url));

function distFiles(): string[] {
  return readdirSync(distDir).filter((f) => f.endsWith(".js") || f.endsWith(".d.ts"));
}

/** Strip block + line comments so doc examples never trip the guard. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .split("\n")
    .map((line) => line.replace(/\s\/\/.*$/u, ""))
    .join("\n");
}

/** Any import/export-from specifier that is not relative or 'claude-code'. */
function offendingSpecifiers(text: string): string[] {
  const code = stripComments(text);
  const out: string[] = [];
  const re = /\bfrom\s+["']([^"']+)["']/gu;
  for (const m of code.matchAll(re)) {
    const spec = m[1];
    if (spec.startsWith(".") || spec === "claude-code") continue;
    out.push(spec);
  }
  if (/\brequire\s*\(/u.test(code)) out.push("(require call)");
  if (/\bimport\s*\(/u.test(code)) out.push("(dynamic import)");
  return out;
}

describe("dist artifact (the shipped package)", () => {
  test("dist exists and emits", () => {
    const files = distFiles();
    expect(files).toContain("index.js");
    expect(files.length).toBeGreaterThan(0);
  });

  test("every dist file imports ONLY relative paths (mod-closure rule)", () => {
    const offenders: string[] = [];
    for (const f of distFiles()) {
      const text = readFileSync(`${distDir}/${f}`, "utf8");
      for (const spec of offendingSpecifiers(text)) {
        offenders.push(`${f}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no node builtin appears anywhere in dist source", () => {
    const offenders: string[] = [];
    for (const f of distFiles()) {
      const code = stripComments(readFileSync(`${distDir}/${f}`, "utf8"));
      if (/node:\/|require\(["']|\bBuffer\b|\bprocess\.env\b/u.test(code)) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("dist loads under plain Node ESM and logger smoke-creates", async () => {
    type DistModule = typeof import("../dist/index.js");
    const mod: DistModule = (await import("../dist/index.js")) as DistModule;
    const files = new Map<string, string>();
    const adapter: import("../dist/index.js").LogFsAdapter = {
      read: async (p) => files.get(p) ?? "",
      write: async (p, t) => {
        files.set(p, t);
      },
      list: async () => [],
    };
    mod.setDefaultBackend({ adapter, baseDir: "SMOKE" });
    const log = mod.createLogger("smoke", { clock: () => new Date("2026-06-20T13:37:45.123Z") });
    log.info("dist works");
    await mod.flushLogger(log);
    expect(files.get("SMOKE/smoke/0.log")).toContain("[INFO] dist works");
    mod.setDefaultBackend(null);
  });
});
