/**
 * Requires `seed_dev_data` (via `make e2e-smoke` / `pnpm run e2e-seed-fixture`).
 *
 * Seeded records: sale order `SO/2024/0001`.
 */
import { expect, test } from "@playwright/test"

import {
  expectMailMessageForRecord,
  expectNoAppError,
  gotoModule,
  openRecordChatterByRowText,
  postChatterNote,
  scalarQueryId,
  smokeName,
} from "./helpers"

const SEEDED_SALE_ORDER_REF = "SO/2024/0001"

async function fetchSaleOrderIdByReference(page: import("@playwright/test").Page, reference: string) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/sale-orders")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: unknown; name?: string; reference?: string }>
      }
      const row = (json.data ?? []).find((r) => {
        const ref = String(r.name ?? r.reference ?? "")
        return ref === reference
      })
      const id = scalarQueryId(row?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`sale order not found: ${reference}`)
}

test.describe("Parity phase 5 — chatter mutations", { tag: ["@dev-fixture", "@parity-phase-5"] }, () => {
  test("posts an internal note on a seeded sale order and persists mail_message", async ({
    page,
  }) => {
    test.setTimeout(120_000)

    const noteBody = smokeName("chatter-note")
    const saleOrderId = await fetchSaleOrderIdByReference(page, SEEDED_SALE_ORDER_REF)

    await gotoModule(page, "/sales", "sales")
    await page.getByTestId("module-tab-sales-orders").click()
    await openRecordChatterByRowText(page, SEEDED_SALE_ORDER_REF)
    await postChatterNote(page, noteBody)

    await expectMailMessageForRecord(page, {
      model: "sale_order",
      resId: saleOrderId,
      bodyContains: noteBody,
    })

    await expect(page.getByTestId("record-chatter-dialog").getByText(noteBody)).toBeVisible({
      timeout: 15_000,
    })

    await expectNoAppError(page)
  })
})
