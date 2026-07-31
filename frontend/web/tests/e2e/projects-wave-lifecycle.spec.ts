/**
 * Projects Wave A lifecycle — create → task → log → validate/bill surfaces.
 *
 * Full SoD validate + bill sell-rate path is covered by `run_all_projects_tests`.
 * Same-session identity cannot self-validate; this spec asserts UI/BFF contracts
 * and documents the second-identity fixture gap for browser SoD.
 */
import { expect, test, type Page } from "@playwright/test"

import {
  callReducerBff,
  callReducerBffResult,
  expectNoAppError,
  fetchCurrencyIdByCode,
  fetchSessionOrganizationId,
  gotoModule,
  smokeName,
} from "./helpers"

const some = <T>(value: T) => ({ some: value })
const none = { none: [] as [] }

async function openProjectsTab(page: Page, tabId: string) {
  await page.getByTestId(`module-tab-projects-${tabId}`).click()
}

async function fetchFirstCompanyId(page: Page): Promise<number> {
  const res = await page.request.get("/api/query/companies")
  if (!res.ok()) throw new Error(`companies query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Array<{ id?: number | string }> }
  const id = Number(json.data?.[0]?.id)
  if (!Number.isFinite(id) || id <= 0) throw new Error("no company in session")
  return id
}

async function fetchFirstEmployeeId(page: Page): Promise<number> {
  const res = await page.request.get("/api/query/employees")
  if (!res.ok()) throw new Error(`employees query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Array<{ id?: number | string }> }
  const id = Number(json.data?.[0]?.id)
  if (!Number.isFinite(id) || id <= 0) throw new Error("no employee seeded")
  return id
}

async function fetchProjectIdByName(page: Page, name: string): Promise<number> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/projects")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: number | string; name?: string }>
      }
      const row = (json.data ?? []).find((p) => p.name === name)
      const id = Number(row?.id)
      if (Number.isFinite(id) && id > 0) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`project not found: ${name}`)
}

async function fetchTimesheetIdByName(page: Page, name: string): Promise<number> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/timesheets")
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
  throw new Error(`timesheet not found: ${name}`)
}

test.describe("Projects wave A lifecycle e2e @projects", () => {
  test("timesheet toolbar exposes validate + bill actions @p0", async ({ page }) => {
    await gotoModule(page, "/projects", "projects")
    await openProjectsTab(page, "timesheets")
    await expect(page.getByTestId("entity-action-validate-timesheets")).toBeVisible()
    await expect(page.getByTestId("entity-action-bill-timesheets")).toBeVisible()
    await expectNoAppError(page)
  })

  test("create project → task → log timesheet; self-validate SoD; queues query @p0", async ({
    page,
  }) => {
    await gotoModule(page, "/projects", "projects")
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchFirstCompanyId(page)
    const employeeId = await fetchFirstEmployeeId(page)
    const currencyId = await fetchCurrencyIdByCode(page, "USD")

    const projectName = smokeName("psa-proj")
    const taskName = smokeName("psa-task")
    const tsName = smokeName("psa-hours")

    await callReducerBff(page, "create_project", [
      organizationId,
      {
        company_id: some(companyId),
        name: projectName,
        description: none,
        active: true,
        sequence: 1,
        currency_id: currencyId,
        partner_id: none,
        partner_email: none,
        partner_phone: none,
        partner_company_id: none,
        date_start: none,
        date: none,
        date_end: none,
        allow_subtasks: true,
        allow_recurring_tasks: false,
        allow_task_dependencies: false,
        allow_timesheets: true,
        allow_timesheet_timer: true,
        allow_material: false,
        allow_worksheets: false,
        allow_forecast: false,
        allow_wip_je: false,
        bill_type: "customer_project",
        pricing_type: "task_rate",
        rating_status: "off",
        rating_status_period: "monthly",
        privacy_visibility: "employees",
        access_instruction_message: none,
        task_count: 0,
        task_count_open: 0,
        task_count_closed: 0,
        task_count_in_progress: 0,
        task_count_blocked: 0,
        sale_order_id: none,
        sale_line_id: none,
        last_update_status: "on_track",
        last_update_color: none,
        is_favorite: false,
        color: none,
        stage_id: none,
        analytic_account_id: none,
        activity_ids: [],
        activity_state: none,
        activity_date_deadline: none,
        activity_type_id: none,
        activity_user_id: none,
        activity_summary: none,
        message_follower_ids: [],
        message_ids: [],
        metadata: none,
      },
    ])

    const projectId = await fetchProjectIdByName(page, projectName)

    await callReducerBff(page, "create_task", [
      organizationId,
      {
        company_id: some(companyId),
        project_id: some(projectId),
        name: taskName,
        description: none,
        priority: "1",
        sequence: 1,
        stage_id: none,
        state: { tag: "InProgress" },
        kanban_state: "normal",
        date_deadline: none,
        date_start: none,
        date_end: none,
        color: none,
        user_ids: [],
        milestone_id: none,
        planned_hours: 8,
        total_hours_spent: 0,
        effective_hours: 0,
        progress: 0,
        remaining_hours: 8,
        sale_order_id: none,
        sale_line_id: none,
        partner_id: none,
        partner_email: none,
        parent_id: none,
        child_ids: [],
        subtask_count: 0,
        closed_subtask_count: 0,
        is_closed: false,
        is_blocked: false,
        allow_task_dependencies: false,
        depend_on_ids: [],
        dependent_ids: [],
        is_private: false,
        permitted_user_ids: [],
        activity_ids: [],
        activity_state: none,
        activity_date_deadline: none,
        activity_type_id: none,
        activity_user_id: none,
        activity_summary: none,
        message_follower_ids: [],
        message_ids: [],
        metadata: none,
      },
    ])

    const tasksRes = await page.request.get("/api/query/tasks")
    expect(tasksRes.ok()).toBeTruthy()
    const tasksJson = (await tasksRes.json()) as {
      data?: Array<{ id?: number | string; name?: string }>
    }
    const taskId = Number(tasksJson.data?.find((t) => t.name === taskName)?.id)
    expect(taskId).toBeGreaterThan(0)

    await callReducerBff(page, "log_timesheet", [
      organizationId,
      {
        company_id: some(companyId),
        project_id: projectId,
        task_id: some(taskId),
        employee_id: employeeId,
        name: tsName,
        date: { __timestamp_micros_since_unix_epoch__: Date.now() * 1000 },
        unit_amount: 2,
        currency_id: currencyId,
        employee_cost: 50,
        sell_rate: some(150),
        timesheet_invoice_type: some("billable"),
        product_id: none,
        product_uom_id: none,
        account_id: none,
        encoding_uom_id: 1,
        so_line: none,
        department_id: none,
        manager_id: none,
        metadata: none,
      },
    ])

    const timesheetId = await fetchTimesheetIdByName(page, tsName)
    expect(timesheetId).toBeGreaterThan(0)

    // Same identity as logger — SoD must fail (second identity covered in domain suite).
    const sod = await callReducerBffResult(page, "validate_timesheets", [
      organizationId,
      {
        company_id: some(companyId),
        timesheet_ids: [timesheetId],
      },
    ])
    expect(sod.ok).toBe(false)
    expect(sod.error ?? "").toMatch(/self-validate|validator equals logger/i)

    // Bounded ops-inbox queues must be queryable.
    const toValidate = await page.request.get("/api/query/timesheets-to-validate")
    expect(toValidate.ok()).toBeTruthy()
    const toValidateJson = (await toValidate.json()) as {
      data?: Array<{ id?: number | string; name?: string }>
    }
    expect((toValidateJson.data ?? []).some((r) => r.name === tsName)).toBe(true)

    const unbilled = await page.request.get("/api/query/timesheets-unbilled")
    expect(unbilled.ok()).toBeTruthy()

    await page.reload()
    await gotoModule(page, "/projects", "projects")
    await openProjectsTab(page, "timesheets")
    await expect(page.getByText(tsName).first()).toBeVisible({ timeout: 45_000 })
    await expectNoAppError(page)
  })

  test("bill form opens for timesheet selection @p0", async ({ page }) => {
    await gotoModule(page, "/projects", "projects")
    await openProjectsTab(page, "timesheets")
    await expect(page.getByTestId("entity-action-bill-timesheets")).toBeVisible()

    // Select first row when present so Bill modal can open.
    const row = page.locator("tbody tr").first()
    if (await row.isVisible().catch(() => false)) {
      await row.click()
      const billBtn = page.getByTestId("entity-action-bill-timesheets")
      if (await billBtn.isEnabled().catch(() => false)) {
        await billBtn.click()
        await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 })
      }
    }
    await expectNoAppError(page)
  })
})
