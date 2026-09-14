import { expect, test, type Page } from "@playwright/test"

import {
  createAiActionDraftTask,
  expectNoAppError,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  fillField,
  smokeName,
  submitForm,
  waitForBffQueryMinRows,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"
import {
  createTransaction,
  enumTag,
  fetchPartnerId,
  fetchPrimaryWallet,
  field,
  idOf,
  waitForRow,
} from "./payment-fixtures"
import {
  CAPABILITIES,
  CAPABILITY_PENDING,
  auditCount,
  browserPost,
  callRaw,
  callRawOk,
  expectKnownDefect,
  loseNextResponse,
  none,
  openActorPages,
  openOwnerPages,
  pendingContract,
  pollRow,
  pretenantTags,
  provisionActor,
  queryRows,
  requireCapability,
  seededRng,
  some,
} from "./pretenant-support"

/**
 * IDEMPOTENCY / STALE STATE certification under mobile-network conditions: seeded latency,
 * committed-but-lost responses, offline windows, reconnect, resume into stale state, and
 * responsive reachability. Uses browser-originated requests so route interception and offline
 * emulation apply.
 */

const POST_PAYMENT = "/api/compat/reducer/post_payment_transaction"
const LATENCY_SEED = 20_260_912

async function draftPayment(page: Page, marker: string): Promise<{ organizationId: number; transactionId: number }> {
  const organizationId = await fetchSessionOrganizationId(page)
  const wallet = await fetchPrimaryWallet(page)
  const reference = smokeName(marker)
  const transactionId = await createTransaction(page, organizationId, {
    companyId: wallet.companyId,
    paymentAccountId: wallet.id,
    partnerId: await fetchPartnerId(page, "Acme Corporation", "customer"),
    partnerType: "Customer",
    direction: "Inbound",
    currencyId: wallet.currencyId,
    reference,
    grossMinor: 3_100,
    settlementMinor: 3_100,
    netMinor: 3_100,
    marker: reference,
  })
  return { organizationId, transactionId }
}

async function ledgerPaymentId(page: Page, transactionId: number): Promise<number | null> {
  const row = await waitForRow(
    page,
    "payment-transactions",
    (candidate) => idOf(field(candidate, "id")) === transactionId && enumTag(field(candidate, "status")).toLowerCase() === "posted",
    `posted transaction ${transactionId}`,
  )
  return idOf(field(row, "accountPaymentId", "account_payment_id"))
}

async function pendingBatch(ownerPage: Page, marker: string): Promise<{ organizationId: number; batchId: number }> {
  const organizationId = await fetchSessionOrganizationId(ownerPage)
  const companyId = await fetchDefaultCompanyId(ownerPage)
  await callRawOk(ownerPage, "create_message_template", [
    organizationId,
    {
      company_id: none,
      key: `${marker}-template`,
      name: marker,
      locale: "en",
      subject: some(`Mobile ${marker}`),
      body_template: "Hello {{customer_name}}, invoice {{invoice_number}} is due.",
      allowed_variables: ["customer_name", "invoice_number"],
      applicable_channels: [{ sms: [] }],
      retention_classification: "operational",
      metadata: some(marker),
    },
  ])
  const template = await pollRow(ownerPage, "message-templates", (row) => String(field(row, "subject") ?? "").includes(marker), marker)
  const templateId = idOf(field(template, "id"))
  await callRawOk(ownerPage, "create_message_batch", [
    organizationId,
    {
      company_id: some(companyId),
      template_id: templateId,
      channel: { sms: [] },
      subject_model: "contact",
      subject_query: some(marker),
      candidate_contact_ids: [],
      metadata: some(marker),
    },
  ])
  const batch = await pollRow(ownerPage, "message-batches", (row) => idOf(field(row, "templateId", "template_id")) === templateId, `batch ${marker}`)
  const batchId = idOf(field(batch, "id"))
  if (batchId == null) throw new Error("batch has no id")
  return { organizationId, batchId }
}

test.describe("Pre-tenant mobile and network resilience", { tag: pretenantTags("@mobile", "@dev-fixture") }, () => {
  test("M-01 seeded 150-400ms latency with triple tap posts one payment", async ({ page }) => {
    test.setTimeout(120_000)
    const { organizationId, transactionId } = await draftPayment(page, "pt-m01")
    const rng = seededRng(LATENCY_SEED)
    await page.goto("/accounting")
    await page.route((url) => url.pathname === POST_PAYMENT, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 150 + Math.floor(rng() * 250)))
      await route.continue()
    })
    const taps = await Promise.all(
      [0, 1, 2].map(async (index) => {
        await page.waitForTimeout(index * 25)
        return browserPost(page, POST_PAYMENT, [organizationId, transactionId])
      }),
    )
    expect(taps.some((tap) => tap.status === 200), `seed=${LATENCY_SEED} ${JSON.stringify(taps)}`).toBe(true)
    const paymentId = await ledgerPaymentId(page, transactionId)
    await expect.poll(() => auditCount(page, "payment_transaction", transactionId, "POST")).toBe(1)
    await page.reload()
    expect(await ledgerPaymentId(page, transactionId)).toBe(paymentId)
  })

  test("M-02 committed post with lost response, offline window, then retry has one effect", async ({ page, context }) => {
    test.setTimeout(120_000)
    const { organizationId, transactionId } = await draftPayment(page, "pt-m02")
    await page.goto("/accounting")
    const loss = await loseNextResponse(page, POST_PAYMENT)
    expect((await browserPost(page, POST_PAYMENT, [organizationId, transactionId])).status).toBe("network-error")
    expect(loss.lost()).toBe(true)

    await context.setOffline(true)
    expect((await browserPost(page, POST_PAYMENT, [organizationId, transactionId])).status).toBe("network-error")
    await context.setOffline(false)

    const retry = await browserPost(page, POST_PAYMENT, [organizationId, transactionId])
    expect(await ledgerPaymentId(page, transactionId)).toBeGreaterThan(0)
    await expect.poll(() => auditCount(page, "payment_transaction", transactionId, "POST")).toBe(1)

    await expectKnownDefect("PAY-03", "post retry after a lost committed response returns an error", () => {
      expect(retry.status).toBe(200)
    })
  })

  test("M-03 approval with lost response then retry approves once", async ({ page, browser }) => {
    test.setTimeout(180_000)
    const approver = await provisionActor(page, "m03-approver", ["message_batch:approve"])
    const { organizationId, batchId } = await pendingBatch(page, smokeName("pt-m03"))
    const session = await openActorPages(browser, [approver])
    let retry: { status: number | "network-error" }
    try {
      const approverPage = session.pages[0]
      await approverPage.goto("/messages")
      const url = "/api/compat/reducer/review_message_batch"
      const args = [organizationId, batchId, { approved: true, reason: some("mobile approval") }]
      const loss = await loseNextResponse(approverPage, url)
      expect((await browserPost(approverPage, url, args)).status).toBe("network-error")
      expect(loss.lost()).toBe(true)
      retry = await browserPost(approverPage, url, args)
    } finally {
      await session.close()
    }
    await expect.poll(() => auditCount(page, "message_batch", batchId, "APPROVE")).toBe(1)
    await expectKnownDefect("COMM-15", "approval retry after a lost committed response returns an error", () => {
      expect(retry.status).toBe(200)
    })
  })

  test("M-04 IR draft save with lost response creates one revision", { tag: CAPABILITY_PENDING }, async ({ page }) => {
    await requireCapability(page, CAPABILITIES.presentationSavedDrafts)
    pendingContract(
      CAPABILITIES.presentationSavedDrafts,
      "M-04",
      "save N→N+1 commits but the response is lost; retry with expectedRevision=N receives an explicit stale-revision conflict, the head stays N+1 (no N+2), and local edits remain available",
    )
  })

  test("M-05 AI draft approval with lost response then retry executes once", async ({ page }) => {
    test.setTimeout(120_000)
    const taskName = smokeName("pt-m05-task")
    const draftId = await createAiActionDraftTask(page, taskName)
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)
    const url = "/api/compat/reducer/approve_ai_action_draft"
    await page.goto("/ai-action-drafts")
    const loss = await loseNextResponse(page, url)
    expect((await browserPost(page, url, [organizationId, companyId, draftId])).status).toBe("network-error")
    expect(loss.lost()).toBe(true)
    const retry = await browserPost(page, url, [organizationId, companyId, draftId])
    await expect.poll(() => auditCount(page, "ai_action_draft", draftId, "EXECUTE")).toBe(1)
    await expectKnownDefect("AG-IDEMP-01", "AI draft approval retry after a lost committed response returns an error", () => {
      expect(retry.status).toBe(200)
    })
  })

  test("M-06 resumed stale client cannot re-approve or allocate against changed state", async ({ page, browser }) => {
    test.setTimeout(180_000)
    const approverA = await provisionActor(page, "m06-approver-a", ["message_batch:approve"])
    const approverB = await provisionActor(page, "m06-approver-b", ["message_batch:approve"])
    const { organizationId, batchId } = await pendingBatch(page, smokeName("pt-m06"))
    const sessions = await openActorPages(browser, [approverA, approverB])
    try {
      const [stale, fresh] = sessions.pages
      await stale.goto("/messages")
      await fresh.goto("/messages")
      const args = [organizationId, batchId, { approved: true, reason: some("resume") }]
      expect((await callRaw(fresh, "review_message_batch", args)).ok).toBe(true)
      const resumed = await callRaw(stale, "review_message_batch", args)
      expect(resumed.ok, "resumed stale approval must be rejected").toBe(false)
      expect(resumed.error).not.toMatch(/permission denied/i)
    } finally {
      await sessions.close()
    }
    await expect.poll(() => auditCount(page, "message_batch", batchId, "APPROVE")).toBe(1)

    const { transactionId } = await draftPayment(page, "pt-m06-payment")
    const wallet = await fetchPrimaryWallet(page)
    await callRawOk(page, "post_payment_transaction", [organizationId, transactionId])
    await ledgerPaymentId(page, transactionId)
    const owners = await openOwnerPages(browser, 2)
    try {
      const [stale, fresh] = owners.pages
      await stale.goto("/accounting")
      await callRawOk(fresh, "reverse_payment_transaction", [
        organizationId,
        transactionId,
        { company_id: wallet.companyId, reason: some("resume stale"), metadata: none },
      ])
      await waitForRow(page, "payment-transactions", (row) => idOf(field(row, "id")) === transactionId && enumTag(field(row, "status")).toLowerCase() === "reversed", "reversed")
      const staleAllocation = await callRaw(stale, "allocate_payment_transaction", [
        organizationId,
        {
          idempotency_key: `pt-m06-stale-${transactionId}`,
          company_id: wallet.companyId,
          payment_transaction_id: transactionId,
          allocated_move_line_id: 1,
          allocated_amount: 1,
          currency_id: wallet.currencyId,
          write_off_amount: 0,
          write_off_account_id: none,
          metadata: none,
        },
      ])
      expect(staleAllocation.ok).toBe(false)
    } finally {
      await owners.close()
    }
    const rows = (await queryRows(page, "payment-reconciliations")).filter(
      (row) => idOf(field(row, "paymentTransactionId", "payment_transaction_id")) === transactionId,
    )
    expect(rows).toHaveLength(0)
  })

  test("M-07 client recovers after an offline window and mutations refetch", async ({ page, context }) => {
    test.setTimeout(120_000)
    const contactName = smokeName("pt-m07-contact")
    await page.goto("/crm")
    await page.getByTestId("module-tab-crm-contacts").click()
    await waitForBffQueryMinRows(page, "/api/query/contacts")

    await context.setOffline(true)
    await page.waitForTimeout(3_000)
    await context.setOffline(false)

    await page.getByTestId("module-create-crm-contacts").click()
    await expect(page.getByTestId("form-modal-new-contact")).toBeVisible()
    await fillField(page, "name", contactName)
    await fillField(page, "email", `${contactName}@example.test`)
    const [mutation, refetch] = await Promise.all([
      page.waitForResponse((res) => matchesOperationResponse(res, "create_contact") && res.ok(), { timeout: 30_000 }),
      page.waitForResponse((res) => res.url().includes("/api/query/contacts") && res.ok(), { timeout: 30_000 }),
      submitForm(page, "new-contact"),
    ])
    expect(mutation.ok()).toBe(true)
    const rows = (await refetch.json()) as { data?: Array<{ name?: unknown }> }
    expect(rows.data?.some((row) => row.name === contactName)).toBe(true)
    await expectNoAppError(page)
  })

  const WIDTHS = [320, 360, 390, 430, 768] as const
  const ROUTES = ["/accounting", "/crm", "/messages", "/approvals", "/reports"] as const

  for (const width of WIDTHS) {
    test(`M-08 primary navigation and focus remain reachable at ${width}px`, async ({ page }) => {
      test.setTimeout(120_000)
      await page.setViewportSize({ width, height: width >= 768 ? 1024 : 844 })
      for (const route of ROUTES) {
        await page.goto(route)
        await expectNoAppError(page)
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        expect.soft(overflow, `${route} horizontal overflow at ${width}px`).toBeLessThanOrEqual(1)
        const navigation = page
          .getByTestId("dashboard-sidebar")
          .or(page.getByRole("button", { name: /menu|sidebar|navigation/i }))
          .first()
        await expect.soft(navigation, `${route} navigation reachable at ${width}px`).toBeVisible()
        await page.keyboard.press("Tab")
        const focused = await page.evaluate(() => document.activeElement != null && document.activeElement !== document.body)
        expect.soft(focused, `${route} keyboard focus moves at ${width}px`).toBe(true)
      }
    })
  }
})
