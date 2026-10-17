import { expect, test, type Page, type Request } from "@playwright/test"

import {
  activeTabEntityTable,
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  fetchPurchaseOrderSelectLabel,
  fillField,
  gotoModule,
  scalarQueryId,
  selectModuleTab,
  signIn,
  smokeName,
  submitForm,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"
import {
  confirmPurchaseOrderViaUi,
  createDraftPurchaseOrder,
  createVendorBillViaUi,
  fetchPurchaseOrderInvoiceIds,
  fetchPurchaseOrderLineIds,
  fetchVendorBillById,
  receivePurchaseLineViaUi,
} from "./purchasing-order-fixtures"

const PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"
type Row = Record<string, unknown>
const field = (row: Row, camel: string, snake: string) => row[camel] ?? row[snake]
const tag = (value: unknown) =>
  value != null && typeof value === "object" && "tag" in value
    ? String((value as { tag: unknown }).tag)
    : String(value)

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  expect(response.ok(), `${resource}: ${response.status()}`).toBe(true)
  const payload = (await response.json()) as { data: Row[] }
  expect(Array.isArray(payload.data)).toBe(true)
  return payload.data
}

async function exactRow(page: Page, resource: string, id: number): Promise<Row> {
  const found = (await rows(page, resource)).filter(
    (row) => scalarQueryId(row.id) === id,
  )
  expect(found, `${resource} exact ${id}`).toHaveLength(1)
  return found[0]!
}

// No effect is pending, one is exact, multiple is an invariant failure.
// Sorting is only deterministic comparison, never newest/highest selection.
function soleAddition(before: number[], after: number[]): number | undefined {
  expect(after.filter((id) => before.includes(id))).toEqual(before)
  const added = after.filter((id) => !before.includes(id))
  if (added.length > 1) throw new Error("Multiple exact source effects")
  return added[0]
}

async function addExactLine(
  page: Page, orderId: number, quantity: number, price: number,
): Promise<number> {
  const before = await fetchPurchaseOrderLineIds(page, orderId)
  await gotoModule(page, "/purchasing", "purchasing")
  await selectModuleTab(page, "purchasing", "lines")
  await page.getByTestId("entity-action-pol-add-form").click()
  await expect(page.getByTestId("form-modal-add-purchase-order-line")).toBeVisible()
  await chooseSelectOptionByLabel(
    page, "orderId", await fetchPurchaseOrderSelectLabel(page, orderId),
  )
  await chooseSelectOptionByLabel(page, "productId", "Lumiere Dev Laptop")
  await chooseFirstEnabledOption(page, "uomId")
  await fillField(page, "quantity", String(quantity))
  await fillField(page, "priceUnit", String(price))
  const responsePromise = page.waitForResponse(
    (response) => matchesOperationResponse(response, "add_purchase_order_line"),
  )
  await submitForm(page, "add-purchase-order-line")
  const response = await responsePromise
  expect(response.ok(), await response.text()).toBe(true)
  let lineId: number | undefined
  await expect.poll(async () => {
    lineId = soleAddition(before, await fetchPurchaseOrderLineIds(page, orderId))
    return lineId != null
  }).toBe(true)
  return lineId!
}

async function sourceSnapshot(page: Page, lineId: number) {
  const row = await exactRow(page, "purchase-order-lines", lineId)
  return {
    id: lineId,
    orderId: scalarQueryId(field(row, "orderId", "order_id")),
    productId: scalarQueryId(field(row, "productId", "product_id")),
    price: Number(field(row, "priceUnit", "price_unit")),
    ordered: Number(field(row, "productQty", "product_qty")),
    received: Number(field(row, "qtyReceived", "qty_received")),
    invoiced: Number(field(row, "qtyInvoiced", "qty_invoiced")),
  }
}

async function expectBillFocus(page: Page, billId: number) {
  await expect(page).toHaveURL((url) =>
    url.pathname === "/accounting" &&
    url.searchParams.get("tab") === "journal-entries" &&
    url.searchParams.getAll("filter").length === 1 &&
    url.searchParams.get("filter") === `id:${billId}`,
  )
  await expect(page.getByTestId("module-tab-accounting-journal-entries")).toHaveCount(1, { timeout: 30_000 })
  await expect(page.getByTestId("module-tab-accounting-journal-entries"))
    .toHaveAttribute("aria-selected", "true")
  const table = activeTabEntityTable(page)
  await expect(table.getByTestId(`entity-row-${billId}`)).toBeVisible()
  await expect(table.locator('[data-testid^="entity-row-"]')).toHaveCount(1)
  await expect(table.getByTestId("entity-active-filter-id")).toContainText(`id: ${billId}`)
}

async function replayAs(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

test.describe(
  "COV-05f1 strict provenance matched-posting UI proof",
  { tag: ["@p0", "@cov05", "@cov05f1", "@unauthenticated"] },
  () => {
    test("exact source-effect resolver covers zero, one and multiple additions", () => {
      expect(soleAddition([7], [7])).toBeUndefined()
      expect(soleAddition([7], [7, 12])).toBe(12)
      expect(() => soleAddition([7], [7, 12, 19])).toThrow("Multiple exact source effects")
    })

    test("posts the exact PO-owned bill with two differently priced same-product lines", async ({
      browser, page,
    }) => {
      test.setTimeout(240_000)
      // Matched posting only, not variance correction or manual economic-claim
      // certification. Native tests own those internals; never request a
      // field-policy bypass here.
      // Requires isolated first-org fixtures, stocked untracked laptop,
      // open fiscal period and no human approval gate for this small bill.
      await signIn(page, "test@email.com", PASSWORD)
      const orderId = await createDraftPurchaseOrder(page, smokeName("cov05f1"))
      expect(await fetchPurchaseOrderLineIds(page, orderId)).toEqual([])
      const firstId = await addExactLine(page, orderId, 2, 100)
      const secondId = await addExactLine(page, orderId, 3, 250)
      expect(firstId).not.toBe(secondId)
      expect(await fetchPurchaseOrderLineIds(page, orderId))
        .toEqual([firstId, secondId].sort((a, b) => a - b))
      const first = await sourceSnapshot(page, firstId)
      const second = await sourceSnapshot(page, secondId)
      expect(first).toMatchObject({ orderId, price: 100, ordered: 2, received: 0, invoiced: 0 })
      expect(second).toMatchObject({ orderId, price: 250, ordered: 3, received: 0, invoiced: 0 })
      expect(first.productId).not.toBeNull()
      expect(second.productId).toBe(first.productId)
      await confirmPurchaseOrderViaUi(page, orderId)

      const purchasingContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
      const accountingContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
      const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
      try {
        const purchasing = await purchasingContext.newPage()
        await signIn(purchasing, "fixture.purchasing@example.test", PASSWORD)
        await receivePurchaseLineViaUi(purchasing, firstId)
        await receivePurchaseLineViaUi(purchasing, secondId)
        await expect.poll(() => sourceSnapshot(page, firstId))
          .toEqual({ ...first, received: 2 })
        await expect.poll(() => sourceSnapshot(page, secondId))
          .toEqual({ ...second, received: 3 })
        const before = await fetchPurchaseOrderInvoiceIds(page, orderId)
        expect(before).toEqual([])
        await createVendorBillViaUi(purchasing, orderId)
        let billId: number | undefined
        await expect.poll(async () => {
          billId = soleAddition(before, await fetchPurchaseOrderInvoiceIds(page, orderId))
          return billId != null
        }).toBe(true)
        const exactBillId = billId!
        await expectBillFocus(purchasing, exactBillId)
        const draft = await fetchVendorBillById(page, exactBillId)
        expect(draft).toMatchObject({
          id: exactBillId, moveType: "InInvoice", state: "Draft",
          invoiceOrigin: `PO${orderId}`,
        })

        const accounting = await accountingContext.newPage()
        await signIn(accounting, "fixture.finance@example.test", PASSWORD)
        await accounting.goto(`/accounting?tab=journal-entries&filter=id:${exactBillId}`)
        await expectBillFocus(accounting, exactBillId)
        await activeTabEntityTable(accounting).getByTestId(`entity-row-${exactBillId}`).click()
        const post = accounting.getByRole("dialog").getByRole("button", { name: "Post", exact: true })
        await expect(post).toBeVisible()
        const responsePromise = accounting.waitForResponse(
          (response) => matchesOperationResponse(response, "post_invoice"),
          { timeout: 30_000 },
        )
        await post.click()
        const accepted = await responsePromise
        expect(accepted.ok(), await accepted.text()).toBe(true)
        // In the old first-product validator at least one of these prices
        // necessarily mismatches the first PO line. No fake overbilling edit.
        await expect.poll(() => fetchVendorBillById(page, exactBillId))
          .toEqual({ ...draft!, state: "Posted" })
        const sourceAfter = [
          { ...first, received: 2, invoiced: 2 },
          { ...second, received: 3, invoiced: 3 },
        ]
        const assertSources = async () => {
          expect(await fetchPurchaseOrderInvoiceIds(page, orderId)).toEqual([exactBillId])
          expect(await sourceSnapshot(page, firstId)).toEqual(sourceAfter[0])
          expect(await sourceSnapshot(page, secondId)).toEqual(sourceAfter[1])
          expect(tag(field(await exactRow(page, "purchase-orders", orderId),
            "invoiceStatus", "invoice_status"))).toBe("Invoiced")
        }
        await assertSources()
        await accounting.reload()
        await expectBillFocus(accounting, exactBillId)
        const posted = await exactRow(page, "account-moves", exactBillId)
        expect(tag(posted.state)).toBe("Posted")
        const exposedLines = (await rows(page, "account-move-lines")).filter(
          (row) => scalarQueryId(field(row, "moveId", "move_id")) === exactBillId,
        )
        expect(exposedLines.length).toBeGreaterThan(0)
        const assertNoExposedDelta = async () => {
          await assertSources()
          expect(await exactRow(page, "account-moves", exactBillId)).toEqual(posted)
          expect((await rows(page, "account-move-lines")).filter(
            (row) => scalarQueryId(field(row, "moveId", "move_id")) === exactBillId,
          )).toEqual(exposedLines)
        }
        expect((await replayAs(accounting, accepted.request())).status()).toBe(422)
        await assertNoExposedDelta()
        const reader = await readerContext.newPage()
        await signIn(reader, "fixture.reader@example.test", PASSWORD)
        expect((await replayAs(reader, accepted.request())).status()).toBe(403)
        await assertNoExposedDelta()
      } finally {
        await readerContext.close()
        await accountingContext.close()
        await purchasingContext.close()
      }
    })
  },
)
