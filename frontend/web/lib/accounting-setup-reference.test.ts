import assert from "node:assert/strict"
import test from "node:test"
import { currencyCatalogContainsId } from "./accounting-setup-reference"

test("currency readiness compares exact identities across bootstrap and typed reads", () => {
  for (const id of [575, "575", 575n]) assert.equal(currencyCatalogContainsId([{ id }], 575n), true)
  assert.equal(currencyCatalogContainsId([{ id: "9007199254740993" }], 9007199254740993n), true)
  assert.equal(currencyCatalogContainsId([{ id: 9007199254740992 }], 9007199254740992n), false)
  for (const id of [null, undefined, "bad", "", 0, -1, 574]) assert.equal(currencyCatalogContainsId([{ id }], 575n), false)
  assert.equal(currencyCatalogContainsId([{ id: 575 }], 0n), false)
})
