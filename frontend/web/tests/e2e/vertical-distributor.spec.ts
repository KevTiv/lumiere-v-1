import { expect, test, type Page } from "@playwright/test"

import {
  callReducerBff,
  expectNoAppError,
  gotoModule,
  scalarQueryId,
} from "./helpers"

async function ensureLaptopIsLowStock(page: Page, companyId: number): Promise<void> {
  const productsResponse = await page.request.get("/api/query/products")
  if (!productsResponse.ok()) throw new Error(`products query failed: ${productsResponse.status()}`)
  const products = (await productsResponse.json()) as {
    data?: Array<{ id?: unknown; name?: unknown }>
  }
  const productId = scalarQueryId(
    products.data?.find((row) => row.name === "Lumiere Dev Laptop")?.id,
  )
  if (productId == null) throw new Error("Lumiere Dev Laptop is missing from the dev fixture")

  const quantsResponse = await page.request.get("/api/query/stock-quants")
  if (!quantsResponse.ok()) {
    throw new Error(`stock-quants query failed: ${quantsResponse.status()}`)
  }
  const quants = (await quantsResponse.json()) as {
    data?: Array<{ id?: unknown; productId?: unknown; product_id?: unknown; companyId?: unknown; company_id?: unknown }>
  }
  const quantIds = (quants.data ?? []).flatMap((row) => {
    const matches =
      scalarQueryId(row.productId ?? row.product_id) === productId &&
      scalarQueryId(row.companyId ?? row.company_id) === companyId
    if (!matches) return []
    const id = scalarQueryId(row.id)
    return id == null ? [] : [id]
  })
  if (quantIds.length === 0) {
    throw new Error("Lumiere Dev Laptop stock quant is missing from the dev fixture")
  }

  const organizationResponse = await page.request.get("/api/query/user-organization")
  if (!organizationResponse.ok()) {
    throw new Error(`user-organization query failed: ${organizationResponse.status()}`)
  }
  const memberships = (await organizationResponse.json()) as {
    data?: Array<{ organizationId?: unknown; organization_id?: unknown }>
  }
  const organizationId = scalarQueryId(
    memberships.data?.[0]?.organizationId ?? memberships.data?.[0]?.organization_id,
  )
  if (organizationId == null) throw new Error("authenticated organization is missing")

  for (const quantId of quantIds) {
    await callReducerBff(page, "update_stock_quant_quantity", [organizationId, quantId, {
      company_id: { some: companyId },
      quantity: 1,
    }])
  }
}

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
    await ensureLaptopIsLowStock(page, companyId)
    await callReducerBff(page, "set_company_vertical_pack", [companyId, {
      pack_key: "distributor_wholesaler",
      enabled: true,
      configuration: { none: [] },
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
    await expect(page.getByText("Distributor workspace", { exact: true })).toBeVisible()
    await expect(page.getByText("Enabled", { exact: true })).toBeVisible()
    await expect(page.getByText("Open sales orders", { exact: true })).toBeVisible()
    await expect(page.getByText("Low-stock alerts", { exact: true })).toBeVisible()
    await expectNoAppError(page)
  })
})
