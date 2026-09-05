import assert from "node:assert/strict"
import test from "node:test"

import { parseStrictU64, scalarToU64, parseDelimitedU64Ids } from "./u64"
import { optionalBigIntU64, nullableBigIntU64 } from "./form-coercion"

// ── parseStrictU64 ─────────────────────────────────────────────────────────

test("parseStrictU64 handles zero and small values", () => {
  assert.equal(parseStrictU64(0), 0n)
  assert.equal(parseStrictU64(1n), 1n)
  assert.equal(parseStrictU64("0"), 0n)
  assert.equal(parseStrictU64("1"), 1n)
  assert.equal(parseStrictU64(42), 42n)
})

test("parseStrictU64 preserves large strings above 2^53 exactly", () => {
  // This is the core precision bug: Number("9007199254740993") rounds to 9007199254740992
  assert.equal(parseStrictU64("9007199254740993"), 9007199254740993n)
  assert.notEqual(parseStrictU64("9007199254740993"), 9007199254740992n)
  assert.equal(parseStrictU64("18446744073709551615"), 18446744073709551615n)
})

test("parseStrictU64 rejects max+1 and out-of-range", () => {
  assert.equal(parseStrictU64("18446744073709551616"), undefined)
  assert.equal(parseStrictU64(18446744073709551616n), undefined)
})

test("parseStrictU64 rejects negatives", () => {
  assert.equal(parseStrictU64(-1), undefined)
  assert.equal(parseStrictU64("-1"), undefined)
  assert.equal(parseStrictU64(-1n), undefined)
})

test("parseStrictU64 rejects fractions", () => {
  assert.equal(parseStrictU64(1.5), undefined)
  assert.equal(parseStrictU64("1.5"), undefined)
})

test("parseStrictU64 rejects unsafe JS numbers", () => {
  assert.equal(parseStrictU64(9007199254740993), undefined) // not a safe integer
  assert.equal(parseStrictU64(Number.MAX_SAFE_INTEGER + 1), undefined)
})

test("parseStrictU64 accepts safe JS numbers in range", () => {
  assert.equal(parseStrictU64(Number.MAX_SAFE_INTEGER), 9007199254740991n)
  assert.equal(parseStrictU64(0), 0n)
})

test("parseStrictU64 treats absent values as undefined", () => {
  assert.equal(parseStrictU64(null), undefined)
  assert.equal(parseStrictU64(undefined), undefined)
  assert.equal(parseStrictU64(""), undefined)
})

test("parseStrictU64 rejects non-numeric and malformed strings", () => {
  assert.equal(parseStrictU64("12suffix"), undefined)
  assert.equal(parseStrictU64("abc"), undefined)
  assert.equal(parseStrictU64("  "), undefined)
  assert.equal(parseStrictU64("1e5"), undefined) // scientific notation not supported
})

test("parseStrictU64 handles Option::Some envelopes", () => {
  assert.equal(parseStrictU64({ some: "42" }), 42n)
  assert.equal(parseStrictU64({ some: 42 }), 42n)
  assert.equal(parseStrictU64({ some: 42n }), 42n)
  assert.equal(parseStrictU64({ some: { some: "42" } }), 42n)
  assert.equal(parseStrictU64({ some: null }), undefined)
  assert.equal(parseStrictU64({ some: "" }), undefined)
})

test("parseStrictU64 handles grouped/underscore strings", () => {
  assert.equal(parseStrictU64("1_000_000"), 1000000n)
  assert.equal(parseStrictU64("1,000"), 1000n)
})

// ── scalarToU64 ────────────────────────────────────────────────────────────

test("scalarToU64 converts bigint/number/string to bigint", () => {
  assert.equal(scalarToU64(42n), 42n)
  assert.equal(scalarToU64(42), 42n)
  assert.equal(scalarToU64("42"), 42n)
  assert.equal(scalarToU64("9007199254740993"), 9007199254740993n)
})

test("scalarToU64 throws on invalid values", () => {
  assert.throws(() => scalarToU64(-1n), RangeError)
  assert.throws(() => scalarToU64(-1), RangeError)
  assert.throws(() => scalarToU64("-1"), RangeError)
  assert.throws(() => scalarToU64(""), RangeError)
  assert.throws(() => scalarToU64(1.5), RangeError)
  assert.throws(() => scalarToU64("abc"), SyntaxError)
  assert.throws(() => scalarToU64("18446744073709551616"), RangeError)
})

// ── parseDelimitedU64Ids ───────────────────────────────────────────────────

test("parseDelimitedU64Ids handles comma and whitespace separated values", () => {
  assert.deepEqual(parseDelimitedU64Ids("1,2,3"), [1n, 2n, 3n])
  assert.deepEqual(parseDelimitedU64Ids("1 2 3"), [1n, 2n, 3n])
  assert.deepEqual(parseDelimitedU64Ids(""), [])
  assert.deepEqual(parseDelimitedU64Ids(null), [])
  assert.deepEqual(parseDelimitedU64Ids(undefined), [])
})

test("parseDelimitedU64Ids preserves large IDs", () => {
  assert.deepEqual(parseDelimitedU64Ids("9007199254740993,42"), [9007199254740993n, 42n])
})

test("parseDelimitedU64Ids filters invalid entries", () => {
  assert.deepEqual(parseDelimitedU64Ids("1,-1,abc,3"), [1n, 3n])
})

// ── form-coercion compatibility ─────────────────────────────────────────────

test("optionalBigIntU64 preserves large strings via u64 delegation", () => {
  assert.equal(optionalBigIntU64("9007199254740993"), 9007199254740993n)
  assert.equal(optionalBigIntU64("18446744073709551615"), 18446744073709551615n)
})

test("nullableBigIntU64 preserves Option::Some and rejects negatives", () => {
  assert.equal(nullableBigIntU64({ some: "42" }), 42n)
  assert.equal(nullableBigIntU64({ some: "9007199254740993" }), 9007199254740993n)
  assert.equal(nullableBigIntU64("-1"), null)
  assert.equal(nullableBigIntU64(null), null)
})
