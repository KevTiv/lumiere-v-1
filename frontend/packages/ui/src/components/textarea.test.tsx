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

    const editor = await getEditor("Description")
    expect(screen.getByLabelText("Description")).toBe(editor.view.dom)
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

function nativeTextarea() { return document.querySelector("textarea") as HTMLTextAreaElement }
function editor() { return screen.getByRole("textbox", { name: "Description" }) as HTMLDivElement }

describe("Textarea contracts retained from main", () => {
it("preserved main: keeps the native textarea API as its form bridge", async () => {
    const ref = React.createRef<HTMLTextAreaElement>()

    render(
      <Textarea
        ref={ref}
        name="description"
        aria-label="Description"
        defaultValue="Existing content"
        required
      />
    );
    await getEditor("Description")

    const textarea = nativeTextarea()
    expect(screen.getByRole("toolbar", { name: "Text formatting" })).toBeTruthy()
    expect(textarea.name).toBe("description")
    expect(textarea.required).toBe(true)
    expect(textarea.value).toBe("Existing content")
    expect(ref.current).toBe(textarea)
    expect(editor().textContent).toBe("Existing content")
  })

it("preserved main: redirects an external label to the named rich-text surface", async () => {
    render(
      <>
        <label htmlFor="description">Description</label>
        <Textarea id="description" defaultValue="Visible value" />
      </>
    );
    await getEditor("Description rich text editor")

    const formField = screen.getByLabelText("Description")
    const labeledEditor = screen.getByRole("textbox", {
      name: "Description rich text editor",
    })
    expect(formField).toBe(nativeTextarea())
    expect(labeledEditor).toHaveProperty("value", "Visible value")

    fireEvent.focus(formField)
    expect(document.activeElement).toBe(labeledEditor)
  })

it("preserved main: clears both the rich-text editor and native bridge after a controlled reset", async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <Textarea aria-label="Description" value="Posted internal note" onChange={onChange} />
    );
    await getEditor("Description")
    expect(editor().textContent).toBe("Posted internal note")
    expect(nativeTextarea().value).toBe("Posted internal note")

    rerender(<Textarea aria-label="Description" value="" onChange={onChange} />)

    await waitFor(() => expect(editor().textContent).toBe(""))
    expect(nativeTextarea().value).toBe("")
    expect(onChange).not.toHaveBeenCalled()
  })

it("preserved main: renders compact and spaced Markdown emphasis without showing artifacts", async () => {
    render(
      <ControlledTextarea initialValue="**Bold** and ** spaced bold **" />
    );
    await getEditor("Description")

    const strong = editor().querySelectorAll("strong")
    expect(Array.from(strong, (element) => element.textContent)).toEqual([
      "Bold",
      "spaced bold",
    ])
    expect(editor().textContent).toBe("Bold and spaced bold")
  })

it("preserved main: keeps touch toolbar controls from stealing editor focus", async () => {
    render(<ControlledTextarea initialValue="Make this clear" />);
    await getEditor("Description")
    editor().focus()
    const boldButton = screen.getByRole("button", { name: "Bold" })

    expect(fireEvent.pointerDown(boldButton)).toBe(false)

    expect(document.activeElement).toBe(editor())
    expect(editor().textContent).toBe("Make this clear")
  })

it("preserved main: exposes familiar formatting shortcuts on the toolbar", async () => {
    render(<ControlledTextarea initialValue="Important" />);
    await getEditor("Description")

    expect(screen.getByRole("button", { name: "Bold" }).title).toContain(
      "Ctrl+B"
    )
    expect(screen.getByRole("button", { name: "Italic" }).title).toContain(
      "Ctrl+I"
    )
  })

it("preserved main: supports existing form helpers that change the labeled field value", async () => {
    render(<ControlledTextarea initialValue="Before" />);
    await getEditor("Description")

    fireEvent.change(editor(), { target: { value: "**After**" } })

    expect((editor() as HTMLDivElement & { value: string }).value).toBe(
      "**After**"
    )
    expect(editor().querySelector("strong")?.textContent).toBe("After")
    expect(nativeTextarea().value).toBe("**After**")
  })

it("preserved main: renders lists and serializes visual list edits", async () => {
    render(<ControlledTextarea initialValue={"1. First\n2. Second"} />);
    await getEditor("Description")

    expect(
      Array.from(editor().querySelectorAll("ol > li"), (item) => item.textContent)
    ).toEqual(["First", "Second"])

    fireEvent.change(editor(), { target: { value: "- Alpha\n- Beta" } })
    expect(nativeTextarea().value).toBe("- Alpha\n- Beta")
  })

it("preserved main: normalizes typed Markdown into rich text when the field is left", async () => {
    render(<ControlledTextarea />);
    await getEditor("Description")
    fireEvent.change(editor(), { target: { value: "** bold **" } })

    expect(editor().querySelector("strong")?.textContent).toBe("bold")
    expect(editor().textContent).toBe("bold")
    expect(nativeTextarea().value).toBe("** bold **")
  })

it("preserved main: preserves native focus and character-limit behavior", async () => {
    const ref = React.createRef<HTMLTextAreaElement>()
    render(
      <Textarea
        ref={ref}
        aria-label="Description"
        defaultValue=""
        maxLength={5}
      />
    );
    await getEditor("Description")

    ref.current?.focus()
    expect(document.activeElement).toBe(editor())

    fireEvent.change(editor(), { target: { value: "123456" } })
    expect(editor().textContent).toBe("12345")
    expect(nativeTextarea().value).toBe("12345")
  })

it("preserved main: passes mobile keyboard hints to the visible editor", async () => {
    render(
      <Textarea
        aria-label="Description"
        inputMode="text"
        enterKeyHint="done"
        autoCapitalize="sentences"
        autoCorrect="on"
        spellCheck
      />
    );
    await getEditor("Description")

    expect(editor().getAttribute("inputmode")).toBe("text")
    expect(editor().getAttribute("enterkeyhint")).toBe("done")
    expect(editor().getAttribute("autocapitalize")).toBe("sentences")
    expect(editor().getAttribute("autocorrect")).toBe("on")
    expect(editor().getAttribute("spellcheck")).toBe("true")
  })

it("preserved main: disables formatting when the field cannot be edited", async () => {
    const onChange = vi.fn()
    render(
      <Textarea
        aria-label="Description"
        value="Locked"
        disabled
        onChange={onChange}
      />
    );
    await getEditor("Description")

    const boldButton = screen.getByRole("button", { name: "Bold" }) as HTMLButtonElement
    expect(boldButton.disabled).toBe(true)
    expect(editor().getAttribute("contenteditable")).toBe("false")
    fireEvent.click(boldButton)
    expect(onChange).not.toHaveBeenCalled()
  })
})
