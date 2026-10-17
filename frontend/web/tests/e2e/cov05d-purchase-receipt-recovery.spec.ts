import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

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
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"
import {
  addLaptopPurchaseLine,
  confirmPurchaseOrderViaUi,
  createDraftPurchaseOrder,
  fetchPurchaseLineReceiptMoves,
  fetchPurchaseLineReceivedQty,
  fetchPurchaseOrderLineIds,
  fetchPurchaseOrderReceipts,
} from "./purchasing-order-fixtures"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"
const RECEIVE_FORM = "receive-purchase-order-line"
const REQUESTED_QTY = 2

type Row = Record<string, unknown>

async function queryRows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  expect(response.ok(), `${resource}: ${response.status()}`).toBe(true)
  const payload = (await response.json()) as { data: Row[] }
  expect(Array.isArray(payload.data), `${resource} canonical rows`).toBe(true)
  return payload.data
}

function field(row: Row, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake]
}

async function exactRow(page: Page, resource: string, id: number): Promise<Row> {
  const rows = (await queryRows(page, resource)).filter(
    (row) => scalarQueryId(row.id) === id,
  )
  expect(rows, `${resource} exact id ${id}`).toHaveLength(1)
  return rows[0]!
}

// Stock ownership comes from the captured move, never a partner/product-name
// search. Run this slice serially with other tests mutating the seeded laptop.
async function destinationStock(page: Page, move: Row): Promise<number> {
  const quants = (await queryRows(page, "stock-quants")).filter(
    (row) =>
      scalarQueryId(field(row, "companyId", "company_id")) ===
        scalarQueryId(field(move, "companyId", "company_id")) &&
      scalarQueryId(field(row, "productId", "product_id")) ===
        scalarQueryId(field(move, "productId", "product_id")) &&
      scalarQueryId(field(row, "locationId", "location_id")) ===
        scalarQueryId(field(move, "locationDestId", "location_dest_id")) &&
      scalarQueryId(field(row, "lotId", "lot_id")) ===
        scalarQueryId(field(move, "lotId", "lot_id")) &&
      scalarQueryId(field(row, "ownerId", "owner_id")) == null,
  )
  return quants.reduce((quantity, row) => quantity + Number(row.quantity), 0)
}

async function expectReceiptFocus(page: Page, pickingId: number): Promise<void> {
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/inventory" &&
      url.searchParams.get("tab") === "transfers" &&
      url.searchParams.getAll("filter").length === 1 &&
      url.searchParams.get("filter") === `id:${pickingId}`,
  )
  await expect(page.getByTestId("module-tab-inventory-transfers")).toHaveAttribute(
    "aria-selected",
    "true",
  )
  const table = activeTabEntityTable(page)
  await expect(table.getByTestId(`entity-row-${pickingId}`)).toBeVisible()
  await expect(table.locator('[data-testid^="entity-row-"]')).toHaveCount(1)
  await expect(table.getByTestId("entity-active-filter-id")).toContainText(
    `id: ${pickingId}`,
  )
}

test.describe(
  "COV-05d purchase receipt response-loss recovery",
  { tag: ["@p0", "@cov05", "@cov05d", "@unauthenticated"] },
  () => {
    test("purchasing operator recovers the committed exact receipt without resending or doubling quantity", async ({
      browser,
      page,
    }) => {
      test.setTimeout(180_000)

      // Setup and confirmation are browser actions by the administrator.
      await signIn(page, "test@email.com", PERSONA_PASSWORD)
      const orderId = await createDraftPurchaseOrder(
        page,
        smokeName("cov05d-receipt-recovery"),
      )
      await addLaptopPurchaseLine(page, orderId, String(REQUESTED_QTY))
      await confirmPurchaseOrderViaUi(page, orderId)
      const lineIds = await fetchPurchaseOrderLineIds(page, orderId)
      expect(lineIds).toHaveLength(1)
      const lineId = lineIds[0]!
      const beforeMoves = await fetchPurchaseLineReceiptMoves(page, lineId)
      expect(beforeMoves).toHaveLength(1)
      const target = beforeMoves[0]!
      expect(target.isDone).toBe(false)
      expect(target.state).not.toBe("done")
      const beforeQty = await fetchPurchaseLineReceivedQty(page, lineId)
      expect(beforeQty).toBe(0)
      const moveBefore = await exactRow(page, "stock-moves", target.id)
      expect(Number(field(moveBefore, "productUomQty", "product_uom_qty"))).toBe(
        REQUESTED_QTY,
      )
      expect(Number(field(moveBefore, "quantityDone", "quantity_done"))).toBe(0)
      const productId = scalarQueryId(field(moveBefore, "productId", "product_id"))
      expect(productId).not.toBeNull()
      const product = await exactRow(page, "products", productId!)
      expect(
        scalarQueryId(field(moveBefore, "productUom", "product_uom")),
        "fixture receipt must use the product's base UOM for exact stock delta",
      ).toBe(scalarQueryId(field(product, "uomId", "uom_id")))
      const receiptsBefore = await fetchPurchaseOrderReceipts(page, orderId)
      expect(receiptsBefore).toHaveLength(1)
      expect(receiptsBefore[0]?.id).toBe(target.pickingId)
      const stockBefore = await destinationStock(page, moveBefore)

      const context = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      })
      const operator = await context.newPage()
      let actionRequests = 0
      let upstreamProcessed = false
      let postCommitStockReads = 0
      operator.on("request", (request) => {
        if (request.method() === "POST" &&
            matchesOperationResponse(request, "erp.receive_po_line_once")) {
          actionRequests += 1
        }
        if (upstreamProcessed &&
            new URL(request.url()).pathname === "/api/query/stock-moves") {
          postCommitStockReads += 1
        }
      })

      try {
        await signIn(operator, "fixture.purchasing@example.test", PERSONA_PASSWORD)
        const lineLabel = await fetchPurchaseOrderLineReceiveLabel(
          operator, orderId, lineId,
        )
        await gotoModule(operator, "/purchasing", "purchasing")
        await selectModuleTab(operator, "purchasing", "lines")
        await operator.getByTestId("entity-action-pol-receive-form").click()
        await expect(operator.getByTestId(`form-modal-${RECEIVE_FORM}`)).toBeVisible()
        await chooseSelectOptionByLabel(operator, "lineId", lineLabel)
        await fillField(operator, "qty", String(REQUESTED_QTY))

        await operator.route(
          (url) => url.pathname === "/api/operations/erp.receive_po_line_once",
          async (route) => {
            // Never send a second consequential request upstream, even if the
            // client regresses to retrying; the request counter still fails.
            if (actionRequests !== 1) {
              await route.abort("failed")
              return
            }
            // The real upstream response must arrive before we drop it. This
            // is committed-but-response-lost, not an abort before dispatch.
            const response = await route.fetch({ maxRetries: 0 })
            expect(response.ok(), await response.text()).toBe(true)
            expect(await fetchPurchaseLineReceivedQty(page, lineId)).toBe(
              beforeQty! + REQUESTED_QTY,
            )
            expect(await fetchPurchaseLineReceiptMoves(page, lineId)).toEqual([
              { ...target, state: "done", isDone: true },
            ])
            upstreamProcessed = true
            await route.abort("failed")
          },
        )

        await operator.getByTestId(`form-submit-${RECEIVE_FORM}`).click()
        await expectReceiptFocus(operator, target.pickingId)
        expect(upstreamProcessed).toBe(true)
        expect(postCommitStockReads).toBeGreaterThan(0)
        expect(actionRequests, "ambiguous receipt must never be redispatched").toBe(1)
        await expect(operator.getByTestId(`form-modal-${RECEIVE_FORM}`)).toBeHidden()

        const assertCanonicalPersistence = async () => {
          expect(await fetchPurchaseLineReceivedQty(page, lineId)).toBe(
            beforeQty! + REQUESTED_QTY,
          )
          expect(await fetchPurchaseLineReceiptMoves(page, lineId)).toEqual([
            { ...target, state: "done", isDone: true },
          ])
          const move = await exactRow(page, "stock-moves", target.id)
          expect(Number(field(move, "quantityDone", "quantity_done"))).toBe(REQUESTED_QTY)
          // The released stock-moves projection exposes quantity_done, not
          // product_uom_qty_done. Verify its quantity and destination stock,
          // rather than asserting an unavailable internal duplicate field.
          expect(await fetchPurchaseOrderReceipts(page, orderId)).toEqual([
            { id: target.pickingId, state: "done" },
          ])
          // The fixture uses the product's base UOM; stock delta must match
          // the requested receipt, not just preserve a done flag.
          expect(await destinationStock(page, moveBefore)).toBe(
            stockBefore + REQUESTED_QTY,
          )
          expect(actionRequests).toBe(1)
        }
        await assertCanonicalPersistence()
        await operator.reload()
        await expectReceiptFocus(operator, target.pickingId)
        await assertCanonicalPersistence()
      } finally {
        try {
          await operator.unrouteAll({ behavior: "wait" })
        } finally {
          await context.close()
        }
      }
      expect(actionRequests).toBe(1)
    })
  },
)
