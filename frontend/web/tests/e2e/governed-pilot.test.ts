import assert from "node:assert/strict"
import { test } from "node:test"
import { governedPilotAgentId } from "./governed-pilot"

test("required AI rejects missing or invalid provisioning instead of skipping", () => {
  for (const value of [undefined, "", "0", "-1", "1.5", "NaN", "Infinity", "9007199254740992", "2e2"]) {
    assert.throws(() => governedPilotAgentId({ E2E_REQUIRE_AI: "1", E2E_GOV00_AGENT_ID: value }), /requires a provisioned/)
  }
})
test("optional AI can report a missing prerequisite", () => {
  assert.equal(governedPilotAgentId({}), null)
})
test("the exact registered positive agent is retained", () => {
  assert.equal(governedPilotAgentId({ E2E_REQUIRE_AI: "1", E2E_GOV00_AGENT_ID: " 42 " }), 42)
})
