import assert from "node:assert/strict"
import test from "node:test"

import {
  canMoveWorkTask,
  isWorkScope,
  isWorkTeamKey,
  isWorkView,
  parseWorkBoardPage,
  workActionForColumn,
  workActionsForActor,
  workBoardQueryKey,
  workBoardQueryPath,
  workStatus,
  workTeamKey,
  type WorkBoardScope,
  type WorkTaskRow,
} from "./work-board-model"

const identity = "ab".repeat(32)
const firstDelegate = "cd".repeat(32)
const secondDelegate = "ef".repeat(32)

const scope: WorkBoardScope = {
  organizationId: 7,
  companyId: 11,
  actorIdentity: identity,
  authorizationKey: "permissions-v3",
  scope: "finance",
  view: "eligible",
}

function task(overrides: Partial<WorkTaskRow> = {}): WorkTaskRow {
  return {
    id: "41",
    organizationId: 7,
    companyId: 11,
    status: "Open",
    revision: 3,
    instanceRevision: 9,
    directlyEligible: true,
    workModule: "purchasing",
    workAssignedToMe: false,
    workActions: ["claim"],
    workTeamRefs: [{ kind: "workflow-group", id: "5", label: "Buyers" }],
    ...overrides,
  }
}

const page = (rows: unknown[], nextCursor: string | null = null) => ({
  data: rows,
  nextCursor,
})

test("personal, available and team pages cannot widen their selected scope", () => {
  assert.throws(
    () => parseWorkBoardPage(page([task()]), { ...scope, view: "mine" }),
    /out-of-scope/,
  )
  assert.doesNotThrow(() =>
    parseWorkBoardPage(page([task({ workAssignedToMe: true })]), {
      ...scope,
      view: "mine",
    }),
  )
  for (const row of [
    task({ status: "Claimed" }),
    task({ claimedBy: identity }),
  ]) {
    assert.throws(
      () => parseWorkBoardPage(page([row]), { ...scope, view: "available" }),
      /out-of-scope/,
    )
  }
  assert.doesNotThrow(() =>
    parseWorkBoardPage(page([task()]), { ...scope, view: "available" }),
  )
  assert.throws(
    () =>
      parseWorkBoardPage(page([task()]), { ...scope, team: "department:5" }),
    /out-of-scope/,
  )
  assert.doesNotThrow(() =>
    parseWorkBoardPage(page([task()]), { ...scope, team: "workflow-group:5" }),
  )
})

test("a scoped board page retains exact IDs, its cursor and supported module rows", () => {
  const response = page(
    [
      task({ id: "18446744073709551615" }),
      task({ id: 42, workModule: "sales" }),
      task({ id: 43, workModule: "accounting" }),
      task({ id: 44, workModule: "expenses" }),
    ],
    "opaque-cursor",
  )
  assert.deepEqual(parseWorkBoardPage(response, scope), response)
  assert.deepEqual(parseWorkBoardPage(page([]), scope), {
    data: [],
    nextCursor: null,
  })
  assert.equal(
    parseWorkBoardPage(page([task()]), { ...scope, scope: "purchasing" }).data
      .length,
    1,
  )
})

test("any foreign row rejects the entire page before records or counts are exposed", () => {
  for (const invalid of [
    task({ companyId: 12 }),
    task({ organizationId: 8 }),
    { ...task(), companyId: undefined, company_id: 12 },
    { ...task(), organizationId: undefined, organization_id: 8 },
    { ...task(), workModule: "inventory" },
  ]) {
    assert.throws(
      () => parseWorkBoardPage(page([task({ id: "40" }), invalid]), scope),
      /out-of-scope/,
    )
  }
  assert.throws(
    () =>
      parseWorkBoardPage(page([task({ workModule: "sales" })]), {
        ...scope,
        scope: "purchasing",
      }),
    /out-of-scope/,
  )
})

test("unsafe, malformed and out-of-range task IDs cannot enter a board", () => {
  for (const id of [
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    NaN,
    null,
    "0",
    "-1",
    "01",
    "1e3",
    "",
    "18446744073709551616",
  ]) {
    assert.throws(
      () => parseWorkBoardPage(page([{ ...task(), id }]), scope),
      /invalid/i,
      String(id),
    )
  }
})

test("malformed envelopes and authorization metadata are rejected", () => {
  for (const response of [
    null,
    [],
    {},
    { data: [], nextCursor: 2 },
    { data: [] },
    { data: null, nextCursor: null },
  ]) {
    assert.throws(
      () => parseWorkBoardPage(response, scope),
      /Invalid work board response/,
    )
  }
  for (const patch of [
    { workAssignedToMe: "yes" },
    { workActions: ["delete"] },
    { workActions: "approve" },
    { workTeamRefs: [{ kind: "arbitrary-team", id: "5" }] },
    { workTeamRefs: [{ kind: "department", id: "0" }] },
    {
      actingForOptions: [
        { identityHex: "bad", label: "Approver", workActions: ["approve"] },
      ],
    },
    {
      actingForOptions: [
        {
          identityHex: firstDelegate,
          label: "Approver",
          workActions: ["delete"],
        },
      ],
    },
    { actingForOptions: [{ identityHex: firstDelegate, label: "Approver" }] },
    { status: "Unexpected" },
  ]) {
    assert.throws(
      () => parseWorkBoardPage(page([{ ...task(), ...patch }]), scope),
      /invalid/i,
    )
  }
})

test("known state encodings are accepted and ambiguous states fail closed", () => {
  assert.equal(workStatus(task({ status: "Claimed" })), "Claimed")
  assert.equal(workStatus(task({ status: { tag: "Approved" } })), "Approved")
  assert.equal(
    workStatus({
      ...task(),
      status: { Cancelled: [] },
    } as unknown as WorkTaskRow),
    "Cancelled",
  )
  for (const status of [
    undefined,
    {},
    { tag: "Unknown" },
    { Open: [], Cancelled: [] },
  ]) {
    assert.equal(
      workStatus({ ...task(), status } as unknown as WorkTaskRow),
      null,
    )
  }
})

test("direct and selected delegated capabilities never combine", () => {
  const row = task({
    workActions: ["claim"],
    actingForOptions: [
      {
        identityHex: firstDelegate,
        label: "Approver",
        workActions: ["approve", "reject"],
      },
      {
        identityHex: secondDelegate.toUpperCase(),
        label: "Completer",
        workActions: ["complete"],
      },
    ],
  })
  assert.deepEqual(workActionsForActor(row), ["claim"])
  assert.deepEqual(workActionsForActor(row, ""), ["claim"])
  assert.deepEqual(workActionsForActor(row, firstDelegate), [
    "approve",
    "reject",
  ])
  assert.deepEqual(workActionsForActor(row, `0x${secondDelegate}`), [
    "complete",
  ])
  assert.deepEqual(workActionsForActor(row, "12".repeat(32)), [])
  assert.equal(canMoveWorkTask(row, "Approved"), false)
  assert.equal(canMoveWorkTask(row, "Approved", firstDelegate), true)
  assert.equal(canMoveWorkTask(row, "Completed", firstDelegate), false)
})

test("delegated-only rows require an eligible unambiguous or explicit principal", () => {
  const row = task({
    directlyEligible: false,
    workActions: ["claim"],
    actingForOptions: [
      {
        identityHex: firstDelegate,
        label: "Approver",
        workActions: ["approve"],
      },
      {
        identityHex: secondDelegate,
        label: "Completer",
        workActions: ["complete"],
      },
    ],
  })
  assert.deepEqual(workActionsForActor(row), [])
  assert.deepEqual(workActionsForActor(row, ""), [])
  assert.deepEqual(workActionsForActor(row, secondDelegate), ["complete"])
  assert.deepEqual(
    workActionsForActor({
      ...row,
      actingForOptions: row.actingForOptions?.slice(0, 1),
    }),
    ["approve"],
  )
  assert.deepEqual(
    workActionsForActor({ ...row, actingForOptions: [] }, firstDelegate),
    [],
  )
})

test("only lifecycle action destinations map to executable operations", () => {
  assert.equal(workActionForColumn("Claimed"), "claim")
  assert.equal(workActionForColumn("Approved"), "approve")
  assert.equal(workActionForColumn("Rejected"), "reject")
  assert.equal(workActionForColumn("Completed"), "complete")
  for (const destination of [
    "Open",
    "Invalidated",
    "Cancelled",
    "Unknown",
    "approve",
  ]) {
    assert.equal(workActionForColumn(destination), null)
    assert.equal(
      canMoveWorkTask(
        task({ workActions: ["claim", "approve", "reject", "complete"] }),
        destination,
      ),
      false,
    )
  }
  assert.equal(canMoveWorkTask(task({ status: "Claimed" }), "Claimed"), false)
})

test("terminal or unknown tasks cannot be dragged even when stale capabilities remain", () => {
  for (const status of [
    "Approved",
    "Completed",
    "Rejected",
    "Invalidated",
    "Cancelled",
    "Unexpected",
  ]) {
    const row = task({
      status,
      workActions: ["claim", "approve", "reject", "complete"],
    })
    for (const target of ["Claimed", "Approved", "Completed", "Rejected"]) {
      assert.equal(
        canMoveWorkTask(row, target),
        false,
        `${status} -> ${target}`,
      )
    }
  }
})

test("cancelled recovery uses only the actual actor's capability and never a column transition", () => {
  const row = task({
    status: "Cancelled",
    directlyEligible: false,
    workActions: ["resubmit", "approve"],
    actingForOptions: [{ identityHex: firstDelegate, label: "Former approver", workActions: ["resubmit"] }],
  })
  assert.deepEqual(workActionsForActor(row), ["resubmit"])
  assert.deepEqual(workActionsForActor(row, ""), ["resubmit"])
  assert.deepEqual(workActionsForActor(row, firstDelegate), [])
  assert.deepEqual(workActionsForActor({ ...row, workActions: [] }), [])
  for (const status of ["Open", "Claimed", "Approved", "Rejected", "Invalidated"]) {
    assert.equal(workActionsForActor({ ...row, status, directlyEligible: true }).includes("resubmit"), false)
  }
  assert.doesNotThrow(() => parseWorkBoardPage(page([row]), scope))
  for (const target of ["Open", "Claimed", "Approved", "Cancelled"]) {
    assert.equal(canMoveWorkTask(row, target), false)
  }
})

test("cache keys separate actor, authorization, company, module, view and team", () => {
  const originalKey = workBoardQueryKey(scope)
  const variants: Partial<WorkBoardScope>[] = [
    { organizationId: 8 },
    { actorIdentity: firstDelegate },
    { authorizationKey: "permissions-v4" },
    { companyId: 12 },
    { scope: "purchasing" },
    { view: "mine" },
    { view: "available" },
    { team: "department:5" },
    { team: "workflow-group:5" },
  ]
  const keys = variants.map((patch) =>
    workBoardQueryKey({ ...scope, ...patch }),
  )
  for (const key of keys) assert.notDeepEqual(key, originalKey)
  assert.equal(
    new Set(keys.map((key) => JSON.stringify(key))).size,
    keys.length,
  )
})

test("queries send bounded module, view and team filters and encode opaque cursors", () => {
  const url = new URL(
    workBoardQueryPath(
      {
        ...scope,
        scope: "purchasing",
        view: "available",
        team: "workflow-group:5",
      },
      "a+b&limit=999",
    ),
    "https://erp.test",
  )
  assert.equal(url.pathname, "/api/query/workflow-human-tasks")
  assert.equal(url.searchParams.get("companyId"), "11")
  assert.equal(url.searchParams.get("workScope"), "purchasing")
  assert.equal(url.searchParams.get("workView"), "available")
  assert.equal(url.searchParams.get("workTeam"), "workflow-group:5")
  assert.equal(url.searchParams.get("limit"), "50")
  assert.equal(url.searchParams.get("cursor"), "a+b&limit=999")
  assert.equal(url.searchParams.getAll("limit").length, 1)
})

test("invalid query scopes cannot be dispatched", () => {
  for (const patch of [
    { companyId: 0 },
    { companyId: -1 },
    { companyId: 1.5 },
    { companyId: Number.MAX_SAFE_INTEGER + 1 },
    { organizationId: 0 },
    { organizationId: NaN },
    { scope: "all" },
    { view: "all" },
    { team: "team:5" },
    { team: "department:0" },
    { team: "workflow-group:05" },
    { team: "department:18446744073709551616" },
    { actorIdentity: "" },
    { authorizationKey: "" },
  ]) {
    assert.throws(
      () => workBoardQueryPath({ ...scope, ...patch } as WorkBoardScope),
      /Invalid work board scope/,
      JSON.stringify(patch),
    )
  }
})

test("scope and team helpers accept only supported explicit selectors", () => {
  for (const module of [
    "finance",
    "purchasing",
    "sales",
    "accounting",
    "expenses",
  ])
    assert.equal(isWorkScope(module), true)
  for (const invalid of ["", "all", "inventory", undefined, ["sales"]])
    assert.equal(isWorkScope(invalid), false)
  for (const view of ["eligible", "mine", "available"])
    assert.equal(isWorkView(view), true)
  assert.equal(isWorkView("all"), false)
  assert.equal(workTeamKey({ kind: "department", id: "5" }), "department:5")
  assert.equal(isWorkTeamKey("department:5"), true)
  assert.equal(isWorkTeamKey("workflow-group:18446744073709551615"), true)
  for (const key of [
    "",
    "team:5",
    "department:0",
    "department:-1",
    "department:1e3",
    "workflow-group:18446744073709551616",
  ]) {
    assert.equal(isWorkTeamKey(key), false)
  }
})
