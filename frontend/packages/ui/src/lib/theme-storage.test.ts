import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { readPreference, writePreference } from "./theme-storage"

describe("best-effort theme preferences", () => {
  it("survives an inaccessible storage getter", () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: Object.defineProperty({}, "localStorage", { get() { throw new Error("blocked") } }) })
    assert.equal(readPreference("theme"), null)
    assert.doesNotThrow(() => writePreference("theme", "dark"))
    Reflect.deleteProperty(globalThis, "window")
  })
  it("survives read failures and quota failures", () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem() { throw new Error("blocked") }, setItem() { throw new Error("quota") } } } })
    assert.equal(readPreference("theme"), null)
    assert.doesNotThrow(() => writePreference("theme", "dark"))
    Reflect.deleteProperty(globalThis, "window")
  })
  it("round trips accessible storage", () => {
    const values = new Map<string, string>()
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem(key: string) { return values.get(key) ?? null }, setItem(key: string, value: string) { values.set(key, value) } } } })
    writePreference("theme", "dark")
    assert.equal(readPreference("theme"), "dark")
    Reflect.deleteProperty(globalThis, "window")
  })
})
