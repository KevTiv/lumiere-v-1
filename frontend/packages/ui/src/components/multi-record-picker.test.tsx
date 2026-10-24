import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { MultiRecordPicker } from "./multi-record-picker"
import type { RecordPickerOption } from "./record-picker"

beforeAll(() => {
  // cmdk and Base UI popovers use browser APIs jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  if (typeof globalThis.PointerEvent === "undefined") {
    Object.defineProperty(globalThis, "PointerEvent", { value: MouseEvent, configurable: true })
  }
})

afterEach(cleanup)

const options: RecordPickerOption[] = [
  { value: "1", label: "Acme Corp" },
  { value: "2", label: "Globex" },
  { value: "3", label: "Initech" },
  { value: "4", label: "Hooli", disabled: true },
]

function Harness({ initial = [], onChange = vi.fn() }: { initial?: string[]; onChange?: (value: string[]) => void }) {
  const [value, setValue] = useState<string[]>(initial)
  return (
    <MultiRecordPicker
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
      options={options}
      placeholder="Add partners"
      unavailableLabel={(missing) => `Unavailable: ${missing}`}
      data-testid="partners"
    />
  )
}

const open = () => fireEvent.click(screen.getByTestId("partners"))
const chips = () =>
  Array.from(screen.queryByTestId("partners-chips")?.querySelectorAll("li") ?? [], (chip) => chip.textContent)

describe("MultiRecordPicker", () => {
  it("adds chosen records as chips and keeps the list open for more", async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    expect(chips()).toEqual([])

    open()
    fireEvent.click(await screen.findByRole("option", { name: /Globex/ }))
    fireEvent.click(screen.getByRole("option", { name: /Acme/ }))

    expect(onChange).toHaveBeenLastCalledWith(["2", "1"])
    expect(chips()).toEqual(["Globex", "Acme Corp"])
    expect(screen.getByRole("option", { name: /Globex/ }).getAttribute("aria-checked")).toBe("true")
  })

  it("toggles a record off when chosen again", async () => {
    const onChange = vi.fn()
    render(<Harness initial={["1", "2"]} onChange={onChange} />)

    open()
    fireEvent.click(await screen.findByRole("option", { name: /Acme/ }))

    expect(onChange).toHaveBeenLastCalledWith(["2"])
  })

  it("removes a chip with its remove button", () => {
    const onChange = vi.fn()
    render(<Harness initial={["1", "3"]} onChange={onChange} />)

    fireEvent.click(screen.getByRole("button", { name: "Remove Initech" }))

    expect(onChange).toHaveBeenLastCalledWith(["1"])
    expect(chips()).toEqual(["Acme Corp"])
  })

  it("removes the last removable chip on Backspace in an empty search, skipping locked chips", async () => {
    const onChange = vi.fn()
    render(<Harness initial={["1", "2", "4", "99"]} onChange={onChange} />)

    open()
    const input = await screen.findByPlaceholderText("Search...")
    fireEvent.change(input, { target: { value: "x" } })
    fireEvent.keyDown(input, { key: "Backspace" })
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: "" } })
    fireEvent.keyDown(input, { key: "Backspace" })
    expect(onChange).toHaveBeenLastCalledWith(["1", "4", "99"])
  })

  it("toggles the highlighted record with Enter", async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    open()
    const input = await screen.findByPlaceholderText("Search...")

    fireEvent.change(input, { target: { value: "init" } })
    await waitFor(() => expect(screen.queryByRole("option", { name: /Acme/ })).toBeNull())
    fireEvent.keyDown(input, { key: "Enter" })

    expect(onChange).toHaveBeenLastCalledWith(["3"])
  })

  it("narrows the list as you type, by name or by id", async () => {
    render(<Harness />)
    open()
    const input = await screen.findByPlaceholderText("Search...")

    fireEvent.change(input, { target: { value: "#3" } })
    await waitFor(() => expect(screen.queryByRole("option", { name: /Globex/ })).toBeNull())
    expect(screen.getByRole("option", { name: /Initech/ })).toBeTruthy()
  })

  it("shows disabled and unlisted selections as chips that cannot be removed", async () => {
    const onChange = vi.fn()
    render(<Harness initial={["4", "99"]} onChange={onChange} />)

    expect(chips()).toEqual(["Hooli", "Unavailable: 99"])
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull()

    open()
    fireEvent.click(await screen.findByRole("option", { name: /Hooli/ }))
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("option", { name: /Acme/ }))
    expect(onChange).toHaveBeenLastCalledWith(["4", "99", "1"])
  })
})
