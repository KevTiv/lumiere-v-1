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

describe("Textarea", () => {
  it("keeps the native textarea API inside a formatting panel", () => {
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

    const textarea = screen.getByLabelText("Description") as HTMLTextAreaElement
    expect(screen.getByRole("toolbar", { name: "Text formatting" })).toBeTruthy()
    expect(textarea.name).toBe("description")
    expect(textarea.required).toBe(true)
    expect(textarea.value).toBe("Existing content")
    expect(ref.current).toBe(textarea)
  })

  it("wraps selected text from a toolbar action", () => {
    render(<ControlledTextarea initialValue="Make this clear" />)
    const textarea = screen.getByLabelText("Description") as HTMLTextAreaElement
    textarea.setSelectionRange(0, 4)

    fireEvent.click(screen.getByRole("button", { name: "Bold" }))

    expect(textarea.value).toBe("**Make** this clear")
    expect(textarea.selectionStart).toBe(2)
    expect(textarea.selectionEnd).toBe(6)
  })

  it("supports familiar formatting shortcuts", () => {
    render(<ControlledTextarea initialValue="Important" />)
    const textarea = screen.getByLabelText("Description") as HTMLTextAreaElement
    textarea.setSelectionRange(0, textarea.value.length)

    fireEvent.keyDown(textarea, { key: "i", ctrlKey: true })

    expect(textarea.value).toBe("_Important_")
  })

  it("formats every selected line as a numbered list", () => {
    render(<ControlledTextarea initialValue={"First\nSecond"} />)
    const textarea = screen.getByLabelText("Description") as HTMLTextAreaElement
    textarea.setSelectionRange(0, textarea.value.length)

    fireEvent.click(screen.getByRole("button", { name: "Numbered list" }))

    expect(textarea.value).toBe("1. First\n2. Second")
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
    fireEvent.click(boldButton)
    expect(onChange).not.toHaveBeenCalled()
  })
})
