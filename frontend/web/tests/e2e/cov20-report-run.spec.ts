import { expect, test, type Page, type Request } from "@playwright/test"

import {
  callReducerBff,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  gotoModule,
  isoDateTimeLocal,
  scalarQueryId,
  selectEntityRowById,
  selectModuleTab,
  signIn,
  smokeName,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

// COV-20 — see docs/plan/erp-cov20-report-run-status.md.
const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

const none = { none: [] as [] }
const some = <T,>(value: T) => ({ some: value })

type Row = Record<string, unknown>

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) throw new Error(`${resource} query failed: ${response.status()}`)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function replay(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

async function scheduleSnapshot(page: Page, reportId: number) {
  const matches = (await rows(page, "scheduled-reports")).filter((row) => scalarQueryId(row.id) === reportId)
  if (matches.length !== 1) throw new Error(`expected one scheduled report ${reportId}, found ${matches.length}`)
  const row = matches[0]!
  return {
    id: reportId,
    organizationId: scalarQueryId(row.organizationId ?? row.organization_id),
    runCount: Number(row.runCount ?? row.run_count),
    hasLastRun: (row.lastRun ?? row.last_run ?? null) != null,
    nextRun: JSON.stringify(row.nextRun ?? row.next_run ?? null),
  }
}

test.describe("COV-20 exact scheduled report run", { tag: ["@p0", "@cov20"] }, () => {
  test("records one run through the UI and preserves the schedule on stale and denied replay", async ({
    browser,
    page,
  }) => {
    test.setTimeout(240_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)

    // Setup only: template and schedule are fixture data; the run under test
    // is recorded through the /reports Scheduled tab below.
    const templateName = smokeName("cov20-template")
    await callReducerBff(page, "create_report_template", [
      organizationId,
      some(companyId),
      {
        name: templateName,
        model: "sale_order",
        report_type: "qweb-pdf",
        orientation: "portrait",
        margin_top: 10,
        margin_bottom: 10,
        margin_left: 10,
        margin_right: 10,
        header_line: false,
        footer_line: false,
        attachment_use: false,
        multi_company: false,
        is_active: true,
        description: none,
        template_content: none,
        paper_format: none,
        print_report_name: none,
        attachment: none,
        metadata: none,
      },
    ])
    const template = (await rows(page, "report-templates")).filter((row) => row.name === templateName)
    expect(template).toHaveLength(1)
    const templateId = scalarQueryId(template[0]?.id)
    if (templateId == null) throw new Error("created template not found")

    const scheduleName = smokeName("cov20-schedule")
    await callReducerBff(page, "create_scheduled_report", [
      organizationId,
      some(companyId),
      {
        name: scheduleName,
        report_template_id: some(templateId),
        owner_report_key: none,
        timezone: none,
        model: "sale_order",
        frequency: "daily",
        hour: 6,
        minute: 0,
        attachment_format: "pdf",
        next_run: { __timestamp_micros_since_unix_epoch__: 1_900_000_000_000_000 },
        is_active: true,
        recipients: ["ops@example.test"],
        recipient_identities: [],
        description: none,
        domain: none,
        day_of_week: none,
        day_of_month: none,
        subject: none,
        body: none,
        metadata: none,
      },
    ])
    const created = (await rows(page, "scheduled-reports")).filter((row) => row.name === scheduleName)
    expect(created).toHaveLength(1)
    const reportId = scalarQueryId(created[0]?.id)
    if (reportId == null) throw new Error("created schedule not found")
    const initial = await scheduleSnapshot(page, reportId)
    expect(initial).toMatchObject({ id: reportId, organizationId, runCount: 0, hasLastRun: false })

    await gotoModule(page, "/reports", "reports")
    await selectModuleTab(page, "reports", "scheduled-reports")
    await selectEntityRowById(page, reportId)
    const action = page.getByTestId("entity-action-record-run")
    await expect(action).toBeEnabled()
    await action.click()
    // Year 2035 is later than the fixture's current next_run.
    await page.getByTestId("form-field-nextRun").fill(isoDateTimeLocal(2035, 1, 2, 6, 0))
    const [accepted] = await Promise.all([
      page.waitForResponse((response) => matchesOperationResponse(response, "record_report_run"), {
        timeout: 30_000,
      }),
      page.getByTestId("form-submit-record-scheduled-run").click(),
    ])
    expect(accepted.ok()).toBe(true)

    await expect
      .poll(async () => {
        const { nextRun, ...state } = await scheduleSnapshot(page, reportId)
        return { ...state, advanced: nextRun !== initial.nextRun }
      })
      .toEqual({ id: reportId, organizationId, runCount: 1, hasLastRun: true, advanced: true })
    const recorded = await scheduleSnapshot(page, reportId)

    // Before COV-20 a replay bumped run_count again; the same next_run is now stale.
    const stale = await replay(page, accepted.request())
    expect(stale.status()).toBe(422)
    expect(await scheduleSnapshot(page, reportId)).toEqual(recorded)

    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const readerPage = await readerContext.newPage()
    try {
      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      const denied = await replay(readerPage, accepted.request())
      expect(denied.status()).toBe(403)
      expect(await scheduleSnapshot(page, reportId)).toEqual(recorded)
    } finally {
      await readerContext.close()
    }
  })
})
