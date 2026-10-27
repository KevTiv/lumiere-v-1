import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import type { NotebookCell } from "../lib/notebook-types"

vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))
vi.mock("@/components/ui/scroll-area", () => ({ ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock("./notebook-cell", () => ({
  NotebookCellComponent: ({ cell, index, onUpdate }: { cell: NotebookCell; index: number; onUpdate: (next: NotebookCell) => void }) => (
    <textarea aria-label={`Notebook cell ${index + 1}`} value={cell.content} onChange={(event) => onUpdate({ ...cell, content: event.target.value })} />
  ),
}))
import { NotebookPanel } from "./notebook-panel"

beforeEach(() => window.localStorage.clear())
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe("Notebook browser save feedback", () => {
  it("retains edited cells and reports a failed browser write without a saved claim", () => {
    // jsdom Storage methods live on its prototype; spying on the proxy misses writes.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota exceeded") })
    render(<NotebookPanel open onClose={vi.fn()} />)
    expect(screen.getByTestId("notebook-save-status").textContent).toBe("Not saved")
    fireEvent.change(screen.getByRole("textbox", { name: "Notebook cell 1" }), { target: { value: "Retained notes" } })
    fireEvent.click(screen.getByRole("button", { name: "Save notebook in this browser" }))
    expect(screen.getByRole("alert").textContent).toContain("Export a copy")
    expect(screen.getByTestId("notebook-save-status").textContent).toBe("Save failed")
    expect((screen.getByRole("textbox", { name: "Notebook cell 1" }) as HTMLTextAreaElement).value).toBe("Retained notes")
    expect(screen.queryByText("Saved in this browser")).toBeNull()
    expect(screen.getByText("Local preview")).toBeTruthy()
  })

  it("reports the actual local snapshot and marks later edits unsaved", () => {
    const save = vi.spyOn(Storage.prototype, "setItem")
    render(<NotebookPanel open onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole("textbox", { name: "Notebook cell 1" }), { target: { value: "Saved notes" } })
    fireEvent.click(screen.getByRole("button", { name: "Save notebook in this browser" }))
    const writes = save.mock.calls.filter(([key]) => String(key).startsWith("lumiere.notebook."))
    expect(writes).toHaveLength(1)
    expect(JSON.parse(String(writes[0]![1])).cells[0].content).toBe("Saved notes")
    expect(window.localStorage.getItem(String(writes[0]![0]))).toBe(writes[0]![1])
    expect(screen.getByTestId("notebook-save-status").textContent).toBe("Saved in this browser")
    fireEvent.change(screen.getByRole("textbox", { name: "Notebook cell 1" }), { target: { value: "New unsaved notes" } })
    expect(screen.getByTestId("notebook-save-status").textContent).toBe("Unsaved changes")
    expect(save.mock.calls.filter(([key]) => String(key).startsWith("lumiere.notebook."))).toHaveLength(1)
  })
})
