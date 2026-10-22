import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { expect, test, type Download, type Page, type Request } from "@playwright/test"

import {
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  fetchSessionOrganizationId,
  fillField,
  gotoModule,
  scalarQueryId,
  selectEntityRowById,
  selectModuleTab,
  waitForBffQueryMinRows,
  smokeName,
  submitForm,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"
import { readApiOutageControl } from "./api-outage"
import { provisionActor, withActor } from "./pretenant-support"

type Row = Record<string, unknown>

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) {
    throw new Error(`${resource} query failed: ${response.status()}`)
  }
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function openDashboardView(page: Page, dashboardId: number) {
  await gotoModule(page, "/reports", "reports")
  await selectModuleTab(page, "reports", "dashboards")
  await selectEntityRowById(page, dashboardId)
  const view = page.getByTestId("entity-action-view-dashboard")
  await expect(view).toBeEnabled()
  await view.click()
}

test.describe.configure({ mode: "serial" })

test.describe(
  "COV-20 dashboard compose → reject → view → export",
  { tag: ["@p0", "@cov20"] },
  () => {
    test("composes through the operator UI, rejects a malformed stored definition at write time, and exports with provenance", async ({
      page,
    }) => {
      test.setTimeout(300_000)
      await gotoModule(page, "/reports", "reports")
      const organizationId = await fetchSessionOrganizationId(page)

      // --- compose: dashboard through the operator form ---------------------
      const dashboardName = smokeName("cov20-dash")
      await selectModuleTab(page, "reports", "dashboards")
      await waitForBffQueryMinRows(page, "/api/query/companies")
      await page.getByTestId("module-create-reports-dashboards").click()
      await fillField(page, "name", dashboardName)
      const [dashboardCreated] = await Promise.all([
        page.waitForResponse(
          (response) => matchesOperationResponse(response, "create_dashboard"),
          { timeout: 45_000 },
        ),
        submitForm(page, "new-dashboard"),
      ])
      expect(dashboardCreated.ok(), await dashboardCreated.text()).toBe(true)
      const dashboard = (await rows(page, "dashboards")).find(
        (row) => row.name === dashboardName,
      )
      const dashboardId = scalarQueryId(dashboard?.id)
      const companyId = scalarQueryId(dashboard?.companyId ?? dashboard?.company_id)
      if (dashboardId == null || companyId == null) {
        throw new Error("created dashboard not found")
      }

      // --- compose: widget through the query builder, attached in the UI ----
      const widgetName = smokeName("cov20-widget")
      let widgetRequest: Request | null = null
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === "/api/operations/erp.create_dashboard_widget"
        ) {
          widgetRequest ??= request
        }
      })
      await selectModuleTab(page, "reports", "query-builder")
      await page.getByTestId("qb-model").click()
      await page.getByRole("option", { name: "Sale Order", exact: true }).click()
      await expect(page.getByTestId("qb-source-row-count")).toContainText(
        /\d+ rows? loaded/,
      )
      await page.getByTestId("qb-group-by").click()
      await page.getByRole("option", { name: "State", exact: true }).click()
      await page.getByTestId("qb-name").fill(widgetName)
      await page.getByTestId("qb-attach-dashboard").click()
      await page
        .getByRole("option", { name: dashboardName, exact: true })
        .first()
        .click()
      const [widgetCreated, widgetAttached] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes("/api/operations/erp.create_dashboard_widget"),
          { timeout: 45_000 },
        ),
        page.waitForResponse(
          (response) =>
            response.url().includes("/api/operations/erp.add_widget_to_dashboard"),
          { timeout: 45_000 },
        ),
        page.getByTestId("qb-save").click(),
      ])
      expect(widgetCreated.ok(), await widgetCreated.text()).toBe(true)
      expect(widgetAttached.ok(), await widgetAttached.text()).toBe(true)

      const widget = (await rows(page, "dashboard-widgets")).find(
        (row) => row.name === widgetName,
      )
      const widgetId = scalarQueryId(widget?.id)
      if (widgetId == null) throw new Error("created widget not found")
      expect(String(widget?.model ?? "")).toBe("sale_order")
      await expect
        .poll(async () => {
          const row = (await rows(page, "dashboards")).find(
            (candidate) => scalarQueryId(candidate.id) === dashboardId,
          )
          const ids = (row?.widgetIds ?? row?.widget_ids) as unknown[] | undefined
          return (ids ?? []).map((id) => scalarQueryId(id))
        })
        .toEqual([widgetId])

      // --- compose: a CRM-model widget; CRM reads are permission-gated ------
      const leadWidgetName = smokeName("cov20-lead-widget")
      await selectModuleTab(page, "reports", "query-builder")
      await page.getByTestId("qb-model").click()
      await page.getByRole("option", { name: "Lead", exact: true }).click()
      await expect(page.getByTestId("qb-source-row-count")).toContainText(
        /\d+ rows? loaded/,
      )
      await page.getByTestId("qb-group-by").click()
      await page
        .locator('[role="listbox"]:visible')
        .getByRole("option")
        .nth(1)
        .click()
      await page.getByTestId("qb-name").fill(leadWidgetName)
      await page.getByTestId("qb-attach-dashboard").click()
      await page
        .getByRole("option", { name: dashboardName, exact: true })
        .first()
        .click()
      const [leadCreated, leadAttached] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes("/api/operations/erp.create_dashboard_widget"),
          { timeout: 45_000 },
        ),
        page.waitForResponse(
          (response) =>
            response.url().includes("/api/operations/erp.add_widget_to_dashboard"),
          { timeout: 45_000 },
        ),
        page.getByTestId("qb-save").click(),
      ])
      expect(leadCreated.ok(), await leadCreated.text()).toBe(true)
      expect(leadAttached.ok(), await leadAttached.text()).toBe(true)
      const leadWidgetId = scalarQueryId(
        (await rows(page, "dashboard-widgets")).find(
          (row) => row.name === leadWidgetName,
        )?.id,
      )
      if (leadWidgetId == null) throw new Error("created lead widget not found")
      await expect
        .poll(async () => {
          const row = (await rows(page, "dashboards")).find(
            (candidate) => scalarQueryId(candidate.id) === dashboardId,
          )
          const ids = (row?.widgetIds ?? row?.widget_ids) as unknown[] | undefined
          return (ids ?? []).map((id) => scalarQueryId(id)).sort()
        })
        .toEqual([widgetId, leadWidgetId].sort())

      // --- write-time rejection (live reducer): malformed stored definitions
      const created = (widgetRequest as Request | null)
      if (!created) throw new Error("widget create request was not captured")
      const baseBody = created.postDataJSON() as {
        companyId?: unknown
        params: Record<string, unknown>
      }
      const widgetCountBefore = (await rows(page, "dashboard-widgets")).length
      const malformed: Array<[string, Record<string, unknown>]> = [
        ["domain-not-json", { domain: { some: "{oops" } }],
        ["domain-bad-operator", { domain: { some: '{"state":{"$regex":"x"}}' } }],
        ["domain-in-not-array", { domain: { some: '{"state":{"$in":"sale"}}' } }],
        ["sort-bad-direction", { sort_order: { some: '{"amount":"sideways"}' } }],
        [
          "binding-wrong-version",
          { configuration: { some: '{"version":2,"timeField":"date_order"}' } },
        ],
      ]
      for (const [label, patch] of malformed) {
        const rejected = await page.request.post(
          "/api/operations/erp.create_dashboard_widget",
          {
            headers: { "Content-Type": "application/json" },
            data: {
              ...baseBody,
              params: {
                ...baseBody.params,
                ...patch,
                name: `${widgetName}-${label}`,
                metadata: { none: [] },
              },
            },
          },
        )
        expect(rejected.ok(), `${label} must be rejected`).toBe(false)
      }
      expect(await rows(page, "dashboard-widgets")).toHaveLength(widgetCountBefore)
      expect(
        (await rows(page, "dashboard-widgets")).some((row) =>
          String(row.name ?? "").startsWith(`${widgetName}-`),
        ),
      ).toBe(false)

      // --- view the stored dashboard and export it with provenance ----------
      await openDashboardView(page, dashboardId)
      await expect(page.getByTestId("stored-dashboard-view-grid")).toBeVisible({
        timeout: 45_000,
      })
      await expect(page.getByTestId("stored-dashboard-denied")).toHaveCount(0)
      await expect(page.getByTestId("stored-dashboard-error")).toHaveCount(0)

      const downloads: Download[] = []
      page.on("download", (download) => downloads.push(download))
      await page.getByTestId("stored-dashboard-export").click()
      await expect.poll(() => downloads.length, { timeout: 45_000 }).toBe(2)
      const named = new Map<string, string>()
      for (const download of downloads) {
        const filePath = await download.path()
        if (filePath) named.set(download.suggestedFilename(), filePath)
      }
      const pngName = [...named.keys()].find((name) => name.endsWith(".png"))
      const provenanceName = [...named.keys()].find((name) =>
        name.endsWith(".provenance.json"),
      )
      if (!pngName || !provenanceName) {
        throw new Error(`unexpected export artifacts: ${[...named.keys()].join(", ")}`)
      }
      const png = await readFile(named.get(pngName)!)
      const provenance = JSON.parse(
        await readFile(named.get(provenanceName)!, "utf8"),
      ) as Record<string, unknown> & {
        artifact: { filename: string; mimeType: string; sha256: string }
      }
      expect(provenance).toMatchObject({
        organizationId: String(organizationId),
        companyId: String(companyId),
        dashboardId: String(dashboardId),
        model: "lead,sale_order",
      })
      expect(provenance.artifact.filename).toBe(pngName)
      expect(provenance.artifact.mimeType).toBe("image/png")
      expect(provenance.artifact.sha256).toBe(
        createHash("sha256").update(png).digest("hex"),
      )
      expect(String(provenance.domain)).toContain(String(widgetId))
      expect(String(provenance.domain)).toContain(String(leadWidgetId))

      // --- drill: a chart category opens the admitted list filtered by it ---
      await page
        .getByTestId("stored-dashboard-view-grid")
        .locator(".recharts-bar-rectangle")
        .first()
        .click()
      await expect
        .poll(() => {
          const url = new URL(page.url())
          return {
            path: url.pathname,
            tab: url.searchParams.get("tab"),
            filter: url.searchParams.getAll("filter").length === 1
              ? (url.searchParams.get("filter") ?? "").split(":")[0]
              : null,
          }
        }, { timeout: 30_000 })
        .toEqual({ path: "/sales", tab: "orders", filter: "state" })

      // --- live denial: dashboard and sales reads are admitted, but the lead
      // source answers 403, so the dashboard cannot be exported. -------------
      const reportViewer = await provisionActor(page, "cov20-report-viewer", [
        "report:read",
        "dashboard:read",
        "dashboard_widget:read",
        "sale_order:read",
      ], companyId)
      await withActor(page.context().browser()!, reportViewer, async (viewer) => {
        expect(
          (await rows(viewer, "dashboards")).some(
            (row) => scalarQueryId(row.id) === dashboardId,
          ),
          "report viewer can read the dashboard under test",
        ).toBe(true)
        const visibleWidgetIds = (await rows(viewer, "dashboard-widgets"))
          .map((row) => scalarQueryId(row.id))
        expect(visibleWidgetIds).toEqual(expect.arrayContaining([widgetId, leadWidgetId]))
        await rows(viewer, "sale-orders")
        const denied = await viewer.request.get("/api/query/leads")
        expect(denied.status()).toBe(403)
        const deniedPayload = await denied.json() as { error?: string }
        const deniedSourceMessage = deniedPayload.error ?? "Query leads failed"
        const [sourceRead] = await Promise.all([
          viewer.waitForResponse((response) =>
            response.request().method() === "GET"
            && new URL(response.url()).pathname === "/api/query/leads",
          ),
          openDashboardView(viewer, dashboardId),
        ])
        expect(sourceRead.status()).toBe(403)
        const alert = viewer.getByTestId("stored-dashboard-denied")
        await expect(alert).toBeVisible({ timeout: 45_000 })
        await expect(alert).toHaveAttribute("role", "alert")
        const blockedExport = viewer.getByTestId("stored-dashboard-export")
        await expect(blockedExport).toBeDisabled()
        await expect(blockedExport).toHaveAttribute("title", deniedSourceMessage)
      })
    })

    test("a real read-API outage shows an unavailable source, blocks export, and recovers on retry", async ({
      page,
    }) => {
      test.setTimeout(300_000)
      const apiOutage = readApiOutageControl()
      await gotoModule(page, "/reports", "reports")
      // Reuse the dashboard the previous test composed (serial mode): the seeded
      // dashboard's legacy widget settings are rejected by the fail-closed
      // resolver, so it can never be exported.
      const composed = (await rows(page, "dashboards"))
        .filter((row) => String(row.name ?? "").startsWith("smoke-cov20-dash"))
        .sort((a, b) => Number(scalarQueryId(b.id)) - Number(scalarQueryId(a.id)))[0]
      const dashboardId = scalarQueryId(composed?.id)
      if (dashboardId == null) throw new Error("the composed dashboard is required")

      await selectModuleTab(page, "reports", "dashboards")
      await selectEntityRowById(page, dashboardId)
      const view = page.getByTestId("entity-action-view-dashboard")
      await expect(view).toBeEnabled()

      let stopped = false
      try {
        // Make the real read API unreachable (no route mocking), then open the
        // dashboard so its source reads fail against the missing dependency.
        apiOutage.stop()
        stopped = true
        await view.click()
        const alert = page.getByTestId("stored-dashboard-error")
        await expect(alert).toBeVisible({ timeout: 60_000 })
        await expect(alert).toHaveAttribute("role", "alert")
        await expect(page.getByTestId("stored-dashboard-denied")).toHaveCount(0)
        await expect(
          page.getByTestId("stored-dashboard-export"),
        ).toBeDisabled()

        apiOutage.start()
        stopped = false
        await expect
          .poll(
            async () => {
              const res = await page.request.get("/api/query/sale-orders")
              return res.ok()
            },
            { timeout: 180_000 },
          )
          .toBe(true)

        await page.getByTestId("stored-dashboard-retry").click()
        await expect(page.getByTestId("stored-dashboard-error")).toHaveCount(0, {
          timeout: 60_000,
        })
        await expect(page.getByTestId("stored-dashboard-view-grid")).toBeVisible({
          timeout: 60_000,
        })
        await expect(
          page.getByTestId("stored-dashboard-export"),
        ).toBeEnabled()
      } finally {
        if (stopped) apiOutage.start()
      }
    })

    test("creates a template and a schedule through the operator forms and records its run", async ({
      page,
    }) => {
      test.setTimeout(240_000)
      await gotoModule(page, "/reports", "reports")
      const organizationId = await fetchSessionOrganizationId(page)

      const templateName = smokeName("cov20-op-template")
      await selectModuleTab(page, "reports", "report-templates")
      await page.getByTestId("module-create-reports-report-templates").click()
      await fillField(page, "name", templateName)
      await chooseSelectOptionByLabel(page, "reportSource", "Custom source (advanced)")
      await fillField(page, "model", "sale_order")
      const [templateCreated] = await Promise.all([
        page.waitForResponse(
          (response) => matchesOperationResponse(response, "create_report_template"),
          { timeout: 45_000 },
        ),
        submitForm(page, "new-report-template"),
      ])
      expect(templateCreated.ok(), await templateCreated.text()).toBe(true)
      const template = (await rows(page, "report-templates")).filter(
        (row) => row.name === templateName,
      )
      expect(template).toHaveLength(1)
      expect(template[0]?.model).toBe("sale_order")
      const templateId = scalarQueryId(template[0]?.id)
      if (templateId == null) throw new Error("created template not found")

      const scheduleName = smokeName("cov20-op-schedule")
      await selectModuleTab(page, "reports", "scheduled-reports")
      await page.getByTestId("module-create-reports-scheduled-reports").click()
      await fillField(page, "name", scheduleName)
      await chooseSelectOptionByLabel(page, "reportTemplateId", templateName)
      await chooseSelectOptionByLabel(page, "reportSource", "Custom source (advanced)")
      await fillField(page, "model", "sale_order")
      await page.getByTestId("form-field-nextRun").fill("2034-01-02T06:00")
      await fillField(page, "recipients", "ops@example.test")
      const [scheduleCreated] = await Promise.all([
        page.waitForResponse(
          (response) => matchesOperationResponse(response, "create_scheduled_report"),
          { timeout: 45_000 },
        ),
        submitForm(page, "new-scheduled-report"),
      ])
      expect(scheduleCreated.ok(), await scheduleCreated.text()).toBe(true)
      const schedules = (await rows(page, "scheduled-reports")).filter(
        (row) => row.name === scheduleName,
      )
      expect(schedules).toHaveLength(1)
      const reportId = scalarQueryId(schedules[0]?.id)
      if (reportId == null) throw new Error("created schedule not found")
      expect(
        scalarQueryId(schedules[0]?.organizationId ?? schedules[0]?.organization_id),
      ).toBe(organizationId)
      expect(Number(schedules[0]?.runCount ?? schedules[0]?.run_count ?? 0)).toBe(0)

      await selectEntityRowById(page, reportId)
      const action = page.getByTestId("entity-action-record-run")
      await expect(action).toBeEnabled()
      await action.click()
      await page.getByTestId("form-field-nextRun").fill("2035-01-02T06:00")
      const [recorded] = await Promise.all([
        page.waitForResponse(
          (response) => matchesOperationResponse(response, "record_report_run"),
          { timeout: 30_000 },
        ),
        page.getByTestId("form-submit-record-scheduled-run").click(),
      ])
      expect(recorded.ok(), await recorded.text()).toBe(true)
      await expect
        .poll(async () => {
          const row = (await rows(page, "scheduled-reports")).find(
            (candidate) => scalarQueryId(candidate.id) === reportId,
          )
          return Number(row?.runCount ?? row?.run_count ?? -1)
        })
        .toBe(1)
    })

    test("creates a widget through the Widgets tab form with the operating company", async ({
      page,
    }) => {
      test.setTimeout(120_000)
      await gotoModule(page, "/reports", "reports")
      await waitForBffQueryMinRows(page, "/api/query/companies")
      const widgetName = smokeName("cov20-tab-widget")
      await selectModuleTab(page, "reports", "dashboard-widgets")
      await page.getByTestId("module-create-reports-dashboard-widgets").click()
      await fillField(page, "name", widgetName)
      await chooseFirstEnabledOption(page, "widgetType")
      await chooseSelectOptionByLabel(page, "dataSource", /^Payments$/i)
      const [created] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes("/api/operations/erp.create_dashboard_widget"),
          { timeout: 45_000 },
        ),
        submitForm(page, "new-dashboard-widget"),
      ])
      expect(created.ok(), await created.text()).toBe(true)
      const widgets = (await rows(page, "dashboard-widgets")).filter(
        (row) => row.name === widgetName,
      )
      expect(widgets).toHaveLength(1)
      expect(String(widgets[0]?.model ?? "")).toBe("account_payment")
      expect(
        scalarQueryId(widgets[0]?.companyId ?? widgets[0]?.company_id),
      ).not.toBeNull()
    })
  },
)
