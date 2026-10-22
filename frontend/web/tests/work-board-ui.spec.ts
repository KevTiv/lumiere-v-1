import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test"
import { stdbBffCallUrl } from "../../packages/stdb/src/commands/stdb-http"
import type { WorkTaskRow } from "../../packages/query-hooks/src/hooks/work-board-model"
import type { WorkActivityRow } from "../../packages/query-hooks/src/hooks/work-activities"

const actor = "ab".repeat(32)
const delegate = "ef".repeat(32)
const secondDelegate = "12".repeat(32)
const claimPath = stdbBffCallUrl("claim_workflow_human_task")
const decidePath = stdbBffCallUrl("decide_workflow_human_task")
const completeActivityPath = stdbBffCallUrl("complete_activity")

type FixtureTask = WorkTaskRow & { decidedBy?: string }
type FixtureActivity = WorkActivityRow
type FixtureWrite = { path: string; params: Record<string, unknown> }
type FixtureState = {
  rows: FixtureTask[]
  activities: FixtureActivity[]
  activityReads: string[]
  writes: FixtureWrite[]
  unexpected: string[]
  denyReads: boolean
  rejectWrite: boolean
  holdNextWrite: boolean
  pendingWrite?: Route
}

function task(id: number, overrides: Partial<FixtureTask> = {}): FixtureTask {
  return {
    id,
    organizationId: 7,
    companyId: 11,
    revision: 3,
    instanceRevision: 9,
    workflowInstanceId: 70,
    nodeKey: "Review supplier order",
    kind: "Approval",
    assignment: "AnyCandidate",
    status: "Open",
    subjectModel: "purchase_order",
    subjectId: 501,
    subjectRevisionHash: "synthetic-source-v1",
    directlyEligible: true,
    workModule: "purchasing",
    workAssignedToMe: false,
    workActions: ["claim", "approve", "reject"],
    workTeamRefs: [
      { kind: "workflow-group", id: "5", label: "Purchasing team" },
    ],
    workSourceTitle: `Purchase review ${id}`,
    requireCommentOnReject: true,
    ...overrides,
  }
}

const tag = (value: unknown): string => {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return ""
  const object = value as Record<string, unknown>
  return typeof object.tag === "string"
    ? object.tag
    : (Object.keys(object)[0] ?? "")
}

async function fixtureBackend(page: Page): Promise<FixtureState> {
  const state: FixtureState = {
    rows: [
      task(41),
      task(42, {
        status: "Claimed",
        claimedBy: actor,
        workAssignedToMe: true,
        workActions: ["approve", "reject"],
      }),
      task(43, {
        directlyEligible: false,
        workActions: [],
        workSourceTitle: "Delegated review 43",
        actingForOptions: [
          {
            identityHex: delegate,
            label: "Delegated approver",
            workActions: ["approve"],
          },
          {
            identityHex: secondDelegate,
            label: "Delegated completer",
            workActions: ["complete"],
          },
        ],
      }),
      task(44, {
        status: "Invalidated",
        workActions: [],
        workSourceTitle: "Invalidated review 44",
      }),
      task(51, {
        workModule: "sales",
        workSourceTitle: "Sales handoff 51",
        subjectModel: "sale_order",
        subjectId: 601,
        workActions: ["complete"],
        workTeamRefs: [
          { kind: "department", id: "6", label: "Sales department" },
        ],
      }),
      task(61, {
        companyId: 22,
        workModule: "expenses",
        workSourceTitle: "Company B expense 61",
        subjectModel: "hr_expense_sheet",
        subjectId: 701,
        workActions: ["complete"],
      }),
    ],
    activities: [
      {
        id: 71,
        organizationId: 7,
        companyId: 11,
        workModule: "purchasing",
        summary: "Follow up supplier order",
        resModel: "purchase_order",
        resId: 501,
        state: "open",
        isDone: false,
        workAssignedToMe: false,
        workIsAssigned: false,
        workTeamRefs: [],
        workActions: ["complete"],
        workSourceTitle: "PO-501",
        assignedTo: null,
        dateDeadline: null,
        updatedAt: "2026-10-22T09:00:00Z",
      },
    ],
    activityReads: [],
    writes: [],
    unexpected: [],
    denyReads: false,
    rejectWrite: false,
    holdNextWrite: false,
  }
  const respond = (route: Route, data: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(data),
    })
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === "GET" && url.pathname === "/api/query/companies") {
      return respond(route, {
        data: [
          { id: 11, organizationId: 7, name: "Company A", currencyId: 1 },
          { id: 22, organizationId: 7, name: "Company B", currencyId: 1 },
        ],
      })
    }
    if (
      request.method() === "GET" &&
      url.pathname === "/api/query/workflow-human-tasks"
    ) {
      if (state.denyReads)
        return respond(
          route,
          { error: "Synthetic assignment access was revoked" },
          403,
        )
      // The legacy canonical effect read is unpaged; the board supplies explicit filters.
      if (!url.searchParams.has("workScope"))
        return respond(route, { data: state.rows })
      const companyId = Number(url.searchParams.get("companyId"))
      const module = url.searchParams.get("workScope")
      const view = url.searchParams.get("workView")
      const team = url.searchParams.get("workTeam")
      const rows = state.rows.filter(
        (row) =>
          row.companyId === companyId &&
          (module === "finance" || row.workModule === module) &&
          (view !== "mine" || row.workAssignedToMe) &&
          (view !== "available" ||
            (tag(row.status) === "Open" &&
              row.claimedBy == null &&
              (row.workActions.length > 0 ||
                row.actingForOptions?.some(
                  (option) => option.workActions.length > 0,
                )))) &&
          (!team ||
            row.workTeamRefs.some(
              (value) => `${value.kind}:${value.id}` === team,
            )),
      )
      return respond(route, { data: rows, nextCursor: null })
    }
    if (
      request.method() === "GET" &&
      url.pathname === "/api/query/activities" &&
      url.searchParams.has("workScope")
    ) {
      state.activityReads.push(url.search)
      if (state.denyReads)
        return respond(
          route,
          { error: "Synthetic follow-up access was revoked" },
          403,
        )
      const companyId = Number(url.searchParams.get("companyId"))
      const module = url.searchParams.get("workScope")
      const view = url.searchParams.get("workView")
      const team = url.searchParams.get("workTeam")
      const activityId = url.searchParams.get("activityId")
      const rows = state.activities.filter(
        (row) =>
          row.companyId === companyId &&
          (module === "finance" || row.workModule === module) &&
          (view !== "mine" || row.workAssignedToMe) &&
          (view !== "available" || (!row.isDone && !row.workIsAssigned)) &&
          (!activityId || String(row.id) === activityId) &&
          (!team ||
            row.workTeamRefs.some(
              (value) => `${value.kind}:${value.id}` === team,
            )),
      )
      return respond(route, { data: rows, nextCursor: null })
    }
    if (request.method() === "POST" && url.pathname === completeActivityPath) {
      const params = request.postDataJSON() as Record<string, unknown>
      state.writes.push({ path: url.pathname, params })
      const activityId = Number(params.activityId ?? params.activity_id)
      const row = state.activities.find(
        (candidate) => candidate.id === activityId,
      )
      if (!row || state.rejectWrite)
        return respond(
          route,
          { error: "Synthetic unauthorized follow-up action" },
          403,
        )
      Object.assign(row, {
        state: "done",
        isDone: true,
        workActions: [],
        updatedAt: "2026-10-22T10:00:00Z",
      })
      if (state.holdNextWrite) {
        state.holdNextWrite = false
        state.pendingWrite = route
        return
      }
      return respond(route, { ok: true })
    }
    if (
      request.method() === "POST" &&
      [claimPath, decidePath].includes(url.pathname)
    ) {
      const body = request.postDataJSON() as { params: Record<string, unknown> }
      const params = body.params
      state.writes.push({ path: url.pathname, params })
      const taskId = Number(params.taskId ?? params.task_id)
      const row = state.rows.find(
        (candidate) => Number(candidate.id) === taskId,
      )
      const expected = Number(
        params.expectedRevision ??
          params.expected_revision ??
          params.expectedTaskRevision ??
          params.expected_task_revision,
      )
      if (!row || state.rejectWrite || expected !== row.revision)
        return respond(
          route,
          { error: "Synthetic stale or unauthorized assignment action" },
          409,
        )
      if (url.pathname === claimPath) {
        Object.assign(row, {
          status: "Claimed",
          claimedBy: actor,
          workAssignedToMe: true,
          revision: expected + 1,
          workActions: ["approve", "reject"],
        })
      } else {
        const decision = tag(params.decision).toLowerCase()
        const status =
          decision === "approve"
            ? "Approved"
            : decision === "reject"
              ? "Rejected"
              : "Completed"
        Object.assign(row, {
          status,
          decision: { tag: decision[0]!.toUpperCase() + decision.slice(1) },
          decidedBy: actor,
          revision: expected + 1,
          workActions: [],
        })
      }
      if (state.holdNextWrite) {
        state.holdNextWrite = false
        state.pendingWrite = route
        return
      }
      return respond(route, { ok: true })
    }
    state.unexpected.push(`${request.method()} ${url.pathname}`)
    return respond(
      route,
      { error: "Unexpected request at synthetic work-board boundary" },
      501,
    )
  })
  return state
}

async function openFixture(page: Page) {
  await page.goto("/work-board")
  await expect(
    page.getByTestId("work-board-fixture-disclosure"),
  ).toHaveAttribute("data-hydrated", "true")
  await expect(page.getByTestId("kanban-card-41")).toBeVisible()
  await expect(page.getByTestId("kanban-card-41")).toHaveAttribute(
    "data-draggable",
    "true",
  )
}

async function control(page: Page, command: string) {
  await page.evaluate((value) => {
    const channel = new BroadcastChannel("synthetic-work-board-controls")
    channel.postMessage(value)
    channel.close()
  }, command)
}

async function drag(page: Page, card: Locator, column: Locator) {
  await card.scrollIntoViewIfNeeded()
  const source = await card.boundingBox()
  if (!source) throw new Error("Source card has no box")
  await page.mouse.move(source.x + source.width / 2, source.y + 20)
  await page.mouse.down()
  await page.mouse.move(source.x + source.width / 2 + 16, source.y + 30, {
    steps: 4,
  })
  await column.scrollIntoViewIfNeeded()
  const target = await column.boundingBox()
  if (!target) throw new Error("Target column has no box")
  await page.mouse.move(target.x + target.width / 2, target.y + 100, {
    steps: 12,
  })
  await page.mouse.up()
}

test.describe("module work boards with production UI and synthetic HTTP", () => {
  test.use({ viewport: { width: 1440, height: 1000 } })
  let state: FixtureState
  test.beforeEach(async ({ page }) => {
    state = await fixtureBackend(page)
  })
  test.afterEach(() => {
    expect(state.unexpected).toEqual([])
  })

  test("a drag opens review, dispatches once after confirmation and follows canonical claim readback", async ({
    page,
  }) => {
    await openFixture(page)
    await drag(
      page,
      page.getByTestId("kanban-card-41"),
      page.getByTestId("kanban-column-Claimed"),
    )
    const review = page.getByRole("dialog", { name: "Purchase review 41" })
    await expect(review).toBeVisible()
    expect(state.writes).toHaveLength(0)
    expect(state.rows.find((row) => row.id === 41)?.status).toBe("Open")
    state.holdNextWrite = true
    await review.getByRole("button", { name: "Claim", exact: true }).click()
    await expect.poll(() => state.writes.length).toBe(1)
    await expect(
      review.getByRole("button", { name: /Saving/ }).first(),
    ).toBeDisabled()
    expect(state.writes[0]?.path).toBe(claimPath)
    await state.pendingWrite!.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    })
    await expect(review).toHaveCount(0)
    await expect(
      page.getByTestId("kanban-column-Claimed").getByTestId("kanban-card-41"),
    ).toBeVisible()
    await page.reload()
    await expect(
      page.getByTestId("kanban-column-Claimed").getByTestId("kanban-card-41"),
    ).toBeVisible()
    expect(state.writes).toHaveLength(1)
  })

  test("module, view and typed team filters use the scoped query and retain URL state", async ({
    page,
  }) => {
    await openFixture(page)
    await expect(page.getByTestId("kanban-card-51")).toBeAttached()
    await expect(page.getByTestId("kanban-card-61")).toHaveCount(0)
    await page.getByLabel("Synthetic module scope").selectOption("purchasing")
    await expect(page.getByTestId("kanban-card-51")).toHaveCount(0)
    await page
      .getByRole("combobox", { name: "Show", exact: true })
      .selectOption("mine")
    await expect(page).toHaveURL(/workView=mine/)
    await expect(page.getByTestId("kanban-card-42")).toBeVisible()
    await expect(page.getByTestId("kanban-card-41")).toHaveCount(0)
    await page
      .getByRole("combobox", { name: "Show", exact: true })
      .selectOption("available")
    await expect(page.getByTestId("kanban-card-41")).toBeVisible()
    await expect(page.getByTestId("kanban-card-42")).toHaveCount(0)
    await expect(page.getByTestId("kanban-card-44")).toHaveCount(0)
    await page
      .getByRole("combobox", { name: "Team", exact: true })
      .selectOption("workflow-group:5")
    await expect(page).toHaveURL(/workTeam=workflow-group%3A5/)
    expect(state.writes).toHaveLength(0)
  })

  test("selected delegates keep separate action sets and read-only records stay keyboard accessible", async ({
    page,
  }) => {
    await openFixture(page)
    const card = page.getByTestId("kanban-card-43")
    await expect(card).toHaveAttribute("data-draggable", "false")
    await card.focus()
    await page.keyboard.press("Enter")
    const review = page.getByRole("dialog", { name: "Delegated review 43" })
    await expect(review).toBeVisible()
    await expect(
      review.getByRole("button", { name: "Approve", exact: true }),
    ).toHaveCount(0)
    await review
      .getByRole("combobox", { name: "Acting as", exact: true })
      .selectOption(delegate)
    await expect(
      review.getByRole("button", { name: "Approve", exact: true }),
    ).toBeEnabled()
    await expect(
      review.getByRole("button", { name: "Complete", exact: true }),
    ).toHaveCount(0)
    await review
      .getByRole("combobox", { name: "Acting as", exact: true })
      .selectOption(secondDelegate)
    await expect(
      review.getByRole("button", { name: "Complete", exact: true }),
    ).toBeEnabled()
    await expect(
      review.getByRole("button", { name: "Approve", exact: true }),
    ).toHaveCount(0)
    await review.getByRole("button", { name: "Close", exact: true }).click()
    await expect(page.getByTestId("kanban-card-44")).toHaveAttribute(
      "data-draggable",
      "false",
    )
    expect(state.writes).toHaveLength(0)
  })

  test("a changed task revision blocks the reviewed action until the operator reviews the new row", async ({
    page,
  }) => {
    await openFixture(page)
    await page.getByTestId("kanban-card-42").click()
    const review = page.getByRole("dialog", { name: "Purchase review 42" })
    await expect(
      review.getByRole("button", { name: "Approve", exact: true }),
    ).toBeEnabled()
    state.rows.find((row) => row.id === 42)!.revision = 4
    await control(page, "refresh")
    await expect(review.getByRole("alert")).toContainText(/changed/i)
    await expect(
      review.getByRole("button", { name: "Approve", exact: true }),
    ).toHaveCount(0)
    expect(state.writes).toHaveLength(0)
    await review.getByRole("button", { name: /Review latest/i }).click()
    await expect(
      review.getByRole("button", { name: "Approve", exact: true }),
    ).toBeEnabled()
  })

  test("a rejected decision leaves the canonical card in its previous column", async ({
    page,
  }) => {
    await openFixture(page)
    await page.getByTestId("kanban-card-42").click()
    const review = page.getByRole("dialog", { name: "Purchase review 42" })
    state.rejectWrite = true
    await review.getByRole("button", { name: "Approve", exact: true }).click()
    await expect(review.getByRole("alert")).toContainText(
      "Synthetic stale or unauthorized assignment action",
    )
    expect(state.writes).toHaveLength(1)
    expect(state.rows.find((row) => row.id === 42)?.status).toBe("Claimed")
    await review.getByRole("button", { name: "Close", exact: true }).click()
    await expect(
      page.getByTestId("kanban-column-Claimed").getByTestId("kanban-card-42"),
    ).toBeVisible()
    await expect(
      page.getByTestId("kanban-column-Approved").getByTestId("kanban-card-42"),
    ).toHaveCount(0)
  })

  test("company and authorization changes remove old review state and revoked reads hide cached cards", async ({
    page,
  }) => {
    await openFixture(page)
    await page.getByTestId("kanban-card-42").click()
    await expect(
      page.getByRole("dialog", { name: "Purchase review 42" }),
    ).toBeVisible()
    await control(page, "company")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(page.getByTestId("kanban-card-61")).toBeVisible()
    await expect(page.getByTestId("kanban-card-42")).toHaveCount(0)
    await page.getByTestId("kanban-card-61").click()
    await control(page, "authorization")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    state.denyReads = true
    await control(page, "refresh")
    await expect(
      page
        .getByRole("region", { name: "My work", exact: true })
        .getByRole("alert"),
    ).toContainText("Synthetic assignment access was revoked")
    await expect(page.getByTestId("kanban-card-61")).toHaveCount(0)
    expect(state.writes).toHaveLength(0)
  })

  test("actor changes and removed RBAC grants discard the open review", async ({
    page,
  }) => {
    await openFixture(page)
    await page.getByTestId("kanban-card-42").click()
    await expect(
      page.getByRole("dialog", { name: "Purchase review 42" }),
    ).toBeVisible()
    await control(page, "actor")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(page.getByTestId("work-board-fixture-scope")).toContainText(
      "cd".repeat(32),
    )
    await page.getByTestId("kanban-card-41").click()
    await expect(
      page.getByRole("dialog", { name: "Purchase review 41" }),
    ).toBeVisible()
    await control(page, "access")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(
      page.getByText(
        "You do not have permission to read workflow assignments.",
        { exact: true },
      ),
    ).toBeVisible()
    await expect(page.getByTestId("kanban-card-41")).toHaveCount(0)
    expect(state.writes).toHaveLength(0)
  })

  test("record follow-ups use their own canonical source and workflow cards return when switched back", async ({
    page,
  }) => {
    await openFixture(page)
    await page
      .getByRole("combobox", { name: "Team", exact: true })
      .selectOption("workflow-group:5")
    await expect(page).toHaveURL(/workTeam=workflow-group%3A5/)
    await page
      .getByRole("combobox", { name: "Work type", exact: true })
      .selectOption("activities")
    await expect(page).toHaveURL(/workSource=activities/)
    await expect(page).not.toHaveURL(/workTeam=/)
    await expect(page.getByTestId("kanban-card-71")).toBeVisible()
    await expect(page.getByTestId("kanban-card-41")).toHaveCount(0)
    await page.getByTestId("kanban-card-71").click()
    const review = page.getByRole("dialog", {
      name: "Follow up supplier order",
    })
    await expect(review).toContainText(
      "The source document keeps its own business status.",
    )
    await expect(
      review.getByRole("button", { name: "Complete", exact: true }),
    ).toBeEnabled()
    expect(state.writes).toHaveLength(0)
    await review.getByRole("button", { name: "Close", exact: true }).click()
    await page
      .getByRole("combobox", { name: "Work type", exact: true })
      .selectOption("workflow")
    await expect(page.getByTestId("kanban-card-41")).toBeVisible()
    await expect(page.getByTestId("kanban-card-71")).toHaveCount(0)
  })

  test("an available follow-up completes only after confirmation and an exact scoped readback", async ({
    page,
  }) => {
    await openFixture(page)
    await page
      .getByRole("combobox", { name: "Work type", exact: true })
      .selectOption("activities")
    await page
      .getByRole("combobox", { name: "Show", exact: true })
      .selectOption("available")
    await expect(page.getByTestId("kanban-card-71")).toHaveAttribute(
      "data-draggable",
      "true",
    )
    await drag(
      page,
      page.getByTestId("kanban-card-71"),
      page.getByTestId("kanban-column-done"),
    )
    const review = page.getByRole("dialog", {
      name: "Follow up supplier order",
    })
    await expect(review).toBeVisible()
    expect(state.writes).toHaveLength(0)
    state.holdNextWrite = true
    await review.getByRole("button", { name: "Complete", exact: true }).click()
    await expect.poll(() => state.writes.length).toBe(1)
    await expect(review.getByRole("button", { name: /Saving/ })).toBeDisabled()
    expect(state.writes[0]?.path).toBe(completeActivityPath)
    await expect.poll(() => !!state.pendingWrite).toBe(true)
    await state.pendingWrite!.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    })
    await expect(review).toHaveCount(0)
    await expect(page.getByTestId("kanban-card-71")).toHaveCount(0)
    await page
      .getByRole("combobox", { name: "Show", exact: true })
      .selectOption("eligible")
    await expect(
      page.getByTestId("kanban-column-done").getByTestId("kanban-card-71"),
    ).toBeVisible()
    expect(
      state.activityReads.some((query) => {
        const params = new URLSearchParams(query)
        return (
          params.get("activityId") === "71" &&
          params.get("companyId") === "11" &&
          params.get("workScope") === "finance" &&
          params.get("workView") === "eligible"
        )
      }),
    ).toBe(true)
    expect(state.rows.find((row) => row.id === 41)?.status).toBe("Open")
    await page.reload()
    await expect(
      page.getByTestId("kanban-column-done").getByTestId("kanban-card-71"),
    ).toBeVisible()
    expect(state.writes).toHaveLength(1)
  })

  for (const width of [390, 1440]) {
    test(`${width}px board and list remain contained and offline actions are disabled`, async ({
      page,
      context,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 })
      await openFixture(page)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1)
      await page.screenshot({
        path: testInfo.outputPath(`work-board-${width}.png`),
        fullPage: true,
      })
      await page.getByRole("button", { name: "List", exact: true }).click()
      await expect(page.getByRole("table")).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1)
      await page
        .getByRole("table")
        .getByRole("button", { name: "Purchase review 42", exact: true })
        .click()
      const review = page.getByRole("dialog", { name: "Purchase review 42" })
      await context.setOffline(true)
      await expect(
        review.getByRole("button", { name: "Approve", exact: true }),
      ).toBeDisabled()
      expect(state.writes).toHaveLength(0)
      await context.setOffline(false)
    })
  }
})
