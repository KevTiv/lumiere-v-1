import { expect, test, type Request } from "@playwright/test"
import type { DecideHumanTaskInput } from "@lumiere/query-hooks/hooks/approvals"
import { newHumanTaskAttempt } from "@lumiere/query-hooks/hooks/human-task-command"
import { approvalSelection, approvalTaskStatus } from "@lumiere/query-hooks/hooks/approval-controls"
import { taskIdentityHex } from "@lumiere/query-hooks/hooks/task-assignment"
import { provisionActor, openActorPages, loseNextResponse } from "./pretenant-support"
import { matchesOperationResponse } from "./operation-response"
import { fetchPurchaseOrderReceipts, fetchPurchaseOrderState } from "./purchasing-order-fixtures"
import {
  WORK_REVIEWER_PERMISSIONS, seedWorkReviewWorkflow, workScopeFor,
  createPendingWorkReview, readWorkTask, openWorkReview, claimWorkCommand,
  decideWorkCommand, postWorkCommand, readWorkCommandProof,
} from "./work-board-acceptance-support"

function capturedDecisionInput(request: Request): DecideHumanTaskInput {
  const params = request.postDataJSON().params as Record<string, unknown>
  const optional = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value
    if ("some" in value) return optional(value.some)
    return "none" in value ? null : value
  }
  const wireDecision = approvalTaskStatus({ status: params.decision })?.toLowerCase()
  const decision = wireDecision === "approve" ? "Approve" : wireDecision === "reject" ? "Reject" : wireDecision === "complete" ? "Complete" : null
  if (!decision) throw new Error("Malformed captured decision")
  return {
    companyId: Number(params.company_id), taskId: Number(params.task_id),
    expectedTaskRevision: Number(params.expected_task_revision), expectedInstanceRevision: Number(params.expected_instance_revision),
    decision: { tag: decision }, actingFor: taskIdentityHex(optional(params.acting_for)),
    comment: optional(params.comment) as string | null,
    attempt: { idempotencyKey: String(params.idempotency_key), correlationId: String(params.correlation_id) },
  }
}

// Existing E2E runner uses one worker per isolated database; independent actor
// contexts inside each case issue competing native transactions concurrently.
test.describe("Finance work board concurrency and exact command evidence", { tag: ["@dev-fixture", "@work-board"] }, () => {
  test.describe.configure({ mode: "serial" })

  test("ordinary reviewers race a claim and opposite decisions; readers and cross-actor receipt replays are denied", async ({ page, browser }) => {
    test.setTimeout(300_000)
    const actors = await Promise.all([
      provisionActor(page, "work-review-a", WORK_REVIEWER_PERMISSIONS),
      provisionActor(page, "work-review-b", WORK_REVIEWER_PERMISSIONS),
      provisionActor(page, "work-reader", ["company:read", "workflow:read", "purchase_order:read"]),
    ])
    const workflow = await seedWorkReviewWorkflow(page, actors.map((actor) => actor.roleId))
    const sessions = await openActorPages(browser, actors)
    try {
      const [first, second, reader] = sessions.pages
      if (!first || !second || !reader) throw new Error("Missing independent reviewer session")
      const scopes = actors.map((actor) => workScopeFor(workflow, actor))
      const claimTask = await createPendingWorkReview(page, first)
      const beforeClaim = await readWorkTask(first, scopes[0]!, claimTask.taskId)
      if (!beforeClaim) throw new Error("Claim fixture missing")
      const selected = approvalSelection(beforeClaim, workflow.companyId, "")
      const claims = actors.slice(0, 2).map(() => ({
        companyId: workflow.companyId, taskId: claimTask.taskId,
        expectedRevision: selected.expectedTaskRevision, attempt: newHumanTaskAttempt("claim"),
      }))
      const readonly = await readWorkTask(reader, scopes[2]!, claimTask.taskId)
      expect(readonly?.workActions).toEqual([])
      const denied = await postWorkCommand(reader, claimWorkCommand(claims[0]!))
      expect(denied.status(), await denied.text()).toBe(403)

      const results = await Promise.all([
        postWorkCommand(first, claimWorkCommand(claims[0]!)),
        postWorkCommand(second, claimWorkCommand(claims[1]!)),
      ])
      expect(results.filter((response) => response.ok())).toHaveLength(1)
      const winner = results.findIndex((response) => response.ok())
      const loser = 1 - winner
      expect([409, 422]).toContain(results[loser]!.status())
      const claimed = await readWorkTask(first, scopes[0]!, claimTask.taskId)
      expect(approvalTaskStatus({ status: claimed?.status })).toBe("Claimed")
      expect(Number(claimed?.revision)).toBe(selected.expectedTaskRevision + 1)
      expect(taskIdentityHex(claimed?.claimedBy ?? claimed?.claimed_by)).toBe(actors[winner]!.identityHex)
      const confirmed = await readWorkCommandProof(sessions.pages[winner]!, scopes[winner]!, { kind: "claim", input: claims[winner]! })
      expect(confirmed.effect?.id).toBe(String(claimTask.taskId))
      expect((await readWorkCommandProof(sessions.pages[loser]!, scopes[loser]!, { kind: "claim", input: claims[loser]! })).effect).toBeNull()
      const wrongActorReplay = await postWorkCommand(sessions.pages[loser]!, claimWorkCommand(claims[winner]!))
      expect(wrongActorReplay.status(), await wrongActorReplay.text()).toBe(403)
      expect((await postWorkCommand(sessions.pages[winner]!, claimWorkCommand(claims[winner]!))).ok()).toBe(true)
      expect(Number((await readWorkTask(first, scopes[0]!, claimTask.taskId))?.revision)).toBe(selected.expectedTaskRevision + 1)

      const decisionTask = await createPendingWorkReview(page, first)
      const beforeDecision = await readWorkTask(first, scopes[0]!, decisionTask.taskId)
      if (!beforeDecision) throw new Error("Decision fixture missing")
      const review = approvalSelection(beforeDecision, workflow.companyId, "")
      const decisions: DecideHumanTaskInput[] = ["Approve", "Reject"].map((tag) => ({
        companyId: workflow.companyId, taskId: decisionTask.taskId,
        expectedTaskRevision: review.expectedTaskRevision, expectedInstanceRevision: review.expectedInstanceRevision,
        decision: { tag: tag as "Approve" | "Reject" }, comment: "Independent concurrent review", attempt: newHumanTaskAttempt("decision"),
      }))
      const decisionsResult = await Promise.all([
        postWorkCommand(first, decideWorkCommand(decisions[0]!)),
        postWorkCommand(second, decideWorkCommand(decisions[1]!)),
      ])
      expect(decisionsResult.filter((response) => response.ok())).toHaveLength(1)
      const decisionWinner = decisionsResult.findIndex((response) => response.ok())
      expect([409, 422]).toContain(decisionsResult[1 - decisionWinner]!.status())
      const after = await readWorkTask(first, scopes[0]!, decisionTask.taskId)
      expect(Number(after?.revision)).toBe(review.expectedTaskRevision + 1)
      expect(approvalTaskStatus({ status: after?.status })).toBe(decisionWinner === 0 ? "Approved" : "Rejected")
      expect((await readWorkCommandProof(sessions.pages[decisionWinner]!, scopes[decisionWinner]!, { kind: "decision", input: decisions[decisionWinner]! })).effect?.id).toBe(String(decisionTask.taskId))
      expect((await readWorkCommandProof(sessions.pages[1 - decisionWinner]!, scopes[1 - decisionWinner]!, { kind: "decision", input: decisions[1 - decisionWinner]! })).effect).toBeNull()
      expect((await fetchPurchaseOrderState(page, decisionTask.orderId))?.toLowerCase()).toBe(decisionWinner === 0 ? "purchase" : "draft")
      expect(await fetchPurchaseOrderReceipts(page, decisionTask.orderId)).toHaveLength(decisionWinner === 0 ? 1 : 0)
    } finally {
      await sessions.close()
      await workflow.retire()
    }
  })

  test("a real lost reply for a partial AllCandidates vote is confirmed only by its own receipt, then quorum creates one domain effect", async ({ page, browser }) => {
    test.setTimeout(300_000)
    const actors = await Promise.all([
      provisionActor(page, "work-quorum-a", WORK_REVIEWER_PERMISSIONS),
      provisionActor(page, "work-quorum-b", WORK_REVIEWER_PERMISSIONS),
    ])
    const workflow = await seedWorkReviewWorkflow(page, actors.map((actor) => actor.roleId), "AllCandidates")
    const sessions = await openActorPages(browser, actors)
    try {
      const [first, second] = sessions.pages
      if (!first || !second) throw new Error("Missing independent reviewer session")
      const firstScope = workScopeFor(workflow, actors[0]!)
      const secondScope = workScopeFor(workflow, actors[1]!)
      const pending = await createPendingWorkReview(page, first)
      const row = await openWorkReview(first, firstScope, pending.taskId)
      const requests: Request[] = []
      first.on("request", (request) => {
        if (request.method() === "POST" && matchesOperationResponse(request, "decide_workflow_human_task")) requests.push(request)
      })
      const lost = await loseNextResponse(first, "decide_workflow_human_task")
      await first.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click()
      await expect(first.getByText("Assignment updated and confirmed.", { exact: true })).toBeVisible({ timeout: 30_000 })
      expect(lost.lost()).toBe(true)
      expect(requests).toHaveLength(1)
      const original = capturedDecisionInput(requests[0]!)
      const partial = await readWorkTask(first, firstScope, pending.taskId)
      expect(approvalTaskStatus({ status: partial?.status })).toBe("Open")
      expect(Number(partial?.revision)).toBe(Number(row.revision) + 1)
      expect(partial?.workActions).toEqual([])
      expect(await fetchPurchaseOrderReceipts(page, pending.orderId)).toHaveLength(0)
      expect((await readWorkCommandProof(first, firstScope, { kind: "decision", input: original })).effect?.id).toBe(String(pending.taskId))
      // A different authenticated actor cannot use this key/hash as evidence of its own vote.
      expect((await readWorkCommandProof(second, secondScope, { kind: "decision", input: original })).effect).toBeNull()

      await openWorkReview(second, secondScope, pending.taskId)
      await second.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click()
      await expect(second.getByText("Assignment updated and confirmed.", { exact: true })).toBeVisible({ timeout: 30_000 })
      const completed = await readWorkTask(second, secondScope, pending.taskId)
      expect(approvalTaskStatus({ status: completed?.status })).toBe("Approved")
      expect(Number(completed?.revision)).toBe(Number(row.revision) + 2)
      expect(await fetchPurchaseOrderReceipts(page, pending.orderId)).toHaveLength(1)
      // A later reviewer advancing the task does not destroy proof of the original partial vote.
      expect((await readWorkCommandProof(first, firstScope, { kind: "decision", input: original })).effect?.id).toBe(String(pending.taskId))
      expect(requests).toHaveLength(1)
    } finally {
      await sessions.close()
      await workflow.retire()
    }
  })
})
