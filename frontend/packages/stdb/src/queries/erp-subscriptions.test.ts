import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  ALL_ERP_RESOURCE_KEYS,
  createClientSubscriptions,
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

describe("CRM-RI-007: company-scoped live subscriptions", () => {
  it("never emits direct SQL for private CRM tables", () => {
    for (const resource of [
      "contacts",
      "lead-sources",
      "opportunity-lines",
      "crm-conversation-messages",
      "calendar-events",
      "privacy-consent",
      "contact-communication-preferences",
    ]) {
      assert.equal(
        subscriptionQueriesForResource(resource, {
          organizationId: 42,
          companyIds: [7],
        }),
        null,
        `${resource} must be read through the authenticated BFF`,
      )
    }
  })

  it("omits private CRM tables from mixed and dynamic subscription requests", () => {
    const sql = createClientSubscriptions(
      ["contacts", "lead-sources", "account-payment-term-lines"],
      { organizationId: 42, companyIds: [7] },
    )
    assert.ok(sql.length > 0, "the non-CRM resource should remain subscribed")
    assert.ok(sql.some((statement) => /FROM account_payment_term_line\b/.test(statement)))
    assert.ok(sql.every((statement) => !/FROM (contact|lead_source)\b/.test(statement)))
  })
})

describe("PUR-RI-017: company-scoped Purchasing subscriptions", () => {
  it("filters every direct Purchasing table to the single allowed company", () => {
    for (const resource of [
      "purchase-orders",
      "purchase-order-lines",
      "landed-costs",
      "landed-cost-lines",
      "partner-banks",
      "purchase-requisitions",
      "purchase-requisition-lines",
      "purchase-rfqs",
      "purchase-rfq-lines",
      "purchase-rfq-bids",
      "purchase-returns",
      "purchase-return-lines",
    ]) {
      const sql = subscriptionQueriesForResource(resource, {
        organizationId: 42,
        companyIds: [7],
      })
      assert.ok(sql, `${resource} should produce company-scoped SQL`)
      assert.match(sql![0], /organization_id\s*=\s*42/)
      assert.match(sql![0], /company_id\s*=\s*7/)
    }
  })

  it("fails closed without exactly one allowed company", () => {
    assert.equal(
      subscriptionQueriesForResource("purchase-orders", { organizationId: 42 }),
      null,
    )
    assert.equal(
      subscriptionQueriesForResource("purchase-orders", {
        organizationId: 42,
        companyIds: [7, 8],
      }),
      null,
    )
  })
})
