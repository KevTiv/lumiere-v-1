import { expect } from "@playwright/test"
import type { Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

import { matchesOperationResponse } from "./operation-response"
import {
  activeTabEntityTable,
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  fetchFirstUomId,
  fillField,
  gotoModule,
  openEntityCreate,
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

async function createTrackedProductFixture(
  page: Page,
  name: string,
  tracking: "lot" | "serial" | "none",
): Promise<number> {
  const categoriesRes = await page.request.get("/api/query/product-categories")
  if (!categoriesRes.ok()) throw new Error("Failed to query product categories")
  const categories = (await categoriesRes.json()) as {
    data?: Array<Record<string, unknown>>
  }
  const categoryId = scalarQueryId(categories.data?.[0]?.id)
  if (categoryId == null) throw new Error("No product category in seed data")

  const uomId = await fetchFirstUomId(page)

  const currenciesRes = await page.request.get("/api/bootstrap/currencies")
  if (!currenciesRes.ok()) throw new Error("Failed to query currencies")
  const currencies = (await currenciesRes.json()) as {
    data?: Array<Record<string, unknown>>
  }
  const currencyId = scalarQueryId(currencies.data?.[0]?.id)
  if (currencyId == null) throw new Error("No currency in seed data")

  const { urlPath, init } = stdbBffCommandPost("create_product", {
    params: stdbParamsToJson(
      {
        name,
        categId: categoryId,
        type: "storable",
        uomId,
        uomPoId: uomId,
        standardPrice: 10,
        listPrice: 20,
        currencyId,
        tracking,
        defaultCode: name,
      },
      "CreateProductParams",
    ),
  })
  const response = await page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
  expect(response.ok()).toBe(true)

  return findProductIdByName(page, name)
}

/** Create a lot-tracked product (`tracking: "lot"`). The dev seed has no such product by default. */
export async function createLotTrackedProductFixture(
  page: Page,
  name: string,
): Promise<number> {
  return createTrackedProductFixture(page, name, "lot")
}

/** Create a serial-tracked product (`tracking: "serial"`). The dev seed has no such product by default. */
export async function createSerialTrackedProductFixture(
  page: Page,
  name: string,
): Promise<number> {
  return createTrackedProductFixture(page, name, "serial")
}

/** Create an untracked product. The dev seed's laptop is untracked too, but a fresh
 * product avoids sharing on-hand quants with other specs/fixtures. */
export async function createProductFixture(
  page: Page,
  name: string,
): Promise<number> {
  return createTrackedProductFixture(page, name, "none")
}

export async function createStockProductionLotFixture(
  page: Page,
  companyId: number,
  productId: number,
  name: string,
): Promise<number> {
  const { urlPath, init } = stdbBffCommandPost("create_stock_production_lot", {
    params: stdbParamsToJson(
      {
        companyId,
        name,
        productId,
        productVariantId: null,
        ref: null,
        note: null,
        expirationDate: null,
        useDate: null,
        removalDate: null,
        alertDate: null,
        productQty: 0,
        locationId: null,
        packageId: null,
        ownerId: null,
        isScrap: false,
        isLocked: false,
        metadata: null,
      },
      "CreateStockProductionLotParams",
    ),
  })
  const response = await page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
  expect(response.ok()).toBe(true)

  let lotId = 0
  await expect
    .poll(
      async () => {
        const query = await page.request.get("/api/query/stock-production-lots")
        if (!query.ok()) return 0
        const payload = (await query.json()) as {
          data?: Array<Record<string, unknown>>
        }
        const matches = (payload.data ?? []).filter(
          (row) =>
            String(row.name ?? "") === name &&
            scalarQueryId(row.productId ?? row.product_id) === productId,
        )
        if (matches.length !== 1) return 0
        lotId = scalarQueryId(matches[0]?.id) ?? 0
        return lotId
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)
  return lotId
}

export interface LotSnapshot {
  id: number
  locationId: number | undefined
  isLocked: boolean
}

export async function fetchLotById(
  page: Page,
  lotId: number,
): Promise<LotSnapshot | undefined> {
  const response = await page.request.get("/api/query/stock-production-lots")
  if (!response.ok()) return undefined
  const payload = (await response.json()) as {
    data?: Array<Record<string, unknown>>
  }
  const row = (payload.data ?? []).find(
    (candidate) => scalarQueryId(candidate.id) === lotId,
  )
  if (!row) return undefined
  const locationId = scalarQueryId(row.locationId ?? row.location_id)
  return {
    id: lotId,
    locationId: locationId ?? undefined,
    isLocked: Boolean(row.isLocked ?? row.is_locked ?? false),
  }
}

export async function setStockProductionLotLocked(
  page: Page,
  companyId: number,
  lotId: number,
  isLocked: boolean,
): Promise<void> {
  const { urlPath, init } = stdbBffCommandPost("update_stock_production_lot", {
    lotId,
    params: stdbParamsToJson(
      { companyId, isLocked },
      "UpdateStockProductionLotParams",
    ),
  })
  const response = await page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
  expect(response.ok()).toBe(true)
}

/** Create a free serial for a serial-tracked product. */
export async function createStockProductionSerialFixture(
  page: Page,
  companyId: number,
  productId: number,
  name: string,
): Promise<number> {
  const { urlPath, init } = stdbBffCommandPost("create_stock_production_serial", {
    params: stdbParamsToJson(
      {
        companyId,
        name,
        productId,
        productVariantId: null,
        lotId: null,
        ref: null,
        note: null,
        expirationDate: null,
        useDate: null,
        removalDate: null,
        alertDate: null,
        productQty: 1,
        locationId: null,
        packageId: null,
        ownerId: null,
        state: "free",
        isScrap: false,
        isLocked: false,
        warrantyExpiration: null,
        warrantyStart: null,
        lastMaintenance: null,
        nextMaintenance: null,
        maintenanceCount: 0,
        metadata: null,
      },
      "CreateStockProductionSerialParams",
    ),
  })
  const response = await page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
  expect(response.ok()).toBe(true)

  let serialId = 0
  await expect
    .poll(
      async () => {
        const query = await page.request.get("/api/query/stock-production-serials")
        if (!query.ok()) return 0
        const payload = (await query.json()) as {
          data?: Array<Record<string, unknown>>
        }
        const matches = (payload.data ?? []).filter(
          (row) =>
            String(row.name ?? "") === name &&
            scalarQueryId(row.productId ?? row.product_id) === productId,
        )
        if (matches.length !== 1) return 0
        serialId = scalarQueryId(matches[0]?.id) ?? 0
        return serialId
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)
  return serialId
}

function variantTagValue(value: unknown): string {
  if (value != null && typeof value === "object" && "tag" in value) {
    return String((value as { tag: string }).tag)
  }
  return String(value ?? "")
}

export interface SerialSnapshot {
  id: number
  state: string
}

export async function fetchSerialById(
  page: Page,
  serialId: number,
): Promise<SerialSnapshot | undefined> {
  const response = await page.request.get("/api/query/stock-production-serials")
  if (!response.ok()) return undefined
  const payload = (await response.json()) as {
    data?: Array<Record<string, unknown>>
  }
  const row = (payload.data ?? []).find(
    (candidate) => scalarQueryId(candidate.id) === serialId,
  )
  if (!row) return undefined
  return { id: serialId, state: variantTagValue(row.state).toLowerCase() }
}

export async function createStockQuantFixture(
  page: Page,
  companyId: number,
  productId: number,
  locationId: number,
  marker: string,
  quantity = 3,
  lotId: number | null = null,
): Promise<number> {
  const { urlPath, init } = stdbBffCommandPost("create_stock_quant", {
    params: stdbParamsToJson(
      {
        companyId,
        productId,
        productVariantId: null,
        locationId,
        lotId,
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

/** Create a quality check for a product through the Quality checks tab's create form. */
export async function createQualityCheckViaUi(
  page: Page,
  productName: string,
  name: string,
): Promise<void> {
  await openEntityCreate(page, "/inventory", "inventory", "quality", "new-quality-check")
  await fillField(page, "name", name)
  await page.getByTestId("form-field-productId").click()
  await page.getByRole("option", { name: productName }).click()
  await Promise.all([
    page.waitForResponse(
      (response) =>
        matchesOperationResponse(response, "create_quality_check") &&
        response.ok(),
      { timeout: 30_000 },
    ),
    submitForm(page, "new-quality-check"),
  ])
}

/**
 * Fail a quality check through the Quality checks tab's row action. The action
 * prompts for a quarantine location id then a failure reason, in that order.
 */
export async function failQualityCheckViaUi(
  page: Page,
  checkId: number,
  quarantineLocationId: number,
  reason: string,
): Promise<void> {
  await gotoModule(page, "/inventory", "inventory")
  await selectModuleTab(page, "inventory", "quality")
  await selectEntityRowById(page, checkId)

  const prompts = [String(quarantineLocationId), reason]
  page.once("dialog", async (dialog) => {
    await dialog.accept(prompts.shift() ?? "")
    page.once("dialog", async (nextDialog) => {
      await nextDialog.accept(prompts.shift() ?? "")
    })
  })

  await Promise.all([
    page.waitForResponse(
      (response) =>
        matchesOperationResponse(response, "fail_quality_check") &&
        response.ok(),
      { timeout: 30_000 },
    ),
    page.getByTestId("entity-action-fail-check").click(),
  ])
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

/** Create a product's vendor supplier info directly (fixture setup, not the certified action). */
export async function createProductSupplierInfoFixture(
  page: Page,
  productId: number,
  partnerId: number,
  currencyId: number,
  minQty: number,
  price: number,
): Promise<void> {
  const { urlPath, init } = stdbBffCommandPost("create_product_supplier_info", {
    params: stdbParamsToJson(
      {
        partnerId,
        productTmplId: null,
        productId,
        minQty,
        price,
        currencyId,
        delay: 3,
        sequence: 1,
        productName: null,
        productCode: null,
        dateStart: null,
        dateEnd: null,
      },
      "CreateProductSupplierInfoParams",
    ),
  })
  const response = await page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
  expect(response.ok()).toBe(true)
}

/** Create a replenishment rule through the Replenishment tab's create form. */
export async function createReplenishmentRuleViaUi(
  page: Page,
  productName: string,
  locationName: string,
  minQty: string,
  maxQty: string,
): Promise<void> {
  await openEntityCreate(
    page,
    "/inventory",
    "inventory",
    "replenishment",
    "new-replenishment-rule",
  )
  await page.getByTestId("form-field-productId").click()
  await page.getByRole("option", { name: productName }).click()
  await chooseSelectOptionByLabel(page, "locationId", locationName)
  await chooseFirstEnabledOption(page, "uomId")
  await fillField(page, "minQty", minQty)
  await fillField(page, "maxQty", maxQty)
  await Promise.all([
    page.waitForResponse(
      (response) =>
        matchesOperationResponse(response, "create_replenishment_rule") &&
        response.ok(),
      { timeout: 30_000 },
    ),
    submitForm(page, "new-replenishment-rule"),
  ])
}

/** Execute a replenishment rule through its row action, accepting the confirm dialog. */
export async function executeReplenishmentRuleViaUi(
  page: Page,
  ruleId: number,
): Promise<void> {
  await gotoModule(page, "/inventory", "inventory")
  await selectModuleTab(page, "inventory", "replenishment")
  await selectEntityRowById(page, ruleId)

  page.once("dialog", (dialog) => {
    void dialog.accept()
  })

  await Promise.all([
    page.waitForResponse(
      (response) =>
        matchesOperationResponse(response, "execute_replenishment_rule") &&
        response.ok(),
      { timeout: 30_000 },
    ),
    page.getByTestId("entity-action-execute-replenishment-rule").click(),
  ])
}

/** Create a serial through the Serial numbers tab's row action (prompts: name, then product id). */
export async function createSerialViaUi(
  page: Page,
  productId: number,
  name: string,
): Promise<void> {
  await gotoModule(page, "/inventory", "inventory")
  await selectModuleTab(page, "inventory", "serials")

  const prompts = [name, String(productId)]
  page.once("dialog", async (dialog) => {
    await dialog.accept(prompts.shift() ?? "")
    page.once("dialog", async (nextDialog) => {
      await nextDialog.accept(prompts.shift() ?? "")
    })
  })

  await Promise.all([
    page.waitForResponse(
      (response) =>
        matchesOperationResponse(response, "create_stock_production_serial") &&
        response.ok(),
      { timeout: 30_000 },
    ),
    page.getByTestId("entity-action-create-serial").click(),
  ])
}

export async function fetchSerialIdByName(
  page: Page,
  name: string,
): Promise<number> {
  const response = await page.request.get("/api/query/stock-production-serials")
  if (!response.ok()) throw new Error("Failed to query serials")
  const payload = (await response.json()) as {
    data?: Array<Record<string, unknown>>
  }
  const matches = (payload.data ?? []).filter(
    (row) => String(row.name ?? "") === name,
  )
  if (matches.length !== 1) {
    throw new Error(`Expected one serial named ${name}, got ${matches.length}`)
  }
  const id = scalarQueryId(matches[0]?.id)
  if (id == null) throw new Error(`Serial ${name} has no id`)
  return id
}

/** Reserve a serial through the Serial numbers tab's row action. */
export async function reserveSerialViaUi(
  page: Page,
  serialId: number,
): Promise<void> {
  await gotoModule(page, "/inventory", "inventory")
  await selectModuleTab(page, "inventory", "serials")
  await selectEntityRowById(page, serialId)

  await Promise.all([
    page.waitForResponse(
      (response) =>
        matchesOperationResponse(response, "reserve_serial") && response.ok(),
      { timeout: 30_000 },
    ),
    page.getByTestId("entity-action-reserve-serial").click(),
  ])
}

export async function expectCanonicalSerialFocus(
  page: Page,
  serialId: number,
): Promise<void> {
  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === "/inventory" &&
      url.searchParams.get("tab") === "serials" &&
      url.searchParams.getAll("filter").length === 1 &&
      url.searchParams.get("filter") === `id:${serialId}`
    )
  })
  await expect(
    page.getByTestId("module-tab-inventory-serials"),
  ).toHaveAttribute("aria-selected", "true")

  const table = activeTabEntityTable(page)
  await expect(table.getByTestId(`entity-row-${serialId}`)).toBeVisible()
  await expect(table.locator('[data-testid^="entity-row-"]')).toHaveCount(1)
}

/**
 * Set (or clear, when `locationName` is undefined) a warehouse's QC location
 * through the Warehouses tab's edit form.
 */
export async function setWarehouseQcLocationViaUi(
  page: Page,
  warehouseId: number,
  locationName: string | undefined,
): Promise<void> {
  await gotoModule(page, "/inventory", "inventory")
  await selectModuleTab(page, "inventory", "warehouses")
  await selectEntityRowById(page, warehouseId)
  await page.getByTestId("entity-action-edit-warehouse").click()
  await expect(page.getByTestId("form-modal-edit-warehouse")).toBeVisible({
    timeout: 15_000,
  })
  await chooseSelectOptionByLabel(
    page,
    "whQcStockLocId",
    locationName ?? "Not configured",
  )
  await Promise.all([
    page.waitForResponse(
      (response) =>
        matchesOperationResponse(response, "update_warehouse") &&
        response.ok(),
      { timeout: 30_000 },
    ),
    submitForm(page, "edit-warehouse"),
  ])
}

export async function fetchWarehouseQcLocationId(
  page: Page,
  warehouseId: number,
): Promise<number | undefined> {
  const response = await page.request.get("/api/query/warehouses")
  if (!response.ok()) return undefined
  const payload = (await response.json()) as {
    data?: Array<Record<string, unknown>>
  }
  const row = (payload.data ?? []).find(
    (candidate) => scalarQueryId(candidate.id) === warehouseId,
  )
  if (!row) return undefined
  return (
    scalarQueryId(row.whQcStockLocId ?? row.wh_qc_stock_loc_id) ?? undefined
  )
}

/** Mark a serial in use through the Serial numbers tab's row action. */
export async function useSerialViaUi(page: Page, serialId: number): Promise<void> {
  await gotoModule(page, "/inventory", "inventory")
  await selectModuleTab(page, "inventory", "serials")
  await selectEntityRowById(page, serialId)

  await Promise.all([
    page.waitForResponse(
      (response) =>
        matchesOperationResponse(response, "use_serial") && response.ok(),
      { timeout: 30_000 },
    ),
    page.getByTestId("entity-action-use-serial").click(),
  ])
}

/** Block a serial through its detail modal (row click → Block → reason form). */
export async function blockSerialViaUi(
  page: Page,
  serialId: number,
  reason: string,
): Promise<void> {
  await gotoModule(page, "/inventory", "inventory")
  await selectModuleTab(page, "inventory", "serials")
  await selectEntityRowById(page, serialId)
  await page.getByTestId("serial-detail-block-button").click()
  await expect(page.getByTestId("form-modal-block-serial")).toBeVisible({
    timeout: 15_000,
  })
  await fillField(page, "reason", reason)
  await Promise.all([
    page.waitForResponse(
      (response) =>
        matchesOperationResponse(response, "block_serial") && response.ok(),
      { timeout: 30_000 },
    ),
    submitForm(page, "block-serial"),
  ])
}
