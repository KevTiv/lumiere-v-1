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
  if (typeof value === "string") return value.toLowerCase()
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("tag" in value) {
      return String((value as { tag?: unknown }).tag ?? "").toLowerCase()
    }
    const keys = Object.keys(value)
    if (keys.length === 1) return keys[0]!.toLowerCase()
  }
  return ""
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

async function reportSnapshot(page: Page, reportId: number) {
  const row = (await rows(page, "financial-reports")).find(
    (candidate) => scalarQueryId(candidate.id) === reportId,
  )
  if (!row) throw new Error(`financial report not found: ${reportId}`)
  return {
    id: reportId,
    organizationId: scalarQueryId(
      row.organizationId ?? row.organization_id,
    ),
    companyId: scalarQueryId(row.companyId ?? row.company_id),
    state: tagOf(row.state),
  }
}

test.describe(
  "COV-08e Finance certification",
  { tag: ["@p0", "@cov08", "@cov08e"] },
  () => {
    test("archives the exact exported report and preserves it on stale and denied replay", async ({
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
      if (currencyId == null) throw new Error("default company has no currency")

      const name = smokeName("cov08e-report").slice(-28)
      await callReducerOwner("create_financial_report", [
        organizationId,
        companyId,
        {
          name,
          report_type: { trialBalance: [] },
          date_from: timestamp("2026-01-01T00:00:00Z"),
          date_to: timestamp("2026-01-31T00:00:00Z"),
          currency_id: currencyId,
          target_move: "posted",
          comparison_mode: "none",
          filter_analytic_account_ids: [],
          filter_account_ids: [],
          filter_partner_ids: [],
          filter_journal_ids: [],
          hierarchy_level: 0,
          show_zero_lines: true,
          show_hierarchy: false,
          show_percentage: false,
          show_debit_credit: true,
          report_data: none,
          export_format: none,
          exported_file_url: none,
          result_currency_id: currencyId,
          metadata: none,
        },
      ])

      const created = (await rows(page, "financial-reports")).find(
        (row) => row.name === name,
      )
      const reportId = scalarQueryId(created?.id)
      if (reportId == null) throw new Error("created financial report not found")

      await callReducerOwner("generate_financial_report", [
        organizationId,
        companyId,
        reportId,
      ])
      await callReducerOwner("export_financial_report", [
        organizationId,
        companyId,
        reportId,
        { export_format: "pdf" },
      ])
      await expect
        .poll(() => reportSnapshot(page, reportId))
        .toEqual({
          id: reportId,
          organizationId,
          companyId,
          state: "exported",
        })

      await gotoModule(page, "/reports", "reports")
      await page.getByTestId("module-tab-reports-financial-reports").click()
      const reportRow = page.getByTestId(`entity-row-${reportId}`)
      await expect(reportRow).toBeVisible({ timeout: 30_000 })
      await reportRow.click()

      const archiveAction = page.getByTestId("entity-action-arch")
      await expect(archiveAction).toBeEnabled()
      const [accepted] = await Promise.all([
        page.waitForResponse(
          (response) =>
            matchesOperationResponse(response, "archive_financial_report"),
          { timeout: 30_000 },
        ),
        archiveAction.click(),
      ])
      expect(accepted.ok()).toBe(true)

      await expect
        .poll(() => reportSnapshot(page, reportId))
        .toEqual({
          id: reportId,
          organizationId,
          companyId,
          state: "archived",
        })
      const effect = await reportSnapshot(page, reportId)

      const stale = await replay(page, accepted.request())
      expect(stale.status()).toBe(422)
      expect(await reportSnapshot(page, reportId)).toEqual(effect)

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
        const denied = await replay(readerPage, accepted.request())
        expect(denied.status()).toBe(403)
        expect(await reportSnapshot(page, reportId)).toEqual(effect)
      } finally {
        await readerContext.close()
      }
    })
  },
)
