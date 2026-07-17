/**
 * Expenses Waves A–E UI coverage for this session.
 * Tags: @expenses @p0 (shell/lifecycle UI) — full SoD approve uses a second identity in domain tests.
 */
import { expect, test, type Page } from "@playwright/test"

import {
  callReducerBff,
  expectNoAppError,
  fetchSessionOrganizationId,
  gotoModule,
  smokeName,
} from "./helpers"

const some = <T>(value: T) => ({ some: value })
const none = { none: [] as [] }

async function openExpensesTab(page: Page, tabId: string) {
  await page.getByTestId(`module-tab-expenses-${tabId}`).click()
}

test.describe("Expenses wave lifecycle e2e @expenses", () => {
  test("toolbar actions and capture/ops panels render @p0", async ({ page }) => {
    await gotoModule(page, "/expenses", "expenses")

    await expect(page.getByTestId("expenses-capture-panel")).toBeVisible()
    await expect(page.getByTestId("expenses-capture-submit")).toBeVisible()
    await expect(page.getByTestId("expenses-capture-flush")).toBeVisible()
    await expect(page.getByTestId("expenses-ops-panel")).toBeVisible()
    await expect(page.getByTestId("expenses-ops-flush-intents")).toBeVisible()
    await expectNoAppError(page)

    await openExpensesTab(page, "expense-sheets")
    await expect(page.getByTestId("entity-action-submit-sheets")).toBeVisible()
    await expect(page.getByTestId("entity-action-post-sheets")).toBeVisible()
    await expect(page.getByTestId("entity-action-reimburse-sheets")).toBeVisible()
    await expectNoAppError(page)
  })

  test("dashboard New Report opens create sheet form @p0", async ({ page }) => {
    await gotoModule(page, "/expenses", "expenses")
    await page.getByTestId("module-tab-expenses-dashboard").click()
    const newReport = page.getByRole("button", { name: /New Report/i }).first()
    await expect(newReport).toBeVisible()
    await newReport.click()
    await expect(page.getByText(/New Expense Report|Report Name/i).first()).toBeVisible()
    await expectNoAppError(page)
  })

  test("capture panel queues delayed-sync expense @p0", async ({ page }) => {
    await gotoModule(page, "/expenses", "expenses")
    await expect(page.getByTestId("expenses-capture-panel")).toBeVisible()

    const employee = page.getByTestId("expenses-capture-employee")
    const pricelist = page.getByTestId("expenses-capture-pricelist")
    await expect(employee.locator("option")).not.toHaveCount(1, { timeout: 30_000 })
    await employee.selectOption({ index: 1 })
    await expect(pricelist.locator("option")).not.toHaveCount(1, { timeout: 30_000 })
    await pricelist.selectOption({ index: 1 })

    const name = smokeName("capture")
    await page.getByTestId("expenses-capture-name").fill(name)
    await page.getByTestId("expenses-capture-amount").fill("12.5")
    await page.getByTestId("expenses-capture-submit").click()

    await expect(page.getByTestId("expenses-capture-status")).toBeVisible({ timeout: 30_000 })
    await expectNoAppError(page)
  })

  test("ops FX fee + allocations form from expense row @p0", async ({ page }) => {
    await gotoModule(page, "/expenses", "expenses")
    // Wave D/E ops surface: FX fee on statement create (post advance covered in domain tests).
    await expect(page.getByTestId("expenses-ops-panel")).toBeVisible()
    await expect(page.getByTestId("expenses-ops-amount")).toBeVisible()
    await expect(page.getByPlaceholder("FX fee")).toBeVisible()

    // Allocations: create a Draft expense via BFF (seed rows are often Approved), then open form.
    const organizationId = await fetchSessionOrganizationId(page)
    const employees = await page.request.get("/api/query/employees")
    const employeeId = Number(((await employees.json()) as { data?: Array<{ id?: number }> }).data?.[0]?.id)
    expect(employeeId).toBeGreaterThan(0)
    const name = smokeName("alloc")
    await callReducerBff(page, "create_expense", [
      organizationId,
      {
        company_id: none,
        employee_id: employeeId,
        name,
        date: { __timestamp_micros_since_unix_epoch__: Date.now() * 1000 },
        unit_amount: 22,
        quantity: 1,
        currency_id: 1,
        product_id: none,
        description: none,
        tax_ids: [],
        account_id: none,
        analytic_account_id: none,
        project_id: none,
        line_kind: { standard: [] },
        mileage_distance: none,
        mileage_rate_id: none,
        per_diem_days: none,
        per_diem_rate_id: none,
        attachment_ids: [1],
        client_request_id: some(`e2e-alloc-${Date.now()}`),
        payment_mode: { outOfPocket: [] },
        merchant_key: none,
        policy_exception_reason: none,
      },
    ])
    await page.reload()
    await gotoModule(page, "/expenses", "expenses")
    await openExpensesTab(page, "expenses")
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 45_000 })
    // Click the row containing the new Draft expense (ModuleView may wrap cells).
    await page.getByText(name).first().click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 })
    const allocBtn = page.getByRole("button", { name: "Split allocations" })
    await expect(allocBtn).toBeVisible({ timeout: 15_000 })
    await allocBtn.click()
    await expect(page.getByText(/Split expense allocations|allocation|share/i).first()).toBeVisible()
    await expectNoAppError(page)
  })

  test("capture conflict controls appear after forced error @expenses", async ({ page }) => {
    await gotoModule(page, "/expenses", "expenses")
    // Seed a conflict item via localStorage to assert retry/discard UI without flaky network.
    const organizationId = await fetchSessionOrganizationId(page)
    await page.evaluate(
      ({ orgId }) => {
        const deviceKey = "lumiere.expense-capture-device-id"
        let deviceId = window.localStorage.getItem(deviceKey)
        if (!deviceId) {
          deviceId = "e2e-device"
          window.localStorage.setItem(deviceKey, deviceId)
        }
        const key = `lumiere.expense-capture-outbox.${orgId}.${deviceId}`
        const item = {
          clientRequestId: `exp-cap-conflict-${Date.now()}`,
          deviceId,
          payload: {
            employeeId: "1",
            name: "Conflict meal",
            date: new Date().toISOString().slice(0, 10),
            unitAmount: 9,
            quantity: 1,
            currencyId: "1",
            hasReceipt: true,
            lineKind: "Standard",
          },
          createdAt: new Date().toISOString(),
          syncState: "conflict",
          lastError: "idempotency conflict",
        }
        window.localStorage.setItem(key, JSON.stringify([item]))
      },
      { orgId: organizationId },
    )
    await page.reload()
    await gotoModule(page, "/expenses", "expenses")
    await expect(page.getByTestId("expenses-capture-item-conflict")).toBeVisible()
    await expect(page.getByTestId("expenses-capture-retry")).toBeVisible()
    await expect(page.getByTestId("expenses-capture-discard")).toBeVisible()
    await page.getByTestId("expenses-capture-discard").click()
    await expect(page.getByTestId("expenses-capture-item-conflict")).toHaveCount(0)
  })

  test("ops panel can create card statement line @expenses", async ({ page }) => {
    await gotoModule(page, "/expenses", "expenses")
    await expect(page.getByTestId("expenses-ops-panel")).toBeVisible()
    const ref = smokeName("stmt")
    await page.getByTestId("expenses-ops-external-ref").fill(ref)
    await page.getByTestId("expenses-ops-amount").fill("33")
    await page.getByPlaceholder("FX fee").fill("1.25")
    await page.getByTestId("expenses-ops-create-statement").click()
    await expect(page.getByTestId("expenses-ops-status")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId("expenses-ops-status")).not.toContainText(/error|failed|invalid/i)
    await expectNoAppError(page)
  })
})
