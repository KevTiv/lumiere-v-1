import assert from "node:assert/strict"
import test from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import { resolveSaleOrderForOpportunity } from "./crm-opportunity-conversion"

const row = (
  id: bigint,
  opportunityId: bigint,
  companyId: bigint,
) => ({ id, opportunityId, companyId })

test("returns null when no exact opportunity/company sale order exists", () => {
  const result = resolveSaleOrderForOpportunity(
    [row(10n, 8n, 3n), row(11n, 7n, 4n)] as never[],
    7n,
    3n,
  )

  assert.equal(result, null)
})

test("returns canonical record ref for the unique exact effect", () => {
  const result = resolveSaleOrderForOpportunity(
    [row(10n, 8n, 3n), row(11n, 7n, 3n)] as never[],
    7n,
    3n,
  )

  assert.deepEqual(result, {
    resource: "sale-orders",
    id: "11",
    href: "/sales?orderId=11",
    opportunityId: "7",
    companyId: "3",
  })
})

test("accepts legacy snake-case projection keys without weakening identity", () => {
  const result = resolveSaleOrderForOpportunity(
    [
      {
        id: "21",
        opportunity_id: { some: "7" },
        company_id: "3",
      },
    ] as never[],
    7n,
    3n,
  )

  assert.equal(result?.id, "21")
})

test("duplicate exact effects are invariant failure, never newest-row selection", () => {
  assert.throws(
    () =>
      resolveSaleOrderForOpportunity(
        [row(100n, 7n, 3n), row(101n, 7n, 3n)] as never[],
        7n,
        3n,
      ),
    AmbiguousOperationEffectError,
  )
})

test("same opportunity in another company cannot satisfy readback", () => {
  const result = resolveSaleOrderForOpportunity(
    [row(30n, 7n, 4n)] as never[],
    7n,
    3n,
  )

  assert.equal(result, null)
})
