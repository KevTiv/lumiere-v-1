import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { seedFirstSaleAccounting } from "./first-sale-accounting-fixture"
import { bootstrapSalesFixture, seedSalesStockFixture } from "./sales-approval-fixture"
import { create, id } from "./cov-scheduler-manufacturing-fixtures"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { readFileSync } from "node:fs"

import {
  assertMoveLinesBalanced,
  chooseSelectOptionByValue,
  fillField,
  openEntityCreate,
  openSaleOrderPage,
  chooseSelectOptionByLabel,
  fetchAccountSelectLabelByInternalType,
  fetchDraftInvoiceMoveIdForSaleOrder,
  fetchSalesInvoiceJournalLabel,
  fetchSessionOrganizationId,
  openCreateInvoiceFromOrder,
  postDraftInvoiceViaUi,
  selectModuleTab,
  submitForm,
  fetchDefaultCompanyId,
  gotoModule,
  scalarQueryId,
  scalarQueryString,
  selectEntityRowById,
  smokeName,
  waitForEntityActionEnabled,
  waitForSaleOrderConfirmed,
  waitForSaleOrderLineQtyDelivered,
} from "./helpers"
import { invoiceRecordPageHref } from "@lumiere/erp-shared/record-links"
import { createAndPostPayment, moveSnapshot, openRegisterForm, replay, rows } from "./cov08-support"
import { fetchPickingState, runPickingActionViaInventoryUi } from "./inventory-picking-fixtures"
import { postGeneratedOperation } from "./generated-operation"
import { matchesOperationFaultTarget, matchesOperationResponse } from "./operation-response"
import { loseNextResponse, openOwnerPages } from "./pretenant-support"
import {
  ORDER_SUMMARY,
  SEEDED_MOUSE_PRODUCT,
  addProductLine,
  confirmOrderViaUi,
  fetchOrderDeliveredQty,
  addLaptopLine,
  createDraftSaleOrder,
  expectOrderSummary,
  fetchOrderPickings,
  pickingActionViaUi,
  readyPickingViaUi,
  waitForFirstDelivery,
} from "./sales-order-fixtures"

/**
 * INT-08: order-to-cash adversarial certification.
 *
 * The happy path (lead → cash, with the order summary converging at every step) lives in
 * `mvp-lead-to-cash.spec.ts`; partial delivery and backorders in `mvp-partial-fulfillment.spec.ts`.
 * This spec attacks the seams: a duplicate submit, a reply lost after the server committed, a
 * stale second session, another tenant's identifiers, and refreshing at every major state.
 *
 * Covered elsewhere (not repeated here):
 *   - stock changed between view and fulfillment, duplicate validation, duplicate invoicing,
 *     duplicate opportunity conversion, cross-tenant invoicing: reducer tests in
 *     `spacetimedb/tests/sales` (run through `run_sales_backorder_test`).
 *   - duplicate / retried payment posting, overpayment: `pretenant-payment-adversarial.spec.ts`
 *     and `spacetimedb/tests/pretenant/payments_cert.rs`.
 *   - permission grant/revoke cycles: `auth-permission-enforcement.spec.ts`.
 *
 * Orders are small (1 unit) because seeded stock is shared across specs.
 */

async function saleOrderState(page: Page, orderId: number): Promise<string> {
  const res = await page.request.get("/api/query/sale-orders")
  if (!res.ok()) return ""
  const json = (await res.json()) as { data?: Array<{ id?: unknown; state?: unknown }> }
  const row = (json.data ?? []).find((candidate) => scalarQueryId(candidate.id) === orderId)
  return scalarQueryString(row?.state)
}

async function draftOrder(page: Page, label: string): Promise<number> {
  const orderId = await createDraftSaleOrder(page, smokeName(label))
  await addLaptopLine(page, orderId, "1")
  return orderId
}

async function selectOrderForConfirm(page: Page, orderId: number) {
  await gotoModule(page, "/sales", "sales")
  await selectModuleTab(page, "sales", "orders")
  await selectEntityRowById(page, orderId)
  await waitForEntityActionEnabled(page, "entity-action-confirm-orders")
}

test.describe("O2C adversarial certification", { tag: "@p0" }, () => {
  test("refreshing at every major state shows the same canonical summary", async ({ page }) => {
    test.setTimeout(300_000)
    const orderId = await draftOrder(page, "so-o2c-refresh")

    // Draft: nothing has started.
    await expectOrderSummary(page, orderId, { present: [ORDER_SUMMARY.invoice.none], reload: true })

    // Confirmed: waiting to deliver, and the same after a reload.
    await selectOrderForConfirm(page, orderId)
    await page.getByTestId("entity-action-confirm-orders").click()
    await waitForSaleOrderConfirmed(page, orderId)
    await expectOrderSummary(page, orderId, { present: [ORDER_SUMMARY.delivery.pending] })
    await expectOrderSummary(page, orderId, { present: [ORDER_SUMMARY.delivery.pending], reload: true })

    // Delivered: complete, and the same after a reload.
    const pickingId = await waitForFirstDelivery(page, orderId)
    await readyPickingViaUi(page, pickingId)
    await pickingActionViaUi(page, pickingId, "entity-action-validate-picking", "validate_stock_picking")
    await waitForSaleOrderLineQtyDelivered(page, orderId)
    const delivered = {
      present: [ORDER_SUMMARY.delivery.complete],
      absent: [ORDER_SUMMARY.delivery.pending, ORDER_SUMMARY.delivery.partial],
    }
    await expectOrderSummary(page, orderId, delivered)
    await expectOrderSummary(page, orderId, { ...delivered, reload: true })
  })

  test("a double click confirms once: one request, one delivery", async ({ page }) => {
    test.setTimeout(240_000)
    const orderId = await draftOrder(page, "so-o2c-double-click")
    await selectOrderForConfirm(page, orderId)

    let requests = 0
    await page.route(
      (url) => matchesOperationFaultTarget(url, "confirm_sales_order"),
      async (route) => {
        requests += 1
        await route.continue()
      },
    )
    await page.getByTestId("entity-action-confirm-orders").dblclick()
    await waitForSaleOrderConfirmed(page, orderId)
    // Give any second request time to surface before counting.
    await page.waitForTimeout(2_000)

    expect(requests, "confirm_sales_order requests from one double click").toBe(1)
    expect(await fetchOrderPickings(page, orderId)).toHaveLength(1)
  })

  test("a reply lost after the server committed is resolved by canonical readback and offers no retry", async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const orderId = await draftOrder(page, "so-o2c-lost-response")
    await selectOrderForConfirm(page, orderId)

    let dispatches = 0
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("confirm_sales_order")) dispatches += 1
    })
    const injected = await loseNextResponse(page, "confirm_sales_order")
    await page.getByTestId("entity-action-confirm-orders").click()

    // The response was lost, but exact order and delivery readback proves that
    // the write committed. The workflow therefore converges without presenting
    // an unknown result or offering a potentially duplicating retry.
    await waitForSaleOrderConfirmed(page, orderId)
    expect(injected.lost()).toBe(true)
    await expect(page.getByText(/Result unknown/i)).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0)
    expect(await fetchOrderPickings(page, orderId)).toHaveLength(1)

    // The list converged on the committed state, so confirm is no longer offered for the order.
    await selectEntityRowById(page, orderId)
    await expect(page.getByTestId("entity-action-confirm-orders")).toBeDisabled({ timeout: 30_000 })
  })

  test("a lost reply with unavailable canonical readback stays unknown until refresh and offers no retry", async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const orderId = await draftOrder(page, "so-o2c-lost-response")
    await selectOrderForConfirm(page, orderId)

    let dispatches = 0
    page.on("request", (request) => {
      if (request.method() === "POST" && matchesOperationFaultTarget(new URL(request.url()), "confirm_sales_order")) dispatches += 1
    })
    const injected = await loseNextResponse(page, "confirm_sales_order")
    // A lost reply alone can be resolved by exact canonical readback. Keep
    // verification unavailable too, to exercise the genuinely unknown branch.
    let holdReadback = true
    await page.route((url) => [
      "/api/query/sale-orders", "/api/query/stock-pickings", "/api/query/workflow-human-tasks-inbox",
    ].includes(url.pathname), async (route) => {
      if (holdReadback && injected.lost() && route.request().method() === "GET") {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Injected canonical readback outage" }) })
      } else await route.continue()
    })
    await page.getByTestId("entity-action-confirm-orders").click()

    // The mutation notice must never offer a resend. A collection's read-only
    // recovery action may coexist with it while canonical readback is unavailable.
    const unknownResult = page.locator("[data-sonner-toast]").filter({ hasText: /Result unknown/i }).first()
    await expect(unknownResult).toBeVisible({ timeout: 30_000 })
    expect(injected.lost()).toBe(true)
    await expect(unknownResult.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0)
    const readNotice = page.getByRole("alert").filter({ hasText: /Records could not be loaded|Some records could not be refreshed/i })
    await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/query/sale-orders"
        && response.request().method() === "GET" && response.status() === 503),
      readNotice.getByRole("button", { name: "Retry", exact: true }).click(),
    ])
    expect(dispatches, "Retrying a failed read must not resend the committed confirmation").toBe(1)
    holdReadback = false
    await page.reload({ waitUntil: "domcontentloaded" })

    // The write did commit, exactly once, and re-issuing it is not offered.
    await waitForSaleOrderConfirmed(page, orderId)
    expect(injected.lost()).toBe(true)
    await expect(page.getByText(/Result unknown/i)).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0)
    expect(await fetchOrderPickings(page, orderId)).toHaveLength(1)

    // The write committed exactly once, and re-issuing it is not offered.
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0)
    expect(dispatches).toBe(1)

    // The list converged on the committed state, so confirm is no longer offered for the order.
    await selectEntityRowById(page, orderId)
    await expect(page.getByTestId("entity-action-confirm-orders")).toBeDisabled({ timeout: 30_000 })
  })

  test("a stale second session cannot confirm an order again", async ({ page, browser }) => {
    test.setTimeout(240_000)
    const orderId = await draftOrder(page, "so-o2c-stale-session")
    const companyId = await fetchDefaultCompanyId(page)
    const input = { companyId: BigInt(companyId), orderId: BigInt(orderId) }

    const { pages, close } = await openOwnerPages(browser, 2)
    try {
      const [first, second] = pages as [Page, Page]
      const confirmed = await postGeneratedOperation(first, "confirm_sales_order", input)
      expect(confirmed.ok, `first confirm: ${confirmed.error ?? ""}`).toBe(true)
      await waitForSaleOrderConfirmed(page, orderId)

      // The second session still believes the order is a draft.
      const stale = await postGeneratedOperation(second, "confirm_sales_order", input)
      expect(stale.ok, "a stale second confirm must be refused").toBe(false)
      expect(stale.error ?? "").not.toBe("")
    } finally {
      await close()
    }
    expect(await fetchOrderPickings(page, orderId)).toHaveLength(1)
  })

  test("replaying the exact accepted confirm request is refused and creates no second delivery", async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const orderId = await draftOrder(page, "so-o2c-replay")
    await selectOrderForConfirm(page, orderId)

    const [accepted] = await Promise.all([
      page.waitForResponse((res) => matchesOperationResponse(res, "confirm_sales_order") && res.ok(), {
        timeout: 30_000,
      }),
      page.getByTestId("entity-action-confirm-orders").click(),
    ])
    await waitForSaleOrderConfirmed(page, orderId)
    const pickingsAfterAccept = await fetchOrderPickings(page, orderId)
    expect(pickingsAfterAccept).toHaveLength(1)

    const replay = await page.request.post(new URL(accepted.url()).pathname, {
      headers: { "Content-Type": "application/json" },
      data: accepted.request().postDataJSON(),
    })
    expect(replay.ok(), "the exact accepted request must not be accepted twice").toBe(false)
    expect(await fetchOrderPickings(page, orderId)).toEqual(pickingsAfterAccept)
    expect(await saleOrderState(page, orderId)).not.toMatch(/draft/i)
  })

  test("two sessions confirming at the same moment produce one delivery", async ({ page, browser }) => {
    test.setTimeout(240_000)
    const orderId = await draftOrder(page, "so-o2c-concurrent-confirm")
    const companyId = await fetchDefaultCompanyId(page)
    const input = { companyId: BigInt(companyId), orderId: BigInt(orderId) }

    const { pages, close } = await openOwnerPages(browser, 2)
    try {
      const results = await Promise.all(pages.map((session) => postGeneratedOperation(session, "confirm_sales_order", input)))
      expect(results.filter((result) => result.ok), "exactly one confirm may win").toHaveLength(1)
    } finally {
      await close()
    }
    await waitForSaleOrderConfirmed(page, orderId)
    expect(await fetchOrderPickings(page, orderId)).toHaveLength(1)
  })

  test("another tenant's company id cannot confirm this order", async ({ page }) => {
    test.setTimeout(240_000)
    const orderId = await draftOrder(page, "so-o2c-cross-tenant")
    const companyId = await fetchDefaultCompanyId(page)

    const foreign = await postGeneratedOperation(page, "confirm_sales_order", {
      companyId: BigInt(companyId + 1_000_000),
      orderId: BigInt(orderId),
    })
    expect(foreign.ok, "a foreign company id must be refused").toBe(false)

    // Nothing changed for the real owner.
    expect(await saleOrderState(page, orderId)).toMatch(/draft/i)
    expect(await fetchOrderPickings(page, orderId)).toHaveLength(0)
  })
})

async function saleInvoiceIds(page: Page, orderId: number) {
  return (await rows(page, "account-moves"))
    .filter((row) => scalarQueryId(row.saleOrderId ?? row.sale_order_id) === orderId)
    .map((row) => scalarQueryId(row.id))
}

async function createAndPostSaleInvoice(page: Page, orderId: number) {
  await openCreateInvoiceFromOrder(page, orderId)
  await chooseSelectOptionByLabel(page, "journalId", await fetchSalesInvoiceJournalLabel(page))
  await chooseSelectOptionByLabel(page, "defaultIncomeAccountId", await fetchAccountSelectLabelByInternalType(page, "income"))
  await chooseSelectOptionByLabel(page, "receivableAccountId", await fetchAccountSelectLabelByInternalType(page, "receivable"))
  const [invoiceResponse] = await Promise.all([
    page.waitForResponse((response) => matchesOperationResponse(response, "create_invoice_from_sale_order"), { timeout: 30_000 }),
    submitForm(page, "create-invoice-from-sale-order"),
  ])
  expect(invoiceResponse.ok()).toBe(true)
  const id = await fetchDraftInvoiceMoveIdForSaleOrder(page, orderId)
  expect(await saleInvoiceIds(page, orderId)).toEqual([id])
  await postDraftInvoiceViaUi(page, id)
  await assertMoveLinesBalanced(page, id)
  return id
}

async function assertReloadedSettlement(
  page: Page,
  moveId: number,
  payment: Awaited<ReturnType<typeof createAndPostPayment>>,
) {
  await gotoModule(page, invoiceRecordPageHref(moveId))
  await expect(page.getByTestId("invoice-page")).toBeVisible()
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(page).toHaveURL((url) => url.pathname === invoiceRecordPageHref(moveId))
  await expect(page.getByTestId("invoice-page")).toBeVisible()
  const linkedPayments = (await rows(page, "account-payments")).filter((row) => {
    const invoiceIds = row.reconciledInvoiceIds ?? row.reconciled_invoice_ids
    return scalarQueryString(row.ref ?? row.ref_) === payment.reference ||
      (Array.isArray(invoiceIds) && invoiceIds.some((id) => scalarQueryId(id) === moveId))
  })
  expect(linkedPayments.map((row) => scalarQueryId(row.id))).toEqual([payment.paymentId])
  const [ledgerPayment] = linkedPayments
  const invoiceIds = ledgerPayment!.reconciledInvoiceIds ?? ledgerPayment!.reconciled_invoice_ids
  expect(Array.isArray(invoiceIds) ? invoiceIds.map(scalarQueryId) : []).toEqual([moveId])
  await expect.poll(() => moveSnapshot(page, moveId)).toEqual({ residual: 0, paymentState: "Paid", state: "Posted" })
  expect(scalarQueryString(ledgerPayment!.state)).toBe("Paid")
  expect(Number(ledgerPayment!.amount)).toBe(payment.amountTotal)
  const paymentEntryId = scalarQueryId(ledgerPayment!.moveId ?? ledgerPayment!.move_id)
  if (paymentEntryId == null) throw new Error("Posted payment has no ledger move ID")
  expect(paymentEntryId).not.toBe(moveId)
  expect((await moveSnapshot(page, paymentEntryId)).state).toBe("Posted")
  const ledgerLines = await rows(page, "account-move-lines")
  for (const id of [moveId, paymentEntryId]) {
    await assertMoveLinesBalanced(page, id)
    const lines = ledgerLines.filter((row) => scalarQueryId(row.moveId ?? row.move_id) === id)
    expect(lines.some((row) => Number(row.debit) > 0), `Move ${id} has a debit`).toBe(true)
    expect(lines.some((row) => Number(row.credit) > 0), `Move ${id} has a credit`).toBe(true)
  }
  return paymentEntryId
}

const runRemoteFirstSale = process.env.E2E_ALPHA_FIRST_SALE === "1"
const runCiFixtureFirstSale = process.env.E2E_ALPHA_FIRST_SALE_CI_FIXTURE === "1" &&
  process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_EVENT_NAME === "pull_request"

test.describe("Alpha native first-sale rehearsal", { tag: "@p0" }, () => {
  test.skip(!runRemoteFirstSale && !runCiFixtureFirstSale, "Requires the disposable PR fixture or an explicitly selected isolated stack")
  // A failed checkpoint can follow a committed write. Never rerun the whole journey automatically.
  test.describe.configure({ retries: 0 })

  test("native quotation reaches one delivered and settled sale despite an interrupted payment reply", async ({ page }, testInfo) => {
    test.setTimeout(360_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const companies = await rows(page, "companies")
    let companyId: number
    if (runRemoteFirstSale) {
      const { E2E_ALPHA_FIRST_SALE_ISOLATED_ACK, E2E_ALPHA_FIRST_SALE_ORG_ID, E2E_ALPHA_FIRST_SALE_COMPANY_ID } = process.env
      expect(E2E_ALPHA_FIRST_SALE_ISOLATED_ACK, "Acknowledge the isolated fixture before any writes").toBe("1")
      expect(process.env.PLAYWRIGHT_BASE_URL, "Target an already-running dedicated fixture stack").toMatch(/^https?:\/\//)
      expect(process.env.E2E_TEST_EMAIL, "Use explicit rehearsal credentials").toBeTruthy()
      expect(Boolean(process.env.E2E_TEST_PASSWORD), "Use explicit rehearsal credentials").toBe(true)
      expect(E2E_ALPHA_FIRST_SALE_ORG_ID).toMatch(/^[1-9][0-9]*$/)
      expect(E2E_ALPHA_FIRST_SALE_COMPANY_ID).toMatch(/^[1-9][0-9]*$/)
      expect(String(organizationId), "Signed-in fixture organization").toBe(E2E_ALPHA_FIRST_SALE_ORG_ID)
      companyId = await fetchDefaultCompanyId(page)
      expect(String(companyId), "Signed-in fixture company").toBe(E2E_ALPHA_FIRST_SALE_COMPANY_ID)
      expect(companies.map((row) => scalarQueryId(row.id)), "The session can see exactly one fixture company").toEqual([companyId])
    } else {
      for (const url of [process.env.PLAYWRIGHT_BASE_URL, process.env.LUMIERE_API_SERVER_URL, process.env.STDB_HOST]) {
        expect(url, "The PR rehearsal uses only the runner's loopback services").toMatch(/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/)
      }
      expect(process.env.STDB_MODULE).toBe("lumiere-v1-local-e2e")
      const { company: fixtureCompany } = JSON.parse(
        readFileSync(new URL("../../fixtures/first-org-fixture.v1.json", import.meta.url), "utf8"),
      ) as { company: { name: string; code: string } }
      const seeded = companies.filter((row) =>
        row.name === fixtureCompany.name && row.code === fixtureCompany.code &&
        scalarQueryId(row.organizationId ?? row.organization_id) === organizationId)
      expect(seeded, "The signed-in seed organization has one canonical operating company").toHaveLength(1)
      const id = scalarQueryId(seeded[0]?.id)
      if (id == null) throw new Error("The seeded operating company has no canonical ID")
      companyId = id
      await page.addInitScript(({ organizationId, companyId }) => {
        localStorage.setItem("lumiere:active-company", JSON.stringify({ organizationId, companyId }))
      }, { organizationId, companyId })
    }

    const clientRef = smokeName("alpha-first-sale")
    const orderId = await test.step("Save a native quotation and confirm the same order", async () => {
      const id = await createDraftSaleOrder(page, clientRef)
      expect(await saleOrderState(page, id)).toMatch(/^draft$/i)
      const order = (await rows(page, "sale-orders")).find((row) => scalarQueryId(row.id) === id)
      expect(scalarQueryId(order?.companyId ?? order?.company_id)).toBe(companyId)
      await addProductLine(page, id, SEEDED_MOUSE_PRODUCT, "1")
      await confirmOrderViaUi(page, id)
      return id
    })

    const pickingId = await test.step("Process exactly one order-linked delivery in Warehouse", async () => {
      const id = await waitForFirstDelivery(page, orderId)
      expect(await fetchOrderPickings(page, orderId, companyId)).toHaveLength(1)
      await runPickingActionViaInventoryUi(page, id, "confirm")
      await runPickingActionViaInventoryUi(page, id, "assign")
      await runPickingActionViaInventoryUi(page, id, "validate")
      await expect.poll(() => fetchPickingState(page, id), { timeout: 30_000 }).toBe("done")
      await expect.poll(() => fetchOrderDeliveredQty(page, orderId), { timeout: 30_000 }).toBe(1)
      return id
    })

    const moveId = await test.step("Create and post the sale's single linked invoice", () =>
      createAndPostSaleInvoice(page, orderId))

    const payment = await test.step("Settle the invoice after losing the successful payment reply", async () => {
      const paid = await createAndPostPayment(page, moveId)
      expect(paid.amountTotal).toBeGreaterThan(0)
      expect(await moveSnapshot(page, moveId)).toEqual({ residual: paid.amountTotal, paymentState: "NotPaid", state: "Posted" })
      await openRegisterForm(page, paid.paymentId, moveId)
      const operation = "register_payment_on_invoice"
      let dispatches = 0
      page.on("request", (request) => {
        if (request.method() === "POST" && matchesOperationFaultTarget(new URL(request.url()), operation)) {
          dispatches += 1
        }
      })
      const injected = await loseNextResponse(page, operation)
      await submitForm(page, "register-payment-invoices")
      await expect.poll(injected.lost).toBe(true)
      await expect.poll(() => moveSnapshot(page, moveId), { timeout: 30_000 })
        .toEqual({ residual: 0, paymentState: "Paid", state: "Posted" })
      await expect(page.getByText(/Result unknown/i)).toHaveCount(0)
      await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0)
      expect(dispatches).toBe(1)
      return paid
    })

    const paymentMoveId = await test.step("Reload the owner views and verify the same stock and accounting effects", async () => {
      expect((await replay(page, payment.createResponse)).ok(), "Identical create-payment replay converges").toBe(true)
      await expectOrderSummary(page, orderId, {
        present: [ORDER_SUMMARY.delivery.complete, ORDER_SUMMARY.invoice.posted, ORDER_SUMMARY.payment.paid],
        absent: [ORDER_SUMMARY.delivery.partial, ORDER_SUMMARY.payment.partial, ORDER_SUMMARY.payment.unpaid],
        reload: true,
      })
      expect(await saleInvoiceIds(page, orderId)).toEqual([moveId])
      expect((await fetchOrderPickings(page, orderId, companyId)).map((row) => row.id)).toEqual([pickingId])
      expect(await fetchOrderDeliveredQty(page, orderId)).toBe(1)
      return assertReloadedSettlement(page, moveId, payment)
    })

    await testInfo.attach("alpha-first-sale-readback.json", {
      contentType: "application/json",
      body: JSON.stringify({ organizationId, companyId, clientRef, orderId, pickingId, moveId, paymentId: payment.paymentId, paymentMoveId, delivered: 1, residual: 0 }),
    })
  })
})

test.describe("Alpha cold-start delivered sale", { tag: ["@p0", "@unauthenticated"] }, () => {
  test.skip(!runCiFixtureFirstSale, "Requires the disposable PR fixture")
  test.describe.configure({ retries: 0 })

  test("authors, delivers, invoices and settles the first sale", async ({ page }, testInfo) => {
    test.setTimeout(480_000)
    for (const url of [process.env.PLAYWRIGHT_BASE_URL, process.env.LUMIERE_API_SERVER_URL, process.env.STDB_HOST]) {
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/)
    }
    expect(process.env.STDB_MODULE).toBe("lumiere-v1-local-e2e")

    const fixtureName = smokeName("first-delivery")
    const { organizationId, companyId, currencyId } = await bootstrapSalesFixture(page, fixtureName)
    for (const resource of ["sale-orders", "sale-order-lines", "pricelists", "contacts", "stock-pickings", "stock-locations", "account-moves", "account-payments"]) {
      expect(await rows(page, resource), `new tenant starts with no ${resource}`).toEqual([])
    }
    const { warehouse, product } = await seedSalesStockFixture(page, fixtureName, organizationId, companyId)
    const customerName = smokeName("first-customer")
    const customer = await create(page, "contacts", "create_contact", {
      params: stdbParamsToJson({
        name: customerName, type: "contact", companyId, isCustomer: true, isVendor: false,
        isEmployee: false, isProspect: false, isPartner: false, customerRank: 1, supplierRank: 0,
      }, "CreateContactParams"),
    }, (row) => row.name === customerName && scalarQueryId(row.companyId ?? row.company_id) === companyId)

    // Keep the first quotation open across native setup in a second tab.
    await openEntityCreate(page, "/sales?tab=orders", "sales", "orders", "new-sale-order")
    const reference = smokeName("first-quotation")
    await fillField(page, "clientOrderRef", reference)
    await chooseSelectOptionByValue(page, "partnerId", id(customer))
    await chooseSelectOptionByValue(page, "warehouseId", id(warehouse))
    const openPriceLists = page.getByRole("link", { name: "Open price lists (opens in a new tab)", exact: true })
    await expect(openPriceLists).toBeVisible()
    const [priceSetup] = await Promise.all([
      page.waitForEvent("popup"),
      openPriceLists.click(),
    ])
    await priceSetup.waitForURL((url) => url.pathname === "/sales" && url.searchParams.get("tab") === "pricelists")
    await priceSetup.getByTestId("module-create-sales-pricelists").click()
    await expect(priceSetup.getByTestId("form-modal-new-pricelist")).toBeVisible()
    const pricelistName = smokeName("first-price-list")
    await fillField(priceSetup, "name", pricelistName)
    await chooseSelectOptionByValue(priceSetup, "currencyId", currencyId)
    await Promise.all([
      priceSetup.waitForResponse((response) => matchesOperationResponse(response, "create_pricelist") && response.ok()),
      submitForm(priceSetup, "new-pricelist"),
    ])
    await priceSetup.close()
    const [pricelist] = (await rows(page, "pricelists")).filter((row) => row.name === pricelistName)
    if (!pricelist) throw new Error("Price list did not persist")
    const refreshPriceLists = page.getByRole("button", { name: "Refresh price lists", exact: true })
    if (await refreshPriceLists.isVisible()) await refreshPriceLists.click()
    await expect(page.getByTestId("form-field-clientOrderRef")).toHaveValue(reference)
    await chooseSelectOptionByValue(page, "pricelistId", id(pricelist))
    await submitForm(page, "new-sale-order")
    await expect(page).toHaveURL(/\/sales\/orders\/\d+\?tab=lines&created=1$/)
    const [order] = (await rows(page, "sale-orders")).filter((row) => row.clientOrderRef === reference)
    if (!order) throw new Error("Quotation did not persist")
    const orderId = id(order)
    const quotation = await page.request.get(`/api/authoritative/sale-orders/${orderId}`, {
      params: { companyId },
    })
    await expect(quotation).toBeOK()
    const { data: savedQuotation } = (await quotation.json()) as { data: { pricelistId?: unknown } }
    expect(scalarQueryId(savedQuotation.pricelistId)).toBe(id(pricelist))
    expect(await saleOrderState(page, orderId)).toMatch(/^draft$/i)
    expect(await fetchOrderPickings(page, orderId, companyId)).toEqual([])

    await addProductLine(page, orderId, String(product.name), "1")
    await openSaleOrderPage(page, orderId)
    const setup = page.getByTestId("sale-order-destination-setup")
    await expect(setup).toBeVisible()
    const [locationSetup] = await Promise.all([
      page.waitForEvent("popup"),
      setup.getByRole("link", { name: "Open warehouse locations", exact: true }).click(),
    ])
    await locationSetup.waitForURL((url) => url.pathname === "/warehouse" && url.searchParams.get("tab") === "locations")
    await locationSetup.getByTestId("module-create-warehouse-locations").click()
    await expect(locationSetup.getByTestId("form-modal-new-stock-location")).toBeVisible()
    const destinationName = smokeName("first-customer-location")
    await fillField(locationSetup, "name", destinationName)
    await chooseSelectOptionByValue(locationSetup, "usage", "customer")
    await Promise.all([
      locationSetup.waitForResponse((response) => matchesOperationResponse(response, "create_company_stock_location") && response.ok()),
      submitForm(locationSetup, "new-stock-location"),
    ])
    await locationSetup.close()
    const checkDestination = setup.getByRole("button", { name: "Check destination again", exact: true })
    if (await checkDestination.isVisible()) await checkDestination.click()
    await expect(setup).toBeHidden()
    const destinations = (await rows(page, `stock-locations?companyId=${companyId}`))
      .filter((row) => row.name === destinationName && row.usage === "customer")
    expect(destinations).toHaveLength(1)

    await confirmOrderViaUi(page, orderId)
    const pickingId = await waitForFirstDelivery(page, orderId)
    for (const action of ["confirm", "assign", "validate"] as const) {
      await runPickingActionViaInventoryUi(page, pickingId, action)
    }
    await expect.poll(() => fetchPickingState(page, pickingId)).toBe("done")
    await expect.poll(() => fetchOrderDeliveredQty(page, orderId)).toBe(1)
    expect((await fetchOrderPickings(page, orderId, companyId)).map((row) => row.id)).toEqual([pickingId])
    const picking = (await rows(page, `stock-pickings?companyId=${companyId}`)).find((row) => id(row) === pickingId)
    expect(scalarQueryId(picking?.locationDestId ?? picking?.location_dest_id)).toBe(id(destinations[0]!))
    const moveId = await test.step("Provision the cold ledger and post the exact delivered order's invoice", async () => {
      await seedFirstSaleAccounting(page, companyId, currencyId)
      return createAndPostSaleInvoice(page, orderId)
    })
    const payment = await test.step("Register the posted customer receipt against that invoice", async () => {
      const paid = await createAndPostPayment(page, moveId)
      expect(paid.amountTotal).toBeGreaterThan(0)
      expect(await moveSnapshot(page, moveId)).toEqual({ residual: paid.amountTotal, paymentState: "NotPaid", state: "Posted" })
      await openRegisterForm(page, paid.paymentId, moveId)
      await Promise.all([
        page.waitForResponse((response) => matchesOperationResponse(response, "register_payment_on_invoice") && response.ok()),
        submitForm(page, "register-payment-invoices"),
      ])
      await expect.poll(() => moveSnapshot(page, moveId)).toEqual({ residual: 0, paymentState: "Paid", state: "Posted" })
      return paid
    })
    const paymentMoveId = await test.step("Reload and prove a single settled sale with balanced journal lines", async () => {
      await expectOrderSummary(page, orderId, {
        present: [ORDER_SUMMARY.delivery.complete, ORDER_SUMMARY.invoice.posted, ORDER_SUMMARY.payment.paid],
        reload: true,
      })
      expect(await saleInvoiceIds(page, orderId)).toEqual([moveId])
      return assertReloadedSettlement(page, moveId, payment)
    })
    await testInfo.attach("alpha-cold-sale-readback.json", {
      contentType: "application/json",
      body: JSON.stringify({ organizationId, companyId, orderId, pickingId, moveId, paymentId: payment.paymentId, paymentMoveId, delivered: 1, residual: 0 }),
    })
  })
})
