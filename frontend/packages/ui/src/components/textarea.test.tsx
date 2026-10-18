import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { Editor } from "@tiptap/react"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Textarea } from "./textarea"

afterEach(cleanup)

type EditorElement = HTMLElement & { editor?: Editor }

async function getEditor(label: string): Promise<Editor> {
  const surface = (await screen.findByRole("textbox", { name: label })) as EditorElement
  const editor = surface.editor
  if (!editor) throw new Error("Tiptap editor not mounted")
  return editor
}

function ControlledTextarea({
  initialValue = "",
  onValue,
}: {
  initialValue?: string
  onValue?: (value: string) => void
}) {
  const [value, setValue] = React.useState(initialValue)

  return (
    <Textarea
      aria-label="Description"
      name="description"
      value={value}
      onChange={(event) => {
        setValue(event.target.value)
        onValue?.(event.target.value)
      }}
    />
  )
}

describe("Textarea", () => {
  it("keeps the native textarea contract behind the rich text editor", async () => {
    const ref = React.createRef<HTMLTextAreaElement>()

    const { container } = render(
      <form>
        <Textarea
          ref={ref}
          name="description"
          aria-label="Description"
          defaultValue="Existing content"
          required
        />
      </form>
    )

    await getEditor("Description")
    expect(screen.getByRole("toolbar", { name: "Text formatting" })).toBeTruthy()
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement
    expect(ref.current).toBe(textarea)
    expect(textarea.name).toBe("description")
    expect(textarea.required).toBe(true)
    expect(textarea.value).toBe("Existing content")
    const form = container.querySelector("form") as HTMLFormElement
    expect(new FormData(form).get("description")).toBe("Existing content")
  })

  it("renders stored Markdown as formatted content", async () => {
    render(<ControlledTextarea initialValue={"**Make** this _clear_\n\n- one\n- two"} />)

    const editor = await getEditor("Description")
    const dom = editor.view.dom
    expect(dom.querySelector("strong")?.textContent).toBe("Make")
    expect(dom.querySelector("em")?.textContent).toBe("clear")
    expect(dom.querySelectorAll("ul > li")).toHaveLength(2)
  })

  it("emits Markdown through onChange when formatting is applied", async () => {
    const onValue = vi.fn()
    render(<ControlledTextarea initialValue="Make this clear" onValue={onValue} />)

    const editor = await getEditor("Description")
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 5 })
    })
    fireEvent.click(screen.getByRole("button", { name: "Bold" }))

    await waitFor(() => expect(onValue).toHaveBeenLastCalledWith("**Make** this clear"))
  })

  it("formats lines as a numbered list", async () => {
    const onValue = vi.fn()
    render(<ControlledTextarea initialValue="First" onValue={onValue} />)

    await getEditor("Description")
    fireEvent.click(screen.getByRole("button", { name: "Numbered list" }))

    await waitFor(() => expect(onValue).toHaveBeenLastCalledWith("1. First"))
  })

  it("syncs external value changes into the editor", async () => {
    function Harness() {
      const [value, setValue] = React.useState("Draft")
      return (
        <>
          <Textarea aria-label="Description" value={value} onChange={(event) => setValue(event.target.value)} />
          <button type="button" onClick={() => setValue("## Reset")}>
            reset
          </button>
        </>
      )
    }
    render(<Harness />)

    const editor = await getEditor("Description")
    fireEvent.click(screen.getByRole("button", { name: "reset" }))

    await waitFor(() => expect(editor.view.dom.querySelector("h2")?.textContent).toBe("Reset"))
  })

  it("disables formatting when the field cannot be edited", async () => {
    const onChange = vi.fn()
    render(<Textarea aria-label="Description" value="Locked" disabled onChange={onChange} />)

    const editor = await getEditor("Description")
    expect(editor.isEditable).toBe(false)
    const boldButton = screen.getByRole("button", { name: "Bold" }) as HTMLButtonElement
    expect(boldButton.disabled).toBe(true)
    fireEvent.click(boldButton)
    expect(onChange).not.toHaveBeenCalled()
  })

  it("hides the toolbar for read-only content", async () => {
    render(<Textarea aria-label="Description" value="Read me" readOnly />)

    const editor = await getEditor("Description")
    expect(editor.isEditable).toBe(false)
    expect(screen.queryByRole("toolbar")).toBeNull()
  })

  it("renders a bare native textarea for the plain variant", () => {
    render(<Textarea variant="plain" aria-label="Body HTML" defaultValue="<p>Hi</p>" />)

    const textarea = screen.getByLabelText("Body HTML") as HTMLTextAreaElement
    expect(textarea.tagName).toBe("TEXTAREA")
    expect(textarea.value).toBe("<p>Hi</p>")
    expect(screen.queryByRole("toolbar")).toBeNull()
  })
})
