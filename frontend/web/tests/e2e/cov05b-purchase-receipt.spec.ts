import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"

import { activeTabEntityTable, signIn, smokeName } from "./helpers"
import {
  addLaptopPurchaseLine,
  confirmPurchaseOrderViaUi,
  createDraftPurchaseOrder,
  fetchPurchaseLineReceiptMoves,
  fetchPurchaseLineReceivedQty,
  fetchPurchaseOrderLineIds,
  receivePurchaseLineViaUi,
} from "./purchasing-order-fixtures"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

async function receiveRequest(page: Page, lineId: number, qty: number) {
  const { urlPath, init } = stdbBffCommandPost("receive_po_line", {
    lineId,
    qty,
    lotId: null,
  })
  return page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
}

function isCanonicalReceiptUrl(url: URL, pickingId: number): boolean {
  return (
    url.pathname === "/inventory" &&
    url.searchParams.get("tab") === "transfers" &&
    url.searchParams.getAll("filter").length === 1 &&
    url.searchParams.get("filter") === `id:${pickingId}`
  )
}

async function expectCanonicalReceiptFocus(
  page: Page,
  pickingId: number,
): Promise<void> {
  await expect(page).toHaveURL((url) => isCanonicalReceiptUrl(url, pickingId))
  await expect(
    page.getByTestId("module-tab-inventory-transfers"),
  ).toHaveAttribute("aria-selected", "true")

  const table = activeTabEntityTable(page)
  await expect(table.getByTestId(`entity-row-${pickingId}`)).toBeVisible()
  await expect(table.locator('[data-testid^="entity-row-"]')).toHaveCount(1)
  await expect(table.getByTestId("entity-active-filter-id")).toContainText(
    `id: ${pickingId}`,
  )
}

test.describe(
  "COV-05b purchase receipt",
  { tag: ["@p0", "@cov05", "@cov05b", "@unauthenticated"] },
  () => {
    test("purchasing persona receives one exact PO line and replay/reader cannot change it", async ({
      browser,
      page,
    }) => {
      test.setTimeout(180_000)

      await signIn(page, "test@email.com", PERSONA_PASSWORD)
      const orderId = await createDraftPurchaseOrder(
        page,
        smokeName("cov05b-receipt"),
      )
      await addLaptopPurchaseLine(page, orderId, "1")
      await confirmPurchaseOrderViaUi(page, orderId)

      const lineIds = await fetchPurchaseOrderLineIds(page, orderId)
      expect(lineIds).toHaveLength(1)
      const [lineId] = lineIds
      if (lineId == null) throw new Error("Expected one PO line")

      const beforeMoves = await fetchPurchaseLineReceiptMoves(page, lineId)
      expect(beforeMoves).toHaveLength(1)
      const [target] = beforeMoves
      if (target == null) throw new Error("Expected one canonical receipt move")
      expect(target.isDone).toBe(false)
      expect(target.state).not.toBe("done")
      expect(await fetchPurchaseLineReceivedQty(page, lineId)).toBe(0)

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
        await receivePurchaseLineViaUi(purchasingPage, lineId)
        await expectCanonicalReceiptFocus(purchasingPage, target.pickingId)

        await expect
          .poll(() => fetchPurchaseLineReceivedQty(page, lineId), {
            timeout: 30_000,
          })
          .toBe(1)

        const afterMoves = await fetchPurchaseLineReceiptMoves(page, lineId)
        expect(afterMoves).toHaveLength(1)
        expect(afterMoves[0]).toMatchObject({
          id: target.id,
          pickingId: target.pickingId,
          state: "done",
          isDone: true,
        })

        const staleReplay = await receiveRequest(purchasingPage, lineId, 1)
        expect(staleReplay.status()).toBe(422)
        expect(await fetchPurchaseLineReceivedQty(page, lineId)).toBe(1)
        expect(await fetchPurchaseLineReceiptMoves(page, lineId)).toEqual(
          afterMoves,
        )

        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        const denial = await receiveRequest(readerPage, lineId, 1)
        expect(denial.status()).toBe(403)
        expect(await fetchPurchaseLineReceivedQty(page, lineId)).toBe(1)
        expect(await fetchPurchaseLineReceiptMoves(page, lineId)).toEqual(
          afterMoves,
        )
      } finally {
        await readerContext.close()
        await purchasingContext.close()
      }
    })
  },
)
