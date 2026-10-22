import { expect, test, type Page } from "@playwright/test"
import { kpiDate } from "@lumiere/ui/lib/kpi-tiles"

import {
  callReducerOwner,
  chooseSelectOptionByTriggerValue,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  gotoModule,
  scalarQueryId,
  scalarQueryString,
  selectModuleTab,
  smokeName,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

const none = { none: [] as [] }

interface FinanceToolRow {
  readonly id?: unknown
  readonly name?: unknown
  readonly code?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly currencyId?: unknown
  readonly currency_id?: unknown
  readonly internalGroup?: unknown
  readonly internal_group?: unknown
  readonly type?: unknown
  readonly type_?: unknown
  readonly active?: unknown
  readonly deprecated?: unknown
  readonly state?: unknown
  readonly assetId?: unknown
  readonly asset_id?: unknown
  readonly sequence?: unknown
  readonly amount?: unknown
  readonly depreciationDate?: unknown
  readonly depreciation_date?: unknown
  readonly remainingValue?: unknown
  readonly remaining_value?: unknown
  readonly depreciatedValue?: unknown
  readonly depreciated_value?: unknown
  readonly depreciationBoardIds?: unknown
  readonly depreciation_board_ids?: unknown
  readonly dateFrom?: unknown
  readonly date_from?: unknown
  readonly dateTo?: unknown
  readonly date_to?: unknown
  readonly fiscalYearId?: unknown
  readonly fiscal_year_id?: unknown
}

function timestamp(iso: string) {
  return { __timestamp_micros_since_unix_epoch__: new Date(iso).getTime() * 1000 }
}

function requiredId(value: unknown, label: string): number {
  const id = scalarQueryId(value)
  if (id == null || !Number.isSafeInteger(id) || id <= 0)
    throw new Error(`${label} has no exact positive ID`)
  return id
}

function companyOf(row: FinanceToolRow): number | null {
  return scalarQueryId(row.companyId ?? row.company_id)
}

function savedNumber(value: unknown, label: string): number {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    value === "" ||
    !Number.isFinite(Number(value))
  ) {
    throw new Error(`${label} is not a saved finite number`)
  }
  return Number(value)
}

function savedDate(value: unknown, label: string): string {
  const date = kpiDate(value)
  if (!date) throw new Error(`${label} has no saved date`)
  return date.toISOString().slice(0, 10)
}

async function rows(page: Page, resource: string): Promise<FinanceToolRow[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) throw new Error(`${resource} query failed: ${response.status()}`)
  const body = (await response.json()) as { data?: FinanceToolRow[] }
  if (!Array.isArray(body.data)) throw new Error(`${resource} query returned no row collection`)
  return body.data
}

function exactlyOne(matches: FinanceToolRow[], label: string): FinanceToolRow {
  expect(matches, `${label} must resolve to exactly one saved record`).toHaveLength(1)
  return matches[0]!
}

async function assetRow(page: Page, companyId: number, assetId: number) {
  return exactlyOne(
    (await rows(page, "account-assets")).filter(
      (row) => companyOf(row) === companyId && scalarQueryId(row.id) === assetId,
    ),
    `asset ${assetId}`,
  )
}

async function boardSnapshot(page: Page, assetId: number) {
  return (await rows(page, "depreciation-lines"))
    .filter((row) => scalarQueryId(row.assetId ?? row.asset_id) === assetId)
    .map((row) => ({
      id: requiredId(row.id, "depreciation line"),
      companyId: companyOf(row),
      assetId: requiredId(row.assetId ?? row.asset_id, "depreciation asset"),
      sequence: savedNumber(row.sequence, "depreciation sequence"),
      date: savedDate(row.depreciationDate ?? row.depreciation_date, "depreciation date"),
      amount: savedNumber(row.amount, "depreciation amount"),
      remaining: savedNumber(row.remainingValue ?? row.remaining_value, "remaining value"),
      depreciated: savedNumber(row.depreciatedValue ?? row.depreciated_value, "depreciated value"),
    }))
    .sort((left, right) => left.sequence - right.sequence)
}

async function periodSnapshot(page: Page, companyId: number, periodId: number) {
  const period = exactlyOne(
    (await rows(page, "account-periods")).filter(
      (row) => scalarQueryId(row.id) === periodId && companyOf(row) === companyId,
    ),
    `period ${periodId}`,
  )
  return {
    id: requiredId(period.id, "period"),
    organizationId: requiredId(
      period.organizationId ?? period.organization_id,
      "period organization",
    ),
    companyId: companyOf(period),
    fiscalYearId: requiredId(period.fiscalYearId ?? period.fiscal_year_id, "period fiscal year"),
    state: scalarQueryString(period.state),
    dateFrom: savedDate(period.dateFrom ?? period.date_from, "period start"),
    dateTo: savedDate(period.dateTo ?? period.date_to, "period end"),
  }
}

test.describe(
  "Finance asset schedule and period close tools",
  { tag: ["@dev-fixture", "@finance-tools"] },
  () => {
    test("generates and views the exact saved monthly degressive schedule", async ({ page }) => {
      test.setTimeout(180_000)
      const organizationId = await fetchSessionOrganizationId(page)
      const companyId = await fetchDefaultCompanyId(page)
      const company = exactlyOne(
        (await rows(page, "companies")).filter((row) => scalarQueryId(row.id) === companyId),
        "operating company",
      )
      const currencyId = requiredId(company.currencyId ?? company.currency_id, "company currency")
      // Existing company accounts/journal are setup dependencies, not effect discovery.
      const accounts = (await rows(page, "account-accounts")).filter(
        (row) => companyOf(row) === companyId && row.deprecated !== true,
      )
      const assetAccountId = requiredId(
        accounts.find(
          (row) => scalarQueryString(row.internalGroup ?? row.internal_group) === "Asset",
        )?.id,
        "company asset account",
      )
      const expenseAccountId = requiredId(
        accounts.find(
          (row) => scalarQueryString(row.internalGroup ?? row.internal_group) === "Expense",
        )?.id,
        "company expense account",
      )
      const journalId = requiredId(
        (await rows(page, "account-journals")).find(
          (row) =>
            companyOf(row) === companyId &&
            row.active !== false &&
            scalarQueryString(row.type ?? row.type_).toLowerCase() === "general",
        )?.id,
        "company general journal",
      )
      const code = smokeName("finance-tool-asset").slice(-28)
      const assetName = `Finance tool schedule ${code}`
      // Setup only. Generation is performed exclusively by the new viewer below.
      await callReducerOwner("create_account_asset", [
        organizationId,
        companyId,
        {
          idempotency_key: code,
          code,
          name: assetName,
          active: true,
          asset_type: { purchase: [] },
          currency_id: currencyId,
          original_value: 1200,
          salvage_value: 0,
          method: { degressive: [] },
          method_number: 4,
          method_period: 1,
          method_progress_factor: 30,
          prorata: false,
          prorata_date: none,
          account_asset_id: assetAccountId,
          account_depreciation_id: assetAccountId,
          account_depreciation_expense_id: expenseAccountId,
          journal_id: journalId,
          acquisition_date: timestamp("2026-01-01T00:00:00Z"),
          first_depreciation_date: { some: timestamp("2026-01-31T00:00:00Z") },
          first_depreciation_date_manual: none,
          account_analytic_id: none,
          parent_id: none,
          gain_account_id: none,
          loss_account_id: none,
          account_disposal_id: none,
          already_depreciated_amount_import: 0,
          is_imported: false,
          account_analytic_tag_ids: [],
          asset_lifetime_days: 365,
          asset_paused_days: 0,
          depreciation_schedule: none,
          metadata: none,
        },
      ])
      const created = exactlyOne(
        (await rows(page, "account-assets")).filter(
          (row) => row.code === code && companyOf(row) === companyId,
        ),
        "setup-owned asset code",
      )
      const assetId = requiredId(created.id, "created asset")
      await callReducerOwner("confirm_account_asset", [organizationId, companyId, assetId])
      expect(scalarQueryString((await assetRow(page, companyId, assetId)).state)).toBe("Running")
      expect(await boardSnapshot(page, assetId)).toEqual([])

      await gotoModule(page, "/accounting", "accounting")
      await selectModuleTab(page, "accounting", "fixed-assets")
      const selectedAsset = page.getByTestId(`entity-row-${assetId}`)
      await expect(selectedAsset).toContainText(assetName)
      await selectedAsset.click()
      const viewer = page.getByTestId("asset-depreciation-schedule")
      await expect(viewer).toContainText(assetName)
      await expect(viewer).toContainText("No saved depreciation lines exist for this asset")
      const generate = viewer.getByRole("button", { name: "Generate saved schedule", exact: true })
      await expect(generate).toBeEnabled()
      const [generated] = await Promise.all([
        page.waitForResponse(
          (response) => matchesOperationResponse(response, "compute_depreciation_board"),
          { timeout: 30_000 },
        ),
        generate.click(),
      ])
      expect(generated.ok()).toBe(true)

      await expect.poll(() => boardSnapshot(page, assetId)).toHaveLength(4)
      const board = await boardSnapshot(page, assetId)
      const savedAsset = await assetRow(page, companyId, assetId)
      const boardIds = savedAsset.depreciationBoardIds ?? savedAsset.depreciation_board_ids
      expect(Array.isArray(boardIds), "owner asset must expose its exact saved board IDs").toBe(
        true,
      )
      expect((boardIds as unknown[]).map((value) => requiredId(value, "asset board line"))).toEqual(
        board.map((line) => line.id),
      )
      expect(new Set(board.map((line) => line.id)).size).toBe(4)
      expect(board.map((line) => line.sequence)).toEqual([1, 2, 3, 4])
      expect(board.map((line) => line.date)).toEqual([
        "2026-01-31",
        "2026-02-28",
        "2026-03-31",
        "2026-04-30",
      ])
      const expectedAmounts = [30, 29.25, 28.51875, 27.80578125]
      let cumulative = 0
      for (const [index, line] of board.entries()) {
        expect(line.companyId).toBe(companyId)
        expect(line.assetId).toBe(assetId)
        expect(line.amount).toBeCloseTo(expectedAmounts[index]!, 10)
        cumulative += line.amount
        expect(line.depreciated).toBeCloseTo(cumulative, 10)
        expect(line.remaining).toBeCloseTo(1200 - cumulative, 10)
      }
      await expect(viewer.getByRole("table")).toBeVisible()
      await expect(viewer.locator("tbody tr")).toHaveCount(board.length)
      for (const line of board) {
        const visibleLine = viewer.locator(`[data-line-id="${line.id}"]`)
        await expect(visibleLine.getByRole("cell").nth(0)).toHaveText(String(line.sequence))
        await expect(visibleLine.getByRole("cell").nth(1)).toHaveText(line.date)
        const displayed = await page.evaluate(
          (values) => {
            const format = new Intl.NumberFormat(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })
            return values.map((value) => format.format(value))
          },
          [line.amount, line.depreciated, line.remaining],
        )
        await expect(visibleLine.getByRole("cell").nth(2)).toHaveText(displayed[0]!)
        await expect(visibleLine.getByRole("cell").nth(3)).toHaveText(displayed[1]!)
        await expect(visibleLine.getByRole("cell").nth(4)).toHaveText(displayed[2]!)
      }
      await expect(generate).toHaveCount(0)
      await viewer.scrollIntoViewIfNeeded()
      await page.screenshot({
        path: test.info().outputPath("asset-saved-degressive-schedule.png"),
        fullPage: true,
      })
    })

    test("reviews and closes the exact selected accounting period through the checklist", async ({
      page,
    }) => {
      test.setTimeout(180_000)
      const organizationId = await fetchSessionOrganizationId(page)
      const companyId = await fetchDefaultCompanyId(page)
      const companyYears = (await rows(page, "fiscal-years")).filter(
        (row) => companyOf(row) === companyId,
      )
      // Choose an unused setup range, including on rerun. Dates never identify the created effect.
      let year = 2600
      while (
        companyYears.some((row) => {
          const from = kpiDate(row.dateFrom ?? row.date_from)
          const to = kpiDate(row.dateTo ?? row.date_to)
          if (!from || !to)
            throw new Error("cannot verify existing fiscal-year ranges for fixture setup")
          return (
            from.getTime() <= Date.parse(`${year}-12-31T23:59:59Z`) &&
            to.getTime() >= Date.parse(`${year}-01-01T00:00:00Z`)
          )
        })
      )
        year += 1
      if (year > 9999) throw new Error("no unused four-digit fiscal-year range for fixture setup")
      const yearName = smokeName("finance-tool-fiscal-year")
      await callReducerOwner("create_fiscal_year", [
        organizationId,
        companyId,
        {
          name: yearName,
          date_from: timestamp(`${year}-01-01T00:00:00Z`),
          date_to: timestamp(`${year}-12-31T23:59:59Z`),
          type: "normal",
          is_adjustment: false,
          notes: none,
          metadata: none,
        },
      ])
      const fiscalYear = exactlyOne(
        (await rows(page, "fiscal-years")).filter(
          (row) => row.name === yearName && companyOf(row) === companyId,
        ),
        "setup-owned fiscal-year name",
      )
      const fiscalYearId = requiredId(fiscalYear.id, "created fiscal year")
      await callReducerOwner("open_fiscal_year", [organizationId, companyId, fiscalYearId])
      const periodName = smokeName("finance-tool-close-period")
      const periodCode = smokeName("FTC").slice(-24)
      await callReducerOwner("create_account_period", [
        organizationId,
        companyId,
        {
          name: periodName,
          code: periodCode,
          date_from: timestamp(`${year}-01-01T00:00:00Z`),
          date_to: timestamp(`${year}-01-31T23:59:59Z`),
          fiscal_year_id: fiscalYearId,
          is_adjustment: false,
          notes: none,
          metadata: none,
        },
      ])
      const period = exactlyOne(
        (await rows(page, "account-periods")).filter(
          (row) =>
            row.name === periodName &&
            companyOf(row) === companyId &&
            scalarQueryId(row.fiscalYearId ?? row.fiscal_year_id) === fiscalYearId,
        ),
        "setup-owned period name and fiscal-year relation",
      )
      const periodId = requiredId(period.id, "created period")
      await callReducerOwner("open_account_period", [organizationId, companyId, periodId])
      const before = await periodSnapshot(page, companyId, periodId)
      expect(before).toEqual({
        id: periodId,
        organizationId,
        companyId,
        fiscalYearId,
        state: "Open",
        dateFrom: `${year}-01-01`,
        dateTo: `${year}-01-31`,
      })

      await gotoModule(page, "/accounting", "accounting")
      await selectModuleTab(page, "accounting", "period-close")
      await chooseSelectOptionByTriggerValue(
        page,
        page.getByTestId("period-close-target"),
        periodId,
      )
      const review = page.getByTestId("period-close-review")
      await expect(review).toContainText(periodName)
      await expect(review).toContainText(`${year}-01-01 – ${year}-01-31 (UTC)`)
      await expect(
        review
          .getByText("Confirmed draft journal entries", { exact: true })
          .locator("..")
          .locator("dd"),
      ).toHaveText("0")
      await expect(
        review
          .getByText("Confirmed unreconciled bank lines", { exact: true })
          .locator("..")
          .locator("dd"),
      ).toHaveText("0")
      await review.getByRole("button", { name: "Review close consequences", exact: true }).click()
      const dialog = page.getByRole("dialog", { name: "Review this period", exact: true })
      await expect(dialog).toContainText(periodName)
      await expect(dialog).toContainText(`${year}-01-01 – ${year}-01-31 (UTC)`)
      await expect(dialog).toContainText("Closing this period prevents new journal posting")
      await expect(dialog).toContainText(
        "It does not post drafts, reconcile bank lines, or generate reports",
      )
      const close = dialog.getByRole("button", { name: "Close selected period", exact: true })
      await expect(close).toBeEnabled()
      await page.screenshot({
        path: test.info().outputPath("period-close-consequences-review.png"),
        fullPage: true,
      })
      const [closed] = await Promise.all([
        page.waitForResponse(
          (response) => matchesOperationResponse(response, "close_account_period"),
          { timeout: 30_000 },
        ),
        close.click(),
      ])
      expect(closed.ok()).toBe(true)
      await expect
        .poll(() => periodSnapshot(page, companyId, periodId))
        .toEqual({ ...before, state: "Closed" })
      await expect(dialog).toBeHidden()
      await expect(review).toContainText("Closed")
      await expect(page.getByTestId("period-close-step-close-period")).toHaveAttribute(
        "data-status",
        "done",
      )
    })
  },
)
