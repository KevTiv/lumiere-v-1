import { createHash } from "node:crypto"
import { reviewInvoiceAccountingChoices } from "./invoice-accounting-choices"
import { expect, test, type Locator, type Page } from "@playwright/test"

const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQaPj/HwAFAgKfdqhGyQAAAABJRU5ErkJggg==", "base64")
const apiRequests = new WeakMap<Page, string[]>()

function selectedReceipt(modal: Locator, name: string) {
  return modal.getByRole("button", { name: `Show original filename: ${name}`, exact: true })
}

async function expectExpenseSubmission(
  page: Page,
  receiptName: string,
  fields: { name: string; totalAmount: string; quantity?: string },
) {
  const submission = page.getByTestId("authoring-refinement-expense-submission")
  await expect.poll(async () => JSON.parse((await submission.textContent()) || "{}")).toMatchObject({
    employeeId: "7",
    pricelistId: "3",
    ...fields,
    receipt: {
      name: receiptName,
      type: "image/png",
      sha256: createHash("sha256").update(image).digest("hex"),
    },
  })
}

async function choose(page: Page, trigger: Locator, label: string | RegExp) {
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await page.getByRole("option", { name: label, exact: typeof label === "string" }).click()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(trigger).toContainText(label)
}
async function expectBefore(first: Locator, second: Locator) {
  const secondId = await second.getAttribute("id")
  expect(secondId).toBeTruthy()
  expect(await first.evaluate((element, id) => !!(element.compareDocumentPosition(document.getElementById(id!)!) & Node.DOCUMENT_POSITION_FOLLOWING), secondId)).toBe(true)
}
async function expectInViewport(page: Page, control: Locator) {
  await expect(control).toBeVisible()
  const viewport = page.viewportSize()!
  const box = await control.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1)
}

test.beforeEach(async ({ page }) => {
  const requests: string[] = []
  apiRequests.set(page, requests)
  page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url()) })
  await page.goto("/authoring-refinement", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("authoring-refinement-disclosure")).toHaveAttribute("data-hydrated", "true", { timeout: test.info().timeout })
  await page.evaluate(async () => { await document.fonts.ready })
})
test.afterEach(async ({ page }) => {
  expect(apiRequests.get(page), "Synthetic authoring must not call ERP APIs or establish saved effects").toEqual([])
})

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 720 }]) {
  test.describe(`${viewport.width}x${viewport.height} finance task refinement`, () => {
    test.use({ viewport })

    for (const kind of ["invoice", "bill"] as const) {
      test(`${kind} starts with commercial details and retains the draft after a rejected save`, { tag: "@aside-fit" }, async ({ page }, testInfo) => {
        await page.getByRole("button", { name: `New ${kind}`, exact: true }).click()
        const modal = page.getByTestId("create-invoice-modal")
        const documentDetails = modal.getByRole("region", { name: "Document details", exact: true })
        const accounting = modal.getByRole("region", { name: "Accounting details", exact: true })
        await expect(documentDetails).toBeVisible()
        await expect(accounting).toContainText("Review the journal and accounts before saving")
        const headings = await modal.locator("h3").allTextContents()
        expect(headings.indexOf("Document details")).toBeLessThan(headings.indexOf("Accounting details"))
        expect(headings.indexOf("Line Items")).toBeGreaterThan(headings.indexOf("Document details"))
        expect(headings.indexOf("Line Items")).toBeLessThan(headings.indexOf("Accounting details"))
        await expect(documentDetails.getByRole("textbox", { name: "Currency", exact: true })).toHaveValue("Euro (EUR)")
        await expect(documentDetails.getByRole("textbox", { name: "Currency", exact: true })).toHaveAttribute("readonly", "")
        await page.screenshot({ path: testInfo.outputPath(`${kind}-entry-${viewport.width}.png`) })
        await choose(page, modal.getByTestId("create-invoice-partner"), `Synthetic ${kind === "invoice" ? "customer" : "vendor"}`)
        await modal.getByRole("textbox", { name: "Reference", exact: true }).fill("Commercial reference A17")
        await modal.getByTestId("create-invoice-line-description").fill("Alpha task review service")
        await modal.getByTestId("create-invoice-line-unit-price").fill("37.50")
        await reviewInvoiceAccountingChoices(page)
        if (kind === "invoice") {
          const content = modal.getByTestId("create-invoice-content-toggle")
          await expect(content).toHaveAttribute("aria-expanded", "false")
          await expect(modal.getByRole("textbox", { name: "Notice", exact: true })).toBeHidden()
          await expect(modal.getByTestId("create-invoice-content-summary")).toContainText("Company default")
          await content.click()
          await modal.getByRole("textbox", { name: "Notice", exact: true }).fill("Please include the commercial reference with payment.")
          await content.click()
          await expect(modal.getByTestId("create-invoice-content-summary")).toContainText("Edited for this document")
          await expect(modal.getByTestId("create-invoice-content-summary")).toContainText("Please include the commercial reference with payment.")
        }
        const workspace = modal.getByTestId("finance-review-workspace")
        const preview = workspace.getByTestId("finance-review-document")
        await expect(preview).toHaveCSS("position", viewport.width >= 1440 ? "sticky" : "static")
        if (viewport.width >= 1440) {
          await workspace.evaluate((node) => { node.style.maxWidth = "36rem" })
          await expect(preview).toHaveCSS("position", "static")
          await expect(modal.getByTestId("create-invoice-line-description")).toHaveValue("Alpha task review service")
        }
        await workspace.getByRole("tab", { name: "Document preview", exact: true }).click()
        await expect(modal.getByTestId("invoice-document")).toContainText("Alpha task review service")
        await workspace.getByRole("tab", { name: "Edit document", exact: true }).click()
        const save = modal.getByTestId("create-invoice-save-draft")
        await expectInViewport(page, save)
        await save.click()
        await expect(modal.getByRole("alert")).toContainText("Synthetic invoice save rejected")
        await expect(modal.getByRole("textbox", { name: "Reference", exact: true })).toHaveValue("Commercial reference A17")
        await expect(modal.getByTestId("create-invoice-line-description")).toHaveValue("Alpha task review service")
        await expect(modal.getByTestId("create-invoice-line-unit-price")).toHaveValue("37.50")
        await expectInViewport(page, save)
        if (kind === "invoice") {
          await modal.getByTestId("create-invoice-content-toggle").click()
          await expect(modal.getByRole("textbox", { name: "Notice", exact: true })).toHaveText("Please include the commercial reference with payment.")
        }
        await expect(page.getByTestId("authoring-refinement-attempts")).toContainText("1")
        await page.screenshot({ path: testInfo.outputPath(`${kind}-rejected-${viewport.width}.png`) })
      })
    }

    test("expense starts with the receipt and preserves business values and attachment after rejection", async ({ page }, testInfo) => {
      await page.getByRole("button", { name: "New expense", exact: true }).click()
      const modal = page.getByTestId("form-modal-new-expense")
      await page.screenshot({ path: testInfo.outputPath(`expense-entry-${viewport.width}.png`) })
      const receipt = modal.getByTestId("form-field-receiptFile")
      const name = modal.getByTestId("form-field-name")
      const employee = modal.getByTestId("form-field-employeeId")
      const pricelist = modal.getByTestId("form-field-pricelistId")
      await expectBefore(receipt, name)
      await expectBefore(name, employee)
      await expectBefore(employee, pricelist)
      await expect(modal).toContainText("currency")
      await receipt.setInputFiles({ name: "taxi-receipt.png", mimeType: "image/png", buffer: image })
      await name.fill("Taxi from customer visit")
      await choose(page, employee, "Synthetic employee Jane Example")
      await choose(page, pricelist, "Travel expenses · Euro (EUR)")
      const amount = modal.getByTestId("form-field-totalAmount")
      await amount.fill("19.73")
      const save = modal.getByTestId("form-submit-new-expense")
      await expectInViewport(page, save)
      await save.click()
      await expect(modal.getByRole("alert")).toContainText("Synthetic expense save rejected")
      await expect(name).toHaveValue("Taxi from customer visit")
      await expect(amount).toHaveValue("19.73")
      await expect(employee).toContainText("Synthetic employee Jane Example")
      await expect(pricelist).toContainText("Travel expenses · Euro (EUR)")
      await expect(selectedReceipt(modal, "taxi-receipt.png")).toBeVisible()
      await expectInViewport(page, save)
      await expect(page.getByTestId("authoring-refinement-attempts")).toContainText("1")
      const fields = { name: "Taxi from customer visit", totalAmount: "19.73" }
      await expectExpenseSubmission(page, "taxi-receipt.png", fields)
      await page.screenshot({ path: testInfo.outputPath(`expense-rejected-${viewport.width}.png`) })
      // Submit again without picking a new file to prove the rejected form retained the bytes.
      await save.click()
      await expect(page.getByTestId("authoring-refinement-attempts")).toHaveText("Synthetic rejected save attempts: 2")
      await expectExpenseSubmission(page, "taxi-receipt.png", fields)
    })
  })
}

test.describe("expense type transitions", () => {
  // Includes fixture hydration and three select transitions on shared CI workers.
  test.setTimeout(60_000)

  test("expense types show relevant inputs and keep the attached receipt during type changes", async ({ page }) => {
    await page.getByRole("button", { name: "New expense", exact: true }).click()
    const modal = page.getByTestId("form-modal-new-expense")
    const receipt = modal.getByTestId("form-field-receiptFile")
    const amount = modal.getByTestId("form-field-totalAmount")
    const quantity = modal.getByTestId("form-field-quantity")
    const kind = modal.getByTestId("form-field-lineKind")
    await receipt.setInputFiles({ name: "travel-receipt.png", mimeType: "image/png", buffer: image })
    await amount.fill("25.15")
    await quantity.fill("2")
    await choose(page, kind, /Mileage/)
    await expect(modal.getByTestId("form-field-mileageDistance")).toBeVisible()
    await expect(modal.getByTestId("form-field-mileageRateId")).toBeVisible()
    await expect(amount).toHaveCount(0)
    await expect(modal.getByTestId("form-field-perDiemDays")).toHaveCount(0)
    await choose(page, kind, /PerDiem|Per diem|Daily allowance/)
    await expect(modal.getByTestId("form-field-perDiemDays")).toBeVisible()
    await expect(modal.getByTestId("form-field-perDiemRateId")).toBeVisible()
    await expect(modal.getByTestId("form-field-mileageDistance")).toHaveCount(0)
    await choose(page, kind, "Purchase")
    await expect(amount).toHaveValue("25.15")
    await expect(quantity).toHaveValue("2")
    await expect(selectedReceipt(modal, "travel-receipt.png")).toBeVisible()
    await modal.getByTestId("form-field-name").fill("Travel expense")
    await choose(page, modal.getByTestId("form-field-employeeId"), "Synthetic employee Jane Example")
    await choose(page, modal.getByTestId("form-field-pricelistId"), "Travel expenses · Euro (EUR)")
    await modal.getByTestId("form-submit-new-expense").click()
    await expect(modal.getByRole("alert")).toContainText("Synthetic expense save rejected")
    await expectExpenseSubmission(page, "travel-receipt.png", {
      name: "Travel expense",
      totalAmount: "25.15",
      quantity: "2",
    })
  })
})


test("long invoice rejection stays in the scroll body and leaves actions reachable at 390x600", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 600 })
  await page.getByRole("button", { name: "Use long synthetic invoice rejection", exact: true }).click()
  await page.getByRole("button", { name: "New invoice", exact: true }).click()
  const modal = page.getByTestId("create-invoice-modal")
  await choose(page, modal.getByTestId("create-invoice-partner"), "Synthetic customer")
  await modal.getByTestId("create-invoice-line-description").fill("Retained service description")
  await modal.getByTestId("create-invoice-line-unit-price").fill("49.50")
  await reviewInvoiceAccountingChoices(page)
  const save = modal.getByTestId("create-invoice-save-draft")
  await save.click()
  const body = modal.getByTestId("create-invoice-scroll-body")
  await expect(body.getByRole("alert")).toContainText("Synthetic invoice save rejected")
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0)
  expect(await modal.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  await expectInViewport(page, modal)
  await expectInViewport(page, save)
  await expectInViewport(page, modal.getByRole("button", { name: "Close", exact: true }))
  await expect(modal.getByTestId("create-invoice-line-description")).toHaveValue("Retained service description")
  await page.screenshot({ path: testInfo.outputPath("invoice-long-rejection-390x600.png") })
  await modal.getByTestId("create-invoice-line-description").scrollIntoViewIfNeeded()
  await expectInViewport(page, modal.getByTestId("create-invoice-line-description"))
  await expectInViewport(page, save)
})

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  for (const theme of ["light", "dark"] as const) {
    test(`responsive form usability at ${viewport.width}px in ${theme} theme`, async ({ page }, testInfo) => {
      test.setTimeout(60_000)
      await page.setViewportSize(viewport)
      await page.goto("/usability-forms", { waitUntil: "domcontentloaded" })
      await expect(page.getByTestId("usability-forms-disclosure")).toHaveAttribute("data-hydrated", "true", { timeout: 30_000 })
      await page.getByRole("button", { name: theme === "dark" ? "Dark theme" : "Light theme", exact: true }).click()
      await expect(page.getByTestId("usability-forms-theme")).toHaveText(theme)
      await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`))
      await page.evaluate(async () => { await document.fonts.ready })

      for (const form of [
        { trigger: "New quotation", id: "new-sale-order", field: "clientOrderRef", action: "Save draft quotation" },
        { trigger: "New product", id: "new-product", field: "name", action: "Create product" },
        { trigger: "Add vehicle", id: "new-fleet-vehicle", field: "name", action: "Add vehicle" },
      ]) {
        const trigger = page.getByRole("button", { name: form.trigger, exact: true })
        await trigger.focus()
        await page.keyboard.press("Enter")
        const modal = page.getByTestId(`form-modal-${form.id}`)
        const save = modal.getByRole("button", { name: form.action, exact: true })
        const cancel = modal.getByRole("button", { name: "Cancel", exact: true })
        const input = modal.getByTestId(`form-field-${form.field}`)
        await expectInViewport(page, modal)
        await expectInViewport(page, save)
        await expectInViewport(page, cancel)
        await expect(input).toHaveAccessibleName(/\S/)
        expect(await modal.evaluate((element) => element.contains(document.activeElement))).toBe(true)
        expect(await modal.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)

        if (form.id === "new-sale-order") {
          await expect(modal.getByLabel("Valid until", { exact: true })).toHaveCount(1)
          await expect(modal.getByLabel("Promised delivery date", { exact: true })).toHaveCount(1)
          const setup = modal.getByRole("link", { name: /Open price lists.*opens in a new tab/ })
          await expect(setup).toHaveAttribute("target", "_blank")
          await setup.focus()
          await expectInViewport(page, setup)
          await page.keyboard.press("Tab")
          expect(await modal.evaluate((element) => element.contains(document.activeElement))).toBe(true)
        }

        await input.fill(`Retained ${form.id} entry`)
        await modal.locator("[data-form-field]").last().scrollIntoViewIfNeeded()
        await expectInViewport(page, save)
        await save.focus()
        await expect(save).toBeFocused()
        await page.keyboard.press("Shift+Tab")
        await expect(cancel).toBeFocused()
        await page.keyboard.press("Tab")
        await expect(save).toBeFocused()
        await page.keyboard.press("Tab")
        expect(await modal.evaluate((element) => element.contains(document.activeElement))).toBe(true)
        await page.screenshot({ path: testInfo.outputPath(`${form.id}-${viewport.width}-${theme}.png`) })

        await page.keyboard.press("Escape")
        const discard = page.getByTestId("discard-changes-dialog")
        await expectInViewport(page, discard)
        await expect.poll(() => discard.evaluate((element) => element.contains(document.activeElement))).toBe(true)
        const keep = discard.getByRole("button", { name: "Keep editing", exact: true })
        await keep.focus()
        await page.keyboard.press("Enter")
        await expect(discard).toBeHidden()
        await expect(input).toHaveValue(`Retained ${form.id} entry`)

        if (form.id === "new-fleet-vehicle") {
          await save.focus()
          await page.keyboard.press("Enter")
          await expect(modal.getByRole("alert")).toContainText("Synthetic save rejected")
          await expect(input).toHaveValue(`Retained ${form.id} entry`)
          await expectInViewport(page, save)
        }
        await cancel.click()
        await expect(discard).toBeVisible()
        await discard.getByRole("button", { name: "Discard", exact: true }).click()
        await expect(modal).toBeHidden()
        // This fixture mounts controlled dialogs without a DialogTrigger. Check
        // that the page is usable again without assuming trigger-ref restoration.
        await trigger.focus()
        await expect(trigger).toBeFocused()
      }
      await expect(page.getByTestId("usability-forms-attempts")).toHaveText("1 synthetic save attempts")
    })
  }
}
