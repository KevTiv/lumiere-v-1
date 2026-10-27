import { expect, test, type Page } from "@playwright/test"
import { activeTabEntityTable, fetchDefaultCompanyId, gotoModule, smokeName } from "./helpers"
import { matchesOperationResponse } from "./operation-response"
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQaPj/HwAFAgKfdqhGyQAAAABJRU5ErkJggg==", "base64")
function tinyPdf(): Buffer {
  const parts = ["%PDF-1.4\n"]
  const offsets = [0]
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 144 72] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  const text = "BT /F1 12 Tf 12 36 Td (Receipt fixture) Tj ET\n"
  objects.push(
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}endstream`,
  )
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(parts.join("")))
    parts.push(`${i + 1} 0 obj\n${object}\nendobj\n`)
  })
  const xref = Buffer.byteLength(parts.join(""))
  parts.push(
    `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join(
        "",
      )}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  )
  return Buffer.from(parts.join(""))
}

async function chooseFirst(page: Page, id: string) {
  await page.getByTestId(id).click()
  await page.locator('[role="listbox"]:visible').getByRole("option", { disabled: false }).first().click()
}
async function queryRows(page: Page, resource: string): Promise<Array<Record<string, unknown>>> {
  const response = await page.request.get(`/api/query/${resource}`)
  expect(response.ok()).toBe(true)
  return ((await response.json()) as { data: Array<Record<string, unknown>> }).data
}
const workspace = (page: Page) => page.locator('[data-testid="finance-review-workspace"]:visible')

test.describe("Finance review workspace", { tag: ["@p0", "@finance-review"] }, () => {
  for (const width of [1440, 390]) {
    test(`bill draft keeps inputs and document review at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await gotoModule(page, "/accounting?tab=bills", "accounting")
      const modal = page.getByTestId("create-invoice-modal")
      // The setup gate depends on asynchronous company reads, as in finance-authoring.
      await expect(async () => {
        await page.getByRole("button", { name: /New bill/i }).first().click()
        await expect(modal).toBeVisible({ timeout: 5_000 })
      }).toPass({ timeout: 45_000 })
      const review = modal.getByTestId("finance-review-workspace")
      await expect(review.getByTestId("finance-review-editor")).toBeVisible()
      await expect(review.getByTestId("finance-review-document")).toBeVisible()
      await modal.getByTestId("create-invoice-line-description").fill("Review workspace draft")
      await modal.getByTestId("create-invoice-line-unit-price").fill("37.50")
      await review.getByRole("tab", { name: "Document preview", exact: true }).click()
      await expect(modal.getByTestId("invoice-document")).toContainText("Review workspace draft")
      await expect(modal.getByTestId("invoice-document")).toContainText("37.5")
      await review.getByRole("tab", { name: "Edit document", exact: true }).click()
      await expect(modal.getByTestId("create-invoice-line-description")).toHaveValue("Review workspace draft")
      await review.getByRole("tab", { name: "Side by side", exact: true }).click()
      const editorBox = (await review.getByTestId("finance-review-editor").boundingBox())!
      const previewBox = (await review.getByTestId("finance-review-document").boundingBox())!
      const tabsBox = (await review.getByRole("tablist").boundingBox())!
      expect(tabsBox.y + tabsBox.height).toBeLessThanOrEqual(editorBox.y + 1)
      if (width >= 1280) expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(previewBox.x)
      expect(await modal.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
      const box = await modal.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1)
      const save = modal.getByTestId("create-invoice-save-draft")
      await expect(save).toBeVisible()
      expect((await save.boundingBox())!.y + (await save.boundingBox())!.height).toBeLessThanOrEqual(900)
      await page.screenshot({ path: test.info().outputPath(`bill-review-${width}.png`) })
    })
  }

  for (const kind of ["png", "pdf"] as const) {
  test(`reviews a saved bill's real source ${kind} after upload and refresh`, async ({ page }) => {
    const companyId = String(await fetchDefaultCompanyId(page))
    const bill = (await queryRows(page, "account-moves")).find((row) => String(row.companyId ?? row.company_id) === companyId
      && String(typeof row.moveType === "object" && row.moveType ? (row.moveType as { tag: string }).tag : row.moveType) === "InInvoice")
    expect(bill, "Seeded vendor bill required").toBeTruthy()
    const id = String(bill!.id)
    await gotoModule(page, `/accounting/invoices/${id}?tab=discussion`)
    const attachment = page.locator('[data-testid="record-attachments-panel"]:visible')
    const name = smokeName("bill-source-review") + `.${kind}`
    await attachment.getByTestId("record-attachments-file").setInputFiles({ name, mimeType: kind === "png" ? "image/png" : "application/pdf", buffer: kind === "png" ? png : tinyPdf() })
    await attachment.getByRole("button", { name: "Upload", exact: true }).click()
    await expect(attachment.getByText(name, { exact: true })).toBeVisible()
    await page.goto(`/accounting/invoices/${id}`)
    const source = workspace(page).getByTestId("finance-source-preview")
    // Multiple sources can be attached to this exact bill across test runs.
    await expect(source.getByText(name, { exact: true }).first()).toBeVisible()
    const select = source.getByRole("button", { name, exact: true })
    if (await select.count()) await select.click()
    const preview = kind === "png" ? source.getByRole("img", { name, exact: true }) : source.getByTestId("finance-source-pdf")
    await expect(preview).toBeVisible()
    if (kind === "png") await expect.poll(() => preview.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(1)
    else {
      await expect(preview).toHaveAttribute("data", /^blob:/)
      await expect(preview).toHaveAttribute("aria-label", name)
      await expect(preview).toHaveAttribute("type", "application/pdf")
    }
    await page.reload()
    const saved = workspace(page).getByTestId("finance-source-preview")
    await expect(saved.getByText(name, { exact: true }).first()).toBeVisible()
    const selectAfterReload = saved.getByRole("button", { name, exact: true })
    if (await selectAfterReload.count()) await selectAfterReload.click()
    await expect(kind === "png" ? saved.getByRole("img", { name, exact: true }) : saved.getByTestId("finance-source-pdf")).toBeVisible()
    const before = await queryRows(page, "account-moves")
    expect(before.find((row) => String(row.id) === id)?.amountTotal).toBe(bill!.amountTotal)
    await page.screenshot({ path: test.info().outputPath(`saved-bill-source-${kind}.png`) })
  })

  }
  test("keeps the capture file across view changes and opens its exact saved expense receipt", async ({ page }) => {
    test.setTimeout(120_000)
    await gotoModule(page, "/expenses?tab=operations", "expenses")
    const panel = page.locator('[data-testid="expenses-capture-panel"]:visible')
    await chooseFirst(page, "expenses-capture-employee")
    await chooseFirst(page, "expenses-capture-pricelist")
    const name = smokeName("workspace-expense")
    await panel.getByTestId("expenses-capture-name").fill(name)
    await panel.getByTestId("expenses-capture-amount").fill("19.73")
    await panel.getByTestId("expenses-capture-file").setInputFiles({ name: `${name}.png`, mimeType: "image/png", buffer: png })
    await panel.getByRole("tab", { name: "Receipt", exact: true }).click()
    await expect(panel.getByRole("img", { name: "Selected receipt", exact: true })).toBeVisible()
    await panel.getByRole("tab", { name: "Expense details", exact: true }).click()
    await expect(panel.getByTestId("expenses-capture-name")).toHaveValue(name)
    expect(await panel.getByTestId("expenses-capture-file").evaluate((node) => (node as HTMLInputElement).files?.[0]?.name)).toBe(`${name}.png`)
    const create = page.waitForRequest((request) => request.method() === "POST" && matchesOperationResponse(request, "create_expense"))
    await panel.getByTestId("expenses-capture-submit").click()
    const command = (await create).postDataJSON() as { params: { client_request_id: string | { some: string } } }
    const raw = command.params.client_request_id
    const key = typeof raw === "object" ? raw.some : raw
    expect(key).toMatch(/^exp-cap-/)
    await expect.poll(async () => (await queryRows(page, "expenses")).filter((row) => (row.clientRequestId ?? row.client_request_id) === key).length).toBe(1)
    const expense = (await queryRows(page, "expenses")).find((row) => (row.clientRequestId ?? row.client_request_id) === key)!
    await gotoModule(page, `/expenses?tab=expenses&filter=${encodeURIComponent(`id:${String(expense.id)}`)}`, "expenses")
    await activeTabEntityTable(page).getByTestId(`entity-row-${String(expense.id)}`).click()
    const review = page.getByRole("dialog").filter({ has: page.getByTestId("finance-review-workspace") })
    await expect(review.getByRole("img", { name: `${name}.png`, exact: true })).toBeVisible()
    await expect.poll(() => review.getByRole("img", { name: `${name}.png`, exact: true }).evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(1)
    await page.screenshot({ path: test.info().outputPath("saved-expense-source.png") })
  })

  test("persists compact rows without changing financial records", async ({ page }) => {
    await gotoModule(page, "/expenses?tab=expenses", "expenses")
    const table = activeTabEntityTable(page)
    const row = table.locator('[data-testid^="entity-row-"]').first()
    const firstId = await row.getAttribute("data-testid")
    await table.getByRole("button", { name: "Comfortable", exact: true }).click()
    const tall = (await row.boundingBox())!.height
    await table.getByRole("button", { name: "Compact", exact: true }).click()
    await expect(table).toHaveAttribute("data-density", "compact")
    expect((await row.boundingBox())!.height).toBeLessThan(tall)
    await page.reload()
    await expect(activeTabEntityTable(page)).toHaveAttribute("data-density", "compact")
    await expect(activeTabEntityTable(page).getByTestId(firstId!)).toBeVisible()
    await gotoModule(page, "/accounting?tab=bills", "accounting")
    const bills = page.locator('[data-testid="finance-money-list"]:visible')
    await bills.getByRole("button", { name: "View settings", exact: true }).click()
    await bills.getByRole("button", { name: "Compact", exact: true }).click()
    await page.reload()
    await expect(page.locator('[data-testid="finance-money-list"]:visible')).toHaveAttribute("data-density", "compact")
  })

  test("opens the work queue task area and keeps unavailable counts distinct from zero", async ({ page }) => {
    await gotoModule(page, "/overview")
    const queue = page.getByTestId("owner-control-loop")
    await expect(queue.getByText("Finance work queue", { exact: true })).toBeVisible()
    await expect(queue).toContainText("active company")
    await expect(queue.getByRole("link", { name: "Reconcile payments", exact: true })).toHaveAttribute("href", "/accounting?tab=payment-operations")
    await queue.getByRole("link", { name: "Reconcile payments", exact: true }).click()
    await expect(page).toHaveURL(/tab=payment-operations/)
    await page.route("**/api/query/expense-sheets-to-approve*", (route) => route.fulfill({ status: 403, contentType: "application/json", body: '{"error":"denied"}' }))
    await page.goto("/overview")
    await expect(page.getByTestId("finance-queue-expenseApprovals")).toContainText("Unavailable")
    await page.screenshot({ path: test.info().outputPath("finance-work-queue.png") })
  })
})
