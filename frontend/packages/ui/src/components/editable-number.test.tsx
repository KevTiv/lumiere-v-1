import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { EditableNumber } from "./editable-number"

afterEach(cleanup)

const field = () => screen.getByLabelText("Quantity") as HTMLInputElement

function setup(props: Partial<React.ComponentProps<typeof EditableNumber>> = {}) {
  const onCommit = vi.fn(async () => {})
  const onDraft = vi.fn()
  render(<EditableNumber aria-label="Quantity" value={2} onCommit={onCommit} onDraft={onDraft} min={0} {...props} />)
  return { onCommit, onDraft }
}

describe("EditableNumber", () => {
  it("shows the saved value", () => {
    setup()
    expect(field().value).toBe("2")
  })

  it("saves a changed value when the field is left", async () => {
    const { onCommit } = setup()

    fireEvent.change(field(), { target: { value: "5" } })
    fireEvent.blur(field())

    await waitFor(() => expect(onCommit).toHaveBeenCalledWith(5))
  })

  it("saves on Enter", async () => {
    const { onCommit } = setup()
    field().focus()

    fireEvent.change(field(), { target: { value: "7" } })
    fireEvent.keyDown(field(), { key: "Enter" })

    await waitFor(() => expect(onCommit).toHaveBeenCalledWith(7))
  })

  it("does not save an unchanged value", () => {
    const { onCommit } = setup()

    fireEvent.change(field(), { target: { value: "2" } })
    fireEvent.blur(field())

    expect(onCommit).not.toHaveBeenCalled()
  })

  it("goes back to the saved value on Escape without saving", () => {
    const { onCommit } = setup()
    field().focus()

    fireEvent.change(field(), { target: { value: "9" } })
    fireEvent.keyDown(field(), { key: "Escape" })

    expect(field().value).toBe("2")
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("flags an out-of-range or empty value and never saves it", () => {
    const { onCommit } = setup()

    fireEvent.change(field(), { target: { value: "-1" } })
    expect(field().getAttribute("aria-invalid")).toBe("true")
    fireEvent.blur(field())
    expect(onCommit).not.toHaveBeenCalled()
    expect(field().value).toBe("2")

    fireEvent.change(field(), { target: { value: "" } })
    expect(field().getAttribute("aria-invalid")).toBe("true")
  })

  it("reports the value being typed, and null once it is saved or matches the saved one", async () => {
    const { onDraft } = setup()

    fireEvent.change(field(), { target: { value: "4" } })
    expect(onDraft).toHaveBeenLastCalledWith(4)

    fireEvent.change(field(), { target: { value: "2" } })
    expect(onDraft).toHaveBeenLastCalledWith(null)

    fireEvent.change(field(), { target: { value: "6" } })
    fireEvent.blur(field())
    await waitFor(() => expect(onDraft).toHaveBeenLastCalledWith(null))
  })

  it("puts the saved value back when saving fails", async () => {
    const onCommit = vi.fn(async () => {
      throw new Error("locked")
    })
    setup({ onCommit })

    fireEvent.change(field(), { target: { value: "8" } })
    fireEvent.blur(field())

    await waitFor(() => expect(field().value).toBe("2"))
  })

  it("is read-only when disabled", () => {
    setup({ disabled: true })
    expect(field().disabled).toBe(true)
  })

  it("follows a new saved value from outside while not being edited", () => {
    const { rerender } = render(<EditableNumber aria-label="Quantity" value={2} onCommit={vi.fn()} />)
    rerender(<EditableNumber aria-label="Quantity" value={6} onCommit={vi.fn()} />)

    expect((screen.getAllByLabelText("Quantity")[0] as HTMLInputElement).value).toBe("6")
  })
})
