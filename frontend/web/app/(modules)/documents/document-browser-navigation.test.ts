import assert from "node:assert/strict"
import { test } from "node:test"
import { documentBrowserHref, documentBrowserRecordHref, documentBrowserReturnHref, documentBrowserState } from "./document-browser-navigation"

test("returns from an exact file to its folder, search, layout and selected row", () => {
  const state = { folderId: "9007199254740993", search: "Vendor & invoices", layout: "list" as const }
  const record = new URL(documentBrowserRecordHref("18446744073709551615", state), "https://lumiere.invalid")
  assert.equal(record.pathname, "/documents/18446744073709551615")
  const href = documentBrowserReturnHref(record.searchParams.get("returnTo"))
  assert.deepEqual(documentBrowserState(new URL(href, record).searchParams), { ...state, selectedFileId: "18446744073709551615" })
})

test("does not allow external, non-module or malformed return destinations", () => {
  const fallback = documentBrowserHref(documentBrowserState(new URLSearchParams()))
  for (const value of ["https://evil.example/documents?folder=3", "//evil.example/documents", "/accounting", "/documents/5", "javascript:alert(1)", null]) {
    assert.equal(documentBrowserReturnHref(value), fallback)
  }
  assert.equal(documentBrowserReturnHref("/documents?folder=5&fileSearch=budget&next=https://evil.example&tab=admin"), "/documents?tab=documents&folder=5&fileSearch=budget&fileLayout=grid")
})

test("rejects invalid IDs and bounds search without coercing large identifiers", () => {
  assert.deepEqual(documentBrowserState(new URLSearchParams("folder=18446744073709551616&file=-2&fileLayout=bad")), { folderId: null, selectedFileId: null, search: "", layout: "grid" })
  assert.equal(documentBrowserState(new URLSearchParams({ fileSearch: "x".repeat(900) })).search.length, 500)
})

test("changing browser state and returning from a record retain company and every explicit filter", () => {
  const query = "companyId=9007199254740993&company=finance&filter=isShared:true&filter=id:8&view=compact&folder=4&fileSearch=old&file=9&unknown=keep-on-same-page"
  const state = { folderId: null, search: "new", layout: "list" as const }
  const href = new URL(documentBrowserHref(state, query), "https://lumiere.invalid")
  assert.equal(href.searchParams.get("companyId"), "9007199254740993")
  assert.deepEqual(href.searchParams.getAll("filter"), ["isShared:true", "id:8"])
  assert.equal(href.searchParams.get("unknown"), "keep-on-same-page")
  assert.equal(href.searchParams.get("folder"), null)
  assert.equal(href.searchParams.get("file"), null)
  assert.equal(href.searchParams.get("fileSearch"), "new")

  const record = new URL(documentBrowserRecordHref("8", state, query), href)
  const restored = new URL(documentBrowserReturnHref(record.searchParams.get("returnTo")), href)
  assert.equal(restored.searchParams.get("companyId"), "9007199254740993")
  assert.equal(restored.searchParams.get("company"), "finance")
  assert.deepEqual(restored.searchParams.getAll("filter"), ["isShared:true", "id:8"])
  assert.equal(restored.searchParams.get("view"), "compact")
  assert.equal(restored.searchParams.get("file"), "8")
  assert.equal(restored.searchParams.get("unknown"), null)
})
