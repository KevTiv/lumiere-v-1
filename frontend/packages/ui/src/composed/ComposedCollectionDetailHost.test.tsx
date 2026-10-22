import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { PreviewResponse } from "@lumiere/presentation-core/preview-contract"
import { ComposedCollectionDetailHost } from "./ComposedCollectionDetailHost"
import { workspaceStyles } from "../lib/workspace-styles"

const preview = {
  definition: {
    schemaVersion: 1,
    moduleId: "collections",
    title: "Collections",
    baseRevision: null,
    applicationContract: "contracts-v1",
    componentCatalogVersion: 1,
    pages: [{ id: "home", title: "Home", nodes: [
      { kind: "collection", id: "receivables", slot: "primary", component: { id: "collection", version: 1 }, resource: "receivables", fields: ["reference", "amount"], pageSize: 25 },
      { kind: "detail", id: "receivable-detail", slot: "secondary", component: { id: "detail", version: 1 }, sourceNodeId: "receivables", fields: ["reference", "amount"] },
    ] }],
  },
  collections: [{ pageId: "home", nodeId: "receivables", rows: [{ id: "r1", fields: [{ field: "reference", value: "SO-1" }, { field: "amount", value: "$20" }] }], truncated: true }],
} satisfies PreviewResponse

describe("ComposedCollectionDetailHost", () => {
  afterEach(() => cleanup())

  it("renders supplied rows and opens linked detail on selection", async () => {
    render(<ComposedCollectionDetailHost preview={preview} />)
    expect(screen.getByText("SO-1")).toBeTruthy()
    expect(screen.getByText("Select a record to inspect it.")).toBeTruthy()
    fireEvent.click(screen.getByTestId("composed-row-receivables-r1"))
    expect(screen.getAllByTestId("composed-detail-value-receivable-detail-reference")[0]?.textContent).toContain("SO-1")
    expect(screen.getByTestId("composed-detail-value-receivable-detail-amount").textContent).toContain("$20")
  })

  it("shows an explicit bounded-sample notice", () => {
    render(<ComposedCollectionDetailHost preview={preview} />)
    expect(screen.getByTestId("composed-truncated-receivables").textContent).toContain("Preview limit reached")
  })

  it("styles persisted collection/detail nodes through the shared renderer roles", () => {
    const definitionBeforeRender = JSON.stringify(preview.definition)
    render(<ComposedCollectionDetailHost preview={preview} />)
    for (const id of ["composed-collection-receivables", "composed-detail-receivable-detail"]) {
      const card = screen.getByTestId(id)
      for (const token of workspaceStyles.surface.split(" ")) expect(card.classList.contains(token)).toBe(true)
      const title = card.querySelector('[data-slot="card-title"]')!
      for (const token of workspaceStyles.sectionTitle.split(" ")) expect(title.classList.contains(token)).toBe(true)
    }
    expect(screen.getByRole("table").closest('[data-slot="table-container"]')?.classList.contains("overflow-x-auto")).toBe(true)
    expect(JSON.stringify(preview.definition)).toBe(definitionBeforeRender)
    fireEvent.keyDown(screen.getByTestId("composed-row-receivables-r1"), { key: "Enter" })
    expect(screen.getByTestId("composed-detail-value-receivable-detail-reference").textContent).toBe("SO-1")
  })

  it.each([
    [{ loading: true }, "composed-loading"],
    [{ error: "Preview failed" }, "composed-error"],
  ])("shows transient state without stale preview content", (props, testId) => {
    render(<ComposedCollectionDetailHost preview={preview} {...props} />)
    expect(screen.getByTestId(testId)).toBeTruthy()
    expect(screen.queryByText("SO-1")).toBeNull()
  })

  it("fails closed for missing collection data and resets page-local selection", () => {
    const secondPage = { ...preview.definition.pages[0], id: "archive" }
    const secondCollection = { ...preview.collections[0], pageId: "archive" }
    const multiPage = { ...preview, definition: { ...preview.definition, pages: [...preview.definition.pages, secondPage] }, collections: [...preview.collections, secondCollection] }
    const { rerender } = render(<ComposedCollectionDetailHost preview={multiPage} />)
    fireEvent.click(screen.getAllByTestId("composed-row-receivables-r1")[0])
    expect(screen.getAllByTestId("composed-detail-value-receivable-detail-reference")[0]?.textContent).toContain("SO-1")
    rerender(<ComposedCollectionDetailHost preview={{ ...preview, collections: [] }} />)
    expect(screen.getByTestId("composed-unavailable-receivables")).toBeTruthy()
    expect(screen.getByText("Select a record to inspect it.")).toBeTruthy()
  })
})
