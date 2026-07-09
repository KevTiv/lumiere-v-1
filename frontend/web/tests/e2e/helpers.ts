import path from "node:path"
import { fileURLToPath } from "node:url"

import { expect, type Page } from "@playwright/test"
import { stringifyReducerCallBody } from "@lumiere/api-client"
import { encodeReducerCallArgs } from "@lumiere/erp-shared/stdb-params-json"

export const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? "test@email.com"
export const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? "Password123$"
export const AUTH_STORAGE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  ".auth/user.json",
)

export function smokeName(prefix: string) {
  return `smoke-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export async function expectNoAppError(page: Page) {
  await expect(page.getByText(/application error|internal server error|unhandled runtime error/i)).toHaveCount(0)
}

export async function signIn(
  page: Page,
  email: string = TEST_EMAIL,
  password: string = TEST_PASSWORD,
) {
  await page.goto("/sign-in")

  const emailField = page.getByLabel(/email/i)
  const emailVisible = await emailField
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false)

  if (!emailVisible) {
    await expect(page.getByTestId("dashboard-sidebar")).toBeVisible()
    await expectNoAppError(page)
    return
  }

  await emailField.fill(email)
  await page.getByLabel(/password/i).fill(password)
  await page.getByRole("button", { name: /sign in/i }).click()

  await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)
  await expect(page.getByTestId("dashboard-sidebar")).toBeVisible()
  await expectNoAppError(page)
}

export async function expectAuthenticatedShell(page: Page) {
  await expect(page.getByTestId("dashboard-sidebar")).toBeVisible()
  await expect(page.getByTestId("sidebar-user")).toBeVisible()
  await expect(page.getByTestId("sidebar-sign-out")).toBeVisible()
  await expectNoAppError(page)
}

export async function gotoModule(page: Page, route: string, moduleId?: string) {
  await page.goto(route)
  await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)
  await expectAuthenticatedShell(page)
  if (moduleId) {
    await expect(page.getByTestId(`module-view-${moduleId}`)).toBeVisible()
  }
}

/** Open an entity tab’s create modal and wait for the form dialog. */
export async function openEntityCreate(
  page: Page,
  route: string,
  moduleId: string,
  tabId: string,
  formId: string,
) {
  await gotoModule(page, route, moduleId)
  await page.getByTestId(`module-tab-${moduleId}-${tabId}`).click()
  const createBtn = page.getByTestId(`module-create-${moduleId}-${tabId}`)
  await createBtn.scrollIntoViewIfNeeded()
  await createBtn.click()
  await expect(page.getByTestId(`form-modal-${formId}`)).toBeVisible()
}

export async function openAccountingTab(page: Page, tabId: string) {
  await page.getByTestId(`module-tab-accounting-${tabId}`).click()
}

/** Click each module tab in order, assert no app error, optionally run per-tab checks. */
export async function assertModuleTabs(
  page: Page,
  moduleId: string,
  tabIds: readonly string[],
  assertTab?: (page: Page, tabId: string) => Promise<void>,
) {
  for (const tabId of tabIds) {
    await page.getByTestId(`module-tab-${moduleId}-${tabId}`).click()
    await expectNoAppError(page)
    if (assertTab) {
      await assertTab(page, tabId)
    }
  }
}

/** Entity table scoped to the visible tab panel (avoids strict-mode collisions). */
export function activeTabEntityTable(page: Page) {
  return page.locator('[role="tabpanel"]:visible [data-testid="entity-table"]').first()
}

/** Rows in a custom tab panel table (e.g. accounting InvoiceListView). */
export function activeTabCustomTableRows(page: Page) {
  return page.locator('[role="tabpanel"]:visible table tbody tr')
}

/** Poll a BFF list query until at least `minRows` are returned. */
export async function waitForBffQueryMinRows(
  page: Page,
  queryPath: string,
  minRows = 1,
  timeoutMs = 30_000,
) {
  await expect
    .poll(
      async () => {
        const res = await page.request.get(queryPath)
        if (!res.ok()) return 0
        const json = (await res.json()) as { data?: unknown[] }
        return Array.isArray(json.data) ? json.data.length : 0
      },
      { timeout: timeoutMs },
    )
    .toBeGreaterThanOrEqual(minRows)
}

function importJobTableName(row: Record<string, unknown>): string {
  return String(row.tableName ?? row.table_name ?? "").trim().toLowerCase()
}

function importJobStatus(row: Record<string, unknown>): string {
  return String(row.status ?? "").trim().toLowerCase()
}

/** Poll until a rollback-eligible import job exists for `tableName`. */
export async function waitForImportJobRollbackReady(
  page: Page,
  tableName: string,
  timeoutMs = 60_000,
) {
  const normalized = tableName.trim().toLowerCase()
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/query/import-jobs")
        if (!res.ok()) return false
        const json = (await res.json()) as { data?: Record<string, unknown>[] }
        return (json.data ?? []).some((row) => {
          const status = importJobStatus(row)
          return (
            importJobTableName(row) === normalized &&
            (status === "success" || status === "partial")
          )
        })
      },
      { timeout: timeoutMs },
    )
    .toBe(true)
}

function isSoftDeletedRow(row: Record<string, unknown>): boolean {
  const deleted = row.deletedAt ?? row.deleted_at
  if (deleted == null) return false
  if (typeof deleted === "object" && deleted !== null && "none" in deleted) return false
  return true
}

/** Assert a row no longer appears in a BFF list query (e.g. after soft-delete filtering). */
export async function expectRecordAbsentFromQuery(
  page: Page,
  queryPath: string,
  match: (row: Record<string, unknown>) => boolean,
) {
  await expect
    .poll(
      async () => {
        const res = await page.request.get(queryPath)
        if (!res.ok()) return false
        const json = (await res.json()) as { data?: Record<string, unknown>[] }
        return (json.data ?? []).find(match) === undefined
      },
      { timeout: 30_000 },
    )
    .toBe(true)
}

/** Assert a row was soft-deleted (`deleted_at` / `deletedAt` set) via BFF query. */
export async function expectRecordSoftDeleted(
  page: Page,
  queryPath: string,
  match: (row: Record<string, unknown>) => boolean,
) {
  await expect
    .poll(
      async () => {
        const res = await page.request.get(queryPath)
        if (!res.ok()) return false
        const json = (await res.json()) as { data?: Record<string, unknown>[] }
        const row = (json.data ?? []).find(match)
        if (!row) return true
        return isSoftDeletedRow(row)
      },
      { timeout: 30_000 },
    )
    .toBe(true)
}

/** Wait for a workflow/runtime form modal (handles loading overlay). */
export async function expectFormModalVisible(
  page: Page,
  formId: string,
  timeoutMs = 30_000,
) {
  const loading = page.getByTestId(`runtime-form-modal-loading-${formId}`)
  if (await loading.isVisible().catch(() => false)) {
    await expect(loading).toBeHidden({ timeout: timeoutMs })
  }
  await expect(page.getByTestId(`form-modal-${formId}`)).toBeVisible({ timeout: timeoutMs })
}

export async function openSettingsSection(page: Page, sectionId: string) {
  await page.goto("/settings")
  await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)
  await expectAuthenticatedShell(page)
  const section = page.getByTestId(`settings-section-${sectionId}`)
  await expect(section).toBeVisible({ timeout: 30_000 })
  await section.click()
  await expectNoAppError(page)
}

/** Close dialog overlays opened by row clicks (e.g. CRM record chatter). */
export async function dismissBlockingDialogs(page: Page) {
  const overlay = page.locator('[data-slot="dialog-overlay"][data-open]')
  if ((await overlay.count()) === 0) return
  await page.keyboard.press("Escape")
  await expect(overlay).toHaveCount(0, { timeout: 5_000 })
}

/** Wait for a BFF list query, then assert seeded fixture text is visible. */
export async function expectSeededText(
  page: Page,
  text: string | RegExp,
  queryPath?: string,
) {
  const textNeedle = typeof text === "string" ? text : text.source
  let sampleRow: unknown

  if (queryPath) {
    const res = await page.request.get(queryPath)
    if (!res.ok()) {
      throw new Error(`${queryPath} failed: ${res.status()}`)
    }
    const json = (await res.json()) as { data?: unknown[] }
    if (!Array.isArray(json.data) || json.data.length === 0) {
      throw new Error(`${queryPath} returned no rows`)
    }
    sampleRow = json.data.find((row) => JSON.stringify(row).includes(textNeedle))
    if (!sampleRow) {
      throw new Error(`${queryPath} has no row matching ${textNeedle}`)
    }
  }

  try {
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 30_000 })
  } catch (error) {
    if (sampleRow !== undefined) {
      throw new Error(
        `${String(error)}; API row snapshot: ${JSON.stringify(sampleRow)}`,
        { cause: error instanceof Error ? error : undefined },
      )
    }
    throw error
  }
}

/** Open a tab's create modal, cancel, and expect the form dialog to close. */
export async function openTabAndCancelCreate(
  page: Page,
  moduleId: string,
  tabId: string,
  formId: string,
) {
  await page.getByTestId(`module-tab-${moduleId}-${tabId}`).click()
  const createBtn = page.getByTestId(`module-create-${moduleId}-${tabId}`)
  await createBtn.scrollIntoViewIfNeeded()
  await createBtn.click()
  await expect(page.getByTestId(`form-modal-${formId}`)).toBeVisible()
  await page.getByTestId(`form-modal-${formId}`).getByRole("button", { name: /^cancel$/i }).click()
  await expect(page.getByTestId(`form-modal-${formId}`)).toBeHidden()
  await expectNoAppError(page)
}

export async function fillField(page: Page, name: string, value: string) {
  const field = page.getByTestId(`form-field-${name}`)
  await field.click()
  await field.fill(value)
}

export async function chooseFirstOption(page: Page, name: string) {
  await chooseFirstEnabledOption(page, name)
}

/** Pick the first non-disabled select option (skips empty placeholders). */
export async function chooseFirstEnabledOption(page: Page, name: string) {
  await page.getByTestId(`form-field-${name}`).click()
  const listbox = page.locator('[role="listbox"]:visible')
  await expect
    .poll(async () => listbox.getByRole("option", { disabled: false }).count(), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0)
  await listbox.getByRole("option", { disabled: false }).first().click()
}

function accountInternalTypeTag(row: Record<string, unknown>): string {
  const v = row.internalType ?? row.internal_type
  if (v != null && typeof v === "object" && "tag" in v) {
    return String((v as { tag: string }).tag).toLowerCase()
  }
  return String(v ?? "").toLowerCase()
}

function accountSelectLabel(row: Record<string, unknown>): string {
  const code = String(row.code ?? "")
  const name = String(row.name ?? "")
  if (code && name) return `${code} — ${name}`
  return name || code || String(row.id ?? "?")
}

/** First chart account matching internal type (e.g. receivable, income). */
export async function fetchAccountSelectLabelByInternalType(
  page: Page,
  internalType: string,
): Promise<string> {
  const res = await page.request.get("/api/query/account-accounts")
  if (!res.ok()) throw new Error(`account-accounts query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Record<string, unknown>[] }
  const want = internalType.toLowerCase()
  let row = (json.data ?? []).find((r) => accountInternalTypeTag(r) === want)
  // Seed fallback when internalType is not projected (legacy field policy)
  if (!row) {
    const codeByType: Record<string, string> = {
      receivable: "1100",
      income: "4000",
      payable: "2000",
      expense: "5000",
    }
    const code = codeByType[want]
    if (code) row = (json.data ?? []).find((r) => String(r.code ?? "") === code)
  }
  if (!row) throw new Error(`no account with internal type ${internalType}`)
  return accountSelectLabel(row)
}

/** Chart account id by code (e.g. seed `5000` COGS, `1400` inventory). */
export async function fetchAccountIdByCode(page: Page, code: string): Promise<number> {
  const res = await page.request.get("/api/query/account-accounts")
  if (!res.ok()) throw new Error(`account-accounts query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Array<{ id?: unknown; code?: string }> }
  const row = (json.data ?? []).find((a) => String(a.code ?? "") === code)
  const id = scalarQueryId(row?.id)
  if (id == null) throw new Error(`account not found: ${code}`)
  return id
}

/** Sales invoice journal from seed (INV — Customer Invoices). */
export async function fetchSalesInvoiceJournalLabel(page: Page): Promise<string> {
  const res = await page.request.get("/api/query/account-journals")
  if (!res.ok()) throw new Error(`account-journals query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Record<string, unknown>[] }
  const row =
    (json.data ?? []).find((r) => String(r.code ?? "").toUpperCase() === "INV") ??
    (json.data ?? [])[0]
  if (!row) throw new Error("no account journals in query")
  const code = String(row.code ?? "")
  const name = String(row.name ?? "")
  return code && name ? `${code} — ${name}` : name || code
}

/** Vendor bill journal from seed (BILL — Vendor Bills). */
export async function fetchVendorBillJournalLabel(page: Page): Promise<string> {
  const res = await page.request.get("/api/query/account-journals")
  if (!res.ok()) throw new Error(`account-journals query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Record<string, unknown>[] }
  const row =
    (json.data ?? []).find((r) => String(r.code ?? "").toUpperCase() === "BILL") ??
    (json.data ?? [])[0]
  if (!row) throw new Error("no account journals in query")
  const code = String(row.code ?? "")
  const name = String(row.name ?? "")
  return code && name ? `${code} — ${name}` : name || code
}

function poStateTag(row: Record<string, unknown>): string {
  return scalarQueryString(row.state)
}

function moveTypeTag(value: unknown): string {
  return scalarQueryString(value).toLowerCase()
}

function isVendorBillMoveType(value: unknown): boolean {
  const t = moveTypeTag(value)
  return t.includes("in") && !t.includes("out")
}

function isCustomerInvoiceMoveType(value: unknown): boolean {
  return moveTypeTag(value).includes("out")
}

/** Newest purchase order id for a vendor partner id. */
export async function fetchLatestPurchaseOrderIdByPartner(
  page: Page,
  partnerId: number,
): Promise<number> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/purchase-orders")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: unknown; partnerId?: unknown; partner_id?: unknown }>
      }
      const matches = (json.data ?? []).filter(
        (row) => scalarQueryId(row.partnerId ?? row.partner_id) === partnerId,
      )
      const newest = [...matches].sort(
        (a, b) => (scalarQueryId(b.id) ?? 0) - (scalarQueryId(a.id) ?? 0),
      )[0]
      const id = scalarQueryId(newest?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`purchase order not found for partner id ${partnerId}`)
}

export async function waitForPurchaseOrderState(
  page: Page,
  orderId: number,
  state: string,
): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/purchase-orders")
    if (res.ok()) {
      const json = (await res.json()) as { data?: Record<string, unknown>[] }
      const row = (json.data ?? []).find((r) => scalarQueryId(r.id) === orderId)
      if (row && poStateTag(row) === state) return
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`purchase order ${orderId} did not reach state ${state}`)
}

/** Draft vendor bill move id for a partner display name (newest match). */
export async function fetchDraftVendorBillMoveIdByPartner(
  page: Page,
  partnerName: string,
): Promise<number> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/account-moves")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{
          id?: number | string
          state?: unknown
          moveType?: unknown
          move_type?: unknown
          invoicePartnerDisplayName?: string
          partnerName?: string
        }>
      }
      const matches = (json.data ?? []).filter((m) => {
        const partner = String(m.invoicePartnerDisplayName ?? m.partnerName ?? "")
        const isDraft = scalarQueryString(m.state).toLowerCase() === "draft"
        return (
          isVendorBillMoveType(m.moveType ?? m.move_type) &&
          isDraft &&
          partner.includes(partnerName)
        )
      })
      const newest = [...matches].sort(
        (a, b) => (scalarQueryId(b.id) ?? 0) - (scalarQueryId(a.id) ?? 0),
      )[0]
      const id = scalarQueryId(newest?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`draft vendor bill not found for partner: ${partnerName}`)
}

export async function fetchVendorPartnerIdByName(page: Page, name: string): Promise<number> {
  const res = await page.request.get("/api/query/contacts")
  if (!res.ok()) throw new Error(`contacts query failed: ${res.status()}`)
  const json = (await res.json()) as {
    data?: Array<{
      id?: unknown
      name?: string
      displayName?: string
      display_name?: string
      isVendor?: boolean
      is_vendor?: boolean
    }>
  }
  const row = (json.data ?? []).find((c) => {
    const label = String(c.name ?? c.displayName ?? c.display_name ?? "")
    const isVendor = c.isVendor ?? c.is_vendor
    return label.includes(name) && isVendor !== false
  })
  const id = scalarQueryId(row?.id)
  if (id == null) throw new Error(`vendor contact not found: ${name}`)
  return id
}

/** Pick a Radix select option by its stored value (not visible label). */
export async function chooseSelectOptionByValue(
  page: Page,
  name: string,
  value: string | number | bigint,
) {
  const v = String(value)
  await page.getByTestId(`form-field-${name}`).click()
  const listbox = page.locator('[role="listbox"]')
  await expect(listbox).toBeVisible({ timeout: 15_000 })
  const byData = listbox.locator(`[role="option"][data-value="${v}"]`).first()
  await expect
    .poll(async () => {
      if ((await byData.count()) > 0) return "data-value"
      if ((await listbox.getByRole("option", { name: new RegExp(`\\b${v}\\b`) }).count()) > 0) {
        return "label"
      }
      return ""
    }, { timeout: 30_000 })
    .not.toBe("")
  if ((await byData.count()) > 0) {
    await byData.click()
    return
  }
  await listbox.getByRole("option", { name: new RegExp(`\\b${v}\\b`) }).first().click()
}

/** Pick a select option by visible label text (Radix Select shows labels, not raw ids). */
export async function chooseSelectOptionByLabel(
  page: Page,
  name: string,
  label: string | RegExp,
  options?: { optionTimeoutMs?: number },
) {
  const optionTimeoutMs = options?.optionTimeoutMs ?? 30_000
  const optionName =
    typeof label === "string"
      ? new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      : label
  const field = page.getByTestId(`form-field-${name}`)
  const listbox = page.locator('[role="listbox"]:visible')
  const option = listbox.getByRole("option", { name: optionName }).first()

  await expect
    .poll(
      async () => {
        await field.click()
        if (!(await listbox.isVisible().catch(() => false))) return 0
        return await option.count()
      },
      { timeout: optionTimeoutMs },
    )
    .toBeGreaterThan(0)

  await option.click()
}

export async function submitForm(page: Page, formId: string) {
  const modal = page.getByTestId(`form-modal-${formId}`)
  await page.getByTestId(`form-submit-${formId}`).click()
  try {
    await expect(modal).toBeHidden({ timeout: 15_000 })
  } catch {
    const fieldErrors = await modal.locator(".text-destructive, [role='alert']").allTextContents()
    const toastErrors = await page.getByRole("status").allTextContents().catch(() => [] as string[])
    const detail = [...fieldErrors, ...toastErrors].filter(Boolean).join("; ")
    throw new Error(
      `Form "${formId}" did not close after submit${detail ? `: ${detail}` : ""}`,
    )
  }
  await expectNoAppError(page)
}

/** `YYYY-MM-DD` for `<input type="date">`. */
export function isoDate(daysFromNow = 0) {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** `YYYY-MM-DDTHH:mm` for `<input type="datetime-local">`. */
export function isoDateTimeLocal(y: number, month: number, day: number, hour = 0, minute = 0) {
  const mm = String(month).padStart(2, "0")
  const dd = String(day).padStart(2, "0")
  const hh = String(hour).padStart(2, "0")
  const min = String(minute).padStart(2, "0")
  return `${y}-${mm}-${dd}T${hh}:${min}`
}

export async function installPostHogResetProbe(page: Page) {
  let resetSeen = false

  await page.exposeFunction("__lumiereNotifyPostHogReset", () => {
    resetSeen = true
  })
  await page.addInitScript(() => {
    window.addEventListener("lumiere:posthog-reset", () => {
      void (window as unknown as { __lumiereNotifyPostHogReset?: () => void }).__lumiereNotifyPostHogReset?.()
    })
  })

  return {
    wasReset: () => resetSeen,
  }
}

/** Click the entity table row whose text includes `text`. Enables selection actions. */
export async function selectEntityRowByText(page: Page, text: string | RegExp) {
  const row = activeTabEntityTable(page).locator("tbody tr").filter({ hasText: text }).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  if ((await row.getAttribute("data-state")) !== "selected") {
    await row.click()
    await expect(row).toHaveAttribute("data-state", "selected", { timeout: 10_000 })
  }
  await dismissBlockingDialogs(page)
}

/** Click an entity table row by its `data-testid="entity-row-{id}"` key. */
export async function selectEntityRowById(page: Page, id: number | string) {
  const table = activeTabEntityTable(page)
  const row = table.getByTestId(`entity-row-${id}`)
  await expect(row).toBeVisible({ timeout: 30_000 })

  // Selection toggles per row — clear other selections so single-select actions fire.
  const otherSelected = table.locator('tbody tr[data-state="selected"]').filter({
    hasNot: table.getByTestId(`entity-row-${id}`),
  })
  for (let i = 0; i < (await otherSelected.count()); i += 1) {
    await otherSelected.first().click()
  }

  // Entity tables default to toggle-on-click selection. Re-clicking an already-selected row
  // deselects it — wait for STDB-driven re-renders, then only click when not selected.
  if ((await row.getAttribute("data-state")) !== "selected") {
    await row.click()
    await expect(row).toHaveAttribute("data-state", "selected", { timeout: 10_000 })
  }
  await dismissBlockingDialogs(page)
}

/** Wait until a selection-gated entity action is enabled (proves row context is applied). */
export async function waitForEntityActionEnabled(page: Page, actionTestId: string) {
  await expect(page.getByTestId(actionTestId)).toBeEnabled({ timeout: 30_000 })
}

/** Click a toolbar action and wait for the matching reducer HTTP call. */
export async function clickEntityActionAndWaitForReducer(
  page: Page,
  actionTestId: string,
  reducerName: string,
  options?: { timeoutMs?: number },
) {
  await waitForEntityActionEnabled(page, actionTestId)
  const timeout = options?.timeoutMs ?? 30_000
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/api/call/${reducerName}`) && r.ok(),
      { timeout },
    ),
    page.getByTestId(actionTestId).click(),
  ])
  expect(res.ok()).toBe(true)
}

/** First organization id for the authenticated session (dev seed org). */
export async function fetchSessionOrganizationId(page: Page): Promise<number> {
  const res = await page.request.get("/api/query/user-organization")
  if (!res.ok()) {
    throw new Error(`user-organization query failed: ${res.status()}`)
  }
  const json = (await res.json()) as {
    data?: Array<{ organizationId?: number | string; organization_id?: number | string }>
  }
  const row = json.data?.[0]
  const id = row?.organizationId ?? row?.organization_id
  if (id == null) throw new Error("no organization in session")
  return Number(id)
}

/** Authenticated BFF reducer call (same-origin `/api/call`). */
export async function callReducerBff(
  page: Page,
  reducer: string,
  args: unknown[],
  options?: { withCompany?: boolean },
) {
  const result = await callReducerBffResult(page, reducer, args, options)
  if (!result.ok) {
    throw new Error(result.error ?? `Reducer ${reducer} failed (${result.status})`)
  }
}

/** Same as {@link callReducerBff} but returns status/body without throwing. */
export async function callReducerBffResult(
  page: Page,
  reducer: string,
  args: unknown[],
  options?: { withCompany?: boolean },
): Promise<{ ok: boolean; status: number; error?: string }> {
  const qs = options?.withCompany ? "?withCompany=true" : ""
  const encodedArgs = encodeReducerCallArgs(reducer, args)
  const res = await page.request.post(`/api/call/${reducer}${qs}`, {
    data: JSON.parse(stringifyReducerCallBody(encodedArgs)),
    headers: { "Content-Type": "application/json" },
  })
  if (res.ok()) {
    return { ok: true, status: res.status() }
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string }
  const error = json.error ?? (await res.text().catch(() => ""))
  return { ok: false, status: res.status(), error: error || undefined }
}

async function expectReducerHttpResponseOk(
  reducer: string,
  res: import("@playwright/test").Response,
): Promise<void> {
  if (res.ok()) return
  const json = (await res.json().catch(() => ({}))) as { error?: string }
  const detail = json.error ?? (await res.text().catch(() => ""))
  throw new Error(`Reducer ${reducer} failed (${res.status()}): ${detail}`)
}

/** Assert Casbin/module permission denial (403 or error body with Permission denied). */
export async function expectReducerPermissionDenied(
  page: Page,
  reducer: string,
  args: unknown[],
  options?: { withCompany?: boolean },
) {
  const result = await callReducerBffResult(page, reducer, args, options)
  expect(result.ok).toBe(false)
  const detail = result.error ?? ""
  const denied =
    result.status === 403 ||
    /permission denied/i.test(detail)
  expect(denied, `expected permission denial for ${reducer}, got ${result.status}: ${detail}`).toBe(
    true,
  )
}

/** Resolve seeded product id by display name via BFF query. */
export async function fetchProductIdByName(page: Page, name: string): Promise<number> {
  const res = await page.request.get("/api/query/products")
  if (!res.ok()) throw new Error(`products query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Array<{ id?: number | string; name?: string; displayName?: string }> }
  const row = json.data?.find(
    (p) => p.name === name || p.displayName === name,
  )
  if (row?.id == null) throw new Error(`product not found: ${name}`)
  return Number(row.id)
}

/** Lowest-sequence opportunity stage id from seed data. */
export async function fetchFirstOpportunityStageId(page: Page): Promise<number> {
  const res = await page.request.get("/api/query/opportunity-stages")
  if (!res.ok()) throw new Error(`opportunity-stages query failed: ${res.status()}`)
  const json = (await res.json()) as {
    data?: Array<{ id?: number | string; sequence?: number | string }>
  }
  const rows = json.data ?? []
  if (rows.length === 0) throw new Error("no opportunity stages in seed data")
  const sorted = [...rows].sort(
    (a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0),
  )
  const id = sorted[0]?.id
  if (id == null) throw new Error("opportunity stage row missing id")
  return Number(id)
}

/** Product category id by name (BFF `/api/query/product-categories`). */
export async function fetchProductCategoryIdByName(page: Page, name: string): Promise<number> {
  const res = await page.request.get("/api/query/product-categories")
  if (!res.ok()) throw new Error(`product-categories query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Array<{ id?: unknown; name?: string }> }
  const row = (json.data ?? []).find((r) => String(r.name ?? "") === name)
  const id = scalarQueryId(row?.id)
  if (id == null) throw new Error(`product category not found: ${name}`)
  return id
}

/** Canonical pair order for duplicate-contact test ids (`contactIdA` < `contactIdB`). */
export function canonicalContactPairIds(idA: number, idB: number): [number, number] {
  return idA < idB ? [idA, idB] : [idB, idA]
}

function contactQueryEmail(row: Record<string, unknown>): string {
  return String(row.email ?? row.emailFrom ?? row.email_from ?? "")
    .trim()
    .toLowerCase()
}

function isActiveContactRow(row: Record<string, unknown>): boolean {
  const deleted = row.deletedAt ?? row.deleted_at
  const mergeTarget = row.mergeTargetId ?? row.merge_target_id
  return deleted == null && mergeTarget == null
}

/** Active contact ids sharing an email (sorted ascending). Polls until `minCount` matches. */
export async function fetchContactIdsByEmail(
  page: Page,
  email: string,
  minCount = 1,
): Promise<number[]> {
  const normalized = email.trim().toLowerCase()
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/contacts")
    if (res.ok()) {
      const json = (await res.json()) as { data?: Record<string, unknown>[] }
      const ids = (json.data ?? [])
        .filter(
          (row) => contactQueryEmail(row) === normalized && isActiveContactRow(row),
        )
        .map((row) => scalarQueryId(row.id))
        .filter((id): id is number => id != null)
        .sort((a, b) => a - b)
      if (ids.length >= minCount) return ids
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`expected at least ${minCount} active contact(s) with email ${email}`)
}

/** Active contact id by exact display name. */
export async function fetchContactIdByName(page: Page, name: string): Promise<number> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/contacts")
    if (res.ok()) {
      const json = (await res.json()) as { data?: Record<string, unknown>[] }
      const row = (json.data ?? []).find((contact) => {
        const rowName = String(contact.name ?? contact.displayName ?? contact.display_name ?? "")
        return rowName === name && isActiveContactRow(contact)
      })
      const id = scalarQueryId(row?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`active contact not found: ${name}`)
}

/** Poll until `sourceId` is soft-merged into `targetId`. */
export async function waitForContactMergedInto(
  page: Page,
  sourceId: number,
  targetId: number,
) {
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/query/contacts")
        if (!res.ok()) return false
        const json = (await res.json()) as { data?: Record<string, unknown>[] }
        const source = (json.data ?? []).find((row) => scalarQueryId(row.id) === sourceId)
        if (!source) return true
        const mergeTarget = scalarQueryId(source.mergeTargetId ?? source.merge_target_id)
        return mergeTarget === targetId
      },
      { timeout: 30_000 },
    )
    .toBe(true)
}

/** Lead id whose name or contactName matches (BFF `/api/query/leads`). */
export async function fetchLeadIdByName(page: Page, name: string): Promise<number> {
  const res = await page.request.get("/api/query/leads")
  if (!res.ok()) throw new Error(`leads query failed: ${res.status()}`)
  const json = (await res.json()) as {
    data?: Array<{ id?: number | string; name?: string; contactName?: string; state?: string }>
  }
  const row = json.data?.find(
    (l) => l.name === name || l.contactName === name,
  )
  if (row?.id == null) throw new Error(`lead not found: ${name}`)
  return Number(row.id)
}

/** Opportunity id whose name matches (BFF `/api/query/opportunities`). */
export async function fetchOpportunityIdByName(page: Page, name: string): Promise<number> {
  const res = await page.request.get("/api/query/opportunities")
  if (!res.ok()) throw new Error(`opportunities query failed: ${res.status()}`)
  const json = (await res.json()) as {
    data?: Array<{ id?: number | string; name?: string }>
  }
  const row = json.data?.find((o) => o.name === name)
  if (row?.id == null) throw new Error(`opportunity not found: ${name}`)
  return Number(row.id)
}

/** First pricelist id from seed data, or `0` when none exist (legacy DBs). */
export async function fetchFirstPricelistId(page: Page): Promise<number> {
  const res = await page.request.get("/api/query/pricelists")
  if (!res.ok()) throw new Error(`pricelists query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Array<{ id?: number | string }> }
  const row = json.data?.[0]
  if (row?.id == null) return 0
  return Number(row.id)
}

/** First warehouse id from seed data. */
export async function fetchFirstWarehouseId(page: Page): Promise<number> {
  const res = await page.request.get("/api/query/warehouses")
  if (!res.ok()) throw new Error(`warehouses query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Array<{ id?: number | string }> }
  const row = json.data?.[0]
  if (row?.id == null) throw new Error("no warehouses in seed data")
  return Number(row.id)
}

/** First UoM id from seed data (for BFF reducer line params). */
export async function fetchFirstUomId(page: Page): Promise<number> {
  const res = await page.request.get("/api/query/uoms")
  if (!res.ok()) throw new Error(`uoms query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Array<{ id?: number | string }> }
  const row = json.data?.[0]
  if (row?.id == null) throw new Error("no uoms in seed data")
  return Number(row.id)
}

/** Normalize id/scalar fields from BFF query rows (handles SATS `some` wrappers). */
export function scalarQueryId(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === "number") return value
  if (typeof value === "string" && value.trim() !== "") return Number(value)
  if (typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    if ("some" in obj) return scalarQueryId(obj.some)
    if ("none" in obj) return null
  }
  return null
}

function scalarQueryString(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "bigint") return String(value)
  if (typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    if ("some" in obj) return scalarQueryString(obj.some)
    if ("tag" in obj && typeof obj.tag === "string") return obj.tag
    const keys = Object.keys(obj)
    if (keys.length === 1) {
      const key = keys[0]
      const payload = obj[key]
      if (Array.isArray(payload) && payload.length === 0) {
        return key.charAt(0).toUpperCase() + key.slice(1)
      }
      if (
        payload !== null &&
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        Object.keys(payload as object).length === 0
      ) {
        return key.charAt(0).toUpperCase() + key.slice(1)
      }
    }
  }
  return String(value)
}

/** Sale order id linked to a CRM opportunity (prefers opportunity_id in sale-orders query). */
export async function fetchSaleOrderIdByOpportunityId(
  page: Page,
  opportunityId: number,
): Promise<number> {
  const soRes = await page.request.get("/api/query/sale-orders")
  if (!soRes.ok()) throw new Error(`sale-orders query failed: ${soRes.status()}`)
  const soJson = (await soRes.json()) as {
    data?: Array<{
      id?: number | string
      partnerId?: unknown
      partner_id?: unknown
      opportunityId?: unknown
      opportunity_id?: unknown
      state?: unknown
    }>
  }

  const byOpportunity = (soJson.data ?? []).filter(
    (order) => scalarQueryId(order.opportunityId ?? order.opportunity_id) === opportunityId,
  )
  if (byOpportunity.length > 0) {
    const newest = [...byOpportunity].sort(
      (a, b) => (scalarQueryId(b.id) ?? 0) - (scalarQueryId(a.id) ?? 0),
    )[0]
    const orderId = scalarQueryId(newest?.id)
    if (orderId != null) return orderId
  }

  const oppRes = await page.request.get("/api/query/opportunities")
  if (!oppRes.ok()) throw new Error(`opportunities query failed: ${oppRes.status()}`)
  const oppJson = (await oppRes.json()) as {
    data?: Array<{
      id?: number | string
      partnerId?: unknown
      partner_id?: unknown
    }>
  }
  const opportunity = oppJson.data?.find(
    (row) => scalarQueryId(row.id) === opportunityId,
  )
  const partnerId = scalarQueryId(opportunity?.partnerId ?? opportunity?.partner_id)
  if (partnerId == null) {
    throw new Error(`opportunity ${opportunityId} has no partner_id in query projection`)
  }

  const matches = (soJson.data ?? []).filter(
    (order) => scalarQueryId(order.partnerId ?? order.partner_id) === partnerId,
  )
  if (matches.length === 0) {
    throw new Error(`sale order not found for opportunity partner: ${partnerId}`)
  }

  const draftMatches = matches.filter(
    (order) => scalarQueryString(order.state).toLowerCase() === "draft",
  )
  const pool = draftMatches.length > 0 ? draftMatches : matches
  const newest = [...pool].sort(
    (a, b) => (scalarQueryId(b.id) ?? 0) - (scalarQueryId(a.id) ?? 0),
  )[0]
  const orderId = scalarQueryId(newest?.id)
  if (orderId == null) {
    throw new Error(`sale order row missing id for opportunity: ${opportunityId}`)
  }
  return orderId
}

/** Label shown in sale order select options (reference, else `SO {id}`). */
export async function fetchLatestPurchaseOrderLineIdByOrder(
  page: Page,
  orderId: number,
): Promise<number> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/purchase-order-lines")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: unknown; orderId?: unknown; order_id?: unknown }>
      }
      const matches = (json.data ?? []).filter(
        (row) => scalarQueryId(row.orderId ?? row.order_id) === orderId,
      )
      const newest = [...matches].sort(
        (a, b) => (scalarQueryId(b.id) ?? 0) - (scalarQueryId(a.id) ?? 0),
      )[0]
      const id = scalarQueryId(newest?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`no purchase order line found for order ${orderId}`)
}

export async function fetchPurchaseOrderSelectLabel(
  page: Page,
  orderId: number,
): Promise<string> {
  const res = await page.request.get("/api/query/purchase-orders")
  if (!res.ok()) throw new Error(`purchase-orders query failed: ${res.status()}`)
  const json = (await res.json()) as {
    data?: Array<{ id?: unknown; name?: string; origin?: string }>
  }
  const order = (json.data ?? []).find((row) => scalarQueryId(row.id) === orderId)
  if (!order) throw new Error(`purchase order ${orderId} not found in query`)
  const ref = String(order.name ?? order.origin ?? "").trim()
  return ref || `PO ${orderId}`
}

export async function fetchSaleOrderSelectLabel(
  page: Page,
  orderId: number,
): Promise<string> {
  const res = await page.request.get("/api/query/sale-orders")
  if (!res.ok()) throw new Error(`sale-orders query failed: ${res.status()}`)
  const json = (await res.json()) as {
    data?: Array<{
      id?: number | string
      reference?: string
      clientOrderRef?: string
      origin?: string
    }>
  }
  const order = (json.data ?? []).find((row) => scalarQueryId(row.id) === orderId)
  if (!order) throw new Error(`sale order ${orderId} not found in query`)
  const ref = String(order.reference ?? order.clientOrderRef ?? order.origin ?? "").trim()
  return ref || `SO ${orderId}`
}

/** Poll until a draft sale order is visible in the sale-orders query. */
export async function waitForSaleOrderDraftInQuery(page: Page, orderId: number) {
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/query/sale-orders")
        if (!res.ok()) return false
        const json = (await res.json()) as {
          data?: Array<{ id?: unknown; state?: unknown }>
        }
        const row = (json.data ?? []).find((o) => scalarQueryId(o.id) === orderId)
        if (!row) return false
        return scalarQueryString(row.state).toLowerCase() === "draft"
      },
      { timeout: 30_000 },
    )
    .toBe(true)
}

/** Poll until an opportunity line exists for the opportunity with a product quantity > 0. */
export async function waitForOpportunityLineExists(page: Page, opportunityId: number) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/opportunity-lines")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{
          opportunityId?: unknown
          opportunity_id?: unknown
          productId?: unknown
          product_id?: unknown
          quantity?: unknown
        }>
      }
      const hasLine = (json.data ?? []).some((line) => {
        const lineOppId = scalarQueryId(line.opportunityId ?? line.opportunity_id)
        if (lineOppId !== opportunityId) return false
        const productId = scalarQueryId(line.productId ?? line.product_id)
        const qty = Number(line.quantity ?? 0)
        return productId != null && qty > 0
      })
      if (hasLine) return
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`opportunity ${opportunityId} has no product line in query`)
}

function isSaleOrderProductLine(line: {
  displayType?: unknown
  display_type?: unknown
}): boolean {
  const dt = line.displayType ?? line.display_type
  if (dt == null) return true
  if (typeof dt === "object" && !Array.isArray(dt) && "none" in (dt as object)) return true
  return false
}

/** Poll until a sale order line exists for the order with a product quantity > 0. */
export async function waitForSaleOrderLineExists(page: Page, orderId: number) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/sale-order-lines")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{
          orderId?: unknown
          order_id?: unknown
          productId?: unknown
          product_id?: unknown
          productUomQty?: unknown
          product_uom_qty?: unknown
          displayType?: unknown
          display_type?: unknown
        }>
      }
      const hasLine = (json.data ?? []).some((line) => {
        const lineOrderId = scalarQueryId(line.orderId ?? line.order_id)
        if (lineOrderId !== orderId) return false
        if (!isSaleOrderProductLine(line)) return false
        const productId = scalarQueryId(line.productId ?? line.product_id)
        const qty = Number(line.productUomQty ?? line.product_uom_qty ?? 0)
        return productId != null && qty > 0
      })
      if (hasLine) return
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`sale order ${orderId} has no product line in query`)
}

/** Poll until sale order state reflects confirmation (Sale / sale). */
export async function waitForSaleOrderConfirmed(page: Page, orderId: number) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/sale-orders")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: unknown; state?: unknown }>
      }
      const order = (json.data ?? []).find((row) => scalarQueryId(row.id) === orderId)
      const state = scalarQueryString(order?.state).toLowerCase()
      if (state === "sale" || state.includes("sale")) return
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`sale order ${orderId} was not confirmed`)
}

/** Poll until confirmed sale order lines expose qty_to_invoice > 0 (post-confirm reducer sync). */
export async function waitForSaleOrderBillableLines(page: Page, orderId: number) {
  const deadline = Date.now() + 30_000
  let sawLine = false
  let projectionMissingQty = false
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/sale-order-lines")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{
          orderId?: unknown
          order_id?: unknown
          qtyToInvoice?: unknown
          qty_to_invoice?: unknown
          displayType?: unknown
          display_type?: unknown
        }>
      }
      const orderLines = (json.data ?? []).filter(
        (line) => scalarQueryId(line.orderId ?? line.order_id) === orderId,
      )
      if (orderLines.length > 0) {
        sawLine = true
        const hasQtyField = orderLines.some(
          (line) => line.qtyToInvoice != null || line.qty_to_invoice != null,
        )
        if (!hasQtyField) projectionMissingQty = true
      }
      const billable = orderLines.some((line) => {
        if (!isSaleOrderProductLine(line)) return false
        const qty = Number(line.qtyToInvoice ?? line.qty_to_invoice ?? 0)
        return qty > 0
      })
      if (billable) return
    }
    await page.waitForTimeout(250)
  }
  if (projectionMissingQty) {
    throw new Error(
      `sale order ${orderId} lines are missing qtyToInvoice in /api/query/sale-order-lines projection`,
    )
  }
  if (!sawLine) {
    throw new Error(`sale order ${orderId} has no lines in query after confirm`)
  }
  throw new Error(`sale order ${orderId} has no billable lines after confirm`)
}

/** Poll until an outgoing picking exists for the sale order (post-confirm auto-create). */
export async function fetchFulfillmentPickingIdBySaleOrderId(
  page: Page,
  saleOrderId: number,
): Promise<number> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const orderRes = await page.request.get("/api/query/sale-orders")
    if (orderRes.ok()) {
      const orderJson = (await orderRes.json()) as {
        data?: Array<{ id?: unknown; pickingIds?: unknown; picking_ids?: unknown }>
      }
      const order = (orderJson.data ?? []).find((row) => scalarQueryId(row.id) === saleOrderId)
      const pickingIdsRaw = order?.pickingIds ?? order?.picking_ids
      if (Array.isArray(pickingIdsRaw) && pickingIdsRaw.length > 0) {
        const id = scalarQueryId(pickingIdsRaw[0])
        if (id != null) return id
      }
    }

    const res = await page.request.get("/api/query/stock-pickings")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{
          id?: unknown
          saleId?: unknown
          sale_id?: unknown
          isReturn?: unknown
          is_return?: unknown
          pickingCode?: unknown
          picking_code?: unknown
        }>
      }
      const picking = (json.data ?? []).find((row) => {
        const saleId = scalarQueryId(row.saleId ?? row.sale_id)
        const isReturn = row.isReturn ?? row.is_return
        if (saleId === saleOrderId && !isReturn) return true
        const code = String(row.pickingCode ?? row.picking_code ?? "").toLowerCase()
        return code === "outgoing" && saleId === saleOrderId
      })
      const id = scalarQueryId(picking?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`no outgoing picking found for sale order ${saleOrderId}`)
}

/** Poll until sale order lines show qty_delivered > 0 after picking validate. */
export async function waitForSaleOrderLineQtyDelivered(
  page: Page,
  orderId: number,
  minQty = 0.01,
) {
  const deadline = Date.now() + 45_000
  let sawLine = false
  let projectionMissingQty = false
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/sale-order-lines")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{
          orderId?: unknown
          order_id?: unknown
          qtyDelivered?: unknown
          qty_delivered?: unknown
          displayType?: unknown
          display_type?: unknown
        }>
      }
      const orderLines = (json.data ?? []).filter(
        (line) => scalarQueryId(line.orderId ?? line.order_id) === orderId,
      )
      if (orderLines.length > 0) {
        sawLine = true
        const hasQtyField = orderLines.some(
          (line) => line.qtyDelivered != null || line.qty_delivered != null,
        )
        if (!hasQtyField) projectionMissingQty = true
      }
      const delivered = orderLines.some((line) => {
        if (!isSaleOrderProductLine(line)) return false
        const qty = Number(line.qtyDelivered ?? line.qty_delivered ?? 0)
        return qty >= minQty
      })
      if (delivered) return
    }
    await page.waitForTimeout(250)
  }
  if (projectionMissingQty) {
    throw new Error(
      `sale order ${orderId} lines are missing qtyDelivered in /api/query/sale-order-lines projection`,
    )
  }
  if (!sawLine) {
    throw new Error(`sale order ${orderId} has no lines in query after picking validate`)
  }
  throw new Error(`sale order ${orderId} has no qty_delivered after picking validate`)
}

/** Poll until a fiscal year row with the given name appears in the BFF query. */
export async function fetchFiscalYearIdByName(page: Page, name: string): Promise<number> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/fiscal-years")
    if (res.ok()) {
      const json = (await res.json()) as { data?: Array<{ id?: unknown; name?: string }> }
      const row = (json.data ?? []).find((fy) => String(fy.name ?? "") === name)
      const id = scalarQueryId(row?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`fiscal year not found in query: ${name}`)
}

/** Poll until a proposal row with the given title appears in the BFF query. */
export async function fetchProposalIdByTitle(page: Page, title: string): Promise<number> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/proposals")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: unknown; title?: string }>
      }
      const matches = (json.data ?? []).filter((row) => String(row.title ?? "") === title)
      const newest = [...matches].sort(
        (a, b) => (scalarQueryId(b.id) ?? 0) - (scalarQueryId(a.id) ?? 0),
      )[0]
      const id = scalarQueryId(newest?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`proposal not found in query: ${title}`)
}

function paymentStateFromQuery(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    if ("tag" in obj) return String(obj.tag)
  }
  return String(value)
}

/** Partner, amount, and currency for an account move (invoice/bill). */
export async function fetchInvoiceMoveDetails(
  page: Page,
  moveId: number,
): Promise<{ partnerId: number; amountTotal: number; currencyId: number }> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/account-moves")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{
          id?: unknown
          partnerId?: unknown
          partner_id?: unknown
          amountTotal?: unknown
          amount_total?: unknown
          amountResidual?: unknown
          amount_residual?: unknown
          currencyId?: unknown
          currency_id?: unknown
        }>
      }
      const row = (json.data ?? []).find((m) => scalarQueryId(m.id) === moveId)
      if (row) {
        const partnerId = scalarQueryId(row.partnerId ?? row.partner_id)
        const currencyId = scalarQueryId(row.currencyId ?? row.currency_id)
        const amountTotal = Number(
          row.amountTotal ??
            row.amount_total ??
            row.amountResidual ??
            row.amount_residual ??
            0,
        )
        if (partnerId != null && currencyId != null && amountTotal > 0) {
          return { partnerId, amountTotal, currencyId }
        }
      }
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`invoice move ${moveId} not found or incomplete in query`)
}

/** Newest account payment id for a partner (optional state filter: NotPaid | Paid). */
export async function fetchLatestPaymentIdByPartner(
  page: Page,
  partnerId: number,
  options?: { state?: string },
): Promise<number> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/account-payments")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{
          id?: unknown
          partnerId?: unknown
          partner_id?: unknown
          state?: unknown
        }>
      }
      const matches = (json.data ?? []).filter((p) => {
        if (scalarQueryId(p.partnerId ?? p.partner_id) !== partnerId) return false
        if (options?.state) {
          return paymentStateFromQuery(p.state) === options.state
        }
        return true
      })
      if (matches.length > 0) {
        const newest = [...matches].sort(
          (a, b) => (scalarQueryId(b.id) ?? 0) - (scalarQueryId(a.id) ?? 0),
        )[0]
        const id = scalarQueryId(newest?.id)
        if (id != null) return id
      }
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`payment not found for partner ${partnerId}`)
}

/** Poll until payment state is Paid (after post_payment). */
export async function waitForPaymentPosted(page: Page, paymentId: number) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/account-payments")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: unknown; state?: unknown }>
      }
      const payment = (json.data ?? []).find((p) => scalarQueryId(p.id) === paymentId)
      if (payment && paymentStateFromQuery(payment.state) === "Paid") return
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`payment ${paymentId} was not posted`)
}

/** Draft customer invoice move id for a partner display name. */
export async function fetchDraftInvoiceMoveIdByPartner(
  page: Page,
  partnerName: string,
): Promise<number> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/account-moves")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{
          id?: number | string
          state?: string
          moveType?: string
          invoicePartnerDisplayName?: string
          partnerName?: string
        }>
      }
      const matches = (json.data ?? []).filter((m) => {
        const partner = String(m.invoicePartnerDisplayName ?? m.partnerName ?? "")
        const isDraft = scalarQueryString(m.state).toLowerCase() === "draft"
        return (
          isCustomerInvoiceMoveType(m.moveType) &&
          isDraft &&
          partner.includes(partnerName)
        )
      })
      const newest = [...matches].sort(
        (a, b) => (scalarQueryId(b.id) ?? 0) - (scalarQueryId(a.id) ?? 0),
      )[0]
      const id = scalarQueryId(newest?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`draft invoice not found for partner: ${partnerName}`)
}

function unwrapQueryOptionValue(value: unknown): unknown {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return value
  const obj = value as Record<string, unknown>
  if ("none" in obj) return null
  if ("some" in obj) return obj.some
  return value
}

function metadataReversedEntryId(metadata: unknown): number | null {
  const unwrapped = unwrapQueryOptionValue(metadata)
  if (unwrapped == null) return null
  const raw =
    typeof unwrapped === "string"
      ? unwrapped
      : typeof unwrapped === "object"
        ? JSON.stringify(unwrapped)
        : String(unwrapped)
  try {
    const parsed = JSON.parse(raw) as { reversed_entry_id?: unknown; reversedEntryId?: unknown }
    const id = Number(parsed.reversed_entry_id ?? parsed.reversedEntryId)
    return Number.isFinite(id) ? id : null
  } catch {
    return null
  }
}

/** Draft OutRefund move id linked to a posted source invoice via metadata.reversed_entry_id. */
export async function fetchDraftCreditNoteMoveIdForInvoice(
  page: Page,
  sourceInvoiceId: number,
): Promise<number> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/account-moves")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{
          id?: number | string
          state?: unknown
          moveType?: unknown
          metadata?: unknown
        }>
      }
      const match = (json.data ?? []).find((m) => {
        const isDraft = scalarQueryString(m.state).toLowerCase() === "draft"
        const isRefund = moveTypeTag(m.moveType).includes("refund")
        return (
          isDraft &&
          isRefund &&
          metadataReversedEntryId(m.metadata) === sourceInvoiceId
        )
      })
      const id = scalarQueryId(match?.id)
      if (id != null) return id

      const fallback = [...(json.data ?? [])]
        .filter((m) => {
          const isDraft = scalarQueryString(m.state).toLowerCase() === "draft"
          const isRefund = moveTypeTag(m.moveType).includes("refund")
          return isDraft && isRefund
        })
        .sort((a, b) => (scalarQueryId(b.id) ?? 0) - (scalarQueryId(a.id) ?? 0))[0]
      const fallbackId = scalarQueryId(fallback?.id)
      if (fallbackId != null) return fallbackId
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`draft credit note not found for invoice: ${sourceInvoiceId}`)
}

/** Post a draft customer credit note (OutRefund) via BFF `post_invoice`. */
export async function postDraftCreditNoteMove(page: Page, creditNoteId: number): Promise<void> {
  const organizationId = await fetchSessionOrganizationId(page)
  const cogsAccountId = await fetchAccountIdByCode(page, "5000")
  const inventoryAccountId = await fetchAccountIdByCode(page, "1400")
  await callReducerBff(page, "post_invoice", [
    organizationId,
    creditNoteId,
    cogsAccountId,
    inventoryAccountId,
  ])
  await waitForMovePosted(page, creditNoteId)
}

/** @deprecated Use {@link postDraftCreditNoteMove} — credit notes are not listed on journal entries. */
export async function postDraftCreditNoteViaGl(page: Page, partnerName: string): Promise<void> {
  await gotoModule(page, "/accounting", "accounting")
  await page.getByTestId("module-tab-accounting-invoices").click()
  const rows = activeTabCustomTableRows(page).filter({ hasText: partnerName })
  await expect(rows.first()).toBeVisible({ timeout: 30_000 })

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const count = await rows.count()
    for (let i = 0; i < count; i++) {
      await rows.nth(i).click()
      const modal = page.getByTestId("invoice-detail-modal")
      const postBtn = page.getByTestId("invoice-detail-post-draft")
      if (await modal.isVisible({ timeout: 3_000 }).catch(() => false)) {
        if (await postBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
          const [postRes] = await Promise.all([
            page.waitForResponse(
              (res) => res.url().includes("/api/call/post_invoice") && res.ok(),
              { timeout: 30_000 },
            ),
            postBtn.click(),
          ])
          expect(postRes.ok()).toBe(true)
          return
        }
        await page.keyboard.press("Escape")
      }
    }
    await page.waitForTimeout(250)
  }

  throw new Error(`draft credit note not found in invoices tab for partner: ${partnerName}`)
}

/** Label for the receive-goods line select (`PO {orderId} — {product} ({left} left)`). */
export async function fetchPurchaseOrderLineReceiveLabel(
  page: Page,
  orderId: number,
  lineId: number,
): Promise<string> {
  const [linesRes, productsRes] = await Promise.all([
    page.request.get("/api/query/purchase-order-lines"),
    page.request.get("/api/query/products"),
  ])
  if (!linesRes.ok()) throw new Error(`purchase-order-lines query failed: ${linesRes.status()}`)
  if (!productsRes.ok()) throw new Error(`products query failed: ${productsRes.status()}`)

  const linesJson = (await linesRes.json()) as { data?: Record<string, unknown>[] }
  const productsJson = (await productsRes.json()) as {
    data?: Array<{ id?: unknown; name?: string }>
  }
  const line = (linesJson.data ?? []).find((row) => scalarQueryId(row.id) === lineId)
  if (!line) throw new Error(`purchase order line ${lineId} not found`)

  const productId = scalarQueryId(line.productId ?? line.product_id)
  const product = (productsJson.data ?? []).find((p) => scalarQueryId(p.id) === productId)
  const productName = product?.name ?? `Product ${productId ?? "?"}`

  const pq = Number(line.productQty ?? line.product_qty ?? 0)
  const qr = Number(line.qtyReceived ?? line.qty_received ?? 0)
  const left = Math.max(0, pq - qr)
  const oid = scalarQueryId(line.orderId ?? line.order_id) ?? orderId
  return `PO ${oid} — ${productName} (${left} left)`
}

/** Sum debit/credit on move lines; throws when |debit − credit| ≥ 0.01. */
export async function assertMoveLinesBalanced(page: Page, moveId: number): Promise<void> {
  const res = await page.request.get("/api/query/account-move-lines")
  if (!res.ok()) throw new Error(`account-move-lines query failed: ${res.status()}`)

  const json = (await res.json()) as { data?: Record<string, unknown>[] }
  const lines = (json.data ?? []).filter(
    (row) => scalarQueryId(row.moveId ?? row.move_id) === moveId,
  )
  if (lines.length === 0) {
    throw new Error(`no move lines found for move ${moveId}`)
  }

  let debit = 0
  let credit = 0
  for (const row of lines) {
    debit += Number(row.debit ?? 0)
    credit += Number(row.credit ?? 0)
  }
  if (Math.abs(debit - credit) >= 0.01) {
    throw new Error(
      `move ${moveId} lines not balanced: debit=${debit} credit=${credit}`,
    )
  }
}

/** Poll until an account move reaches a posted state. */
export async function waitForMovePosted(page: Page, moveId: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/query/account-moves")
        if (!res.ok()) return ""
        const json = (await res.json()) as { data?: Array<{ id?: unknown; state?: unknown }> }
        const row = (json.data ?? []).find((m) => scalarQueryId(m.id) === moveId)
        return scalarQueryString(row?.state).toLowerCase()
      },
      { timeout: 30_000 },
    )
    .toMatch(/post/)
}

/** Open invoice detail and post draft via accounting invoices tab. */
export async function postDraftInvoiceViaUi(page: Page, partnerName: string): Promise<number> {
  const moveId = await fetchDraftInvoiceMoveIdByPartner(page, partnerName)

  await gotoModule(page, "/accounting", "accounting")
  await page.getByTestId("module-tab-accounting-invoices").click()
  const invoiceRow = activeTabCustomTableRows(page).filter({ hasText: partnerName }).first()
  await expect(invoiceRow).toBeVisible({ timeout: 30_000 })
  await invoiceRow.click()
  await expect(page.getByTestId("invoice-detail-modal")).toBeVisible({ timeout: 15_000 })

  const [postRes] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/api/call/post_invoice") && res.ok(),
      { timeout: 30_000 },
    ),
    page.getByTestId("invoice-detail-post-draft").click(),
  ])
  expect(postRes.ok()).toBe(true)
  await waitForMovePosted(page, moveId)
  return moveId
}

/** Open the newest draft vendor bill for a partner in the accounting Bills tab. */
async function openDraftVendorBillModal(page: Page, vendorName: string): Promise<void> {
  await gotoModule(page, "/accounting", "accounting")
  await page.getByTestId("module-tab-accounting-bills").click()
  const billRow = activeTabCustomTableRows(page)
    .filter({ hasText: vendorName })
    .filter({ has: page.getByText("Draft", { exact: true }) })
    .last()
  await expect(billRow).toBeVisible({ timeout: 30_000 })
  await billRow.click()
  await expect(page.getByTestId("invoice-detail-modal")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("invoice-detail-post-draft")).toBeVisible({ timeout: 15_000 })
}

/** Open vendor bill detail and post draft via accounting bills tab. */
export async function postDraftBillViaUi(page: Page, vendorName: string): Promise<number> {
  const moveId = await fetchDraftVendorBillMoveIdByPartner(page, vendorName)

  await openDraftVendorBillModal(page, vendorName)

  const [postRes] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/api/call/post_invoice"),
      { timeout: 30_000 },
    ),
    page.getByTestId("invoice-detail-post-draft").click(),
  ])
  await expectReducerHttpResponseOk("post_invoice", postRes)
  await waitForMovePosted(page, moveId)
  return moveId
}

/** Open vendor bill detail and expect post to fail (e.g. three-way match guard). */
export async function expectPostDraftBillRejected(
  page: Page,
  vendorName: string,
  errorPattern?: RegExp,
): Promise<void> {
  await fetchDraftVendorBillMoveIdByPartner(page, vendorName)

  await openDraftVendorBillModal(page, vendorName)

  const [postRes] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/api/call/post_invoice"),
      { timeout: 30_000 },
    ),
    page.getByTestId("invoice-detail-post-draft").click(),
  ])
  expect(postRes.ok()).toBe(false)
  if (errorPattern) {
    const json = (await postRes.json().catch(() => ({}))) as { error?: string }
    const detail = json.error ?? (await postRes.text().catch(() => ""))
    expect(detail).toMatch(errorPattern)
  }
}

/** Poll `/api/query/audit-log` until a row matches table (and optional action). */
export async function waitForAuditLogEntry(
  page: Page,
  tableName: string,
  action?: string,
): Promise<Record<string, unknown>> {
  let lastCount = 0
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/query/audit-log")
        if (!res.ok()) {
          throw new Error(`audit-log query failed: ${res.status()}`)
        }
        const json = (await res.json()) as { data?: Array<Record<string, unknown>> }
        const rows = json.data ?? []
        lastCount = rows.length
        return rows.find((row) => {
          const table = String(row.tableName ?? row.table_name ?? "")
          const rowAction = String(row.action ?? "")
          return table === tableName && (action == null || rowAction === action)
        })
      },
      { timeout: 45_000 },
    )
    .toBeTruthy()

  const res = await page.request.get("/api/query/audit-log")
  const json = (await res.json()) as { data?: Array<Record<string, unknown>> }
  const row = (json.data ?? []).find((entry) => {
    const table = String(entry.tableName ?? entry.table_name ?? "")
    const rowAction = String(entry.action ?? "")
    return table === tableName && (action == null || rowAction === action)
  })
  if (!row) {
    throw new Error(
      `audit log row missing for ${tableName}${action ? `/${action}` : ""} (rows=${lastCount})`,
    )
  }
  return row
}

/** Create a pending AI action draft (create_task) via BFF. */
export async function createAiActionDraftTask(
  page: Page,
  taskName: string,
): Promise<number> {
  await callReducerBff(
    page,
    "create_ai_action_draft",
    [
      {
        reducer_name: "create_task",
        params_json: JSON.stringify({ name: taskName }),
        summary: `Create task ${taskName}`,
        confidence: 0.95,
        elevated: false,
        warnings_json: null,
        source_query: "e2e",
        ui_context_json: null,
        expires_at: null,
        metadata: null,
      },
    ],
    { withCompany: true },
  )

  let draftId = 0
  await expect
    .poll(async () => {
      const res = await page.request.get("/api/query/ai-action-drafts-inbox")
      if (!res.ok()) {
        const body = await res.text()
        throw new Error(`ai-action-drafts-inbox query failed: ${res.status()} ${body}`)
      }
      const json = (await res.json()) as {
        data?: Array<{ id?: number | string; summary?: string; status?: string }>
      }
      const row = (json.data ?? []).find(
        (draft) => draft.summary?.includes(taskName) && (draft.status ?? "pending") === "pending",
      )
      if (row?.id == null) return 0
      draftId = Number(row.id)
      return draftId
    }, { timeout: 30_000 })
    .toBeGreaterThan(0)

  return draftId
}

/** Returns true when ai-gateway health endpoint responds OK. */
export async function isAiGatewayAvailable(page: Page): Promise<boolean> {
  const res = await page.request.get("/api/ai/health")
  if (!res.ok()) return false
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string }
  return json.ok === true || json.status === "ok"
}

/** Open ERP assistant from sidebar and wait for panel. */
export async function openErpAiChat(page: Page) {
  await page.getByTestId("sidebar-open-ai-chat").click()
  await expect(page.getByTestId("erp-ai-chat-panel")).toBeVisible({ timeout: 10_000 })
}

/** Assert overview KPI stat cards show live values (not placeholder em dash). */
export async function expectOverviewDashboardLive(page: Page) {
  await page.goto("/overview")
  await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)
  await expect(page.getByTestId("overview-dashboard")).toBeVisible()
  await expect(page.getByTestId("overview-widget-overview-stat-cards")).toBeVisible()
  await expect(page.getByTestId("overview-stat-open-sales-orders")).not.toHaveText("—")
  await expect(page.getByTestId("overview-stat-revenue")).toBeVisible()
  await expectNoAppError(page)
}

// ── Parity phase helpers (Phases 1–5) ────────────────────────────────────────

export async function gotoApprovals(page: Page) {
  await gotoModule(page, "/approvals")
  await expect(page.getByTestId("module-view-approvals")).toBeVisible()
}

export async function createApprovalRuleViaUi(
  page: Page,
  options: { name: string; threshold: string },
) {
  await gotoApprovals(page)
  await page.getByTestId("approval-rule-create").click()
  await page.getByTestId("approval-rule-name").fill(options.name)
  await page.getByTestId("approval-rule-threshold").fill(options.threshold)
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/call/create_approval_rule") && r.ok(),
      { timeout: 30_000 },
    ),
    page.getByTestId("approval-rule-submit").click(),
  ])
  expect(res.ok()).toBe(true)
}

export async function waitForPendingApprovalRequest(
  page: Page,
  model: string,
  resId: number,
): Promise<number> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/approval-requests-inbox")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{
          id?: unknown
          model?: string
          resId?: unknown
          res_id?: unknown
          status?: string
        }>
      }
      const row = (json.data ?? []).find((r) => {
        if (String(r.model ?? "") !== model) return false
        const rid = scalarQueryId(r.resId ?? r.res_id)
        if (rid !== resId) return false
        return String(r.status ?? "pending").toLowerCase() === "pending"
      })
      const id = scalarQueryId(row?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`pending approval not found for ${model}#${resId}`)
}

export async function rejectApprovalRequestViaUi(
  page: Page,
  requestId: number,
  reason: string,
) {
  await gotoApprovals(page)
  const card = page.getByTestId(`approval-card-${requestId}`)
  await expect(card).toBeVisible({ timeout: 30_000 })
  await page.getByTestId(`approval-reject-${requestId}`).click()
  await page.getByTestId(`approval-reject-reason-${requestId}`).fill(reason)
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/call/reject_approval_request") && r.ok(),
      { timeout: 30_000 },
    ),
    page.getByTestId(`approval-reject-confirm-${requestId}`).click(),
  ])
  expect(res.ok()).toBe(true)
}

export async function fetchAdminRoleId(page: Page): Promise<number> {
  const res = await page.request.get("/api/query/roles")
  if (!res.ok()) throw new Error(`roles query failed: ${res.status()}`)
  const json = (await res.json()) as {
    data?: Array<{ id?: unknown; name?: string; code?: string }>
  }
  const row =
    (json.data ?? []).find((r) => String(r.code ?? r.name ?? "").toLowerCase().includes("admin")) ??
    (json.data ?? [])[0]
  const id = scalarQueryId(row?.id)
  if (id == null) throw new Error("no role id found")
  return id
}

export async function grantPermissionViaSettings(
  page: Page,
  options: { roleId: number; resource: string; action?: string },
) {
  await gotoModule(page, "/settings")
  await page.getByTestId("settings-admin-action-grantPermission").click()
  await expect(page.getByTestId("form-modal-settings-grant-permission")).toBeVisible()
  // subjectType defaults to Role in settings form config
  await fillField(page, "subjectValue", String(options.roleId))
  await fillField(page, "resource", options.resource)
  if (options.action) {
    await chooseSelectOptionByLabel(page, "action", new RegExp(options.action, "i"))
  }
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/call/grant_permission") && r.ok(),
      { timeout: 30_000 },
    ),
    submitForm(page, "settings-grant-permission"),
  ])
  expect(res.ok()).toBe(true)
}

export async function fetchOrgPermissionId(
  page: Page,
  resource: string,
  options?: { roleId?: number },
): Promise<number> {
  const orgId = await fetchSessionOrganizationId(page)
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get(`/api/query/org-permissions?organizationId=${orgId}`)
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: unknown; resource?: string; roleId?: unknown; role_id?: unknown }>
      }
      const matches = (json.data ?? []).filter((r) => String(r.resource ?? "") === resource)
      const scoped =
        options?.roleId != null
          ? matches.filter(
              (r) => scalarQueryId(r.roleId ?? r.role_id) === options.roleId,
            )
          : matches
      const row = scoped.sort(
        (a, b) => (scalarQueryId(b.id) ?? 0) - (scalarQueryId(a.id) ?? 0),
      )[0]
      const id = scalarQueryId(row?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`org permission not found for resource: ${resource}`)
}

export async function waitForOrgPermissionAbsent(
  page: Page,
  resource: string,
  options?: { roleId?: number; timeoutMs?: number },
): Promise<void> {
  const orgId = await fetchSessionOrganizationId(page)
  const deadline = Date.now() + (options?.timeoutMs ?? 15_000)
  while (Date.now() < deadline) {
    const res = await page.request.get(`/api/query/org-permissions?organizationId=${orgId}`)
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: unknown; resource?: string; roleId?: unknown; role_id?: unknown }>
      }
      const matches = (json.data ?? []).filter((r) => String(r.resource ?? "") === resource)
      const scoped =
        options?.roleId != null
          ? matches.filter(
              (r) => scalarQueryId(r.roleId ?? r.role_id) === options.roleId,
            )
          : matches
      if (scoped.length === 0) return
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`org permission still present for resource: ${resource}`)
}

export async function revokePermissionViaSettings(page: Page, permissionId: number) {
  await gotoModule(page, "/settings")
  page.once("dialog", (dialog) => {
    void dialog.accept()
  })
  await page.getByTestId("settings-admin-action-revokePermission").click()
  await expect(page.getByTestId("form-modal-settings-revoke-permission")).toBeVisible()
  await fillField(page, "permissionId", String(permissionId))
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/call/revoke_permission") && r.ok(),
      { timeout: 30_000 },
    ),
    submitForm(page, "settings-revoke-permission"),
  ])
  expect(res.ok()).toBe(true)
}

export async function openFormConfigLeadForm(page: Page) {
  await gotoModule(page, "/settings")
  await page.getByTestId("settings-section-form-config").click()
  await page.getByTestId("form-config-module-crm").click()
  await page.getByTestId("form-config-form-new-lead").click()
}

export async function fetchCrmNewLeadFormConfigId(page: Page): Promise<number | null> {
  const orgId = await fetchSessionOrganizationId(page)
  const res = await page.request.get(`/api/query/form-configs?organizationId=${orgId}`)
  if (!res.ok()) return null
  const json = (await res.json()) as { data?: Record<string, unknown>[] }
  const row = (json.data ?? []).find(
    (r) =>
      Number(r.organization_id ?? r.organizationId) === orgId &&
      String(r.module_id ?? r.moduleId) === "crm" &&
      String(r.form_id ?? r.formId) === "new-lead",
  )
  return scalarQueryId(row?.id)
}

export async function ensureFormConfigDbFromRegistry(page: Page) {
  await openFormConfigLeadForm(page)
  const addField = page.getByTestId("form-config-add-field")
  if (await addField.isEnabled({ timeout: 5_000 }).catch(() => false)) return

  const existingId = await fetchCrmNewLeadFormConfigId(page)
  const pushBtn = page.getByTestId("form-config-push-registry")
  if (existingId == null && (await pushBtn.isEnabled({ timeout: 10_000 }).catch(() => false))) {
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/call/create_form_configuration") ||
          r.url().includes("/api/call/add_form_field"),
        { timeout: 90_000 },
      ),
      pushBtn.click(),
    ]).catch(() => {})
  }

  await expect
    .poll(
      async () => {
        await page.getByRole("button", { name: /refresh/i }).click().catch(() => {})
        await page.waitForTimeout(300)
        return addField.isEnabled()
      },
      { timeout: 60_000 },
    )
    .toBeTruthy()
}

export async function addCustomFormFieldViaSettings(
  page: Page,
  options: { fieldKey: string; fieldLabel: string },
) {
  const orgId = await fetchSessionOrganizationId(page)
  const fieldId = `custom:${options.fieldKey}`
  let configId = await fetchCrmNewLeadFormConfigId(page)

  if (configId == null) {
    await ensureFormConfigDbFromRegistry(page)
    configId = await fetchCrmNewLeadFormConfigId(page)
  }

  if (configId != null) {
    await callReducerBff(page, "add_form_field", [
      orgId,
      configId,
      {
        field_id: fieldId,
        name: options.fieldKey,
        label: options.fieldLabel,
        field_type: { text: [] },
        validation: { required: false },
        options: [],
        ai_suggestions: [],
        order: 999,
        is_system: false,
        is_enabled: true,
        show_in_list: false,
        width: { full: [] },
      },
    ])
    await openFormConfigLeadForm(page)
    await expect(page.getByTestId(`form-config-field-row-${fieldId}`)).toBeVisible({
      timeout: 30_000,
    })
    return
  }

  await ensureFormConfigDbFromRegistry(page)
  const addField = page.getByTestId("form-config-add-field")
  await expect(addField).toBeEnabled({ timeout: 30_000 })
  await addField.click()
  await page.getByTestId("form-config-field-key").fill(options.fieldKey)
  await page.getByRole("dialog").getByLabel(/label/i).fill(options.fieldLabel)
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/call/add_form_field") && r.ok(),
      { timeout: 30_000 },
    ),
    page.getByTestId("form-config-save-field").click(),
  ])
  expect(res.ok()).toBe(true)
}

export async function deleteCustomFormFieldViaSettings(page: Page, fieldId: string) {
  const orgId = await fetchSessionOrganizationId(page)
  const configId = await fetchCrmNewLeadFormConfigId(page)
  if (configId != null) {
    await callReducerBff(page, "delete_form_field", [orgId, configId, fieldId])
    await openFormConfigLeadForm(page)
    await expect(page.getByTestId(`form-config-field-row-${fieldId}`)).toHaveCount(0, {
      timeout: 15_000,
    })
    return
  }

  const row = page.getByTestId(`form-config-field-row-${fieldId}`)
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.locator("button").nth(1).click()
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/call/delete_form_field") && r.ok(),
      { timeout: 30_000 },
    ),
    page.getByTestId(`form-config-delete-field-${fieldId}`).click(),
  ])
  expect(res.ok()).toBe(true)
}

export async function openRecordChatterByRowText(page: Page, text: string | RegExp) {
  const row = activeTabEntityTable(page).locator("tbody tr").filter({ hasText: text }).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.click()
  await expect(page.getByTestId("record-chatter-dialog")).toBeVisible({ timeout: 15_000 })
}

export async function postChatterNote(page: Page, body: string) {
  await page.getByTestId("record-chatter-note").fill(body)
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/call/post_message") && r.ok(),
      { timeout: 30_000 },
    ),
    page.getByTestId("record-chatter-post").click(),
  ])
  expect(res.ok()).toBe(true)
}

export async function expectMailMessageForRecord(
  page: Page,
  options: { model: string; resId: number; bodyContains: string },
) {
  await expect
    .poll(async () => {
      const res = await page.request.get("/api/query/mail-messages")
      if (!res.ok()) return false
      const json = (await res.json()) as {
        data?: Array<{
          model?: string
          resId?: unknown
          res_id?: unknown
          body?: string
        }>
      }
      return (json.data ?? []).some((m) => {
        const rid = scalarQueryId(m.resId ?? m.res_id)
        return (
          String(m.model ?? "") === options.model &&
          rid === options.resId &&
          String(m.body ?? "").includes(options.bodyContains)
        )
      })
    }, { timeout: 30_000 })
    .toBe(true)
}

export async function openFiscalSetupWizard(page: Page) {
  await gotoModule(page, "/accounting", "accounting")
  await page.getByTestId("module-tab-accounting-fiscal-years").click()
  await page.getByTestId("entity-action-fy-setup-wizard").click()
  await expect(page.getByTestId("form-modal-fiscal-setup-wizard")).toBeVisible()
}

export async function savePivotReportViaUi(page: Page, name: string) {
  await gotoModule(page, "/reports", "reports")
  await page.getByTestId("module-tab-reports-pivot-explorer").click()
  await page.getByTestId("pivot-report-name").fill(name)
  const saveBtn = page.getByTestId("pivot-save-report")
  await expect(saveBtn).toBeEnabled({ timeout: 15_000 })
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/call/create_saved_report"),
      { timeout: 60_000 },
    ),
    saveBtn.click(),
  ])
  await expectReducerHttpResponseOk("create_saved_report", res)
}

/** Poll purchase order line match quantities via BFF before UI badge assertions. */
export async function waitForPoLineMatchStatus(
  page: Page,
  lineId: number,
  status: "matched" | "over_billed",
  timeoutMs = 60_000,
) {
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/query/purchase-order-lines")
        if (!res.ok()) return ""
        const json = (await res.json()) as { data?: Record<string, unknown>[] }
        const row = (json.data ?? []).find((r) => scalarQueryId(r.id) === lineId)
        if (!row) return ""
        const ordered = Number(row.productQty ?? row.product_qty ?? 0)
        const received = Number(row.qtyReceived ?? row.qty_received ?? 0)
        const billed = Number(row.qtyInvoiced ?? row.qty_invoiced ?? 0)
        const tolerance = 0.0001
        if (status === "matched") {
          return Math.abs(received - billed) <= tolerance && received <= ordered + tolerance
            ? "matched"
            : ""
        }
        if (billed > received + tolerance || billed > ordered + tolerance) {
          return "over_billed"
        }
        return ""
      },
      { timeout: timeoutMs },
    )
    .toBe(status)
}

export async function savedReportExistsByName(page: Page, name: string): Promise<boolean> {
  const orgId = await fetchSessionOrganizationId(page)
  const res = await page.request.get(`/api/query/saved-reports?organizationId=${orgId}`)
  if (!res.ok()) return false
  const json = (await res.json()) as { data?: Array<Record<string, unknown>> }
  const target = name.trim()
  return (json.data ?? []).some((r) => String(r.name ?? "").trim() === target)
}

export async function fetchSavedReportIdByName(page: Page, name: string): Promise<number> {
  const orgId = await fetchSessionOrganizationId(page)
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const res = await page.request.get(`/api/query/saved-reports?organizationId=${orgId}`)
    if (res.ok()) {
      const json = (await res.json()) as { data?: Array<Record<string, unknown>> }
      const rows = json.data ?? []
      const row = rows.find((r) => String(r.name ?? "").trim() === name.trim())
      const id = scalarQueryId(row?.id)
      if (id != null) return id
      const newest = [...rows].sort(
        (a, b) => (scalarQueryId(b.id) ?? 0) - (scalarQueryId(a.id) ?? 0),
      )[0]
      const newestId = scalarQueryId(newest?.id)
      if (newestId != null && String(newest?.name ?? "").trim() === name.trim()) return newestId
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`saved report not found: ${name}`)
}

export async function deletePivotReportViaUi(page: Page, reportName: string) {
  const reportId = await fetchSavedReportIdByName(page, reportName)
  await page.getByTestId("pivot-saved-select").click()
  await page.getByRole("option", { name: reportName }).click()
  await expect(page.getByTestId("pivot-delete-definition")).toBeVisible({ timeout: 10_000 })
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/call/delete_saved_report") && r.ok(),
      { timeout: 30_000 },
    ),
    page.getByTestId("pivot-delete-definition").click(),
  ])
  expect(res.ok()).toBe(true)
  await expect
    .poll(async () => !(await savedReportExistsByName(page, reportName)), { timeout: 15_000 })
    .toBe(true)
  void reportId
}

export async function generateVatReportViaUi(
  page: Page,
  options: { name: string; dateFrom: string; dateTo: string },
) {
  await gotoModule(page, "/reports", "reports")
  await page.getByTestId("module-tab-reports-vat-report").click()
  await page.getByLabel(/name/i).first().fill(options.name)
  await page.locator('input[type="date"]').first().fill(options.dateFrom)
  await page.locator('input[type="date"]').nth(1).fill(options.dateTo)
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/call/generate_eu_vat_report") && r.ok(),
      { timeout: 60_000 },
    ),
    page.getByTestId("vat-report-generate").click(),
  ])
  expect(res.ok()).toBe(true)
}

export async function waitForReturnOrderState(
  page: Page,
  returnOrderId: number,
  state: string,
): Promise<void> {
  const want = state.toLowerCase()
  await expect
    .poll(async () => {
      const res = await page.request.get("/api/query/return-orders")
      if (!res.ok()) return ""
      const json = (await res.json()) as { data?: Array<{ id?: unknown; state?: unknown }> }
      const row = (json.data ?? []).find((r) => scalarQueryId(r.id) === returnOrderId)
      return scalarQueryString(row?.state).toLowerCase()
    }, { timeout: 45_000 })
    .toBe(want)
}

export async function fetchReturnOrderIdBySaleOrderId(
  page: Page,
  saleOrderId: number,
): Promise<number> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/return-orders")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: unknown; saleOrderId?: unknown; sale_order_id?: unknown }>
      }
      const row = (json.data ?? []).find(
        (r) => scalarQueryId(r.saleOrderId ?? r.sale_order_id) === saleOrderId,
      )
      const id = scalarQueryId(row?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`return order not found for sale order ${saleOrderId}`)
}

export async function fetchDraftCreditNoteMoveIdForReturnOrder(
  page: Page,
  returnOrderId: number,
): Promise<number> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/return-orders")
    let creditMoveId: number | null = null
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: unknown; creditMoveId?: unknown; credit_move_id?: unknown }>
      }
      const row = (json.data ?? []).find((r) => scalarQueryId(r.id) === returnOrderId)
      creditMoveId = scalarQueryId(row?.creditMoveId ?? row?.credit_move_id)
    }
    const movesRes = await page.request.get("/api/query/account-moves")
    if (movesRes.ok()) {
      const movesJson = (await movesRes.json()) as {
        data?: Array<{ id?: unknown; state?: unknown; moveType?: unknown; invoiceOrigin?: unknown; invoice_origin?: unknown }>
      }
      const match = (movesJson.data ?? []).find((m) => {
        const id = scalarQueryId(m.id)
        if (creditMoveId != null && id === creditMoveId) return true
        const origin = String(m.invoiceOrigin ?? m.invoice_origin ?? "")
        return origin === `RMA${returnOrderId}` && moveTypeTag(m.moveType).includes("refund")
      })
      const id = scalarQueryId(match?.id)
      if (id != null && scalarQueryString(match?.state).toLowerCase() === "draft") return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`draft credit note not found for return order ${returnOrderId}`)
}

