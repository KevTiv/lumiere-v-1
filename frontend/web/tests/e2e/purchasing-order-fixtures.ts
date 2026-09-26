import { expect } from "@playwright/test"
import type { Page } from "@playwright/test"
import type { QueryRowFor } from "@lumiere/stdb/query-row-map"

import { matchesOperationResponse } from "./operation-response"
import {
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  clickEntityActionAndWaitForReducer,
  fetchPurchaseOrderSelectLabel,
  fillField,
  gotoModule,
  scalarQueryId,
  selectEntityRowById,
  selectModuleTab,
  submitForm,
  waitForPurchaseOrderState,
} from "./helpers"

export const SEEDED_VENDOR_NAME = "Globex Corp"

type PurchaseOrderQueryRow = QueryRowFor<"purchase-orders">

export interface PurchaseReceiptSnapshot {
  id: number
  state: string
}

export async function fetchPurchaseOrderIdsByOrigin(
  page: Page,
  origin: string,
): Promise<number[]> {
  const response = await page.request.get("/api/query/purchase-orders")
  if (!response.ok()) return []

  const payload = (await response.json()) as { data?: PurchaseOrderQueryRow[] }
  return (payload.data ?? [])
    .filter((row) => row.origin === origin)
    .flatMap((row) => {
      const id = scalarQueryId(row.id)
      return id == null ? [] : [id]
    })
    .sort((a, b) => a - b)
}

export async function createDraftPurchaseOrder(
  page: Page,
  origin: string,
): Promise<number> {
  await gotoModule(page, "/purchasing", "purchasing")
  await selectModuleTab(page, "purchasing", "orders")
  await page.getByTestId("module-create-purchasing-orders").click()
  await expect(page.getByTestId("form-modal-new-purchase-order")).toBeVisible()
  await chooseSelectOptionByLabel(page, "partnerId", SEEDED_VENDOR_NAME)
  await chooseFirstEnabledOption(page, "pricelistId")
  await fillField(page, "origin", origin)

  await Promise.all([
    page.waitForResponse(
      (response) =>
        matchesOperationResponse(response, "create_purchase_order") && response.ok(),
      { timeout: 30_000 },
    ),
    submitForm(page, "new-purchase-order"),
  ])

  await expect
    .poll(() => fetchPurchaseOrderIdsByOrigin(page, origin), { timeout: 30_000 })
    .toHaveLength(1)

  const [orderId] = await fetchPurchaseOrderIdsByOrigin(page, origin)
  if (orderId == null) throw new Error(`Purchase order for origin ${origin} disappeared`)
  return orderId
}

export async function addLaptopPurchaseLine(
  page: Page,
  orderId: number,
  quantity = "1",
): Promise<void> {
  await gotoModule(page, "/purchasing", "purchasing")
  await selectModuleTab(page, "purchasing", "lines")
  await page.getByTestId("entity-action-pol-add-form").click()
  await expect(page.getByTestId("form-modal-add-purchase-order-line")).toBeVisible()
  await chooseSelectOptionByLabel(
    page,
    "orderId",
    await fetchPurchaseOrderSelectLabel(page, orderId),
  )
  await chooseSelectOptionByLabel(page, "productId", "Lumiere Dev Laptop")
  await chooseFirstEnabledOption(page, "uomId")
  await fillField(page, "quantity", quantity)
  await fillField(page, "priceUnit", "500")

  await Promise.all([
    page.waitForResponse(
      (response) =>
        matchesOperationResponse(response, "add_purchase_order_line") && response.ok(),
      { timeout: 30_000 },
    ),
    submitForm(page, "add-purchase-order-line"),
  ])
}

export async function fetchPurchaseOrderState(
  page: Page,
  orderId: number,
): Promise<string | undefined> {
  const response = await page.request.get("/api/query/purchase-orders")
  if (!response.ok()) return undefined

  const payload = (await response.json()) as { data?: PurchaseOrderQueryRow[] }
  const row = (payload.data ?? []).find(
    (candidate) => scalarQueryId(candidate.id) === orderId,
  )
  const state = row?.state
  if (state != null && typeof state === "object" && "tag" in state) {
    return String((state as { tag: string }).tag)
  }
  return state == null ? undefined : String(state)
}

export async function fetchPurchaseOrderReceipts(
  page: Page,
  orderId: number,
): Promise<PurchaseReceiptSnapshot[]> {
  const response = await page.request.get("/api/query/stock-pickings")
  if (!response.ok()) return []

  const payload = (await response.json()) as {
    data?: Array<Record<string, unknown>>
  }

  return (payload.data ?? [])
    .filter(
      (row) =>
        scalarQueryId(row.purchaseId ?? row.purchase_id) === orderId &&
        !(row.isReturn ?? row.is_return) &&
        String(row.pickingCode ?? row.picking_code ?? "") === "incoming",
    )
    .flatMap((row) => {
      const id = scalarQueryId(row.id)
      return id == null
        ? []
        : [{ id, state: String(row.state ?? "").toLowerCase() }]
    })
    .sort((a, b) => a.id - b.id)
}

export async function confirmPurchaseOrderViaUi(
  page: Page,
  orderId: number,
): Promise<void> {
  await gotoModule(page, "/purchasing", "purchasing")
  await selectModuleTab(page, "purchasing", "orders")
  await selectEntityRowById(page, orderId)
  await clickEntityActionAndWaitForReducer(
    page,
    "entity-action-po-confirm",
    "confirm_purchase_order",
  )
  await waitForPurchaseOrderState(page, orderId, "Purchase")
}
