import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { EntityDetailConfig, EntityInlineEdit, EntityRow } from "../lib/entity-view-types"
import type { WorkflowToastNotice } from "../lib/workflow-toast"
import { RBACProvider } from "../lib/rbac-context"
import { EntityDetail } from "./entity-detail"

const toast = vi.hoisted(() => vi.fn<(notice: WorkflowToastNotice) => void>())
vi.mock("../lib/workflow-toast", () => ({ showWorkflowToast: toast }))
vi.mock("../components/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
// Stand-in for the Tiptap read-only render, so the test can see which value it was given.
vi.mock("../components/markdown-view", () => ({
  MarkdownView: ({ value }: { value: string }) => <div data-testid="markdown-view">{value}</div>,
}))

const record = { id: "7", name: "Alpha deal", notes: "First line", state: "draft" }

type Save = EntityInlineEdit["save"]

function setup(fields: Partial<Record<"name" | "notes", Partial<EntityInlineEdit>>>, save: Save, data: EntityRow = record) {
  const config: EntityDetailConfig = {
    mode: "detail",
    sections: [
      {
        id: "main",
        fields: [
          { key: "id", label: "ID" },
          { key: "name", label: "Name", inlineEdit: fields.name ? { kind: "text", save, ...fields.name } : undefined },
          { key: "notes", label: "Notes", inlineEdit: fields.notes ? { kind: "textarea", save, ...fields.notes } : undefined },
        ],
      },
    ],
  }
  render(
    <RBACProvider>
      <EntityDetail config={config} data={data} />
    </RBACProvider>,
  )
}

function lastToast(): WorkflowToastNotice {
  const notice = toast.mock.calls.at(-1)?.[0]
  if (!notice) throw new Error("no toast shown")
  return notice
}

describe("EntityDetail click-to-edit", () => {
  afterEach(() => {
    cleanup()
    toast.mockReset()
  })

  it("is keyboard reachable and opens on click, Enter or Space", () => {
    setup({ name: {} }, vi.fn())
    const trigger = screen.getByRole("button", { name: "Edit Name" })
    expect(trigger.getAttribute("tabindex")).toBe("0")
    fireEvent.click(trigger)
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Alpha deal")
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" })
    fireEvent.keyDown(screen.getByRole("button", { name: "Edit Name" }), { key: "Enter" })
    expect(screen.getByLabelText("Name")).toBeTruthy()
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" })
    fireEvent.keyDown(screen.getByRole("button", { name: "Edit Name" }), { key: " " })
    expect(screen.getByLabelText("Name")).toBeTruthy()
  })

  it("saves on Enter, shows the new value and offers Undo", async () => {
    const save = vi.fn<Save>().mockResolvedValue(undefined)
    setup({ name: {} }, save)
    fireEvent.click(screen.getByRole("button", { name: "Edit Name" }))
    const input = screen.getByLabelText("Name")
    fireEvent.change(input, { target: { value: "Beta deal" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: "7" }), "Beta deal"))
    await waitFor(() => expect(screen.getByText("Beta deal")).toBeTruthy())
    const notice = lastToast()
    expect(notice.kind).toBe("success")
    expect(notice.action?.label).toBe("Undo")

    notice.action?.onClick()
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ id: "7" }), "Alpha deal"))
    await waitFor(() => expect(screen.getByText("Alpha deal")).toBeTruthy())
  })

  it("cancels on Escape without saving", () => {
    const save = vi.fn<Save>()
    setup({ name: {} }, save)
    fireEvent.click(screen.getByRole("button", { name: "Edit Name" }))
    const input = screen.getByLabelText("Name")
    fireEvent.change(input, { target: { value: "Changed" } })
    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.queryByLabelText("Name")).toBeNull()
    expect(screen.getByText("Alpha deal")).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
  })

  it("keeps plain Enter for a newline in a textarea and saves on Cmd/Ctrl+Enter", async () => {
    const save = vi.fn<Save>().mockResolvedValue(undefined)
    setup({ notes: {} }, save)
    fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }))
    const area = screen.getByLabelText("Notes")
    expect(area.tagName).toBe("TEXTAREA")
    fireEvent.change(area, { target: { value: "First line\nSecond line" } })
    fireEvent.keyDown(area, { key: "Enter" })
    expect(save).not.toHaveBeenCalled()
    expect(screen.getByLabelText("Notes")).toBeTruthy()

    fireEvent.keyDown(area, { key: "Enter", ctrlKey: true })
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: "7" }), "First line\nSecond line"),
    )
    expect(save).toHaveBeenCalledTimes(1)
  })

  it("saves a textarea once when focus leaves it", async () => {
    const save = vi.fn<Save>().mockResolvedValue(undefined)
    setup({ notes: {} }, save)
    fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }))
    const area = screen.getByLabelText("Notes")
    fireEvent.change(area, { target: { value: "Rewritten" } })
    // Focus really leaves (and the rich editor reports a second blur): one save.
    act(() => area.blur())
    fireEvent.blur(area)
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.anything(), "Rewritten"))
    expect(save).toHaveBeenCalledTimes(1)
  })

  it("reports a rejected save and keeps the old value", async () => {
    const save = vi.fn<Save>().mockRejectedValue(new Error("refused"))
    setup({ name: {} }, save)
    fireEvent.click(screen.getByRole("button", { name: "Edit Name" }))
    const input = screen.getByLabelText("Name")
    fireEvent.change(input, { target: { value: "Gamma" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(lastToast()).toEqual(expect.objectContaining({ kind: "error", description: "refused" })))
    expect(screen.getByText("Alpha deal")).toBeTruthy()
  })

  it("is read-only when canEdit rejects the record", () => {
    setup({ name: { canEdit: (row) => row.state === "done" } }, vi.fn())
    expect(screen.queryByRole("button", { name: "Edit Name" })).toBeNull()
    expect(screen.getByText("Alpha deal")).toBeTruthy()
    fireEvent.click(screen.getByText("Alpha deal"))
    expect(screen.queryByLabelText("Name")).toBeNull()
  })

  it("shows a markdown field rendered and edits its source", () => {
    setup({ notes: { kind: "markdown" } }, vi.fn(), { ...record, notes: "**Bold** note" })
    expect(screen.getByTestId("markdown-view").textContent).toBe("**Bold** note")
    fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }))
    expect(screen.getByTestId("entity-detail-editor-notes")).toBeTruthy()
  })
})
