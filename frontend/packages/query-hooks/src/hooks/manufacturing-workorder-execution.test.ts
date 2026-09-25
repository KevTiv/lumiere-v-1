import assert from "node:assert/strict"
import test from "node:test"

import {
  resolveProductivityEffect,
  resolveWorkorderFinishedEffect,
  resolveWorkorderStateEffect,
} from "./manufacturing-workorder-execution"

const workorder = {
  id: 5,
  companyId: 7,
  productionId: 10,
  workcenterId: 20,
  state: { tag: "Progress" },
  timeIds: [100],
  duration: 2,
  durationExpected: 10,
  progress: 20,
  isProduced: false,
}

const production = {
  id: 10,
  companyId: 7,
  state: { tag: "Progress" },
  workorderIds: [5],
}

const workcenter = {
  id: 20,
  companyId: 7,
  orderIds: [5],
  productivityIds: [100],
  productiveTime: 2,
  workorderCount: 1,
  workorderProgressCount: 1,
}

test("workorder state readback requires exact parent and workcenter ownership", () => {
  assert.deepEqual(
    resolveWorkorderStateEffect(
      [workorder],
      [production],
      [workcenter],
      5n,
      7n,
      "progress",
    ),
    {
      resource: "mrp-workorders",
      id: "5",
      companyId: "7",
      productionId: "10",
      workcenterId: "20",
    },
  )

  assert.equal(
    resolveWorkorderStateEffect(
      [workorder],
      [{ ...production, workorderIds: [] }],
      [workcenter],
      5n,
      7n,
      "progress",
    ),
    null,
  )
  assert.equal(
    resolveWorkorderStateEffect(
      [workorder],
      [production],
      [{ ...workcenter, orderIds: [] }],
      5n,
      7n,
      "progress",
    ),
    null,
  )
})

test("productivity effect is the same single new id in workorder and workcenter relations", () => {
  assert.deepEqual(
    resolveProductivityEffect(
      [{ ...workorder, timeIds: [100, 101], duration: 3.5 }],
      [production],
      [{ ...workcenter, productivityIds: [100, 101], productiveTime: 3.5 }],
      5n,
      7n,
      20n,
      1.5,
      {
        workorderTimeIds: ["100"],
        workorderDuration: 2,
        workcenterProductivityIds: ["100"],
        workcenterProductiveTime: 2,
      },
    ),
    {
      resource: "mrp-workcenter-productivity",
      id: "101",
      companyId: "7",
      workorderId: "5",
      workcenterId: "20",
    },
  )
})

test("productivity readback fails on mismatched ids, duration, or productive time", () => {
  const before = {
    workorderTimeIds: ["100"],
    workorderDuration: 2,
    workcenterProductivityIds: ["100"],
    workcenterProductiveTime: 2,
  }

  assert.equal(
    resolveProductivityEffect(
      [{ ...workorder, timeIds: [100, 101], duration: 3 }],
      [production],
      [{ ...workcenter, productivityIds: [100, 102], productiveTime: 3 }],
      5n,
      7n,
      20n,
      1,
      before,
    ),
    null,
  )
  assert.equal(
    resolveProductivityEffect(
      [{ ...workorder, timeIds: [100, 101], duration: 4 }],
      [production],
      [{ ...workcenter, productivityIds: [100, 101], productiveTime: 3 }],
      5n,
      7n,
      20n,
      1,
      before,
    ),
    null,
  )
  assert.equal(
    resolveProductivityEffect(
      [{ ...workorder, timeIds: [100, 101], duration: 3 }],
      [production],
      [{ ...workcenter, productivityIds: [100, 101], productiveTime: 4 }],
      5n,
      7n,
      20n,
      1,
      before,
    ),
    null,
  )
})

test("finish preserves productivity relation and duration while closing the exact workorder", () => {
  assert.deepEqual(
    resolveWorkorderFinishedEffect(
      [
        {
          ...workorder,
          state: "Done",
          duration: 2,
          progress: 100,
          isProduced: true,
        },
      ],
      [production],
      [{ ...workcenter, workorderProgressCount: 0 }],
      5n,
      7n,
      {
        workorderTimeIds: ["100"],
        workorderDuration: 2,
        workcenterCount: 1,
        workcenterProgressCount: 1,
      },
    ),
    {
      resource: "mrp-workorders",
      id: "5",
      companyId: "7",
      productionId: "10",
      workcenterId: "20",
    },
  )

  assert.equal(
    resolveWorkorderFinishedEffect(
      [
        {
          ...workorder,
          state: "Done",
          timeIds: [100, 101],
          progress: 100,
          isProduced: true,
        },
      ],
      [production],
      [{ ...workcenter, workorderProgressCount: 0 }],
      5n,
      7n,
      {
        workorderTimeIds: ["100"],
        workorderDuration: 2,
        workcenterCount: 1,
        workcenterProgressCount: 1,
      },
    ),
    null,
  )
})
