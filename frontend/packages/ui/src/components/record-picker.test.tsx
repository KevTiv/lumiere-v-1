import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { RecordPicker, type RecordPickerOption } from "./record-picker"

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

function Harness({ initial = "", onChange = vi.fn() }: { initial?: string; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <RecordPicker
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
      options={options}
      placeholder="Pick a partner"
      data-testid="partner"
    />
  )
}

const open = () => fireEvent.click(screen.getByTestId("partner"))

describe("RecordPicker", () => {
  it("shows the placeholder until a record is chosen, then its name", async () => {
    render(<Harness />)
    expect(screen.getByTestId("partner").textContent).toContain("Pick a partner")

    open()
    fireEvent.click(await screen.findByRole("option", { name: /Globex/ }))

    await waitFor(() => expect(screen.getByTestId("partner").textContent).toContain("Globex"))
  })

  it("shows the name of the record already chosen", () => {
    render(<Harness initial="3" />)

    expect(screen.getByTestId("partner").textContent).toContain("Initech")
  })

  it("reports the chosen id and closes", async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    open()
    fireEvent.click(await screen.findByRole("option", { name: /Acme/ }))

    expect(onChange).toHaveBeenCalledWith("1")
    await waitFor(() => expect(screen.queryByRole("option", { name: /Globex/ })).toBeNull())
  })

  it("narrows the list as you type, by name or by id", async () => {
    render(<Harness />)
    open()
    const input = await screen.findByPlaceholderText("Search...")

    fireEvent.change(input, { target: { value: "glo" } })
    await waitFor(() => expect(screen.queryByRole("option", { name: /Acme/ })).toBeNull())
    expect(screen.getByRole("option", { name: /Globex/ })).toBeTruthy()

    fireEvent.change(input, { target: { value: "#3" } })
    await waitFor(() => expect(screen.getByRole("option", { name: /Initech/ })).toBeTruthy())
    expect(screen.queryByRole("option", { name: /Globex/ })).toBeNull()
  })

  it("says so when nothing matches", async () => {
    render(<Harness />)
    open()

    fireEvent.change(await screen.findByPlaceholderText("Search..."), { target: { value: "zzz" } })

    expect(await screen.findByText("No matches")).toBeTruthy()
  })

  it("does not let a disabled record be chosen", async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    open()

    fireEvent.click(await screen.findByRole("option", { name: /Hooli/ }))

    expect(onChange).not.toHaveBeenCalled()
  })
})
