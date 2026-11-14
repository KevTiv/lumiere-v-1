import assert from "node:assert/strict"
import test from "node:test"

import { resolveActionDraftRecordHref } from "./action-draft-links"
import {
  buildModuleTabHref,
  resolveAiSourceHref,
  resolveErpResourceTarget,
} from "./ai-source-links"
import {
  accountMoveHref,
  purchaseOrderHref,
  saleOrderHref,
  stockPickingHref,
} from "./record-links"

test("assistant citations and approved order drafts focus their exact canonical records", () => {
  for (const [entity, reducer, href] of [
    ["sale_order", "create_sale_order", saleOrderHref],
    ["purchase_order", "create_purchase_order", purchaseOrderHref],
  ] as const) {
    for (const id of ["42", "99", "9007199254740993", "18446744073709551615"]) {
      assert.equal(
        resolveAiSourceHref({ entity_type: entity, entity_id: id }),
        href(id),
      )
      assert.equal(resolveActionDraftRecordHref(reducer, id), href(id))
    }
    assert.notEqual(
      resolveActionDraftRecordHref(reducer, 42),
      resolveActionDraftRecordHref(reducer, 99),
    )
  }
})

test("invoice and bill evidence uses the ledger which actually applies record filters", () => {
  for (const kind of ["invoice", "bill", "account_move"]) {
    assert.equal(
      resolveAiSourceHref({ source_kind: kind, source_key: `${kind}:42` }),
      accountMoveHref(42),
    )
  }
  assert.equal(
    resolveAiSourceHref({ source_kind: "invoice" }),
    "/accounting?tab=invoices",
  )
})

test("all ten Alpha modules have exact destinations using existing bounded workspaces", () => {
  const destinations = [
    ["account_move", "/accounting?tab=journal-entries&filter=id%3A42"],
    ["hr_expense", "/expenses?tab=expenses&filter=id%3A42"],
    ["financial_report", "/reports?tab=reports&report=42"],
    ["sale_order", "/sales?tab=orders&filter=id%3A42"],
    ["contact", "/crm?tab=contacts&filter=id%3A42"],
    ["purchase_order", "/purchasing?tab=orders&filter=id%3A42"],
    ["subscription", "/subscriptions/42"],
    ["product", "/products?tab=products&filter=id%3A42"],
    ["stock_quant", "/warehouse?tab=stock&filter=id%3A42"],
    ["fleet_vehicle", "/fleet/vehicles/42"],
  ] as const
  for (const [entity_type, expected] of destinations) {
    assert.equal(
      resolveAiSourceHref({ entity_type, entity_id: "42" }),
      expected,
      entity_type,
    )
  }
})

test("bounded navigation does not change Inventory workflow ownership or receipt handoffs", () => {
  assert.deepEqual(resolveErpResourceTarget("product"), {
    module: "inventory",
    tab: "products",
  })
  assert.deepEqual(resolveErpResourceTarget("stock_quant"), {
    module: "inventory",
    tab: "stock",
  })
  assert.equal(
    resolveAiSourceHref({ entity_type: "stock_picking", entity_id: 42n }),
    stockPickingHref(42n),
  )
  assert.equal(
    resolveAiSourceHref({ entity_type: "project_task", entity_id: 42 }),
    "/projects?tab=tasks&filter=id%3A42",
  )
})

test("supporting files and events use their existing dedicated record pages", () => {
  assert.equal(
    resolveAiSourceHref({ source_kind: "document", source_key: "document:42" }),
    "/documents/42",
  )
  assert.equal(
    resolveAiSourceHref({ entity_type: "calendar-event", entity_id: 42 }),
    "/calendar/events/42",
  )
  assert.equal(
    resolveAiSourceHref({ entity_type: "hr_expense_sheet", entity_id: 42 }),
    "/expenses/reports/42",
  )
  assert.equal(
    resolveAiSourceHref({ source_kind: "proposal", source_key: "proposal:42" }),
    "/proposals/42",
  )
})

test("malformed or rounded identities never fall back to a misleading unfiltered destination", () => {
  const invalid = [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    9007199254740992,
    "",
    " ",
    "0",
    "-1",
    "1.2",
    "1e3",
    "0x10",
    "4 2",
    "4,2",
    "4_2",
    "42/../99",
    "42?companyId=99",
    "18446744073709551616",
  ]
  for (const id of invalid) {
    assert.equal(
      resolveAiSourceHref({ entity_type: "sale_order", entity_id: id }),
      undefined,
      String(id),
    )
    assert.equal(
      resolveActionDraftRecordHref("create_sale_order", id),
      undefined,
      String(id),
    )
  }
  assert.equal(
    resolveAiSourceHref({
      entity_type: "sale_order",
      entity_id: "bad",
      source_key: "sale_order:42",
    }),
    undefined,
  )
  assert.equal(
    resolveAiSourceHref({
      source_kind: "document",
      source_key: "document:bad",
    }),
    undefined,
  )
})

test("unknown targets remain unsupported and module-only hints remain ordinary navigation", () => {
  for (const entity_type of [
    "unknown",
    "constructor",
    "toString",
    "__proto__",
  ]) {
    assert.equal(
      resolveAiSourceHref({ entity_type, entity_id: "42" }),
      undefined,
    )
    assert.equal(resolveErpResourceTarget(entity_type), undefined)
  }
  assert.equal(resolveActionDraftRecordHref("unknown", 42), undefined)
  assert.equal(resolveActionDraftRecordHref("create_task"), undefined)
  assert.equal(
    resolveAiSourceHref({ entity_type: "sale-order" }),
    "/sales?tab=orders",
  )
  assert.equal(buildModuleTabHref("sales", "dashboard"), "/sales")
  assert.equal(buildModuleTabHref("sales", "orders"), "/sales?tab=orders")
})
