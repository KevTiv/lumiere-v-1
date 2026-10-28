/**
 * Tasks board drag-and-drop: a card dropped on another column calls `update_task_state`, and the
 * new state survives a reload because the board reads live task rows.
 */
import { expect, test, type Locator, type Page } from "@playwright/test"

import {
  callReducerBff,
  expectNoAppError,
  fetchCurrencyIdByCode,
  fetchSessionOrganizationId,
  gotoModule,
  smokeName,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

const some = <T>(value: T) => ({ some: value })
const none = { none: [] as [] }

type QueryRow = { id?: number | string; name?: string; state?: { tag?: string } | string; priority?: string }

async function queryRows(page: Page, path: string): Promise<QueryRow[]> {
  const res = await page.request.get(path)
  if (!res.ok()) throw new Error(`${path} failed: ${res.status()}`)
  return ((await res.json()) as { data?: QueryRow[] }).data ?? []
}

async function waitForRow(page: Page, path: string, name: string): Promise<QueryRow> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const row = (await queryRows(page, path)).find((candidate) => candidate.name === name)
    if (row?.id != null) return row
    await page.waitForTimeout(250)
  }
  throw new Error(`${name} not found in ${path}`)
}

const stateTag = (row: QueryRow) => (typeof row.state === "string" ? row.state : row.state?.tag)

async function createProject(page: Page, organizationId: number, companyId: number): Promise<number> {
  const name = smokeName("board-proj")
  await callReducerBff(page, "create_project", [
    organizationId,
    {
      company_id: some(companyId),
      name,
      description: none,
      active: true,
      sequence: 1,
      currency_id: await fetchCurrencyIdByCode(page, "USD"),
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
  return Number((await waitForRow(page, "/api/query/projects", name)).id)
}

async function createTask(page: Page, organizationId: number, companyId: number, projectId: number, name: string) {
  await callReducerBff(page, "create_task", [
    organizationId,
    {
      company_id: some(companyId),
      project_id: some(projectId),
      name,
      description: none,
      priority: "2",
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
      planned_hours: 4,
      total_hours_spent: 0,
      effective_hours: 1,
      progress: 0,
      remaining_hours: 3,
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
  const row = await waitForRow(page, "/api/query/tasks", name)
  expect(row.priority, "task readback retains the saved priority").toBe("2")
  expect(stateTag(row), "task readback retains the saved state").toBe("InProgress")
  return Number(row.id)
}

/** dnd-kit's pointer sensor starts after 8px of movement, so the drag moves in steps. */
async function dragTo(page: Page, source: Locator, target: Locator) {
  await source.scrollIntoViewIfNeeded()
  const from = await source.boundingBox()
  if (!from) throw new Error("card has no box")
  await page.mouse.move(from.x + from.width / 2, from.y + 20)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + 30, { steps: 5 })
  await target.scrollIntoViewIfNeeded()
  const to = await target.boundingBox()
  if (!to) throw new Error("column has no box")
  await page.mouse.move(to.x + to.width / 2, to.y + Math.min(to.height / 2, 120), { steps: 15 })
  await page.mouse.up()
}

test.describe("Tasks board drag and drop @tasks", () => {
  test("dragging a card to another column changes the task state and persists", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await gotoModule(page, "/tasks?source=projects")
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = Number((await queryRows(page, "/api/query/companies"))[0]?.id)
    expect(companyId).toBeGreaterThan(0)
    const projectId = await createProject(page, organizationId, companyId)
    const taskName = smokeName("board-drag")
    const taskId = await createTask(page, organizationId, companyId, projectId, taskName)

    await page.reload()
    await page.getByTestId("task-view-board").click()
    const card = page.getByTestId(`kanban-card-${taskId}`)
    await expect(page.getByTestId("kanban-column-InProgress").getByTestId(`kanban-card-${taskId}`)).toBeVisible()
    // The card carries the richer workspace details.
    await expect(card).toContainText(taskName)
    await expect(card).toContainText("High")

    const [updated] = await Promise.all([
      page.waitForResponse((response) => matchesOperationResponse(response, "update_task_state")),
      dragTo(page, card, page.getByTestId("kanban-column-Approved")),
    ])
    expect(updated.status(), await updated.text()).toBe(200)
    await expect(page.getByTestId("kanban-column-Approved").getByTestId(`kanban-card-${taskId}`)).toBeVisible()

    await expect
      .poll(async () => stateTag((await queryRows(page, "/api/query/tasks")).find((row) => Number(row.id) === taskId) ?? {}), {
        timeout: 30_000,
      })
      .toBe("Approved")

    await page.reload()
    await expect(page.getByTestId("kanban-column-Approved").getByTestId(`kanban-card-${taskId}`)).toBeVisible()
    await expectNoAppError(page)
  })
})
