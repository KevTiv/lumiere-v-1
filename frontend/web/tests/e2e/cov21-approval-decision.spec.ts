import { expect, request as playwrightRequest, test, type Browser, type Page, type Request } from "@playwright/test"

import {
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  callReducerBff,
  expectNoAppError,
  fetchAdminRoleId,
  fetchDefaultCompanyId,
  fetchPurchaseOrderIdByExactOrigin,
  fetchPurchaseOrderSelectLabel,
  fetchSessionOrganizationId,
  fetchVendorPartnerIdByName,
  fillField,
  gotoApprovals,
  gotoModule,
  scalarQueryId,
  seedPurchaseOrderApprovalWorkflow,
  selectEntityRowById,
  signIn,
  smokeName,
  submitForm,
  waitForEntityActionEnabled,
  waitForPendingApprovalRequest,
  waitForPurchaseOrderState,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

// COV-21 — see docs/plan/erp-cov21-approval-decision-status.md.
// Requires `seed_dev_data` (vendor `Globex Corp`, product `Lumiere Dev Laptop`), like the
// parity phase 3 approvals spec whose purchase-order approval fixture this reuses.
const VENDOR_NAME = "Globex Corp"
const APPROVER_PASSWORD = "Password123$"
const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

type Row = Record<string, unknown>

async function provisionIndependentApprover(page: Page, browser: Browser) {
  const email = `${smokeName("approval-reviewer")}@example.test`
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100"
  const signup = await playwrightRequest.newContext({ baseURL })
  let identity: string
  try {
    const response = await signup.post("/api/auth/signup", {
      data: { email, password: APPROVER_PASSWORD },
    })
    if (!response.ok()) {
      throw new Error(`approver signup failed (${response.status()}): ${await response.text()}`)
    }
    const state = await signup.storageState()
    const rawIdentity = state.cookies.find((cookie) => cookie.name === "stdb_identity")?.value
    if (!rawIdentity) throw new Error("approver signup did not set stdb_identity")
    identity = rawIdentity.replace(/^0x/i, "")
  } finally {
    await signup.dispose()
  }

  const organizationId = await fetchSessionOrganizationId(page)
  const companyId = await fetchDefaultCompanyId(page)
  const adminRoleId = await fetchAdminRoleId(page)
  await callReducerBff(page, "add_org_member", [
    identity,
    organizationId,
    {
      role_name: "admin",
      company_id: companyId,
      job_title: null,
      department_id: null,
      employee_id: null,
      is_active: true,
      is_default: true,
      metadata: null,
    },
  ])
  await callReducerBff(page, "assign_role", [
    identity,
    adminRoleId,
    organizationId,
    { expires_at_micros: null, metadata: null },
  ])

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const approverPage = await context.newPage()
  await signIn(approverPage, email, APPROVER_PASSWORD)
  return { context, page: approverPage }
}

async function replay(page: Page, request: Request, freshKey = false) {
  const url = new URL(request.url())
  const body = JSON.stringify(request.postDataJSON()).replace(
    /("idempotency_?[kK]ey"\s*:\s*")([^"]*)(")/g,
    (_m, a, v, c) => (freshKey ? `${a}${v}-cov21-stale${c}` : `${a}${v}${c}`),
  )
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(body),
  })
}

function tag(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return typeof record.tag === "string" ? record.tag : (Object.keys(record)[0] ?? "")
  }
  return ""
}

async function taskSnapshot(page: Page, taskId: number) {
  const response = await page.request.get("/api/query/workflow-human-tasks")
  if (!response.ok()) throw new Error(`workflow-human-tasks query failed: ${response.status()}`)
  const rows = ((await response.json()) as { data?: Row[] }).data ?? []
  const matches = rows.filter((row) => scalarQueryId(row.id) === taskId)
  if (matches.length !== 1) throw new Error(`expected one task ${taskId}, found ${matches.length}`)
  const row = matches[0]!
  return {
    id: taskId,
    organizationId: scalarQueryId(row.organizationId ?? row.organization_id),
    status: tag(row.status),
    decision: tag(row.decision),
    hasDecider: (row.decidedBy ?? row.decided_by ?? null) != null,
    revision: Number(row.revision),
  }
}

test.describe("COV-21 exact human-task decision", { tag: ["@dev-fixture", "@cov21"] }, () => {
  test("approves the selected task through the UI; replay is safe, a stale decision is rejected, a reader is denied", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000)
      const ruleName = smokeName("approval-po")
      const origin = smokeName("approval-po")
      const vendorPartnerId = await fetchVendorPartnerIdByName(page, VENDOR_NAME)

      const approvalWorkflow = await seedPurchaseOrderApprovalWorkflow(page, {
        workflowKey: ruleName.toLowerCase().replace(/-/g, "_"),
        name: ruleName,
      })

      try {
        await gotoModule(page, "/purchasing", "purchasing")
      await page.getByTestId("module-tab-purchasing-orders").click()
      await page.getByTestId("module-create-purchasing-orders").click()
      await expect(page.getByTestId("form-modal-new-purchase-order")).toBeVisible()
      await chooseSelectOptionByLabel(page, "partnerId", VENDOR_NAME)
      await chooseFirstEnabledOption(page, "pricelistId")
      await fillField(page, "origin", origin)
      const [createPoRes] = await Promise.all([
        page.waitForResponse(
          (res) => matchesOperationResponse(res, "create_purchase_order") && res.ok(),
          { timeout: 30_000 },
        ),
        submitForm(page, "new-purchase-order"),
      ])
      expect(createPoRes.ok()).toBe(true)

      const orderId = await fetchPurchaseOrderIdByExactOrigin(page, vendorPartnerId, origin)
      const orderLabel = await fetchPurchaseOrderSelectLabel(page, orderId)

      await page.getByTestId("module-tab-purchasing-lines").click()
      await page.getByTestId("entity-action-pol-add-form").click()
      await expect(page.getByTestId("form-modal-add-purchase-order-line")).toBeVisible()
      await chooseSelectOptionByLabel(page, "orderId", orderLabel)
      await chooseSelectOptionByLabel(page, "productId", "Lumiere Dev Laptop")
      await chooseFirstEnabledOption(page, "uomId")
      await fillField(page, "quantity", "2")
      await fillField(page, "priceUnit", "500")
      const [lineRes] = await Promise.all([
        page.waitForResponse(
          (res) => matchesOperationResponse(res, "add_purchase_order_line") && res.ok(),
          { timeout: 30_000 },
        ),
        submitForm(page, "add-purchase-order-line"),
      ])
      expect(lineRes.ok()).toBe(true)

      await page.getByTestId("module-tab-purchasing-orders").click()
      await selectEntityRowById(page, orderId)
      await waitForEntityActionEnabled(page, "entity-action-po-confirm")
      await page.getByTestId("entity-action-po-confirm").click()


      const taskId = await waitForPendingApprovalRequest(page, "purchase_order", orderId)
      const approver = await provisionIndependentApprover(page, browser)
      const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
      try {
        const organizationId = await fetchSessionOrganizationId(page)
        const open = await taskSnapshot(approver.page, taskId)
        expect(open).toMatchObject({ id: taskId, organizationId, decision: "", hasDecider: false })
        expect(["Open", "Claimed"]).toContain(open.status)

        await gotoApprovals(approver.page)
        await expect(approver.page.getByTestId(`approval-card-${taskId}`)).toBeVisible({ timeout: 30_000 })
        const [decided] = await Promise.all([
          approver.page.waitForResponse(
            (response) => matchesOperationResponse(response, "decide_workflow_human_task"),
            { timeout: 60_000 },
          ),
          approver.page.getByTestId(`approval-approve-${taskId}`).click(),
        ])
        expect(decided.ok()).toBe(true)

        await expect
          .poll(() => taskSnapshot(approver.page, taskId))
          .toMatchObject({ id: taskId, organizationId, status: "Approved", decision: "Approve", hasDecider: true })
        const approved = await taskSnapshot(approver.page, taskId)
        await waitForPurchaseOrderState(page, orderId, "Purchase")

        // An identical replay resolves through the idempotency receipt: same task, no change.
        const sameReplay = await replay(approver.page, decided.request())
        expect(sameReplay.ok()).toBe(true)
        expect(await taskSnapshot(approver.page, taskId)).toEqual(approved)

        // A new decision (fresh idempotency key) on the decided task is stale.
        const stale = await replay(approver.page, decided.request(), true)
        expect(stale.status()).toBe(422)
        expect(await taskSnapshot(approver.page, taskId)).toEqual(approved)

        const readerPage = await readerContext.newPage()
        await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
        const denied = await replay(readerPage, decided.request(), true)
        expect(denied.status()).toBe(403)
        expect(await taskSnapshot(approver.page, taskId)).toEqual(approved)
        await expectNoAppError(page)
      } finally {
        await readerContext.close()
        await approver.context.close()
      }
      } finally {
        await callReducerBff(page, "retire_workflow_version", [
          approvalWorkflow.organizationId,
          approvalWorkflow.versionId,
          approvalWorkflow.revision,
        ])
      }
  })
})
