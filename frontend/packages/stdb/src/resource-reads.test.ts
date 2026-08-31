import { strict as assert } from "node:assert"
import { test } from "node:test"

import { QueryResponseDecodeError } from "@lumiere/api-client"
import { ResourceQueryRowDecodeError } from "@lumiere/contracts/generated/resource-codecs"
import { CANONICAL_RESOURCE_BY_NAME } from "@lumiere/contracts/generated/resources"

import {
  decodeAccountAccountTypesQueryResponse,
  decodeAccountAccountsQueryResponse,
  decodeAccountJournalsQueryResponse,
  decodeAccountMoveLinesQueryResponse,
  decodeAccountMovesQueryResponse,
  decodeAccountTaxesQueryResponse,
  decodeCompaniesQueryResponse,
  decodeTypedResourceQueryResponse,
} from "./resource-reads"

test("generic typed read decodes expanded accounting resources", () => {
  const rows = decodeTypedResourceQueryResponse("account-groups", {
    data: [{ id: "41", organizationId: 11, companyId: "42", level: 2 }],
  })
  assert.deepEqual(rows, [{
    id: 41n,
    organizationId: 11n,
    companyId: 42n,
    level: 2,
  }])
})

test("account type read preserves shared and selected-company rows", () => {
  assert.deepEqual(
    CANONICAL_RESOURCE_BY_NAME["account-account-types"].scope,
    {
      company_field: "company_id",
      kind: "organization_optional_company",
      organization_field: "organization_id",
    },
  )
  const rows = decodeAccountAccountTypesQueryResponse({
    data: [
      {
        id: "31",
        organizationId: 11,
        name: "Receivable",
        type: "receivable",
        internalGroup: "Asset",
        companyId: null,
        includeInitialBalance: true,
        isDeprecated: false,
      },
      { id: 32, organizationId: "11", companyId: "42" },
    ],
  })
  assert.deepEqual(rows[0], {
    id: 31n,
    organizationId: 11n,
    name: "Receivable",
    type: "receivable",
    internalGroup: { tag: "Asset" },
    companyId: undefined,
    includeInitialBalance: true,
    isDeprecated: false,
  })
  assert.deepEqual(rows[1], {
    id: 32n,
    organizationId: 11n,
    companyId: 42n,
  })
  assert.throws(
    () => decodeAccountAccountTypesQueryResponse({
      data: [{ id: 33, organizationId: 11, internalGroup: "Unsupported" }],
    }),
    ResourceQueryRowDecodeError,
  )
})

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
    assert.throws(
      () => decodeCompaniesQueryResponse(value),
      (error) =>
        error instanceof QueryResponseDecodeError ||
        error instanceof ResourceQueryRowDecodeError,
    )
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

test("account typed read decodes generated projection fields", () => {
  assert.deepEqual(CANONICAL_RESOURCE_BY_NAME["account-accounts"].mandatory, [
    "id",
    "organization_id",
  ])
  const [row] = decodeAccountAccountsQueryResponse({
    data: [{
      id: "9",
      organizationId: 11,
      code: "1100",
      internalType: "Asset",
      allowedJournalIds: [2, "3"],
    }],
  })
  assert.equal(row.id, 9n)
  assert.deepEqual(row.internalType, { tag: "Asset" })
  assert.deepEqual(row.allowedJournalIds, [2n, 3n])
})

test("account typed read rejects unknown and missing mandatory fields", () => {
  assert.throws(
    () => decodeAccountAccountsQueryResponse({
      data: [{ id: 9, organizationId: 11, credentialReference: "secret" }],
    }),
    ResourceQueryRowDecodeError,
  )
  assert.throws(
    () => decodeAccountAccountsQueryResponse({ data: [{ id: 9 }] }),
    ResourceQueryRowDecodeError,
  )
})

test("journal typed read decodes default and mandatory-only projections", () => {
  assert.deepEqual(CANONICAL_RESOURCE_BY_NAME["account-journals"].mandatory, [
    "id",
    "organization_id",
  ])
  const rows = decodeAccountJournalsQueryResponse({
    data: [
      {
        id: "5",
        organizationId: 11,
        companyId: 42,
        code: "BNK1",
        name: "Bank",
        type: "Bank",
        active: true,
        defaultAccountId: null,
      },
      { id: 6, organizationId: "11" },
    ],
  })
  assert.deepEqual(rows[0], {
    id: 5n,
    organizationId: 11n,
    companyId: 42n,
    code: "BNK1",
    name: "Bank",
    type: { tag: "Bank" },
    active: true,
    defaultAccountId: undefined,
  })
  assert.deepEqual(rows[1], { id: 6n, organizationId: 11n })
})

test("tax typed read decodes default and optional enum projections", () => {
  assert.deepEqual(CANONICAL_RESOURCE_BY_NAME["account-taxes"].mandatory, [
    "id",
    "organization_id",
  ])
  const [tax] = decodeAccountTaxesQueryResponse({
    data: [{
      id: 9,
      organizationId: 11,
      companyId: "42",
      name: "VAT 21%",
      amount: 21,
      description: null,
      typeTaxUse: "Sale",
      amountType: "Percent",
    }],
  })
  assert.deepEqual(tax, {
    id: 9n,
    organizationId: 11n,
    companyId: 42n,
    name: "VAT 21%",
    amount: 21,
    description: undefined,
    typeTaxUse: { tag: "Sale" },
    amountType: { tag: "Percent" },
  })
  assert.deepEqual(
    decodeAccountTaxesQueryResponse({ data: [{ id: 10, organizationId: 11 }] }),
    [{ id: 10n, organizationId: 11n }],
  )
})

test("move-line typed read decodes default and mandatory-only projections", () => {
  assert.deepEqual(CANONICAL_RESOURCE_BY_NAME["account-move-lines"].mandatory, [
    "id",
    "organization_id",
  ])
  const rows = decodeAccountMoveLinesQueryResponse({
    data: [
      {
        id: "8",
        organizationId: 11,
        moveId: "13",
        companyId: 42,
        date: { microsSinceUnixEpoch: "1781987714525006" },
        name: "Receivable",
        debit: 125.5,
        credit: 0,
        balance: 125.5,
        accountId: "1100",
        partnerId: null,
      },
      { id: 9, organizationId: "11" },
    ],
  })
  const { date, ...line } = rows[0]
  assert.equal(date?.microsSinceUnixEpoch, 1781987714525006n)
  assert.deepEqual(line, {
    id: 8n,
    organizationId: 11n,
    moveId: 13n,
    companyId: 42n,
    name: "Receivable",
    debit: 125.5,
    credit: 0,
    balance: 125.5,
    accountId: 1100n,
    partnerId: undefined,
  })
  assert.deepEqual(rows[1], { id: 9n, organizationId: 11n })
})

test("move typed read decodes projection enums, timestamps, and optional fields", () => {
  assert.deepEqual(CANONICAL_RESOURCE_BY_NAME["account-moves"].mandatory, [
    "id",
    "organization_id",
  ])
  const rows = decodeAccountMovesQueryResponse({
    data: [
      {
        id: "21",
        organizationId: 11,
        name: "INV/2026/0021",
        moveType: "OutInvoice",
        state: "Posted",
        date: { microsSinceUnixEpoch: "1781987714525007" },
        companyId: 42,
        journalId: "5",
        partnerId: null,
        currencyId: 1,
        amountUntaxed: 100,
        amountTax: 21,
        amountTotal: 121,
        amountResidual: 40,
        paymentState: "Partial",
      },
      { id: 22, organizationId: "11" },
    ],
  })
  const { date, ...move } = rows[0]
  assert.equal(date?.microsSinceUnixEpoch, 1781987714525007n)
  assert.deepEqual(move, {
    id: 21n,
    organizationId: 11n,
    name: "INV/2026/0021",
    moveType: { tag: "OutInvoice" },
    state: { tag: "Posted" },
    companyId: 42n,
    journalId: 5n,
    partnerId: undefined,
    currencyId: 1n,
    amountUntaxed: 100,
    amountTax: 21,
    amountTotal: 121,
    amountResidual: 40,
    paymentState: { tag: "Partial" },
  })
  assert.deepEqual(rows[1], { id: 22n, organizationId: 11n })
})

test("journal and tax typed reads fail closed for malformed projections", () => {
  assert.throws(
    () => decodeAccountJournalsQueryResponse({
      data: [{ id: 5, organizationId: 11, type: "Unsupported" }],
    }),
    ResourceQueryRowDecodeError,
  )
  assert.throws(
    () => decodeAccountTaxesQueryResponse({
      data: [{ id: 9, organizationId: 11, credentialReference: "secret" }],
    }),
    ResourceQueryRowDecodeError,
  )
  assert.throws(
    () => decodeAccountTaxesQueryResponse({ data: [{ organizationId: 11 }] }),
    ResourceQueryRowDecodeError,
  )
  assert.throws(
    () => decodeAccountMoveLinesQueryResponse({
      data: [{ id: 8, organizationId: 11, credentialReference: "secret" }],
    }),
    ResourceQueryRowDecodeError,
  )
  assert.throws(
    () => decodeAccountMovesQueryResponse({
      data: [{ id: 21, organizationId: 11, state: "Unknown" }],
    }),
    ResourceQueryRowDecodeError,
  )
})
