import assert from "node:assert/strict"
import test from "node:test"

import { toCreateDashboardWidgetParams } from "@lumiere/erp-shared/reports-dashboard-params"
import { resolveStoredDashboard } from "@lumiere/ui/lib/stored-dashboard-resolver"
import {
  queryBuilderDraftFromWidget,
  type QueryBuilderDraft,
} from "./query-builder-definition"
import {
  buildQueryBuilderDomain,
  storedDashboardBindingConfiguration,
} from "./query-builder-semantics"

const base: Record<string, unknown> = {
  id: "9007199254740993",
  name: "Orders by status",
  model: "sale_order",
  widgetType: { tag: "Chart" },
  fields: [],
  aggregation: "count",
  groupBy: "state",
  chartType: "bar",
  limit: 25,
  configuration: storedDashboardBindingConfiguration("date_order", ""),
  domain: JSON.stringify({
    state: { $in: ["Sale", "Draft"] },
    amount_total: { $gte: 10 },
  }),
  sortOrder: JSON.stringify({ value: "desc" }),
  isActive: true,
  width: 6,
}

/** Exercise the same native create contract that the editor submits for a copy. */
function savedCopy(draft: QueryBuilderDraft) {
  return {
    ...toCreateDashboardWidgetParams({
      name: draft.name,
      widgetType: draft.kind,
      model: draft.model,
      fields:
        draft.kind === "table"
          ? draft.fields
          : draft.aggregation === "count"
            ? []
            : [draft.measureField],
      aggregation: draft.aggregation,
      chartType: draft.kind === "chart" ? draft.chartType : undefined,
      groupBy: draft.groupBy || undefined,
      domain: buildQueryBuilderDomain(draft.filters),
      config: storedDashboardBindingConfiguration(
        draft.timeField,
        draft.aggregation === "count" ? "" : draft.measureField,
      ),
      sortOrder: draft.sortField
        ? JSON.stringify({ [draft.sortField]: draft.sortDirection })
        : undefined,
      limit: draft.limit,
      width: 6,
    }),
    id: base.id,
  }
}

function rendered(
  row: Record<string, unknown>,
  records: Record<string, unknown>[],
) {
  return resolveStoredDashboard(
    [row],
    [BigInt(String(row.id))],
    { sale_order: records },
    {
      startMs: Date.UTC(2026, 0, 1),
      endMs: Date.UTC(2027, 0, 1),
    },
  )
}

test("editing a supported definition preserves filter, measure, time, sort and chart semantics", () => {
  const records = [
    { state: "Sale", amountTotal: 30, dateOrder: "2026-01-01" },
    { state: "Sale", amountTotal: 20, dateOrder: "2026-02-01" },
    { state: "Draft", amountTotal: 10, dateOrder: "2026-03-01" },
    { state: "Cancel", amountTotal: 100, dateOrder: "2026-03-01" },
    { state: "Sale", amountTotal: 5, dateOrder: "2026-01-01" },
    { state: "Sale", amountTotal: 90, dateOrder: "2025-01-01" },
  ]
  for (const aggregation of ["count", "sum", "average", "min", "max"]) {
    const row = {
      ...base,
      aggregation,
      fields: aggregation === "count" ? [] : ["amount_total"],
      configuration: storedDashboardBindingConfiguration(
        "date_order",
        aggregation === "count" ? "" : "amount_total",
      ),
    }
    const draft = queryBuilderDraftFromWidget(row)
    assert.ok(draft)
    assert.equal(draft.limit, "25")
    const before = rendered(row, records)
    const after = rendered(savedCopy(draft), records)
    assert.equal(before.state, "ready")
    assert.deepEqual(after, before)
  }
})

test("legacy chart and table limits keep their renderer defaults and explicit limits survive", () => {
  const records = Array.from({ length: 20 }, (_, index) => ({
    state: `Status ${index}`,
    name: `Order ${index}`,
    dateOrder: "2026-01-01",
  }))
  for (const [widgetType, expectedLimit] of [
    ["Chart", "12"],
    ["Table", "10"],
  ] as const) {
    const row = {
      ...base,
      widgetType,
      limit: null,
      fields: [],
      domain: null,
      sortOrder: null,
    }
    const draft = queryBuilderDraftFromWidget(row)
    assert.ok(draft)
    assert.equal(draft.limit, expectedLimit)
    assert.deepEqual(
      rendered(savedCopy(draft), records),
      rendered(row, records),
    )
  }
  for (const limit of [1, 100, 120, 0xffff_ffff]) {
    assert.equal(
      queryBuilderDraftFromWidget({ ...base, limit })?.limit,
      String(limit),
    )
  }
  for (const limit of [
    0,
    -1,
    1.5,
    "12",
    Number.NaN,
    Number.POSITIVE_INFINITY,
    0x1_0000_0000,
  ]) {
    assert.equal(queryBuilderDraftFromWidget({ ...base, limit }), null)
  }
})

test("binding configuration requires the supported version and both exact reject policies", () => {
  const binding = JSON.parse(String(base.configuration)) as Record<
    string,
    unknown
  >
  for (const configuration of [
    "{}",
    "[]",
    "null",
    '"{}"',
    "{",
    binding,
    ...[
      { version: 2 },
      { version: "1" },
      { version: undefined },
      { missingTimestampPolicy: "include" },
      { missingMeasurePolicy: "zero" },
      { missingTimestampPolicy: undefined },
      { missingMeasurePolicy: undefined },
      { timeField: 5 },
      { measureField: { field: "amount_total" } },
      { color: "red" },
    ].map((change) => JSON.stringify({ ...binding, ...change })),
  ])
    assert.equal(queryBuilderDraftFromWidget({ ...base, configuration }), null)
  assert.equal(
    queryBuilderDraftFromWidget({
      ...base,
      aggregation: "sum",
      fields: ["amount_total"],
      configuration: null,
    }),
    null,
  )
  assert.equal(
    queryBuilderDraftFromWidget({
      ...base,
      aggregation: "sum",
      fields: ["amount_total"],
      configuration: storedDashboardBindingConfiguration("", "tax_total"),
    }),
    null,
  )
  assert.equal(
    queryBuilderDraftFromWidget({
      ...base,
      configuration: storedDashboardBindingConfiguration("", "amount_total"),
    }),
    null,
  )
  assert.ok(queryBuilderDraftFromWidget({ ...base, configuration: null }))
})

test("filters that would change during text editing remain uneditable", () => {
  for (const domain of [
    { state: { $in: ["North, South"] } },
    { state: { $in: [" Sale"] } },
    { state: { $in: ["Sale "] } },
    { state: { $in: [""] } },
    { state: { $in: [] } },
    { state: " Sale" },
    { state: "Sale " },
    { state: "" },
    { id: { $ne: "001" } },
    { id: { $ne: "9007199254740993" } },
    { amount_total: { $ne: "1e2" } },
    { amount_total: { $gte: "not-numeric" } },
    { state: { xne: "Sale" } },
    { state: { $contains: "Sale" } },
    { state: { $ne: "Sale", $in: ["Draft"] } },
    { state: { $in: "Sale" } },
    { state: null },
    { state: { $eq: "Sale" } },
    { "": "Sale" },
    { state: [{ $ne: "Sale" }] },
  ])
    assert.equal(
      queryBuilderDraftFromWidget({ ...base, domain: JSON.stringify(domain) }),
      null,
      JSON.stringify(domain),
    )
  assert.equal(
    queryBuilderDraftFromWidget({
      ...base,
      domain: '{"__proto__":{"$ne":"Sale"}}',
    }),
    null,
  )
  assert.equal(
    queryBuilderDraftFromWidget({ ...base, domain: { state: "Sale" } }),
    null,
  )
  assert.equal(queryBuilderDraftFromWidget({ ...base, domain: "[]" }), null)
})

test("representable filters preserve textual IDs, internal spaces and scalar comparison meaning", () => {
  const domain = {
    id: { $in: ["9007199254740993", "001"] },
    name: "North, South",
    region: { $in: ["North America", "South America"] },
    active: true,
    amount_total: { $gte: 10.5 },
    state: { $ne: "Cancel" },
  }
  const draft = queryBuilderDraftFromWidget({
    ...base,
    domain: JSON.stringify(domain),
  })
  assert.ok(draft)
  assert.deepEqual(JSON.parse(buildQueryBuilderDomain(draft.filters)!), {
    ...domain,
    active: "true",
  })
})

test("unsupported or malformed settings cannot silently become a different definition", () => {
  for (const value of [null, undefined, [], {}, "widget", 1])
    assert.equal(queryBuilderDraftFromWidget(value), null)
  for (const change of [
    { widgetType: "List" },
    { widgetType: "chart" },
    { widgetType: { tag: "Chart", extra: 1 } },
    { aggregation: "median" },
    { aggregation: "" },
    { aggregation: {} },
    { chartType: "scatter" },
    { chartType: "" },
    { chartType: [] },
    { model: "" },
    { model: {} },
    { groupBy: "" },
    { groupBy: 1 },
    { fields: "state" },
    { fields: [1] },
    { fields: ["state", "state"] },
    { fields: ["amount_total"] },
    { name: {} },
    { sortOrder: "{}" },
    { sortOrder: "[]" },
    { sortOrder: { value: "asc" } },
    { sortOrder: '{"value":"asc","state":"desc"}' },
    { sortOrder: '{"value":"other"}' },
    { sortOrder: '{"":"asc"}' },
    { refreshInterval: 30 },
  ])
    assert.equal(
      queryBuilderDraftFromWidget({ ...base, ...change }),
      null,
      JSON.stringify(change),
    )
})

test("drafts clone editable collections and never carry the saved widget identity", () => {
  const row = { ...base, widgetType: "Table", fields: ["name", "state"] }
  const first = queryBuilderDraftFromWidget(row)!
  const second = queryBuilderDraftFromWidget(row)!
  assert.ok(first)
  first.fields.push("amount_total")
  first.filters[0]!.value = "Cancel"
  first.name = "Personal copy"
  assert.deepEqual(row.fields, ["name", "state"])
  assert.deepEqual(second.fields, ["name", "state"])
  assert.equal(second.filters[0]!.value, "Sale, Draft")
  assert.equal(second.name, "Orders by status")
  assert.ok(
    !("id" in first) && !("organizationId" in first) && !("companyId" in first),
  )
})
