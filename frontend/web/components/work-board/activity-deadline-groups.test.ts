import assert from "node:assert/strict"
import test from "node:test"
import { activityDeadlineGroup, groupActivityDeadlines } from "./activity-deadline-groups"

test("follow-up date grouping keeps today's work current through the end of its local date", () => {
  const lateToday = new Date(2026, 9, 28, 23, 59)
  assert.equal(activityDeadlineGroup({ isDone: false, dateDeadline: "2026-10-28" }, lateToday), "today")
  assert.equal(activityDeadlineGroup({ isDone: false, dateDeadline: "2026-10-27" }, lateToday), "overdue")
  assert.equal(activityDeadlineGroup({ isDone: false, dateDeadline: "2026-10-29" }, lateToday), "upcoming")
  for (const value of [null, ""]) {
    assert.equal(activityDeadlineGroup({ isDone: false, dateDeadline: value }, lateToday), "undated")
  }
  for (const value of [undefined, "2026-02-30", "hidden", "2026-10-28T00:00:00Z"]) {
    assert.equal(activityDeadlineGroup({ isDone: false, dateDeadline: value }, lateToday), "unavailable")
  }
  assert.equal(activityDeadlineGroup({ isDone: true, dateDeadline: "2026-10-27" }, lateToday), "completed")
})

test("loaded follow-ups keep distinct completed and undated groups and sort within a group", () => {
  const rows = [
    { id: 1, isDone: false, dateDeadline: "2026-11-02" },
    { id: 2, isDone: true, dateDeadline: "2026-10-20" },
    { id: 3, isDone: false, dateDeadline: null },
    { id: 4, isDone: false, dateDeadline: "2026-10-30" },
  ]
  const groups = groupActivityDeadlines(rows, new Date(2026, 9, 28))
  assert.deepEqual(groups.map((group) => [group.id, group.rows.map((row) => row.id)]), [
    ["upcoming", [4, 1]], ["undated", [3]], ["completed", [2]],
  ])
})
