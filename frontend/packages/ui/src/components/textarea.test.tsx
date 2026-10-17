import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Textarea } from "./textarea"

afterEach(cleanup)

function ControlledTextarea({ initialValue = "" }: { initialValue?: string }) {
  const [value, setValue] = React.useState(initialValue)

  return (
    <Textarea
      aria-label="Description"
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  )
}

function nativeTextarea() {
  return document.querySelector("textarea") as HTMLTextAreaElement
}

function editor() {
  return screen.getByRole("textbox", { name: "Description" }) as HTMLDivElement
}

function selectText(element: HTMLElement, text: string) {
  element.focus()
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node && !node.textContent?.includes(text)) node = walker.nextNode()
  if (!node?.textContent) throw new Error(`Could not find text: ${text}`)

  const start = node.textContent.indexOf(text)
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, start + text.length)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

describe("Textarea", () => {
  it("keeps the native textarea API as its form bridge", () => {
    const ref = React.createRef<HTMLTextAreaElement>()

    render(
      <Textarea
        ref={ref}
        name="description"
        aria-label="Description"
        defaultValue="Existing content"
        required
      />
    )

    const textarea = nativeTextarea()
    expect(screen.getByRole("toolbar", { name: "Text formatting" })).toBeTruthy()
    expect(textarea.name).toBe("description")
    expect(textarea.required).toBe(true)
    expect(textarea.value).toBe("Existing content")
    expect(ref.current).toBe(textarea)
    expect(editor().textContent).toBe("Existing content")
  })

  it("redirects an external label to the named rich-text surface", () => {
    render(
      <>
        <label htmlFor="description">Description</label>
        <Textarea id="description" defaultValue="Visible value" />
      </>
    )

    const formField = screen.getByLabelText("Description")
    const labeledEditor = screen.getByRole("textbox", {
      name: "Description rich text editor",
    })
    expect(formField).toBe(nativeTextarea())
    expect(labeledEditor).toHaveProperty("value", "Visible value")

    fireEvent.focus(formField)
    expect(document.activeElement).toBe(labeledEditor)
  })

  it("renders compact and spaced Markdown emphasis without showing artifacts", () => {
    render(
      <ControlledTextarea initialValue="**Bold** and ** spaced bold **" />
    )

    const strong = editor().querySelectorAll("strong")
    expect(Array.from(strong, (element) => element.textContent)).toEqual([
      "Bold",
      "spaced bold",
    ])
    expect(editor().textContent).toBe("Bold and spaced bold")
  })

  it("applies bold visually and stores Markdown in the form value", () => {
    render(<ControlledTextarea initialValue="Make this clear" />)
    selectText(editor(), "Make")

    fireEvent.click(screen.getByRole("button", { name: "Bold" }))

    expect(editor().querySelector("strong")?.textContent).toBe("Make")
    expect(editor().textContent).toBe("Make this clear")
    expect(nativeTextarea().value).toBe("**Make** this clear")
  })

  it("supports familiar formatting shortcuts", () => {
    render(<ControlledTextarea initialValue="Important" />)
    selectText(editor(), "Important")

    fireEvent.keyDown(editor(), { key: "i", ctrlKey: true })

    expect(editor().querySelector("em")?.textContent).toBe("Important")
    expect(nativeTextarea().value).toBe("_Important_")
  })

  it("supports existing form helpers that change the labeled field value", () => {
    render(<ControlledTextarea initialValue="Before" />)

    fireEvent.change(editor(), { target: { value: "**After**" } })

    expect((editor() as HTMLDivElement & { value: string }).value).toBe(
      "**After**"
    )
    expect(editor().querySelector("strong")?.textContent).toBe("After")
    expect(nativeTextarea().value).toBe("**After**")
  })

  it("renders lists and serializes visual list edits", () => {
    render(<ControlledTextarea initialValue={"1. First\n2. Second"} />)

    expect(
      Array.from(editor().querySelectorAll("ol > li"), (item) => item.textContent)
    ).toEqual(["First", "Second"])

    editor().innerHTML = "<ul><li>Alpha</li><li>Beta</li></ul>"
    fireEvent.input(editor())
    expect(nativeTextarea().value).toBe("- Alpha\n- Beta")
  })

  it("normalizes typed Markdown into rich text when the field is left", () => {
    render(<ControlledTextarea />)
    editor().textContent = "** bold **"
    fireEvent.input(editor())
    fireEvent.blur(editor())

    expect(editor().querySelector("strong")?.textContent).toBe("bold")
    expect(editor().textContent).toBe("bold")
    expect(nativeTextarea().value).toBe("** bold **")
  })

  it("preserves native focus and character-limit behavior", () => {
    const ref = React.createRef<HTMLTextAreaElement>()
    render(
      <Textarea
        ref={ref}
        aria-label="Description"
        defaultValue=""
        maxLength={5}
      />
    )

    ref.current?.focus()
    expect(document.activeElement).toBe(editor())

    editor().textContent = "123456"
    fireEvent.input(editor())
    expect(editor().textContent).toBe("12345")
    expect(nativeTextarea().value).toBe("12345")
  })

  it("disables formatting when the field cannot be edited", () => {
    const onChange = vi.fn()
    render(
      <Textarea
        aria-label="Description"
        value="Locked"
        disabled
        onChange={onChange}
      />
    )

    const boldButton = screen.getByRole("button", { name: "Bold" }) as HTMLButtonElement
    expect(boldButton.disabled).toBe(true)
    expect(editor().getAttribute("contenteditable")).toBe("false")
    fireEvent.click(boldButton)
    expect(onChange).not.toHaveBeenCalled()
  })
})
