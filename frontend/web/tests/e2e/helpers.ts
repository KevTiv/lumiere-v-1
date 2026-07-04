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

export async function signIn(page: Page) {
  await page.goto("/sign-in")

  const email = page.getByLabel(/email/i)
  const emailVisible = await email
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false)

  if (!emailVisible) {
    await expect(page.getByTestId("dashboard-sidebar")).toBeVisible()
    await expectNoAppError(page)
    return
  }

  await email.fill(TEST_EMAIL)
  await page.getByLabel(/password/i).fill(TEST_PASSWORD)
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

export async function openSettingsSection(page: Page, sectionId: string) {
  await page.goto("/settings")
  await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)
  await expectAuthenticatedShell(page)
  const section = page.getByTestId(`settings-section-${sectionId}`)
  if ((await section.count()) === 0) {
    return
  }
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
  await page.getByTestId(`form-field-${name}`).fill(value)
}

export async function chooseFirstOption(page: Page, name: string) {
  await chooseFirstEnabledOption(page, name)
}

/** Pick the first non-disabled select option (skips empty placeholders). */
export async function chooseFirstEnabledOption(page: Page, name: string) {
  await page.getByTestId(`form-field-${name}`).click()
  const listbox = page.locator('[role="listbox"]')
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
  const v = row.state
  if (v != null && typeof v === "object" && "tag" in v) {
    return String((v as { tag: string }).tag)
  }
  return String(v ?? "")
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

/** Draft vendor bill move id for a partner display name. */
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
          state?: string
          moveType?: string
          move_type?: string
          invoicePartnerDisplayName?: string
          partnerName?: string
        }>
      }
      const row = json.data?.find((m) => {
        const partner = m.invoicePartnerDisplayName ?? m.partnerName ?? ""
        const moveType = String(m.moveType ?? m.move_type ?? "").toLowerCase()
        const isInInvoice = moveType.includes("in")
        const isDraft = (m.state ?? "").toLowerCase() === "draft"
        return isInInvoice && isDraft && partner.includes(partnerName)
      })
      if (row?.id != null) return Number(row.id)
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`draft vendor bill not found for partner: ${partnerName}`)
}

export async function fetchVendorPartnerIdByName(page: Page, name: string): Promise<number> {
  const res = await page.request.get("/api/query/contacts")
  if (!res.ok()) throw new Error(`contacts query failed: ${res.status()}`)
  const json = (await res.json()) as {
    data?: Array<{ id?: unknown; name?: string; displayName?: string; isVendor?: boolean }>
  }
  const row = (json.data ?? []).find(
    (c) =>
      (String(c.name ?? "").includes(name) || String(c.displayName ?? "").includes(name)) &&
      c.isVendor !== false,
  )
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
) {
  await page.getByTestId(`form-field-${name}`).click()
  const listbox = page.locator('[role="listbox"]')
  await expect(listbox).toBeVisible({ timeout: 15_000 })
  await listbox.getByRole("option", { name: label }).click()
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
  const row = page.locator('[data-testid="entity-table"] tbody tr').filter({ hasText: text }).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  if ((await row.getAttribute("data-state")) !== "selected") {
    await row.click()
    await expect(row).toHaveAttribute("data-state", "selected", { timeout: 10_000 })
  }
  await dismissBlockingDialogs(page)
}

/** Click an entity table row by its `data-testid="entity-row-{id}"` key. */
export async function selectEntityRowById(page: Page, id: number | string) {
  const row = page.getByTestId(`entity-row-${id}`)
  await expect(row).toBeVisible({ timeout: 30_000 })
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
  const qs = options?.withCompany ? "?withCompany=true" : ""
  const encodedArgs = encodeReducerCallArgs(reducer, args)
  const res = await page.request.post(`/api/call/${reducer}${qs}`, {
    data: JSON.parse(stringifyReducerCallBody(encodedArgs)),
    headers: { "Content-Type": "application/json" },
  })
  if (!res.ok()) {
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(json.error ?? `Reducer ${reducer} failed (${res.status()})`)
  }
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
        if (line.displayType != null || line.display_type != null) return false
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
        if (line.displayType != null || line.display_type != null) return false
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
      const delivered = (json.data ?? []).some((line) => {
        if (line.displayType != null || line.display_type != null) return false
        if (scalarQueryId(line.orderId ?? line.order_id) !== orderId) return false
        const qty = Number(line.qtyDelivered ?? line.qty_delivered ?? 0)
        return qty >= minQty
      })
      if (delivered) return
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`sale order ${orderId} has no qty_delivered after picking validate`)
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
      const row = json.data?.find((m) => {
        const partner = m.invoicePartnerDisplayName ?? m.partnerName ?? ""
        const isOutInvoice = (m.moveType ?? "").toLowerCase().includes("out")
        const isDraft = (m.state ?? "").toLowerCase() === "draft"
        return isOutInvoice && isDraft && partner.includes(partnerName)
      })
      if (row?.id != null) return Number(row.id)
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`draft invoice not found for partner: ${partnerName}`)
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
  await page.getByRole("row").filter({ hasText: partnerName }).first().click()
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

/** Open vendor bill detail and post draft via accounting bills tab. */
export async function postDraftBillViaUi(page: Page, vendorName: string): Promise<number> {
  const moveId = await fetchDraftVendorBillMoveIdByPartner(page, vendorName)

  await gotoModule(page, "/accounting", "accounting")
  await page.getByTestId("module-tab-accounting-bills").click()
  await page.getByRole("row").filter({ hasText: vendorName }).first().click()
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
