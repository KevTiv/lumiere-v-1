import { strict as assert } from "node:assert"
import { test } from "node:test"

import { QueryResponseDecodeError } from "@lumiere/api-client"
import { CANONICAL_RESOURCE_BY_NAME } from "@lumiere/contracts/generated/resources"

import { decodeCompaniesQueryResponse } from "./resource-reads"

test("company typed read stays aligned with canonical mandatory metadata", () => {
  assert.deepEqual(CANONICAL_RESOURCE_BY_NAME.companies.mandatory, [
    "id",
    "organization_id",
  ])
})

test("company typed read decodes a field-policy projection", () => {
  const rows = decodeCompaniesQueryResponse({
    data: [{ id: 7, organizationId: "11", name: "Lumiere", parentId: null }],
  })
  assert.deepEqual(rows, [
    { id: 7n, organizationId: 11n, name: "Lumiere", parentId: undefined },
  ])
})

test("company typed read accepts mandatory-only projections", () => {
  assert.deepEqual(
    decodeCompaniesQueryResponse({ data: [{ id: 7, organizationId: 11 }] }),
    [{ id: 7n, organizationId: 11n }],
  )
})

test("company typed read rejects malformed rows and lossy IDs", () => {
  const invalid = [
    null,
    {},
    { data: null },
    { data: [], nextCursor: "cursor" },
    { data: [null] },
    { data: [{ id: 7 }] },
    { data: [{ id: Number.MAX_SAFE_INTEGER + 1, organizationId: 11 }] },
    { data: [{ id: "18446744073709551616", organizationId: 11 }] },
    { data: [{ id: 7, organizationId: 11, unexpected: true }] },
  ]
  for (const value of invalid) {
    assert.throws(() => decodeCompaniesQueryResponse(value), QueryResponseDecodeError)
  }
})

test("company typed read normalizes timestamps", () => {
  const [row] = decodeCompaniesQueryResponse({
    data: [{
      id: 7,
      organizationId: 11,
      deletedAt: { microsSinceUnixEpoch: "1781987714525004" },
    }],
  })
  assert.equal(row.deletedAt?.microsSinceUnixEpoch, 1781987714525004n)
})
