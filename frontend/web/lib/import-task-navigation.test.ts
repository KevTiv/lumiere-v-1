import assert from "node:assert/strict"
import test from "node:test"
import {
  importTaskHref,
  readImportTaskLocation,
  withImportTaskLocation,
} from "./import-task-navigation"

const location = {
  taskId: "a".repeat(32),
  companyId: 3,
  view: "decisions" as const,
  reviewId: "71",
}

test("saved import links restore their task, company, review and view across conversations", () => {
  const href = importTaskHref(location)
  assert.equal(
    href,
    "/settings?section=imports&importTask=" +
      location.taskId +
      "&importCompany=3&importView=decisions&sourceReview=71&sourceReviewCompany=3#import-task",
  )
  assert.deepEqual(
    readImportTaskLocation(new URL(href, "https://example.com").search, 3),
    location,
  )
  assert.equal(
    readImportTaskLocation(new URL(href, "https://example.com").search, 4),
    null,
  )
})

test("task navigation preserves the workspace and removes an unrelated pinned source revision", () => {
  const previous = new URL(
    "https://example.com/settings?section=imports&filter=open&sourceReviewItem=12&sourceReviewRevision=4",
  )
  const next = withImportTaskLocation(previous, {
    ...location,
    view: "results",
  })
  assert.equal(next.searchParams.get("filter"), "open")
  assert.equal(next.searchParams.get("section"), "imports")
  assert.equal(next.searchParams.get("importView"), "results")
  assert.equal(next.searchParams.has("sourceReviewItem"), false)
  assert.equal(next.searchParams.has("sourceReviewRevision"), false)
  assert.equal(previous.searchParams.get("sourceReviewItem"), "12")
})

test("untrusted links cannot select another company, an invalid task, or an invalid review", () => {
  assert.equal(
    readImportTaskLocation("?importTask=../other&importCompany=3", 3),
    null,
  )
  assert.equal(
    readImportTaskLocation(
      "?importTask=" +
        location.taskId +
        "&importCompany=3&sourceReviewCompany=3&sourceReview=0",
      3,
    ),
    null,
  )
  assert.throws(
    () => importTaskHref({ ...location, companyId: 0 }),
    /valid saved import/,
  )
  assert.throws(
    () => importTaskHref({ ...location, taskId: "../other" }),
    /valid saved import/,
  )
})
