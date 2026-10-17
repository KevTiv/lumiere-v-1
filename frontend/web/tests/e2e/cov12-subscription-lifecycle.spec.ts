import { expect, test, type Page, type Request } from "@playwright/test"

import {
  addLaptopLine,
  createDraftSaleOrder,
} from "./sales-order-fixtures"
import {
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  fetchSaleOrderSelectLabel,
  waitForEntityActionEnabled,
  waitForSaleOrderConfirmed,
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
  await gotoModule(page, "/subscriptions", "subscriptions")
  await selectModuleTab(page, "subscriptions", "subscriptions")
  await selectEntityRowById(page, subscriptionId)
  const action = page.getByTestId(`entity-action-${actionId}`)
  await expect(action).toBeEnabled()
  return action
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
      await gotoModule(page, "/sales", "sales")
      await page.getByTestId("module-tab-sales-orders").click()
      await selectEntityRowById(page, saleOrderId)
      await waitForEntityActionEnabled(page, "entity-action-confirm-orders")
      await page.getByTestId("entity-action-confirm-orders").click()
      await waitForSaleOrderConfirmed(page, saleOrderId)
      const saleOrderLabel = await fetchSaleOrderSelectLabel(page, saleOrderId)

      await gotoModule(page, "/subscriptions", "subscriptions")
      await selectModuleTab(page, "subscriptions", "subscriptions")

      // --- create (draft) through the operator form -----------------------
      const code = smokeName("cov12-life").toUpperCase().slice(0, 40)
      await page.getByTestId("module-create-subscriptions-subscriptions").click()
      await expect(
        page.getByTestId("form-modal-new-subscription"),
      ).toBeVisible({ timeout: 15_000 })
      await chooseSelectOptionByLabel(page, "saleOrderId", saleOrderLabel)
      await chooseFirstEnabledOption(page, "planId")
      await fillField(page, "code", code)
      await fillField(page, "dateStart", isoDate(0))
      const [created] = await Promise.all([
        page.waitForResponse(
          (response) =>
            matchesOperationResponse(
              response,
              "create_subscription_from_sale_order",
            ),
          { timeout: 45_000 },
        ),
        submitForm(page, "new-subscription"),
      ])
      expect(created.ok(), await created.text()).toBe(true)

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
      const [activated] = await Promise.all([
        page.waitForResponse(
          (response) =>
            matchesOperationResponse(response, "activate_subscription"),
          { timeout: 45_000 },
        ),
        activate.click(),
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
  },
)
