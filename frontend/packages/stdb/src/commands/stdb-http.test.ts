import assert from "node:assert/strict"
import test from "node:test"

import { encodeIdentity } from "../stdb-params-json"
import { ACCOUNTING_BFF_REDUCERS, accountingBffCallUrl } from "./accounting-http"
import { stdbBffCommandPost } from "./stdb-http"

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

test("unreconcile accounting command uses the canonical BFF URL once", () => {
  const { urlPath, init } = stdbBffCommandPost("unreconciled_account_bank_statement_line", {
    companyId: 3n,
    lineId: 7n,
    params: { moveIds: [11n, 13n], amountResidual: 42.5 },
  })

  assert.equal(urlPath, "/api/operations/erp.unreconciled_account_bank_statement_line")
  assert.deepEqual(JSON.parse(String(init.body)), {
    companyId: 3,
    lineId: 7,
    params: { moveIds: [11, 13], amountResidual: 42.5 },
  })
  assert.equal(
    accountingBffCallUrl("unreconciled_account_bank_statement_line"),
    "/api/call/unreconciled_account_bank_statement_line",
  )
  assert.equal(
    ACCOUNTING_BFF_REDUCERS.filter((key) => key === "unreconciled_account_bank_statement_line").length,
    1,
  )
})
