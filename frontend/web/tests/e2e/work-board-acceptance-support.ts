import { expect, type Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { encodeIdentity, stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type { ClaimHumanTaskInput, DecideHumanTaskInput } from "@lumiere/query-hooks/hooks/approvals"
import {
  humanTaskClaimExpectation, humanTaskDecisionExpectation,
  humanTaskCommandReadbackPath, resolveHumanTaskCommandEffect,
} from "@lumiere/query-hooks/hooks/human-task-command"
import {
  parseWorkBoardPage, type WorkBoardScope, type WorkTaskRow,
} from "@lumiere/query-hooks/hooks/work-board-model"
import {
  callReducerBff, callReducerOwner, seedPublishableWorkflowDraft,
  smokeName, waitForPendingApprovalRequest, waitForWorkflowVersionStatus,
} from "./helpers"
import { createDraftPurchaseOrder, addLaptopPurchaseLine } from "./purchasing-order-fixtures"
import type { Actor } from "./pretenant-support"

/** Ordinary reviewers retain the exact permissions required by the existing PO adapter; no administrator or wildcard role. */
export const WORK_REVIEWER_PERMISSIONS = [
  "company:read", "workflow:read", "workflow_task:write", "workflow_task:approve",
  "workflow_task:reject", "purchase_order:read", "purchase_order:write",
  "stock_picking:create", "stock_move:create",
]

const none = { none: [] as [] }

/** Reuses the existing draft/provisioning/typed-command pipeline with an explicit ordinary electorate. */
export async function seedWorkReviewWorkflow(
  owner: Page,
  candidateRoleIds: number[],
  assignment: "AnyCandidate" | "AllCandidates" = "AnyCandidate",
) {
  const key = smokeName("work-acceptance").toLowerCase().replace(/-/g, "_")
  const seed = await seedPublishableWorkflowDraft(owner, { workflowKey: key, model: "purchase_order", name: key })
  let revision = seed.draftRevision
  // The runtime snapshot request must describe the same condition fields that
  // the guarded PO adapter pins when it starts an approval instance.
  await callReducerOwner("update_workflow_draft", [
    seed.organizationId, seed.versionId, revision,
    stdbParamsToJson({
      name: key, description: null, trigger: { tag: "Manual" }, schemaVersion: 1,
      snapshotFields: [
        { fieldKey: "amount_total", valueType: { tag: "Money" }, nullable: false },
        { fieldKey: "state", valueType: { tag: "Code" }, nullable: false },
      ],
      metadata: null,
    }, "UpdateWorkflowDraftParams"),
  ])
  revision += 1
  for (const node of [
    {
      nodeKey: "approval", name: "Finance review", kind: { tag: "HumanTask" }, sequence: 2,
      action: none,
      taskPolicy: { some: {
        kind: { tag: "ApproveReject" }, assignment: { tag: assignment },
        candidateRoleIds, candidateGroupIds: [], candidateUnitIds: [], requireCommentOnReject: true,
      } },
    },
    {
      nodeKey: "confirm", name: "Confirm purchase order", kind: { tag: "Action" }, sequence: 3,
      action: { some: { actionKey: "confirm_purchase_order", inputSchemaVersion: 1, input: [] } }, taskPolicy: none,
    },
  ]) {
    await callReducerOwner("upsert_workflow_node", [seed.organizationId, seed.versionId, revision++, {
      ...node, splitKind: { tag: "None" }, joinKind: { tag: "None" },
      timerPolicy: none, retryPolicy: none, subflow: none, metadata: none,
    }])
  }
  for (const edge of [
    { edgeKey: "e_start_end", fromNodeKey: "start", toNodeKey: "approval", sequence: 1, signalKey: none },
    { edgeKey: "e_approval_confirm", fromNodeKey: "approval", toNodeKey: "confirm", sequence: 2, signalKey: { some: "approved" } },
    { edgeKey: "e_approval_reject", fromNodeKey: "approval", toNodeKey: "end", sequence: 3, signalKey: { some: "rejected" } },
    { edgeKey: "e_confirm_end", fromNodeKey: "confirm", toNodeKey: "end", sequence: 4, signalKey: none },
  ]) {
    await callReducerOwner("upsert_workflow_edge", [seed.organizationId, seed.versionId, revision++, { ...edge, condition: none, metadata: none }])
  }
  await callReducerBff(owner, "publish_workflow_version", [seed.organizationId, seed.versionId, revision])
  await waitForWorkflowVersionStatus(owner, seed.versionId, "Published")
  return {
    ...seed, revision,
    retire: () => callReducerBff(owner, "retire_workflow_version", [seed.organizationId, seed.versionId, revision]),
  }
}

export function workScopeFor(seed: { organizationId: number; companyId: number }, actor: Actor): WorkBoardScope {
  return { organizationId: seed.organizationId, companyId: seed.companyId, actorIdentity: actor.identityHex,
    authorizationKey: "live-acceptance", scope: "purchasing", view: "eligible" }
}

export async function createPendingWorkReview(owner: Page, reviewer: Page) {
  const orderId = await createDraftPurchaseOrder(owner, smokeName("work-review-po"))
  await addLaptopPurchaseLine(owner, orderId)
  const command = stdbBffCommandPost("confirm_purchase_order", { orderId })
  const response = await postWorkCommand(owner, command)
  expect(response.ok(), await response.text()).toBe(true)
  // Surface authorization errors before polling for this exact task. Keep this
  // diagnostic local so unrelated E2E specs do not become affected importers.
  const inbox = await reviewer.request.get("/api/query/workflow-human-tasks-inbox")
  expect(inbox.ok(), `Reviewer inbox HTTP ${inbox.status()}: ${await inbox.text()}`).toBe(true)
  const taskId = await waitForPendingApprovalRequest(reviewer, "purchase_order", orderId)
  return { orderId, taskId }
}

export async function readWorkTask(page: Page, scope: WorkBoardScope, taskId: number): Promise<WorkTaskRow | undefined> {
  const params = new URLSearchParams({ companyId: String(scope.companyId), workScope: scope.scope, taskId: String(taskId) })
  const response = await page.request.get(`/api/query/workflow-human-tasks?${params}`)
  expect(response.ok(), await response.text()).toBe(true)
  const rows = parseWorkBoardPage(await response.json(), { ...scope, view: "eligible" }).data
  expect(rows.length).toBeLessThanOrEqual(1)
  if (rows[0]) expect(Number(rows[0].id)).toBe(taskId)
  return rows[0]
}

export async function openWorkReview(page: Page, scope: WorkBoardScope, taskId: number) {
  const row = await readWorkTask(page, scope, taskId)
  if (!row) throw new Error(`Task ${taskId} is not readable by the ordinary reviewer`)
  await page.goto("/tasks?workScope=purchasing&workView=eligible&workLayout=list")
  const title = row.workSourceTitle || `${row.subjectModel ?? row.subject_model ?? ""} #${row.subjectId ?? row.subject_id ?? row.id}`
  await page.getByRole("button", { name: title, exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  return row
}

export function claimWorkCommand(input: ClaimHumanTaskInput) {
  if (!input.attempt) throw new Error("Test command needs a stable attempt")
  return stdbBffCommandPost("claim_workflow_human_task", { params: stdbParamsToJson({
    companyId: input.companyId, taskId: input.taskId, expectedRevision: input.expectedRevision,
    actingFor: typeof input.actingFor === "string" ? encodeIdentity(input.actingFor) : null,
    ...input.attempt,
  }, "ClaimWorkflowHumanTaskParams") })
}

export function decideWorkCommand(input: DecideHumanTaskInput) {
  if (!input.attempt) throw new Error("Test command needs a stable attempt")
  return stdbBffCommandPost("decide_workflow_human_task", { params: stdbParamsToJson({
    companyId: input.companyId, taskId: input.taskId,
    expectedTaskRevision: input.expectedTaskRevision, expectedInstanceRevision: input.expectedInstanceRevision,
    decision: input.decision, actingFor: typeof input.actingFor === "string" ? encodeIdentity(input.actingFor) : null,
    comment: input.comment ?? null, causationId: null, ...input.attempt,
  }, "DecideWorkflowHumanTaskParams") })
}

export function postWorkCommand(page: Page, command: { urlPath: string; init: RequestInit }) {
  return page.request.post(command.urlPath, { headers: { "Content-Type": "application/json" }, data: JSON.parse(String(command.init.body)) })
}

export async function readWorkCommandProof(
  page: Page, scope: WorkBoardScope,
  command: { kind: "claim"; input: ClaimHumanTaskInput } | { kind: "decision"; input: DecideHumanTaskInput },
) {
  const expected = command.kind === "claim"
    ? await humanTaskClaimExpectation(scope, command.input)
    : await humanTaskDecisionExpectation(scope, command.input)
  const response = await page.request.get(humanTaskCommandReadbackPath(scope, expected))
  expect(response.ok(), await response.text()).toBe(true)
  const body = await response.json()
  return { body, effect: resolveHumanTaskCommandEffect(body, scope, expected) }
}
