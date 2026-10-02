import assert from "node:assert/strict"
import test from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import {
  resolveSubscriptionInvoiceMove,
  resolveSubscriptionInvoiceRunEffect,
  subscriptionBillingRunKey,
  type SubscriptionBillingRunProjection,
} from "./subscription-invoice-run"

const run = (
  key: string,
  extra: Partial<SubscriptionBillingRunProjection> = {},
): SubscriptionBillingRunProjection => ({
  id: 9n,
  organizationId: 1n,
  companyId: 3n,
  subscriptionId: 7n,
  billingRunKey: key,
  invoiceMoveId: 40n,
  ...extra,
})

test("uses the explicit run key", () => {
  assert.equal(subscriptionBillingRunKey(7n, { billingRunKey: " june " }), "june")
  assert.equal(subscriptionBillingRunKey(7n, { billing_run_key: { some: "july" } }), "july")
})

test("derives the default key from the invoice date seconds", () => {
  const micros = 1_700_000_123_456_789n
  assert.equal(
    subscriptionBillingRunKey(7n, { invoiceDate: { microsSinceUnixEpoch: micros } }),
    "sub:7:period:1700000123",
  )
  assert.equal(
    subscriptionBillingRunKey(7n, { invoice_date: { __timestamp_micros_since_unix_epoch__: 1_700_000_123_456_789 } }),
    "sub:7:period:1700000123",
  )
  assert.equal(
    subscriptionBillingRunKey(7n, { billingRunKey: "  ", invoiceDate: { microsSinceUnixEpoch: "5000000" } }),
    "sub:7:period:5",
  )
})

test("has no key when neither run key nor invoice date is readable", () => {
  assert.equal(subscriptionBillingRunKey(7n, {}), null)
  assert.equal(subscriptionBillingRunKey(7n, { invoiceDate: "tomorrow" }), null)
})

test("resolves the exact run for subscription, company and key", () => {
  const runs = [run("sub:7:period:1", { id: 8n, invoiceMoveId: 39n }), run("sub:7:period:2")]
  assert.deepEqual(resolveSubscriptionInvoiceRunEffect(runs, 1n, 3n, 7n, "sub:7:period:2"), {
    runId: 9n,
    invoiceMoveId: 40n,
  })
})

test("accepts snake_case rows", () => {
  const rows = [{ id: "9", organization_id: "1", company_id: "3", subscription_id: "7", billing_run_key: "k", invoice_move_id: "40" }]
  assert.deepEqual(resolveSubscriptionInvoiceRunEffect(rows, 1n, 3n, 7n, "k"), { runId: 9n, invoiceMoveId: 40n })
})

test("returns null for a missing run, another scope or subscription, or no invoice move", () => {
  assert.equal(resolveSubscriptionInvoiceRunEffect([run("a")], 1n, 3n, 7n, "b"), null)
  assert.equal(resolveSubscriptionInvoiceRunEffect([run("a")], 2n, 3n, 7n, "a"), null)
  assert.equal(resolveSubscriptionInvoiceRunEffect([run("a")], 1n, 4n, 7n, "a"), null)
  assert.equal(resolveSubscriptionInvoiceRunEffect([run("a")], 1n, 3n, 8n, "a"), null)
  assert.equal(resolveSubscriptionInvoiceRunEffect([run("a", { invoiceMoveId: 0n })], 1n, 3n, 7n, "a"), null)
  assert.equal(resolveSubscriptionInvoiceRunEffect([run("a", { invoiceMoveId: undefined })], 1n, 3n, 7n, "a"), null)
})

test("throws on duplicate run keys", () => {
  assert.throws(
    () => resolveSubscriptionInvoiceRunEffect([run("a"), run("a", { id: 10n })], 1n, 3n, 7n, "a"),
    AmbiguousOperationEffectError,
  )
})

test("resolves the invoice move by id within scope", () => {
  const moves = [
    { id: 40n, organizationId: 1n, companyId: 3n },
    { id: 41n, organizationId: 1n, companyId: 3n },
  ]
  assert.deepEqual(resolveSubscriptionInvoiceMove(moves, 1n, 3n, 40n), { resource: "account-moves", id: "40" })
  assert.equal(resolveSubscriptionInvoiceMove(moves, 1n, 3n, 42n), null)
  assert.equal(resolveSubscriptionInvoiceMove(moves, 1n, 4n, 40n), null)
  assert.equal(resolveSubscriptionInvoiceMove(moves, 2n, 3n, 40n), null)
  assert.throws(
    () => resolveSubscriptionInvoiceMove([...moves, { id: 40n, organizationId: 1n, companyId: 3n }], 1n, 3n, 40n),
    AmbiguousOperationEffectError,
  )
})
