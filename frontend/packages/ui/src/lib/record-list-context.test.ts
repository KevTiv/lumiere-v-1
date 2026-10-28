import { afterEach, describe, expect, it } from "vitest"
import {
  accountingListReturnHref,
  commitRecordListFor,
  consumeRecordListReturnContext,
  rememberRecordList,
  readRecordListReturnContext,
  type RecordListReturnContext,
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

const returnKey = "lumiere:accounting-worklist:v1:7:11:alpha:invoice"
const snapshot: RecordListReturnContext = {
  key: returnKey, href: "/accounting?tab=invoices&filter=currencyId%3A1&keep=alpha", filterKey: "effective-filters",
  sorting: [{ id: "name", desc: false }], page: 2, rowId: "90071992547409931", focus: "link", scrollTop: 240, scrollLeft: 120,
}
afterEach(() => window.sessionStorage.clear())

describe("Accounting list return context", () => {
  it("keeps the existing ordered-id API while validating scope, filters, source and membership", () => {
    const storage = memoryStorage()
    const ids = [snapshot.rowId, "90071992547409932"]
    writeRecordListContext("/accounting/invoices", ids, storage, 1000, snapshot)
    expect(readRecordListContext("/accounting/invoices", storage, 2000)).toEqual(ids)
    expect(readRecordListReturnContext("/accounting/invoices", { key: returnKey, recordId: ids[1], href: snapshot.href, filterKey: snapshot.filterKey }, storage, 2000)).toEqual(snapshot)
    for (const expected of [{ key: returnKey + "wrong" }, { key: returnKey, recordId: "missing" }, { key: returnKey, href: "/accounting?tab=invoices" }, { key: returnKey, filterKey: "changed" }]) {
      expect(readRecordListReturnContext("/accounting/invoices", expected, storage, 2000)).toBeUndefined()
    }
    expect(readRecordListReturnContext("/accounting/invoices", { key: returnKey }, storage, 1000 + RECORD_LIST_TTL_MS + 1)).toBeUndefined()
    expect(readRecordListReturnContext("/accounting/invoices", { key: returnKey }, storage, 999)).toBeUndefined()
  })

  it("rejects unsafe return paths, wrong tabs and malformed state without losing the ordered ids", () => {
    const storage = memoryStorage()
    const bad = [
      { href: "https://outside.test/accounting?tab=invoices" }, { href: "//outside.test/accounting?tab=invoices" },
      { href: "/accounting?tab=invoices#outside" }, { href: "/accounting?tab=bills" },
      { href: "/accounting?tab=invoices&next=https%3A%2F%2Foutside.test" }, { href: "/accounting?tab=invoices&tab=bills" },
      { href: "/other?tab=invoices" }, { rowId: "not-in-the-list" }, { page: -1 }, { page: 1.5 },
      { scrollTop: Infinity }, { scrollLeft: -1 }, { sorting: [{ id: "unknown-column", desc: false }] },
    ]
    for (const changed of bad) {
      writeRecordListContext("/accounting/invoices", [snapshot.rowId], storage, 1000, { ...snapshot, ...changed })
      expect(readRecordListReturnContext("/accounting/invoices", { key: returnKey }, storage, 1000)).toBeUndefined()
      expect(readRecordListContext("/accounting/invoices", storage, 1000)).toEqual([snapshot.rowId])
    }
    expect(accountingListReturnHref(snapshot.href, returnKey)).toBe(snapshot.href)
    expect(splitRecordHref("/accounting/invoices/%broken")).toBeUndefined()
  })

  it("carries the clicked list through Sheet Open and consumes only the optional return state", () => {
    const ids = [snapshot.rowId, "90071992547409932"]
    rememberRecordList(ids, snapshot)
    expect(commitRecordListFor(`/accounting/invoices/${snapshot.rowId}`)).toBe(true)
    expect(readRecordListReturnContext("/accounting/invoices", { key: returnKey, recordId: snapshot.rowId })).toEqual(snapshot)
    consumeRecordListReturnContext("/accounting/invoices", returnKey + "other")
    expect(readRecordListReturnContext("/accounting/invoices", { key: returnKey })).toEqual(snapshot)
    consumeRecordListReturnContext("/accounting/invoices", returnKey)
    expect(readRecordListReturnContext("/accounting/invoices", { key: returnKey })).toBeUndefined()
    expect(readRecordListContext("/accounting/invoices")).toEqual(ids)
    expect(commitRecordListFor("/accounting/invoices/missing")).toBe(false)
  })
})
