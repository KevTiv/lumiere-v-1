import assert from "node:assert/strict"
import test from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import { resolveSaleOrderApprovalTask } from "./sales-approval-task"
import type { HumanTaskRow } from "./approvals"

const scope = { organizationId: 1n, companyId: 3n }
const task = (over: Partial<HumanTaskRow> = {}): HumanTaskRow => ({
  id: "71",
  organizationId: 1,
  companyId: 3,
  subjectModel: "sale_order",
  subjectId: 42,
  status: "Open",
  ...over,
})

test("resolves the exact active sale-order approval task and canonical navigation", () => {
  const result = resolveSaleOrderApprovalTask([task()], scope, 42n)
  assert.equal(result?.id, "71")
  assert.equal(result?.href, "/approvals?taskId=71")
})

test("accepts snake-case and summary subject projections", () => {
  const snake = task({
    organizationId: undefined,
    companyId: undefined,
    subjectModel: undefined,
    subjectId: undefined,
    organization_id: 1,
    company_id: 3,
    summary: { subjectModel: "sale_order", subjectId: "42" },
    status: { tag: "Claimed" },
  })
  assert.equal(resolveSaleOrderApprovalTask([snake], scope, 42n)?.id, "71")
})

test("rejects inactive, foreign, wrong-subject and missing tasks", () => {
  for (const row of [
    task({ status: "Approved" }),
    task({ organizationId: 2 }),
    task({ companyId: 4 }),
    task({ subjectModel: "purchase_order" }),
    task({ subjectId: 43 }),
  ]) {
    assert.equal(resolveSaleOrderApprovalTask([row], scope, 42n), null)
  }
  assert.equal(resolveSaleOrderApprovalTask([], scope, 42n), null)
})

test("duplicate active tasks are invariant failure, never first-row selection", () => {
  assert.throws(
    () => resolveSaleOrderApprovalTask([task(), task({ id: "72" })], scope, 42n),
    AmbiguousOperationEffectError,
  )
})
