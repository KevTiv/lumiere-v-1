import { expect, test, type Page, type Request } from "@playwright/test"

import {
  callReducerOwner,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  gotoModule,
  scalarQueryId,
  signIn,
  smokeName,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

function timestamp(iso: string) {
  return { __timestamp_micros_since_unix_epoch__: new Date(iso).getTime() * 1000 }
}

async function rows(page: Page, resource: string): Promise<Array<Record<string, unknown>>> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) throw new Error(`${resource} query failed: ${response.status()}`)
  return ((await response.json()) as { data?: Array<Record<string, unknown>> }).data ?? []
}

async function replay(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

async function periodSnapshot(page: Page, periodId: number) {
  const row = (await rows(page, "account-periods")).find((candidate) => scalarQueryId(candidate.id) === periodId)
  if (!row) throw new Error(`period not found: ${periodId}`)
  const state = row.state && typeof row.state === "object" ? (row.state as { tag?: unknown }).tag : row.state
  return { id: periodId, state, writeDate: row.writeDate ?? row.write_date }
}

test.describe("COV-08c exact period close", { tag: ["@p0", "@cov08", "@cov08c"] }, () => {
  test("closes the selected period and preserves it on stale and denied replay", async ({ browser, page }) => {
    test.setTimeout(180_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)
    const suffix = Date.now() % 100000
    const year = 2200 + (suffix % 100)
    const yearName = smokeName(`cov08c-fy-${suffix}`)
    // Setup only: fiscal year and open period are fixture data, created with
    // the trusted owner call (the session compat route returns a redacted 500
    // for these accounting fixtures). The close is driven through the UI below.
    await callReducerOwner("create_fiscal_year", [organizationId, companyId, {
      name: yearName,
      date_from: timestamp(`${year}-01-01T00:00:00Z`),
      date_to: timestamp(`${year}-12-31T23:59:59Z`),
      // SATS field name is `type` (the Rust `type_` field is exposed as `type`).
      type: "normal",
      is_adjustment: false,
      notes: { none: [] },
      metadata: { none: [] },
    }])
    const fiscalYear = (await rows(page, "fiscal-years")).find((row) => row.name === yearName)
    const fiscalYearId = scalarQueryId(fiscalYear?.id)
    if (fiscalYearId == null) throw new Error("created fiscal year not found")
    // A period can only be opened inside a running (open) fiscal year.
    await callReducerOwner("open_fiscal_year", [organizationId, companyId, fiscalYearId])

    const periodName = smokeName(`cov08c-period-${suffix}`)
    await callReducerOwner("create_account_period", [organizationId, companyId, {
      name: periodName,
      code: `C08C${suffix}`,
      date_from: timestamp(`${year}-01-01T00:00:00Z`),
      date_to: timestamp(`${year}-01-31T23:59:59Z`),
      fiscal_year_id: fiscalYearId,
      is_adjustment: false,
      notes: { none: [] },
      metadata: { none: [] },
    }])
    const period = (await rows(page, "account-periods")).find((row) => row.name === periodName)
    const periodId = scalarQueryId(period?.id)
    if (periodId == null) throw new Error("created period not found")
    await callReducerOwner("open_account_period", [organizationId, companyId, periodId])

    await gotoModule(page, "accounting")
    await page.getByTestId("module-tab-accounting-account-periods").click()
    const periodRow = page.getByTestId(`entity-row-${periodId}`)
    await expect(periodRow).toContainText(periodName)
    // Clicking an open period selects it and opens its edit form; dismiss the
    // form so the table's Close action is reachable.
    await periodRow.click()
    const editDialog = page.getByRole("dialog")
    await expect(editDialog).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(editDialog).toBeHidden()
    const closeButton = page.getByTestId("entity-action-ap-close")
    await expect(closeButton).toBeEnabled()
    const [accepted] = await Promise.all([
      page.waitForResponse((response) => matchesOperationResponse(response, "close_account_period"), { timeout: 30_000 }),
      closeButton.click(),
    ])
    expect(accepted.ok()).toBe(true)
    await expect.poll(() => periodSnapshot(page, periodId)).toMatchObject({ id: periodId, state: "Closed" })
    const effect = await periodSnapshot(page, periodId)

    const stale = await replay(page, accepted.request())
    expect(stale.status()).toBe(422)
    expect(await periodSnapshot(page, periodId)).toEqual(effect)

    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const readerPage = await readerContext.newPage()
    try {
      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      const denied = await replay(readerPage, accepted.request())
      expect(denied.status()).toBe(403)
      expect(await periodSnapshot(page, periodId)).toEqual(effect)
    } finally {
      await readerContext.close()
    }
  })
})
