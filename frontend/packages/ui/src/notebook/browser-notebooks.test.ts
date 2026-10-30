import { beforeEach, describe, expect, it } from "vitest"
import type { Notebook } from "../lib/notebook-types"
import { browserWorkScope, deleteBrowserNotebook, importBrowserNotebook, notebookStorageKey, readBrowserNotebooks, saveBrowserNotebook } from "./browser-notebooks"

const session = { identity: "alice", connected: true, organizationId: 1, activeCompanyId: 2, companyIds: [2, 3], activeCompanyReady: true }
const scope = browserWorkScope(session)!
const now = new Date("2026-10-29T12:00:00Z")
const notebook: Notebook = { id: "notes-1", title: "Close", createdAt: now, updatedAt: now, metadata: {},
  cells: [{ id: "cell-1", type: "code", content: "df.head()", status: "success", createdAt: now, updatedAt: now,
    outputs: [{ id: "fake", type: "text", content: "Invented revenue", timestamp: now }] }] }

beforeEach(() => localStorage.clear())

describe("scoped browser notebooks", () => {
  it("requires complete authorized scope, and separates actors, companies and organizations", () => {
    expect(browserWorkScope({ ...session, activeCompanyReady: false })).toBeNull()
    expect(browserWorkScope({ ...session, activeCompanyId: 9 })).toBeNull()
    expect(browserWorkScope({ ...session, identity: null })).toBeNull()
    saveBrowserNotebook(localStorage, scope, notebook)
    for (const changed of [{ ...session, identity: "bob" }, { ...session, activeCompanyId: 3 }, { ...session, organizationId: 9 }])
      expect(readBrowserNotebooks(localStorage, browserWorkScope(changed)!)).toEqual({ activeId: null, notebooks: [] })
    expect(readBrowserNotebooks(localStorage, scope).notebooks[0].cells[0].content).toBe("df.head()")
  })

  it("revives saved dates and strips unexecuted outputs from saved and imported files", () => {
    saveBrowserNotebook(localStorage, scope, notebook)
    const restored = readBrowserNotebooks(localStorage, scope)
    expect(restored.activeId).toBe(notebook.id)
    expect(restored.notebooks[0].createdAt).toEqual(now)
    expect(restored.notebooks[0].cells[0].outputs).toEqual([])
    expect(restored.notebooks[0].cells[0].status).toBe("idle")
    expect(importBrowserNotebook(JSON.stringify(notebook)).cells[0].outputs).toEqual([])
  })

  it("preserves unreadable or mismatched storage rather than replacing it", () => {
    const key = notebookStorageKey(scope)
    for (const raw of ["bad json", JSON.stringify({ version: 2, scope, notebooks: [] }), JSON.stringify({ version: 1, scope: "other", notebooks: [], activeId: null })]) {
      localStorage.setItem(key, raw)
      expect(() => readBrowserNotebooks(localStorage, scope)).toThrow()
      expect(() => saveBrowserNotebook(localStorage, scope, notebook)).toThrow()
      expect(localStorage.getItem(key)).toBe(raw)
    }
  })

  it("rejects stale saves from another tab and deletes only the requested scoped copy", () => {
    const first = saveBrowserNotebook(localStorage, scope, notebook).notebooks[0]
    const changed = { ...first, title: "Changed in another tab" }
    saveBrowserNotebook(localStorage, scope, changed, first)
    expect(() => saveBrowserNotebook(localStorage, scope, { ...first, title: "Stale overwrite" }, first)).toThrow()
    expect(readBrowserNotebooks(localStorage, scope).notebooks[0].title).toBe(changed.title)
    saveBrowserNotebook(localStorage, scope, { ...notebook, id: "notes-2" })
    const remaining = deleteBrowserNotebook(localStorage, scope, "notes-2")
    expect(remaining.activeId).toBe(notebook.id)
    expect(remaining.notebooks.map((item) => item.id)).toEqual([notebook.id])
  })

  it("rejects malformed, duplicate or oversized cells and bounds the catalog without evicting saved work", () => {
    expect(() => importBrowserNotebook(JSON.stringify({ ...notebook, cells: [notebook.cells[0], notebook.cells[0]] }))).toThrow()
    expect(() => importBrowserNotebook(JSON.stringify({ ...notebook, cells: [{ ...notebook.cells[0], content: "x".repeat(100_001) }] }))).toThrow()
    for (let i = 0; i < 20; i++) saveBrowserNotebook(localStorage, scope, { ...notebook, id: `book-${i}` })
    expect(() => saveBrowserNotebook(localStorage, scope, notebook)).toThrow()
    expect(readBrowserNotebooks(localStorage, scope).notebooks).toHaveLength(20)
  })
})
