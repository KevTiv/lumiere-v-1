import { expect, test } from "@playwright/test"
import type { Page, Request } from "@playwright/test"

import { activeTabEntityTable, signIn, smokeName } from "./helpers"
import {
  addLaptopPurchaseLine,
  confirmPurchaseOrderViaUi,
  createDraftPurchaseOrder,
  createVendorBillViaUi,
  fetchPurchaseOrderInvoiceIds,
  fetchPurchaseOrderLineIds,
  fetchVendorBillById,
  receivePurchaseLineViaUi,
} from "./purchasing-order-fixtures"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

async function replayOperationAs(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

function isCanonicalBillUrl(url: URL, billId: number): boolean {
  return (
    url.pathname === "/accounting" &&
    url.searchParams.get("tab") === "journal-entries" &&
    url.searchParams.getAll("filter").length === 1 &&
    url.searchParams.get("filter") === `id:${billId}`
  )
}

async function expectCanonicalBillFocus(
  page: Page,
  billId: number,
): Promise<void> {
  await expect(page).toHaveURL((url) => isCanonicalBillUrl(url, billId))
  await expect(
    page.getByTestId("module-tab-accounting-journal-entries"),
  ).toHaveAttribute("aria-selected", "true")

  const table = activeTabEntityTable(page)
  await expect(table.getByTestId(`entity-row-${billId}`)).toBeVisible()
  await expect(table.locator('[data-testid^="entity-row-"]')).toHaveCount(1)
  await expect(table.getByTestId("entity-active-filter-id")).toContainText(
    `id: ${billId}`,
  )
}

test.describe(
  "COV-05c purchase order vendor bill",
  { tag: ["@p0", "@cov05", "@cov05c", "@unauthenticated"] },
  () => {
    test("purchasing persona creates one exact bill and replay/reader cannot duplicate it", async ({
      browser,
      page,
    }) => {
      test.setTimeout(180_000)

      // Fixture setup uses the admin only to create a deterministic received PO.
      await signIn(page, "test@email.com", PERSONA_PASSWORD)
      const orderId = await createDraftPurchaseOrder(
        page,
        smokeName("cov05c-bill"),
      )
      await addLaptopPurchaseLine(page, orderId, "1")
      await confirmPurchaseOrderViaUi(page, orderId)

      const lineIds = await fetchPurchaseOrderLineIds(page, orderId)
      expect(lineIds).toHaveLength(1)
      const [lineId] = lineIds
      if (lineId == null) throw new Error("Expected one PO line")
      await receivePurchaseLineViaUi(page, lineId)

      expect(await fetchPurchaseOrderInvoiceIds(page, orderId)).toEqual([])

      const purchasingContext = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      })
      const purchasingPage = await purchasingContext.newPage()
      const readerContext = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      })
      const readerPage = await readerContext.newPage()

      try {
        await signIn(
          purchasingPage,
          "fixture.purchasing@example.test",
          PERSONA_PASSWORD,
        )

        const billResponse = await createVendorBillViaUi(
          purchasingPage,
          orderId,
        )

        let invoiceIds: number[] = []
        await expect
          .poll(
            async () => {
              invoiceIds = await fetchPurchaseOrderInvoiceIds(page, orderId)
              return invoiceIds
            },
            { timeout: 30_000 },
          )
          .toHaveLength(1)

        const [billId] = invoiceIds
        if (billId == null) throw new Error("Expected one canonical vendor bill")

        await expectCanonicalBillFocus(purchasingPage, billId)

        const bill = await fetchVendorBillById(page, billId)
        expect(bill).toMatchObject({
          id: billId,
          moveType: "InInvoice",
          state: "Draft",
          invoiceOrigin: `PO${orderId}`,
        })
        expect(bill?.amountTotal ?? 0).toBeGreaterThan(0)

        // Re-issuing the exact accepted request is stale: all received quantity is
        // already billed, so no second account_move may appear.
        const staleReplay = await replayOperationAs(
          purchasingPage,
          billResponse.request(),
        )
        expect(staleReplay.status()).toBe(422)
        expect(await fetchPurchaseOrderInvoiceIds(page, orderId)).toEqual([
          billId,
        ])

        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        const denial = await replayOperationAs(
          readerPage,
          billResponse.request(),
        )
        expect(denial.status()).toBe(403)
        expect(await fetchPurchaseOrderInvoiceIds(page, orderId)).toEqual([
          billId,
        ])
        expect(await fetchVendorBillById(page, billId)).toEqual(bill)
      } finally {
        await readerContext.close()
        await purchasingContext.close()
      }
    })
  },
)
