import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"

import { activeTabEntityTable, signIn, smokeName } from "./helpers"
import {
  addLaptopPurchaseLine,
  confirmPurchaseOrderViaUi,
  createDraftPurchaseOrder,
  fetchPurchaseOrderReceipts,
  fetchPurchaseOrderState,
} from "./purchasing-order-fixtures"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

async function confirmRequest(page: Page, orderId: number) {
  const { urlPath, init } = stdbBffCommandPost("confirm_purchase_order", {
    orderId,
  })
  return page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
}

function isCanonicalPurchaseOrderUrl(url: URL, orderId: number): boolean {
  return (
    url.pathname === "/purchasing" &&
    url.searchParams.get("tab") === "orders" &&
    url.searchParams.getAll("filter").length === 1 &&
    url.searchParams.get("filter") === `id:${orderId}`
  )
}

async function expectCanonicalPurchaseOrderFocus(
  page: Page,
  orderId: number,
): Promise<void> {
  await expect(page).toHaveURL((url) =>
    isCanonicalPurchaseOrderUrl(url, orderId),
  )
  await expect(
    page.getByTestId("module-tab-purchasing-orders"),
  ).toHaveAttribute("aria-selected", "true")

  const table = activeTabEntityTable(page)
  await expect(table.getByTestId(`entity-row-${orderId}`)).toBeVisible()
  await expect(table.locator('[data-testid^="entity-row-"]')).toHaveCount(1)
  await expect(table.getByTestId("entity-active-filter-id")).toContainText(
    `id: ${orderId}`,
  )
}

test.describe(
  "COV-05 purchase-order confirmation",
  { tag: ["@p0", "@cov05", "@unauthenticated"] },
  () => {
    test("purchasing persona confirms one canonical PO and reader is denied", async ({
      browser,
      page,
    }) => {
      test.setTimeout(180_000)

      await signIn(page, "test@email.com", PERSONA_PASSWORD)
      const origin = smokeName("cov05-confirm")
      const orderId = await createDraftPurchaseOrder(page, origin)
      await addLaptopPurchaseLine(page, orderId)

      expect(await fetchPurchaseOrderState(page, orderId)).toBe("Draft")
      expect(await fetchPurchaseOrderReceipts(page, orderId)).toEqual([])

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
        await confirmPurchaseOrderViaUi(purchasingPage, orderId)
        await expectCanonicalPurchaseOrderFocus(purchasingPage, orderId)

        await expect
          .poll(() => fetchPurchaseOrderState(page, orderId), {
            timeout: 30_000,
          })
          .toBe("Purchase")

        const receipts = await fetchPurchaseOrderReceipts(page, orderId)
        expect(receipts).toHaveLength(1)

        const staleReplay = await confirmRequest(purchasingPage, orderId)
        expect(staleReplay.status()).toBe(422)
        expect(await fetchPurchaseOrderState(page, orderId)).toBe("Purchase")
        expect(await fetchPurchaseOrderReceipts(page, orderId)).toEqual(receipts)

        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        const denial = await confirmRequest(readerPage, orderId)
        expect(denial.status()).toBe(403)
        expect(await fetchPurchaseOrderState(page, orderId)).toBe("Purchase")
        expect(await fetchPurchaseOrderReceipts(page, orderId)).toEqual(receipts)
      } finally {
        await readerContext.close()
        await purchasingContext.close()
      }
    })
  },
)
