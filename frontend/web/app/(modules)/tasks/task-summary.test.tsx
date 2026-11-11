import React from "react"
import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { TaskSummary } from "./task-summary"
import { taskBoardItemInState, toTaskBoardItem } from "./task-board-items"

Object.assign(globalThis, { React })

const items = [
  { columnId: "InProgress", isClosed: false, dueAt: 1 },
  { columnId: "Done", isClosed: true, dueAt: 1 },
  { columnId: "Approved", isClosed: false, dueAt: 200 },
]

test("task summaries count loaded tasks and exclude closed tasks from overdue", () => {
  const html = renderToStaticMarkup(<TaskSummary items={items} state={{ status: "ready" }} nowMs={100} />)
  for (const [key, count] of [["total", 3], ["inProgress", 1], ["done", 1], ["overdue", 1]]) {
    assert.match(html, new RegExp(`data-testid="task-summary-${key}">${count}<`))
  }
})

test("successfully empty tasks show zero but loading never invents counts", () => {
  const ready = renderToStaticMarkup(<TaskSummary items={[]} state={{ status: "ready" }} />)
  assert.match(ready, /data-testid="task-summary-total">0</)
  const loading = renderToStaticMarkup(<TaskSummary items={items} state={{ status: "loading" }} />)
  assert.match(loading, /aria-busy="true"/)
  assert.doesNotMatch(loading, /data-testid="task-summary-(?:total|inProgress|done|overdue)">\d/)
})

test("denied, failed and partial task reads suppress every cached summary figure", () => {
  for (const status of ["error", "denied", "partial"] as const) {
    const html = renderToStaticMarkup(<TaskSummary items={items} state={{ status }} />)
    assert.doesNotMatch(html, /data-testid="task-summary-(?:total|inProgress|done|overdue)"/)
    assert.match(html, /role="(?:alert|status)"/)
  }
})

test("an overdue task moved optimistically to Done is not also counted as overdue", () => {
  const overdue = toTaskBoardItem({ id: 1, name: "Overdue", state: "InProgress", priority: "1", isClosed: false, dateDeadline: "2026-01-01" }, {
    projectNames: new Map(), identityLabels: new Map(), attachmentCounts: new Map(),
  })
  const html = renderToStaticMarkup(<TaskSummary items={[taskBoardItemInState(overdue, "Done")]} state={{ status: "ready" }} nowMs={Date.parse("2026-01-02")} />)
  assert.match(html, /data-testid="task-summary-done">1</)
  assert.match(html, /data-testid="task-summary-overdue">0</)
})

const lookups = { projectNames: new Map(), identityLabels: new Map(), attachmentCounts: new Map() }
const raw = { id: 1, name: "Task", state: "InProgress", priority: "1", isClosed: false, dateDeadline: null }
const mappedSummary = (row: Parameters<typeof toTaskBoardItem>[0]) => renderToStaticMarkup(
  <TaskSummary items={[toTaskBoardItem(row, lookups)]} state={{ status: "ready" }} nowMs={Date.parse("2026-01-02")} />,
)

test("mapper preserves redacted and invalid deadlines instead of asserting no overdue tasks", () => {
  for (const dateDeadline of [undefined, "invalid", "", { unexpected: true }]) {
    const html = mappedSummary({ ...raw, dateDeadline })
    assert.match(html, /data-testid="task-summary-total">1</)
    assert.match(html, /data-testid="task-summary-inProgress">1</)
    assert.match(html, /data-testid="task-summary-done">0</)
    assert.doesNotMatch(html, /data-testid="task-summary-overdue">\d/)
    assert.match(html, /Some required task fields are unavailable/)
  }
  const { dateDeadline: _redacted, ...withoutDeadline } = raw
  assert.doesNotMatch(mappedSummary(withoutDeadline), /data-testid="task-summary-overdue">\d/)
  assert.match(mappedSummary(raw), /data-testid="task-summary-overdue">0</)
})

test("mapper preserves unknown closure while retaining independently known state counts", () => {
  const { isClosed: _redacted, ...withoutClosure } = raw
  for (const row of [withoutClosure, { ...raw, isClosed: undefined }, { ...raw, isClosed: "false" }]) {
    const html = mappedSummary({ ...row, dateDeadline: "2026-01-01" })
    assert.match(html, /data-testid="task-summary-total">1</)
    assert.match(html, /data-testid="task-summary-inProgress">1</)
    assert.match(html, /data-testid="task-summary-done">0</)
    assert.doesNotMatch(html, /data-testid="task-summary-overdue">\d/)
  }
})

test("mapper state fallbacks cannot invent progress and done counts", () => {
  const html = mappedSummary({ ...raw, state: undefined })
  assert.match(html, /data-testid="task-summary-total">1</)
  assert.match(html, /data-testid="task-summary-overdue">0</)
  assert.doesNotMatch(html, /data-testid="task-summary-(?:inProgress|done)">\d/)
})

test("optimistic completion preserves redacted deadline information when reopened", () => {
  const redacted = toTaskBoardItem({ ...raw, dateDeadline: undefined }, lookups)
  const done = taskBoardItemInState(redacted, "Done")
  const doneHtml = renderToStaticMarkup(<TaskSummary items={[done]} state={{ status: "ready" }} />)
  assert.match(doneHtml, /data-testid="task-summary-done">1</)
  assert.doesNotMatch(doneHtml, /data-testid="task-summary-overdue">\d/)
  const reopened = taskBoardItemInState(done, "InProgress")
  const reopenedHtml = renderToStaticMarkup(<TaskSummary items={[reopened]} state={{ status: "ready" }} />)
  assert.match(reopenedHtml, /data-testid="task-summary-inProgress">1</)
  assert.doesNotMatch(reopenedHtml, /data-testid="task-summary-overdue">\d/)
})
