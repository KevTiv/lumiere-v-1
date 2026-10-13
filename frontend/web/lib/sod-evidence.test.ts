import assert from "node:assert/strict"
import { test } from "node:test"

import { actorIdentity, canonicalOptionValue } from "../tests/e2e/sod-evidence"

test("persisted actor evidence decodes supported SATS identity and option shapes", () => {
  const hex = "ab".repeat(32)
  const values = [
    hex,
    `0x${hex.toUpperCase()}`,
    { some: hex },
    { Some: { __identity__: hex } },
    { value: { hex } },
    [hex],
    [0, hex],
    Array(32).fill(0xab),
  ]
  for (const value of values) assert.equal(actorIdentity(value), hex)
})

test("missing or malformed persisted actor evidence cannot satisfy second-person proof", () => {
  const invalid = [undefined, null, "", "unknown", { none: [] }, [1, []], "ab".repeat(31), Array(32).fill(256)]
  for (const value of invalid) assert.throws(() => actorIdentity(value), /missing or invalid actor identity evidence/)
})

test("canonical option evidence decodes raw SATS SQL and object wrappers", () => {
  assert.equal(canonicalOptionValue([0, 42]), 42)
  assert.equal(canonicalOptionValue([0, "Timesheets"]), "Timesheets")
  assert.equal(canonicalOptionValue([0, [42]]), 42)
  assert.equal(canonicalOptionValue([0, ["Timesheets"]]), "Timesheets")
  assert.equal(canonicalOptionValue([1, []]), null)
  assert.equal(canonicalOptionValue({ some: 42 }), 42)
  assert.equal(canonicalOptionValue({ some: [42] }), 42)
  assert.equal(canonicalOptionValue({ none: [] }), null)
  assert.deepEqual(canonicalOptionValue([2, [42]]), [2, [42]])
  assert.deepEqual(canonicalOptionValue([0, []]), [])
})
