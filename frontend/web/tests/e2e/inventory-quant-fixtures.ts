import { expect } from "@playwright/test"
import type { Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

import { matchesOperationResponse } from "./operation-response"
import {
  activeTabEntityTable,
  chooseSelectOptionByLabel,
  fillField,
  gotoModule,
  scalarQueryId,
  selectEntityRowById,
  selectModuleTab,
  submitForm,
} from "./helpers"

export interface QuantSnapshot {
  id: number
  productId: number
  locationId: number
  quantity: number
  availableQuantity: number
  reservedQuantity: number
}

export async function createInternalLocation(
  page: Page,
  name: string,
): Promise<number> {
  const { urlPath, init } = stdbBffCommandPost("create_stock_location", {
    params: stdbParamsToJson(
      {
        name,
        usage: "internal",
        locationCategory: "internal",
        parentPath: "/",
        childLeft: 0,
        childRight: 1,
        scrapLocation: false,
        returnLocation: false,
        active: true,
        posx: 0,
        posy: 0,
        posz: 0,
        cyclicInventoryFrequency: 0,
        locationId: null,
        completeName: name,
        valuationInAccountId: null,
        valuationOutAccountId: null,
        comment: null,
        barcode: null,
        lastInventoryDate: null,
        nextInventoryDate: null,
        metadata: null,
      },
      "CreateStockLocationParams",
    ),
  })
  const response = await page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
  expect(response.ok()).toBe(true)

  let locationId = 0
  await expect
    .poll(
      async () => {
        const query = await page.request.get("/api/query/stock-locations")
        if (!query.ok()) return 0
        const payload = (await query.json()) as {
          data?: Array<Record<string, unknown>>
        }
        const matches = (payload.data ?? []).filter(
          (row) => String(row.name ?? "") === name,
        )
        if (matches.length !== 1) return 0
        locationId = scalarQueryId(matches[0]?.id) ?? 0
        return locationId
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)
  return locationId
}

export async function findProductIdByName(
  page: Page,
  name: string,
): Promise<number> {
  const response = await page.request.get("/api/query/products")
  if (!response.ok()) throw new Error("Failed to query products")
  const payload = (await response.json()) as {
    data?: Array<Record<string, unknown>>
  }
  const matches = (payload.data ?? []).filter(
    (row) => String(row.name ?? "") === name,
  )
  if (matches.length !== 1) {
    throw new Error(`Expected one product named ${name}, got ${matches.length}`)
  }
  const id = scalarQueryId(matches[0]?.id)
  if (id == null) throw new Error(`Product ${name} has no id`)
  return id
}

export async function createStockQuantFixture(
  page: Page,
  companyId: number,
  productId: number,
  locationId: number,
  marker: string,
  quantity = 3,
): Promise<number> {
  const { urlPath, init } = stdbBffCommandPost("create_stock_quant", {
    params: stdbParamsToJson(
      {
        companyId,
        productId,
        productVariantId: null,
        locationId,
        lotId: null,
        packageId: null,
        ownerId: null,
        quantity,
        reservedQuantity: 0,
        inDate: null,
        inventoryQuantity: 0,
        inventoryDiffQuantity: 0,
        inventoryQuantitySet: false,
        isOutdated: false,
        userId: null,
        inventoryDate: null,
        cost: 10,
        costMethod: "standard",
        accountingDate: null,
        currencyId: null,
        accountingEntryIds: [],
        metadata: marker,
      },
      "CreateStockQuantParams",
    ),
  })
  const response = await page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
  expect(response.ok()).toBe(true)

  let quantId = 0
  await expect
    .poll(
      async () => {
        const query = await page.request.get("/api/query/stock-quants")
        if (!query.ok()) return 0
        const payload = (await query.json()) as {
          data?: Array<Record<string, unknown>>
        }
        const matches = (payload.data ?? []).filter(
          (row) => String(row.metadata ?? "") === marker,
        )
        if (matches.length !== 1) return 0
        quantId = scalarQueryId(matches[0]?.id) ?? 0
        return quantId
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)
  return quantId
}

export async function fetchQuantById(
  page: Page,
  quantId: number,
): Promise<QuantSnapshot | undefined> {
  const response = await page.request.get("/api/query/stock-quants")
  if (!response.ok()) return undefined
  const payload = (await response.json()) as {
    data?: Array<Record<string, unknown>>
  }
  const row = (payload.data ?? []).find(
    (candidate) => scalarQueryId(candidate.id) === quantId,
  )
  if (!row) return undefined
  return {
    id: quantId,
    productId: scalarQueryId(row.productId ?? row.product_id) ?? 0,
    locationId: scalarQueryId(row.locationId ?? row.location_id) ?? 0,
    quantity: Number(row.quantity ?? 0),
    availableQuantity: Number(
      row.availableQuantity ?? row.available_quantity ?? 0,
    ),
    reservedQuantity: Number(
      row.reservedQuantity ?? row.reserved_quantity ?? 0,
    ),
  }
}

export async function fetchQuantsAtProductLocation(
  page: Page,
  productId: number,
  locationId: number,
): Promise<QuantSnapshot[]> {
  const response = await page.request.get("/api/query/stock-quants")
  if (!response.ok()) return []
  const payload = (await response.json()) as {
    data?: Array<Record<string, unknown>>
  }
  return (payload.data ?? [])
    .filter(
      (row) =>
        scalarQueryId(row.productId ?? row.product_id) === productId &&
        scalarQueryId(row.locationId ?? row.location_id) === locationId,
    )
    .flatMap((row) => {
      const id = scalarQueryId(row.id)
      if (id == null) return []
      return [
        {
          id,
          productId,
          locationId,
          quantity: Number(row.quantity ?? 0),
          availableQuantity: Number(
            row.availableQuantity ?? row.available_quantity ?? 0,
          ),
          reservedQuantity: Number(
            row.reservedQuantity ?? row.reserved_quantity ?? 0,
          ),
        },
      ]
    })
    .sort((a, b) => a.id - b.id)
}

export async function moveQuantViaInventoryUi(
  page: Page,
  quantId: number,
  targetLocationLabel: string,
  quantity: number,
): Promise<void> {
  await gotoModule(page, "/inventory", "inventory")
  await page.getByTestId("module-tab-inventory-stock").click()
  await selectEntityRowById(page, quantId)
  await page.getByTestId("entity-action-move-stock-quant").click()
  await expect(page.getByTestId("form-modal-move-stock-quant")).toBeVisible({
    timeout: 15_000,
  })
  await chooseSelectOptionByLabel(
    page,
    "targetLocationId",
    targetLocationLabel,
  )
  await fillField(page, "quantity", String(quantity))

  await Promise.all([
    page.waitForResponse(
      (response) =>
        matchesOperationResponse(response, "move_stock_quant") &&
        response.ok(),
      { timeout: 30_000 },
    ),
    submitForm(page, "move-stock-quant"),
  ])
}

/**
 * Drive one bounded cycle count end-to-end through the wizard UI: create plan →
 * start session → record exactly one line → validate → post adjustments.
 * The wizard auto-advances to the newest plan it created at the chosen
 * location, so this only targets the newest one at that location.
 */
export async function runCycleCountToPostedViaWizardUi(
  page: Page,
  params: {
    locationId: number
    productId: number
    uomId: number
    countedQty: number
  },
): Promise<void> {
  await gotoModule(page, "/inventory", "inventory")
  await selectModuleTab(page, "inventory", "cycle-wizard")

  await page.locator("#cc-loc").selectOption(String(params.locationId))
  await page.getByTestId("cycle-wizard-create-plan").click()

  await expect(page.getByTestId("cycle-wizard-start-session")).toBeEnabled({
    timeout: 30_000,
  })
  await page.getByTestId("cycle-wizard-start-session").click()

  await expect(page.locator("#cc-prod")).toBeVisible({ timeout: 30_000 })
  await page.locator("#cc-prod").selectOption(String(params.productId))
  await page.locator("#cc-rec-loc").selectOption(String(params.locationId))
  await page.locator("#cc-qty").fill(String(params.countedQty))
  await page.locator("#cc-uom").selectOption(String(params.uomId))
  await page.getByTestId("cycle-wizard-record-line").click()

  await expect(page.getByTestId("cycle-wizard-validate")).toBeEnabled({
    timeout: 30_000,
  })
  await page.getByTestId("cycle-wizard-validate").click()

  await expect(page.getByTestId("cycle-wizard-post")).toBeEnabled({
    timeout: 30_000,
  })
  await page.getByTestId("cycle-wizard-post").click()
}

export async function expectCanonicalQuantFocus(
  page: Page,
  quantId: number,
): Promise<void> {
  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === "/inventory" &&
      url.searchParams.get("tab") === "stock" &&
      url.searchParams.getAll("filter").length === 1 &&
      url.searchParams.get("filter") === `id:${quantId}`
    )
  })
  await expect(page.getByTestId("module-tab-inventory-stock")).toHaveAttribute(
    "aria-selected",
    "true",
  )

  const table = activeTabEntityTable(page)
  await expect(table.getByTestId(`entity-row-${quantId}`)).toBeVisible()
  await expect(table.locator('[data-testid^="entity-row-"]')).toHaveCount(1)
}
