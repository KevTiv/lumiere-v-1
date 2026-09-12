import { test } from "node:test"
import assert from "node:assert/strict"
import { firstOwnedKey, firstNonNullKey, toSnakeCase, toCamelCase, getRowField } from "./row-values"

test("firstOwnedKey returns first existing own property", () => {
  assert.equal(firstOwnedKey({ a: 1, b: 2 }, "a", "b"), 1)
  assert.equal(firstOwnedKey({ b: 2 }, "a", "b"), 2)
})

test("firstOwnedKey preserves null", () => {
  assert.equal(firstOwnedKey({ a: null, b: 2 }, "a", "b"), null)
})

test("firstOwnedKey preserves false and zero", () => {
  assert.equal(firstOwnedKey({ a: false }, "a"), false)
  assert.equal(firstOwnedKey({ a: 0 }, "a"), 0)
})

test("firstOwnedKey returns undefined when no key found", () => {
  assert.equal(firstOwnedKey({ x: 1 }, "a", "b"), undefined)
})

test("firstOwnedKey does not traverse prototype chain", () => {
  const proto = { a: 1 }
  const obj = Object.create(proto)
  assert.equal(firstOwnedKey(obj, "a"), undefined)
})

test("firstNonNullKey skips null and undefined", () => {
  assert.equal(firstNonNullKey({ a: null, b: 2 }, "a", "b"), 2)
  assert.equal(firstNonNullKey({ a: undefined, b: 3 }, "a", "b"), 3)
})

test("firstNonNullKey preserves false and zero", () => {
  assert.equal(firstNonNullKey({ a: false, b: 1 }, "a", "b"), false)
  assert.equal(firstNonNullKey({ a: 0, b: 1 }, "a", "b"), 0)
})

test("firstNonNullKey returns undefined when all are null", () => {
  assert.equal(firstNonNullKey({ a: null, b: null }, "a", "b"), undefined)
})

test("toSnakeCase converts camelCase to snake_case", () => {
  assert.equal(toSnakeCase("displayName"), "display_name")
  assert.equal(toSnakeCase("emailFrom"), "email_from")
  assert.equal(toSnakeCase("id"), "id")
})

test("toCamelCase converts snake_case to camelCase", () => {
  assert.equal(toCamelCase("display_name"), "displayName")
  assert.equal(toCamelCase("email_from"), "emailFrom")
  assert.equal(toCamelCase("id"), "id")
})

test("getRowField tries exact, snake, camel", () => {
  assert.equal(getRowField({ name: "Alice" }, "name"), "Alice")
  assert.equal(getRowField({ display_name: "Bob" }, "displayName"), "Bob")
  assert.equal(getRowField({ displayName: "Carol" }, "display_name"), "Carol")
})

test("getRowField preserves null", () => {
  assert.equal(getRowField({ name: null }, "name"), null)
})

test("getRowField returns undefined for missing", () => {
  assert.equal(getRowField({ x: 1 }, "name"), undefined)
})
