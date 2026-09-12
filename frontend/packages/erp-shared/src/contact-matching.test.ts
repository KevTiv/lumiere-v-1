import { test } from "node:test"
import assert from "node:assert/strict"
import { norm, rowId, rowEmail, rowPhone, rowName } from "./contact-matching"

test("norm trims and lowercases", () => {
  assert.equal(norm("  Hello  "), "hello")
  assert.equal(norm(undefined), "")
  assert.equal(norm(null), "")
  assert.equal(norm(42), "42")
})

test("rowId extracts id as string", () => {
  assert.equal(rowId({ id: 123 }), "123")
  assert.equal(rowId({ id: "abc" }), "abc")
  assert.equal(rowId({}), "")
})

test("rowEmail tries email, emailFrom, email_from", () => {
  assert.equal(rowEmail({ email: "A@B.com" }), "a@b.com")
  assert.equal(rowEmail({ emailFrom: "A@B.com" }), "a@b.com")
  assert.equal(rowEmail({ email_from: "A@B.com" }), "a@b.com")
  assert.equal(rowEmail({}), "")
})

test("rowPhone tries phone, phoneNumber, phone_number then mobile fallback", () => {
  assert.equal(rowPhone({ phone: "  123-456  " }), "123-456")
  assert.equal(rowPhone({ phoneNumber: "123" }), "123")
  assert.equal(rowPhone({ phone_number: "123" }), "123")
  assert.equal(rowPhone({}), "")
})

test("rowPhone falls back to mobile when phone is blank", () => {
  assert.equal(rowPhone({ mobile: "999" }), "999")
  assert.equal(rowPhone({ phone: "", mobile: "999" }), "999")
  assert.equal(rowPhone({ phone: "111", mobile: "999" }), "111")
  assert.equal(rowPhone({ phoneNumber: null, mobile: "999" }), "999")
})

test("rowPhone returns blank when both phone and mobile are blank", () => {
  assert.equal(rowPhone({ phone: "", mobile: "" }), "")
  assert.equal(rowPhone({ phone: "  ", mobile: "  " }), "")
})

test("rowName tries name, displayName, display_name", () => {
  assert.equal(rowName({ name: "  Alice  " }), "alice")
  assert.equal(rowName({ displayName: "Alice" }), "alice")
  assert.equal(rowName({ display_name: "Alice" }), "alice")
  assert.equal(rowName({}), "")
})
