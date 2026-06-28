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
  await page.getByTestId(`form-field-${name}`).click()
  const option = page.getByRole("option").first()
  await expect(option).toBeVisible({ timeout: 15_000 })
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
  const row = page.locator('[data-testid="entity-table"] tbody tr').filter({ hasText: text }).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.click()
  await expect(row).toHaveAttribute("data-state", "selected")
  await dismissBlockingDialogs(page)
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

/** Draft customer invoice move id for a partner display name. */
export async function fetchDraftInvoiceMoveIdByPartner(
  page: Page,
  partnerName: string,
): Promise<number> {
  const res = await page.request.get("/api/query/account-moves")
  if (!res.ok()) throw new Error(`account-moves query failed: ${res.status()}`)
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
  if (row?.id == null) throw new Error(`draft invoice not found for partner: ${partnerName}`)
  return Number(row.id)
}
