import { expect, test, type Page } from "@playwright/test"

import {
  callReducerBff,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  fillField,
  gotoModule,
  scalarQueryId,
  selectEntityRowById,
  smokeName,
  submitForm,
  waitForEntityActionEnabled,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"
import { openActorPages, provisionActor } from "./pretenant-support"

type Row = Record<string, unknown>
type HistoryDelta = { field: string; before: string | null; after: string | null }
type HistoryEntry = {
  id: string
  operation: string
  actorIdentity: string
  changedResource: string
  changedRecordId: string
  changes: HistoryDelta[]
}
type HistoryPage = {
  schemaVersion: number
  recordId: string
  companyId: string
  data: HistoryEntry[]
  nextCursor: string | null
  coverage: { status: string; operations: string[] }
}

const HISTORY_GRANTS = ["business_history:read", "account_move:read", "account_move_line:read"]
const none = { none: [] }

// The current history API exposes the intersection of these material fields
// with the canonical default account-move-line read projection. Compare the
// actual persisted rows, including any owner-recomputed residuals.
function lineSnapshot(row: Row): Record<string, string | null> {
  return Object.fromEntries([
    ["name", "name"], ["debit", "debit"], ["credit", "credit"], ["balance", "balance"],
    ["amount_residual", "amountResidual"], ["amount_residual_currency", "amountResidualCurrency"],
    ["partner_id", "partnerId"],
  ].map(([field, camel]): [string, string | null] => {
    if (!(field in row) && !(camel in row)) throw new Error(`canonical line projection is missing ${field}`)
    const value = row[camel] ?? row[field]
    if (value == null) return [field, null]
    if (typeof value !== "string" && typeof value !== "number") throw new Error(`invalid canonical ${field}`)
    return [field, String(value)]
  }))
}

function changedFields(before: Record<string, string | null>, after: Record<string, string | null>): HistoryDelta[] {
  return Object.keys(before).sort().filter((field) => before[field] !== after[field])
    .map((field) => ({ field, before: before[field], after: after[field] }))
}

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  expect(response.ok(), `${resource} query HTTP ${response.status()}`).toBe(true)
  return ((await response.json()) as { data: Row[] }).data
}

function historyPath(moveId: number, companyId: number): string {
  return `/api/history/account-moves/${moveId}?companyId=${companyId}&limit=50`
}

async function history(page: Page, moveId: number, companyId: number): Promise<HistoryPage> {
  const response = await page.request.get(historyPath(moveId, companyId))
  expect(response.ok(), `record history HTTP ${response.status()}`).toBe(true)
  const result = (await response.json()) as HistoryPage
  expect(result.schemaVersion).toBe(1)
  expect(result.recordId).toBe(String(moveId))
  expect(result.companyId).toBe(String(companyId))
  expect(result.coverage.status).toBe("partial")
  expect(result.coverage.operations).toEqual(["update_account_move_line"])
  return result
}

/** Create fixture data through the real form and resolve its exact canonical request key. */
async function createDraftInvoice(page: Page, companyId: number, description: string): Promise<number> {
  await gotoModule(page, "/accounting", "accounting")
  const modal = page.getByTestId("create-invoice-modal")
  await expect(async () => {
    await page.getByTestId("accountant-overview").getByRole("button", { name: "New invoice", exact: true }).click()
    await expect(modal).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  await modal.getByTestId("create-invoice-partner").click()
  await page.locator('[role="listbox"]:visible').getByRole("option", { disabled: false }).first().click()
  await modal.getByTestId("create-invoice-line-description").fill(description)
  await modal.getByTestId("create-invoice-line-unit-price").fill("90")
  const [dispatch] = await Promise.all([
    page.waitForResponse((response) => matchesOperationResponse(response, "create_manual_account_invoice"), { timeout: 30_000 }),
    modal.getByTestId("create-invoice-save-draft").click(),
  ])
  expect(dispatch.ok(), `invoice creation HTTP ${dispatch.status()}`).toBe(true)
  await expect(modal).toBeHidden({ timeout: 30_000 })
  const body = dispatch.request().postDataJSON() as { params?: { idempotency_key?: unknown } }
  const requestKey = body.params?.idempotency_key
  expect(typeof requestKey).toBe("string")
  const result = await page.request.get(`/api/accounting/manual-invoice-results/${companyId}/${requestKey}`)
  expect(result.ok()).toBe(true)
  const canonical = (await result.json()) as { data?: { resource?: string; id?: unknown } }
  expect(canonical.data?.resource).toBe("account-moves")
  const moveId = scalarQueryId(canonical.data?.id)
  if (moveId == null) throw new Error("manual invoice has no exact canonical result")
  return moveId
}

test.describe("Accounting trusted change history", { tag: ["@p0", "@finance-history"] }, () => {
  test("records a real draft-line edit, survives reload, and applies current source/history/field authority", async ({ page, browser }) => {
    test.setTimeout(300_000)
    const companyId = await fetchDefaultCompanyId(page)
    const organizationId = await fetchSessionOrganizationId(page)
    const beforeName = smokeName("history-line-before")
    const afterName = smokeName("history-line-after")
    const forgedName = smokeName("history-forged-audit")
    let lineUpdates = 0
    page.on("request", (request) => {
      if (request.method() === "POST" && matchesOperationResponse(request, "update_account_move_line")) lineUpdates += 1
    })
    const moveId = await createDraftInvoice(page, companyId, beforeName)
    const line = (await rows(page, "account-move-lines")).find((row) =>
      scalarQueryId(row.moveId ?? row.move_id) === moveId && row.name === beforeName,
    )
    const lineId = scalarQueryId(line?.id)
    if (lineId == null) throw new Error("invoice fixture has no exact commercial line")
    const beforeSnapshot = lineSnapshot(line!)
    expect((await history(page, moveId, companyId)).data).toEqual([])

    // The transition under test uses the actual visible line action and edit form.
    await page.goto(`/accounting/invoices/${moveId}?tab=lines`)
    await selectEntityRowById(page, lineId)
    await waitForEntityActionEnabled(page, "entity-action-move-line-edit")
    await page.getByTestId("entity-action-move-line-edit").click()
    await expect(page.getByTestId("form-modal-edit-account-move-line")).toBeVisible()
    await fillField(page, "name", afterName)
    const [editResponse] = await Promise.all([
      page.waitForResponse((response) => matchesOperationResponse(response, "update_account_move_line"), { timeout: 30_000 }),
      submitForm(page, "edit-account-move-line"),
    ])
    expect(editResponse.ok(), `line edit HTTP ${editResponse.status()}`).toBe(true)

    const persisted = (await rows(page, "account-move-lines")).find((row) => scalarQueryId(row.id) === lineId)
    if (!persisted) throw new Error("edited canonical line is missing")
    const expectedChanges = changedFields(beforeSnapshot, lineSnapshot(persisted))
    expect(expectedChanges).toContainEqual({ field: "name", before: beforeName, after: afterName })

    let saved: HistoryEntry | undefined
    await expect.poll(async () => {
      const result = await history(page, moveId, companyId)
      saved = result.data.find((entry) => entry.changedRecordId === String(lineId))
      return saved ? [...saved.changes].sort((a, b) => a.field.localeCompare(b.field)) : undefined
    }, { timeout: 30_000 }).toEqual(expectedChanges)
    if (!saved) throw new Error("draft-line edit has no exact trusted history entry")
    const eventId = saved.id
    expect(saved.operation).toBe("update_account_move_line")
    expect(saved.changedResource).toBe("account-move-lines")
    expect(saved.actorIdentity).toMatch(/^[0-9a-f]{64}$/i)

    await page.getByTestId("invoice-tab-changes").click()
    const entry = page.getByTestId(`record-change-${eventId}`)
    await expect(entry).toBeVisible({ timeout: 30_000 })
    await entry.locator("summary").click()
    await expect(entry.getByTestId("record-change-before").filter({ hasText: beforeName })).toHaveText(beforeName)
    await expect(entry.getByTestId("record-change-after").filter({ hasText: afterName })).toHaveText(afterName)
    await expect(page.getByTestId("record-changes-coverage")).toBeVisible()
    await page.reload()
    await expect(page).toHaveURL(new RegExp(`/accounting/invoices/${moveId}\\?tab=changes$`))
    await expect(page.getByTestId(`record-change-${eventId}`)).toBeVisible({ timeout: 30_000 })
    expect((await history(page, moveId, companyId)).data.map((row) => row.id)).toEqual([eventId])
    expect(lineUpdates, "history reads and reload must not execute another line edit").toBe(1)

    // A member-authored raw audit record is never authoritative history evidence.
    await callReducerBff(page, "log_audit_event", [organizationId, {
      company_id: companyId, table_name: "account_move_line", record_id: lineId, action: "UPDATE",
      old_values: JSON.stringify({ name: beforeName }), new_values: JSON.stringify({ name: forgedName }),
      changed_fields: ["name"], session_id: null, ip_address: null, user_agent: null, metadata: null,
    }])
    const afterRawAudit = await history(page, moveId, companyId)
    expect(afterRawAudit.data.map((row) => row.id)).toEqual([eventId])
    expect(JSON.stringify(afterRawAudit)).not.toContain(forgedName)

    const observer = await provisionActor(page, "finance-history-reader", HISTORY_GRANTS)
    const session = await openActorPages(browser, [observer])
    try {
      const reader = session.pages[0]
      const observed = await history(reader, moveId, companyId)
      expect(observed.data.map((row) => row.id)).toEqual([eventId])
      const foreignCompany = await reader.request.get(historyPath(moveId, companyId + 1))
      expect(foreignCompany.status()).toBe(403)

      // A current field restriction removes both values and the hidden field/event identity.
      const unchangedField = Object.keys(beforeSnapshot).find((field) =>
        expectedChanges.every((change) => change.field !== field),
      )
      if (!unchangedField) throw new Error("fixture has no unchanged field for restrictive read policy")
      await callReducerBff(page, "grant_field_permission", [organizationId, {
        subject: { tag: "Role", value: observer.roleId }, resource: "account-move-lines",
        action: { tag: "Read" }, allowed_fields: [unchangedField],
      }])
      const redacted = await history(reader, moveId, companyId)
      expect(redacted.data).toEqual([])
      expect(JSON.stringify(redacted)).not.toContain(beforeName)
      expect(JSON.stringify(redacted)).not.toContain(afterName)

      await callReducerBff(page, "grant_field_permission", [organizationId, {
        subject: { tag: "Role", value: observer.roleId }, resource: "account-move-lines",
        action: { tag: "Read" }, allowed_fields: ["name"],
      }])
      const restored = await history(reader, moveId, companyId)
      expect(restored.data.map((row) => row.id)).toEqual([eventId])
      expect(restored.data[0].changes).toEqual([{ field: "name", before: beforeName, after: afterName }])

      await callReducerBff(page, "update_role", [observer.roleId, {
        name: none, description: none, is_active: none,
        permissions: { some: ["organization:read", "business_history:read", "account_move_line:read"] },
      }])
      const sourceRevoked = await reader.request.get(historyPath(moveId, companyId))
      expect(sourceRevoked.status()).toBe(403)
      expect(await sourceRevoked.text()).not.toContain(afterName)

      await callReducerBff(page, "update_role", [observer.roleId, {
        name: none, description: none, is_active: none,
        permissions: { some: ["organization:read", "account_move:read", "account_move_line:read"] },
      }])
      const revoked = await reader.request.get(historyPath(moveId, companyId))
      expect(revoked.status()).toBe(403)
      expect(await revoked.text()).not.toContain(afterName)
    } finally {
      await session.close()
    }
  })
})
