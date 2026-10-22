import assert from "node:assert/strict"
import test from "node:test"
import { approvalActorOptions, approvalSelection, approvalTaskStatus, requireUnchangedApproval, resolveApprovalActor } from "./approval-controls"

const principal = "ab".repeat(32)
const row = { id: 41, companyId: 7, revision: 3, instanceRevision: 9, status: "Open", directlyEligible: true, actingForOptions: [{ identityHex: principal, label: "Approver" }] }

test("review controls decode each canonical status encoding and reject ambiguous variants", () => {
  for (const status of ["Open", { tag: "Open" }, { Open: [] }]) {
    assert.equal(approvalTaskStatus({ status }), "Open")
    assert.equal(approvalSelection({ ...row, status }, 7).requestId, 41)
  }
  for (const status of [{ Open: [], Cancelled: [] }, { tag: "Open", Cancelled: [] }, [], null]) {
    assert.equal(approvalTaskStatus({ status }), undefined)
  }
})

test("approval retains exactly the operator's company and revisions", () => {
  assert.deepEqual(approvalSelection(row, 7), { requestId: 41, companyId: 7, expectedTaskRevision: 3, expectedInstanceRevision: 9, actingFor: null })
  assert.throws(() => approvalSelection(row, 8), /another company/)
  for (const invalid of [{ ...row, revision: undefined }, { ...row, instanceRevision: 0 }, { ...row, status: "Approved" }]) {
    assert.throws(() => approvalSelection(invalid, 7))
  }
})

test("a delegate can select only a currently projected principal", () => {
  assert.equal(approvalSelection(row, 7, principal).actingFor, principal)
  assert.throws(() => approvalSelection(row, 7, "cd".repeat(32)), /eligible approval principal/)
  assert.throws(() => approvalSelection({ ...row, actingForOptions: [] }, 7, principal), /eligible approval principal/)
})

test("actor resolution fails closed and auto-selects only an unambiguous principal", () => {
  const delegatedOnly = { ...row, directlyEligible: false }
  assert.equal(resolveApprovalActor(row), "")
  assert.equal(resolveApprovalActor(delegatedOnly), principal)
  assert.equal(resolveApprovalActor(delegatedOnly, ""), null)
  assert.equal(resolveApprovalActor({ ...delegatedOnly, actingForOptions: [] }), null)
  assert.equal(resolveApprovalActor({ ...delegatedOnly, actingForOptions: [
    ...delegatedOnly.actingForOptions, { identityHex: "cd".repeat(32), label: "Second" },
  ] }), null)
  assert.throws(() => approvalSelection({ ...delegatedOnly, actingForOptions: [] }, 7), /eligible approval principal/)
  assert.deepEqual(approvalActorOptions({ ...row, actingForOptions: [
    { identityHex: `0x${principal.toUpperCase()}`, label: " Approver " },
    { identityHex: principal, label: "Duplicate" },
    { identityHex: "invalid", label: "Invalid" },
  ] }), [{ identityHex: principal, label: "Approver" }])
})

test("stale task, workflow, company and delegation selections fail before dispatch", () => {
  const selected = approvalSelection(row, 7, principal)
  requireUnchangedApproval(selected, row)
  for (const changed of [{ ...row, revision: 4 }, { ...row, instanceRevision: 10 }, { ...row, companyId: 8 },
    { ...row, id: 42 }, { ...row, actingForOptions: [] }]) assert.throws(() => requireUnchangedApproval(selected, changed))
})
