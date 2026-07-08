import { expect, test } from "@playwright/test"

import {
  chooseFirstOption,
  expectNoAppError,
  expectRecordAbsentFromQuery,
  fillField,
  gotoModule,
  openEntityCreate,
  smokeName,
  submitForm,
  waitForBffQueryMinRows,
} from "./helpers"

test.describe("Manufacturing create mutations", { tag: ["@phase-4", "@manufacturing"] }, () => {
  test("creates a work center via create_workcenter reducer", async ({ page }) => {
    test.setTimeout(120_000)

    const workcenterName = smokeName("mut-workcenter")

    await openEntityCreate(page, "/manufacturing", "manufacturing", "workcenters", "new-workcenter")
    await fillField(page, "name", workcenterName)

    const [createRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/create_workcenter") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-workcenter"),
    ])
    expect(createRes.ok()).toBe(true)
    await expect(page.getByText(workcenterName).first()).toBeVisible({ timeout: 30_000 })
    await expectNoAppError(page)
  })

  test("creates a BOM via create_bom reducer", async ({ page }) => {
    test.setTimeout(120_000)

    await gotoModule(page, "/manufacturing", "manufacturing")
    await page.getByTestId("module-tab-manufacturing-boms").click()
    await waitForBffQueryMinRows(page, "/api/query/products")

    await page.getByTestId("module-create-manufacturing-boms").click()
    await expect(page.getByTestId("form-modal-new-bom")).toBeVisible()
    await chooseFirstOption(page, "productTmplId")
    await fillField(page, "productQty", "1")
    await chooseFirstOption(page, "type")

    const [createRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/create_bom") && res.ok(),
        { timeout: 60_000 },
      ),
      submitForm(page, "new-bom"),
    ])
    expect(createRes.ok()).toBe(true)
    await waitForBffQueryMinRows(page, "/api/query/mrp-boms")
    await expectNoAppError(page)
  })

  test("creates a manufacturing order via create_manufacturing_order reducer", async ({
    page,
  }) => {
    test.setTimeout(180_000)

    await gotoModule(page, "/manufacturing", "manufacturing")
    await page.getByTestId("module-tab-manufacturing-orders").click()
    await waitForBffQueryMinRows(page, "/api/query/products")
    await waitForBffQueryMinRows(page, "/api/query/warehouses")

    await page.getByTestId("module-create-manufacturing-orders").click()
    await expect(page.getByTestId("form-modal-new-manufacturing-order")).toBeVisible()
    await chooseFirstOption(page, "productId")
    await fillField(page, "productQty", "1")
    await chooseFirstOption(page, "warehouseId")

    const pickingField = page.getByTestId("form-field-pickingTypeId")
    await pickingField.click()
    const pickingOptions = page.locator('[role="listbox"]:visible').getByRole("option", {
      disabled: false,
    })
    const pickingCount = await pickingOptions.count()
    test.skip(pickingCount === 0, "No stock picking types in seed for MO create")

    await pickingOptions.first().click()
    await chooseFirstOption(page, "locationSrcId")
    await chooseFirstOption(page, "locationDestId")

    const today = new Date().toISOString().slice(0, 10)
    await fillField(page, "datePlannedStart", today)
    await fillField(page, "datePlannedFinished", today)

    const [createRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/create_manufacturing_order") && res.ok(),
        { timeout: 60_000 },
      ),
      submitForm(page, "new-manufacturing-order"),
    ])
    expect(createRes.ok()).toBe(true)
    await waitForBffQueryMinRows(page, "/api/query/mrp-productions")
    await expectNoAppError(page)
  })
})

test.describe("Manufacturing mutation visibility", { tag: ["@phase-4", "@manufacturing"] }, () => {
  test("created work center appears in mrp-workcenters query", async ({ page }) => {
    test.setTimeout(120_000)

    const workcenterName = smokeName("mut-wc-query")

    await openEntityCreate(page, "/manufacturing", "manufacturing", "workcenters", "new-workcenter")
    await fillField(page, "name", workcenterName)
    await submitForm(page, "new-workcenter")
    await expect(page.getByText(workcenterName).first()).toBeVisible({ timeout: 30_000 })

    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/query/mrp-workcenters")
          if (!res.ok()) return false
          const json = (await res.json()) as { data?: Array<{ name?: string }> }
          return (json.data ?? []).some((row) => String(row.name ?? "") === workcenterName)
        },
        { timeout: 30_000 },
      )
      .toBe(true)
  })
})
