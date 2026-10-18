import assert from "node:assert/strict"
import test from "node:test"

import { isInvalidationOnlyResource, realtimeQueryKeysForResource } from "./stdb"

function hasKey(keys: readonly unknown[], expected: unknown[]): boolean {
  return keys.some(key => JSON.stringify(key) === JSON.stringify(expected))
}

test("auth bundle invalidates concrete resources and settings views", () => {
  const keys = realtimeQueryKeysForResource("auth", 7)

  assert.equal(hasKey(keys, ["stdb", "user-profile", "7"]), true)
  assert.equal(hasKey(keys, ["user-role-assignment", "7"]), true)
  assert.equal(hasKey(keys, ["settings-roles", "7"]), true)
  assert.equal(hasKey(keys, ["settings-users", "7"]), true)
  assert.equal(hasKey(keys, ["user-role-assignments", "7"]), true)
  assert.equal(hasKey(keys, ["user-organizations", "7"]), true)
  assert.equal(hasKey(keys, ["current-user-profile"]), true)
})

test("form configuration bundle invalidates each form cache", () => {
  const keys = realtimeQueryKeysForResource("form-configuration", 9n)

  for (const resource of [
    "form-configs",
    "form-config-fields",
    "form-role-configs",
    "user-custom-fields",
    "form-field-labels",
  ]) {
    assert.equal(hasKey(keys, ["stdb", resource, "9"]), true)
    assert.equal(hasKey(keys, [resource, "9"]), true)
  }
})

test("only bundles require HTTP cache invalidation while the row cache is active", () => {
  assert.equal(isInvalidationOnlyResource("auth"), true)
  assert.equal(isInvalidationOnlyResource("form-configuration"), true)
  assert.equal(isInvalidationOnlyResource("account-moves"), false)
})
