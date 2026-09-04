import { expect, test, type Page } from "@playwright/test"

import {
  activeTabEntityTable,
  chooseFirstOption,
  chooseSelectOptionByLabel,
  expectNoAppError,
  expectSeededText,
  fillField,
  gotoModule,
  isoDate,
  isoDateTimeLocal,
  openAccountingTab,
  openEntityCreate,
  smokeName,
  submitForm,
} from "./helpers"

const ACCOUNTING_TAB_IDS = [
  "dashboard",
  "accounts",
  "journal-entries",
  "invoices",
  "bills",
  "taxes",
  "payments",
  "payment-terms",
  "payment-term-lines",
  "budgets",
  "analytic",
  "analytic-lines",
  "analytic-distribution",
  "bank-statements",
  "reconciliation-widgets",
  "fixed-assets",
  "fiscal-years",
  "account-periods",
  "fx-revaluation",
  "credit-control",
  "amortization",
  "consolidation",
  "intercompany-rules",
  "intercompany-transactions",
] as const

async function assertAccountingTabRenders(page: Page, tabId: string) {
  await openAccountingTab(page, tabId)
  await expectNoAppError(page)

  switch (tabId) {
    case "dashboard":
      await expect(page.getByTestId("quick-action-create_invoice")).toBeVisible()
      break
    case "accounts":
      await expect(page.getByRole("button", { name: /new account/i }).first()).toBeVisible()
      break
    case "journal-entries":
      await expect(page.getByRole("button", { name: /new journal entry/i })).toBeVisible()
      break
    case "invoices":
      await expect(page.getByRole("button", { name: /new invoice/i })).toBeVisible()
      break
    case "bills":
      await expect(page.getByRole("button", { name: /new bill/i })).toBeVisible()
      break
    case "taxes":
      await expect(page.getByTestId("module-create-accounting-taxes")).toBeVisible()
      await expect(activeTabEntityTable(page)).toBeVisible()
      break
    case "payments":
      await expect(page.getByTestId("module-create-accounting-payments")).toBeVisible()
      break
    case "payment-terms":
      await expect(page.getByTestId("module-create-accounting-payment-terms")).toBeVisible()
      break
    case "payment-term-lines":
      await expect(page.getByTestId("module-create-accounting-payment-term-lines")).toBeVisible()
      break
    case "budgets":
      await expect(page.getByRole("button", { name: /new budget/i })).toBeVisible()
      break
    case "analytic":
      await expect(page.getByTestId("module-create-accounting-analytic")).toBeVisible()
      break
    case "analytic-lines":
      await expect(page.getByTestId("module-create-accounting-analytic-lines")).toBeVisible()
      break
    case "analytic-distribution":
      await expect(page.getByTestId("module-create-accounting-analytic-distribution")).toBeVisible()
      break
    case "bank-statements":
    case "fixed-assets":
      await expect(activeTabEntityTable(page)).toBeVisible()
      break
    case "reconciliation-widgets":
      await expect(page.getByTestId("module-create-accounting-reconciliation-widgets")).toBeVisible()
      break
    case "fiscal-years":
      await expect(page.getByTestId("module-create-accounting-fiscal-years")).toBeVisible()
      break
    case "account-periods":
      await expect(page.getByTestId("module-create-accounting-account-periods")).toBeVisible()
      break
    case "consolidation":
      await expect(page.getByText("Consolidation Accounts")).toBeVisible()
      break
    case "fx-revaluation":
      await expect(page.getByText("Foreign exchange revaluation")).toBeVisible()
      break
    case "credit-control":
      await expect(page.getByText("Partner credit control", { exact: true })).toBeVisible()
      break
    case "amortization":
      await expect(page.getByText("Accrual & prepaid amortization")).toBeVisible()
      break
    case "intercompany-rules":
    case "intercompany-transactions":
      await expect(activeTabEntityTable(page)).toBeVisible()
      break
    default:
      break
  }
}

test.describe("Accounting module e2e", () => {
  test("renders accounting shell and each tab without errors", { tag: "@p0" }, async ({ page }) => {
    await gotoModule(page, "/accounting", "accounting")
    for (const tabId of ACCOUNTING_TAB_IDS) {
      await assertAccountingTabRenders(page, tabId)
    }
  })

  test("creates a chart of accounts row from Chart of Accounts", async ({ page }) => {
    await gotoModule(page, "/accounting", "accounting")
    await openAccountingTab(page, "accounts")

    const code = smokeName("gl").slice(0, 18).replace(/[^a-z0-9-]/gi, "")
    const name = smokeName("GL Account")

    await page.getByRole("button", { name: /new account/i }).first().click()
    const dlg = page.getByRole("dialog", { name: /create new account/i })
    await expect(dlg).toBeVisible()
    await dlg.getByLabel(/account code/i).fill(code)
    await dlg.getByLabel(/account name/i).fill(name)
    await dlg.getByRole("button", { name: /create account/i }).click()
    await expect(dlg).toBeHidden()

    await page.getByPlaceholder(/search accounts/i).fill(code)
    await expect(page.getByText(name)).toBeVisible()
    await expectNoAppError(page)
  })

  test("creates tax, budget, payment term, and payment term line", async ({ page }) => {
    await gotoModule(page, "/accounting", "accounting")

    const taxName = smokeName("tax")
    await openAccountingTab(page, "taxes")
    await page.getByTestId("module-create-accounting-taxes").click()
    await expect(page.getByTestId("form-modal-new-tax")).toBeVisible()
    await fillField(page, "name", taxName)
    await fillField(page, "amount", "10")
    await chooseFirstOption(page, "typeTaxUse")
    await submitForm(page, "new-tax")
    await expect(page.getByText(taxName).first()).toBeVisible()

    const budgetName = smokeName("budget")
    await openAccountingTab(page, "budgets")
    await page.getByRole("button", { name: /new budget/i }).click()
    await expect(page.getByTestId("form-modal-new-budget")).toBeVisible()
    await fillField(page, "name", budgetName)
    await fillField(page, "dateFrom", isoDate(0))
    await fillField(page, "dateTo", isoDate(365))
    await submitForm(page, "new-budget")
    await expectSeededText(page, budgetName, "/api/query/budgets")

    const termName = smokeName("term")
    await openAccountingTab(page, "payment-terms")
    await openEntityCreate(page, "/accounting", "accounting", "payment-terms", "new-payment-term")
    await fillField(page, "name", termName)
    await submitForm(page, "new-payment-term")
    await expectSeededText(page, termName, "/api/query/account-payment-terms")

    await openAccountingTab(page, "payment-term-lines")
    await page.getByTestId("module-create-accounting-payment-term-lines").click()
    await expect(page.getByTestId("form-modal-new-payment-term-line")).toBeVisible()
    await page.getByTestId("form-field-paymentTermId").click()
    await page.getByRole("option", { disabled: false }).first().click()
    await page.getByTestId("form-submit-new-payment-term-line").click()
    await expect(page.getByTestId("form-modal-new-payment-term-line")).toBeHidden()
    await expectNoAppError(page)
  })

  test("creates fiscal year then accounting period", async ({ page }) => {
    await gotoModule(page, "/accounting", "accounting")

    const fyName = smokeName("FY")
    // Unique calendar year per run so CI retries cannot hit `create_fiscal_year` overlap.
    const fyYear = 2100 + Math.floor(Date.now() % 80)
    await openAccountingTab(page, "fiscal-years")
    await openEntityCreate(page, "/accounting", "accounting", "fiscal-years", "new-fiscal-year")
    await fillField(page, "name", fyName)
    await fillField(page, "dateFrom", isoDateTimeLocal(fyYear, 1, 1, 0, 0))
    await fillField(page, "dateTo", isoDateTimeLocal(fyYear, 12, 31, 23, 59))
    await chooseFirstOption(page, "fiscalYearType")
    await submitForm(page, "new-fiscal-year")
    await expectSeededText(page, fyName, "/api/query/fiscal-years")

    const periodName = smokeName("period")
    const periodCode = smokeName("p").slice(0, 10)
    await openAccountingTab(page, "account-periods")
    await openEntityCreate(page, "/accounting", "accounting", "account-periods", "new-account-period")
    await fillField(page, "name", periodName)
    await fillField(page, "code", periodCode)
    await page.waitForResponse(
      (res) => res.url().includes("/api/query/fiscal-years") && res.ok(),
      { timeout: 30_000 },
    ).catch(() => undefined)
    await chooseSelectOptionByLabel(page, "fiscalYearId", fyName, { optionTimeoutMs: 30_000 })
    await fillField(page, "dateFrom", isoDateTimeLocal(fyYear, 1, 1, 0, 0))
    await fillField(page, "dateTo", isoDateTimeLocal(fyYear, 3, 31, 23, 59))
    await submitForm(page, "new-account-period")
    await expect(page.getByText(periodName).first()).toBeVisible()
    await expectNoAppError(page)
  })

  test("creates analytic account, analytic line, and distribution model", async ({ page }) => {
    await gotoModule(page, "/accounting", "accounting")

    const aaName = smokeName("AA")
    const aaCode = smokeName("a").slice(0, 8)
    await openAccountingTab(page, "analytic")
    await openEntityCreate(page, "/accounting", "accounting", "analytic", "new-analytic-account")
    await fillField(page, "name", aaName)
    await fillField(page, "code", aaCode)
    await submitForm(page, "new-analytic-account")

    await openAccountingTab(page, "analytic-lines")
    await openEntityCreate(page, "/accounting", "accounting", "analytic-lines", "new-analytic-line")
    const lineName = smokeName("aline")
    await fillField(page, "name", lineName)
    await chooseFirstOption(page, "accountId")
    await fillField(page, "amount", "100")
    await fillField(page, "date", isoDate(0))
    await submitForm(page, "new-analytic-line")

    await openAccountingTab(page, "analytic-distribution")
    await openEntityCreate(
      page,
      "/accounting",
      "accounting",
      "analytic-distribution",
      "new-analytic-distribution-model",
    )
    await fillField(page, "name", smokeName("dist"))
    await chooseFirstOption(page, "analyticAccountId")
    await submitForm(page, "new-analytic-distribution-model")
    await expectNoAppError(page)
  })

  test("dashboard quick actions open journal entry, tax, and currency rate forms", async ({ page }) => {
    await gotoModule(page, "/accounting", "accounting")
    await openAccountingTab(page, "dashboard")

    await page.getByTestId("quick-action-journal_entry").click()
    await expect(page.getByTestId("form-modal-new-journal-entry")).toBeVisible()
    await fillField(page, "date", isoDate(0))
    await page.getByTestId("form-field-journalId").click()
    const jeModal = page.getByTestId("form-modal-new-journal-entry")
    const listbox = page.locator('[role="listbox"]')
    await listbox.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined)
    const jeOptions = listbox.getByRole("option", { disabled: false })
    if ((await jeOptions.count()) === 0) {
      await jeModal.getByRole("button", { name: /^cancel$/i }).click()
      await expect(jeModal).toBeHidden()
    } else {
      await jeOptions.first().click()
      await submitForm(page, "new-journal-entry")
    }

    await page.getByTestId("quick-action-create_tax").click()
    await expect(page.getByTestId("form-modal-new-tax")).toBeVisible()
    await page.getByTestId("form-modal-new-tax").getByRole("button", { name: /^cancel$/i }).click()
    await expect(page.getByTestId("form-modal-new-tax")).toBeHidden()

    await page.getByTestId("quick-action-currency_rate").click()
    await expect(page.getByTestId("form-modal-new-currency-rate")).toBeVisible()
    await fillField(page, "fromCurrency", "USD")
    await fillField(page, "toCurrency", "EUR")
    await fillField(page, "rate", "1.05")
    await submitForm(page, "new-currency-rate")
    await expectNoAppError(page)
  })

  test("invoice quick action saves draft when journals exist", async ({ page }) => {
    await gotoModule(page, "/accounting", "accounting")
    await openAccountingTab(page, "dashboard")

    await page.getByTestId("quick-action-create_invoice").click()
    await expect(page.getByTestId("create-invoice-modal")).toBeVisible()

    const saveDraft = page.getByTestId("create-invoice-save-draft")
    if (await saveDraft.isDisabled()) {
      await page.getByTestId("create-invoice-modal").getByRole("button", { name: /^cancel$/i }).click()
      await expect(page.getByTestId("create-invoice-modal")).toBeHidden()
      await expectNoAppError(page)
      return
    }

    await page.getByTestId("create-invoice-partner").fill(smokeName("cust"))
    await page.getByTestId("create-invoice-line-description").fill("Smoke line")
    await page.getByTestId("create-invoice-line-unit-price").fill("50")
    await saveDraft.click()
    await expect(page.getByTestId("create-invoice-modal")).toBeHidden()
    await expectNoAppError(page)
  })

  test("fiscal year bulk actions disable until a row is selected", async ({ page }) => {
    await gotoModule(page, "/accounting", "accounting")
    await openAccountingTab(page, "fiscal-years")

    const openBtn = page.getByTestId("entity-action-fy-open")
    await expect(openBtn).toBeVisible()
    await expect(openBtn).toBeDisabled()

    const rowLocator = page.locator('[data-testid^="entity-row-"]').first()
    if ((await rowLocator.count()) > 0) {
      await rowLocator.click()
      await expect(openBtn).toBeEnabled()
    }

    await expectNoAppError(page)
  })

  test("tax CSV import modal requires a file before success", async ({ page }) => {
    await gotoModule(page, "/accounting", "accounting")
    await openAccountingTab(page, "taxes")

    await page.getByTestId("entity-action-csv-tax").click()
    const csvModal = page.locator('[data-testid^="form-modal-csv-import-"]')
    await expect(csvModal).toBeVisible()
    await csvModal.getByRole("button", { name: /^import$/i }).click()
    await expect(csvModal.getByText(/this field is required/i)).toBeVisible()

    await csvModal.getByRole("button", { name: /^cancel$/i }).click()
    await expect(csvModal).toBeHidden()
    await expectNoAppError(page)
  })
})
