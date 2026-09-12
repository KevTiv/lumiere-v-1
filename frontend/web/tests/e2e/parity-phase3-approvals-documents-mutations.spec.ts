import { matchesOperationResponse } from "./operation-response"
/**
 * Requires `seed_dev_data` (via `make e2e-smoke` / `pnpm run e2e-seed-fixture`).
 *
 * Seeded records: vendor partner `Globex Corp`, product `Lumiere Dev Laptop`.
 */
import { expect, request as playwrightRequest, test, type Browser, type Page } from "@playwright/test"

import {
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  callReducerBff,
  expectNoAppError,
  fetchAdminRoleId,
  fetchDefaultCompanyId,
  fetchLatestPurchaseOrderIdByPartner,
  fetchPurchaseOrderSelectLabel,
  fetchSessionOrganizationId,
  fetchVendorPartnerIdByName,
  fillField,
  gotoModule,
  rejectApprovalRequestViaUi,
  seedPurchaseOrderApprovalWorkflow,
  selectEntityRowById,
  signIn,
  smokeName,
  submitForm,
  waitForEntityActionEnabled,
  waitForPendingApprovalRequest,
  waitForPurchaseOrderState,
} from "./helpers"

const VENDOR_NAME = "Globex Corp"
const APPROVER_PASSWORD = "Password123$"

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

test.describe(
  "Parity phase 3 — approvals and documents mutations",
  { tag: ["@dev-fixture", "@parity-phase-3"] },
  () => {
    test("blocks PO confirm behind approval rule then rejects the pending request", async ({
      page,
      browser,
    }) => {
      test.setTimeout(240_000)

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

      const orderId = await fetchLatestPurchaseOrderIdByPartner(page, vendorPartnerId, origin)
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

      const requestId = await waitForPendingApprovalRequest(page, "purchase_order", orderId)
      await waitForPurchaseOrderState(page, orderId, "Draft")
        const approver = await provisionIndependentApprover(page, browser)
        try {
          await rejectApprovalRequestViaUi(approver.page, requestId, "E2E approval reject")
        } finally {
          await approver.context.close()
        }

        await expectNoAppError(page)
      } finally {
        await callReducerBff(page, "retire_workflow_version", [
          approvalWorkflow.organizationId,
          approvalWorkflow.versionId,
          approvalWorkflow.revision,
        ])
      }
    })
  },
)
