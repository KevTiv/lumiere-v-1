import assert from "node:assert/strict"
import test from "node:test"
import { canReadWorkflowWork } from "./work-board-permissions"
import { resolveWorkBoardSource, workBoardSources, workBoardStatuses } from "./work-board-config"

test("work discovery accepts explicit workflow and module read grants", () => {
  for (const grant of ["workflow", "workflows", "module:workflows"]) {
    assert.equal(
      canReadWorkflowWork((resource) => ({ allowed: resource === grant })),
      true,
    )
  }
  assert.equal(
    canReadWorkflowWork(() => ({ allowed: false })),
    false,
  )
})

test("an explicit read denial takes priority over a discovery alias", () => {
  assert.equal(
    canReadWorkflowWork((resource) =>
      resource === "workflow"
        ? {
            allowed: false,
            rule: {
              id: "deny",
              subject: "actor",
              resource,
              action: "read",
              effect: "deny",
            },
          }
        : { allowed: true },
    ),
    false,
  )
})

test("embedded source configuration cannot be broadened through the URL", () => {
  const readable = { workflow: true, activities: true }
  assert.equal(
    resolveWorkBoardSource("activities", workBoardSources("purchasing", ["workflow"]), readable),
    "workflow",
  )
  assert.equal(
    resolveWorkBoardSource("workflow", workBoardSources("sales", ["activities"]), readable),
    "activities",
  )
  assert.deepEqual(workBoardSources("expenses", ["activities"]), [])
  assert.deepEqual(workBoardSources("expenses"), ["workflow"])
})

test("revocation keeps an explicit supported source selected for denial", () => {
  assert.equal(
    resolveWorkBoardSource("workflow", workBoardSources("finance"), {
      workflow: false,
      activities: true,
    }),
    "workflow",
  )
  assert.equal(
    resolveWorkBoardSource(null, workBoardSources("finance"), {
      workflow: false,
      activities: true,
    }),
    "activities",
  )
})

test("a disabled assignment view has no selectable source", () => {
  assert.equal(
    resolveWorkBoardSource("workflow", workBoardSources("purchasing", []), {
      workflow: true,
      activities: true,
    }),
    undefined,
  )
})

test("column specialization retains every canonical state including cancelled history", () => {
  assert.deepEqual(workBoardStatuses(["Claimed", "Open", "Claimed"]), [
    "Claimed", "Open", "Approved", "Completed", "Rejected", "Invalidated", "Cancelled",
  ])
})
