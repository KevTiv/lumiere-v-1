import assert from "node:assert/strict"
import test from "node:test"

import {
  buildQueryBuilderDomain,
  discoverQueryBuilderFields,
  storedDashboardBindingConfiguration,
} from "./query-builder-semantics"

test("classifies timestamp, measure and dimension fields without treating timestamps as measures", () => {
  const fields = discoverQueryBuilderFields([
    {
      dateOrder: { __timestamp_micros_since_unix_epoch__: 1_760_000_000_000_000 },
      amountTotal: 42.5,
      state: { tag: "Sale" },
    },
  ])

  assert.deepEqual(fields, [
    { field: "amount_total", label: "Amount Total", kind: "measure" },
    { field: "date_order", label: "Date Order", kind: "timestamp" },
    { field: "state", label: "State", kind: "dimension" },
  ])
})

test("builds only supported query-builder filter operators", () => {
  assert.equal(
    buildQueryBuilderDomain([
      { field: "state", op: "eq", value: "Sale" },
      { field: "amount_total", op: "gte", value: "100" },
      { field: "name", op: "in", value: "A, B" },
    ]),
    '{"state":"Sale","amount_total":{"$gte":100},"name":{"$in":["A","B"]}}',
  )
})

test("persists explicit strict timestamp and measure policies", () => {
  assert.deepEqual(
    JSON.parse(storedDashboardBindingConfiguration("date_order", "amount_total")),
    {
      version: 1,
      timeField: "date_order",
      measureField: "amount_total",
      missingTimestampPolicy: "reject",
      missingMeasurePolicy: "reject",
    },
  )
})
