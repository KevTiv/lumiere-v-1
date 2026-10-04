import assert from "node:assert/strict"
import test from "node:test"

import { singleAddedId } from "./effect-delta"

test("exactly one new id with every prior id retained is the effect", () => {
  assert.equal(singleAddedId(["1", "2"], ["1", "2", "5"]), "5")
  assert.equal(singleAddedId([], ["9"]), "9")
})

test("zero, several, or a lost prior id is unresolved, never the newest", () => {
  assert.equal(singleAddedId(["1"], ["1"]), undefined)
  assert.equal(singleAddedId(["1"], ["1", "5", "6"]), undefined)
  assert.equal(singleAddedId(["1", "2"], ["2", "5"]), undefined)
  assert.equal(singleAddedId(["1"], undefined), undefined)
})

test("a duplicated new id breaks the relation invariant and is unresolved", () => {
  assert.equal(singleAddedId(["1"], ["1", "5", "5"]), undefined)
})
