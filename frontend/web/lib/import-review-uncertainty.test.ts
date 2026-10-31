import assert from "node:assert/strict"
import test from "node:test"
import type { ReviewRow } from "./import-review-model"
import {
  buildBulkReviewPreview,
  changeReviewValue,
  reviewDecision,
  reviewIssueGroups,
  undoReviewDecision,
  verifyBulkReviewReceipt,
  verifyReviewReceipt,
} from "./import-review-uncertainty"

function sausage(id = "1"): ReviewRow {
  return {
    id,
    revision: 1,
    state: "needs_review",
    reason: null,
    reviewedAt: null,
    reviewedBy: null,
    confirmedFields: [],
    source: {
      key: `sausage-${id}`,
      label: "Sausage",
      issue: "Unknown weight and cost",
      source: { file: "farm.csv", row: Number(id) + 1, sha256: "a".repeat(64) },
      fields: [
        {
          key: "quantity",
          label: "Actual weight",
          kind: "decimal",
          sourceValue: "8",
          required: true,
        },
        {
          key: "unit_price",
          label: "Price per kg",
          kind: "decimal",
          sourceValue: "600",
          required: true,
        },
        {
          key: "cost_price",
          label: "Cost",
          kind: "decimal",
          sourceValue: null,
          required: true,
        },
        {
          key: "stored_unit",
          label: "Price unit",
          kind: "choice",
          sourceValue: null,
          required: true,
          options: ["kg", "unit"],
        },
      ],
      proposed: {
        quantity: null,
        unit_price: "4800",
        cost_price: null,
        stored_unit: "kg",
      },
    },
    values: {
      quantity: null,
      unit_price: "4800",
      cost_price: null,
      stored_unit: "kg",
    },
  }
}

test("only complete matching receipts resolve an uncertain single or bulk submission", () => {
  const decision = {
    ...reviewDecision(sausage()),
    reason: "Price confirmed",
    confirmedFields: ["unit_price"],
  }
  const receipt = {
    replayed: false,
    item: {
      id: decision.itemId,
      revision: 2,
      state: decision.state,
      values: decision.values,
      confirmedFields: decision.confirmedFields,
      reason: decision.reason,
    },
  }
  verifyReviewReceipt(receipt, decision)
  verifyBulkReviewReceipt({ results: [receipt] }, [decision])
  assert.throws(
    () => verifyReviewReceipt({}, decision),
    /could not be verified/,
  )
  assert.throws(
    () =>
      verifyReviewReceipt(
        {
          ...receipt,
          item: {
            ...receipt.item,
            values: { ...decision.values, quantity: "1" },
          },
        },
        decision,
      ),
    /do not match/,
  )
  assert.throws(
    () => verifyBulkReviewReceipt({ results: [] }, [decision]),
    /complete bulk/,
  )
  assert.throws(
    () =>
      verifyBulkReviewReceipt({ results: [receipt, receipt] }, [
        decision,
        { ...decision, itemId: "2" },
      ]),
    /repeated rows/,
  )
})

test("838 rows group by missing fact and preserve exact source identity", () => {
  const items = Array.from({ length: 838 }, (_, index) =>
    sausage(String(index + 1)),
  )
  const groups = reviewIssueGroups(items)
  assert.equal(
    groups.find((group) => group.key === "missing:quantity")?.itemIds.length,
    838,
  )
  assert.equal(
    groups.find((group) => group.key === "proposal:unit_price")?.itemIds.length,
    838,
  )
  assert.equal(items[7].source.source.row, 9)
})

test("a unit choice never rewrites quantity or price and clears only its own confirmation", () => {
  const item = sausage()
  item.confirmedFields = ["unit_price", "stored_unit"]
  const decision = changeReviewValue(
    reviewDecision(item),
    "stored_unit",
    "unit",
  )
  assert.equal(decision.values.quantity, null)
  assert.equal(decision.values.unit_price, "4800")
  assert.deepEqual(decision.confirmedFields, ["unit_price"])
  assert.equal(item.values.stored_unit, "kg")
  assert.equal(item.source.fields[0].sourceValue, "8")
})

test("bulk preview confirms a price independently, retains exceptions, and uses exact revisions", () => {
  const items = [sausage("1"), sausage("2"), sausage("3")]
  items[1].values.unit_price = "4600"
  items[1].confirmedFields = ["unit_price"]
  const preview = buildBulkReviewPreview({
    items,
    selectedIds: new Set(["1", "2"]),
    fieldKey: "unit_price",
    value: "4800",
    confirm: true,
    replaceConfirmed: false,
    reason: "Confirmed price per kg only",
  })
  assert.equal(preview.decisions.length, 1)
  assert.equal(preview.skipped[0].item.id, "2")
  assert.deepEqual(preview.decisions[0].confirmedFields, ["unit_price"])
  assert.equal(preview.decisions[0].state, "needs_review")
  assert.equal(preview.decisions[0].values.quantity, null)
  assert.equal(preview.decisions[0].values.cost_price, null)
  assert.equal(preview.decisions[0].expectedRevision, 1)
  assert.equal(items[2].revision, 1)
  assert.equal(items[1].values.unit_price, "4600")
})

test("unknown or malformed values cannot acquire field confirmation", () => {
  for (const value of ["", "NaN", "1e3", "1,000"]) {
    assert.throws(() =>
      buildBulkReviewPreview({
        items: [sausage()],
        selectedIds: new Set(["1"]),
        fieldKey: "unit_price",
        value,
        confirm: true,
        replaceConfirmed: false,
        reason: "Price verified",
      }),
    )
  }
})

test("undo restores the preceding persisted snapshot as a new decision, rejecting stale history", () => {
  const item = { ...sausage(), revision: 4, confirmedFields: ["unit_price"] }
  const entry = {
    itemId: "1",
    revision: 4,
    values: item.values,
    state: "needs_review",
    reason: "Price verified",
    actor: "actor",
    createdAt: "now",
    previousValues: { ...item.values, unit_price: null },
    previousConfirmedFields: [],
    previousState: "needs_review" as const,
  }
  const undo = undoReviewDecision(item, entry)
  assert.equal(undo.expectedRevision, 4)
  assert.equal(undo.values.unit_price, null)
  assert.deepEqual(undo.confirmedFields, [])
  assert.equal(item.values.unit_price, "4800")
  assert.throws(
    () => undoReviewDecision({ ...item, revision: 5 }, entry),
    /Reload/,
  )
})
