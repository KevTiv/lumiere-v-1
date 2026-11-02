import assert from "node:assert/strict"
import test from "node:test"

import {
  aiActionDraftRowToPayload,
  exactAiActionDraftPayload,
  normalizeGatewayActionDraftResponse,
  resolvePersistedActionDrafts,
  type GatewayActionDraft,
} from "./ai-action-drafts"

function draft(draftId: number, reducerName = "create_task"): GatewayActionDraft {
  return {
    draftId,
    reducerName,
    paramsJson: { companyId: 3, name: `Draft ${draftId}` },
    confidence: 0.9,
    warnings: [],
    summary: `Draft ${draftId}`,
    elevated: false,
  }
}

test("keeps concurrent same-reducer drafts bound to their server ids", () => {
  const persisted = resolvePersistedActionDrafts([draft(41), draft(42)])

  assert.deepEqual(
    persisted.map(({ draftId, gateway }) => [draftId, gateway.summary]),
    [
      [41, "Draft 41"],
      [42, "Draft 42"],
    ],
  )
})

test("normalizes snake-case gateway wire fields once at the HTTP boundary", () => {
  const response = normalizeGatewayActionDraftResponse({
    drafts: [{
      draft_id: 41,
      reducer_name: "create_task",
      params_json: {
        company_id: 3,
        order_lines: [{ product_id: 7, unit_price: 19 }],
        name: "Draft 41",
      },
      confidence: 0.9,
      warnings: [],
      summary: "Draft 41",
      elevated: false,
    }],
  })

  assert.deepEqual(response, {
    drafts: [{
      draftId: 41,
      reducerName: "create_task",
      paramsJson: {
        companyId: 3,
        orderLines: [{ productId: 7, unitPrice: 19 }],
        name: "Draft 41",
      },
      confidence: 0.9,
      warnings: [],
      summary: "Draft 41",
      elevated: false,
    }],
  })
})

test("keeps SpacetimeDB row properties camel-case and normalizes stored reducer params", () => {
  const payload = aiActionDraftRowToPayload({
    id: 41,
    organizationId: 1,
    companyId: 3,
    reducerName: "create_sale_order",
    paramsJson: JSON.stringify({ customer_id: 9, order_lines: [{ product_id: 7 }] }),
    warningsJson: "[]",
  })

  assert.equal(payload.reducerName, "create_sale_order")
  assert.equal(payload.companyId, 3)
  assert.deepEqual(payload.paramsJson, {
    customerId: 9,
    orderLines: [{ productId: 7 }],
  })
})

test("replayed server response resolves the same stable draft id", () => {
  const response = [draft(41)]

  assert.equal(resolvePersistedActionDrafts(response)[0]?.draftId, 41)
  assert.equal(resolvePersistedActionDrafts(response)[0]?.draftId, 41)
})

test("rejects a missing stable effect instead of searching pending rows", () => {
  assert.throws(
    () => resolvePersistedActionDrafts([{ ...draft(41), draftId: 0 }]),
    /Missing stable draft id/,
  )
})

test("rejects ambiguous draft ids instead of selecting one response", () => {
  assert.throws(
    () => resolvePersistedActionDrafts([draft(41), draft(41, "create_sale_order")]),
    /Ambiguous stable draft id 41/,
  )
})

test("exact readback rejects a different company, organization, draft or malformed status", () => {
  const row = { id: "41", organizationId: "1", companyId: "3", status: "approved", executionRecordId: "9007199254740993", reducerName: "create_sale_order" }
  const scope = { organizationId: 1, companyId: 3, draftId: 41 }
  const payload = exactAiActionDraftPayload({ data: row }, scope)
  assert.equal(payload.executionRecordId, "9007199254740993")
  assert.equal(payload.executionRecordHref, "/sales?tab=orders&filter=id%3A9007199254740993")
  for (const changed of [{ companyId: "4" }, { organizationId: "2" }, { id: "42" }, { status: "invented" }]) {
    assert.throws(() => exactAiActionDraftPayload({ data: { ...row, ...changed } }, scope))
  }
  assert.throws(() => exactAiActionDraftPayload({ data: [row] }, scope))
})

test("unsafe numeric identities are never rounded into a different draft or result", () => {
  assert.throws(() => aiActionDraftRowToPayload({ id: "9007199254740993" }))
  const payload = aiActionDraftRowToPayload({ id: 41, status: "approved", executionRecordId: 9007199254740992, reducerName: "create_sale_order" })
  assert.equal(payload.executionRecordId, null)
  assert.equal(payload.executionRecordHref, undefined)
  assert.equal(aiActionDraftRowToPayload({ id: 41, metadata: '{"workflow_instance_id":"9007199254740993"}' }).workflowInstanceId, "9007199254740993")
})
