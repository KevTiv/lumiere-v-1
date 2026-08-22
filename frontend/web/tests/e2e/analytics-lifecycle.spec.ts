/**
 * ANL-006: dashboard → widget → schedule lifecycle.
 *
 * The analytics module is served by the `/reports` route (no `/analytics` route
 * exists). Dashboards, widgets, and scheduled reports share the analytics
 * SpacetimeDB module (`spacetimedb/src/analytics/`).
 *
 * Reducers:
 * - `create_dashboard` (dashboards.rs) — named widget collection.
 * - `create_dashboard_widget` (dashboards.rs) — configurable chart/table/KPI.
 * - `add_widget_to_dashboard` (dashboards.rs) — links widget into a dashboard.
 * - `create_report_template` + `create_scheduled_report` (reports.rs) — the
 *   "schedule" step. There is no `schedule_dashboard` reducer; scheduled
 *   delivery is modelled on reports, so a template + scheduled report pair
 *   stands in for the schedule leg of ANL-006.
 *
 * Setup goes through the reducer BFF directly (matching the pattern in
 * accounting-post-reconcile.spec.ts and projects-wave-lifecycle.spec.ts) so the
 * UI interaction under test stays focused on rendering the created rows and the
 * dashboard creation form contract.
 */
import { expect, test, type Page } from "@playwright/test"

import {
  callReducerBff,
  expectNoAppError,
  fetchSessionOrganizationId,
  gotoModule,
  scalarQueryId,
  smokeName,
} from "./helpers"

const some = <T>(value: T) => ({ some: value })
const none = { none: [] as [] }

function stdbTimestampMicros(isoDate: string): { __timestamp_micros_since_unix_epoch__: number } {
  const micros = BigInt(new Date(isoDate).getTime()) * 1000n
  return { __timestamp_micros_since_unix_epoch__: Number(micros) }
}

async function fetchDashboardIdByName(page: Page, name: string): Promise<number> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/dashboards")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: number | string; name?: string }>
      }
      const row = (json.data ?? []).find((d) => d.name === name)
      const id = Number(row?.id)
      if (Number.isFinite(id) && id > 0) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`dashboard not found: ${name}`)
}

async function fetchWidgetIdByName(page: Page, name: string): Promise<number> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/dashboard-widgets")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: number | string; name?: string }>
      }
      const row = (json.data ?? []).find((w) => w.name === name)
      const id = Number(row?.id)
      if (Number.isFinite(id) && id > 0) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`dashboard widget not found: ${name}`)
}

async function fetchReportTemplateIdByName(page: Page, name: string): Promise<number> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/report-templates")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: number | string; name?: string }>
      }
      const row = (json.data ?? []).find((t) => t.name === name)
      const id = Number(row?.id)
      if (Number.isFinite(id) && id > 0) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`report template not found: ${name}`)
}

async function fetchScheduledReportIdByName(page: Page, name: string): Promise<number> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/scheduled-reports")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: number | string; name?: string }>
      }
      const row = (json.data ?? []).find((s) => s.name === name)
      const id = Number(row?.id)
      if (Number.isFinite(id) && id > 0) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`scheduled report not found: ${name}`)
}

async function fetchFirstCompanyId(page: Page): Promise<number> {
  const res = await page.request.get("/api/query/companies")
  if (!res.ok()) throw new Error(`companies query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Array<{ id?: number | string }> }
  const id = Number(json.data?.[0]?.id)
  if (!Number.isFinite(id) || id <= 0) throw new Error("no company in session")
  return id
}

test.describe("Analytics lifecycle e2e @analytics", () => {
  test("analytics module renders and exposes dashboard + widget creation @p0", async ({ page }) => {
    await gotoModule(page, "/reports", "reports")
    await page.getByTestId("module-tab-reports-dashboards").click()
    await expect(page.getByTestId("module-create-reports-dashboards")).toBeVisible()
    await page.getByTestId("module-tab-reports-dashboard-widgets").click()
    await expect(page.getByTestId("module-create-reports-dashboard-widgets")).toBeVisible()
    await expectNoAppError(page)
  })

  test("create dashboard → widget → add to dashboard; schedule report @p0", async ({ page }) => {
    test.setTimeout(120_000)
    await gotoModule(page, "/reports", "reports")
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchFirstCompanyId(page)

    const dashboardName = smokeName("anl-dash")
    const widgetName = smokeName("anl-widget")
    const templateName = smokeName("anl-tmpl")
    const scheduleName = smokeName("anl-sched")

    await callReducerBff(page, "create_dashboard", [
      organizationId,
      some(companyId),
      {
        name: dashboardName,
        is_default: false,
        is_system: false,
        description: none,
        share_with: [],
        share_with_groups: [],
        metadata: none,
      },
    ])

    const dashboardId = await fetchDashboardIdByName(page, dashboardName)

    await callReducerBff(page, "create_dashboard_widget", [
      organizationId,
      some(companyId),
      {
        name: widgetName,
        widget_type: { tag: "Chart" },
        model: "sale_order",
        fields: ["amount_total"],
        position_x: 0,
        position_y: 0,
        width: 6,
        height: 300,
        is_active: true,
        domain: none,
        group_by: none,
        aggregation: some("Sum"),
        chart_type: some("Bar"),
        sort_order: none,
        limit: none,
        refresh_interval: none,
        configuration: none,
        metadata: none,
      },
    ])

    const widgetId = await fetchWidgetIdByName(page, widgetName)

    await callReducerBff(page, "add_widget_to_dashboard", [
      organizationId,
      dashboardId,
      widgetId,
    ])

    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/query/dashboards")
          if (!res.ok()) return null
          const json = (await res.json()) as {
            data?: Array<{ id?: unknown; widgetIds?: unknown; widget_ids?: unknown }>
          }
          const row = (json.data ?? []).find((d) => scalarQueryId(d.id) === dashboardId)
          const ids = row?.widgetIds ?? row?.widget_ids
          return Array.isArray(ids) ? ids.includes(widgetId) : null
        },
        { timeout: 30_000 },
      )
      .toBe(true)

    await callReducerBff(page, "create_report_template", [
      organizationId,
      some(companyId),
      {
        name: templateName,
        model: "account_move",
        report_type: "PDF",
        orientation: "Portrait",
        margin_top: 0.5,
        margin_bottom: 0.5,
        margin_left: 0.5,
        margin_right: 0.5,
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

    const templateId = await fetchReportTemplateIdByName(page, templateName)

    await callReducerBff(page, "create_scheduled_report", [
      organizationId,
      some(companyId),
      {
        name: scheduleName,
        report_template_id: some(templateId),
        owner_report_key: none,
        timezone: some("UTC"),
        model: "account_move",
        frequency: "Daily",
        hour: 8,
        minute: 0,
        attachment_format: "PDF",
        next_run: stdbTimestampMicros(
          new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        ),
        is_active: true,
        recipients: ["analytics-lifecycle@example.test"],
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

    const scheduleId = await fetchScheduledReportIdByName(page, scheduleName)
    expect(scheduleId).toBeGreaterThan(0)

    await page.reload()
    await gotoModule(page, "/reports", "reports")
    await page.getByTestId("module-tab-reports-dashboards").click()
    await expect(page.getByText(dashboardName).first()).toBeVisible({ timeout: 45_000 })

    await page.getByTestId("module-tab-reports-dashboard-widgets").click()
    await expect(page.getByText(widgetName).first()).toBeVisible({ timeout: 45_000 })

    await page.getByTestId("module-tab-reports-scheduled-reports").click()
    await expect(page.getByText(scheduleName).first()).toBeVisible({ timeout: 45_000 })
    await expectNoAppError(page)
  })
})
