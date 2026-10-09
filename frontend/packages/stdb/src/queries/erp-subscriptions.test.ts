import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  ALL_ERP_RESOURCE_KEYS,
  createClientSubscriptions,
  subscriptionQueriesForResource,
  type SubscriptionQueryContext,
} from "./erp-subscriptions"
import { hasHrPermission } from "../field-policy"

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

describe("C8 generated organization subscription compiler", () => {
  it("compiles reviewed predicates and ordering from structural metadata", () => {
    const sql = subscriptionQueriesForResource("proposal-templates", {
      organizationId: 42,
    })
    assert.ok(sql)
    assert.match(sql![0], /FROM proposal_template\b/)
    assert.match(sql![0], /organization_id\s*=\s*42/)
    assert.match(sql![0], /is_active\s*=\s*true/)
    assert.match(sql![0], /ORDER BY name ASC/)
  })

  it("keeps workflow predicates in the generated policy", () => {
    const sql = subscriptionQueriesForResource("timesheets-to-validate", {
      organizationId: 42,
    })
    assert.ok(sql)
    assert.match(sql![0], /FROM project_timesheet\b/)
    assert.match(sql![0], /validation_status\s*=\s*'draft'/)
  })

  it("fails closed for unknown resources", () => {
    assert.equal(
      subscriptionQueriesForResource("not-a-resource", { organizationId: 42 }),
      null,
    )
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
  it("projects landed-cost lifecycle state without server-side ordering", () => {
    const sql = subscriptionQueriesForResource("landed-costs", {
      organizationId: 42,
      companyIds: [7],
    })
    assert.ok(sql)
    assert.match(sql![0], /\bstate\b/)
    assert.doesNotMatch(sql![0], /\bORDER BY\b/i)
  })

  it("filters every direct Purchasing table to the single allowed company", () => {
    for (const resource of [
      "purchase-orders",
      "purchase-order-lines",
      "landed-costs",
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

  it("keeps inherited and optional company ownership behind the BFF", () => {
    for (const resource of [
      "landed-cost-lines",
      "partner-banks",
      "depreciation-lines",
      "consolidation-journals",
      "consolidation-accounts",
    ]) {
      assert.equal(
        subscriptionQueriesForResource(resource, {
          organizationId: 42,
          companyIds: [7],
        }),
        null,
        `${resource} must not widen the realtime cache to organization scope`,
      )
    }
  })

  it("covers every advanced Purchasing table with company-scoped SQL", () => {
    for (const [resource, table] of [
      ["commodity-price-indexes", "commodity_price_index"],
      ["consignment-agreements", "consignment_agreement"],
      ["purchase-approval-delegates", "purchase_approval_delegate"],
      ["purchase-blanket-order-lines", "purchase_blanket_order_line"],
      ["purchase-blanket-orders", "purchase_blanket_order"],
      ["purchase-blanket-releases", "purchase_blanket_release"],
      ["purchase-contracts", "purchase_contract"],
      ["purchasing-integration-intents", "purchasing_integration_intent"],
      ["vendor-risk-flags", "vendor_risk_flag"],
      ["vendor-scorecards", "vendor_scorecard"],
    ] as const) {
      const sql = subscriptionQueriesForResource(resource, {
        organizationId: 42,
        companyIds: [7],
      })
      assert.ok(sql, `${resource} should produce company-scoped SQL`)
      assert.match(sql![0], new RegExp(`FROM ${table}\\b`))
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

describe("Pass12 sensitive feeds remain on authorized HTTP", () => {
  const resources = [
    "profit-loss-lines",
    "balance-sheet-lines",
    "cash-flow-lines",
    "bank-statement-import-lines",
    "tax-deadline-reminders",
    "consolidation-company-rates",
    "hr-leave-allocations",
    "hr-offboarding-checklists",
    "hr-statutory-ids",
    "document-signature-requests",
    "document-legal-holds",
    "document-external-refs",
  ]
  const identityHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  const organizationContext = {
    organizationId: 42,
    companyIds: [7],
    identityHex,
    managerEmployeeId: 7,
  }
  const normalAccess = {
    organizationId: 42,
    roleId: 9,
    roleName: "manager",
    isSuperuser: false,
    rolePermissions: ["module:hr:read"],
    identityHex,
    fieldPermissions: [],
  }
  const contexts: Record<string, SubscriptionQueryContext> = {
    "no context": {},
    organization: organizationContext,
    normal: { ...organizationContext, fieldAccess: normalAccess },
    superuser: {
      ...organizationContext,
      fieldAccess: { ...normalAccess, roleName: "superuser", isSuperuser: true },
    },
  }

  for (const [label, context] of Object.entries(contexts)) {
    it(`emits no direct subscription SQL with ${label} context`, () => {
      for (const resource of resources) {
        assert.equal(
          subscriptionQueriesForResource(resource, context),
          null,
          `${resource} must use authorized HTTP with ${label} context`,
        )
      }
    })

    it(`omits HTTP-only feeds from aggregate and mixed requests with ${label} context`, () => {
      assert.deepEqual(createClientSubscriptions(resources, context), [])
      const control = subscriptionQueriesForResource("account-payment-term-lines", context) ?? []
      if (context.organizationId !== undefined) {
        assert.ok(control.length > 0, "unrelated feed must remain subscribed")
      }
      assert.deepEqual(
        createClientSubscriptions([...resources, "account-payment-term-lines"], context),
        control,
      )
    })
  }
})

describe("HR subscription SQL dialect", () => {
  it("recognizes canonical module HR read grants for HTTP authorization", () => {
    const fieldAccess = {
      organizationId: 42,
      roleId: 9,
      roleName: "manager",
      isSuperuser: false,
      rolePermissions: ["module:hr:read"],
      identityHex: "actor",
      fieldPermissions: [],
    }
    assert.equal(hasHrPermission(fieldAccess, "hr_employee", "read"), true)
    assert.equal(hasHrPermission(fieldAccess, "hr_employee", "create"), false)
  })

  it("fails closed when employee authorization needs optional-field comparisons", () => {
    const context = {
      organizationId: 42,
      identityHex: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      managerEmployeeId: 7,
    }
    for (const resource of ["my-employee", "direct-reports", "employees"]) {
      assert.equal(
        subscriptionQueriesForResource(resource, context),
        null,
        `${resource} must use authorized HTTP`,
      )
    }
  })

  it("rewrites unsupported NOT IN for employee document purpose", () => {
    const sql = subscriptionQueriesForResource("employee-documents", {
      organizationId: 42,
    })
    assert.ok(sql)
    assert.doesNotMatch(sql![0], /\bNOT IN\b/i)
    assert.match(sql![0], /purpose\s*!=\s*'tax_id'/)
    assert.match(sql![0], /purpose\s*!=\s*'identity'/)
  })
})
