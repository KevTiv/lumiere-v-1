import assert from "node:assert/strict"
import test from "node:test"
import { parseImportHandoffRecipients } from "./import-handoff-recipient-picker"

const clerk = "a".repeat(64)
const owner = "b".repeat(64)

test("the task recipient directory provides a human label with a canonical identity", () => {
  assert.deepEqual(parseImportHandoffRecipients({
    recipients: [{ value: `0x${owner.toUpperCase()}`, label: " Company Owner " }],
  }, clerk), [{ value: owner, label: "Company Owner" }])
  assert.deepEqual(parseImportHandoffRecipients({ recipients: [] }, clerk), [])
})

test("incomplete or ambiguous directory data cannot introduce selectable recipients", () => {
  for (const value of [
    {},
    { recipients: [null] },
    { recipients: [{ value: owner, label: " " }] },
    { recipients: [{ value: owner, label: owner }] },
    { recipients: [{ value: clerk, label: "Clerk" }] },
    { recipients: [{ value: owner, label: "Owner" }, { value: owner, label: "Other owner" }] },
  ]) assert.throws(() => parseImportHandoffRecipients(value, clerk))
})
