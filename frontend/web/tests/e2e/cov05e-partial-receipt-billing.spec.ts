import { expect, test } from "@playwright/test"
import type { Page, Request } from "@playwright/test"

import {
  activeTabEntityTable,
  chooseSelectOptionByLabel,
  fetchPurchaseOrderLineReceiveLabel,
  fillField,
  gotoModule,
  scalarQueryId,
  selectModuleTab,
  signIn,
  smokeName,
  submitForm,
} from "./helpers"
import { expectCanonicalPickingFocus } from "./inventory-picking-fixtures"
import { matchesOperationResponse } from "./operation-response"
import {
  addLaptopPurchaseLine,
  confirmPurchaseOrderViaUi,
  createDraftPurchaseOrder,
  createVendorBillViaUi,
  fetchPurchaseLineReceiptMoves,
  fetchPurchaseOrderInvoiceIds,
  fetchPurchaseOrderLineIds,
  fetchPurchaseOrderReceipts,
  fetchVendorBillById,
} from "./purchasing-order-fixtures"

const PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"
const RECEIVE_FORM = "receive-purchase-order-line"
type Row = Record<string, unknown>

function field(row: Row, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake]
}

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
  expect(found, `${resource} exact id ${id}`).toHaveLength(1)
  return found[0]!
}

function relationIds(row: Row, camel: string, snake: string): number[] {
  const raw = field(row, camel, snake)
  expect(Array.isArray(raw), `${snake} must be projected`).toBe(true)
  return (raw as unknown[]).map((value) => {
    const id = scalarQueryId(value)
    expect(id, `${snake} valid id`).not.toBeNull()
    return id!
  }).sort((a, b) => a - b)
}

async function quantities(page: Page, lineId: number) {
  const line = await exactRow(page, "purchase-order-lines", lineId)
  return {
    ordered: Number(field(line, "productQty", "product_qty")),
    received: Number(field(line, "qtyReceived", "qty_received")),
    invoiced: Number(field(line, "qtyInvoiced", "qty_invoiced")),
  }
}

async function invoiceStatus(page: Page, orderId: number): Promise<string> {
  const order = await exactRow(page, "purchase-orders", orderId)
  const value = field(order, "invoiceStatus", "invoice_status")
  expect(value, "released PO invoice status").not.toBeNull()
  expect(value, "released PO invoice status").not.toBeUndefined()
  return value != null && typeof value === "object" && "tag" in value
    ? String((value as { tag: unknown }).tag)
    : String(value)
}

async function receiveViaForm(
  page: Page,
  orderId: number,
  lineId: number,
  qty: number,
) {
  const label = await fetchPurchaseOrderLineReceiveLabel(page, orderId, lineId)
  await gotoModule(page, "/purchasing", "purchasing")
  await selectModuleTab(page, "purchasing", "lines")
  await page.getByTestId("entity-action-pol-receive-form").click()
  await expect(page.getByTestId(`form-modal-${RECEIVE_FORM}`)).toBeVisible()
  await chooseSelectOptionByLabel(page, "lineId", label)
  await fillField(page, "qty", String(qty))
  const responsePromise = page.waitForResponse(
    (response) => matchesOperationResponse(response, "receive_po_line"),
    { timeout: 30_000 },
  )
  await submitForm(page, RECEIVE_FORM)
  const response = await responsePromise
  expect(response.ok(), await response.text()).toBe(true)
  return response.request()
}

async function replayAs(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

async function expectBillFocus(page: Page, billId: number) {
  await expect(page).toHaveURL((url) =>
    url.pathname === "/accounting" &&
    url.searchParams.get("tab") === "journal-entries" &&
    url.searchParams.getAll("filter").length === 1 &&
    url.searchParams.get("filter") === `id:${billId}`,
  )
  await expect(page.getByTestId("module-tab-accounting-journal-entries"))
    .toHaveAttribute("aria-selected", "true")
  const table = activeTabEntityTable(page)
  await expect(table.getByTestId(`entity-row-${billId}`)).toBeVisible()
  await expect(table.locator('[data-testid^="entity-row-"]')).toHaveCount(1)
  await expect(table.getByTestId("entity-active-filter-id"))
    .toContainText(`id: ${billId}`)
}

async function billLines(page: Page, billId: number) {
  return (await rows(page, "account-move-lines"))
    .filter((row) => scalarQueryId(field(row, "moveId", "move_id")) === billId)
    .sort((a, b) => scalarQueryId(a.id)! - scalarQueryId(b.id)!)
}

async function destinationQuants(page: Page, move: Row) {
  return (await rows(page, "stock-quants")).filter((row) =>
    scalarQueryId(field(row, "companyId", "company_id")) ===
      scalarQueryId(field(move, "companyId", "company_id")) &&
    scalarQueryId(field(row, "productId", "product_id")) ===
      scalarQueryId(field(move, "productId", "product_id")) &&
    scalarQueryId(field(row, "locationId", "location_id")) ===
      scalarQueryId(field(move, "locationDestId", "location_dest_id")),
  ).sort((a, b) => scalarQueryId(a.id)! - scalarQueryId(b.id)!)
}

test.describe(
  "COV-05e1 partial receipt/backorder/two-bill golden continuation",
  { tag: ["@p0", "@cov05", "@cov05e1", "@unauthenticated"] },
  () => {
    test("purchasing operator receives 4 then residual 6 and bills each exact receipt", async ({
      browser, page,
    }) => {
      test.setTimeout(240_000)
      // Bounded golden continuation only, not full COV-05e U4 certification.
      // Browser evidence is intentionally limited to released projections:
      // exact bill refs, PO-line invoiced deltas, and unchanged exposed bill
      // lines. account-move-lines omits product_id/quantity; native domain
      // tests own exact bill-line quantities 4/6. Full quantitative browser
      // readback for COV-05e/f requires a canonical projection release.
      // P2P-06 first-partial replay is explicitly excluded: receive_po_line
      // has no idempotency key; repeating 4 while 6 remains is a new receipt.
      // Seed prerequisites: first-org admin/purchasing/reader, Globex Corp,
      // stocked untracked Lumiere Dev Laptop, pricelist, expense/payable
      // accounts, and an eligible vendor-bill journal (current COV fixtures).
      await signIn(page, "test@email.com", PASSWORD)
      const orderId = await createDraftPurchaseOrder(page, smokeName("cov05e1"))
      await addLaptopPurchaseLine(page, orderId, "10")
      await confirmPurchaseOrderViaUi(page, orderId)
      const lineIds = await fetchPurchaseOrderLineIds(page, orderId)
      expect(lineIds).toHaveLength(1)
      const lineId = lineIds[0]!
      expect(await quantities(page, lineId)).toEqual({
        ordered: 10, received: 0, invoiced: 0,
      })
      expect(await fetchPurchaseOrderInvoiceIds(page, orderId)).toEqual([])
      const sourceMoves = await fetchPurchaseLineReceiptMoves(page, lineId)
      expect(sourceMoves).toHaveLength(1)
      const source = sourceMoves[0]!
      expect(source.isDone).toBe(false)
      expect(source.state).not.toBe("done")
      const sourceMove = await exactRow(page, "stock-moves", source.id)
      expect(Number(field(sourceMove, "productUomQty", "product_uom_qty"))).toBe(10)
      expect(Number(field(sourceMove, "quantityDone", "quantity_done"))).toBe(0)
      const productId = scalarQueryId(field(sourceMove, "productId", "product_id"))
      expect(productId).not.toBeNull()
      expect(await fetchPurchaseOrderReceipts(page, orderId)).toEqual([
        { id: source.pickingId, state: "draft" },
      ])
      expect(relationIds(
        await exactRow(page, "stock-pickings", source.pickingId),
        "backorderIds", "backorder_ids",
      )).toEqual([])

      const context = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      })
      const operator = await context.newPage()
      try {
        await signIn(operator, "fixture.purchasing@example.test", PASSWORD)
        await receiveViaForm(operator, orderId, lineId, 4)
        await expectCanonicalPickingFocus(operator, source.pickingId)
        await expect.poll(() => quantities(page, lineId)).toEqual({
          ordered: 10, received: 4, invoiced: 0,
        })
        const parent = await exactRow(page, "stock-pickings", source.pickingId)
        expect(parent.state).toBe("done")
        const children = relationIds(parent, "backorderIds", "backorder_ids")
        expect(children).toHaveLength(1)
        const childId = children[0]!
        expect(childId).not.toBe(source.pickingId)
        const child = await exactRow(page, "stock-pickings", childId)
        expect(scalarQueryId(field(child, "backorderId", "backorder_id")))
          .toBe(source.pickingId)
        expect(scalarQueryId(field(child, "purchaseId", "purchase_id"))).toBe(orderId)
        expect(child.state).not.toBe("done")
        const movesAfterPartial = await fetchPurchaseLineReceiptMoves(page, lineId)
        expect(movesAfterPartial).toHaveLength(2)
        expect(movesAfterPartial.filter((move) => move.id === source.id)).toEqual([
          { ...source, state: "done", isDone: true },
        ])
        const residuals = movesAfterPartial.filter((move) => move.pickingId === childId)
        expect(residuals).toHaveLength(1)
        const residual = residuals[0]!
        expect(residual.id).not.toBe(source.id)
        expect(residual.isDone).toBe(false)
        const residualBefore = await exactRow(page, "stock-moves", residual.id)
        expect(scalarQueryId(field(residualBefore, "purchaseLineId", "purchase_line_id")))
          .toBe(lineId)
        expect(Number(field(residualBefore, "productUomQty", "product_uom_qty"))).toBe(6)
        expect(Number(field(residualBefore, "quantityDone", "quantity_done"))).toBe(0)
        const firstMove = await exactRow(page, "stock-moves", source.id)
        expect(Number(field(firstMove, "quantityDone", "quantity_done"))).toBe(4)
        expect(Number(field(firstMove, "productUomQty", "product_uom_qty"))).toBe(4)
        await operator.reload()
        await expectCanonicalPickingFocus(operator, source.pickingId)
        expect(await exactRow(page, "stock-moves", source.id)).toEqual(firstMove)

        const createExactBill = async () => {
          const before = await fetchPurchaseOrderInvoiceIds(page, orderId)
          const response = await createVendorBillViaUi(operator, orderId)
          let after: number[] = []
          await expect.poll(async () => {
            after = await fetchPurchaseOrderInvoiceIds(page, orderId)
            return after.length
          }).toBe(before.length + 1)
          expect(after.filter((id) => before.includes(id))).toEqual(before)
          const additions = after.filter((id) => !before.includes(id))
          expect(additions).toHaveLength(1)
          const billId = additions[0]!
          await expectBillFocus(operator, billId)
          const bill = await fetchVendorBillById(page, billId)
          expect(bill).toMatchObject({
            id: billId, moveType: "InInvoice", state: "Draft",
            invoiceOrigin: `PO${orderId}`,
          })
          // Amount is supplementary validation, never result identity or a
          // substitute for unavailable product/quantity line projections.
          expect(bill!.amountTotal).toBeGreaterThan(0)
          const billRow = await exactRow(page, "account-moves", billId)
          const allLines = await billLines(page, billId)
          expect(allLines.length, `bill ${billId} exposed lines`).toBeGreaterThan(0)
          await operator.reload()
          await expectBillFocus(operator, billId)
          expect(await fetchVendorBillById(page, billId)).toEqual(bill)
          expect(await billLines(page, billId)).toEqual(allLines)
          return { billId, bill, billRow, allLines, request: response.request() }
        }

        const bill1 = await createExactBill()
        expect(await quantities(page, lineId)).toEqual({
          ordered: 10, received: 4, invoiced: 4,
        })
        expect(await invoiceStatus(page, orderId)).toBe("Invoiced")
        // Capture the exact open residual before dispatching the second UI receipt.
        expect(await exactRow(page, "stock-moves", residual.id)).toEqual(residualBefore)
        const terminalReceipt = await receiveViaForm(operator, orderId, lineId, 6)
        await expectCanonicalPickingFocus(operator, childId)
        await expect.poll(() => quantities(page, lineId)).toEqual({
          ordered: 10, received: 10, invoiced: 4,
        })
        await expect.poll(() => invoiceStatus(page, orderId)).toBe("Partial")
        await operator.reload()
        await expectCanonicalPickingFocus(operator, childId)
        expect(await invoiceStatus(page, orderId)).toBe("Partial")
        // Must be reachable through the existing form after backend invoice-status
        // refresh; no manual status update or direct API billing workaround.
        const bill2 = await createExactBill()
        expect(bill2.billId).not.toBe(bill1.billId)

        const assertEffects = async () => {
          expect(await quantities(page, lineId)).toEqual({
            ordered: 10, received: 10, invoiced: 10,
          })
          expect(await invoiceStatus(page, orderId)).toBe("Invoiced")
          expect(await fetchPurchaseOrderInvoiceIds(page, orderId)).toEqual(
            [bill1.billId, bill2.billId].sort((a, b) => a - b),
          )
          for (const bill of [bill1, bill2]) {
            expect(await fetchVendorBillById(page, bill.billId)).toEqual(bill.bill)
            expect(await exactRow(page, "account-moves", bill.billId)).toEqual(bill.billRow)
            expect(await billLines(page, bill.billId)).toEqual(bill.allLines)
          }
          expect(await exactRow(page, "stock-moves", source.id)).toEqual(firstMove)
          expect(await fetchPurchaseLineReceiptMoves(page, lineId)).toEqual(
            [
              { ...source, state: "done", isDone: true },
              { ...residual, state: "done", isDone: true },
            ].sort((a, b) => a.id - b.id),
          )
          const finalResidual = await exactRow(page, "stock-moves", residual.id)
          expect(Number(field(finalResidual, "quantityDone", "quantity_done"))).toBe(6)
          expect(Number(field(finalResidual, "productUomQty", "product_uom_qty"))).toBe(6)
          expect(scalarQueryId(field(finalResidual, "purchaseLineId", "purchase_line_id")))
            .toBe(lineId)
          expect(await fetchPurchaseOrderReceipts(page, orderId)).toEqual(
            [source.pickingId, childId].sort((a, b) => a - b)
              .map((id) => ({ id, state: "done" })),
          )
          const finalParent = await exactRow(page, "stock-pickings", source.pickingId)
          expect(relationIds(finalParent, "backorderIds", "backorder_ids")).toEqual([childId])
          const finalChild = await exactRow(page, "stock-pickings", childId)
          expect(scalarQueryId(field(finalChild, "backorderId", "backorder_id")))
            .toBe(source.pickingId)
          expect(relationIds(finalChild, "backorderIds", "backorder_ids")).toEqual([])
        }
        await assertEffects()
        await operator.reload()
        await expectBillFocus(operator, bill2.billId)
        await assertEffects()

        // Preserve the exact terminal stock effects on rejection. Do not equate
        // PO-UOM quantities to stock delta: quants use the current product base
        // UOM, which may differ from the fixture form's selected PO UOM.
        // Run this proof with one worker, isolated from other laptop mutations.
        const terminalQuants = await destinationQuants(page, sourceMove)
        const terminalResidual = await exactRow(page, "stock-moves", residual.id)
        const assertRejectedEffects = async () => {
          await assertEffects()
          expect(await exactRow(page, "stock-moves", residual.id)).toEqual(terminalResidual)
          expect(await destinationQuants(page, sourceMove)).toEqual(terminalQuants)
        }
        // Supplementary negative API checks replay only the terminal residual 6,
        // never the unsafe first partial 4. Repeat to prove rejection is stable.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          expect((await replayAs(operator, terminalReceipt)).status()).toBe(422)
          await assertRejectedEffects()
        }
        expect((await replayAs(operator, bill2.request)).status()).toBe(422)
        await assertRejectedEffects()
        const readerContext = await browser.newContext({
          storageState: { cookies: [], origins: [] },
        })
        try {
          const reader = await readerContext.newPage()
          await signIn(reader, "fixture.reader@example.test", PASSWORD)
          expect((await replayAs(reader, terminalReceipt)).status()).toBe(403)
          expect((await replayAs(reader, bill2.request)).status()).toBe(403)
          await assertRejectedEffects()
        } finally {
          await readerContext.close()
        }
      } finally {
        await context.close()
      }
    })
  },
)
