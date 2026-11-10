import assert from "node:assert/strict"
import test from "node:test"
import type { WorkTaskRow } from "@lumiere/query-hooks/hooks/work-board-model"
import {
  groupWorkflowWork,
  recordFollowupHref,
  workflowNextStep,
} from "./workflow-work-queue"

const task: WorkTaskRow = {
  id: 1,
  status: "Open",
  directlyEligible: true,
  workAssignedToMe: false,
  workModule: "sales",
  workActions: ["claim"],
  workTeamRefs: [],
}

test("stopped workflows appear first, with next steps limited to canonical capabilities", () => {
  const cancelled: WorkTaskRow = {
    ...task,
    id: 2,
    status: "Cancelled",
    workActions: ["resubmit"],
  }
  const invalidated: WorkTaskRow = { ...task, id: 3, status: "Invalidated" }
  const approved: WorkTaskRow = { ...task, id: 4, status: "Approved" }
  assert.deepEqual(
    groupWorkflowWork([task, approved, cancelled, invalidated]).map(
      ({ id, rows }) => [id, rows.map((row) => row.id)],
    ),
    [
      ["blocked", [2, 3]],
      ["active", [1]],
      ["resolved", [4]],
    ],
  )
  assert.equal(workflowNextStep(task), "claim")
  assert.equal(workflowNextStep(cancelled), "resubmit")
  assert.equal(workflowNextStep(invalidated), "inspect")
  assert.equal(workflowNextStep(approved), "view")
  assert.equal(
    workflowNextStep({ ...task, directlyEligible: false, workActions: [] }),
    "wait",
  )
})

test("follow-up links use only verified detail routes with a Discussion composer", () => {
  assert.equal(
    recordFollowupHref("sale_order", 42),
    "/sales/orders/42?tab=discussion",
  )
  assert.equal(
    recordFollowupHref("purchase_order", 42),
    "/purchasing/orders/42?tab=discussion",
  )
  assert.equal(recordFollowupHref("account_move", 42), undefined)
  assert.equal(recordFollowupHref("sale_order", -1), undefined)
})
