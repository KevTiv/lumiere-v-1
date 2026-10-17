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

  it("keeps touch toolbar controls from stealing editor focus", () => {
    render(<ControlledTextarea initialValue="Make this clear" />)
    editor().focus()
    const boldButton = screen.getByRole("button", { name: "Bold" })

    expect(fireEvent.pointerDown(boldButton)).toBe(false)

    expect(document.activeElement).toBe(editor())
    expect(editor().textContent).toBe("Make this clear")
  })

  it("exposes familiar formatting shortcuts on the toolbar", () => {
    render(<ControlledTextarea initialValue="Important" />)

    expect(screen.getByRole("button", { name: "Bold" }).title).toContain(
      "Ctrl+B"
    )
    expect(screen.getByRole("button", { name: "Italic" }).title).toContain(
      "Ctrl+I"
    )
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

    fireEvent.change(editor(), { target: { value: "- Alpha\n- Beta" } })
    expect(nativeTextarea().value).toBe("- Alpha\n- Beta")
  })

  it("normalizes typed Markdown into rich text when the field is left", () => {
    render(<ControlledTextarea />)
    fireEvent.change(editor(), { target: { value: "** bold **" } })

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

    fireEvent.change(editor(), { target: { value: "123456" } })
    expect(editor().textContent).toBe("12345")
    expect(nativeTextarea().value).toBe("12345")
  })

  it("passes mobile keyboard hints to the visible editor", () => {
    render(
      <Textarea
        aria-label="Description"
        inputMode="text"
        enterKeyHint="done"
        autoCapitalize="sentences"
        autoCorrect="on"
        spellCheck
      />
    )

    expect(editor().getAttribute("inputmode")).toBe("text")
    expect(editor().getAttribute("enterkeyhint")).toBe("done")
    expect(editor().getAttribute("autocapitalize")).toBe("sentences")
    expect(editor().getAttribute("autocorrect")).toBe("on")
    expect(editor().getAttribute("spellcheck")).toBe("true")
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
