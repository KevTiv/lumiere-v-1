import { createHash } from "node:crypto"
import { stbTimestampMicros } from "@lumiere/erp-shared/stb-timestamp"
import { expect, test, type Locator, type Page, type Request } from "@playwright/test"
import {
  activeTabEntityTable,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  fillField,
  gotoModule,
  isoDate,
  smokeName,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"
import type { ExpenseCaptureOutboxItem } from "../../lib/expense-capture-outbox"

type Row = Record<string, unknown>
type Command = { params: Row }
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQaPj/HwAFAgKfdqhGyQAAAABJRU5ErkJggg==", "base64")

// Preserve u64 values exactly. Unwrap only the generated Option wire format.
function value(raw: unknown): unknown {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (Object.hasOwn(raw, "some")) return (raw as { some: unknown }).some
    if (Object.hasOwn(raw, "none")) return undefined
  }
  return raw
}
function id(raw: unknown): string {
  const scalar = value(raw)
  if (typeof scalar === "number") expect(Number.isSafeInteger(scalar)).toBe(true)
  expect(typeof scalar === "string" || typeof scalar === "number").toBe(true)
  const result = String(scalar)
  expect(result).toMatch(/^[1-9]\d*$/)
  return result
}
function field(row: Row, camel: string, snake: string = camel): unknown {
  return value(row[camel] ?? row[snake])
}
function tag(raw: unknown): string {
  const unwrapped = value(raw)
  if (unwrapped && typeof unwrapped === "object") {
    if ("tag" in unwrapped) return String(unwrapped.tag)
    const key = Object.keys(unwrapped)[0] ?? ""
    return key.charAt(0).toUpperCase() + key.slice(1)
  }
  return String(unwrapped ?? "")
}
async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  expect(response.ok(), `${resource} authorized query`).toBe(true)
  const body = await response.json() as { data?: Row[] }
  expect(Array.isArray(body.data)).toBe(true)
  return body.data!
}
async function exactExpense(page: Page, key: string, organizationId: string, companyId: string) {
  const matches = (await rows(page, "expenses")).filter((row) =>
    field(row, "clientRequestId", "client_request_id") === key
    && id(field(row, "organizationId", "organization_id")) === organizationId
    && id(field(row, "companyId", "company_id")) === companyId,
  )
  expect(matches, `one saved expense for exact request ${key}`).toHaveLength(1)
  return matches[0]!
}
async function retainedAttempt(page: Page, organizationId: string, requestId: string): Promise<ExpenseCaptureOutboxItem> {
  return page.evaluate(({ organizationId, requestId }) => {
    const deviceId = localStorage.getItem("lumiere.expense-capture-device-id")
    if (!deviceId) throw new Error("Capture device identity is missing")
    const entries = JSON.parse(localStorage.getItem(`lumiere.expense-capture-outbox.${organizationId}.${deviceId}`) ?? "[]") as ExpenseCaptureOutboxItem[]
    const matches = entries.filter((entry) => entry.clientRequestId === requestId)
    if (matches.length !== 1) throw new Error(`Expected one retained request, found ${matches.length}`)
    return matches[0]!
  }, { organizationId, requestId })
}
function observeWrites(page: Page) {
  const expense: Request[] = [], receipt: Request[] = []
  page.on("request", (request) => {
    if (request.method() !== "POST") return
    if (matchesOperationResponse(request, "create_expense")) expense.push(request)
    if (matchesOperationResponse(request, "create_expense_receipt")) receipt.push(request)
  })
  return { expense, receipt }
}
async function chooseOffered(page: Page, trigger: Locator): Promise<string> {
  await trigger.click()
  const options = page.locator('[role="listbox"]:visible').getByRole("option", { disabled: false })
  await expect.poll(() => options.count()).toBeGreaterThan(0)
  // Shared Select options mirror their exact IDs in data-value.
  const first = options.first()
  const selected = id(await first.getAttribute("data-value"))
  await first.click()
  return selected
}
async function prepareDraft(page: Page, entry: "table" | "dashboard", entryScreenshot?: string) {
  const originalViewport = page.viewportSize()
  if (entryScreenshot) await page.setViewportSize({ width: 390, height: 844 })
  const [organization, company] = await Promise.all([
    fetchSessionOrganizationId(page), fetchDefaultCompanyId(page),
  ])
  const organizationId = id(organization), companyId = id(company)
  await gotoModule(page, `/expenses?tab=${entry === "table" ? "expenses" : "dashboard"}`, "expenses")
  await page.getByTestId(entry === "table" ? "module-create-expenses-expenses" : "quick-action-new_expense").click()
  const modal = page.getByTestId("form-modal-new-expense")
  await expect(modal).toBeVisible()
  if (entryScreenshot) {
    await page.screenshot({ path: entryScreenshot })
    if (originalViewport) await page.setViewportSize(originalViewport)
  }
  const name = smokeName(`alpha-generic-${entry}`)
  const date = isoDate()
  const filename = `${name}.png`
  await modal.getByTestId("form-field-receiptFile").setInputFiles({ name: filename, mimeType: "image/png", buffer: png })
  await fillField(modal, "name", name)
  await fillField(modal, "date", date)
  await fillField(modal, "merchantKey", name)
  const employeeId = await chooseOffered(page, modal.getByTestId("form-field-employeeId"))
  const pricelistId = await chooseOffered(page, modal.getByTestId("form-field-pricelistId"))
  await fillField(modal, "totalAmount", "19.73")
  await fillField(modal, "quantity", "2")
  const employee = (await rows(page, "employees")).filter((row) => id(row.id) === employeeId)
  expect(employee).toHaveLength(1)
  expect(id(field(employee[0]!, "organizationId", "organization_id"))).toBe(organizationId)
  expect(id(field(employee[0]!, "companyId", "company_id"))).toBe(companyId)
  const pricelist = (await rows(page, "pricelists")).filter((row) => id(row.id) === pricelistId)
  expect(pricelist).toHaveLength(1)
  const currencyId = id(field(pricelist[0]!, "currencyId", "currency_id"))
  const employeeLabel = await modal.getByTestId("form-field-employeeId").innerText()
  const pricelistLabel = await modal.getByTestId("form-field-pricelistId").innerText()
  const paymentLabel = await modal.getByTestId("form-field-paymentMode").innerText()
  return { modal, organizationId, companyId, employeeId, pricelistId, currencyId, name, date, filename, employeeLabel, pricelistLabel, paymentLabel }
}
async function assertSavedPayload(page: Page, writes: ReturnType<typeof observeWrites>, draft: Awaited<ReturnType<typeof prepareDraft>>, optional?: { productId: string; taxId: string }) {
  expect(writes.expense).toHaveLength(1)
  expect(writes.receipt).toHaveLength(1)
  const command = writes.expense[0]!.postDataJSON() as Command
  const receiptCommand = writes.receipt[0]!.postDataJSON() as Command
  const key = value(command.params.client_request_id)
  expect(typeof key).toBe("string")
  expect(String(key).length).toBeGreaterThan(0)
  const expense = await exactExpense(page, String(key), draft.organizationId, draft.companyId)
  const receiptKey = value(receiptCommand.params.client_request_id)
  const receipts = (await rows(page, "expense-receipts")).filter((row) => field(row, "clientRequestId", "client_request_id") === receiptKey)
  expect(receipts).toHaveLength(1)
  const receipt = receipts[0]!
  const receiptId = id(receipt.id)
  for (const [camel, snake, expected] of [
    ["employeeId", "employee_id", draft.employeeId],
    ["companyId", "company_id", draft.companyId],
    ["currencyId", "currency_id", draft.currencyId],
  ] as const) {
    expect(id(command.params[snake])).toBe(expected)
    expect(id(field(expense, camel, snake))).toBe(expected)
  }
  const expectedDate = BigInt(Date.parse(draft.date)) * 1_000n
  expect(stbTimestampMicros(command.params.date)).toBe(expectedDate)
  expect(stbTimestampMicros(field(expense, "date"))).toBe(expectedDate)
  expect(command.params.name).toBe(draft.name)
  expect(command.params.unit_amount).toBe(19.73)
  expect(command.params.quantity).toBe(2)
  expect(tag(command.params.line_kind)).toBe("Standard")
  expect(tag(command.params.payment_mode)).toBe("OutOfPocket")
  expect(value(command.params.merchant_key)).toBe(draft.name)
  expect((command.params.attachment_ids as unknown[]).map(id)).toEqual([receiptId])
  expect(field(expense, "name")).toBe(draft.name)
  expect(field(expense, "unitAmount", "unit_amount")).toBe(19.73)
  expect(field(expense, "quantity")).toBe(2)
  expect(Number(field(expense, "totalAmount", "total_amount"))).toBeCloseTo(39.46, 8)
  expect(tag(field(expense, "state"))).toBe("Draft")
  expect(tag(field(expense, "lineKind", "line_kind"))).toBe("Standard")
  expect(tag(field(expense, "paymentMode", "payment_mode"))).toBe("OutOfPocket")
  expect(field(expense, "merchantKey", "merchant_key")).toBe(draft.name)
  expect(field(expense, "hasReceipt", "has_receipt")).toBe(true)
  expect((field(expense, "attachmentIds", "attachment_ids") as unknown[]).map(id)).toEqual([receiptId])
  expect(id(field(receipt, "organizationId", "organization_id"))).toBe(draft.organizationId)
  expect(id(field(receipt, "companyId", "company_id"))).toBe(draft.companyId)
  expect(id(field(receipt, "employeeId", "employee_id"))).toBe(draft.employeeId)
  expect(field(receipt, "contentHash", "content_hash")).toBe(createHash("sha256").update(png).digest("hex"))
  expect(field(receipt, "storageKey", "storage_key")).toMatch(new RegExp(`^org-${draft.organizationId}/[a-zA-Z0-9_-]+/[a-f0-9]{32}$`))
  if (optional) {
    expect(id(command.params.product_id)).toBe(optional.productId)
    expect((command.params.tax_ids as unknown[]).map(id)).toEqual([optional.taxId])
    expect(id(field(expense, "productId", "product_id"))).toBe(optional.productId)
    expect((field(expense, "taxIds", "tax_ids") as unknown[]).map(id)).toEqual([optional.taxId])
  }
  return { key: String(key), expenseId: id(expense.id), receiptId }
}
async function reloadExactRecord(page: Page, expenseId: string, filename: string) {
  await gotoModule(page, `/expenses?tab=expenses&filter=${encodeURIComponent(`id:${expenseId}`)}`, "expenses")
  await page.reload()
  await activeTabEntityTable(page).getByTestId(`entity-row-${expenseId}`).click()
  const review = page.getByRole("dialog").filter({ has: page.getByTestId("finance-review-workspace") })
  const image = review.getByRole("img", { name: filename, exact: true })
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(1)
}

test.describe("Alpha generic expense create effect", { tag: ["@dev-fixture", "@alpha-expense-effect"] }, () => {
  test("table New saves the admitted product, purchase tax and real receipt, then reloads the exact saved expense", async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    const writes = observeWrites(page)
    const draft = await prepareDraft(page, "table", testInfo.outputPath("generic-expense-entry-390.png"))
    // These are named seed records with verified eligibility. No account, tax or currency is invented.
    const products = (await rows(page, "products")).filter((row) => field(row, "name") === "Software Consulting"
      && field(row, "defaultCode", "default_code") === "CONSULT-001"
      && id(field(row, "organizationId", "organization_id")) === draft.organizationId
      && field(row, "canBeExpensed", "can_be_expensed") === true && field(row, "active") === true)
    expect(products, "one admitted seeded expense product").toHaveLength(1)
    const taxes = (await rows(page, `account-taxes?companyId=${draft.companyId}`)).filter((row) => field(row, "name") === "VAT 20% (Purchase)"
      && id(field(row, "organizationId", "organization_id")) === draft.organizationId
      && id(field(row, "companyId", "company_id")) === draft.companyId
      && tag(field(row, "typeTaxUse", "type_tax_use")) === "Purchase" && field(row, "active") === true)
    expect(taxes, "one admitted seeded purchase tax").toHaveLength(1)
    const productId = id(products[0]!.id), taxId = id(taxes[0]!.id)
    await draft.modal.getByTestId("form-field-productId").click()
    await page.getByPlaceholder("Search...", { exact: true }).fill("Software Consulting")
    await page.getByRole("option", { name: String(field(products[0]!, "displayName", "display_name") ?? products[0]!.name), exact: true }).click()
    await draft.modal.getByTestId("form-field-taxIds").click()
    const tax = page.getByRole("listbox").getByRole("option", { name: "VAT 20% (Purchase)", exact: true })
    await tax.click()
    await expect(tax).toHaveAttribute("aria-checked", "true")
    await page.keyboard.press("Escape")
    await draft.modal.getByTestId("form-submit-new-expense").click()
    await expect(draft.modal).toBeHidden({ timeout: 30_000 })
    const saved = await assertSavedPayload(page, writes, draft, { productId, taxId })
    await reloadExactRecord(page, saved.expenseId, draft.filename)
    await exactExpense(page, saved.key, draft.organizationId, draft.companyId)
    expect(writes.expense).toHaveLength(1)
    expect(writes.receipt).toHaveLength(1)
    await page.screenshot({ path: testInfo.outputPath("generic-expense-saved-receipt.png") })
  })

  test("dashboard New retains and locks a committed expense after response loss; Check status reads without resending", async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    const writes = observeWrites(page)
    const draft = await prepareDraft(page, "dashboard")
    let blockBrowserReadback = false
    let upstreamWrites = 0
    await page.route((url) => url.pathname === "/api/query/expenses", async (route) => {
      if (blockBrowserReadback) await route.abort("failed")
      else await route.continue()
    })
    await page.route((url) => matchesOperationResponse({ url: () => url.toString() }, "create_expense"), async (route) => {
      upstreamWrites += 1
      if (upstreamWrites !== 1) { await route.abort("failed"); return }
      const response = await route.fetch({ maxRetries: 0 })
      expect(response.ok(), await response.text()).toBe(true)
      // Only the response is lost. The real server has already accepted the operation.
      blockBrowserReadback = true
      await route.abort("failed")
    })
    await draft.modal.getByTestId("form-submit-new-expense").click()
    const attempt = page.getByTestId("expense-create-attempt")
    const check = page.getByTestId("expense-create-check-status")
    await expect(check).toBeVisible({ timeout: 30_000 })
    await expect(check).toBeEnabled()
    await expect(attempt).toHaveAttribute("data-sync-state", "unknown")
    await page.setViewportSize({ width: 390, height: 600 })
    await expect.poll(async () => {
      const bounds = await draft.modal.boundingBox()
      return bounds !== null && bounds.x >= -1 && bounds.y >= -1
        && bounds.x + bounds.width <= 391 && bounds.y + bounds.height <= 601
    }, { message: "Unknown expense dialog stays inside the short mobile viewport" }).toBe(true)
    for (const owner of [draft.modal, attempt]) {
      await expect.poll(() => owner.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1)
    }
    const body = draft.modal.locator("[data-form-body]")
    await expect.poll(async () => (await body.boundingBox())?.height ?? 0, {
      message: "The retained expense keeps at least 160px of inspectable field space",
    }).toBeGreaterThanOrEqual(160)
    const purpose = draft.modal.getByTestId("form-field-name")
    await purpose.scrollIntoViewIfNeeded()
    const bodyBounds = await body.boundingBox()
    const purposeBounds = await purpose.boundingBox()
    expect(bodyBounds).not.toBeNull()
    expect(purposeBounds).not.toBeNull()
    expect(purposeBounds!.x).toBeGreaterThanOrEqual(bodyBounds!.x - 1)
    expect(purposeBounds!.y).toBeGreaterThanOrEqual(bodyBounds!.y - 1)
    expect(purposeBounds!.x + purposeBounds!.width).toBeLessThanOrEqual(bodyBounds!.x + bodyBounds!.width + 1)
    expect(purposeBounds!.y + purposeBounds!.height).toBeLessThanOrEqual(bodyBounds!.y + bodyBounds!.height + 1)
    await expect(purpose).toHaveValue(draft.name)
    const close = draft.modal.locator('[data-slot="dialog-close"]')
    for (const action of [close, check]) {
      await expect(action).toBeVisible()
      await expect(action).toBeEnabled()
      await expect(action).toBeInViewport({ ratio: 1 })
      const bounds = await action.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(-1)
      expect(bounds!.y).toBeGreaterThanOrEqual(-1)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(601)
      await action.click({ trial: true })
      await action.focus()
      await expect(action).toBeFocused()
    }
    await expect(draft.modal.getByTestId("form-submit-new-expense")).toBeDisabled()
    for (const name of ["name", "date", "merchantKey", "lineKind", "employeeId", "pricelistId", "totalAmount", "quantity", "paymentMode", "receiptFile", "hasReceipt", "projectId", "productId", "taxIds"]) {
      await expect(draft.modal.getByTestId(`form-field-${name}`)).toBeDisabled()
    }
    await expect(draft.modal.getByTestId("form-field-name")).toHaveValue(draft.name)
    await expect(draft.modal.getByTestId("form-field-merchantKey")).toHaveValue(draft.name)
    await expect(draft.modal.getByTestId("form-field-totalAmount")).toHaveValue("19.73")
    await expect(draft.modal.getByTestId("form-field-quantity")).toHaveValue("2")
    await expect(draft.modal.getByTestId("form-field-employeeId")).toHaveText(draft.employeeLabel)
    await expect(draft.modal.getByTestId("form-field-pricelistId")).toHaveText(draft.pricelistLabel)
    await expect(draft.modal.getByTestId("form-field-paymentMode")).toHaveText(draft.paymentLabel)
    await expect(draft.modal.getByTestId("form-field-lineKind")).toContainText("Purchase")
    expect(await draft.modal.getByTestId("form-field-receiptFile").evaluate((node) => (node as HTMLInputElement).files?.[0]?.name)).toBe(draft.filename)
    const saved = await assertSavedPayload(page, writes, draft)
    await expect(attempt).toHaveAttribute("data-client-request-id", saved.key)
    await expect(attempt).toHaveAttribute("data-company-id", draft.companyId)
    expect(upstreamWrites).toBe(1)
    await page.screenshot({ path: testInfo.outputPath("generic-expense-unknown-retained.png") })
    const frozen = await retainedAttempt(page, draft.organizationId, saved.key)
    expect(frozen.syncState).toBe("unknown")
    expect(frozen.clientRequestId).toBe(saved.key)
    expect(frozen.companyId).toBe(draft.companyId)
    expect(frozen.formOrigin?.organizationId).toBe(draft.organizationId)
    expect(frozen.formOrigin?.pricelistId).toBe(draft.pricelistId)
    expect(frozen.payload).toMatchObject({
      employeeId: draft.employeeId, currencyId: draft.currencyId, name: draft.name,
      date: new Date(draft.date).toISOString(), unitAmount: 19.73, quantity: 2,
      merchantKey: draft.name, lineKind: "Standard", paymentMode: "OutOfPocket",
      hasReceipt: true, taxIds: [],
    })
    expect(frozen.receipt?.state).toBe("attached")
    expect(frozen.receipt?.receiptId).toBe(saved.receiptId)
    expect(frozen.receipt?.clientRequestId).toBe(value((writes.receipt[0]!.postDataJSON() as Command).params.client_request_id))
    expect(frozen.receipt?.uploaded?.checksum).toBe(createHash("sha256").update(png).digest("hex"))
    const assertRecovered = async () => {
      await expect(draft.modal).toBeVisible()
      await expect(attempt).toHaveAttribute("data-sync-state", "unknown")
      await expect(attempt).toHaveAttribute("data-client-request-id", saved.key)
      await expect(attempt).toHaveAttribute("data-company-id", draft.companyId)
      await expect(draft.modal.getByTestId("form-field-name")).toHaveValue(draft.name)
      await expect(draft.modal.getByTestId("form-field-merchantKey")).toHaveValue(draft.name)
      await expect(draft.modal.getByTestId("form-field-totalAmount")).toHaveValue("19.73")
      await expect(draft.modal.getByTestId("form-field-quantity")).toHaveValue("2")
      await expect(draft.modal.getByTestId("form-field-employeeId")).toHaveText(draft.employeeLabel)
      await expect(draft.modal.getByTestId("form-field-pricelistId")).toHaveText(draft.pricelistLabel)
      for (const name of ["name", "merchantKey", "date", "employeeId", "pricelistId", "lineKind", "totalAmount", "quantity", "paymentMode", "receiptFile", "hasReceipt", "projectId", "productId", "taxIds"]) {
        await expect(draft.modal.getByTestId(`form-field-${name}`)).toBeDisabled()
      }
      await expect(draft.modal.getByTestId("form-submit-new-expense")).toBeDisabled()
      await expect(check).toBeEnabled()
      expect(await retainedAttempt(page, draft.organizationId, saved.key)).toEqual(frozen)
      expect(upstreamWrites).toBe(1)
      expect(writes.expense).toHaveLength(1)
      expect(writes.receipt).toHaveLength(1)
    }
    // Native file bytes are checked above. The attached receipt checkpoint survives close and reload.
    await close.click()
    await expect(draft.modal).toBeHidden()
    await expect(page.getByTestId("discard-changes-dialog")).toBeHidden()
    const resume = page.getByTestId("expense-create-resume")
    await expect(resume).toBeVisible()
    await resume.click()
    await assertRecovered()
    await page.reload()
    await expect(resume).toBeVisible()
    await resume.click()
    await assertRecovered()
    await page.screenshot({ path: testInfo.outputPath("generic-expense-unknown-restored.png") })
    blockBrowserReadback = false
    await check.click()
    await expect(draft.modal).toBeHidden({ timeout: 30_000 })
    await exactExpense(page, saved.key, draft.organizationId, draft.companyId)
    expect(upstreamWrites).toBe(1)
    expect(writes.expense).toHaveLength(1)
    expect(writes.receipt).toHaveLength(1)
    await reloadExactRecord(page, saved.expenseId, draft.filename)
    expect(writes.expense).toHaveLength(1)
    await page.screenshot({ path: testInfo.outputPath("generic-expense-unknown-confirmed.png") })
  })
})
