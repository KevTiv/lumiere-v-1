import { expect } from "@playwright/test"
import type { Page } from "@playwright/test"
import type { QueryRowFor } from "@lumiere/stdb/query-row-map"

import { matchesOperationResponse } from "./operation-response"
import {
  activeTabEntityTable,
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  clickEntityActionAndWaitForReducer,
  fetchSaleOrderSelectLabel,
  fillField,
  gotoModule,
  openEntityCreate,
  scalarQueryId,
  selectEntityRowById,
  submitForm,
  waitForBffQueryMinRows,
  waitForSaleOrderConfirmed,
  waitForSaleOrderLineExists,
} from "./helpers"

export const SEEDED_CUSTOMER_NAME = "Acme Corporation"

type SaleOrderQueryRow = QueryRowFor<"sale-orders">

/**
 * Create a draft sale order through the UI and return its id. The same steps the lead-to-cash
 * spec uses; kept here so fulfillment specs do not reach into another spec's private helpers.
 */
export async function createDraftSaleOrder(page: Page, clientRef: string): Promise<number> {
  await gotoModule(page, "/sales", "sales")
  await page.getByTestId("module-tab-sales-orders").click()
  await waitForBffQueryMinRows(page, "/api/query/contacts")
  await waitForBffQueryMinRows(page, "/api/query/pricelists")
  await waitForBffQueryMinRows(page, "/api/query/warehouses")
  await page.getByTestId("module-create-sales-orders").click()
  await expect(page.getByTestId("form-modal-new-sale-order")).toBeVisible()
  await chooseSelectOptionByLabel(page, "partnerId", SEEDED_CUSTOMER_NAME)
  await chooseFirstEnabledOption(page, "pricelistId")
  await chooseFirstEnabledOption(page, "warehouseId")
  await fillField(page, "clientOrderRef", clientRef)
  await Promise.all([
    page.waitForResponse((res) => matchesOperationResponse(res, "create_sale_order") && res.ok(), {
      timeout: 30_000,
    }),
    submitForm(page, "new-sale-order"),
  ])

  let orderId = 0
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/query/sale-orders")
        if (!res.ok()) return 0
        const json = (await res.json()) as { data?: SaleOrderQueryRow[] }
        const row = (json.data ?? []).find((candidate) => candidate.clientOrderRef === clientRef)
        orderId = Number(row?.id ?? 0)
        return orderId
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)
  return orderId
}

/** Add a line of the seeded laptop to an order through the Order Lines tab. */
export async function addLaptopLine(page: Page, orderId: number, quantity: string): Promise<void> {
  await addProductLine(page, orderId, "Lumiere Dev Laptop", quantity)
}

/**
 * Seeded mouse stock (50 units). Specs that only need some storable product use it so they
 * leave the 10 seeded laptops to the specs that assert against them.
 */
export const SEEDED_MOUSE_PRODUCT = "Wireless Ergonomic Mouse"

/** Add a line of a seeded storable product to an order through the Order Lines tab. */
export async function addProductLine(
  page: Page,
  orderId: number,
  productName: string,
  quantity: string,
): Promise<void> {
  await openEntityCreate(page, "/sales", "sales", "order-lines", "add-sale-order-line")
  await chooseSelectOptionByLabel(page, "orderId", await fetchSaleOrderSelectLabel(page, orderId))
  await page.getByTestId("form-field-productId").click()
  await page.getByRole("option", { name: productName }).click()
  await chooseFirstEnabledOption(page, "uomId")
  await fillField(page, "quantity", quantity)
  await fillField(page, "priceUnit", "1200")
  await Promise.all([
    page.waitForResponse((res) => matchesOperationResponse(res, "create_sale_order_line") && res.ok(), {
      timeout: 30_000,
    }),
    submitForm(page, "add-sale-order-line"),
  ])
  await waitForSaleOrderLineExists(page, orderId)
}

export interface PickingSnapshot {
  id: number
  state: string
  backorderId: number | null
}

/** Every non-return picking of an order (its delivery and any backorders), from the query API. */
export async function fetchOrderPickings(page: Page, orderId: number): Promise<PickingSnapshot[]> {
  const res = await page.request.get("/api/query/stock-pickings")
  if (!res.ok()) return []
  const json = (await res.json()) as { data?: Array<Record<string, unknown>> }
  return (json.data ?? [])
    .filter((row) => scalarQueryId(row.saleId ?? row.sale_id) === orderId && !(row.isReturn ?? row.is_return))
    .flatMap((row) => {
      const id = scalarQueryId(row.id)
      return id == null
        ? []
        : [
            {
              id,
              state: String(row.state ?? "").toLowerCase(),
              backorderId: scalarQueryId(row.backorderId ?? row.backorder_id),
            },
          ]
    })
}

/** `{ id, demand }` of each open move on a picking, from the query API. */
export async function fetchPickingMoves(
  page: Page,
  pickingId: number,
): Promise<Array<{ id: number; demand: number }>> {
  const res = await page.request.get("/api/query/stock-moves")
  if (!res.ok()) return []
  const json = (await res.json()) as { data?: Array<Record<string, unknown>> }
  return (json.data ?? []).flatMap((row) => {
    if (scalarQueryId(row.pickingId ?? row.picking_id) !== pickingId) return []
    const id = scalarQueryId(row.id)
    return id == null ? [] : [{ id, demand: Number(row.productUomQty ?? row.product_uom_qty ?? 0) }]
  })
}

/** Total delivered quantity across an order's product lines. */
export async function fetchOrderDeliveredQty(page: Page, orderId: number): Promise<number> {
  const res = await page.request.get("/api/query/sale-order-lines")
  if (!res.ok()) return 0
  const json = (await res.json()) as { data?: Array<Record<string, unknown>> }
  return (json.data ?? [])
    .filter((line) => scalarQueryId(line.orderId ?? line.order_id) === orderId)
    .reduce((sum, line) => sum + Number(line.qtyDelivered ?? line.qty_delivered ?? 0), 0)
}

/** Confirm an order through the Orders tab and wait until the query API shows it confirmed. */
export async function confirmOrderViaUi(page: Page, orderId: number) {
  await gotoModule(page, "/sales", "sales")
  await page.getByTestId("module-tab-sales-orders").click()
  await selectEntityRowById(page, orderId)
  await clickEntityActionAndWaitForReducer(page, "entity-action-confirm-orders", "confirm_sales_order")
  await waitForSaleOrderConfirmed(page, orderId)
}

export async function openFulfillmentTab(page: Page) {
  await gotoModule(page, "/sales", "sales")
  const tab = page.getByTestId("module-tab-sales-fulfillment")
  await tab.click()
  await expect(tab).toHaveAttribute("aria-selected", "true")
  await expect(page.locator('[role="tabpanel"]:visible').getByTestId("entity-table")).toBeVisible({
    timeout: 30_000,
  })
}

/** Run one toolbar action on a picking in the fulfillment tab and wait for its reducer. */
export async function pickingActionViaUi(
  page: Page,
  pickingId: number,
  actionTestId: string,
  reducer: "confirm_stock_picking" | "assign_stock_picking" | "validate_stock_picking",
) {
  await openFulfillmentTab(page)
  await selectEntityRowById(page, pickingId)
  await clickEntityActionAndWaitForReducer(page, actionTestId, reducer)
}

/** Confirm then assign a picking so it is ready to ship. */
export async function readyPickingViaUi(page: Page, pickingId: number) {
  await pickingActionViaUi(page, pickingId, "entity-action-confirm-picking", "confirm_stock_picking")
  await pickingActionViaUi(page, pickingId, "entity-action-assign-picking", "assign_stock_picking")
}

/** The order's delivery picking, once confirming the order has created it. */
export async function waitForFirstDelivery(page: Page, orderId: number): Promise<number> {
  let pickingId = 0
  await expect
    .poll(
      async () => {
        pickingId = (await fetchOrderPickings(page, orderId))[0]?.id ?? 0
        return pickingId
      },
      { timeout: 45_000 },
    )
    .toBeGreaterThan(0)
  return pickingId
}

/** The labels the order-to-cash summary shows (from `sales.salesOrders.cashSummary`). */
export const ORDER_SUMMARY = {
  delivery: {
    none: "Not started",
    pending: "To deliver",
    partial: "Partially delivered",
    short: "Delivered short",
    complete: "Delivered",
  },
  invoice: { none: "Not invoiced", draft: "Draft invoice", posted: "Invoiced", credited: "Credited" },
  payment: { none: "—", unpaid: "Unpaid", partial: "Partially paid", paid: "Paid" },
} as const

/**
 * Assert what the order's row in the Orders tab shows for the derived Delivery / Invoice /
 * Payment summary. Labels that also appear in another column of the same row (e.g. "Invoiced")
 * are best asserted through their absence or through the unambiguous label beside them.
 */
export async function expectOrderSummary(
  page: Page,
  orderId: number,
  expected: { present?: readonly string[]; absent?: readonly string[]; reload?: boolean },
) {
  await gotoModule(page, "/sales", "sales")
  if (expected.reload) {
    await page.reload({ waitUntil: "domcontentloaded" })
    await gotoModule(page, "/sales", "sales")
  }
  await page.getByTestId("module-tab-sales-orders").click()
  const row = activeTabEntityTable(page).getByTestId(`entity-row-${orderId}`)
  await expect(row).toBeVisible({ timeout: 30_000 })
  for (const label of expected.present ?? []) {
    await expect(row.getByText(label, { exact: true }).first(), `order ${orderId} shows "${label}"`).toBeVisible({
      timeout: 30_000,
    })
  }
  for (const label of expected.absent ?? []) {
    await expect(row.getByText(label, { exact: true }), `order ${orderId} does not show "${label}"`).toHaveCount(0)
  }
}
