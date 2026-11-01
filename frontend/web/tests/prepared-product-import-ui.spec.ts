import { expect, test } from "@playwright/test"
import { parseCsvText } from "@lumiere/erp-shared/csv-import-safety"

test("reviewed locations reach the correct tracked import without AI", async ({ page }) => {
  let aiRequests = 0
  let submissions = 0
  await page.route("**/api/ai/import/**", route => { aiRequests++; return route.fulfill({ status: 503, json: { error: "AI disabled" } }) })
  await page.route("**/api/query/**", route => route.fulfill({ json: { data: new URL(route.request().url()).pathname.endsWith("/companies") ? [{ id: 9001, organizationId: 8001, currencyId: 646 }] : [] } }))
  await page.route("**/api/import/stock_location**", route => {
    expect(route.request().method()).toBe("POST")
    const body = route.request().postDataJSON()
    expect(body.params).toEqual({ companyId: "9001" })
    const parsed = parseCsvText(body.csvData)
    expect(Object.fromEntries(parsed.headers.map((key, i) => [key, parsed.rows[0][i]]))).toEqual({ name: "Synthetic shop", usage: "internal", active: "false", is_scrap: "false", metadata: "{}", _source_file: "source.csv", _source_row: "3" })
    submissions++
    return route.fulfill({ json: { ok: true, entity: "stock_location", requestId: body.requestId, jobId: "502", status: "success", totalRows: 1, rowsImported: 1, errorRows: 0, errors: [], errorsRedacted: false } })
  })
  await page.goto("/prepared-product-import")
  await page.getByRole("button", { name: "Use location reference fixture", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "Entity", exact: true })).toContainText("Stock locations")
  await page.getByRole("button", { name: "Preview prepared location CSV", exact: true }).click()
  await expect(page.getByTestId("guided-import-preview")).toBeVisible()
  await page.getByRole("button", { name: "Import", exact: true }).click()
  await expect(page.getByText("Imported 1 rows. 0 rows need correction.", { exact: true })).toBeVisible()
  expect(aiRequests).toBe(0)
  expect(submissions).toBe(1)
})

test("prepared products import with AI disabled and wait for the tracked receipt", async ({ page }) => {
  test.setTimeout(90_000)
  let aiRequests = 0
  let requestId = ""
  let complete = false
  let submissions = 0
  await page.route("**/api/ai/import/**", route => { aiRequests++; return route.fulfill({ status: 503, json: { error: "AI disabled" } }) })
  await page.route("**/api/query/**", route => {
    const path = new URL(route.request().url()).pathname
    const data = path.endsWith("/companies") ? [{ id: 9001, organizationId: 8001, currencyId: 646 }] : path.endsWith("/product-categories") ? [{ id: 12, organizationId: 8001, name: "Synthetic category" }] : path.endsWith("/uoms") ? [{ id: 13, organizationId: 8001, name: "Kilogram", symbol: "kg" }] : path.endsWith("/import-jobs") && complete ? [{ id: 501, tableName: "product", status: "success", totalRows: 1, rowsImported: 1, errorRows: 0 }] : []
    return route.fulfill({ json: { data } })
  })
  await page.route("**/api/operations/**", route => route.fulfill({ json: { ok: true } }))
  await page.route("**/api/import/product**", route => {
    if (route.request().method() === "POST") {
      submissions++
      const body = route.request().postDataJSON()
      requestId = body.requestId
      expect(body.params).toEqual({ companyId: "9001", currencyId: "646" })
      const parsed = parseCsvText(body.csvData)
      expect(Object.fromEntries(parsed.headers.map((key, index) => [key, parsed.rows[0][index]]))).toEqual({ name: "Synthetic product", category_id: "12", uom_id: "13", uom_po_id: "13", sale_price: "4800", cost_price: "3000", active: "false" })
    } else {
      expect(route.request().url()).toContain(requestId)
      complete = true
    }
    return route.fulfill({ json: { ok: true, entity: "product", requestId, jobId: "501", status: complete ? "success" : "pending", totalRows: 1, rowsImported: complete ? 1 : 0, errorRows: 0, errors: [], errorsRedacted: false } })
  })
  await page.goto("/prepared-product-import")
  await page.getByRole("button", { name: "Preview prepared product CSV", exact: true }).click()
  await expect(page.getByTestId("guided-import-preview")).toBeVisible()
  await page.getByRole("button", { name: "Import", exact: true }).click()
  await expect(page.getByText("The import is running. Check its result before starting another submission.", { exact: true })).toBeVisible()
  await expect(page.getByText("Imported 1 rows. 0 rows need correction.", { exact: true })).not.toBeVisible()
  await page.reload()
  await expect(page.getByText("Your previous submission is retained. Check its saved result or retry the same submission.", { exact: true })).toBeVisible()
  await expect(page.getByLabel("CSV or Excel file", { exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Check import result", exact: true }).click()
  await expect(page.getByText("Imported 1 rows. 0 rows need correction.", { exact: true })).toBeVisible()
  expect(aiRequests).toBe(0)
  expect(submissions).toBe(1)
})

test("unknown product cost can be saved for review but cannot be imported", async ({ page }) => {
  let imported = false
  let saved = false
  await page.route("**/api/query/**", route => {
    const path = new URL(route.request().url()).pathname
    return route.fulfill({ json: { data: path.endsWith("/companies") ? [{ id: 9001, organizationId: 8001, currencyId: 646 }] : path.endsWith("/product-categories") ? [{ id: 12, organizationId: 8001 }] : path.endsWith("/uoms") ? [{ id: 13, organizationId: 8001 }] : [] } })
  })
  await page.route("**/api/import/product**", route => { imported = true; return route.abort() })
  await page.route("**/api/import-reviews", route => {
    const body = route.request().postDataJSON()
    expect(body.dataset.items[0].proposed.cost_price).toBeNull()
    saved = true
    return route.fulfill({ json: { id: "1" } })
  })
  await page.goto("/prepared-product-import")
  await page.getByLabel("CSV or Excel file", { exact: true }).setInputFiles({ name: "unknown-cost.csv", mimeType: "text/csv", buffer: Buffer.from("name,category_id,uom_id,uom_po_id,sale_price,cost_price,active\nSynthetic sausage,12,13,13,4800,,false") })
  await page.getByRole("button", { name: "Preview prepared product CSV", exact: true }).click()
  await expect(page.getByRole("button", { name: "Import", exact: true })).toBeDisabled()
  await expect(page.getByText(/Import anyway despite/)).not.toBeVisible()
  await page.getByRole("button", { name: "Save for review", exact: true }).click()
  await expect(page.getByText("Saved as a source draft. Review the uncertain rows below.", { exact: true })).toBeVisible()
  expect(saved).toBe(true)
  expect(imported).toBe(false)
})
