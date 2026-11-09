import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FileIdentity } from "./file-identity"

afterEach(cleanup)

describe("FileIdentity", () => {
  it("reveals the exact original for files sharing a title without opening either file", async () => {
    const prefix =
      "Compte-rendu de la réconciliation fournisseur — septembre 2026"
    const pdf = `${prefix} (signed).PDF`
    const csv = `${prefix} (export).csv`
    const onOpen = vi.fn()
    render(
      <>
        <FileIdentity
          variant="card"
          title="Reconciliation"
          fileName={pdf}
          size={1536}
          onOpen={() => onOpen("signed")}
        />
        <FileIdentity
          variant="card"
          title="Reconciliation"
          fileName={csv}
          size={0}
          onOpen={() => onOpen("export")}
        />
      </>,
    )

    const reveal = screen.getByRole("button", {
      name: `Show original filename: ${pdf}`,
    })
    expect(reveal.textContent).toBe(pdf)
    fireEvent.click(reveal)
    const popover = await screen.findByRole("dialog", {
      name: "Original filename",
    })
    expect(within(popover).getByText(pdf)).toBeTruthy()
    expect(within(popover).getByText("Reconciliation")).toBeTruthy()
    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.getByText("PDF · 1.5 KB")).toBeTruthy()
    expect(screen.getByText("Spreadsheet · 0 B")).toBeTruthy()
  })

  it("uses a neutral label for an unknown MIME type and omits unknown size", () => {
    render(
      <FileIdentity
        fileName="source.unknown"
        mimetype="application/x-private"
        status="Indexing failed"
      />,
    )
    expect(screen.getByText("File · Indexing failed")).toBeTruthy()
    expect(screen.queryByText("application/x-private")).toBeNull()
  })
})
