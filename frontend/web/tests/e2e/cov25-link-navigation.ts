import { expect, type Page } from "@playwright/test"
import { moduleTabHref } from "@lumiere/erp-shared/record-links"
import { activeTabEntityTable, gotoModule } from "./helpers"

export type RecordTarget = { module: string; tab: string; id: number }
const tabTestId = (target: RecordTarget) => target.module === "sales" && target.tab === "orders"
  ? "module-tab-sales-orders" : `module-tab-${target.module}-${target.tab}`

export async function expectExactRecordFocus(page: Page, target: RecordTarget) {
  await expect(page).toHaveURL((url) => url.pathname === `/${target.module}` &&
    url.searchParams.get("tab") === target.tab &&
    url.searchParams.getAll("filter").length === 1 &&
    url.searchParams.get("filter") === `id:${target.id}`)
  await expect(page.getByTestId(tabTestId(target))).toHaveAttribute("aria-selected", "true")
  const table = activeTabEntityTable(page)
  await expect(table.getByTestId(`entity-row-${target.id}`)).toBeVisible({ timeout: 30_000 })
  await expect(table.locator('[data-testid^="entity-row-"]')).toHaveCount(1)
  await expect(table.getByTestId("entity-active-filter-id")).toContainText(`id: ${target.id}`)
}

export async function openCanonicalHandoffs(page: Page, source: RecordTarget) {
  await gotoModule(page, moduleTabHref(source.module, source.tab, { id: String(source.id) }), source.module)
  await expectExactRecordFocus(page, source)
  await activeTabEntityTable(page).getByTestId(`entity-row-${source.id}`).click()
  const sheet = page.locator('[data-slot="sheet-content"]:visible')
  await expect(sheet).toBeVisible()
  await sheet.getByTestId("entity-record-sheet-tab-handoffs").click()
  return sheet
}

/** A real source-sheet click, not a direct destination visit or BFF substitute. */
export async function clickCanonicalHandoff(page: Page, source: RecordTarget, linkTestId: string, target: RecordTarget) {
  const sheet = await openCanonicalHandoffs(page, source)
  const link = sheet.getByTestId(linkTestId)
  await expect(link).toHaveAttribute("href", moduleTabHref(target.module, target.tab, { id: String(target.id) }))
  await link.click()
  await expectExactRecordFocus(page, target)
  await page.reload({ waitUntil: "domcontentloaded" })
  await expectExactRecordFocus(page, target)
  await page.goBack({ waitUntil: "domcontentloaded" })
  await expectExactRecordFocus(page, source)
  // History returns to the exact parent, not a default list. Re-open its sheet and click again.
  await activeTabEntityTable(page).getByTestId(`entity-row-${source.id}`).click()
  await page.getByTestId("entity-record-sheet-tab-handoffs").click()
  await page.locator('[data-slot="sheet-content"]:visible').getByTestId(linkTestId).click()
  await expectExactRecordFocus(page, target)
}
