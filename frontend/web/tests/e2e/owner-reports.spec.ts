import { expect, test, type Page } from "@playwright/test"

import { expectNoAppError, gotoModule } from "./helpers"

/**
 * Phase 1 owner-report smoke (P2-REPORT-01).
 *
 * Requires `seed_dev_data` with owner-report payment fixtures (section 5.5b):
 * - MTN wallet + posted receipt/fee rows for daily summary and cash reports
 * - Partial allocation on INV/2026/00010 (Wayne Enterprises)
 * - One unreconciled posted transaction for cash report unreconciled section
 */
test.describe("Owner reports e2e", { tag: "@dev-fixture" }, () => {
  async function fetchDefaultCompanyId(page: Page): Promise<number> {
    const res = await page.request.get("/api/query/companies")
    if (!res.ok()) throw new Error(`companies query failed: ${res.status()}`)
    const json = (await res.json()) as { data?: Array<{ id?: unknown }> }
    const raw = json.data?.[0]?.id
    const id = typeof raw === "bigint" ? Number(raw) : Number(raw)
    if (!Number.isFinite(id) || id <= 0) throw new Error("no company in seed data")
    return id
  }

  function reportScopeInput() {
    const date = new Date().toISOString().slice(0, 10)
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return { date, timezone }
  }

  test("catalog exposes four phase-1 preview reports", async ({ page }) => {
    const res = await page.request.get("/api/reports/catalog")
    expect(res.ok()).toBeTruthy()
    const catalog = (await res.json()) as {
      reports: Array<{ key: string; availability: string }>
    }
    const preview = catalog.reports.filter((entry) => entry.availability === "preview")
    expect(preview).toHaveLength(4)
    expect(preview.map((entry) => entry.key).sort()).toEqual(
      [
        "cash_mobile_money_v1",
        "customer_balances_v1",
        "daily_business_summary_v1",
        "supplier_payables_v1",
      ].sort(),
    )
  })

  test("customer balances preview shows partial payment on Wayne invoice", async ({ page }) => {
    const companyId = await fetchDefaultCompanyId(page)
    const { date, timezone } = reportScopeInput()
    const res = await page.request.post("/api/reports/customer_balances_v1/preview", {
      data: { companyId, date, timezone },
    })
    expect(res.ok()).toBeTruthy()
    const preview = (await res.json()) as {
      reportKey: string
      watermark: string
      report: {
        lines: Array<{
          partnerDisplayName?: string
          paidAmount: { minorUnits: number }
          residual: { minorUnits: number }
          isPartial: boolean
        }>
      }
    }
    expect(preview.reportKey).toBe("customer_balances_v1")
    expect(preview.watermark.length).toBeGreaterThan(0)

    const wayne = preview.report.lines.find((line) =>
      (line.partnerDisplayName ?? "").includes("Wayne"),
    )
    expect(wayne).toBeDefined()
    expect(wayne?.paidAmount.minorUnits).toBe(500_000)
    expect(wayne?.residual.minorUnits).toBe(875_000)
    expect(wayne?.isPartial).toBe(true)
  })

  test("cash report preview includes seeded wallet and unreconciled payment", async ({ page }) => {
    const companyId = await fetchDefaultCompanyId(page)
    const { date, timezone } = reportScopeInput()
    const res = await page.request.post("/api/reports/cash_mobile_money_v1/preview", {
      data: { companyId, date, timezone },
    })
    expect(res.ok()).toBeTruthy()
    const preview = (await res.json()) as {
      report: {
        accounts: Array<{ name: string }>
        unreconciled: { count: number }
        receipts: { receiptTotal: { minorUnits: number } }
      }
    }
    expect(preview.report.accounts.some((account) => account.name.includes("MTN"))).toBe(true)
    expect(preview.report.unreconciled.count).toBeGreaterThanOrEqual(1)
    expect(preview.report.receipts.receiptTotal.minorUnits).toBeGreaterThan(0)
  })

  test("owner reports UI previews daily business summary", async ({ page }) => {
    test.setTimeout(120_000)

    await gotoModule(page, "/reports", "reports")
    await page.getByTestId("module-tab-reports-owner-reports").click()

    await expect(page.getByText("Daily Business Summary")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText("Cash & Mobile Money Report")).toBeVisible()
    await expect(page.getByText("Unpaid Customer Balances")).toBeVisible()

    const dailyCard = page.locator('[class*="card"]').filter({ hasText: "Daily Business Summary" })
    await dailyCard.getByRole("button", { name: /preview/i }).click()

    await expect(page.getByText(/watermark|generated/i).first()).toBeVisible({ timeout: 60_000 })
    await expectNoAppError(page)
  })
})
