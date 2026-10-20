import { expect, test, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { toCreateDashboardWidgetParams } from "@lumiere/erp-shared/reports-dashboard-params"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"

import {
  selectModuleTab,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  gotoModule,
  scalarQueryId,
  signIn,
} from "./helpers"

const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

async function postNamedOperation(
  page: Page,
  command: { urlPath: string; init: RequestInit },
): Promise<void> {
  const response = await page.request.post(command.urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(command.init.body)),
  })
  if (!response.ok()) {
    throw new Error(`Operation setup failed: ${response.status()} ${await response.text()}`)
  }
}

async function openSaleOrderQueryBuilder(page: Page): Promise<void> {
  await gotoModule(page, "/reports", "reports")
  await selectModuleTab(page, "reports", "query-builder")
  await page.getByTestId("qb-model").click()
  await page.getByRole("option", { name: "Sale Order", exact: true }).click()
}

test.describe("COV-26 Reports source quality", { tag: "@dev-fixture" }, () => {
  test("creates and attaches a widget by exact canonical request and relation", async ({
    browser,
    page,
  }) => {
    const organizationId = await fetchSessionOrganizationId(page)
    const dashboardsResponse = await page.request.get("/api/query/dashboards")
    expect(dashboardsResponse.ok()).toBe(true)
    const dashboardsJson = (await dashboardsResponse.json()) as {
      data?: Array<{ id?: unknown; name?: unknown }>
    }
    const dashboard = dashboardsJson.data?.find((row) => (scalarQueryId(row.id) ?? 0) > 0)
    const dashboardId = scalarQueryId(dashboard?.id)
    const dashboardName = String(dashboard?.name ?? "")
    if (dashboardId == null) throw new Error("Seeded dashboard is required")
    expect(dashboardId).toBeGreaterThan(0)
    expect(dashboardName).not.toBe("")

    const widgetName = `COV-26 exact widget ${Date.now()}`
    let creationMetadata = ""
    const wrongMetadata = `lumiere.dashboard-widget.create/v1:wrong-${Date.now()}`
    let attachedWidgetId = 0
    const acceptedCreate = { body: null as Record<string, unknown> | null }

    await page.route("**/api/operations/erp.create_dashboard_widget", async (route) => {
      const body = route.request().postDataJSON() as {
        companyId?: unknown
        params?: Record<string, unknown> & { metadata?: unknown }
      }
      const encodedMetadata = body.params?.metadata
      creationMetadata =
        encodedMetadata != null
        && typeof encodedMetadata === "object"
        && "some" in encodedMetadata
          ? String((encodedMetadata as { some: unknown }).some)
          : ""
      expect(creationMetadata).toMatch(/^lumiere\.dashboard-widget\.create\/v1:/)
      acceptedCreate.body = body as Record<string, unknown>
      const response = await route.fetch()
      if (!response.ok()) {
        throw new Error(
          `create_dashboard_widget failed: ${response.status()} ${await response.text()}`,
        )
      }

      // Create a higher-id same-name row before canonical readback. A name/newest
      // heuristic would attach this wrong row; the request-key resolver must not.
      const wrongResponse = await page.request.post(
        "/api/operations/erp.create_dashboard_widget",
        {
          data: {
            ...body,
            params: { ...body.params, metadata: { some: wrongMetadata } },
          },
        },
      )
      if (!wrongResponse.ok()) {
        throw new Error(
          `same-name dashboard widget setup failed: ${wrongResponse.status()} ${await wrongResponse.text()}`,
        )
      }
      await route.fulfill({ response })
    })
    await page.route("**/api/operations/erp.add_widget_to_dashboard", async (route) => {
      const body = route.request().postDataJSON() as {
        dashboardId?: unknown
        widgetId?: unknown
      }
      expect(scalarQueryId(body.dashboardId)).toBe(dashboardId)
      attachedWidgetId = scalarQueryId(body.widgetId) ?? 0
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      await route.fulfill({ response })
    })

    await openSaleOrderQueryBuilder(page)
    await expect(page.getByTestId("qb-source-row-count")).toContainText(/\d+ rows? loaded/)
    await page.getByTestId("qb-group-by").click()
    await page.getByRole("option", { name: "State", exact: true }).click()
    await page.getByTestId("qb-name").fill(widgetName)
    await page.getByTestId("qb-attach-dashboard").click()
    await page.getByRole("option", { name: dashboardName, exact: true }).first().click()
    await page.getByTestId("qb-save").click()

    const resultLink = page.getByTestId("qb-result-link")
    await expect(resultLink).toContainText("saved and added")
    await expect(resultLink).toHaveAttribute(
      "href",
      `/reports?tab=dashboards&filter=id:${dashboardId}`,
    )

    const widgetsResponse = await page.request.get("/api/query/dashboard-widgets")
    expect(widgetsResponse.ok()).toBe(true)
    const widgetsJson = (await widgetsResponse.json()) as {
      data?: Array<{ id?: unknown; name?: unknown; metadata?: unknown }>
    }
    const target = widgetsJson.data?.find(
      (row) => row.name === widgetName && row.metadata === creationMetadata,
    )
    const wrong = widgetsJson.data?.find(
      (row) => row.name === widgetName && row.metadata === wrongMetadata,
    )
    const targetId = scalarQueryId(target?.id)
    const wrongId = scalarQueryId(wrong?.id)
    expect(targetId).not.toBeNull()
    expect(wrongId).not.toBeNull()
    expect(wrongId).toBeGreaterThan(targetId ?? 0)
    expect(attachedWidgetId).toBe(targetId)

    const dashboardReadback = await page.request.get("/api/query/dashboards")
    expect(dashboardReadback.ok()).toBe(true)
    const dashboardJson = (await dashboardReadback.json()) as {
      data?: Array<{ id?: unknown; widgetIds?: unknown; widget_ids?: unknown }>
    }
    const persistedDashboard = dashboardJson.data?.find(
      (row) => scalarQueryId(row.id) === dashboardId,
    )
    const widgetIds = persistedDashboard?.widgetIds ?? persistedDashboard?.widget_ids
    expect(Array.isArray(widgetIds)).toBe(true)
    expect((widgetIds as unknown[]).map(scalarQueryId)).toContain(targetId)
    expect((widgetIds as unknown[]).map(scalarQueryId)).not.toContain(wrongId)

    const acceptedCreateBody = acceptedCreate.body
    if (acceptedCreateBody == null) throw new Error("Accepted create request was not captured")
    const acceptedParams = acceptedCreateBody.params
    if (acceptedParams == null || typeof acceptedParams !== "object") {
      throw new Error("Accepted create params were not captured")
    }
    const stale = await page.request.post("/api/operations/erp.create_dashboard_widget", {
      data: {
        ...acceptedCreateBody,
        params: { ...acceptedParams, name: `${widgetName} changed` },
      },
    })
    expect(stale.status()).toBe(422)

    const afterStale = await page.request.get("/api/query/dashboard-widgets")
    expect(afterStale.ok()).toBe(true)
    const afterStaleRows = ((await afterStale.json()) as {
      data?: Array<{ id?: unknown; metadata?: unknown }>
    }).data ?? []
    expect(afterStaleRows.filter((row) => row.metadata === creationMetadata)).toHaveLength(1)

    // Direct API requests cannot escape the session organization by supplying a
    // company id in the payload. Use a distinct request key so this proves scope
    // rejection rather than duplicate-request rejection.
    const foreignMetadata = `lumiere.dashboard-widget.create/v1:foreign-${Date.now()}`
    const foreignCompany = await page.request.post(
      "/api/operations/erp.create_dashboard_widget",
      {
        data: {
          ...acceptedCreateBody,
          companyId: Number.MAX_SAFE_INTEGER,
          params: { ...acceptedParams, metadata: { some: foreignMetadata } },
        },
      },
    )
    expect([403, 422]).toContain(foreignCompany.status())
    const afterForeignAttempt = await page.request.get("/api/query/dashboard-widgets")
    expect(afterForeignAttempt.ok()).toBe(true)
    expect((((await afterForeignAttempt.json()) as {
      data?: Array<{ metadata?: unknown }>
    }).data ?? []).some((row) => row.metadata === foreignMetadata)).toBe(false)

    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const readerPage = await readerContext.newPage()
    try {
      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      const denied = await readerPage.request.post(
        "/api/operations/erp.create_dashboard_widget",
        { data: acceptedCreateBody },
      )
      expect(denied.status()).toBe(403)
    } finally {
      await readerContext.close()
    }

    const afterDenial = await page.request.get("/api/query/dashboard-widgets")
    expect(afterDenial.ok()).toBe(true)
    const afterDenialRows = ((await afterDenial.json()) as {
      data?: Array<{ id?: unknown; metadata?: unknown }>
    }).data ?? []
    expect(afterDenialRows.filter((row) => row.metadata === creationMetadata)).toHaveLength(1)

    await resultLink.click()
    await expect(page).toHaveURL(
      new RegExp(`/reports\\?tab=dashboards&filter=id%3A${dashboardId}|/reports\\?tab=dashboards&filter=id:${dashboardId}`),
    )
    await page.reload()
    await selectModuleTab(page, "reports", "dashboards")
    const dashboardRow = page.getByTestId(`entity-row-${dashboardId}`)
    await expect(dashboardRow).toBeVisible()
    await dashboardRow.click()
    await page.getByTestId("entity-action-view-dashboard").click()
    await expect(page.getByRole("dialog", { name: dashboardName })).toBeVisible()
    const storedWidget = page.getByTestId(`stored-dashboard-widget-${targetId}`)
    await expect(storedWidget).toBeVisible()

    const csvDownload = page.waitForEvent("download")
    await storedWidget.getByRole("button", { name: new RegExp(`Export ${widgetName} as CSV`) }).click()
    const downloadedCsv = await csvDownload
    const csvPath = await downloadedCsv.path()
    if (!csvPath) throw new Error("CSV download path is required")
    const firstLine = (await readFile(csvPath, "utf8")).split("\r\n")[0] ?? ""
    expect(firstLine).toMatch(/^# lumiere-provenance:/)
    expect(JSON.parse(firstLine.replace("# lumiere-provenance:", ""))).toMatchObject({
      schema: "lumiere.report-export-provenance/v1",
      organizationId: String(organizationId),
      dashboardId: String(dashboardId),
      widgetId: String(targetId),
      model: "sale_order",
      groupBy: "state",
    })

    const drillPoint = storedWidget.locator(".recharts-bar-rectangle").first()
    await expect(drillPoint).toBeVisible()
    await drillPoint.click({ force: true })
    await expect(page).toHaveURL(/\/sales\?tab=orders&filter=state%3A/)
  })

  test("rejects a malformed operator at write time instead of persisting it", async ({ page }) => {
    // Render-time diagnostics for already-persisted malformed definitions are
    // covered by stored-dashboard-resolver.test.ts; the reducer now refuses to
    // create such a widget in the first place.
    const dashboardsResponse = await page.request.get("/api/query/dashboards")
    expect(dashboardsResponse.ok()).toBe(true)
    const dashboard = ((await dashboardsResponse.json()) as {
      data?: Array<{ id?: unknown; companyId?: unknown; company_id?: unknown }>
    }).data?.find((row) => (scalarQueryId(row.id) ?? 0) > 0)
    const companyId = scalarQueryId(dashboard?.companyId ?? dashboard?.company_id)
    if (companyId == null) throw new Error("Seeded dashboard and company are required")

    const widgetName = `COV-26 malformed filter ${Date.now()}`
    const command = stdbBffCommandPost("create_dashboard_widget", {
      companyId,
      params: stdbParamsToJson(toCreateDashboardWidgetParams({
        name: widgetName,
        widgetType: "chart",
        dataSource: "sale_order",
        fields: [],
        positionX: 0,
        positionY: 0,
        width: 6,
        height: 300,
        isActive: true,
        domain: JSON.stringify({ state: { $regex: "draft" } }),
        groupBy: "state",
        aggregation: "count",
        chartType: "bar",
        limit: 10,
        creationRequestId: `malformed-${Date.now()}`,
      }), "CreateDashboardWidgetParams"),
    })
    const rejected = await page.request.post(command.urlPath, {
      headers: { "Content-Type": "application/json" },
      data: JSON.parse(String(command.init.body)),
    })
    expect(rejected.status()).toBe(422)
    expect(await rejected.text()).toContain("Unsupported widget filter operator")

    const widgets = await page.request.get("/api/query/dashboard-widgets")
    expect(widgets.ok()).toBe(true)
    const rows = ((await widgets.json()) as { data?: Array<{ name?: unknown }> }).data ?? []
    expect(rows.some((row) => row.name === widgetName)).toBe(false)
  })

  test("distinguishes loading from a successful empty result at a mobile viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    let releaseResponse: (() => void) | undefined
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })
    await page.route("**/api/query/sale-orders", async (route) => {
      await responseGate
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"data":[]}' })
    })

    await openSaleOrderQueryBuilder(page)

    await expect(page.getByTestId("qb-source-loading")).toBeVisible()
    releaseResponse?.()
    await expect(page.getByTestId("qb-source-row-count")).toContainText("0 rows loaded")
    await expect(page.getByTestId("qb-preview-empty")).toBeVisible()
    await expect
      .poll(() =>
        page.getByTestId("query-builder").evaluate((element) =>
          element.scrollWidth <= element.clientWidth + 1,
        ),
      )
      .toBe(true)
  })

  test("renders denial as an alert and recovers by keyboard without stale success", async ({
    page,
  }) => {
    let response: "denied" | "empty" = "denied"
    let releaseRecovery: (() => void) | undefined
    const recoveryGate = new Promise<void>((resolve) => {
      releaseRecovery = resolve
    })
    await page.route("**/api/query/sale-orders", async (route) => {
      if (response === "denied") {
        await route.fulfill({
          status: 403,
          contentType: "application/json",
          body: '{"error":"read denied"}',
        })
        return
      }
      await recoveryGate
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"data":[]}' })
    })

    await openSaleOrderQueryBuilder(page)

    await expect(page.getByTestId("qb-source-denied")).toHaveAttribute("role", "alert")
    await expect(page.getByTestId("qb-preview-denied")).toHaveAttribute("role", "alert")
    await expect(page.getByTestId("qb-source-row-count")).toHaveCount(0)

    const retry = page.getByTestId("qb-source-retry")
    await retry.focus()
    await expect(retry).toBeFocused()
    response = "empty"
    await retry.press("Enter")

    await expect(page.getByTestId("qb-source-refreshing")).toBeVisible()
    releaseRecovery?.()
    await expect(page.getByTestId("qb-source-row-count")).toContainText("0 rows loaded")
    await expect(page.getByTestId("qb-model")).toBeFocused()
  })

  test("renders dependency failure as an error instead of empty data", async ({ page }) => {
    await page.route("**/api/query/sale-orders", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"dependency unavailable"}',
      })
    })

    await openSaleOrderQueryBuilder(page)

    await expect(page.getByTestId("qb-source-error")).toHaveAttribute("role", "alert")
    await expect(page.getByTestId("qb-preview-unavailable")).toBeVisible()
    await expect(page.getByTestId("qb-source-row-count")).toHaveCount(0)
  })

  test("recovers after a disconnected source read without retaining stale success", async ({
    page,
  }) => {
    let connected = false
    await page.route("**/api/query/sale-orders", async (route) => {
      if (!connected) {
        await route.abort("internetdisconnected")
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [{ id: 17, state: { tag: "Sale" }, amountTotal: 125 }] }),
      })
    })

    await openSaleOrderQueryBuilder(page)

    await expect(page.getByTestId("qb-source-error")).toHaveAttribute("role", "alert")
    await expect(page.getByTestId("qb-source-row-count")).toHaveCount(0)
    connected = true
    await page.getByTestId("qb-source-retry").click()

    await expect(page.getByTestId("qb-source-row-count")).toContainText("1 row loaded")
    await expect(page.getByTestId("qb-source-error")).toHaveCount(0)
    await expect(page.getByTestId("qb-model")).toBeFocused()
  })

  test("shows only saved report definitions for the active company", async ({ page }) => {
    const companyId = await fetchDefaultCompanyId(page)

    const currentName = `COV-26 current company ${Date.now()}`
    const foreignName = `COV-26 foreign company ${Date.now()}`
    await page.route("**/api/query/saved-reports", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            { id: 91, companyId, name: currentName },
            { id: 92, companyId: companyId + 1, name: foreignName },
          ],
        }),
      })
    })

    await gotoModule(page, "/reports", "reports")
    await selectModuleTab(page, "reports", "pivot-explorer")
    await page.getByTestId("pivot-saved-select").click()

    await expect(page.getByRole("option", { name: currentName, exact: true })).toBeVisible()
    await expect(page.getByRole("option", { name: foreignName, exact: true })).toHaveCount(0)
  })
})
