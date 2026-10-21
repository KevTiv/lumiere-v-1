import assert from "node:assert/strict"
import test from "node:test"

import { encodeIdentity } from "../stdb-params-json"
import { SESSION_OPERATION_DESCRIPTORS } from "@lumiere/contracts/generated/operation-descriptors"
import {
  stdbBffCallUrl,
  stdbBffCommandPost,
} from "./stdb-http"

test("assign_ticket accepts and emits the SpacetimeDB identity wire shape", () => {
  const identity = "ab".repeat(32)
  const { init } = stdbBffCommandPost("assign_ticket", {
    ticketId: 42n,
    agentId: encodeIdentity(identity),
  })

  assert.deepEqual(JSON.parse(String(init.body)), {
    ticketId: 42,
    agentId: { __identity__: `0x${identity}` },
  })
})

test("unreconcile accounting command uses the immutable descriptor URL", () => {
  const { urlPath, init } = stdbBffCommandPost("unreconciled_account_bank_statement_line", {
    companyId: 3n,
    lineId: 7n,
    params: { moveIds: [11n, 13n], amountResidual: 42.5 },
  })

  assert.equal(
    urlPath,
    `/api/operations/${encodeURIComponent(SESSION_OPERATION_DESCRIPTORS.unreconciled_account_bank_statement_line.contractOperationId)}`,
  )
  assert.deepEqual(JSON.parse(String(init.body)), {
    companyId: 3,
    lineId: 7,
    params: { moveIds: [11, 13], amountResidual: 42.5 },
  })
})

test("AI run cancellation uses its released immutable ID and named company input", () => {
  const { urlPath, init } = stdbBffCommandPost("cancel_ai_agent_run", {
    companyId: 3n,
    runId: 7n,
    reason: "Cancelled from UI",
  })

  assert.equal(
    urlPath,
    `/api/operations/${encodeURIComponent(SESSION_OPERATION_DESCRIPTORS.cancel_ai_agent_run.contractOperationId)}`,
  )
  assert.deepEqual(JSON.parse(String(init.body)), {
    companyId: 3,
    runId: 7,
    reason: "Cancelled from UI",
  })
})

test("documents and workflow snapshot reducers use released named contracts", () => {
  const release = stdbBffCommandPost("release_document_legal_hold", {
    holdId: 17n,
    params: { metadata: { some: "case-17" } },
  })
  assert.equal(
    release.urlPath,
    `/api/operations/${encodeURIComponent(SESSION_OPERATION_DESCRIPTORS.release_document_legal_hold.contractOperationId)}`,
  )
  assert.deepEqual(JSON.parse(String(release.init.body)), {
    holdId: 17,
    params: { metadata: { some: "case-17" } },
  })

  const snapshot = stdbBffCommandPost("request_workflow_subject_snapshot", {
    companyId: 4n,
    params: {
      subjectModel: "sale_order",
      subjectId: 23n,
      workflowVersionId: 29n,
    },
  })
  assert.equal(
    snapshot.urlPath,
    `/api/operations/${encodeURIComponent(SESSION_OPERATION_DESCRIPTORS.request_workflow_subject_snapshot.contractOperationId)}`,
  )
  assert.deepEqual(JSON.parse(String(snapshot.init.body)), {
    companyId: 4,
    params: {
      subjectModel: "sale_order",
      subjectId: 23,
      workflowVersionId: 29,
    },
  })
})
