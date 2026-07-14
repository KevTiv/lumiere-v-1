import { expect, test, type Page } from "@playwright/test"

import { callReducerBff, expectNoAppError, gotoModule } from "./helpers"

async function defaultCompanyId(page: Page): Promise<number> {
  const response = await page.request.get("/api/query/companies")
  if (!response.ok()) throw new Error(`companies query failed: ${response.status()}`)
  const body = (await response.json()) as { data?: Array<{ id?: unknown }> }
  const companyId = Number(body.data?.[0]?.id)
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error("the distributor fixture has no operating company")
  }
  return companyId
}

test.describe("Distributor / wholesaler pack", { tag: ["@phase-5", "@dev-fixture"] }, () => {
  test("P5-DIST-01 enables the company workspace and exposes its deterministic low-stock alert", async ({
    page,
  }) => {
    test.setTimeout(120_000)

    const companyId = await defaultCompanyId(page)
    await callReducerBff(page, "set_company_vertical_pack", [companyId, {
      packKey: "distributor_wholesaler",
      enabled: true,
      configuration: null,
    }])

    await expect.poll(async () => {
      const response = await page.request.get(`/api/vertical-packs/${companyId}`)
      if (!response.ok()) return false
      const body = (await response.json()) as {
        data?: Array<{ packKey?: string; enabled?: boolean }>
      }
      return body.data?.some(
        (pack) => pack.packKey === "distributor_wholesaler" && pack.enabled,
      ) ?? false
    }).toBe(true)

    const date = new Date().toISOString().slice(0, 10)
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const reportResponse = await page.request.post("/api/reports/low_stock_v1/preview", {
      data: { companyId, date, timezone },
    })
    expect(reportResponse.ok()).toBeTruthy()
    const preview = (await reportResponse.json()) as {
      reportKey: string
      report: { alertCount: number; lines: Array<{ name: string; reorderPoint: number }> }
    }
    expect(preview.reportKey).toBe("low_stock_v1")
    expect(preview.report.alertCount).toBeGreaterThan(0)
    expect(preview.report.lines).toContainEqual(
      expect.objectContaining({ name: "Lumiere Dev Laptop", reorderPoint: 10 }),
    )

    await gotoModule(page, "/distributor")
    await expect(page.getByRole("heading", { name: "Distributor workspace" })).toBeVisible()
    await expect(page.getByText("Enabled", { exact: true })).toBeVisible()
    await expect(page.getByText("Open sales orders", { exact: true })).toBeVisible()
    await expect(page.getByText("Low-stock alerts", { exact: true })).toBeVisible()
    await expectNoAppError(page)
  })
})
