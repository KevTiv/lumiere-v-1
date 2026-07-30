import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  ALL_ERP_RESOURCE_KEYS,
  subscriptionQueriesForResource,
} from "./erp-subscriptions"

describe("ACC-RI-012: account-payment-term-lines live subscription", () => {
  it("is registered as a resolvable ERP resource key", () => {
    assert.ok(
      ALL_ERP_RESOURCE_KEYS.includes("account-payment-term-lines"),
      "account-payment-term-lines is missing from ALL_ERP_RESOURCE_KEYS — it will silently " +
        "stop auto-refreshing once global subscriptions are ready (falls back to no live sync)",
    )
  })

  it("resolves organization-scoped subscription SQL against account_payment_term_line", () => {
    const sql = subscriptionQueriesForResource("account-payment-term-lines", {
      organizationId: 42,
    })
    assert.ok(sql, "expected non-null SQL for account-payment-term-lines with an organizationId")
    assert.ok(sql!.length > 0)
    for (const statement of sql!) {
      assert.match(statement, /FROM account_payment_term_line/)
      assert.match(statement, /organization_id\s*=\s*42/)
    }
  })

  it("returns null without an organizationId (fails closed, matches sibling resources)", () => {
    const sql = subscriptionQueriesForResource("account-payment-term-lines", {})
    assert.equal(sql, null)
  })
})
