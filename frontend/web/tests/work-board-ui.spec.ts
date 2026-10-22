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
import {
  humanTaskClaimExpectation,
  humanTaskDecisionExpectation,
  type HumanTaskCommandExpectation,
} from "../../packages/query-hooks/src/hooks/human-task-command"
import { taskIdentityHex } from "../../packages/query-hooks/src/hooks/task-assignment"

const actor = "ab".repeat(32)
const delegate = "ef".repeat(32)
const secondDelegate = "12".repeat(32)
const claimPath = stdbBffCallUrl("claim_workflow_human_task")
const decidePath = stdbBffCallUrl("decide_workflow_human_task")
const completeActivityPath = stdbBffCallUrl("complete_activity")

type FixtureTask = WorkTaskRow & { decidedBy?: string }
type FixtureActivity = WorkActivityRow
type FixtureWrite = { path: string; params: Record<string, unknown> }
type FixtureCommandEvidence = HumanTaskCommandExpectation & {
  workflowInstanceId: string
  eventId: string
  resultRevision: string
  resultStatus: string
}
type FixtureState = {
  rows: FixtureTask[]
  activities: FixtureActivity[]
  activityReads: string[]
  writes: FixtureWrite[]
  commandEvidence: FixtureCommandEvidence[]
  commandReads: string[]
  hideCommandEvidence: boolean
  loseNextWriteReply: boolean
  unexpected: string[]
  denyReads: boolean
  readFailureStatus: number
  denyAuthority: boolean
  authorityReads: number
  scopedReads: number
  authorityWait?: Promise<void>
  boardWait?: Promise<void>
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

function optionalValue(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value
  if ("some" in value) return optionalValue(value.some)
  if ("none" in value) return null
  return value
}

function decisionTag(value: unknown): "Approve" | "Reject" | "Complete" {
  const decision = tag(value).toLowerCase()
  if (decision === "approve") return "Approve"
  if (decision === "reject") return "Reject"
  if (decision === "complete") return "Complete"
  throw new Error("Unexpected decision in the saved synthetic command")
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
    commandEvidence: [],
    commandReads: [],
    hideCommandEvidence: false,
    loseNextWriteReply: false,
    unexpected: [],
    denyReads: false,
    readFailureStatus: 403,
    denyAuthority: false,
    authorityReads: 0,
    scopedReads: 0,
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
    if (
      request.method() === "GET" &&
      url.pathname === "/api/session/field-access"
    ) {
      state.authorityReads += 1
      await state.authorityWait
      if (state.denyAuthority)
        return respond(route, { error: "Synthetic authority was revoked" }, 403)
      return respond(route, {
        identityHex: request.headers()["x-fixture-actor"] ?? actor,
        organizationId: 7,
      })
    }
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
          state.readFailureStatus,
        )
      // The legacy canonical effect read is unpaged; the board supplies explicit filters.
      if (!url.searchParams.has("workScope"))
        return respond(route, { data: state.rows })
      state.scopedReads += 1
      await state.boardWait
      const companyId = Number(url.searchParams.get("companyId"))
      const module = url.searchParams.get("workScope")
      const view = url.searchParams.get("workView")
      const team = url.searchParams.get("workTeam")
      const taskId = url.searchParams.get("taskId")
      const rows = state.rows.filter(
        (row) =>
          row.companyId === companyId &&
          (!taskId || String(row.id) === taskId) &&
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
      const commandKind = url.searchParams.get("commandKind")
      if (commandKind) state.commandReads.push(url.search)
      const commandEvidence = state.hideCommandEvidence
        ? null
        : state.commandEvidence.find(
            (evidence) =>
              evidence.commandKind === commandKind &&
              evidence.idempotencyKey ===
                url.searchParams.get("idempotencyKey"),
          )
      return respond(route, {
        data: rows,
        nextCursor: null,
        ...(commandKind ? { commandEvidence } : {}),
      })
    }
    if (
      request.method() === "GET" &&
      url.pathname === "/api/query/activities" &&
      url.searchParams.has("workScope")
    ) {
      state.activityReads.push(url.search)
      state.scopedReads += 1
      await state.boardWait
      if (state.denyReads)
        return respond(
          route,
          { error: "Synthetic follow-up access was revoked" },
          state.readFailureStatus,
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
      // Compute evidence from the saved command, never from a requested readback hash.
      const scope = {
        organizationId: 7,
        companyId: Number(row.companyId),
        actorIdentity: actor,
        authorizationKey: "synthetic",
        scope: "finance" as const,
        view: "eligible" as const,
      }
      const commonInput = {
        companyId: Number(params.companyId ?? params.company_id),
        taskId,
        actingFor: taskIdentityHex(
          optionalValue(params.actingFor ?? params.acting_for),
        ),
        attempt: {
          idempotencyKey: String(
            params.idempotencyKey ?? params.idempotency_key,
          ),
          correlationId: String(params.correlationId ?? params.correlation_id),
        },
      }
      const expectation =
        url.pathname === claimPath
          ? await humanTaskClaimExpectation(scope, {
              ...commonInput,
              expectedRevision: expected,
            })
          : await humanTaskDecisionExpectation(scope, {
              ...commonInput,
              expectedTaskRevision: expected,
              expectedInstanceRevision: Number(
                params.expectedInstanceRevision ??
                  params.expected_instance_revision,
              ),
              decision: {
                tag: decisionTag(params.decision),
              },
              comment: optionalValue(params.comment) as string | null,
            })
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
      state.commandEvidence.push({
        ...expectation,
        workflowInstanceId: String(row.workflowInstanceId),
        eventId: String(1000 + state.commandEvidence.length),
        resultRevision: String(row.revision),
        resultStatus: tag(row.status),
      })
      if (state.loseNextWriteReply) {
        state.loseNextWriteReply = false
        return route.abort("connectionreset")
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

  test("a lost decision reply retains one attempt and checks only matching canonical evidence without resending", async ({
    page,
  }) => {
    await openFixture(page)
    await page.getByTestId("kanban-card-42").click()
    const review = page.getByRole("dialog", { name: "Purchase review 42" })
    await review.getByRole("textbox").fill("This is the one confirmed decision")
    state.hideCommandEvidence = true
    state.loseNextWriteReply = true
    await review.getByRole("button", { name: "Approve", exact: true }).click()
    await expect(review.getByRole("alert")).toContainText(
      "Outcome not confirmed. Check again before starting another action.",
    )
    await expect(
      review.getByRole("button", { name: "Approve", exact: true }),
    ).toHaveCount(0)
    const check = review.getByRole("button", {
      name: "Check outcome",
      exact: true,
    })
    await expect(check).toBeEnabled()
    expect(state.writes).toHaveLength(1)
    const proof = state.commandEvidence[0]!
    // A different reviewer's receipt cannot prove this operator's command.
    state.hideCommandEvidence = false
    state.commandEvidence[0] = { ...proof, actorIdentityHex: delegate }
    const before = state.commandReads.length
    await check.click()
    await expect.poll(() => state.commandReads.length).toBeGreaterThan(before)
    await expect(check).toBeEnabled()
    await expect(review.getByRole("alert")).toContainText(
      "Outcome not confirmed",
    )
    expect(state.writes).toHaveLength(1)
    state.commandEvidence[0] = proof
    await check.click()
    await expect(review).toHaveCount(0)
    await expect(
      page.getByTestId("kanban-column-Approved").getByTestId("kanban-card-42"),
    ).toBeVisible()
    expect(state.writes).toHaveLength(1)
    for (const search of state.commandReads) {
      const params = new URLSearchParams(search)
      expect(params.get("idempotencyKey")).toBe(proof.idempotencyKey)
      expect(params.get("inputHash")).toBe(proof.inputHash)
      expect(params.get("commandKind")).toBe("decision")
      expect(params.get("taskId")).toBe("42")
      expect(params.get("workView")).toBe("eligible")
    }
  })

  test("an unconfirmed claim leaving Available work retains a generic outcome check without retaining the review", async ({
    page,
  }) => {
    state.rows = [task(41)]
    await openFixture(page)
    await page
      .getByRole("combobox", { name: "Show", exact: true })
      .selectOption("available")
    await page.getByTestId("kanban-card-41").click()
    const review = page.getByRole("dialog", { name: "Purchase review 41" })
    state.hideCommandEvidence = true
    state.loseNextWriteReply = true
    await review.getByRole("button", { name: "Claim", exact: true }).click()
    const check = page.getByRole("button", {
      name: "Check outcome",
      exact: true,
    })
    await expect(check).toBeEnabled()
    await expect(review).toHaveCount(0)
    await expect(page.getByTestId("kanban-card-41")).toHaveCount(0)
    await expect(
      page.getByText("Purchase review 41", { exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByText(
        "Outcome not confirmed. Check again before starting another action.",
        { exact: true },
      ),
    ).toBeVisible()
    expect(state.rows[0]?.status).toBe("Claimed")
    expect(state.writes).toHaveLength(1)
    const proof = state.commandEvidence[0]!
    const before = state.commandReads.length
    await check.click()
    await expect.poll(() => state.commandReads.length).toBeGreaterThan(before)
    await expect(check).toBeEnabled()
    await control(page, "refresh")
    await expect(check).toBeEnabled()
    expect(state.writes).toHaveLength(1)
    state.hideCommandEvidence = false
    await check.click()
    await expect(check).toHaveCount(0)
    await expect(review).toHaveCount(0)
    await expect(
      page.getByText("Assignment updated and confirmed.", { exact: true }),
    ).toBeVisible()
    expect(state.writes).toHaveLength(1)
    for (const search of state.commandReads) {
      const params = new URLSearchParams(search)
      expect(params.get("taskId")).toBe("41")
      expect(params.get("workView")).toBe("eligible")
      expect(params.get("idempotencyKey")).toBe(proof.idempotencyKey)
      expect(params.get("inputHash")).toBe(proof.inputHash)
      expect(params.get("commandKind")).toBe("claim")
    }
  })

  test("a temporary board read failure clears review details but retains the unconfirmed command for read-only recovery", async ({
    page,
  }) => {
    await openFixture(page)
    await page.getByTestId("kanban-card-42").click()
    const review = page.getByRole("dialog", { name: "Purchase review 42" })
    await review.getByRole("textbox").fill("Clear this draft after read loss")
    state.hideCommandEvidence = true
    state.loseNextWriteReply = true
    await review.getByRole("button", { name: "Approve", exact: true }).click()
    const check = page.getByRole("button", {
      name: "Check outcome",
      exact: true,
    })
    await expect(check).toBeEnabled()
    state.readFailureStatus = 503
    state.denyReads = true
    await control(page, "refresh")
    await expect(review).toHaveCount(0)
    await expect(page.getByTestId("kanban-card-42")).toHaveCount(0)
    await expect(check).toBeDisabled()
    await expect(
      page.getByText(
        "Outcome not confirmed. Check again before starting another action.",
        { exact: true },
      ),
    ).toBeVisible()
    state.denyReads = false
    await control(page, "refresh")
    await expect(page.getByTestId("kanban-card-42")).toBeVisible()
    await expect(review).toHaveCount(0)
    await expect(check).toBeEnabled()
    state.hideCommandEvidence = false
    await check.click()
    await expect(check).toHaveCount(0)
    await expect(review).toHaveCount(0)
    await expect(
      page.getByText("Assignment updated and confirmed.", { exact: true }),
    ).toBeVisible()
    expect(state.writes).toHaveLength(1)
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

  for (const source of ["workflow", "activities"] as const) {
    test(`${source}: visibility loss while a command is pending discards its late review result`, async ({
      page,
    }) => {
      await openFixture(page)
      if (source === "activities")
        await page
          .getByRole("combobox", { name: "Work type", exact: true })
          .selectOption("activities")
      const id = source === "workflow" ? 42 : 71
      const resource =
        source === "workflow" ? "workflow-human-tasks" : "activities"
      const exactId = source === "workflow" ? "taskId" : "activityId"
      await page.getByTestId(`kanban-card-${id}`).click()
      state.holdNextWrite = true
      await page
        .getByRole("dialog")
        .getByRole("button", {
          name: source === "workflow" ? "Approve" : "Complete",
          exact: true,
        })
        .click()
      await expect.poll(() => state.pendingWrite != null).toBe(true)
      if (source === "workflow")
        state.rows = state.rows.filter((row) => row.id !== id)
      else state.activities = []
      await control(page, "realtime-source")
      await expect(page.getByRole("dialog")).toHaveCount(0)
      await expect(page.getByTestId(`kanban-card-${id}`)).toHaveCount(0)
      const settled = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return (
          url.pathname === `/api/query/${resource}` &&
          url.searchParams.has("workScope") &&
          !url.searchParams.has(exactId)
        )
      })
      await state.pendingWrite!.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
      await settled
      await expect(page.getByRole("dialog")).toHaveCount(0)
      await expect(
        page.getByRole("button", { name: "Check outcome", exact: true }),
      ).toHaveCount(0)
      await expect(
        page.getByText(
          source === "workflow"
            ? "Assignment updated and confirmed."
            : "Follow-up completed and confirmed.",
          { exact: true },
        ),
      ).toHaveCount(0)
      expect(state.writes).toHaveLength(1)
    })

    test(`${source}: a successful read that removes the reviewed row clears details and never reopens it`, async ({
      page,
    }) => {
      await openFixture(page)
      if (source === "activities")
        await page
          .getByRole("combobox", { name: "Work type", exact: true })
          .selectOption("activities")
      const id = source === "workflow" ? 42 : 71
      const card = page.getByTestId(`kanban-card-${id}`)
      await card.click()
      const review = page.getByRole("dialog")
      await expect(review).toBeVisible()
      if (source === "workflow")
        await review
          .getByRole("textbox")
          .fill("Discard this revoked review comment")
      const rows = [...state.rows]
      const activities = [...state.activities]
      if (source === "workflow")
        state.rows = state.rows.filter((row) => row.id !== id)
      else state.activities = []
      await control(page, "realtime-source")
      await expect(card).toHaveCount(0)
      await expect(review).toHaveCount(0)
      await expect(
        page.getByText(
          source === "workflow"
            ? "Purchase review 42"
            : "Follow up supplier order",
          { exact: true },
        ),
      ).toHaveCount(0)
      state.rows = rows
      state.activities = activities
      await control(page, "realtime-source")
      await expect(card).toBeVisible()
      await expect(review).toHaveCount(0)
      await card.click()
      if (source === "workflow")
        await expect(review.getByRole("textbox")).toHaveText("")
      expect(state.writes).toHaveLength(0)
    })

    test(`${source}: recovery after a denied read requires a new review`, async ({
      page,
    }) => {
      await openFixture(page)
      if (source === "activities")
        await page
          .getByRole("combobox", { name: "Work type", exact: true })
          .selectOption("activities")
      const card = page.getByTestId(
        `kanban-card-${source === "workflow" ? 42 : 71}`,
      )
      await card.click()
      await expect(page.getByRole("dialog")).toBeVisible()
      state.denyReads = true
      await control(page, "refresh")
      await expect(card).toHaveCount(0)
      await expect(page.getByRole("dialog")).toHaveCount(0)
      state.denyReads = false
      await control(page, "refresh")
      await expect(card).toBeVisible()
      await expect(page.getByRole("dialog")).toHaveCount(0)
      expect(state.writes).toHaveLength(0)
    })
  }

  test("an open review displays only the latest authorized field projection", async ({
    page,
  }) => {
    await openFixture(page)
    await page.getByTestId("kanban-card-42").click()
    const review = page.getByRole("dialog")
    await expect(
      review.getByRole("heading", { name: "Purchase review 42" }),
    ).toBeVisible()
    await expect(
      review.getByRole("link", { name: "Open source record" }),
    ).toBeVisible()
    const row = state.rows.find((candidate) => candidate.id === 42)!
    delete row.workSourceTitle
    delete row.nodeKey
    delete row.subjectModel
    delete row.subjectId
    await control(page, "realtime-source")
    await expect(
      review.getByRole("heading", { name: "Purchase review 42" }),
    ).toHaveCount(0)
    await expect(
      review.getByText("Review supplier order", { exact: true }),
    ).toHaveCount(0)
    await expect(review.getByRole("link")).toHaveCount(0)
    await expect(review.getByRole("heading", { name: "#42" })).toBeVisible()
    expect(state.writes).toHaveLength(0)
  })

  test("a revoked selected delegate clears review details while its claimed row remains readable", async ({
    page,
  }) => {
    const row = state.rows.find((candidate) => candidate.id === 43)!
    Object.assign(row, {
      status: "Claimed",
      claimedBy: actor,
      workAssignedToMe: true,
    })
    await openFixture(page)
    await page.getByTestId("kanban-card-43").click()
    const review = page.getByRole("dialog")
    await review
      .getByRole("combobox", { name: "Acting as", exact: true })
      .selectOption(delegate)
    await review.getByRole("textbox").fill("A review for the former principal")
    row.actingForOptions = [
      {
        identityHex: secondDelegate,
        label: "Delegated completer",
        workActions: ["complete"],
      },
    ]
    await control(page, "realtime-source")
    await expect(review).toHaveCount(0)
    await expect(page.getByTestId("kanban-card-43")).toBeVisible()
    await page.getByTestId("kanban-card-43").click()
    await expect(review).toBeVisible()
    await expect(
      review.getByRole("option", { name: "Delegated approver", exact: true }),
    ).toHaveCount(0)
    await expect(
      review.getByRole("button", { name: "Approve", exact: true }),
    ).toHaveCount(0)
    await expect(review.getByRole("textbox")).toHaveText("")
    await expect(
      review.getByRole("button", { name: "Complete", exact: true }),
    ).toBeEnabled()
    expect(state.writes).toHaveLength(0)
  })

  test("reconnect waits for fresh authority and a subsequent scoped read before enabling actions", async ({
    page,
    context,
  }) => {
    await openFixture(page)
    await page.getByTestId("kanban-card-42").click()
    const approve = page
      .getByRole("dialog")
      .getByRole("button", { name: "Approve", exact: true })
    await expect(approve).toBeEnabled()
    await context.setOffline(true)
    await expect(approve).toBeDisabled()
    const beforeAuthority = state.authorityReads
    let releaseAuthority!: () => void
    let releaseBoard!: () => void
    state.authorityWait = new Promise((resolve) => {
      releaseAuthority = resolve
    })
    try {
      await context.setOffline(false)
      await expect
        .poll(() => state.authorityReads)
        .toBeGreaterThan(beforeAuthority)
      await expect(approve).toBeDisabled()
      state.boardWait = new Promise((resolve) => {
        releaseBoard = resolve
      })
      const beforeBoard = state.scopedReads
      releaseAuthority()
      await expect.poll(() => state.scopedReads).toBeGreaterThan(beforeBoard)
      await expect(approve).toBeDisabled()
      releaseBoard()
      await expect(approve).toBeEnabled()
      expect(state.writes).toHaveLength(0)
    } finally {
      releaseAuthority()
      releaseBoard?.()
      state.authorityWait = undefined
      state.boardWait = undefined
    }
  })

  test("an unavailable initial socket preserves actions backed by fresh HTTP reads", async ({
    page,
  }) => {
    await openFixture(page)
    await control(page, "socket-initial-unavailable")
    await control(page, "socket-retry")
    await expect(page.getByTestId("kanban-card-41")).toHaveAttribute(
      "data-draggable",
      "true",
    )
    await page.getByLabel("Synthetic module scope").selectOption("purchasing")
    await page.getByTestId("kanban-card-42").click()
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Approve", exact: true }),
    ).toBeEnabled()
    expect(state.writes).toHaveLength(0)
  })

  test("a board mounted during a socket outage proves authority and rows over HTTP, then checks recovery again", async ({
    page,
  }) => {
    await openFixture(page)
    const beforeAuthority = state.authorityReads
    let releaseAuthority!: () => void
    let releaseBoard!: () => void
    let releaseRecovery!: () => void
    state.authorityWait = new Promise((resolve) => {
      releaseAuthority = resolve
    })
    try {
      await control(page, "socket-reconnecting")
      await expect(page.getByTestId("kanban-card-41")).toHaveAttribute(
        "data-draggable",
        "false",
      )
      // Mount a new actual workspace after the outage was recorded in QueryClient.
      await page.getByLabel("Synthetic module scope").selectOption("purchasing")
      await page.getByTestId("kanban-card-42").click()
      const approve = page
        .getByRole("dialog")
        .getByRole("button", { name: "Approve", exact: true })
      await expect
        .poll(() => state.authorityReads)
        .toBeGreaterThan(beforeAuthority)
      await expect(approve).toBeDisabled()
      const beforeBoard = state.scopedReads
      state.boardWait = new Promise((resolve) => {
        releaseBoard = resolve
      })
      releaseAuthority()
      await expect.poll(() => state.scopedReads).toBeGreaterThan(beforeBoard)
      await expect(approve).toBeDisabled()
      releaseBoard()
      await expect(approve).toBeEnabled()
      // Retry attempts do not replace an already proved outage generation.
      await control(page, "socket-retry")
      await expect(approve).toBeEnabled()
      const beforeRecovery = state.authorityReads
      state.authorityWait = new Promise((resolve) => {
        releaseRecovery = resolve
      })
      await control(page, "socket-subscribed")
      await expect
        .poll(() => state.authorityReads)
        .toBeGreaterThan(beforeRecovery)
      await expect(approve).toBeDisabled()
      releaseRecovery()
      await expect(approve).toBeEnabled()
      expect(state.writes).toHaveLength(0)
    } finally {
      releaseAuthority?.()
      releaseBoard?.()
      releaseRecovery?.()
    }
  })

  test("authority revocation while offline removes the review on reconnect", async ({
    page,
    context,
  }) => {
    await openFixture(page)
    await page.getByTestId("kanban-card-42").click()
    await context.setOffline(true)
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Approve", exact: true }),
    ).toBeDisabled()
    state.denyAuthority = true
    await context.setOffline(false)
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(page.getByTestId("kanban-card-42")).toHaveCount(0)
    expect(state.writes).toHaveLength(0)
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
