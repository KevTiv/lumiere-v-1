import assert from "node:assert/strict"
import test from "node:test"

import fixtures from "./wire-codec-fixtures.json" with { type: "json" }
import { decodeCompact, encodeCompact, type CompactCodecCase } from "./wire-codec"

const cases = fixtures.cases as CompactCodecCase[]

test("compact codec encodes the shared golden corpus", () => {
  for (const fixture of cases.filter((item) => !item.error)) {
    assert.deepEqual(
      encodeCompact(fixture.type, fixture.input),
      fixture.wire,
      fixture.name,
    )
  }
})

test("compact codec decodes the shared golden corpus", () => {
  for (const fixture of cases.filter((item) => !item.error)) {
    assert.deepEqual(
      decodeCompact(fixture.type, fixture.wire),
      fixture.canonical ?? fixture.input,
      fixture.name,
    )
  }
})

test("compact codec rejects malformed input corpus", () => {
  for (const fixture of cases.filter((item) => item.error)) {
    if (fixture.wire === undefined) {
      assert.throws(
        () => encodeCompact(fixture.type, fixture.input),
        new RegExp(`compact-codec:${fixture.error}`),
        fixture.name,
      )
    }
    if (fixture.wire !== undefined) {
      assert.throws(
        () => decodeCompact(fixture.type, fixture.wire),
        new RegExp(`compact-codec:${fixture.error}`),
        `${fixture.name} wire`,
      )
    }
  }
})
