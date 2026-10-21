import * as React from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { DocumentTemplateDesigner } from "./document-template-designer"
import type { DocumentDesignerSnapshot } from "../lib/document-template-designer"

// jsdom does not implement the iframe layout required by the canvas. Keep the
// real GrapesJS model, parser, blocks and undo manager, and skip only rendering.
const { editors } = vi.hoisted(() => ({
  editors: [] as import("grapesjs").Editor[]
}))
vi.mock("grapesjs", async () => {
  const actual = await vi.importActual<typeof import("grapesjs")>("grapesjs")
  const init = actual.default.init.bind(actual.default)
  vi.spyOn(actual.default, "init").mockImplementation((config) => {
    const editor = init({ ...config, headless: true })
    editors.push(editor)
    queueMicrotask(() => {
      editor.getModel().set("ready", true)
      editor.getModel().loadTriggered = true
      editor.trigger("load", editor)
    })
    return editor
  })
  return actual
})

beforeAll(async () => {
  await import("grapesjs")
})

afterEach(() => {
  cleanup()
  editors.length = 0
})

describe("DocumentTemplateDesigner", () => {
  it("creates a table template with the real editor and reopens its saved project", async () => {
    const changed = vi.fn<(snapshot: DocumentDesignerSnapshot) => void>()
    const errors = vi.fn()
    const first = render(
      <DocumentTemplateDesigner
        kind="rich-text"
        onChange={changed}
        onError={errors}
      />
    )
    await waitFor(() => expect(changed).toHaveBeenCalled())
    fireEvent.click(screen.getByRole("button", { name: "Table" }))
    await waitFor(() =>
      expect(changed.mock.lastCall?.[0].bodyHtml).toContain("<table>")
    )
    const saved = changed.mock.lastCall![0]
    expect(saved.bodyHtml).toContain("<th><p>Item</p></th>")
    expect(saved.bodyHtml).toContain("<td><p>Second item</p></td>")
    expect(saved.designer.project.styles).toEqual([])
    first.unmount()

    const reopened = vi.fn<(snapshot: DocumentDesignerSnapshot) => void>()
    render(
      <DocumentTemplateDesigner
        kind="rich-text"
        initialDesigner={saved.designer}
        onChange={reopened}
        onError={errors}
      />
    )
    await waitFor(() => expect(reopened).toHaveBeenCalled())
    expect(reopened.mock.lastCall![0].bodyHtml).toBe(saved.bodyHtml)
    expect(errors).not.toHaveBeenCalled()
  })

  it("preserves document layout and style controls in the compiled snapshot", async () => {
    const changed = vi.fn<(snapshot: DocumentDesignerSnapshot) => void>()
    const errors = vi.fn()
    render(
      <DocumentTemplateDesigner
        kind="document"
        onChange={changed}
        onError={errors}
      />
    )
    await waitFor(() => expect(changed).toHaveBeenCalled())
    fireEvent.click(screen.getByRole("button", { name: "Two columns" }))
    await waitFor(() =>
      expect(changed.mock.lastCall?.[0].bodyHtml).toContain("Left column")
    )
    expect(changed.mock.lastCall![0].bodyHtml).toContain("width:50%")
    fireEvent.change(screen.getByLabelText("Text color"), {
      target: { value: "#172554" }
    })
    fireEvent.change(screen.getByLabelText("Text size"), {
      target: { value: "24px" }
    })
    await waitFor(() =>
      expect(changed.mock.lastCall?.[0].bodyHtml).toContain("font-size:24px")
    )
    expect(changed.mock.lastCall![0].bodyHtml).toContain("color:#172554")
    expect(changed.mock.lastCall![0].designer.project.styles).toEqual([])
    expect(errors).not.toHaveBeenCalled()
  })

  it("captures unsynced text inside a table without mutating the live editor", async () => {
    const changed = vi.fn<(snapshot: DocumentDesignerSnapshot) => void>()
    render(<DocumentTemplateDesigner kind="rich-text" onChange={changed} />)
    await waitFor(() => expect(changed).toHaveBeenCalled())
    fireEvent.click(screen.getByRole("button", { name: "Table" }))
    await waitFor(() =>
      expect(changed.mock.lastCall?.[0].bodyHtml).toContain("<table>")
    )
    const editor = editors[0]!
    const text = editor.getWrapper()!.findType("table")[0]!.findType("text")[0]!
    const original = JSON.stringify(text.toJSON())
    const pageId = editor.Pages.getSelected()!.getId()
    const frameId = editor.Pages.getSelected()!.getMainFrame().get("id")
    const element = document.createElement("p")
    element.innerHTML = "<strong>Latest item</strong><br>Second line"
    vi.spyOn(editor, "getEditing").mockReturnValue(text)
    vi.spyOn(text, "getEl").mockReturnValue(element)

    act(() => {
      editor.trigger("component:input", text)
    })

    const saved = changed.mock.lastCall![0]
    expect(saved.bodyHtml).toContain(
      "<th><p><strong>Latest item</strong><br>Second line</p></th>"
    )
    expect(saved.designer.project.pages[0]?.id).toBe(pageId)
    expect(saved.designer.project.pages[0]?.frames[0]?.id).toBe(frameId)
    expect(JSON.stringify(text.toJSON())).toBe(original)
    expect(element.innerHTML).toBe(
      "<strong>Latest item</strong><br>Second line"
    )
  })

  it("filters the block library and changes zoom without changing saved content", async () => {
    const changed = vi.fn<(snapshot: DocumentDesignerSnapshot) => void>()
    render(<DocumentTemplateDesigner kind="document" onChange={changed} />)
    await waitFor(() => expect(changed).toHaveBeenCalled())
    const original = changed.mock.lastCall![0]

    fireEvent.change(screen.getByRole("searchbox", { name: "Search blocks" }), {
      target: { value: "table" }
    })
    expect(
      screen.getByRole("button", { name: "Table", exact: true })
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Paragraph", exact: true })
    ).toBeNull()
    fireEvent.change(screen.getByRole("searchbox", { name: "Search blocks" }), {
      target: { value: "missing" }
    })
    expect(screen.getByText("No matching blocks")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Show all blocks" }))
    fireEvent.click(screen.getByRole("button", { name: "Text", exact: true }))
    expect(
      screen.getByRole("button", { name: "Heading", exact: true })
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Table", exact: true })
    ).toBeNull()

    fireEvent.change(screen.getByRole("combobox", { name: "Canvas zoom" }), {
      target: { value: "50" }
    })
    expect(editors[0]!.Canvas.getZoom()).toBe(50)
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }))
    expect(editors[0]!.Canvas.getZoom()).toBe(60)
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }))
    expect(editors[0]!.Canvas.getZoom()).toBe(50)
    expect(changed.mock.lastCall![0]).toEqual(original)
  })

  it("does not allow disabled controls to mutate the template", async () => {
    const changed = vi.fn<(snapshot: DocumentDesignerSnapshot) => void>()
    const view = render(
      <DocumentTemplateDesigner kind="rich-text" onChange={changed} />
    )
    await waitFor(() => expect(changed).toHaveBeenCalled())
    view.rerender(
      <DocumentTemplateDesigner kind="rich-text" onChange={changed} disabled />
    )
    changed.mockClear()
    const add = screen.getByRole("button", {
      name: "Paragraph"
    }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    fireEvent.click(add)
    expect(changed).not.toHaveBeenCalled()
    expect(view.container.querySelector("[inert]")).not.toBeNull()
    expect(screen.queryByRole("button", { name: "Two columns" })).toBeNull()
  })

  it("destroys the single live editor under the React StrictMode mount cycle", async () => {
    const changed = vi.fn()
    const view = render(
      <React.StrictMode>
        <DocumentTemplateDesigner kind="rich-text" onChange={changed} />
      </React.StrictMode>
    )
    await waitFor(() => expect(changed).toHaveBeenCalled())
    expect(editors).toHaveLength(1)
    const destroy = vi.spyOn(editors[0]!, "destroy")
    view.unmount()
    expect(destroy).toHaveBeenCalledOnce()
  })
})
