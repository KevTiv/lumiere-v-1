import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { EntityTableConfig } from "../lib/entity-view-types"
import { RBACProvider } from "../lib/rbac-context"
import { EntityTable } from "./entity-table"

const toast = vi.hoisted(() => vi.fn())
vi.mock("../lib/workflow-toast", () => ({ showWorkflowToast: toast }))
vi.mock("../components/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

const rows = [
  { id: "1", name: "Alpha", qty: 3, state: "draft" },
  { id: "2", name: "Beta", qty: 4, state: "done" },
]

function setup(save: (row: Record<string, unknown>, value: string | number) => Promise<unknown>) {
  const config: EntityTableConfig = {
    mode: "table",
    rowKey: "id",
    columns: [
      { key: "id", label: "ID" },
      {
        key: "name",
        label: "Name",
        inlineEdit: { kind: "text", canEdit: (row) => row.state === "draft", save },
      },
      { key: "qty", label: "Qty", inlineEdit: { kind: "number", save } },
    ],
  }
  render(
    <RBACProvider>
      <EntityTable config={config} data={rows} />
    </RBACProvider>,
  )
}

describe("EntityTable inline edit", () => {
  afterEach(() => {
    cleanup()
    toast.mockReset()
  })

  it("saves a changed value on Enter", async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    setup(save)
    fireEvent.doubleClick(screen.getAllByTestId("entity-inline-qty")[0]!)
    const input = screen.getByLabelText("Qty")
    fireEvent.change(input, { target: { value: "9" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: "2" }), 9))
  })

  it("cancels on Escape and skips an unchanged value", async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    setup(save)
    fireEvent.doubleClick(screen.getAllByTestId("entity-inline-qty")[0]!)
    let input = screen.getByLabelText("Qty")
    fireEvent.change(input, { target: { value: "9" } })
    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.queryByLabelText("Qty")).toBeNull()

    fireEvent.doubleClick(screen.getAllByTestId("entity-inline-qty")[0]!)
    input = screen.getByLabelText("Qty")
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(screen.queryByLabelText("Qty")).toBeNull())
    expect(save).not.toHaveBeenCalled()
  })

  it("flags an invalid number and sends nothing", () => {
    const save = vi.fn()
    setup(save)
    fireEvent.doubleClick(screen.getAllByTestId("entity-inline-qty")[0]!)
    const input = screen.getByLabelText("Qty")
    fireEvent.change(input, { target: { value: "" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(screen.getByRole("alert").textContent).toMatch(/number/i)
    expect(save).not.toHaveBeenCalled()
  })

  it("reports a rejected save and keeps the old value", async () => {
    const save = vi.fn().mockRejectedValue(new Error("refused"))
    setup(save)
    fireEvent.doubleClick(screen.getAllByTestId("entity-inline-qty")[0]!)
    const input = screen.getByLabelText("Qty")
    fireEvent.change(input, { target: { value: "7" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: "error", description: "refused" })),
    )
    expect(screen.getByText("4")).toBeTruthy()
  })

  it("only edits rows its canEdit allows", () => {
    setup(vi.fn())
    expect(screen.getAllByTestId("entity-inline-name")).toHaveLength(1)
  })
})
