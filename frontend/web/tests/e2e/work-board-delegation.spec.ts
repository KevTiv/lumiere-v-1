import { expect, test, type APIResponse, type Page, type Route } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { stdbBffCallUrl } from "@lumiere/stdb/commands/stdb-http"
import { encodeIdentity, stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { workflowDelegationMetadata } from "@lumiere/erp-shared/workflow-delegation"
import { approvalTaskStatus } from "@lumiere/query-hooks/hooks/approval-controls"
import { matchesOperationResponse } from "./operation-response"
import { actorIdentity, canonicalOptionValue, canonicalSumTag } from "./sod-evidence"
import { field, idOf, openActorPages, provisionActor, queryRows, tagOf, type Actor } from "./pretenant-support"
import {
  WORK_REVIEWER_PERMISSIONS,
  seedWorkReviewWorkflow,
  workScopeFor,
  createPendingWorkReview,
  readWorkTask,
  openWorkReview,
  postWorkCommand,
} from "./work-board-acceptance-support"

const DELEGATE_PERMISSIONS = [
  "company:read", "workflow:read", "purchase_order:read", "purchase_order:write",
  "stock_picking:create", "stock_move:create",
]
const decisionPath = stdbBffCallUrl("decide_workflow_human_task")
type PersistedRow = Record<string, unknown>

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${label}`)
  return value
}

function identityLiteral(value: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("Invalid fixture actor identity")
  return `0x${value}`
}

/** Read-only committed-state observer for private task evidence and test profiles. */
async function persistedRows(sql: string): Promise<PersistedRow[]> {
  const host = (process.env.E2E_STDB_HOST ?? process.env.STDB_HOST ?? "http://127.0.0.1:3000").replace(/\/$/, "")
  const moduleName = process.env.STDB_MODULE?.trim()
  const token = process.env.STDB_SERVER_TOKEN?.trim()
  if (!moduleName || !token) throw new Error("Delegation observer requires STDB_MODULE and STDB_SERVER_TOKEN")
  const response = await fetch(`${host}/v1/database/${moduleName}/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
    body: sql,
  })
  if (!response.ok) throw new Error(`Delegation evidence read failed (${response.status})`)
  const sets = await response.json() as Array<{
    schema?: { elements?: Array<{ name?: { some?: string } }> }
    rows?: unknown[][]
  }>
  const names = sets[0]?.schema?.elements?.map((element) => element.name?.some)
  const rows = sets[0]?.rows
  if (sets.length !== 1 || !names?.length || names.some((name) => !name) || !Array.isArray(rows)) {
    throw new Error("Delegation evidence returned an invalid SQL result")
  }
  return rows.map((values) => {
    if (values.length !== names.length) throw new Error("Delegation evidence row width mismatch")
    return Object.fromEntries(names.map((name, index) => [name!, values[index]]))
  }).sort((left, right) => String(left.id ?? left.scope_key).localeCompare(String(right.id ?? right.scope_key)))
}

async function assertOrdinaryActor(organizationId: number, actor: Actor) {
  expect(actor.email.endsWith("@example.test")).toBe(true)
  const profiles = await persistedRows(`SELECT identity, is_superuser FROM user_profile WHERE organization_id = ${positiveId(organizationId, "organization")} AND identity = ${identityLiteral(actor.identityHex)}`)
  expect(profiles).toHaveLength(1)
  expect(profiles[0]!.is_superuser).toBe(false)
  expect(actorIdentity(profiles[0]!.identity)).toBe(actor.identityHex)
}

async function setDelegation(principalPage: Page, companyId: number, principal: Actor, delegate: Actor, active: boolean) {
  const now = Date.now()
  const metadata = active ? workflowDelegationMetadata(
    new Date(now - 60_000).toISOString(),
    new Date(now + 3_600_000).toISOString(),
    "Live work-board delegation revocation acceptance",
    now,
  ) : null
  const params = stdbParamsToJson({
    principalIdentity: encodeIdentity(principal.identityHex),
    delegateIdentity: encodeIdentity(delegate.identityHex),
    isActive: active,
    metadata,
  }, "SetPurchaseApprovalDelegateParams")
  const response = await postWorkCommand(principalPage, stdbBffCommandPost("set_purchase_approval_delegate", { companyId, params }))
  expect(response.ok(), await response.text()).toBe(true)
}

async function liveDelegations(organizationId: number, companyId: number, principal: Actor, delegate: Actor) {
  return persistedRows(`SELECT id, is_active FROM workflow_delegation WHERE organization_id = ${positiveId(organizationId, "organization")} AND company_id = ${positiveId(companyId, "company")} AND delegator_identity = ${identityLiteral(principal.identityHex)} AND delegatee_identity = ${identityLiteral(delegate.identityHex)} AND is_active = true`)
}

async function committedWorkEvidence(
  owner: Page,
  scope: { organizationId: number; companyId: number; taskId: number; orderId: number },
) {
  const org = positiveId(scope.organizationId, "organization")
  const company = positiveId(scope.companyId, "company")
  const task = positiveId(scope.taskId, "task")
  const order = positiveId(scope.orderId, "purchase order")
  const tenant = `organization_id = ${org} AND company_id = ${company}`
  const [tasks, candidates, taskEvents, taskReceipts, domainReceipts, orders, apiOrders, apiPickings] = await Promise.all([
    persistedRows(`SELECT * FROM workflow_human_task WHERE ${tenant} AND id = ${task}`),
    persistedRows(`SELECT * FROM workflow_human_task_candidate WHERE ${tenant} AND task_id = ${task}`),
    persistedRows(`SELECT * FROM workflow_human_task_event WHERE ${tenant} AND task_id = ${task}`),
    persistedRows(`SELECT * FROM workflow_human_task_receipt WHERE ${tenant} AND task_id = ${task}`),
    persistedRows(`SELECT * FROM guarded_action_receipt WHERE ${tenant} AND subject_id = ${order}`),
    persistedRows(`SELECT * FROM purchase_order WHERE ${tenant} AND id = ${order}`),
    queryRows(owner, "purchase-orders"),
    queryRows(owner, "stock-pickings"),
  ])
  return {
    tasks, candidates, taskEvents, taskReceipts, orders,
    domainReceipts: domainReceipts.filter((row) =>
      canonicalSumTag(row.subject_kind, ["PurchaseOrder"]) === "PurchaseOrder"),
    apiOrders: apiOrders.filter((row) => idOf(field(row, "id")) === order),
    apiPickings: apiPickings.filter((row) => idOf(field(row, "purchaseId", "purchase_id")) === order),
  }
}

async function expectDelegationDenied(response: APIResponse) {
  const body = await response.text()
  expect([403, 422], body).toContain(response.status())
  expect(body).toContain("no effective workflow delegation exists for this actor")
}

test.describe("Finance work board live delegation revocation", { tag: ["@dev-fixture", "@work-board"] }, () => {
  test("revocation denies queued decisions and replay; restored delegation permits a fresh attributed review", async ({ page, browser }) => {
    test.setTimeout(300_000)
    const [principal, delegate] = await Promise.all([
      provisionActor(page, "work-delegation-principal", WORK_REVIEWER_PERMISSIONS),
      provisionActor(page, "work-delegation-actor", DELEGATE_PERMISSIONS),
    ])
    const workflow = await seedWorkReviewWorkflow(page, [principal.roleId])
    const sessions = await openActorPages(browser, [principal, delegate])
    const [principalPage, delegatePage] = sessions.pages
    let pendingRoute: Route | undefined
    let delegationActive = false
    try {
      if (!principalPage || !delegatePage) throw new Error("Missing independent principal/delegate sessions")
      await Promise.all([
        assertOrdinaryActor(workflow.organizationId, principal),
        assertOrdinaryActor(workflow.organizationId, delegate),
      ])
      const delegateRole = (await queryRows(page, "roles")).find((row) => idOf(field(row, "id")) === delegate.roleId)
      expect(delegateRole).toBeDefined()
      const permissions = field(delegateRole, "permissions")
      expect(Array.isArray(permissions)).toBe(true)
      expect([...(permissions as string[])].sort()).toEqual(["organization:read", ...DELEGATE_PERMISSIONS].sort())
      expect((permissions as string[]).some((permission) => permission.startsWith("workflow_task:"))).toBe(false)

      const pending = await createPendingWorkReview(page, principalPage)
      const scope = workScopeFor(workflow, delegate)
      // Source access and exact PO operation permissions alone do not make this
      // ordinary actor a candidate or give it a direct decision action.
      expect(await readWorkTask(delegatePage, scope, pending.taskId)).toBeUndefined()
      await setDelegation(principalPage, workflow.companyId, principal, delegate, true)
      delegationActive = true
      expect(await liveDelegations(workflow.organizationId, workflow.companyId, principal, delegate)).toHaveLength(1)

      const before = await openWorkReview(delegatePage, scope, pending.taskId)
      expect(before.directlyEligible).toBe(false)
      expect(before.workActions).toEqual([])
      expect(before.actingForOptions).toHaveLength(1)
      expect(before.actingForOptions![0]!.identityHex).toBe(principal.identityHex)
      expect(before.actingForOptions![0]!.workActions).toContain("approve")
      const title = before.workSourceTitle || `${before.subjectModel ?? before.subject_model ?? ""} #${before.subjectId ?? before.subject_id ?? before.id}`
      const review = delegatePage.getByRole("dialog", { name: title, exact: true })
      // The native label also contains its option text. Use the control's
      // accessible name, then verify the exact principal being reviewed.
      const actingAs = review.getByRole("combobox", { name: "Acting as", exact: true })
      await expect(review).toBeVisible()
      await expect(actingAs).toBeVisible()
      await expect(actingAs).toBeEnabled()
      await expect(actingAs).toHaveValue(principal.identityHex)
      await expect(review.getByRole("button", { name: "Approve", exact: true })).toBeEnabled()
      await review.getByRole("textbox").fill("A delegated comment that must be discarded after revocation")
      const evidenceScope = { ...workflow, ...pending }
      const baseline = await committedWorkEvidence(page, evidenceScope)
      expect(baseline.tasks).toHaveLength(1)
      expect(baseline.orders).toHaveLength(1)
      expect(baseline.apiOrders).toHaveLength(1)
      expect(tagOf(field(baseline.apiOrders[0], "state"))).toBe("draft")
      expect(baseline.domainReceipts).toHaveLength(0)
      expect(baseline.apiPickings).toHaveLength(0)
      const cookies = (await delegatePage.context().cookies()).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")
      expect(cookies.length).toBeGreaterThan(0)

      // Only delay delivery. The UI builds its real typed command, and the
      // original authenticated request is later forwarded to the real backend.
      await delegatePage.route((url) => url.pathname === decisionPath, (route) => {
        if (route.request().method() !== "POST") return route.continue()
        pendingRoute = route
      }, { times: 1 })
      await review.getByRole("button", { name: "Approve", exact: true }).click()
      await expect.poll(() => pendingRoute != null).toBe(true)
      const body = pendingRoute!.request().postDataJSON() as { params?: Record<string, unknown> }
      expect(body.params).toBeDefined()
      expect(Number(body.params!.task_id)).toBe(pending.taskId)
      expect(Number(body.params!.company_id)).toBe(workflow.companyId)
      expect(tagOf(body.params!.decision)).toBe("approve")
      expect(actorIdentity(canonicalOptionValue(body.params!.acting_for))).toBe(principal.identityHex)

      await setDelegation(principalPage, workflow.companyId, principal, delegate, false)
      delegationActive = false
      expect(await liveDelegations(workflow.organizationId, workflow.companyId, principal, delegate)).toHaveLength(0)
      const exactPath = `/api/query/workflow-human-tasks?companyId=${workflow.companyId}&workScope=purchasing&workView=eligible&taskId=${pending.taskId}`
      const revoked = await delegatePage.request.get(exactPath)
      expect(revoked.status(), await revoked.text()).toBe(200)
      expect((await revoked.json()).data).toEqual([])
      await expect(review).toHaveCount(0, { timeout: 35_000 })
      await expect(delegatePage.getByText(title, { exact: true })).toHaveCount(0)

      const response = await pendingRoute!.fetch()
      await expectDelegationDenied(response)
      await pendingRoute!.fulfill({ response })
      pendingRoute = undefined
      const replay = await delegatePage.request.post(decisionPath, {
        headers: { "Content-Type": "application/json", Cookie: cookies },
        data: body,
      })
      await expectDelegationDenied(replay)
      expect(await committedWorkEvidence(page, evidenceScope)).toEqual(baseline)
      const principalRead = await readWorkTask(principalPage, workScopeFor(workflow, principal), pending.taskId)
      expect(approvalTaskStatus({ status: principalRead?.status })).toBe("Open")
      expect(Number(principalRead?.revision)).toBe(Number(before.revision))

      // Restoring a fresh effective delegation may restore the card, but must
      // not reopen the old review or resurrect its captured comment/attempt.
      await setDelegation(principalPage, workflow.companyId, principal, delegate, true)
      delegationActive = true
      expect(await liveDelegations(workflow.organizationId, workflow.companyId, principal, delegate)).toHaveLength(1)
      const restored = delegatePage.getByRole("button", { name: title, exact: true })
      await expect(restored).toBeVisible({ timeout: 35_000 })
      await expect(review).toHaveCount(0)
      await restored.click()
      await expect(review).toBeVisible()
      await expect(review.getByRole("textbox")).toHaveValue("")
      await expect(actingAs).toBeVisible()
      await expect(actingAs).toBeEnabled()
      await expect(actingAs).toHaveValue(principal.identityHex)
      await expect(review.getByRole("button", { name: "Approve", exact: true })).toBeEnabled()
      const freshComment = "A fresh review after delegation was restored"
      await review.getByRole("textbox").fill(freshComment)
      const [approved] = await Promise.all([
        delegatePage.waitForResponse((result) => result.request().method() === "POST"
          && matchesOperationResponse(result, "decide_workflow_human_task")),
        review.getByRole("button", { name: "Approve", exact: true }).click(),
      ])
      expect(approved.ok(), await approved.text()).toBe(true)
      await expect(delegatePage.getByText("Assignment updated and confirmed.", { exact: true })).toBeVisible({ timeout: 30_000 })
      const freshParams = approved.request().postDataJSON().params as Record<string, unknown>
      expect(freshParams.idempotency_key).not.toBe(body.params!.idempotency_key)
      const completed = await readWorkTask(principalPage, workScopeFor(workflow, principal), pending.taskId)
      expect(approvalTaskStatus({ status: completed?.status })).toBe("Approved")
      expect(Number(completed?.revision)).toBe(Number(before.revision) + 1)

      const committed = await committedWorkEvidence(page, evidenceScope)
      expect(committed.domainReceipts).toHaveLength(1)
      expect(committed.apiOrders).toHaveLength(1)
      expect(tagOf(field(committed.apiOrders[0], "state"))).toBe("purchase")
      const receipts = committed.taskReceipts.filter((row) => row.idempotency_key === freshParams.idempotency_key)
      const events = committed.taskEvents.filter((row) => row.idempotency_key === freshParams.idempotency_key)
      expect(receipts).toHaveLength(1)
      expect(events).toHaveLength(1)
      expect(actorIdentity(receipts[0]!.created_by)).toBe(delegate.identityHex)
      expect(actorIdentity(events[0]!.actor)).toBe(delegate.identityHex)
      expect(actorIdentity(canonicalOptionValue(events[0]!.acting_for))).toBe(principal.identityHex)
      expect(canonicalOptionValue(events[0]!.comment)).toBe(freshComment)
    } finally {
      if (pendingRoute) await pendingRoute.abort().catch(() => {})
      if (delegationActive && principalPage) await setDelegation(principalPage, workflow.companyId, principal, delegate, false)
      await sessions.close()
      await workflow.retire()
    }
  })
})
