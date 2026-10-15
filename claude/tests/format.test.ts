// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { describe, expect, test } from "vitest";
import { formatError, sanitizeForLine, truncateMessage, utf8ByteLength } from "../src/format.js";
import { TRUNCATED_MARKER } from "../src/types.js";

describe("utf8ByteLength", () => {
  test("ASCII: one byte per char", () => {
    expect(utf8ByteLength("abc")).toBe(3);
  });
  test("two-byte range (Latin-1)", () => {
    expect(utf8ByteLength("\u00e9")).toBe(2); // é
  });
  test("three-byte range (CJK, emoji-presentation letters)", () => {
    expect(utf8ByteLength("\u4e2d")).toBe(3); // 中
    expect(utf8ByteLength("🦉")).toBe(4); // surrogate pair = one 4-byte point
  });
  test("lone surrogate counts as 3 (never NaN/0)", () => {
    expect(utf8ByteLength("\ud83d")).toBe(3);
  });
});

describe("formatError", () => {
  test("Error instance renders its stack", () => {
    const err = new Error("boom");
    expect(formatError(err)).toContain("boom");
    expect(formatError(err)).toContain("Error");
  });
  test("cross-realm error shape (no instanceof) still renders name: message", () => {
    const foreign = { name: "TypeError", message: "nope" } as unknown as Error;
    expect(formatError(foreign)).toBe("TypeError: nope");
  });
  test("primitives stringify", () => {
    expect(formatError(42)).toBe("42");
    expect(formatError(null)).toBe("null");
  });
});

describe("sanitizeForLine", () => {
  test("newlines, tabs and controls collapse to single spaces", () => {
    expect(sanitizeForLine("a\nb\rc\td\u0000e\u007ff")).toBe("a b c d e f");
  });
  test("printable text (incl. the owl) is preserved", () => {
    expect(sanitizeForLine("🦉 roots 3 — ok")).toBe("🦉 roots 3 — ok");
  });
});

describe("truncateMessage", () => {
  test("under the cap: unchanged", () => {
    expect(truncateMessage("short", 100)).toBe("short");
  });
  test("over the cap: cut to the byte budget with the marker", () => {
    const out = truncateMessage("x".repeat(5000), 1024);
    expect(out.endsWith(TRUNCATED_MARKER)).toBe(true);
    expect(utf8ByteLength(out)).toBe(1024);
  });
  test("multibyte truncation never splits mid-cluster", () => {
    const out = truncateMessage("🦉".repeat(100), 30);
    // budget 30 - 15(marker) = 15 bytes -> exactly 3 owls (12B) fit, whole clusters only
    expect(out.endsWith(TRUNCATED_MARKER)).toBe(true);
    expect(out.startsWith("🦉🦉🦉")).toBe(true);
    expect(utf8ByteLength(out)).toBeLessThanOrEqual(30);
  });

  test("a cap smaller than the marker: the marker alone (pi behavior)", () => {
    const out = truncateMessage("🦉".repeat(100), 10);
    expect(out).toBe(TRUNCATED_MARKER);
  });
});
