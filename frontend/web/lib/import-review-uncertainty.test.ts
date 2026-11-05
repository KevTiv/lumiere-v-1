import assert from "node:assert/strict"
import test from "node:test"
import type { ReviewRow } from "./import-review-model"
import {
  buildBulkConfirmationPreview,
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

function breast(index = 0): ReviewRow {
  const quantityMillis = (index + 1) * 1000 + 1
  const price = 4000 + index
  const amountMillis = quantityMillis * price
  const values: Record<string, string | null> = {
    product: "BREAST",
    quantity: `${index + 1}.001000`,
    unit_price: `${price}.000000`,
    amount: `${Math.floor(amountMillis / 1000)}.${String(amountMillis % 1000).padStart(3, "0")}000`,
    source_unit: "kg",
    date: "2022-06-13",
    comment: "CREDIT",
    optional_unknown: null,
  }
  return {
    ...sausage(String(index + 1)),
    revision: index + 2,
    source: {
      key: `breast-volume-${index + 1}`,
      label: `BREAST row ${index + 1}`,
      issue: "Historical volume only; payment is not verified.",
      source: { file: "farm.csv", row: index + 170, sha256: "b".repeat(64) },
      fields: Object.entries(values).map(([key, value]) => ({
        key,
        label: key,
        kind: ["quantity", "unit_price", "amount"].includes(key)
          ? "decimal" as const
          : key === "date"
            ? "date" as const
            : "text" as const,
        sourceValue: key === "source_unit" ? null : value,
        required: !["comment", "optional_unknown"].includes(key),
        export: false,
      })),
      proposed: { ...values },
    },
    values,
  }
}

test("one confirmation preview preserves all 133 distinct exact volume values and provenance", () => {
  const items = Array.from({ length: 133 }, (_, index) => breast(index))
  const original = structuredClone(items)
  const selectedIds = new Set(items.map((item) => item.id))
  const preview = buildBulkConfirmationPreview({
    items,
    selectedIds,
    mode: "complete_rows",
    reason: "Original CSV values checked; owner confirmed chicken breast and kg.",
  })
  assert.equal(preview.rows.length, 133)
  assert.equal(preview.decisions.length, 133)
  assert.deepEqual(preview.skipped, [])
  for (let index = 0; index < items.length; index++) {
    const decision = preview.decisions[index]
    assert.deepEqual(decision.values, original[index].values)
    assert.equal(decision.expectedRevision, original[index].revision)
    assert.equal(decision.state, "confirmed")
    assert.ok(decision.confirmedFields.includes("comment"))
    assert.ok(!decision.confirmedFields.includes("optional_unknown"))
    assert.equal(preview.rows[index].beforeState, "needs_review")
    assert.equal(preview.rows[index].afterState, "confirmed")
    assert.deepEqual(preview.rows[index].item.source, original[index].source)
    const quantity = preview.rows[index].fields.find(({ field }) => field.key === "quantity")!
    assert.equal(quantity.sourceValue, original[index].values.quantity)
    assert.equal(quantity.value, original[index].values.quantity)
    assert.equal(quantity.beforeConfirmed, false)
    assert.equal(quantity.afterConfirmed, true)
  }
  assert.deepEqual(items, original)
  assert.equal(selectedIds.size, 133)
})

test("partial confirmation preserves other fields and their confirmations without completing the row", () => {
  const item = sausage()
  item.confirmedFields = ["stored_unit"]
  const original = structuredClone(item)
  const preview = buildBulkConfirmationPreview({
    items: [item],
    selectedIds: new Set([item.id]),
    mode: "confirm_fields",
    fieldKeys: ["unit_price", "unit_price"],
    reason: "Owner confirmed the recorded price only.",
  })
  const decision = preview.decisions[0]
  assert.equal(decision.state, "needs_review")
  assert.deepEqual(decision.values, original.values)
  assert.deepEqual(decision.confirmedFields, ["stored_unit", "unit_price"])
  assert.equal(decision.values.quantity, null)
  assert.equal(decision.values.cost_price, null)
  assert.deepEqual(preview.rows[0].fields.map(({ field }) => field.key), ["unit_price"])
  assert.equal(preview.rows[0].fields[0].sourceValue, "600")
  assert.equal(preview.rows[0].fields[0].value, "4800")
  assert.deepEqual(item, original)
})

test("complete confirmation isolates unknown, malformed, excluded and already confirmed rows", () => {
  const valid = breast(0)
  valid.confirmedFields = ["product"]
  const unknown = breast(1)
  unknown.values.quantity = null
  const invalidDate = breast(2)
  invalidDate.values.date = "2022-02-30"
  const invalidDecimal = breast(3)
  invalidDecimal.values.quantity = "7.1234567"
  const excluded = { ...breast(4), state: "excluded" as const }
  const confirmed = { ...breast(5), state: "confirmed" as const }
  const items = [valid, unknown, invalidDate, invalidDecimal, excluded, confirmed]
  const preview = buildBulkConfirmationPreview({
    items,
    selectedIds: new Set(items.map((item) => item.id)),
    mode: "complete_rows",
    reason: "Checked source values.",
  })
  assert.deepEqual(preview.decisions.map(({ itemId }) => itemId), [valid.id])
  assert.equal(preview.decisions[0].confirmedFields[0], "product")
  assert.equal(new Set(preview.decisions[0].confirmedFields).size, 7)
  assert.equal(preview.skipped.length, 5)
  assert.match(preview.skipped[0].reason, /quantity is required/)
  assert.match(preview.skipped[1].reason, /valid date/)
  assert.match(preview.skipped[2].reason, /exact decimal/)
  assert.equal(preview.skipped[3].reason, "Excluded row")
  assert.equal(preview.skipped[4].reason, "Row already confirmed")
})

test("partial confirmation never falls back to source values or overwrites an existing decision", () => {
  const items = [sausage("1"), sausage("2"), sausage("3")]
  items[1].values.quantity = "4.500000"
  items[2].values.quantity = "3.100000"
  items[2].confirmedFields = ["quantity"]
  const preview = buildBulkConfirmationPreview({
    items,
    selectedIds: new Set(items.map((item) => item.id)),
    mode: "confirm_fields",
    fieldKeys: ["quantity"],
    reason: "Verified actual weights.",
  })
  assert.deepEqual(preview.decisions.map(({ itemId }) => itemId), ["2"])
  assert.equal(preview.decisions[0].values.quantity, "4.500000")
  assert.equal(preview.decisions[0].state, "needs_review")
  assert.match(preview.skipped[0].reason, /unknown/)
  assert.match(preview.skipped[1].reason, /already confirmed/)
  assert.equal(items[0].source.fields[0].sourceValue, "8")
  assert.equal(items[0].values.quantity, null)
  assert.deepEqual(items[2].confirmedFields, ["quantity"])
})

test("partial preview isolates missing fields and malformed untouched values before an atomic save", () => {
  const missing = breast(0)
  missing.source.fields = missing.source.fields.filter(({ key }) => key !== "source_unit")
  const invalid = breast(1)
  invalid.values.date = "2022-02-30"
  const preview = buildBulkConfirmationPreview({
    items: [missing, invalid],
    selectedIds: new Set([missing.id, invalid.id]),
    mode: "confirm_fields",
    fieldKeys: ["source_unit"],
    reason: "Owner confirmed kg.",
  })
  assert.deepEqual(preview.decisions, [])
  assert.equal(preview.skipped[0].reason, "Selected field is not present")
  assert.match(preview.skipped[1].reason, /valid date/)
})

test("a complete-row preview checks quantity times price exactly without rounding", () => {
  const valid = breast(0)
  valid.values.quantity = "0.100000"
  valid.values.unit_price = "0.200000"
  valid.values.amount = "0.020000"
  const mismatch = breast(1)
  mismatch.values.quantity = "0.100000"
  mismatch.values.unit_price = "0.200000"
  mismatch.values.amount = "0.020001"
  const preview = buildBulkConfirmationPreview({
    items: [valid, mismatch],
    selectedIds: new Set([valid.id, mismatch.id]),
    mode: "complete_rows",
    reason: "Source amounts reconciled.",
  })
  assert.equal(preview.decisions.length, 1)
  assert.equal(preview.decisions[0].values.amount, "0.020000")
  assert.match(preview.skipped[0].reason, /multiplied by unit price/)
})

test("UTF-8 text boundaries isolate oversized source values before bulk save", () => {
  const valid = breast(0)
  valid.values.comment = "é".repeat(1000)
  const oversized = breast(1)
  oversized.values.comment = "é".repeat(1001)
  const preview = buildBulkConfirmationPreview({
    items: [valid, oversized],
    selectedIds: new Set([valid.id, oversized.id]),
    mode: "complete_rows",
    reason: "Source wording verified.",
  })
  assert.equal(preview.decisions.length, 1)
  assert.equal(preview.decisions[0].values.comment, valid.values.comment)
  assert.equal(preview.skipped[0].item.id, oversized.id)
  assert.match(preview.skipped[0].reason, /too long/)
})

test("an optional-only blank row cannot become a confirmed source without any known facts", () => {
  const item = breast()
  item.source.fields = item.source.fields.map((field) => ({
    ...field,
    required: false,
  }))
  item.values = Object.fromEntries(
    item.source.fields.map((field, index) => [
      field.key,
      index % 2 === 0 ? null : "",
    ]),
  )
  const original = structuredClone(item)
  const preview = buildBulkConfirmationPreview({
    items: [item],
    selectedIds: new Set([item.id]),
    mode: "complete_rows",
    reason: "Original row inspected; all facts remain unknown.",
  })
  assert.deepEqual(preview.decisions, [])
  assert.deepEqual(preview.rows, [])
  assert.equal(preview.skipped[0].reason, "There are no known values to confirm.")
  assert.deepEqual(item, original)
})

test("confirmation preview rejects stale or oversized selections and requires a field and evidence", () => {
  const item = breast()
  const args = {
    items: [item],
    selectedIds: new Set([item.id]),
    mode: "complete_rows" as const,
    reason: "Checked source values.",
  }
  assert.throws(() => buildBulkConfirmationPreview({ ...args, reason: " " }), /supporting evidence/)
  assert.throws(() => buildBulkConfirmationPreview({ ...args, reason: "é".repeat(1001) }), /supporting evidence/)
  assert.throws(() => buildBulkConfirmationPreview({ ...args, selectedIds: new Set() }), /Select at least/)
  assert.throws(() => buildBulkConfirmationPreview({ ...args, selectedIds: new Set(["missing"]) }), /Reload/)
  assert.throws(() => buildBulkConfirmationPreview({ ...args, items: [item, item] }), /Reload/)
  assert.throws(() => buildBulkConfirmationPreview({ ...args, mode: "confirm_fields", fieldKeys: [] }), /Select at least one field/)
  assert.throws(() => buildBulkConfirmationPreview({ ...args, selectedIds: new Set(Array.from({ length: 1001 }, (_, index) => String(index))) }), /1,000/)
})
