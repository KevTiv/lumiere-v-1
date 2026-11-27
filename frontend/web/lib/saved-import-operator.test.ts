import assert from "node:assert/strict"
import test from "node:test"
import type { ChatImportTask } from "./chat-import-task"
import type { ImportWorkflow } from "./import-workflow"
import { parseSavedImportRuns, savedImportOperatorState } from "./saved-import-operator"

const taskId = "a".repeat(32)
const review = { id: "12", title: "Source rows", targetEntity: "product", total: 4, pending: 0, confirmed: 4, excluded: 0 }
const task: ChatImportTask = {
  requestId: taskId, companyId: "2", conversationKey: "saved-import", status: "needs_review",
  decision: {
    id: "question", revision: 1, status: "approved", question: "What should we do?",
    options: [{ id: "prepare_import", label: "Prepare" }], allowOther: true,
    selectedOptionId: "prepare_import", otherText: null, decisionId: null,
  },
  decisionReceipt: null, decisionHistory: [],
  files: [{ ordinal: 0, fileName: "original.csv", size: 8, sha256: "a".repeat(64) }],
  reviews: [review], warnings: [], error: null, createdAt: "2026-11-27T21:00:00Z",
}
function run(status: string, verifiedRowCount = 0) {
  return parseSavedImportRuns({
    runs: [{ id: "b".repeat(64), taskId, status, rowCount: 4, verifiedRowCount }],
    coverage: { reviewRowCount: 4, verifiedRowCount, complete: verifiedRowCount === 4 },
  }, taskId)
}

test("durable activity and partial evidence give different operator actions", () => {
  assert.deepEqual(savedImportOperatorState({ task, nextView: "preview" }), { queue: "needs-me", action: "preview" })
  for (const status of ["queued", "running"]) {
    assert.deepEqual(savedImportOperatorState({ task, progress: run(status) }), { queue: "running", action: "check" })
  }
  assert.deepEqual(savedImportOperatorState({ task, progress: run("partial", 2) }), { queue: "needs-me", action: "check" })
  assert.equal(savedImportOperatorState({ task, runCheckFailed: true }).action, "check")
})

test("native receipt success is separate from full verified current-source coverage", () => {
  const held = { ...task, reviews: [{ ...review, pending: 1, confirmed: 3 }] }
  assert.deepEqual(savedImportOperatorState({ task, progress: run("verified", 4) }), { queue: "done", action: "results" })
  assert.deepEqual(savedImportOperatorState({ task: held, progress: run("verified", 4) }), { queue: "needs-me", action: "decisions" })
  const oldReceipt: ImportWorkflow = {
    version: 1, requestId: taskId, organizationId: "1", companyId: "2", capabilities: [], proposals: [],
    nativeResultsMore: false,
    nativeResults: [{
      requestId: taskId, entity: "product", fileName: "original.csv", contentSha256: "a".repeat(64),
      reviewItemCount: 4, reviewIds: ["12"], submittedAt: task.createdAt,
      verification: "native_receipt_only", state: "receipt_available",
      receipt: { jobId: "13", status: "success", totalRows: 4, rowsImported: 4, errorRows: 0 },
    }],
  }
  assert.deepEqual(savedImportOperatorState({ task, workflow: oldReceipt, nextView: "results" }), { queue: "needs-me", action: "results" })
})

test("the reviewer and sender get different actions, and uncertain answers can be checked", () => {
  const handedOff = { ...task, handoff: { creator: "clerk", recipient: "owner", revision: 1, canManage: true, canReview: false } }
  assert.deepEqual(savedImportOperatorState({ task: handedOff }), { queue: "with-reviewer", action: "handoff" })
  const received = { ...handedOff, handoff: { ...handedOff.handoff, canManage: false, canReview: true } }
  assert.equal(savedImportOperatorState({ task: received, nextView: "decisions" }).queue, "needs-me")
  assert.equal(savedImportOperatorState({ task: received, pendingAnswer: true }).action, "check")
})

test("foreign and inconsistent run coverage cannot certify completion", () => {
  const complete = run("verified", 4)
  assert.throws(() => parseSavedImportRuns(complete, "f".repeat(32)))
  assert.throws(() => parseSavedImportRuns({ ...complete, runs: [...complete.runs, ...complete.runs] }, taskId))
  assert.throws(() => parseSavedImportRuns({ ...complete, runs: [] }, taskId))
  assert.throws(() => parseSavedImportRuns({ ...complete, coverage: { ...complete.coverage, verifiedRowCount: 1 } }, taskId))
})
