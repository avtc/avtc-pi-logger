// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { describe, expect, test } from "vitest";
import { SlotRingWriter } from "../src/slot-writer.js";

/** In-memory adapter: whole-file writes, listing with metadata (the $.fs shapes). */
class MemoryAdapter {
  files = new Map<string, { text: string; mtimeMs: number }>();
  failures = 0;
  listCalls = 0;

  async read(path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f.text;
  }

  async write(path: string, text: string): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error(`EWRITE: ${path}`);
    }
    this.files.set(path, { text, mtimeMs: this.files.size + 1 });
  }

  async list(dir: string) {
    this.listCalls += 1;
    const prefix = `${dir}/`;
    return [...this.files.entries()]
      .filter(([p]) => p.startsWith(prefix))
      .map(([p, f]) => ({ name: p.slice(prefix.length), kind: "file", size: f.text.length, mtimeMs: f.mtimeMs }));
  }
}

const FIXED = new Date("2026-06-20T13:37:45.123Z");
const clock = (): Date => FIXED;

function makeWriter(adapter: MemoryAdapter, opts?: { slotCount?: number; maxFileBytes?: number }) {
  return new SlotRingWriter({
    baseDir: "logs",
    name: "owl",
    slotCount: opts?.slotCount ?? 2,
    maxFileBytes: opts?.maxFileBytes ?? 100,
    backend: adapter,
  });
}

function text(adapter: MemoryAdapter, slot: number): string | null {
  const f = adapter.files.get(`logs/owl/${slot}.log`);
  return f === undefined ? null : f.text;
}

async function flush(w: SlotRingWriter): Promise<void> {
  await w.flush();
}

describe("SlotRingWriter", () => {
  test("first lines land in slot 0 as whole-file writes", async () => {
    const adapter = new MemoryAdapter();
    const w = makeWriter(adapter);
    await w.writeLine("line-a\n", clock());
    await w.writeLine("line-b\n", clock());
    await flush(w);
    expect(text(adapter, 0)).toBe("line-a\nline-b\n");
    expect(adapter.files.size).toBe(1);
  });

  test("the ring advances when the slot exceeds the cap, wrapping at K", async () => {
    const adapter = new MemoryAdapter();
    const w = makeWriter(adapter, { maxFileBytes: 12, slotCount: 2 });
    // slot 0: two 6-byte lines fill it to the cap
    await w.writeLine("aaaa\n", clock());
    await flush(w);
    await w.writeLine("bbbb\n", clock());
    await flush(w);
    // third line overflows slot 0 -> slot 1
    await w.writeLine("cccc\n", clock());
    await flush(w);
    expect(text(adapter, 0)).toBe("aaaa\nbbbb\n");
    expect(text(adapter, 1)).toBe("cccc\n");
    // slot 1 fills ("cccc\n"+"dddd\n" = 10B <= 12B), then "eeee" overflows it:
    // the ring wraps to slot 0, overwriting its old content whole
    await w.writeLine("dddd\n", clock());
    await flush(w);
    await w.writeLine("eeee\n", clock());
    await flush(w);
    expect(text(adapter, 0)).toBe("eeee\n"); // "aaaa\nbbbb\n" evicted
    expect(text(adapter, 1)).toBe("cccc\ndddd\n");
    await w.writeLine("ffff\n", clock());
    await flush(w);
    expect(text(adapter, 0)).toBe("eeee\nffff\n");
  });

  test("the total bound is K x maxFileBytes (ring never grows past K files)", async () => {
    const adapter = new MemoryAdapter();
    const w = makeWriter(adapter, { maxFileBytes: 10, slotCount: 3 });
    for (let i = 0; i < 40; i++) {
      await w.writeLine(`n${i}\n`, clock());
      await flush(w);
    }
    expect(adapter.files.size).toBeLessThanOrEqual(3);
    const slots = [...adapter.files.keys()].map((p) => Number(p.match(/(\d+)\.log$/)?.[1]));
    expect(slots.every((s) => s >= 0 && s < 3)).toBe(true);
  });

  test("a cold writer resumes from the mtime-newest slot", async () => {
    const adapter = new MemoryAdapter();
    // a previous process left slot 1 as the newest
    adapter.files.set("logs/owl/0.log", { text: "old-old\n", mtimeMs: 1 });
    adapter.files.set("logs/owl/1.log", { text: "newest\n", mtimeMs: 5 });
    const w = makeWriter(adapter, { maxFileBytes: 40, slotCount: 2 });
    await w.writeLine("resume\n", clock());
    await flush(w);
    expect(text(adapter, 1)).toBe("newest\nresume\n");
    expect(text(adapter, 0)).toBe("old-old\n");
  });

  test("a listing that fails because the log directory does not exist yet resolves the empty ring at slot 0 — the first batch lands and creates the ring", async () => {
    // no directory means no files: the ring is provably empty, so slot 0 is
    // its truth, not a blind default — and the write itself creates the
    // directory (the host fs creates parents). Only a listing that fails
    // with the directory PRESENT leaves the ring unknown.
    const adapter = new MemoryAdapter();
    let absent = true;
    const realList = adapter.list.bind(adapter);
    adapter.list = async (dir: string) => {
      if (absent) {
        absent = false;
        throw new Error(`ENOENT: no such file or directory, scandir ${dir}`);
      }
      return realList(dir);
    };
    const w = makeWriter(adapter, { maxFileBytes: 100, slotCount: 2 });
    await w.writeLine("first lines survive the cold start" + String.fromCharCode(10), clock());
    await flush(w);
    expect(text(adapter, 0)).toBe("first lines survive the cold start" + String.fromCharCode(10));
    await w.writeLine("second batch lists the now-existing ring" + String.fromCharCode(10), clock());
    await flush(w);
    expect(text(adapter, 0)).toBe(
      "first lines survive the cold start" +
        String.fromCharCode(10) +
        "second batch lists the now-existing ring" +
        String.fromCharCode(10),
    );
  });

  test("a listing that fails at cold start is not cached as slot 0 (the retry resolves the real newest)", async () => {
    const adapter = new MemoryAdapter();
    // a previous process left slot 1 as the newest; the first flush cannot
    // list yet (the backend rejects before the host wires it)
    adapter.files.set("logs/owl/0.log", { text: "full-old-zombie\n", mtimeMs: 1 });
    adapter.files.set("logs/owl/1.log", { text: "newest\n", mtimeMs: 5 });
    let listFailures = 1;
    const realList = adapter.list.bind(adapter);
    adapter.list = async (dir: string) => {
      if (listFailures > 0) {
        listFailures -= 1;
        throw new Error("backend not initialized");
      }
      return realList(dir);
    };
    const w = makeWriter(adapter, { maxFileBytes: 500, slotCount: 2 }); // room for the ack line
    await w.writeLine("dropped-with-the-first-batch\n", clock());
    await flush(w); // the listing failed: the batch is lost, the slot stays unresolved
    await w.writeLine("kept\n", clock());
    await flush(w); // the retry lists fine and lands on the mtime-newest slot
    const onDisk = text(adapter, 1) ?? "";
    expect(onDisk).toContain("newest\n");
    expect(onDisk).toContain("kept\n");
    // the silent drop is acknowledged in-ring on recovery
    expect(onDisk).toMatch(/\[avtc-claude-logger\] 1 line\(s\) previously lost: .*backend not initialized/);
    expect(text(adapter, 0)).toBe("full-old-zombie\n");
  });

  test("write failures never throw; the failed batch is lost, later lines land, and the ring acknowledges the loss", async () => {
    const adapter = new MemoryAdapter();
    adapter.failures = 1;
    const w = makeWriter(adapter);
    await w.writeLine("lost\n", clock());
    await flush(w); // swallows the EWRITE (best-effort: the batch is gone)
    await w.writeLine("kept\n", clock());
    await flush(w);
    const onDisk = text(adapter, 0) ?? "";
    expect(onDisk).toContain("kept\n");
    expect(onDisk).toMatch(/\[avtc-claude-logger\] 1 line\(s\) previously lost: .*EWRITE/);
  });

  test("a failed wrap write does not wedge the ring — the slot re-resolves, the wrap retries, the loss is acknowledged", async () => {
    // the wrap shape: slot 0 full, the overflow line must land in slot 1 —
    // if THAT write fails, the old code cached slot 0 and every later batch
    // re-wrapped into the same failing write (a silent drop loop). Now the
    // failure invalidates the slot, the next batch re-resolves fresh and
    // lands — with the lost lines acknowledged in-ring
    const adapter = new MemoryAdapter();
    const w = makeWriter(adapter, { maxFileBytes: 1000, slotCount: 2 });
    const a = `${"a".repeat(599)}\n`;
    const b = `${"b".repeat(599)}\n`;
    const c = `${"c".repeat(599)}\n`;
    await w.writeLine(a, clock());
    await flush(w); // slot 0 = a (600 B)
    const realWrite = adapter.write.bind(adapter);
    let slot1Fails = 1;
    adapter.write = async (p: string, t: string): Promise<void> => {
      if (p.endsWith("/1.log") && slot1Fails > 0) {
        slot1Fails -= 1;
        throw new Error(`EWRITE: ${p}`);
      }
      return realWrite(p, t);
    };
    await w.writeLine(b, clock());
    await flush(w); // wrap: slot 0 flushed, the slot-1 write throws → batch lost
    expect(text(adapter, 1)).toBeNull();
    await w.writeLine(c, clock());
    await flush(w); // re-resolved (fresh list), wrapped again, landed in slot 1
    expect(adapter.listCalls).toBeGreaterThanOrEqual(2);
    expect(text(adapter, 1)).toBe(c);
    const head = text(adapter, 0) ?? "";
    expect(head).toContain(a);
    expect(head).toMatch(/\[avtc-claude-logger\] 1 line\(s\) previously lost: .*EWRITE.*1\.log/);
  });

  test("concurrent writeLine calls coalesce into one flush, order preserved", async () => {
    const adapter = new MemoryAdapter();
    const w = makeWriter(adapter);
    await Promise.all([w.writeLine("p1\n", clock()), w.writeLine("p2\n", clock()), w.writeLine("p3\n", clock())]);
    await flush(w);
    expect(text(adapter, 0)).toBe("p1\np2\np3\n");
  });
});
