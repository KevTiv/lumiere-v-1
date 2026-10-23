import { expect, test, type Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type { DecideHumanTaskInput } from "@lumiere/query-hooks/hooks/approvals"
import { approvalSelection, approvalTaskStatus } from "@lumiere/query-hooks/hooks/approval-controls"
import { newHumanTaskAttempt } from "@lumiere/query-hooks/hooks/human-task-command"
import {
  buildSignalWorkflowWireParams,
  buildWorkflowSubjectSnapshotRequest,
  selectWorkflowSubjectSnapshot,
  type SignalWorkflowInput,
} from "@lumiere/query-hooks/hooks/workflow-runtime"
import { smokeName, waitForPendingApprovalRequest } from "./helpers"
import { field, idOf, openActorPages, provisionActor, queryRows, tagOf } from "./pretenant-support"
import { createDraftPurchaseOrder } from "./purchasing-order-fixtures"
import { actorIdentity, canonicalOptionValue, canonicalSumTag } from "./sod-evidence"
import {
  seedWorkReviewWorkflow,
  workScopeFor,
  readWorkTask,
  decideWorkCommand,
  postWorkCommand,
  readWorkCommandProof,
} from "./work-board-acceptance-support"

type PersistedRow = Record<string, unknown>

function positiveId(value: unknown, label: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Invalid ${label}`)
  return id
}

/**
 * Independent, read-only observer of committed native transactions. The owner
 * credential never supplies the failing decision and never leaves this helper.
 * Private votes/receipts have no collection BFF endpoint; observing the exact
 * persisted rows prevents an empty public projection from hiding a partial write.
 */
async function persistedRows(sql: string): Promise<PersistedRow[]> {
  const host = (process.env.E2E_STDB_HOST ?? process.env.STDB_HOST ?? "http://127.0.0.1:3000").replace(/\/$/, "")
  const moduleName = process.env.STDB_MODULE?.trim()
  const token = process.env.STDB_SERVER_TOKEN?.trim()
  if (!moduleName || !token) throw new Error("Rollback observer requires STDB_MODULE and STDB_SERVER_TOKEN")
  const response = await fetch(`${host}/v1/database/${moduleName}/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
    body: sql,
  })
  if (!response.ok) throw new Error(`Rollback evidence read failed (${response.status})`)
  const sets = await response.json() as Array<{
    schema?: { elements?: Array<{ name?: { some?: string } }> }
    rows?: unknown[][]
  }>
  const names = sets[0]?.schema?.elements?.map((element) => element.name?.some)
  const rows = sets[0]?.rows
  if (sets.length !== 1 || !names?.length || names.some((name) => !name) || !Array.isArray(rows)) {
    throw new Error("Rollback evidence returned an invalid SQL result")
  }
  return rows.map((values) => {
    if (values.length !== names.length) throw new Error("Rollback evidence row width mismatch")
    return Object.fromEntries(names.map((name, index) => [name!, values[index]]))
  }).sort((left, right) => String(left.id ?? left.scope_key).localeCompare(String(right.id ?? right.scope_key)))
}

interface EvidenceScope {
  organizationId: number
  companyId: number
  instanceId: number
  taskId: number
  orderId: number
  vendorId: number
}

async function committedEvidence(page: Page, scope: EvidenceScope) {
  const org = positiveId(scope.organizationId, "organization")
  const company = positiveId(scope.companyId, "company")
  const instance = positiveId(scope.instanceId, "instance")
  const task = positiveId(scope.taskId, "task")
  const order = positiveId(scope.orderId, "purchase order")
  const vendor = positiveId(scope.vendorId, "vendor")
  const tenant = `organization_id = ${org} AND company_id = ${company}`
  const [tasks, instances, tokens, candidates, taskEvents, taskReceipts, runtimeEvents, runtimeReceipts,
    domainReceipts, orders, lines, vendors, taskAudits, orderAudits, apiOrders, apiPickings] = await Promise.all([
    persistedRows(`SELECT * FROM workflow_human_task WHERE ${tenant} AND id = ${task}`),
    persistedRows(`SELECT * FROM workflow_instance WHERE ${tenant} AND id = ${instance}`),
    persistedRows(`SELECT * FROM workflow_token WHERE ${tenant} AND instance_id = ${instance}`),
    persistedRows(`SELECT * FROM workflow_human_task_candidate WHERE ${tenant} AND task_id = ${task}`),
    persistedRows(`SELECT * FROM workflow_human_task_event WHERE ${tenant} AND task_id = ${task}`),
    persistedRows(`SELECT * FROM workflow_human_task_receipt WHERE ${tenant} AND task_id = ${task}`),
    persistedRows(`SELECT * FROM workflow_decision_event WHERE ${tenant} AND instance_id = ${instance}`),
    persistedRows(`SELECT * FROM workflow_command_receipt WHERE ${tenant} AND result_instance_id = ${instance}`),
    persistedRows(`SELECT * FROM guarded_action_receipt WHERE ${tenant} AND subject_id = ${order}`),
    persistedRows(`SELECT * FROM purchase_order WHERE ${tenant} AND id = ${order}`),
    persistedRows(`SELECT * FROM purchase_order_line WHERE ${tenant} AND order_id = ${order}`),
    // Contacts can be shared across companies; this exact vendor is linked from
    // the already scoped PO. Its supplier_rank is a real confirmation side effect.
    persistedRows(`SELECT id, organization_id, supplier_rank FROM contact WHERE organization_id = ${org} AND id = ${vendor}`),
    // AuditLog.company_id is optional. Scope by org + exact source identity,
    // then retain only the operating company's rows below.
    persistedRows(`SELECT * FROM audit_log WHERE organization_id = ${org} AND table_name = 'workflow_human_task' AND record_id = ${task}`),
    persistedRows(`SELECT * FROM audit_log WHERE organization_id = ${org} AND table_name = 'purchase_order' AND record_id = ${order}`),
    queryRows(page, "purchase-orders"),
    queryRows(page, "stock-pickings"),
  ])
  const companyAudits = (rows: PersistedRow[]) => rows.filter((row) =>
    Number(canonicalOptionValue(row.company_id)) === company)
  return {
    tasks, instances, tokens, candidates, taskEvents, taskReceipts, runtimeEvents, runtimeReceipts,
    domainReceipts: domainReceipts.filter((row) =>
      canonicalSumTag(row.subject_kind, ["PurchaseOrder"]) === "PurchaseOrder"),
    orders, lines, vendors,
    taskAudits: companyAudits(taskAudits), orderAudits: companyAudits(orderAudits),
    apiOrders: apiOrders.filter((row) => idOf(field(row, "id")) === order),
    apiPickings: apiPickings.filter((row) => idOf(field(row, "purchaseId", "purchase_id")) === order),
  }
}

async function signalRejected(owner: Page, input: SignalWorkflowInput, expectedSnapshotHash: string) {
  const normalized = buildWorkflowSubjectSnapshotRequest(input)
  const request = await postWorkCommand(owner, stdbBffCommandPost("request_workflow_subject_snapshot", {
    companyId: normalized.companyId,
    params: stdbParamsToJson(normalized.params, "RequestWorkflowSubjectSnapshotParams"),
  }))
  expect(request.ok(), await request.text()).toBe(true)
  const snapshot = selectWorkflowSubjectSnapshot(await queryRows(owner, "workflow-subject-snapshots"), input)
  expect(snapshot.subject_revision_hash).toBe(expectedSnapshotHash)
  const response = await postWorkCommand(owner, stdbBffCommandPost("signal_workflow", {
    params: buildSignalWorkflowWireParams(input, snapshot),
  }))
  expect(response.ok(), await response.text()).toBe(true)
}

test.describe("Finance work board native transaction rollback", { tag: ["@dev-fixture", "@work-board"] }, () => {
  test("a late token failure rolls back an ordinary reviewer's vote, purchase confirmation and command evidence", async ({ page, browser }) => {
    test.setTimeout(300_000)
    // This failure proof deliberately grants the exact existing PO adapter's
    // write permission. The line-free PO needs no inventory creation grant;
    // source-read and membership revocation tests remain separate.
    const actor = await provisionActor(page, "work-rollback", [
      "company:read", "workflow:read", "workflow_task:write", "workflow_task:approve",
      "workflow_task:reject", "purchase_order:read", "purchase_order:write",
    ])
    const workflow = await seedWorkReviewWorkflow(page, [actor.roleId], "AllCandidates")
    const sessions = await openActorPages(browser, [actor])
    try {
      const reviewer = sessions.pages[0]
      if (!reviewer) throw new Error("Missing ordinary reviewer session")
      if (!/^[0-9a-f]{64}$/.test(actor.identityHex)) throw new Error("Invalid reviewer identity")
      const profiles = await persistedRows(`SELECT identity, is_superuser FROM user_profile WHERE organization_id = ${positiveId(workflow.organizationId, "organization")} AND identity = 0x${actor.identityHex}`)
      expect(profiles).toHaveLength(1)
      expect(profiles[0]!.is_superuser).toBe(false)
      expect(actorIdentity(profiles[0]!.identity)).toBe(actor.identityHex)

      const orderId = await createDraftPurchaseOrder(page, smokeName("work-rollback-po"))
      const requested = await postWorkCommand(page, stdbBffCommandPost("confirm_purchase_order", { orderId }))
      expect(requested.ok(), await requested.text()).toBe(true)
      const taskId = await waitForPendingApprovalRequest(reviewer, "purchase_order", orderId)
      const scope = workScopeFor(workflow, actor)
      const row = await readWorkTask(reviewer, scope, taskId)
      if (!row) throw new Error("Rollback fixture task is not readable")
      const reviewed = approvalSelection(row, workflow.companyId, "")
      const taskRows = await persistedRows(`SELECT * FROM workflow_human_task WHERE organization_id = ${workflow.organizationId} AND company_id = ${workflow.companyId} AND id = ${positiveId(taskId, "task")}`)
      expect(taskRows).toHaveLength(1)
      const task = taskRows[0]!
      const instanceId = positiveId(task.workflow_instance_id, "instance")
      const guarded = canonicalOptionValue(task.guarded_action)
      const guardedKey = Array.isArray(guarded) ? guarded[0] : (guarded as { key?: unknown } | null)?.key
      expect(canonicalSumTag(guardedKey, ["ConfirmPurchaseOrder"])).toBe("ConfirmPurchaseOrder")
      const orderRows = await persistedRows(`SELECT * FROM purchase_order WHERE organization_id = ${workflow.organizationId} AND company_id = ${workflow.companyId} AND id = ${positiveId(orderId, "purchase order")}`)
      expect(orderRows).toHaveLength(1)
      const evidenceScope: EvidenceScope = { ...workflow, taskId, instanceId, orderId, vendorId: positiveId(orderRows[0]!.partner_id, "vendor") }

      const instances = await persistedRows(`SELECT subject_revision_hash FROM workflow_instance WHERE organization_id = ${workflow.organizationId} AND company_id = ${workflow.companyId} AND id = ${instanceId}`)
      expect(instances).toHaveLength(1)
      const frozenSnapshotHash = instances[0]!.subject_revision_hash
      expect(typeof frozenSnapshotHash).toBe("string")

      // Existing public signal_workflow consumes the approval token along its
      // rejected edge without deciding the human task. This is fixture setup,
      // committed before the decision whose rollback is under test.
      await signalRejected(page, {
        companyId: workflow.companyId, instanceId, workflowVersionId: workflow.versionId,
        subjectModel: "purchase_order", subjectId: orderId,
        expectedRevision: reviewed.expectedInstanceRevision, signalKey: "rejected",
        idempotencyKey: smokeName("work-rollback-signal"), correlationId: smokeName("work-rollback-signal-correlation"),
      }, String(frozenSnapshotHash))
      const before = await committedEvidence(page, evidenceScope)
      expect(before.tasks).toHaveLength(1)
      expect(before.instances).toHaveLength(1)
      expect(canonicalSumTag(before.tasks[0]!.status, ["Open"])).toBe("Open")
      expect(canonicalSumTag(before.instances[0]!.state, ["Active", "Completed"])).toBe("Completed")
      const consumed = before.tokens.find((token) => Number(token.id) === Number(task.token_id))
      expect(consumed).toBeDefined()
      expect(canonicalSumTag(consumed!.state, ["Active", "Consumed"])).toBe("Consumed")
      expect(before.candidates).toHaveLength(1)
      expect(actorIdentity(before.candidates[0]!.candidate_identity)).toBe(actor.identityHex)
      expect(canonicalOptionValue(before.candidates[0]!.decision)).toBeNull()
      expect(canonicalOptionValue(before.candidates[0]!.decided_by)).toBeNull()
      expect(before.orders).toHaveLength(1)
      expect(before.lines).toHaveLength(0)
      expect(before.vendors).toHaveLength(1)
      expect(before.apiOrders).toHaveLength(1)
      expect(tagOf(field(before.apiOrders[0], "state"))).toBe("draft")
      expect(before.apiPickings).toHaveLength(0)

      const input: DecideHumanTaskInput = {
        companyId: workflow.companyId, taskId,
        expectedTaskRevision: positiveId(before.tasks[0]!.revision, "task revision"),
        // Supply the CURRENT instance revision so this cannot pass by failing an
        // early optimistic-lock check before any attempted domain write.
        expectedInstanceRevision: positiveId(before.instances[0]!.revision, "instance revision"),
        decision: { tag: "Approve" }, comment: "External late-failure rollback proof",
        attempt: newHumanTaskAttempt("decision"),
      }
      const command = decideWorkCommand(input)
      for (const attempt of ["initial decision", "exact retry"]) {
        const failed = await postWorkCommand(reviewer, command)
        const body = await failed.json() as { error?: unknown }
        expect(failed.status(), `${attempt}: ${String(body.error)}`).toBe(422)
        expect(body.error).toEqual(expect.stringContaining("workflow task token is no longer active"))
        // That exact error follows the final AllCandidates vote, guarded PO
        // adapter and effect receipt insertion in the native reducer. These are
        // fresh HTTP reads after the failed transaction boundary, not helper
        // errors caught inside the same native test transaction.
        expect(await committedEvidence(page, evidenceScope), attempt).toEqual(before)
        const canonical = await readWorkTask(reviewer, scope, taskId)
        expect(approvalTaskStatus({ status: canonical?.status })).toBe("Open")
        expect(Number(canonical?.revision)).toBe(input.expectedTaskRevision)
        expect((await readWorkCommandProof(reviewer, scope, { kind: "decision", input })).effect).toBeNull()
      }
    } finally {
      await sessions.close()
      await workflow.retire()
    }
  })
})
