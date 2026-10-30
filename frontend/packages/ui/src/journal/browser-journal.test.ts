import { beforeEach, describe, expect, it } from "vitest"
import type { WorkNote } from "../lib/journal-types"
import { journalStorageKey, readBrowserJournal, writeBrowserJournal } from "./browser-journal"

const note: WorkNote = { id: "note-1", userId: "alice", type: "observation", content: "Check the supplier credit", priority: "normal", status: "active", tags: [], mentions: [], createdAt: "2026-10-29T12:00:00Z", updatedAt: "2026-10-29T12:00:00Z" }
beforeEach(() => localStorage.clear())

describe("browser working notes", () => {
  it("reopens saved notes only for the matching scope", () => {
    writeBrowserJournal(localStorage, "org:company:alice", [note])
    expect(readBrowserJournal(localStorage, "org:company:alice")).toEqual([note])
    expect(readBrowserJournal(localStorage, "org:company:bob")).toEqual([])
    expect(readBrowserJournal(localStorage, "org:other:alice")).toEqual([])
  })
  it("retains corrupt storage and rejects malformed note contents", () => {
    const key = journalStorageKey("scope")
    localStorage.setItem(key, "broken")
    expect(() => writeBrowserJournal(localStorage, "scope", [note])).toThrow()
    expect(localStorage.getItem(key)).toBe("broken")
    localStorage.removeItem(key)
    expect(() => writeBrowserJournal(localStorage, "scope", [{ ...note, content: "x".repeat(20_001) }])).toThrow()
    expect(localStorage.getItem(key)).toBeNull()
  })
  it("does not overwrite notes changed in another tab", () => {
    writeBrowserJournal(localStorage, "scope", [note])
    const snapshot = readBrowserJournal(localStorage, "scope")
    writeBrowserJournal(localStorage, "scope", [{ ...note, content: "Changed elsewhere" }], snapshot)
    expect(() => writeBrowserJournal(localStorage, "scope", [{ ...note, content: "Stale edit" }], snapshot)).toThrow()
    expect(readBrowserJournal(localStorage, "scope")[0].content).toBe("Changed elsewhere")
  })
})
