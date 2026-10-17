import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { expect, test, type Page, type Request } from "@playwright/test"

import {
  fetchSessionOrganizationId,
  fillField,
  gotoModule,
  scalarQueryId,
  selectEntityRowById,
  waitForBffQueryMinRows,
  smokeName,
  submitForm,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

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
  await page.getByTestId("module-tab-reports-dashboards").click()
  await selectEntityRowById(page, dashboardId)
  const view = page.getByTestId("entity-action-view-dashboard")
  await expect(view).toBeEnabled()
  await view.click()
}

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
      await page.getByTestId("module-tab-reports-dashboards").click()
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
          widgetRequest = request
        }
      })
      await page.getByTestId("module-tab-reports-query-builder").click()
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

      const downloads: Awaited<ReturnType<Page["waitForEvent"]>>[] = []
      page.on("download", (download) => downloads.push(download))
      await page.getByRole("button", { name: /export/i }).first().click()
      await expect.poll(() => downloads.length, { timeout: 45_000 }).toBe(2)
      const named = new Map<string, string>()
      for (const download of downloads as Array<{
        suggestedFilename(): string
        path(): Promise<string | null>
      }>) {
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
        model: "sale_order",
      })
      expect(provenance.artifact.filename).toBe(pngName)
      expect(provenance.artifact.mimeType).toBe("image/png")
      expect(provenance.artifact.sha256).toBe(
        createHash("sha256").update(png).digest("hex"),
      )
      expect(String(provenance.domain)).toContain(String(widgetId))
    })
  },
)
