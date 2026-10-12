import assert from "node:assert/strict"
import test from "node:test"
import { workflowDelegationMetadata } from "./workflow-delegation"

test("delegation carries exact timestamps and an operator reason", () => {
  assert.deepEqual(JSON.parse(workflowDelegationMetadata("2030-01-01T10:00:00Z", "2030-01-01T11:00:00Z", " Cover leave ", 0)), {
    valid_from_micros: "1893492000000000", valid_until_micros: "1893495600000000", reason: "Cover leave",
  })
})

test("missing, expired and reversed delegation windows never become implicit indefinite grants", () => {
  for (const [from, until] of [["", ""], ["bad", "2030-01-01T11:00:00Z"],
    ["2030-01-01T11:00:00Z", "2030-01-01T10:00:00Z"], ["2020-01-01", "2020-01-02"]]) {
    assert.throws(() => workflowDelegationMetadata(from!, until!, "Cover leave", Date.UTC(2026, 9, 12)))
  }
  assert.throws(() => workflowDelegationMetadata("2030-01-01", "2030-01-02", " ", 0), /reason/)
})
