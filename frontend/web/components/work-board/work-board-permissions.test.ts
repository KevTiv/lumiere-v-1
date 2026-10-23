import assert from "node:assert/strict"
import test from "node:test"
import { canReadWorkflowWork } from "./work-board-permissions"

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
