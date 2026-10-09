import { describe, expect, it } from "vitest"

import {
  buildSectionConflictView,
  readSectionConflictError,
  sectionDraftFromRow,
  sectionResolveParams,
  updateConflictDraft,
  type SectionConflict,
} from "./section-conflict"

const conflict: SectionConflict = {
  sectionId: "7",
  draft: { title: "Scope", content: "mine text", status: "draft", sequence: 10, aiSuggestion: null },
  expectedRevision: 2,
  foundRevision: 4,
}

describe("readSectionConflictError", () => {
  it("reads the typed conflict error", () => {
    const err = Object.assign(new Error("x"), {
      name: "ProposalSectionConflictError",
      expectedRevision: 2,
      foundRevision: 4,
    })
    expect(readSectionConflictError(err)).toEqual({ expectedRevision: 2, foundRevision: 4 })
  })

  it("ignores other errors", () => {
    expect(readSectionConflictError(new Error("Failed to upsert proposal section"))).toBeNull()
    expect(readSectionConflictError({ name: "ProposalSectionConflictError", expectedRevision: "2" })).toBeNull()
    expect(readSectionConflictError(null)).toBeNull()
    expect(readSectionConflictError("Section conflict: expected revision 2, found 4")).toBeNull()
  })
})

describe("buildSectionConflictView", () => {
  const server = { id: 7n, title: "Scope", content: "their text", status: "Complete", sequence: 10, revision: 4, aiSuggestion: undefined }

  it("lists only differing fields with both revisions", () => {
    const view = buildSectionConflictView(conflict, server)
    expect(view.fields).toEqual([
      { field: "content", mine: "mine text", theirs: "their text" },
      { field: "status", mine: "draft", theirs: "complete" },
    ])
    expect(view.mineRevision).toBe(2)
    expect(view.theirsRevision).toBe(4)
    expect(view.identical).toBe(false)
  })

  it("prefers the live revision over the reducer-reported one", () => {
    expect(buildSectionConflictView(conflict, { ...server, revision: 6 }).theirsRevision).toBe(6)
  })

  it("is identical when the server already matches the draft", () => {
    const view = buildSectionConflictView(conflict, { ...server, content: "mine text", status: "DRAFT" })
    expect(view.fields).toEqual([])
    expect(view.identical).toBe(true)
  })

  it("treats a missing server row as unknown, using the reported revision", () => {
    const view = buildSectionConflictView(conflict, null)
    expect(view.fields).toEqual([])
    expect(view.identical).toBe(false)
    expect(view.theirsRevision).toBe(4)
  })

  it("handles tagged status and sequence differences", () => {
    const view = buildSectionConflictView(conflict, { ...server, content: "mine text", status: { Draft: [] }, sequence: 20 })
    expect(view.fields).toEqual([{ field: "sequence", mine: "10", theirs: "20" }])
  })
})

describe("draft helpers", () => {
  it("reads a server row into a draft", () => {
    expect(sectionDraftFromRow({ title: "A", content: "B", status: "Reviewed", sequence: 30, aiSuggestion: "hint" })).toEqual({
      title: "A", content: "B", status: "reviewed", sequence: 30, aiSuggestion: "hint",
    })
  })

  it("builds resolve params from the draft", () => {
    expect(sectionResolveParams(1n, "7", conflict.draft)).toEqual({
      proposalId: 1n, sectionId: "7", title: "Scope", content: "mine text", status: "draft", sequence: 10, aiSuggestion: null,
    })
  })

  it("keeps the latest edits in the draft", () => {
    const next = updateConflictDraft(conflict, { content: "newer" })
    expect(next.draft.content).toBe("newer")
    expect(next.draft.title).toBe("Scope")
    expect(conflict.draft.content).toBe("mine text")
  })
})
