import assert from "node:assert/strict"
import test from "node:test"

import {
  formValue,
  nullableBigIntU64,
  optionalTrimmedString,
  unwrapSome,
} from "./form-coercion"
import { toCreatePosConfigParams } from "./pos-create-params"

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

test("POS required IDs distinguish absent defaults from supplied invalid values", () => {
  const context = {
    pickingTypeId: 11n,
    journalId: 12n,
    currencyId: 13n,
    pricelistId: 14n,
    warehouseId: 15n,
    stockLocationId: 16n,
  }
  const absent = toCreatePosConfigParams({ name: "Till" }, context)
  assert.equal(absent?.pickingTypeId, 11n)
  assert.throws(
    () => toCreatePosConfigParams({ name: "Till", pickingTypeId: "not-an-id" }, context),
    RangeError,
  )
  assert.throws(
    () => toCreatePosConfigParams({ name: "Till", pickingTypeId: {} }, context),
    RangeError,
  )
  assert.throws(
    () => toCreatePosConfigParams({ name: "Till", pickingTypeId: "-1" }, context),
    RangeError,
  )
  assert.throws(
    () => toCreatePosConfigParams({ name: "Till", pickingTypeId: "18446744073709551616" }, context),
    RangeError,
  )
  assert.equal(
    toCreatePosConfigParams({ name: "Till", pickingTypeId: { some: "42" } }, context)?.pickingTypeId,
    42n,
  )
  assert.equal(
    toCreatePosConfigParams({ name: "Till", pickingTypeId: { none: [] } }, context)?.pickingTypeId,
    11n,
  )
})
