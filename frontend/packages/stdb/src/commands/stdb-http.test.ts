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
