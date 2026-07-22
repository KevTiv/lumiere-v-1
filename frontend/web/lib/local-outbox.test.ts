import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  getOrCreateLocalStorageDeviceId,
  readLocalStorageArray,
  writeLocalStorageArray,
} from "./local-outbox"

function withLocalStorage(run: (values: Map<string, string>) => void): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window")
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    },
  })

  try {
    run(values)
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous)
    else Reflect.deleteProperty(globalThis, "window")
  }
}

describe("local outbox storage", () => {
  it("is SSR-safe", () => {
    assert.equal(getOrCreateLocalStorageDeviceId("device"), "server")
    assert.deepEqual(readLocalStorageArray("outbox"), [])
  })

  it("keeps device IDs stable and writes raw arrays", () => {
    withLocalStorage((values) => {
      const deviceId = getOrCreateLocalStorageDeviceId("device")
      assert.equal(getOrCreateLocalStorageDeviceId("device"), deviceId)

      writeLocalStorageArray("outbox", [{ id: "first" }])
      assert.equal(values.get("outbox"), '[{"id":"first"}]')
      assert.deepEqual(readLocalStorageArray<{ id: string }>("outbox"), [{ id: "first" }])
    })
  })

  it("returns an empty array for malformed or non-array stored data", () => {
    withLocalStorage((values) => {
      values.set("bad-json", "{")
      values.set("object", '{"id":"not-an-array"}')
      assert.deepEqual(readLocalStorageArray("bad-json"), [])
      assert.deepEqual(readLocalStorageArray("object"), [])
    })
  })
})
