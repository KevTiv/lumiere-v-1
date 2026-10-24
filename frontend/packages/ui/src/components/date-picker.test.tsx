import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { addDays, endOfMonth, format } from "date-fns"
import { useState } from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { DatePicker, DateTimePicker, parseTypedDate } from "./date-picker"

beforeAll(() => {
  // Base UI popovers use browser APIs jsdom lacks.
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

const iso = (date: Date) => format(date, "yyyy-MM-dd")

function Harness({
  initial = "",
  onChange = vi.fn(),
  min,
  max,
}: {
  initial?: string
  onChange?: (value: string) => void
  min?: string
  max?: string
}) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <DatePicker
        data-testid="due"
        value={value}
        min={min}
        max={max}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
      <output data-testid="value">{value}</output>
    </>
  )
}

const input = () => screen.getByTestId("due") as HTMLInputElement
const openCalendar = () => fireEvent.click(screen.getByTestId("due-calendar"))

describe("parseTypedDate", () => {
  it("accepts ISO and locale-ordered numeric dates", () => {
    expect(parseTypedDate("2026-10-20", "en-US")).toBe("2026-10-20")
    expect(parseTypedDate("10/20/2026", "en-US")).toBe("2026-10-20")
    expect(parseTypedDate("20/10/2026", "pt-BR")).toBe("2026-10-20")
    expect(parseTypedDate("20.10.26", "de-DE")).toBe("2026-10-20")
    expect(parseTypedDate("2026-10-20T06:30", "en-US")).toBe("2026-10-20")
  })

  it("returns empty for blank and null for invalid text", () => {
    expect(parseTypedDate("  ", "en-US")).toBe("")
    expect(parseTypedDate("2026-02-30", "en-US")).toBeNull()
    expect(parseTypedDate("13/45/2026", "en-US")).toBeNull()
    expect(parseTypedDate("nope", "en-US")).toBeNull()
    expect(parseTypedDate("10/20/26", "en-US", { allowShortYear: false })).toBeNull()
  })
})

describe("DatePicker", () => {
  it("commits a typed ISO date without opening the calendar", () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    fireEvent.change(input(), { target: { value: "2026-10-20" } })

    expect(onChange).toHaveBeenLastCalledWith("2026-10-20")
    expect(screen.queryByTestId("due-shortcut-today")).toBeNull()
  })

  it("parses a typed locale date on blur and shows it localized", () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    fireEvent.focus(input())
    fireEvent.change(input(), { target: { value: "10/20/26" } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.blur(input())

    expect(onChange).toHaveBeenLastCalledWith("2026-10-20")
    expect(input().value).not.toBe("10/20/26")
    expect(input().value).toContain("2026")
  })

  it("reverts unparseable text to the last date on blur", () => {
    const onChange = vi.fn()
    render(<Harness initial="2026-01-05" onChange={onChange} />)
    const shown = input().value

    fireEvent.focus(input())
    fireEvent.change(input(), { target: { value: "garbage" } })
    fireEvent.blur(input())

    expect(onChange).not.toHaveBeenCalled()
    expect(input().value).toBe(shown)
    expect(screen.getByTestId("value").textContent).toBe("2026-01-05")
  })

  it("clears to an empty string when the text is erased", () => {
    const onChange = vi.fn()
    render(<Harness initial="2026-01-05" onChange={onChange} />)

    fireEvent.change(input(), { target: { value: "" } })

    expect(onChange).toHaveBeenLastCalledWith("")
  })

  // Opening the calendar popover renders a full month grid, which is slow in jsdom.
  it.each([
    ["today", 0],
    ["tomorrow", 1],
    ["plus7", 7],
    ["plus30", 30],
  ] as const)("applies the %s shortcut as a YYYY-MM-DD string", async (key, days) => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    openCalendar()
    fireEvent.click(await screen.findByTestId(`due-shortcut-${key}`))

    expect(onChange).toHaveBeenLastCalledWith(iso(addDays(new Date(), days)))
  }, 15_000)

  it("applies the end-of-month shortcut", async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    openCalendar()
    fireEvent.click(await screen.findByTestId("due-shortcut-endOfMonth"))

    expect(onChange).toHaveBeenLastCalledWith(iso(endOfMonth(new Date())))
  }, 15_000)

  it("clears from the calendar panel", async () => {
    const onChange = vi.fn()
    render(<Harness initial="2026-01-05" onChange={onChange} />)

    openCalendar()
    fireEvent.click(await screen.findByTestId("due-clear"))

    expect(onChange).toHaveBeenLastCalledWith("")
    await waitFor(() => expect(input().value).toBe(""))
  }, 15_000)

  it("disables shortcuts outside min/max and flags out-of-range typed dates", async () => {
    const today = new Date()
    render(<Harness min={iso(addDays(today, 1))} max={iso(addDays(today, 10))} />)

    openCalendar()
    expect((await screen.findByTestId("due-shortcut-today")).hasAttribute("disabled")).toBe(true)
    expect(screen.getByTestId("due-shortcut-plus7").hasAttribute("disabled")).toBe(false)
    expect(screen.getByTestId("due-shortcut-plus30").hasAttribute("disabled")).toBe(true)

    fireEvent.change(input(), { target: { value: iso(addDays(today, 40)) } })
    await waitFor(() => expect(input().getAttribute("aria-invalid")).toBe("true"))
    expect(input().validity.customError).toBe(true)
  }, 15_000)
})

describe("DateTimePicker", () => {
  function DateTimeHarness({ initial = "", onChange }: { initial?: string; onChange: (value: string) => void }) {
    const [value, setValue] = useState(initial)
    return (
      <DateTimePicker
        data-testid="run"
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
    )
  }

  it("accepts a full YYYY-MM-DDTHH:mm value typed into the date field", () => {
    const onChange = vi.fn()
    render(<DateTimeHarness onChange={onChange} />)

    fireEvent.change(screen.getByTestId("run"), { target: { value: "2034-01-02T06:00" } })

    expect(onChange).toHaveBeenLastCalledWith("2034-01-02T06:00")
    expect((screen.getByTestId("run-time") as HTMLInputElement).value).toBe("06:00")
  })

  it("combines the date and time inputs and clears to empty", () => {
    const onChange = vi.fn()
    render(<DateTimeHarness initial="2026-10-20T09:15" onChange={onChange} />)

    fireEvent.change(screen.getByTestId("run-time"), { target: { value: "17:45" } })
    expect(onChange).toHaveBeenLastCalledWith("2026-10-20T17:45")

    fireEvent.change(screen.getByTestId("run"), { target: { value: "2026-11-01" } })
    expect(onChange).toHaveBeenLastCalledWith("2026-11-01T17:45")

    fireEvent.change(screen.getByTestId("run"), { target: { value: "" } })
    expect(onChange).toHaveBeenLastCalledWith("")
  })
})
