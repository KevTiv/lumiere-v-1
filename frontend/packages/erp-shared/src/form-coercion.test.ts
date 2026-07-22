import assert from "node:assert/strict"
import test from "node:test"

import {
  formValue,
  nullableBigIntU64,
  optionalTrimmedString,
  unwrapSome,
} from "./form-coercion"

test("unwrapSome only unwraps an Option::Some wire value", () => {
  assert.equal(unwrapSome({ some: "value" }), "value")

  const other = { some: "value", extra: true }
  assert.equal(unwrapSome(other), other)
  assert.equal(unwrapSome("value"), "value")
})

test("form coercion handles optional strings, IDs, and alternate field names", () => {
  assert.equal(optionalTrimmedString({ some: " hello " }), "hello")
  assert.equal(optionalTrimmedString("   "), undefined)
  assert.equal(nullableBigIntU64({ some: "42" }), 42n)
  assert.equal(nullableBigIntU64("-1"), null)
  assert.equal(formValue({ company_id: 42n }, "companyId", "company_id"), 42n)
  assert.equal(formValue({ companyId: "", company_id: 42n }, "companyId", "company_id"), "")
})

test("formValue prefers the first present alias and preserves falsy values", () => {
  assert.equal(formValue({ id: 1, legacy_id: 2 }, "id", "legacy_id"), 1)
  assert.equal(formValue({ id: null, legacy_id: 2 }, "id", "legacy_id"), 2)
  assert.equal(formValue({ id: undefined, legacy_id: false }, "id", "legacy_id"), false)
  assert.equal(formValue({ id: 0, legacy_id: 2 }, "id", "legacy_id"), 0)
  assert.equal(formValue({}, "id", "legacy_id"), undefined)
})
