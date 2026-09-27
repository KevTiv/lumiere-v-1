import { expect, test, type Page, type Request, type Response } from "@playwright/test"

import {
  callReducerBff,
  fetchCurrencyIdByCode,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  gotoModule,
  scalarQueryId,
  signIn,
  smokeName,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

// COV-10 — see docs/plan/erp-cov10-project-timesheet-validation-status.md.
const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"
const VALIDATOR_EMAIL = "fixture.hr-project@example.test"

const none = { none: [] as [] }
const some = <T,>(value: T) => ({ some: value })

type Row = Record<string, unknown>

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) throw new Error(`${resource} query failed: ${response.status()}`)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function exactId(page: Page, resource: string, match: (row: Row) => boolean, label: string) {
  let id: number | null = null
  await expect
    .poll(async () => {
      const matches = (await rows(page, resource)).filter(match)
      id = matches.length === 1 ? scalarQueryId(matches[0]?.id) : null
      return matches.length
    }, { timeout: 30_000, message: `${label} must resolve to exactly one row` })
    .toBe(1)
  if (id == null) throw new Error(`${label} has no id`)
  return id
}

async function replay(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

/**
 * Exact placement of one timesheet in the two server-filtered worklists:
 * `timesheets-to-validate` holds drafts; `timesheets-unbilled` holds
 * validated, billable, not-yet-invoiced entries.
 */
async function worklistSnapshot(page: Page, timesheetId: number) {
  const place = async (resource: string) => {
    const matches = (await rows(page, resource)).filter((row) => scalarQueryId(row.id) === timesheetId)
    if (matches.length > 1) throw new Error(`${resource} returned timesheet ${timesheetId} ${matches.length} times`)
    const row = matches[0]
    if (!row) return null
    return {
      organizationId: scalarQueryId(row.organizationId ?? row.organization_id),
      companyId: scalarQueryId(row.companyId ?? row.company_id),
      validationStatus: String(row.validationStatus ?? row.validation_status ?? ""),
      invoiceId: scalarQueryId(row.timesheetInvoiceId ?? row.timesheet_invoice_id),
    }
  }
  return {
    toValidate: await place("timesheets-to-validate"),
    unbilled: await place("timesheets-unbilled"),
  }
}

async function runTimesheetAction(page: Page, timesheetId: number, actionId: string, reducer: string): Promise<Response> {
  await gotoModule(page, "/projects", "projects")
  await page.getByTestId("module-tab-projects-timesheets").click()
  const timesheetRow = page.getByTestId(`entity-row-${timesheetId}`)
  await expect(timesheetRow).toBeVisible({ timeout: 30_000 })
  await timesheetRow.click()
  const action = page.getByTestId(`entity-action-${actionId}`)
  await expect(action).toBeEnabled()
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => matchesOperationResponse(candidate, reducer), { timeout: 30_000 }),
    action.click(),
  ])
  return response
}

test.describe("COV-10 exact timesheet validation / rejection", { tag: ["@p0", "@cov10"] }, () => {
  test("a second person validates and rejects; self-validation, replays and reader are rejected", async ({
    browser,
    page,
  }) => {
    test.setTimeout(300_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)
    const currencyId = await fetchCurrencyIdByCode(page, "USD")
    const employees = await rows(page, "employees")
    const employeeId = scalarQueryId(
      employees.find((row) => scalarQueryId(row.companyId ?? row.company_id) === companyId)?.id,
    )
    if (employeeId == null) throw new Error("no employee in the default company")

    // ── Fixtures (setup calls only; the admin is the logger) ────────────────
    const tag = smokeName("cov10")
    const projectName = `${tag}-project`
    await callReducerBff(page, "create_project", [organizationId, {
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
    }])
    const projectId = await exactId(page, "projects", (row) => row.name === projectName, "COV-10 project")

    const taskName = `${tag}-task`
    await callReducerBff(page, "create_task", [organizationId, {
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
      wbs_code: "",
      wbs_level: 0,
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
    }])
    const taskId = await exactId(page, "tasks", (row) => row.name === taskName, "COV-10 task")

    const logHours = async (name: string) => {
      await callReducerBff(page, "log_timesheet", [organizationId, {
        company_id: some(companyId),
        project_id: projectId,
        task_id: some(taskId),
        employee_id: employeeId,
        name,
        date: { __timestamp_micros_since_unix_epoch__: Date.now() * 1000 },
        unit_amount: 2,
        currency_id: currencyId,
        employee_cost: some(50),
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
      }])
      return exactId(page, "timesheets-to-validate", (row) => row.name === name, name)
    }
    const toValidate = await logHours(`${tag}-validate`)
    const toReject = await logHours(`${tag}-reject`)

    const draft = { organizationId, companyId, validationStatus: "draft", invoiceId: null }
    for (const id of [toValidate, toReject]) {
      expect(await worklistSnapshot(page, id)).toEqual({ toValidate: draft, unbilled: null })
    }

    // Separation of duties through the UI: the logger cannot validate.
    const selfValidation = await runTimesheetAction(page, toValidate, "validate-timesheets", "validate_timesheets")
    expect(selfValidation.status()).toBe(422)
    expect(await worklistSnapshot(page, toValidate)).toEqual({ toValidate: draft, unbilled: null })

    const validatorContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const validatorPage = await validatorContext.newPage()
    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const readerPage = await readerContext.newPage()
    try {
      await signIn(validatorPage, VALIDATOR_EMAIL, PERSONA_PASSWORD)

      const validated = await runTimesheetAction(validatorPage, toValidate, "validate-timesheets", "validate_timesheets")
      expect(validated.ok()).toBe(true)
      const validatedEffect = {
        toValidate: null,
        unbilled: { organizationId, companyId, validationStatus: "validated", invoiceId: null },
      }
      await expect.poll(() => worklistSnapshot(page, toValidate), { timeout: 30_000 }).toEqual(validatedEffect)
      const staleValidate = await replay(validatorPage, validated.request())
      expect(staleValidate.status()).toBe(422)
      expect(await worklistSnapshot(page, toValidate)).toEqual(validatedEffect)

      // A rejected entry leaves the draft worklist and never reaches billing.
      // Its `rejected` state is not projected yet (see the status card).
      const rejected = await runTimesheetAction(validatorPage, toReject, "reject-timesheets", "reject_timesheets")
      expect(rejected.ok()).toBe(true)
      const rejectedEffect = { toValidate: null, unbilled: null }
      await expect.poll(() => worklistSnapshot(page, toReject), { timeout: 30_000 }).toEqual(rejectedEffect)
      const staleReject = await replay(validatorPage, rejected.request())
      expect(staleReject.status()).toBe(422)
      expect(await worklistSnapshot(page, toReject)).toEqual(rejectedEffect)

      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      for (const [request, id, effect] of [
        [validated.request(), toValidate, validatedEffect],
        [rejected.request(), toReject, rejectedEffect],
      ] as const) {
        const denied = await replay(readerPage, request)
        expect(denied.status()).toBe(403)
        expect(await worklistSnapshot(page, id)).toEqual(effect)
      }
    } finally {
      await readerContext.close()
      await validatorContext.close()
    }
  })
})
