import { expect, test, type Page } from "@playwright/test"
import { gotoModule } from "./helpers"

async function cancelDraft(page: Page) {
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  const discard = page.getByTestId("discard-changes-dialog")
  await expect(discard).toBeVisible()
  await page.getByTestId("discard-changes-confirm").click()
  await expect(discard).toBeHidden()
}

function observeOperationWrites(page: Page): string[] {
  const writes: string[] = []
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname
    if (request.method() === "POST" && /\/(?:api|v1)\/(?:operations|compat\/reducer)\//.test(path))
      writes.push(path)
  })
  return writes
}

test.describe("Finance workflow review tools", { tag: "@dev-fixture" }, () => {
  test("reviews a statement CSV locally before explicit staging", async ({ page }) => {
    const writes = observeOperationWrites(page)
    await gotoModule(page, "/accounting?tab=payment-operations", "accounting")
    await page.getByRole("button", { name: "Import CSV", exact: true }).first().click()
    const preview = page.getByTestId("statement-import-review")
    await expect(preview).toBeVisible()
    const stage = page.getByRole("button", {
      name: "Stage reviewed rows",
      exact: true,
    })
    await expect(stage).toBeDisabled()
    await page.getByTestId("form-field-journalId").click()
    await page
      .locator('[role="listbox"]:visible')
      .getByRole("option", { disabled: false })
      .first()
      .click()
    await page.getByTestId("form-field-openingBalance").fill("100")
    await page.getByTestId("form-field-csvFile").setInputFiles({
      name: "local-review.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "date,amount,reference,description\n2026-10-01,25,LOCAL-1,Valid transfer\ninvalid,10,LOCAL-2,Invalid date\n2026-10-02,0,LOCAL-3,Zero movement",
      ),
    })
    await page.getByRole("button", { name: "Review CSV", exact: true }).click()
    await expect(preview).toContainText("Local review · not staged")
    await expect(preview).toContainText("3 rows · 1 pass local checks · 2 need review")
    await expect(preview).toContainText("Estimated closing balance")
    await expect(preview).toContainText("125")
    await expect(preview).toContainText("Missing or invalid date")
    await expect(preview).toContainText("Amount must not be zero")
    await expect(stage).toBeEnabled()
    await page.getByTestId("form-field-openingBalance").fill("200")
    await expect(stage).toBeDisabled()
    await expect(preview).toContainText("Choose a CSV file and statement setup")
    expect(writes).toEqual([])
  })

  test("shows payment allocation balances and reveals write-off controls only on request", async ({
    page,
  }) => {
    const writes = observeOperationWrites(page)
    await gotoModule(page, "/accounting?tab=payment-operations", "accounting")
    // Seeded Finance fixture must include a posted operational payment.
    await page.getByRole("button", { name: "Allocate", exact: true }).first().click()
    const preview = page.getByTestId("payment-allocation-review")
    await expect(preview).toBeVisible()
    await expect(preview).toContainText("Unsaved allocation")
    await expect(preview).toContainText("Payment available before allocation")
    await expect(preview).toContainText("Estimated payment left unapplied")
    await expect(preview).toContainText("The server validates current eligibility")
    await expect(page.getByTestId("form-field-writeOffAmount")).toBeHidden()
    await expect(page.getByTestId("form-field-writeOffAccountId")).toBeHidden()
    await page.getByTestId("form-field-writeOffEnabled").click()
    await expect(page.getByTestId("form-field-writeOffAmount")).toBeVisible()
    await expect(page.getByTestId("form-field-writeOffAccountId")).toBeVisible()
    await page.getByTestId("form-field-allocatedAmount").fill("12.5")
    await expect(preview).toContainText("12.5")
    expect(writes).toEqual([])
  })

  test("previews capture image and PDF receipts without uploading or creating records", async ({
    page,
  }) => {
    const writes: string[] = []
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname
      if (
        request.method() === "POST" &&
        (/\/(?:api|v1)\/(?:operations|compat\/reducer)\//.test(path) ||
          path.includes("/documents/blobs/"))
      )
        writes.push(path)
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoModule(page, "/expenses?tab=operations", "expenses")
    const panel = page.locator('[data-testid="expenses-capture-panel"]:visible')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText("Unuploaded file bytes stay in this capture panel only")
    const file = panel.getByTestId("expenses-capture-file")
    await expect(file).toHaveAttribute("accept", "image/*,application/pdf")
    await file.setInputFiles({
      name: "receipt-preview.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQaPj/HwAFAgKfdqhGyQAAAABJRU5ErkJggg==",
        "base64",
      ),
    })
    const preview = panel.getByTestId("expense-capture-attachment-preview")
    await expect(preview).toContainText("receipt-preview.png")
    await expect(preview.getByAltText("Selected receipt", { exact: true })).toHaveAttribute(
      "src",
      /^blob:/,
    )
    await expect
      .poll(() =>
        preview
          .getByAltText("Selected receipt", { exact: true })
          .evaluate((element) => (element as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0)
    await expect(preview).toContainText("This file is not attached to a saved expense yet")
    await file.setInputFiles({
      name: "receipt-preview.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(
        "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
      ),
    })
    await expect(preview).toContainText("receipt-preview.pdf")
    await expect(preview.getByLabel("Selected receipt PDF", { exact: true })).toHaveAttribute(
      "data",
      /^blob:/,
    )
    await expect(preview.getByAltText("Selected receipt", { exact: true })).toHaveCount(0)
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    )
    await panel.getByTestId("expenses-capture-has-receipt").click()
    await expect(preview).toHaveCount(0)
    await expect(file).toHaveCount(0)
    await panel.getByTestId("expenses-capture-has-receipt").click()
    await expect(file).toHaveValue("")
    expect(writes).toEqual([])
  })

  test("keeps offline capture metadata after reload and requires file reattachment before sync", async ({
    page,
    context,
  }) => {
    const writes: string[] = []
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname
      if (
        request.method() === "POST" &&
        (/\/(?:api|v1)\/(?:operations|compat\/reducer)\//.test(path) ||
          path.includes("/documents/blobs/"))
      )
        writes.push(path)
    })
    await gotoModule(page, "/expenses?tab=operations", "expenses")
    let panel = page.locator('[data-testid="expenses-capture-panel"]:visible')
    await panel.getByTestId("expenses-capture-employee").click()
    await page.getByRole("option", { disabled: false }).first().click()
    await panel.getByTestId("expenses-capture-pricelist").click()
    await page.getByRole("option", { disabled: false }).first().click()
    await panel.getByTestId("expenses-capture-name").fill("Offline attachment queue proof")
    await panel.getByTestId("expenses-capture-amount").fill("12.50")
    await panel.getByTestId("expenses-capture-file").setInputFiles({
      name: "offline-receipt.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\nOffline receipt proof\n%%EOF\n"),
    })
    await context.setOffline(true)
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
    await panel.getByTestId("expenses-capture-submit").click()
    await expect(panel.getByTestId("expenses-capture-queue")).toContainText(
      "Offline attachment queue proof",
    )
    await expect(panel.getByTestId("expenses-capture-queue")).toContainText("Receipt queued")
    await context.setOffline(false)
    await page.reload()
    panel = page.locator('[data-testid="expenses-capture-panel"]:visible')
    const queue = panel.getByTestId("expenses-capture-queue")
    await expect(queue).toContainText("Offline attachment queue proof")
    await expect(queue.getByTestId("expenses-capture-reattach")).toBeVisible()
    await expect(queue.getByTestId("expenses-capture-retry")).toBeDisabled()
    await expect(queue.getByTestId("expense-capture-attachment-preview")).toHaveCount(0)
    await queue.getByTestId("expenses-capture-discard").click()
    await expect(queue).toHaveCount(0)
    expect(writes).toEqual([])
  })

  test("edits report layout drafts while preserving saved legacy markup and excluding preview examples", async ({
    page,
  }) => {
    const writes = observeOperationWrites(page)
    await gotoModule(page, "/reports?tab=report-templates", "reports")
    const seedRow = page
      .locator('[data-testid^="entity-row-"]:visible')
      .filter({ hasText: "Seed Sales Summary" })
    await expect(seedRow).toHaveCount(1)
    const rowKey = await seedRow.getAttribute("data-testid")
    expect(rowKey).toMatch(/^entity-row-\d+$/)
    const templateId = rowKey!.slice("entity-row-".length)
    if ((await seedRow.getAttribute("data-state")) !== "selected") await seedRow.click()
    await page.getByTestId("entity-action-edit-tpl").click()
    const editor = page.getByTestId("template-layout-editor")
    const markup = page.getByTestId("template-markup")
    await expect(editor).toBeVisible()
    // A seed may have been edited in an earlier manual session. Reveal its exact source.
    if (!(await markup.isVisible()))
      await editor.getByRole("button", { name: "Edit markup", exact: true }).click()
    const originalMarkup = await markup.inputValue()
    const legacy = "<h1>Draft legacy report</h1><p>{{ original_binding }}</p>"
    await markup.fill(legacy)
    await expect(markup).toHaveValue(legacy)
    await expect(
      editor.getByRole("button", { name: "Build with sections", exact: true }),
    ).toBeVisible()
    await editor.getByRole("button", { name: "Build with sections", exact: true }).click()
    const replacement = page.getByRole("alertdialog")
    await expect(
      replacement.getByRole("heading", {
        name: "Replace existing markup?",
        exact: true,
      }),
    ).toBeVisible()
    await replacement.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(markup).toHaveValue(legacy)
    await editor.getByRole("button", { name: "Build with sections", exact: true }).click()
    await replacement.getByRole("button", { name: "Start section layout", exact: true }).click()
    await expect(page.getByTestId("template-section-0")).toHaveCount(0)
    await editor.getByRole("button", { name: "Add heading", exact: true }).click()
    await page.getByTestId("template-section-text-0").fill("Draft layout heading")
    await editor.getByRole("button", { name: "Add document table", exact: true }).click()
    const preview = page.frameLocator('iframe[title="Report template layout preview"]')
    await expect(
      preview.getByRole("heading", {
        name: "Draft layout heading",
        exact: true,
      }),
    ).toBeVisible()
    await expect(preview.getByRole("cell", { name: "INV-EXAMPLE", exact: true })).toBeVisible()
    await expect(preview.getByRole("cell", { name: "125.00", exact: true })).toBeVisible()
    await editor.getByRole("button", { name: "Edit markup", exact: true }).click()
    const draftMarkup = await markup.inputValue()
    expect(draftMarkup).toContain("Draft layout heading")
    expect(draftMarkup).toContain("<tbody></tbody>")
    expect(draftMarkup).not.toContain("INV-EXAMPLE")
    expect(draftMarkup).not.toContain("Example customer")
    expect(draftMarkup).not.toContain("125.00")
    await cancelDraft(page)
    await page.getByTestId("entity-action-edit-tpl").click()
    await expect(editor).toBeVisible()
    if (!(await markup.isVisible()))
      await editor.getByRole("button", { name: "Edit markup", exact: true }).click()
    await expect(markup).toHaveValue(originalMarkup)
    await page.getByRole("button", { name: "Cancel", exact: true }).click()
    const response = await page.request.get("/api/query/report-templates")
    expect(response.ok()).toBeTruthy()
    const body = (await response.json()) as {
      data?: Array<{
        id: string | number
        template_content?: string | null
        templateContent?: string | null
      }>
    }
    const saved = body.data?.filter((row) => String(row.id) === templateId) ?? []
    expect(saved).toHaveLength(1)
    expect(saved[0]!.templateContent ?? saved[0]!.template_content ?? "").toBe(originalMarkup)
    expect(writes).toEqual([])
  })

  test("Accounting workspaces follow direct links, contain keyboard focus, and clear old record filters", async ({
    page,
  }) => {
    const writes = observeOperationWrites(page)
    await gotoModule(page, "/accounting?tab=taxes&filter=id%3A999999&filter=state%3AOpen", "accounting")
    const module = page.getByTestId("module-view-accounting").filter({ visible: true })
    await expect(module.getByTestId("module-area-accounting")).toHaveCount(0)
    const overflow = module.getByTestId("module-workspace-accounting-overflow")
    await expect(overflow).toBeVisible()
    const taxes = module.getByTestId("module-tab-accounting-taxes")
    const invoices = module.getByTestId("module-tab-accounting-invoices")
    await expect(taxes).toBeVisible()
    await expect(taxes).toHaveAttribute("aria-selected", "true")
    await expect(invoices).toHaveCount(0)
    const receivables = module.getByTestId("module-workspace-accounting-receivables")
    await receivables.click()
    await expect(receivables).toHaveAttribute("aria-current", "page")
    await expect(invoices).toBeVisible()
    await expect(invoices).toHaveAttribute("aria-selected", "true")
    const creditControl = module.getByTestId("module-tab-accounting-credit-control")
    await expect(creditControl).toBeVisible()
    await expect(taxes).toHaveCount(0)
    await expect(page).toHaveURL(/[?&]tab=invoices(?:&|$)/)
    expect(new URL(page.url()).searchParams.getAll("filter")).toEqual([])
    await expect(module.getByTestId("module-tabs-accounting").getByRole("tab")).toHaveCount(2)
    await invoices.focus()
    await invoices.press("End")
    await expect(creditControl).toBeFocused()
    await creditControl.press("ArrowRight")
    await expect(invoices).toBeFocused()
    await invoices.press("ArrowRight")
    await expect(creditControl).toBeFocused()
    await creditControl.press("Home")
    await expect(invoices).toBeFocused()
    const close = module.getByTestId("module-workspace-accounting-close")
    await close.click()
    await expect(close).toHaveAttribute("aria-current", "page")
    await expect(module.getByTestId("module-tab-accounting-period-close")).toHaveAttribute(
      "aria-selected",
      "true",
    )
    await gotoModule(page, "/accounting?tab=fixed-assets", "accounting")
    await expect(module.getByTestId("module-workspace-accounting-planning")).toHaveAttribute("aria-current", "page")
    await expect(module.getByTestId("module-tab-accounting-fixed-assets")).toHaveAttribute(
      "aria-selected",
      "true",
    )
    await expect(module.getByTestId("module-tab-accounting-amortization")).toBeVisible()
    await expect(taxes).toHaveCount(0)
    await overflow.click()
    await page.getByTestId("module-workspace-item-accounting-taxes").click()
    await expect(taxes).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("menu")).toHaveCount(0)
    await gotoModule(page, "/accounting?tab=dashboard", "accounting")
    await expect(module.getByTestId("module-workspace-accounting-overview")).toHaveAttribute("aria-current", "page")
    await expect(module.getByTestId("module-tab-accounting-dashboard")).toHaveAttribute(
      "aria-selected",
      "true",
    )
    expect(writes).toEqual([])
  })
})
