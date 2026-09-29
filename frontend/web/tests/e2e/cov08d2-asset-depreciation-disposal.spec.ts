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

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

const none = { none: [] as [] }

type Row = Record<string, unknown>

function timestamp(iso: string) {
  return {
    __timestamp_micros_since_unix_epoch__: new Date(iso).getTime() * 1000,
  }
}

function tagOf(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("tag" in value) {
      return String((value as { tag?: unknown }).tag ?? "")
    }
    const keys = Object.keys(value)
    if (keys.length === 1) {
      return keys[0]!.charAt(0).toUpperCase() + keys[0]!.slice(1)
    }
  }
  return String(value ?? "")
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

function companyOf(row: Row): number | null {
  return scalarQueryId(row.companyId ?? row.company_id)
}

async function pickAccount(
  page: Page,
  companyId: number,
  group: string,
): Promise<number> {
  const account = (await rows(page, "account-accounts")).find(
    (row) =>
      companyOf(row) === companyId &&
      tagOf(row.internalGroup ?? row.internal_group) === group &&
      row.deprecated !== true,
  )
  const id = scalarQueryId(account?.id)
  if (id == null) {
    throw new Error(`no active ${group} account for company ${companyId}`)
  }
  return id
}

async function pickGeneralJournal(
  page: Page,
  companyId: number,
): Promise<number> {
  const journal = (await rows(page, "account-journals")).find(
    (row) =>
      companyOf(row) === companyId &&
      tagOf(row.type ?? row.type_).toLowerCase() === "general" &&
      row.active !== false,
  )
  const id = scalarQueryId(journal?.id)
  if (id == null) {
    throw new Error(`no active general journal for company ${companyId}`)
  }
  return id
}

async function assetSnapshot(page: Page, assetId: number) {
  const row = (await rows(page, "account-assets")).find(
    (candidate) => scalarQueryId(candidate.id) === assetId,
  )
  if (!row) throw new Error(`asset not found: ${assetId}`)
  return {
    id: assetId,
    companyId: companyOf(row),
    state: tagOf(row.state),
  }
}

async function boardSnapshot(page: Page, assetId: number) {
  return (await rows(page, "depreciation-lines"))
    .filter(
      (row) => scalarQueryId(row.assetId ?? row.asset_id) === assetId,
    )
    .map((row) => ({
      id: scalarQueryId(row.id),
      companyId: companyOf(row),
      assetId: scalarQueryId(row.assetId ?? row.asset_id),
      sequence: Number(row.sequence ?? 0),
      amount: Number(row.amount ?? 0),
      remainingValue: Number(row.remainingValue ?? row.remaining_value ?? 0),
      depreciatedValue: Number(
        row.depreciatedValue ?? row.depreciated_value ?? 0,
      ),
    }))
    .sort((left, right) => left.sequence - right.sequence)
}

async function clickAssetAction(
  page: Page,
  assetId: number,
  actionId: string,
  reducer: string,
) {
  await gotoModule(page, "/accounting", "accounting")
  await page.getByTestId("module-tab-accounting-fixed-assets").click()
  const assetRow = page.getByTestId(`entity-row-${assetId}`)
  await expect(assetRow).toBeVisible({ timeout: 30_000 })
  await assetRow.click()
  const action = page.getByTestId(`entity-action-${actionId}`)
  await expect(action).toBeEnabled()
  const [accepted] = await Promise.all([
    page.waitForResponse(
      (response) => matchesOperationResponse(response, reducer),
      { timeout: 30_000 },
    ),
    action.click(),
  ])
  expect(accepted.ok()).toBe(true)
  return accepted
}

test.describe(
  "COV-08d2 fixed-asset depreciation and disposal exact effects",
  { tag: ["@p0", "@cov08", "@cov08d2"] },
  () => {
    test("computes one board, disposes the same asset, and preserves both effects on stale and denied replay", async ({
      browser,
      page,
    }) => {
      test.setTimeout(240_000)
      const organizationId = await fetchSessionOrganizationId(page)
      const companyId = await fetchDefaultCompanyId(page)
      const company = (await rows(page, "companies")).find(
        (row) => scalarQueryId(row.id) === companyId,
      )
      const currencyId = scalarQueryId(
        company?.currencyId ?? company?.currency_id,
      )
      if (currencyId == null) {
        throw new Error("default company has no currency")
      }

      const assetAccountId = await pickAccount(page, companyId, "Asset")
      const expenseAccountId = await pickAccount(page, companyId, "Expense")
      const journalId = await pickGeneralJournal(page, companyId)

      const code = smokeName("cov08d2-asset").slice(-24)
      await callReducerOwner("create_account_asset", [
        organizationId,
        companyId,
        {
          idempotency_key: code,
          code,
          name: `COV-08d2 asset ${code}`,
          active: true,
          asset_type: { purchase: [] },
          currency_id: currencyId,
          original_value: 1200,
          salvage_value: 0,
          method: { linear: [] },
          method_number: 12,
          method_period: 1,
          method_progress_factor: 0,
          prorata: false,
          prorata_date: none,
          account_asset_id: assetAccountId,
          account_depreciation_id: assetAccountId,
          account_depreciation_expense_id: expenseAccountId,
          journal_id: journalId,
          acquisition_date: timestamp("2026-01-01T00:00:00Z"),
          account_analytic_id: none,
          parent_id: none,
          gain_account_id: none,
          loss_account_id: none,
          account_disposal_id: none,
          first_depreciation_date: none,
          first_depreciation_date_manual: none,
          already_depreciated_amount_import: 0,
          is_imported: false,
          account_analytic_tag_ids: [],
          asset_lifetime_days: 365,
          asset_paused_days: 0,
          depreciation_schedule: none,
          metadata: none,
        },
      ])

      const created = (await rows(page, "account-assets")).find(
        (row) => row.code === code,
      )
      const assetId = scalarQueryId(created?.id)
      if (assetId == null) throw new Error("created asset not found")

      await clickAssetAction(
        page,
        assetId,
        "asset-confirm",
        "confirm_account_asset",
      )
      await expect
        .poll(() => assetSnapshot(page, assetId))
        .toEqual({ id: assetId, companyId, state: "Running" })

      const computed = await clickAssetAction(
        page,
        assetId,
        "asset-compute-depreciation",
        "compute_depreciation_board",
      )
      await expect.poll(() => boardSnapshot(page, assetId)).toHaveLength(12)
      const boardEffect = await boardSnapshot(page, assetId)
      expect(boardEffect.map((line) => line.sequence)).toEqual(
        Array.from({ length: 12 }, (_, index) => index + 1),
      )
      expect(
        boardEffect.every(
          (line) =>
            line.id != null &&
            line.companyId === companyId &&
            line.assetId === assetId,
        ),
      ).toBe(true)

      const staleCompute = await replay(page, computed.request())
      expect(staleCompute.status()).toBe(422)
      expect(await boardSnapshot(page, assetId)).toEqual(boardEffect)
      expect(await assetSnapshot(page, assetId)).toEqual({
        id: assetId,
        companyId,
        state: "Running",
      })

      const disposed = await clickAssetAction(
        page,
        assetId,
        "asset-dispose",
        "dispose_account_asset",
      )
      await expect
        .poll(() => assetSnapshot(page, assetId))
        .toEqual({ id: assetId, companyId, state: "Removed" })
      const disposedEffect = await assetSnapshot(page, assetId)

      const staleDispose = await replay(page, disposed.request())
      expect(staleDispose.status()).toBe(422)
      expect(await assetSnapshot(page, assetId)).toEqual(disposedEffect)
      expect(await boardSnapshot(page, assetId)).toEqual(boardEffect)

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
        const denied = await replay(readerPage, disposed.request())
        expect(denied.status()).toBe(403)
        expect(await assetSnapshot(page, assetId)).toEqual(disposedEffect)
        expect(await boardSnapshot(page, assetId)).toEqual(boardEffect)
      } finally {
        await readerContext.close()
      }
    })
  },
)
