import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react"
import { Editor } from "@tiptap/react"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createRichTextExtensions } from "../lib/rich-text-extensions"
import {
  RichTextTemplateProvider,
  type RichTextTemplateOption,
  type RichTextTemplateProviderProps
} from "./rich-text-template-provider"
import { Textarea } from "./textarea"

afterEach(cleanup)

const templates: readonly RichTextTemplateOption[] = [
  { id: "new", name: "Greeting", html: "<p><strong>new</strong></p>" },
  { id: "closing", name: "Closing", html: "<p>Thank you</p>" }
]

type HarnessProps = Partial<Omit<RichTextTemplateProviderProps, "children">> & {
  initialValue?: string
  disabled?: boolean
  readOnly?: boolean
  maxLength?: number
  onValue?: (value: string) => void
  textareaRef?: React.Ref<HTMLTextAreaElement>
}

function Harness({
  initialValue = "Prefix old suffix",
  disabled,
  readOnly,
  maxLength,
  onValue,
  textareaRef,
  ...source
}: HarnessProps) {
  const [value, setValue] = React.useState(initialValue)
  return (
    <RichTextTemplateProvider
      scopeKey="org-one:company-one"
      templates={templates}
      status="ready"
      onRequest={() => undefined}
      {...source}
    >
      <form aria-label="Edit description">
        <Textarea
          ref={textareaRef}
          aria-label="Description"
          name="description"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            onValue?.(event.target.value)
          }}
          disabled={disabled}
          readOnly={readOnly}
          maxLength={maxLength}
        />
      </form>
    </RichTextTemplateProvider>
  )
}

async function getEditor() {
  const surface = await screen.findByRole("textbox", { name: "Description" })
  const editor = (surface as HTMLElement & { editor?: Editor }).editor
  if (!editor) throw new Error("Tiptap editor not mounted")
  return editor
}

function openTemplates() {
  fireEvent.click(screen.getByRole("button", { name: "Insert text template" }))
}

async function insertGreeting() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Insert Greeting" })
  )
}

describe("rich text templates", () => {
  it("does not show template controls without an authorized source", async () => {
    render(<Textarea aria-label="Description" />)
    await getEditor()
    expect(
      screen.queryByRole("button", { name: "Insert text template" })
    ).toBeNull()
  })

  it("hides revoked template access without remounting the form or losing draft text", async () => {
    const textareaRef = React.createRef<HTMLTextAreaElement>()
    const { rerender } = render(
      <Harness initialValue="Draft" textareaRef={textareaRef} />
    )
    const editor = await getEditor()
    const nativeField = textareaRef.current
    act(() => {
      editor.commands.setTextSelection(6)
      editor.commands.insertContent(" in progress")
    })
    openTemplates()
    await screen.findByRole("button", { name: "Insert Greeting" })

    rerender(
      <Harness initialValue="Draft" textareaRef={textareaRef} enabled={false} />
    )
    expect(
      screen.queryByRole("button", { name: "Insert text template" })
    ).toBeNull()
    expect(screen.queryByRole("button", { name: "Insert Greeting" })).toBeNull()
    expect(await getEditor()).toBe(editor)
    expect(textareaRef.current).toBe(nativeField)
    expect(editor.getText()).toBe("Draft in progress")
    expect(
      new FormData(screen.getByRole("form") as HTMLFormElement).get(
        "description"
      )
    ).toBe("Draft in progress")

    rerender(<Harness initialValue="Draft" textareaRef={textareaRef} enabled />)
    expect(
      screen.getByRole("button", { name: "Insert text template" })
    ).toBeTruthy()
    expect(await getEditor()).toBe(editor)
    expect(nativeField?.value).toBe("Draft in progress")
  })

  it("loads on demand and only shows supplied, searchable options", async () => {
    const onRequest = vi.fn()
    const { rerender } = render(<Harness status="idle" onRequest={onRequest} />)
    await getEditor()
    expect(onRequest).not.toHaveBeenCalled()

    openTemplates()
    expect(onRequest).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "Loading templates…"
    )
    expect(screen.queryByRole("button", { name: "Insert Greeting" })).toBeNull()

    rerender(<Harness status="ready" onRequest={onRequest} />)
    expect(
      await screen.findByRole("button", { name: "Insert Greeting" })
    ).toBeTruthy()
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search text templates" }),
      {
        target: { value: "clos" }
      }
    )
    expect(screen.queryByRole("button", { name: "Insert Greeting" })).toBeNull()
    expect(screen.getByRole("button", { name: "Insert Closing" })).toBeTruthy()
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "missing" }
    })
    expect(screen.getByRole("status").textContent).toBe(
      "No matching text templates."
    )
  })

  it("replaces the captured selection through the native Markdown bridge and restores focus", async () => {
    const onValue = vi.fn()
    const textareaRef = React.createRef<HTMLTextAreaElement>()
    render(<Harness onValue={onValue} textareaRef={textareaRef} />)
    const editor = await getEditor()
    act(() => {
      textareaRef.current?.focus()
      editor.commands.setTextSelection({ from: 8, to: 11 })
    })
    expect(document.activeElement).toBe(editor.view.dom)

    openTemplates()
    await screen.findByRole("searchbox")
    // Moving focus/selection to the picker must not change the insertion site.
    act(() => editor.commands.setTextSelection(1))
    await insertGreeting()

    await waitFor(() =>
      expect(onValue).toHaveBeenLastCalledWith("Prefix **new** suffix")
    )
    expect(onValue).toHaveBeenCalledTimes(1)
    expect(textareaRef.current?.value).toBe("Prefix **new** suffix")
    expect(editor.view.dom.querySelector("strong")?.textContent).toBe("new")
    expect(
      new FormData(screen.getByRole("form") as HTMLFormElement).get(
        "description"
      )
    ).toBe("Prefix **new** suffix")
    await waitFor(() => expect(document.activeElement).toBe(editor.view.dom))
  })

  it("keeps template insertion as one undo step, separate from typing before and after", async () => {
    render(<Harness initialValue="Start" />)
    const editor = await getEditor()
    act(() => {
      editor.commands.setTextSelection(6)
      editor.commands.insertContent("!")
    })
    openTemplates()
    await insertGreeting()
    expect(editor.getText()).toBe("Start!new")
    act(() => editor.commands.insertContent("x"))
    expect(editor.getText()).toBe("Start!newx")

    act(() => editor.commands.undo())
    expect(editor.getText()).toBe("Start!new")
    act(() => editor.commands.undo())
    expect(editor.getText()).toBe("Start!")
    act(() => editor.commands.undo())
    expect(editor.getText()).toBe("Start")
  })

  it("round-trips supported template formatting through stored Markdown", async () => {
    const textareaRef = React.createRef<HTMLTextAreaElement>()
    render(
      <Harness
        initialValue=""
        textareaRef={textareaRef}
        templates={[
          {
            id: "summary",
            name: "Greeting",
            html: '<h2>Summary</h2><p>Hello <strong>team</strong>.</p><ul><li>First</li><li>Second</li></ul><p><a href="https://example.com">Reference</a></p>'
          }
        ]}
      />
    )
    const editor = await getEditor()
    openTemplates()
    await insertGreeting()
    const restored = new Editor({
      extensions: createRichTextExtensions(),
      content: textareaRef.current?.value,
      contentType: "markdown"
    })
    try {
      expect(restored.getJSON()).toEqual(editor.getJSON())
      expect(restored.getHTML()).toContain("<h2>Summary</h2>")
      expect(restored.getHTML()).toContain("<strong>team</strong>")
    } finally {
      restored.destroy()
    }
  })

  it("rejects an oversized insertion atomically without changing the native field or undo history", async () => {
    const onValue = vi.fn()
    const textareaRef = React.createRef<HTMLTextAreaElement>()
    render(
      <Harness
        initialValue="Keep"
        maxLength={6}
        onValue={onValue}
        textareaRef={textareaRef}
      />
    )
    const editor = await getEditor()
    act(() => editor.commands.setTextSelection(5))
    const before = editor.getJSON()
    openTemplates()
    await insertGreeting()

    expect(screen.getByRole("alert").textContent).toContain("6-character limit")
    expect(editor.getJSON()).toEqual(before)
    expect(textareaRef.current?.value).toBe("Keep")
    expect(onValue).not.toHaveBeenCalled()
    expect(editor.can().undo()).toBe(false)
  })

  it("counts the resulting text after selection replacement, including a zero-character limit", async () => {
    const { rerender } = render(<Harness initialValue="12345" maxLength={5} />)
    let editor = await getEditor()
    act(() => editor.commands.setTextSelection({ from: 2, to: 5 }))
    openTemplates()
    await insertGreeting()
    expect(editor.getText()).toBe("1new5")
    expect(screen.queryByRole("alert")).toBeNull()

    rerender(<Harness key="empty" initialValue="" maxLength={0} />)
    editor = await getEditor()
    openTemplates()
    await insertGreeting()
    expect(screen.getByRole("alert").textContent).toContain("0-character limit")
    expect(editor.isEmpty).toBe(true)
  })

  it("discards an open picker on company scope changes before offering the new choices", async () => {
    const onValue = vi.fn()
    const { rerender } = render(<Harness initialValue="" onValue={onValue} />)
    const editor = await getEditor()
    openTemplates()
    await screen.findByRole("button", { name: "Insert Greeting" })

    rerender(
      <Harness
        initialValue=""
        onValue={onValue}
        scopeKey="org-one:company-two"
        templates={[
          { id: "other", name: "Other company", html: "<p>Other text</p>" }
        ]}
      />
    )
    expect(screen.queryByRole("button", { name: "Insert Greeting" })).toBeNull()
    expect(screen.queryByRole("searchbox")).toBeNull()
    expect(onValue).not.toHaveBeenCalled()
    openTemplates()
    fireEvent.click(
      await screen.findByRole("button", { name: "Insert Other company" })
    )
    expect(editor.getText()).toBe("Other text")
  })

  it.each(["disabled", "readOnly"] as const)(
    "closes the picker and prevents insertion when %s changes",
    async (state) => {
      const onValue = vi.fn()
      const { rerender } = render(<Harness onValue={onValue} />)
      const editor = await getEditor()
      openTemplates()
      await screen.findByRole("button", { name: "Insert Greeting" })

      rerender(<Harness onValue={onValue} {...{ [state]: true }} />)
      expect(
        screen.queryByRole("button", { name: "Insert Greeting" })
      ).toBeNull()
      expect(editor.isEditable).toBe(false)
      const trigger = screen.queryByRole("button", {
        name: "Insert text template"
      })
      if (state === "disabled") expect(trigger).toHaveProperty("disabled", true)
      else expect(trigger).toBeNull()
      expect(editor.getText()).toBe("Prefix old suffix")
      expect(onValue).not.toHaveBeenCalled()
    }
  )

  it("rejects stale selections when the document changes while the picker is open", async () => {
    const onValue = vi.fn()
    render(<Harness initialValue="Before" onValue={onValue} />)
    const editor = await getEditor()
    openTemplates()
    await screen.findByRole("button", { name: "Insert Greeting" })
    act(() => editor.commands.insertContent("Changed "))
    onValue.mockClear()
    const changed = editor.getJSON()
    await insertGreeting()

    expect(screen.getByRole("alert").textContent).toContain("text changed")
    expect(editor.getJSON()).toEqual(changed)
    expect(onValue).not.toHaveBeenCalled()
  })

  it("sanitizes template HTML again at insertion instead of trusting the source", async () => {
    render(
      <Harness
        initialValue=""
        templates={[
          {
            id: "unsafe",
            name: "Greeting",
            html: '<script>alert(1)</script><p onclick="alert(1)">Safe <strong>text</strong><img src="https://example.com/track" /></p>'
          }
        ]}
      />
    )
    const editor = await getEditor()
    openTemplates()
    await insertGreeting()
    expect(editor.getText()).toBe("Safe text")
    expect(editor.getHTML()).not.toMatch(/script|onclick|<img|example\.com/)
    expect(editor.getHTML()).toContain("<strong>text</strong>")
  })

  it("exposes a retry when loading fails without making the stored editor value change", async () => {
    const onRequest = vi.fn()
    const onValue = vi.fn()
    render(
      <Harness
        status="error"
        error="Connection unavailable"
        onRequest={onRequest}
        onValue={onValue}
      />
    )
    await getEditor()
    openTemplates()
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Connection unavailable"
    )
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(onRequest).toHaveBeenCalledTimes(2)
    expect(onValue).not.toHaveBeenCalled()
  })
})
