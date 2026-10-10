import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  inlineNumberAbove,
  inlineNumberAtLeast,
  inlineRowTag,
  isDraftExpense,
  isDraftStandardExpense,
  requiredInlineEmail,
  requiredInlineText,
  ticketPriorityPatch,
} from "./inline-edit-params"

describe("inline edit params", () => {
  it("reads enum tags from objects and strings", () => {
    assert.equal(inlineRowTag({ tag: "Draft" }), "Draft")
    assert.equal(inlineRowTag("Draft"), "Draft")
    assert.equal(inlineRowTag(undefined), "")
  })

  it("trims required text and rejects blanks", () => {
    assert.equal(requiredInlineText("  Acme ", "x"), "Acme")
    assert.throws(() => requiredInlineText("   ", "Name required"), /Name required/)
  })

  it("validates numbers", () => {
    assert.equal(inlineNumberAtLeast("12.5", 0, "bad"), 12.5)
    assert.equal(inlineNumberAtLeast(0, 0, "bad"), 0)
    assert.throws(() => inlineNumberAtLeast(-1, 0, "negative"), /negative/)
    assert.throws(() => inlineNumberAtLeast("abc", 0, "nan"), /nan/)
    assert.equal(inlineNumberAbove(2, 0, "bad"), 2)
    assert.throws(() => inlineNumberAbove(0, 0, "positive"), /positive/)
  })

  it("checks the shape of an email", () => {
    assert.equal(requiredInlineEmail(" a@b.co ", "bad"), "a@b.co")
    assert.throws(() => requiredInlineEmail("nope", "bad email"), /bad email/)
    assert.throws(() => requiredInlineEmail("", "bad email"), /bad email/)
  })

  it("maps ticket priorities to the backend enum and nothing else", () => {
    assert.deepEqual(ticketPriorityPatch("low"), { priority: { tag: "Low" } })
    assert.deepEqual(ticketPriorityPatch("normal"), { priority: { tag: "Normal" } })
    assert.deepEqual(ticketPriorityPatch("high"), { priority: { tag: "High" } })
    assert.deepEqual(ticketPriorityPatch("URGENT"), { priority: { tag: "Urgent" } })
    assert.throws(() => ticketPriorityPatch("critical"), /Unknown priority/)
  })

  it("mirrors the backend's draft-only expense rule", () => {
    assert.equal(isDraftExpense({ state: "Draft" }), true)
    assert.equal(isDraftExpense({ state: { tag: "Draft" } }), true)
    assert.equal(isDraftExpense({ state: "Submitted" }), false)
    assert.equal(isDraftStandardExpense({ state: "Draft", lineKind: { tag: "Standard" } }), true)
    assert.equal(isDraftStandardExpense({ state: "Draft" }), true)
    assert.equal(isDraftStandardExpense({ state: "Draft", lineKind: { tag: "Mileage" } }), false)
    assert.equal(isDraftStandardExpense({ state: "Approved", lineKind: "Standard" }), false)
  })
})
