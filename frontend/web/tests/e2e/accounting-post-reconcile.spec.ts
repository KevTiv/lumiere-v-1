import { matchesOperationResponse } from "./operation-response"
import { expect, test, type Page, type Request } from "@playwright/test"

import { createAndPostInvoice, rows } from "./cov08-support"
import {
  chooseSelectOptionByLabel,
  fillField,
  gotoModule,
  openEntityCreate,
  submitForm,
  scalarQueryId,
  signIn,
  smokeName,
  waitForMovePosted,
} from "./helpers"

const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

async function replayOperationAs(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

async function fetchMoveSnapshots(page: Page, ids: readonly number[]) {
  const res = await page.request.get("/api/query/account-moves")
  if (!res.ok()) throw new Error(`account-moves query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Array<Record<string, unknown>> }
  return ids.map((id) => {
    const row = (json.data ?? []).find((candidate) => scalarQueryId(candidate.id) === id)
    if (!row) throw new Error(`account move not found: ${id}`)
    return {
      id,
      amountResidual: Number(row.amountResidual ?? row.amount_residual),
      paymentState: row.paymentState ?? row.payment_state,
      state: row.state,
    }
  })
}

/**
 * ACC-003: journal entry create -> post -> reconcile against a posted invoice.
 *
 * Backend: `post_account_move` (spacetimedb/src/accounting/journal_entries.rs) for the
 * plain journal entry post; `reconcile_payment_with_invoice` for the reconcile step, which
 * matches receivable/payable lines by `account_internal_type` between two POSTED moves.
 *
 * Setup (invoice + the entry's own balanced lines) goes through the reducer BFF directly —
 * matching the pattern already used in auth-permission-enforcement.spec.ts — so the UI
 * interaction under test stays focused on posting the journal entry and running the
 * reconcile flow, not on re-proving generic invoice-line-entry forms.
 */

async function fetchJournalIdByCode(page: Page, code: string): Promise<number> {
  const res = await page.request.get("/api/query/account-journals")
  if (!res.ok()) throw new Error(`account-journals query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Array<{ id?: unknown; code?: string }> }
  const row = (json.data ?? []).find((j) => String(j.code ?? "").toUpperCase() === code.toUpperCase())
  const id = scalarQueryId(row?.id)
  if (id == null) throw new Error(`journal not found: ${code}`)
  return id
}

/** Matches by embedded metadata.ref, not the `ref` column — it isn't projected by the query API. */
async function fetchDraftMoveIdByRef(page: Page, ref: string): Promise<number> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/account-moves")
    if (res.ok()) {
      const json = (await res.json()) as { data?: Array<{ id?: unknown; metadata?: string }> }
      const row = (json.data ?? []).find((m) => {
        if (typeof m.metadata !== "string") return false
        try {
          return (JSON.parse(m.metadata) as { ref?: string }).ref === ref
        } catch {
          return false
        }
      })
      const id = scalarQueryId(row?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`draft account move not found for ref: ${ref}`)
}

/**
 * The reconcile dropdowns label options by `move.name` (posting auto-generates a
 * sequence like "MISC/2026/0001") — the custom `ref` this spec sets is not projected
 * by the query API, so option matching must key off the real posted name instead.
 */
async function fetchMoveNameById(page: Page, moveId: number): Promise<string> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/account-moves")
    if (res.ok()) {
      const json = (await res.json()) as { data?: Array<{ id?: unknown; name?: string }> }
      const row = (json.data ?? []).find((m) => scalarQueryId(m.id) === moveId)
      if (row?.name) return row.name
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`account move ${moveId} has no name yet`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

test.describe("Accounting journal entry post + reconcile", { tag: "@p0" }, () => {
  test("posts a draft journal entry via UI, then reconciles it against a posted invoice", async ({
    browser,
    page,
  }) => {
    test.setTimeout(240_000)

    const amount = 90
    const entryRef = smokeName("acc003-je")

    // Operator creates and posts the customer invoice (manual invoice form, invoice document).
    const invoiceMoveId = await createAndPostInvoice(page, "acc003-inv")

    // Operator creates the draft journal entry and adds its balanced lines through the forms.
    const movesBefore = new Set((await rows(page, "account-moves")).map((row) => scalarQueryId(row.id)))
    await gotoModule(page, "/accounting", "accounting")
    // The quick action snapshots the form's lookups when it opens; let the journal lookup load.
    await page.getByTestId("module-tab-accounting-dashboard").click()
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(8_000)
    await page.getByTestId("quick-action-journal_entry").click()
    await expect(page.getByTestId("form-modal-new-journal-entry")).toBeVisible()
    await chooseSelectOptionByLabel(page, "journalId", /miscellaneous/i)
    await fillField(page, "date", new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10))
    await fillField(page, "ref", entryRef)
    await Promise.all([
      page.waitForResponse((res) => matchesOperationResponse(res, "create_account_move") && res.ok(), {
        timeout: 30_000,
      }),
      submitForm(page, "new-journal-entry"),
    ])
    let entryMoveId = 0
    await expect
      .poll(
        async () => {
          const created = (await rows(page, "account-moves")).filter(
            (row) => !movesBefore.has(scalarQueryId(row.id)),
          )
          entryMoveId = created.length === 1 ? (scalarQueryId(created[0]?.id) ?? 0) : 0
          return entryMoveId > 0
        },
        { timeout: 30_000 },
      )
      .toBe(true)

    for (const [account, label, debit, credit] of [
      [/1200/, "Bank receipt", amount, 0],
      [/1100/, "AR settlement", 0, amount],
    ] as const) {
      await openEntityCreate(page, "/accounting", "accounting", "move-lines", "add-account-move-line")
      await chooseSelectOptionByLabel(page, "moveId", new RegExp(`(^|\\D)${entryMoveId}(\\D|$)|${escapeRegExp(entryRef)}`))
      await chooseSelectOptionByLabel(page, "accountId", account)
      await fillField(page, "name", label)
      await fillField(page, "debit", String(debit))
      await fillField(page, "credit", String(credit))
      await Promise.all([
        page.waitForResponse((res) => matchesOperationResponse(res, "add_account_move_line") && res.ok(), {
          timeout: 30_000,
        }),
        submitForm(page, "add-account-move-line"),
      ])
    }

    await gotoModule(page, "/accounting", "accounting")
    await page.getByTestId("module-tab-accounting-journal-entries").click()
    // Lists are paginated newest-first; narrow to the exact entry by its unique name.
    await page.getByPlaceholder(/search entries/i).fill(entryRef)
    const entryRow = page.getByTestId(`entity-row-${entryMoveId}`)
    await expect(entryRow).toBeVisible({ timeout: 30_000 })
    await entryRow.click()

    const postButton = page.getByRole("dialog").getByRole("button", { name: /post/i })
    await expect(postButton).toBeVisible({ timeout: 15_000 })
    const [postRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "post_account_move") && res.ok(),
        { timeout: 30_000 },
      ),
      postButton.click(),
    ])
    expect(postRes.ok()).toBe(true)
    await waitForMovePosted(page, entryMoveId)

    const entryName = await fetchMoveNameById(page, entryMoveId)
    const invoiceName = await fetchMoveNameById(page, invoiceMoveId)

    // The entry detail dialog stays open after posting (no auto-close) and its
    // overlay intercepts pointer events, so the Payments tab click never lands.
    await page.keyboard.press("Escape")
    await expect(postButton).toBeHidden({ timeout: 15_000 })

    await page.getByTestId("module-tab-accounting-payments").click()
    await page.getByTestId("entity-action-pay-reconcile-moves").click()
    await expect(page.getByTestId("form-modal-reconcile-payment-invoice")).toBeVisible({
      timeout: 15_000,
    })

    await page.getByTestId("form-field-paymentMoveId").click()
    await page
      .locator('[role="listbox"]:visible')
      .getByRole("option", { name: new RegExp(escapeRegExp(entryName)) })
      .first()
      .click()

    await page.getByTestId("form-field-invoiceMoveId").click()
    await page
      .locator('[role="listbox"]:visible')
      .getByRole("option", { name: new RegExp(escapeRegExp(invoiceName)) })
      .first()
      .click()

    const [reconcileRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "reconcile_payment_with_invoice") && res.ok(),
        { timeout: 30_000 },
      ),
      page.getByTestId("form-submit-reconcile-payment-invoice").click(),
    ])
    expect(reconcileRes.ok()).toBe(true)
    await expect(page.getByTestId("form-modal-reconcile-payment-invoice")).toBeHidden({
      timeout: 15_000,
    })

    // account-move-lines doesn't project amountResidual/isMatching (see
    // resource_registry.json's default_restricted for that resource) — but
    // account-moves does project amountResidual and paymentState, so assert
    // reconciliation at the move level instead of the line level.
    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/query/account-moves")
          if (!res.ok()) return null
          const json = (await res.json()) as {
            data?: Array<{ id?: unknown; amountResidual?: unknown; paymentState?: unknown }>
          }
          const move = (json.data ?? []).find((m) => scalarQueryId(m.id) === invoiceMoveId)
          if (!move) return null
          const paymentStateTag =
            move.paymentState && typeof move.paymentState === "object"
              ? (move.paymentState as { tag?: string }).tag
              : move.paymentState
          return { residual: Number(move.amountResidual ?? -1), paymentState: paymentStateTag }
        },
        { timeout: 30_000 },
      )
      .toEqual({ residual: 0, paymentState: "Paid" })

    const acceptedEffect = await fetchMoveSnapshots(page, [entryMoveId, invoiceMoveId])

    // The exact accepted request is stale once this invoice is settled. Both
    // stale replay and a read-only persona must preserve the same two moves.
    const replay = await replayOperationAs(page, reconcileRes.request())
    expect(replay.status()).toBe(422)
    expect(await fetchMoveSnapshots(page, [entryMoveId, invoiceMoveId])).toEqual(acceptedEffect)

    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const readerPage = await readerContext.newPage()
    try {
      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      const denial = await replayOperationAs(readerPage, reconcileRes.request())
      expect(denial.status()).toBe(403)
      expect(await fetchMoveSnapshots(page, [entryMoveId, invoiceMoveId])).toEqual(acceptedEffect)
    } finally {
      await readerContext.close()
    }
  })
})
