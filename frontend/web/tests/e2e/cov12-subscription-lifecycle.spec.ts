import { expect, test, type Page, type Request } from "@playwright/test"

import {
  addLaptopLine,
  createDraftSaleOrder,
  confirmOrderViaUi,
} from "./sales-order-fixtures"
import {
  fetchAccountSelectLabelByInternalType,
  fetchSalesInvoiceJournalLabel,
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  chooseSelectOptionByValue,
  fetchSaleOrderSelectLabel,
  fillField,
  gotoModule,
  isoDate,
  scalarQueryId,
  selectEntityRowById,
  selectModuleTab,
  signIn,
  smokeName,
  submitForm,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

type Row = Record<string, unknown>

function tagged(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("tag" in value) return String((value as { tag?: unknown }).tag ?? "")
    const keys = Object.keys(value)
    if (keys.length === 1) return keys[0]!.charAt(0).toUpperCase() + keys[0]!.slice(1)
  }
  return ""
}

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) {
    throw new Error(`${resource} query failed: ${response.status()}`)
  }
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function replay(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

function field(row: Row, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake]
}

async function subscriptionSnapshot(page: Page, subscriptionId: number) {
  const row = (await rows(page, "subscriptions")).find(
    (candidate) => scalarQueryId(candidate.id) === subscriptionId,
  )
  if (!row) throw new Error(`subscription not found: ${subscriptionId}`)
  return {
    id: subscriptionId,
    organizationId: scalarQueryId(field(row, "organizationId", "organization_id")),
    companyId: scalarQueryId(field(row, "companyId", "company_id")),
    state: String(row.state ?? ""),
    code: String(row.code ?? ""),
  }
}

async function linesOf(page: Page, subscriptionId: number) {
  return (await rows(page, "subscription-lines"))
    .filter(
      (line) =>
        scalarQueryId(field(line, "subscriptionId", "subscription_id")) ===
        subscriptionId,
    )
    .map((line) => ({
      id: scalarQueryId(line.id),
      quantity: Number(field(line, "productUomQty", "product_uom_qty")),
      priceUnit: Number(field(line, "priceUnit", "price_unit")),
    }))
    .sort((a, b) => Number(a.id) - Number(b.id))
}

async function amendmentsOf(page: Page, subscriptionId: number) {
  return (await rows(page, "subscription-amendments")).filter(
    (amendment) =>
      scalarQueryId(field(amendment, "subscriptionId", "subscription_id")) ===
      subscriptionId,
  )
}

async function openSubscriptionAction(
  page: Page,
  subscriptionId: number,
  actionId: string,
) {
  // Exact focus keeps the newly created subscription visible after pagination fills.
  await gotoModule(page, `/subscriptions?tab=subscriptions&filter=id:${subscriptionId}`, "subscriptions")
  await selectEntityRowById(page, subscriptionId)
  const action = page.getByTestId(`entity-action-${actionId}`)
  await expect(action).toBeEnabled()
  return action
}

async function labelByCode(page: Page, resource: string, code: string) {
  const row = (await rows(page, resource)).find(
    (candidate) => String(candidate.code ?? "").toUpperCase() === code,
  )
  if (!row) throw new Error(`${resource} row not found: ${code}`)
  const name = String(row.name ?? "")
  return name ? `${code} — ${name}` : code
}

async function createSubscriptionThroughUi(page: Page, saleOrderLabel: string, code: string) {
  await page.getByTestId("module-create-subscriptions-subscriptions").click()
  const dialog = page.getByTestId("subscription-create-dialog")
  await expect(dialog).toBeVisible()
  await chooseSelectOptionByLabel(page, "saleOrderId", saleOrderLabel)
  await page.getByTestId("form-submit-subscription-create-order").click()
  await chooseFirstEnabledOption(page, "planId")
  await page.getByTestId("form-submit-subscription-create-plan").click()
  await fillField(page, "dateStart", isoDate(0))
  await page.getByTestId("form-submit-subscription-create-billing").click()
  await fillField(page, "code", code)
  const [created] = await Promise.all([
    page.waitForResponse(
      (response) => matchesOperationResponse(response, "create_subscription_from_sale_order"),
      { timeout: 45_000 },
    ),
    page.getByTestId("form-submit-subscription-create-review").click(),
  ])
  expect(created.ok(), await created.text()).toBe(true)
  await expect(dialog).toBeHidden()
  return created
}

/** Sale order → subscription → activate → generate the period invoice, all in the UI. */
async function provisionBilledSubscription(page: Page, label: string) {
  const saleOrderId = await createDraftSaleOrder(page, smokeName(`${label}-so`))
  await addLaptopLine(page, saleOrderId, "1")
  await confirmOrderViaUi(page, saleOrderId)
  const saleOrderLabel = await fetchSaleOrderSelectLabel(page, saleOrderId)

  const incomeLabel = await fetchAccountSelectLabelByInternalType(page, "income")
  const receivableLabel = await fetchAccountSelectLabelByInternalType(page, "receivable")
  const journalLabel = await fetchSalesInvoiceJournalLabel(page)

  await gotoModule(page, "/subscriptions", "subscriptions")
  await selectModuleTab(page, "subscriptions", "subscriptions")
  const code = smokeName(label).toUpperCase().slice(0, 40)
  await createSubscriptionThroughUi(page, saleOrderLabel, code)
  const subscriptionId = scalarQueryId(
    (await rows(page, "subscriptions")).find((row) => row.code === code)?.id,
  )
  if (subscriptionId == null) throw new Error("created subscription not found")
  const activate = await openSubscriptionAction(page, subscriptionId, "activate-sub")
  await activate.click()
  await Promise.all([
    page.waitForResponse(
      (response) => matchesOperationResponse(response, "activate_subscription"),
      { timeout: 45_000 },
    ),
    submitForm(page, "subscription-activate"),
  ])
  await expect.poll(() => subscriptionSnapshot(page, subscriptionId)).toMatchObject({ state: "active" })
  const lines = await linesOf(page, subscriptionId)
  expect(lines).toHaveLength(1)

  const generate = await openSubscriptionAction(page, subscriptionId, "gen-inv")
  await generate.click()
  await expect(page.getByTestId("form-modal-generate-subscription-invoice")).toBeVisible({
    timeout: 15_000,
  })
  const billingRunKey = smokeName(`${label}-run`)
  await fillField(page, "invoiceDate", isoDate(0))
  await fillField(page, "billingRunKey", billingRunKey)
  await chooseSelectOptionByLabel(page, "journalId", journalLabel)
  await chooseSelectOptionByLabel(page, "incomeAccountId", incomeLabel)
  await chooseSelectOptionByLabel(page, "receivableAccountId", receivableLabel)
  const [generated] = await Promise.all([
    page.waitForResponse(
      (response) => matchesOperationResponse(response, "generate_subscription_invoice"),
      { timeout: 45_000 },
    ),
    submitForm(page, "generate-subscription-invoice"),
  ])
  expect(generated.ok(), await generated.text()).toBe(true)
  const run = (await rows(page, "subscription-billing-runs")).find(
    (row) => String(field(row, "billingRunKey", "billing_run_key")) === billingRunKey,
  )
  const invoiceMoveId = scalarQueryId(field(run ?? {}, "invoiceMoveId", "invoice_move_id"))
  if (invoiceMoveId == null) throw new Error("billing run has no invoice")
  return {
    subscriptionId,
    lines,
    invoiceMoveId,
    incomeLabel,
    receivableLabel,
    journalLabel,
  }
}

async function cancelThroughUi(page: Page, subscriptionId: number, creditNote: boolean, invoiceMoveId?: number) {
  const cancelAction = await openSubscriptionAction(page, subscriptionId, "cancel-sub")
  await cancelAction.click()
  await expect(page.getByTestId("form-modal-cancel-subscription")).toBeVisible({
    timeout: 15_000,
  })
  const box = page.getByTestId("form-field-createCreditNote")
  if (((await box.getAttribute("aria-checked")) === "true") !== creditNote) await box.click()
  if (creditNote) {
    expect(invoiceMoveId).toBeDefined()
    await chooseSelectOptionByValue(page, "invoiceMoveId", invoiceMoveId!)
  }
  const [cancelled] = await Promise.all([
    page.waitForResponse(
      (response) => matchesOperationResponse(response, "cancel_subscription"),
      { timeout: 45_000 },
    ),
    submitForm(page, "cancel-subscription"),
  ])
  expect(cancelled.ok(), await cancelled.text()).toBe(true)
  await expect.poll(() => subscriptionSnapshot(page, subscriptionId)).toMatchObject({ state: "closed" })
}

test.describe(
  "COV-12 subscription create → activate → amend → cancel",
  { tag: ["@p0", "@cov12"] },
  () => {
    test("drives the whole lifecycle through visible actions with exact effects, stale replay and reader denial", async ({
      browser,
      page,
    }) => {
      test.setTimeout(300_000)
      // Prerequisite: a confirmed sale order raised through the Sales UI.
      const saleOrderId = await createDraftSaleOrder(
        page,
        smokeName("cov12-so"),
      )
      await addLaptopLine(page, saleOrderId, "1")
      await confirmOrderViaUi(page, saleOrderId)
      const saleOrderLabel = await fetchSaleOrderSelectLabel(page, saleOrderId)

      await gotoModule(page, "/subscriptions", "subscriptions")
      await selectModuleTab(page, "subscriptions", "subscriptions")

      // --- create (draft) through the operator form -----------------------
      const code = smokeName("cov12-life").toUpperCase().slice(0, 40)
      await createSubscriptionThroughUi(page, saleOrderLabel, code)

      const subscription = (await rows(page, "subscriptions")).find(
        (row) => String(row.code ?? "") === code,
      )
      const subscriptionId = scalarQueryId(subscription?.id)
      if (subscriptionId == null) throw new Error("created subscription not found")
      const draft = await subscriptionSnapshot(page, subscriptionId)
      expect(draft).toMatchObject({ state: "draft", code })
      const lines = await linesOf(page, subscriptionId)
      // One confirmed order line becomes exactly one recurring subscription line.
      expect(lines).toHaveLength(1)
      expect(
        (await rows(page, "subscriptions")).filter(
          (row) => String(row.code ?? "") === code,
        ),
      ).toHaveLength(1)

      // --- activate -------------------------------------------------------
      const activate = await openSubscriptionAction(
        page,
        subscriptionId,
        "activate-sub",
      )
      await activate.click()
      const [activated] = await Promise.all([
        page.waitForResponse(
          (response) =>
            matchesOperationResponse(response, "activate_subscription"),
          { timeout: 45_000 },
        ),
        submitForm(page, "subscription-activate"),
      ])
      expect(activated.ok(), await activated.text()).toBe(true)
      await expect
        .poll(() => subscriptionSnapshot(page, subscriptionId))
        .toMatchObject({ state: "active" })
      const activeEffect = await subscriptionSnapshot(page, subscriptionId)
      expect(activeEffect.organizationId).toBe(draft.organizationId)
      expect(activeEffect.companyId).toBe(draft.companyId)
      expect(await linesOf(page, subscriptionId)).toEqual(lines)

      // Activation is not repeatable: a stale replay is rejected and changes nothing.
      const staleActivate = await replay(page, activated.request())
      expect(staleActivate.ok()).toBe(false)
      expect(await subscriptionSnapshot(page, subscriptionId)).toEqual(
        activeEffect,
      )

      // --- amend one recurring line (quantity) -----------------------------
      const targetLine = lines[0]!
      const newQuantity = targetLine.quantity + 2
      const amendAction = await openSubscriptionAction(
        page,
        subscriptionId,
        "amend-sub",
      )
      await amendAction.click()
      await expect(
        page.getByTestId("form-modal-amend-subscription"),
      ).toBeVisible({ timeout: 15_000 })
      await page.getByTestId("form-field-amendmentType").click()
      await page
        .locator('[role="listbox"]:visible')
        .getByRole("option", { name: "Quantity", exact: true })
        .click()
      await chooseFirstEnabledOption(page, "lineId")
      await fillField(page, "newQuantity", String(newQuantity))
      const prorate = page.getByTestId("form-field-prorate")
      if ((await prorate.getAttribute("aria-checked")) === "true") await prorate.click()
      const amendmentsBefore = await amendmentsOf(page, subscriptionId)
      const [amended] = await Promise.all([
        page.waitForResponse(
          (response) =>
            matchesOperationResponse(response, "amend_subscription"),
          { timeout: 45_000 },
        ),
        submitForm(page, "amend-subscription"),
      ])
      expect(amended.ok(), await amended.text()).toBe(true)
      await expect
        .poll(async () => (await linesOf(page, subscriptionId))[0]?.quantity)
        .toBe(newQuantity)
      const amendedLines = await linesOf(page, subscriptionId)
      expect(amendedLines).toEqual(
        lines.map((line, index) =>
          index === 0 ? { ...line, quantity: newQuantity } : line,
        ),
      )
      const amendments = await amendmentsOf(page, subscriptionId)
      expect(amendments).toHaveLength(amendmentsBefore.length + 1)
      const amendment = amendments.find(
        (row) => !amendmentsBefore.some((old) => old.id === row.id),
      )!
      expect(String(field(amendment, "amendmentType", "amendment_type"))).toBe(
        "quantity",
      )
      expect(scalarQueryId(field(amendment, "lineId", "line_id"))).toBe(
        targetLine.id,
      )
      expect((await subscriptionSnapshot(page, subscriptionId)).state).toBe(
        "active",
      )

      // --- reader denial: replaying the amend as a reader changes nothing ---
      const readerContext = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      })
      const readerPage = await readerContext.newPage()
      try {
        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        const denied = await replay(readerPage, amended.request())
        expect(denied.ok()).toBe(false)
        expect([401, 403, 422]).toContain(denied.status())
      } finally {
        await readerContext.close()
      }
      expect(await linesOf(page, subscriptionId)).toEqual(amendedLines)
      expect(await amendmentsOf(page, subscriptionId)).toHaveLength(
        amendments.length,
      )

      // --- cancel (no posted invoice, so no credit note) --------------------
      const cancelAction = await openSubscriptionAction(
        page,
        subscriptionId,
        "cancel-sub",
      )
      await cancelAction.click()
      await expect(
        page.getByTestId("form-modal-cancel-subscription"),
      ).toBeVisible({ timeout: 15_000 })
      const creditNote = page.getByTestId("form-field-createCreditNote")
      if ((await creditNote.getAttribute("aria-checked")) === "true") {
        await creditNote.click()
      }
      await fillField(page, "notes", "COV-12 lifecycle cancel")
      const [cancelled] = await Promise.all([
        page.waitForResponse(
          (response) =>
            matchesOperationResponse(response, "cancel_subscription"),
          { timeout: 45_000 },
        ),
        submitForm(page, "cancel-subscription"),
      ])
      expect(cancelled.ok(), await cancelled.text()).toBe(true)
      await expect
        .poll(() => subscriptionSnapshot(page, subscriptionId))
        .toMatchObject({ state: "closed" })
      const closedEffect = await subscriptionSnapshot(page, subscriptionId)
      const afterCancel = await amendmentsOf(page, subscriptionId)
      expect(afterCancel).toHaveLength(amendments.length + 1)
      const cancelRow = afterCancel.find(
        (row) => !amendments.some((old) => old.id === row.id),
      )!
      expect(String(field(cancelRow, "amendmentType", "amendment_type"))).toBe(
        "cancel",
      )
      expect(await linesOf(page, subscriptionId)).toEqual(amendedLines)

      // Cancelling twice is rejected and preserves the closed record.
      const staleCancel = await replay(page, cancelled.request())
      expect(staleCancel.ok()).toBe(false)
      expect(await subscriptionSnapshot(page, subscriptionId)).toEqual(
        closedEffect,
      )
      expect(await amendmentsOf(page, subscriptionId)).toHaveLength(
        afterCancel.length,
      )
    })

    test("amendment proration posts one exact adjustment move", async ({ page }) => {
      test.setTimeout(300_000)
      const billed = await provisionBilledSubscription(page, "cov12-pr")
      const { subscriptionId, lines } = billed
      const before = await rows(page, "account-moves")
      const amendAction = await openSubscriptionAction(page, subscriptionId, "amend-sub")
      await amendAction.click()
      await expect(page.getByTestId("form-modal-amend-subscription")).toBeVisible({
        timeout: 15_000,
      })
      await page.getByTestId("form-field-amendmentType").click()
      await page
        .locator('[role="listbox"]:visible')
        .getByRole("option", { name: "Quantity", exact: true })
        .click()
      await chooseFirstEnabledOption(page, "lineId")
      await fillField(page, "newQuantity", String(lines[0]!.quantity + 3))
      const prorate = page.getByTestId("form-field-prorate")
      if ((await prorate.getAttribute("aria-checked")) !== "true") await prorate.click()
      await chooseSelectOptionByLabel(page, "journalId", billed.journalLabel)
      await chooseSelectOptionByLabel(page, "incomeAccountId", billed.incomeLabel)
      await chooseSelectOptionByLabel(page, "receivableAccountId", billed.receivableLabel)
      const [amended] = await Promise.all([
        page.waitForResponse(
          (response) => matchesOperationResponse(response, "amend_subscription"),
          { timeout: 45_000 },
        ),
        submitForm(page, "amend-subscription"),
      ])
      expect(amended.ok(), await amended.text()).toBe(true)
      const amendment = (await amendmentsOf(page, subscriptionId)).find(
        (row) => String(field(row, "amendmentType", "amendment_type")) === "quantity",
      )
      if (!amendment) throw new Error("amendment not found")
      const prorationMoveId = scalarQueryId(field(amendment, "prorationMoveId", "proration_move_id"))
      expect(prorationMoveId).not.toBeNull()
      expect(Number(field(amendment, "prorationAmount", "proration_amount"))).toBeGreaterThan(0)
      const after = await rows(page, "account-moves")
      expect(after).toHaveLength(before.length + 1)
      const adjustment = after.find((row) => scalarQueryId(row.id) === prorationMoveId)
      expect(adjustment).toBeTruthy()
      const snapshot = await subscriptionSnapshot(page, subscriptionId)
      expect(scalarQueryId(field(adjustment!, "companyId", "company_id"))).toBe(snapshot.companyId)
      expect(scalarQueryId(field(adjustment!, "organizationId", "organization_id"))).toBe(
        snapshot.organizationId,
      )
      expect(await linesOf(page, subscriptionId)).toEqual(
        lines.map((line) => ({ ...line, quantity: line.quantity + 3 })),
      )
      await cancelThroughUi(page, subscriptionId, false)
    })

    test("cancel after payment issues exactly one credit note for the paid invoice", async ({
      page,
    }) => {
      test.setTimeout(300_000)
      const billed = await provisionBilledSubscription(page, "cov12-cn")
      const { subscriptionId, invoiceMoveId } = billed

      const payAction = await openSubscriptionAction(page, subscriptionId, "pay-inv")
      await payAction.click()
      await expect(page.getByTestId("form-modal-pay-subscription-invoice")).toBeVisible({
        timeout: 15_000,
      })
      const invoiceRow = (await rows(page, "account-moves")).find(
        (row) => scalarQueryId(row.id) === invoiceMoveId,
      )
      const ref = String(invoiceRow?.ref ?? invoiceRow?.name ?? "").trim()
      const invoiceLabel = `${ref || `Move #${invoiceMoveId}`} (OutInvoice)`
      await chooseSelectOptionByLabel(page, "invoiceMoveId", invoiceLabel)
      await chooseSelectOptionByLabel(page, "paymentJournalId", await labelByCode(page, "account-journals", "BNK"))
      await chooseSelectOptionByLabel(page, "bankAccountId", await labelByCode(page, "account-accounts", "1200"))
      await chooseSelectOptionByLabel(page, "receivableAccountId", billed.receivableLabel)
      await chooseSelectOptionByLabel(page, "cogsAccountId", await labelByCode(page, "account-accounts", "5000"))
      await chooseSelectOptionByLabel(page, "inventoryAccountId", await labelByCode(page, "account-accounts", "1400"))
      const [paid] = await Promise.all([
        page.waitForResponse(
          (response) => matchesOperationResponse(response, "pay_subscription_invoice"),
          { timeout: 45_000 },
        ),
        submitForm(page, "pay-subscription-invoice"),
      ])
      expect(paid.ok(), await paid.text()).toBe(true)
      await expect
        .poll(async () => {
          const row = (await rows(page, "account-moves")).find(
            (candidate) => scalarQueryId(candidate.id) === invoiceMoveId,
          )
          return tagged(row?.state)
        })
        .toBe("Posted")

      const refundsBefore = (await rows(page, "account-moves")).filter(
        (row) => tagged(field(row, "moveType", "move_type")) === "OutRefund",
      ).length
      await cancelThroughUi(page, subscriptionId, true, invoiceMoveId)
      const cancelRow = (await amendmentsOf(page, subscriptionId)).find(
        (row) => String(field(row, "amendmentType", "amendment_type")) === "cancel",
      )
      if (!cancelRow) throw new Error("cancel amendment not found")
      const creditNoteId = scalarQueryId(field(cancelRow, "creditNoteMoveId", "credit_note_move_id"))
      expect(creditNoteId).not.toBeNull()
      const after = await rows(page, "account-moves")
      expect(
        after.filter((row) => tagged(field(row, "moveType", "move_type")) === "OutRefund"),
      ).toHaveLength(refundsBefore + 1)
      const refund = after.find((row) => scalarQueryId(row.id) === creditNoteId)
      expect(tagged(field(refund ?? {}, "moveType", "move_type"))).toBe("OutRefund")
      expect(scalarQueryId(field(refund!, "companyId", "company_id"))).toBe(
        (await subscriptionSnapshot(page, subscriptionId)).companyId,
      )
    })
  },
)
