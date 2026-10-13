import assert from "node:assert/strict"
import test from "node:test"

import type { FormConfig } from "@lumiere/ui"

import { awardBidOptions, labelWithId, pickerOptions, recordOptions, withLinkedPickers, workflowVersionOptions } from "./linked-options"

test("labelWithId disambiguates by id and survives a missing name", () => {
  assert.equal(labelWithId("Acme", 12), "Acme (#12)")
  assert.equal(labelWithId("  ", 7), "#7")
  assert.equal(labelWithId(undefined, 7), "#7")
})

test("recordOptions skips id-less rows, dedupes, and sorts by label", () => {
  const options = recordOptions(
    [{ id: 2, name: "Beta" }, { id: 1, name: "Alpha" }, { name: "No id" }, { id: 1, name: "Alpha again" }, { id: 3, name: "Beta" }],
    (row) => row.name,
  )
  assert.deepEqual(options, [
    { value: "1", label: "Alpha (#1)" },
    { value: "2", label: "Beta (#2)" },
    { value: "3", label: "Beta (#3)" },
  ])
})

test("pickerOptions adds None only for optional, non-empty lists", () => {
  const linked = [{ value: "1", label: "A (#1)" }]
  assert.deepEqual(pickerOptions(linked, true), linked)
  assert.deepEqual(pickerOptions(linked, false), [{ value: "", label: "None" }, ...linked])
  assert.deepEqual(pickerOptions([], false), [{ value: "", label: "No records", disabled: true }])
})

test("withLinkedPickers converts only the named number fields", () => {
  const config: FormConfig = {
    id: "f",
    title: "F",
    sections: [
      {
        id: "s",
        fields: [
          { id: "a", name: "skillId", type: "number", label: "Skill", required: true, min: 1, defaultValue: 4 },
          { id: "b", name: "other", type: "number", label: "Other" },
          { id: "c", name: "skillId", type: "text", label: "Text" },
        ],
      },
    ],
  }
  const out = withLinkedPickers(config, { skillId: [{ value: "4", label: "Four (#4)" }] })
  const [a, b, c] = out.sections[0].fields
  assert.equal(a.type, "select")
  assert.deepEqual(a.type === "select" && a.options, [{ value: "4", label: "Four (#4)" }])
  assert.equal(a.type === "select" && a.searchable, true)
  assert.equal(a.type === "select" && a.defaultValue, "4")
  assert.equal(b.type, "number")
  assert.equal(c.type, "text")
})

test("awardBidOptions labels bids with RFQ, vendor and state", () => {
  const out = awardBidOptions(
    [{ id: 1, name: "RFQ-001" }],
    [{ id: 9, rfqId: 1, partnerId: 5, state: "submitted" }, { id: 10, rfqId: 2, partnerId: 6, state: "draft" }],
    new Map([["5", "Globex"]]),
  )
  assert.deepEqual(out.rfqId, [{ value: "1", label: "RFQ-001 (#1)" }])
  assert.deepEqual(out.bidId, [
    { value: "10", label: "RFQ #2 · Vendor #6 · draft (#10)" },
    { value: "9", label: "RFQ-001 · Globex · submitted (#9)" },
  ])
})

test("workflowVersionOptions labels versions with workflow, version number and status", () => {
  const out = workflowVersionOptions(
    [{ id: 3, workflowKey: "po_approval" }],
    [{ id: 30, workflowId: 3, version: 2, status: { tag: "Published" } }, { id: 31, workflowId: 4, version: 1, status: "Draft" }],
  )
  assert.deepEqual(out.workflowId, [{ value: "3", label: "po_approval (#3)" }])
  assert.deepEqual(out.versionId, [
    { value: "30", label: "po_approval · v2 · Published (#30)" },
    { value: "31", label: "Workflow #4 · v1 · Draft (#31)" },
  ])
})
