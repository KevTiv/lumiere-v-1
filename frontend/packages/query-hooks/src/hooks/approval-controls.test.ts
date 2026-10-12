import assert from "node:assert/strict"
import test from "node:test"
import { approvalSelection, requireUnchangedApproval } from "./approval-controls"

const principal = "ab".repeat(32)
const row = { id: 41, companyId: 7, revision: 3, instanceRevision: 9, status: "Open", actingForOptions: [{ identityHex: principal, label: "Approver" }] }

test("approval retains exactly the operator's company and revisions", () => {
  assert.deepEqual(approvalSelection(row, 7), { requestId: 41, companyId: 7, expectedTaskRevision: 3, expectedInstanceRevision: 9, actingFor: null })
  assert.throws(() => approvalSelection(row, 8), /another company/)
  for (const invalid of [{ ...row, revision: undefined }, { ...row, instanceRevision: 0 }, { ...row, status: "Approved" }]) {
    assert.throws(() => approvalSelection(invalid, 7))
  }
})

test("a delegate can select only a currently projected principal", () => {
  assert.equal(approvalSelection(row, 7, principal).actingFor, principal)
  assert.throws(() => approvalSelection(row, 7, "cd".repeat(32)), /unavailable/)
  assert.throws(() => approvalSelection({ ...row, actingForOptions: [] }, 7, principal), /unavailable/)
})

test("stale task, workflow, company and delegation selections fail before dispatch", () => {
  const selected = approvalSelection(row, 7, principal)
  requireUnchangedApproval(selected, row)
  for (const changed of [{ ...row, revision: 4 }, { ...row, instanceRevision: 10 }, { ...row, companyId: 8 },
    { ...row, id: 42 }, { ...row, actingForOptions: [] }]) assert.throws(() => requireUnchangedApproval(selected, changed))
})
