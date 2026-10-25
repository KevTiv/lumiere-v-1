import assert from "node:assert/strict"
import test from "node:test"
import {
  parseWorkActivitiesPage, requireCurrentWorkActivity, sameWorkActivity,
  workActivitiesQueryKey, workActivitiesQueryPath, type WorkActivityRow,
} from "./work-activities"
import type { WorkBoardScope } from "./work-board-model"

const scope: WorkBoardScope = { organizationId: 42, companyId: 7, actorIdentity: "a".repeat(64), authorizationKey: "grant-1", scope: "finance", view: "eligible" }
const row: WorkActivityRow = { id: 1, organizationId: 42, companyId: 7, workModule: "purchasing", summary: "Call supplier", resModel: "purchase_order", resId: 9, state: "open", isDone: false, workAssignedToMe: false, workIsAssigned: false, workTeamRefs: [], workActions: ["complete"] }

test("follow-up paths and cache keys bind actor, authorization, company, module and department", () => {
  assert.match(workActivitiesQueryPath(scope), /^\/api\/query\/activities\?/)
  assert.match(workActivitiesQueryPath(scope, null, 1), /activityId=1$/)
  assert.throws(() => workActivitiesQueryPath({ ...scope, team: "workflow-group:3" }), /department/)
  for (const changed of [{ actorIdentity: "b".repeat(64) }, { authorizationKey: "grant-2" }, { companyId: 8 }, { scope: "sales" as const }, { team: "department:3" }, { view: "mine" as const }]) {
    assert.notDeepEqual(workActivitiesQueryKey(scope), workActivitiesQueryKey({ ...scope, ...changed }))
  }
})

test("follow-up parser fails closed on mismatched source, scope, lifecycle and unsupported actions", () => {
  assert.deepEqual(parseWorkActivitiesPage({ data: [row], nextCursor: null }, scope).data, [row])
  for (const change of [{ organizationId: 43 }, { companyId: 8 }, { workModule: "accounting" }, { resModel: "hr_expense_sheet" }, { resId: "9007199254740993" }, { state: "overdue" }, { isDone: true }, { workActions: ["approve"] }, { workTeamRefs: [{ kind: "workflow-group", id: "1" }] }]) {
    assert.throws(() => parseWorkActivitiesPage({ data: [{ ...row, ...change }] }, scope))
  }
  assert.throws(() => parseWorkActivitiesPage({ data: [row, row] }, scope))
})

test("hidden assignment and deadline fields stay absent instead of becoming fabricated data", () => {
  const parsed = parseWorkActivitiesPage({ data: [{ ...row, workIsAssigned: true, note: "hidden note", metadata: { private: true } }] }, scope).data[0]!
  assert.equal(parsed.workIsAssigned, true)
  assert.equal(Object.hasOwn(parsed, "assignedTo"), false)
  assert.equal(Object.hasOwn(parsed, "dateDeadline"), false)
  assert.equal(Object.hasOwn(parsed, "updatedAt"), false)
  assert.equal(Object.hasOwn(parsed, "note"), false)
  assert.equal(Object.hasOwn(parsed, "metadata"), false)
})

test("follow-up parser enforces selected views and assignment consistency", () => {
  const mine = { ...row, workAssignedToMe: true, workIsAssigned: true }
  const done = { ...row, state: "done", isDone: true, workActions: [] }
  assert.equal(parseWorkActivitiesPage({ data: [mine] }, { ...scope, view: "mine" }).data.length, 1)
  assert.equal(parseWorkActivitiesPage({ data: [row] }, { ...scope, view: "available" }).data.length, 1)
  assert.throws(() => parseWorkActivitiesPage({ data: [row] }, { ...scope, view: "mine" }))
  assert.throws(() => parseWorkActivitiesPage({ data: [mine] }, { ...scope, view: "available" }))
  assert.throws(() => parseWorkActivitiesPage({ data: [done] }, { ...scope, view: "available" }))
  for (const changed of [
    { workAssignedToMe: true },
    { workIsAssigned: true, assignedTo: null },
    { assignedTo: scope.actorIdentity },
    { workIsAssigned: true, assignedTo: scope.actorIdentity },
    { workIsAssigned: true, workAssignedToMe: true, assignedTo: "b".repeat(64) },
  ]) assert.throws(() => parseWorkActivitiesPage({ data: [{ ...row, ...changed }] }, scope))
  assert.equal(parseWorkActivitiesPage({ data: [{ ...mine, assignedTo: scope.actorIdentity }] }, scope).data[0]!.assignedTo, scope.actorIdentity)
})

test("completion preflight rejects stale, denied, missing, finished and rebound records", () => {
  assert.deepEqual(requireCurrentWorkActivity([row], row), row)
  for (const changed of [{ companyId: 8 }, { organizationId: 43 }, { resId: 10 }, { workActions: [] }, { isDone: true, state: "done" as const }]) {
    assert.throws(() => requireCurrentWorkActivity([{ ...row, ...changed }], row), /Refresh/)
  }
  assert.throws(() => requireCurrentWorkActivity([], row), /Refresh/)
  assert.throws(() => requireCurrentWorkActivity([row, row], row), /Refresh/)
  assert.throws(() => requireCurrentWorkActivity([{ ...row, updatedAt: "new" }], { ...row, updatedAt: "old" }), /changed/)
  assert.equal(sameWorkActivity({ ...row, resModel: "sale_order", workModule: "sales" }, row), false)
})
