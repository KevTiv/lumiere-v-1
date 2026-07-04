import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { expect, test } from "@playwright/test"

import {
  callReducerBff,
  chooseSelectOptionByLabel,
  expectNoAppError,
  fillField,
  gotoModule,
  scalarQueryId,
  smokeName,
  submitForm,
  waitForBffQueryMinRows,
} from "./helpers"

function queryString(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    if ("some" in obj) return queryString(obj.some)
    if ("tag" in obj && typeof obj.tag === "string") return obj.tag
  }
  return String(value)
}

/**
 * Sales has no edit-order form wired in the UI yet. This spec creates a draft
 * order through the product UI, then proves the BFF `update_sale_order` path
 * via `callReducerBff` (hybrid UI create + BFF update).
 */
test.describe("Sales update mutations", { tag: ["@p0", "@phase-3"] }, () => {
  test("updates a draft sale order client ref via BFF after UI create", async ({ page }) => {
    test.setTimeout(120_000)

    const initialRef = smokeName("so-ref")
    const updatedRef = `${initialRef}-updated`

    await gotoModule(page, "/sales", "sales")
    await page.getByTestId("module-tab-sales-orders").click()
    await waitForBffQueryMinRows(page, "/api/query/contacts")
    await waitForBffQueryMinRows(page, "/api/query/pricelists")
    await waitForBffQueryMinRows(page, "/api/query/warehouses")
    await page.getByTestId("module-create-sales-orders").click()
    await expect(page.getByTestId("form-modal-new-sale-order")).toBeVisible()
    await chooseSelectOptionByLabel(page, "partnerId", /Acme Corporation/i)
    await chooseSelectOptionByLabel(page, "pricelistId", /.+/i)
    await chooseSelectOptionByLabel(page, "warehouseId", /.+/i)
    await fillField(page, "clientOrderRef", initialRef)

    const [createOrderRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/create_sale_order") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-sale-order"),
    ])
    expect(createOrderRes.ok()).toBe(true)

    let orderId = 0
    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/query/sale-orders")
          if (!res.ok()) return 0
          const json = (await res.json()) as {
            data?: Array<{
              id?: unknown
              clientOrderRef?: unknown
              client_order_ref?: unknown
              state?: unknown
            }>
          }
          const row = (json.data ?? []).find((order) => {
            const ref = queryString(order.clientOrderRef ?? order.client_order_ref)
            return ref === initialRef
          })
          if (!row) return 0
          orderId = scalarQueryId(row.id) ?? 0
          return orderId
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0)

    await callReducerBff(
      page,
      "update_sale_order",
      [
        orderId,
        stdbParamsToJson({ clientOrderRef: updatedRef }, "UpdateSaleOrderParams"),
      ],
      { withCompany: true },
    )

    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/query/sale-orders")
          if (!res.ok()) return ""
          const json = (await res.json()) as {
            data?: Array<{
              id?: unknown
              clientOrderRef?: unknown
              client_order_ref?: unknown
            }>
          }
          const row = (json.data ?? []).find((order) => scalarQueryId(order.id) === orderId)
          if (!row) return ""
          return queryString(row.clientOrderRef ?? row.client_order_ref)
        },
        { timeout: 30_000 },
      )
      .toBe(updatedRef)

    await expectNoAppError(page)
  })
})
