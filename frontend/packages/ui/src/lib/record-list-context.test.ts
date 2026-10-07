import { describe, expect, it } from "vitest"
import {
  MAX_RECORD_LIST_SIZE,
  RECORD_LIST_TTL_MS,
  readRecordListContext,
  splitRecordHref,
  writeRecordListContext,
} from "./record-list-context"

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

describe("record list context", () => {
  it("splits a record href into base path and id", () => {
    expect(splitRecordHref("/purchasing/orders/12?tab=lines")).toEqual({ base: "/purchasing/orders", id: "12" })
    expect(splitRecordHref("/projects/7")).toEqual({ base: "/projects", id: "7" })
    expect(splitRecordHref("/")).toBeUndefined()
  })

  it("round-trips the ordered ids", () => {
    const storage = memoryStorage()
    expect(writeRecordListContext("/projects", ["3", "1", "2"], storage, 1000)).toBe(true)
    expect(readRecordListContext("/projects", storage, 2000)).toEqual(["3", "1", "2"])
    expect(readRecordListContext("/other", storage, 2000)).toBeUndefined()
  })

  it("ignores a stale context", () => {
    const storage = memoryStorage()
    writeRecordListContext("/projects", ["1"], storage, 1000)
    expect(readRecordListContext("/projects", storage, 1000 + RECORD_LIST_TTL_MS + 1)).toBeUndefined()
  })

  it("does not store oversized lists", () => {
    const storage = memoryStorage()
    const ids = Array.from({ length: MAX_RECORD_LIST_SIZE + 1 }, (_, i) => String(i))
    expect(writeRecordListContext("/projects", ids, storage)).toBe(false)
    expect(readRecordListContext("/projects", storage)).toBeUndefined()
  })

  it("never throws when storage fails or holds junk", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied")
      },
      setItem: () => {
        throw new Error("denied")
      },
      removeItem: () => {},
    }
    expect(writeRecordListContext("/p", ["1"], broken)).toBe(false)
    expect(readRecordListContext("/p", broken)).toBeUndefined()
    const storage = memoryStorage()
    storage.setItem("lumiere:record-list:/p", "{not json")
    expect(readRecordListContext("/p", storage)).toBeUndefined()
  })
})
