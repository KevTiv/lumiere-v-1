import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { HistoryPeriod } from "@lumiere/erp-shared/history-period"
import { HistoryPeriodSelect, type HistoryPeriodSelectProps } from "./history-period-select"
import { chooseSelectValue } from "./select-test-utils"

afterEach(cleanup)

function Harness({
  initialValue = "all",
  onChange = vi.fn(),
  ...props
}: Omit<HistoryPeriodSelectProps, "value" | "onChange"> & {
  initialValue?: HistoryPeriod
  onChange?: (period: HistoryPeriod) => void
}) {
  const [value, setValue] = useState<HistoryPeriod>(initialValue)
  return <HistoryPeriodSelect {...props} value={value} onChange={(period) => { setValue(period); onChange(period) }} />
}

const select = (value: string) => chooseSelectValue(screen.getByRole("combobox", { name: "Date range" }), value)
const input = (label: "From" | "Through") => screen.getByLabelText(label) as HTMLInputElement

describe("HistoryPeriodSelect", () => {
  it("offers all history and lets a user directly enter decades without a lookback limit", () => {
    const change = vi.fn()
    render(<Harness onChange={change} />)
    expect(screen.getByRole("combobox").textContent).toContain("All history")
    select("custom")
    expect(input("From").value).toBe("")
    expect(input("Through").value).toBe("")
    expect(input("From").type).toBe("date")
    expect(input("From").getAttribute("min")).toBeNull()
    expect(input("Through").getAttribute("max")).toBeNull()
    fireEvent.change(input("From"), { target: { value: "1940-01-01" } })
    fireEvent.change(input("Through"), { target: { value: "2025-12-31" } })
    expect(change).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Apply dates" }))
    expect(change).toHaveBeenLastCalledWith({ kind: "custom", from: "1940-01-01", through: "2025-12-31" })
    select("all")
    expect(change).toHaveBeenLastCalledWith("all")
    expect(screen.queryByLabelText("From")).toBeNull()
  })

  it("keeps incomplete and reversed drafts out of the query and announces inline errors", () => {
    const change = vi.fn()
    render(<Harness onChange={change} />)
    select("custom")
    fireEvent.click(screen.getByRole("button", { name: "Apply dates" }))
    expect(screen.getByRole("alert").textContent).toBe("Enter a valid start date.")
    expect(input("From").getAttribute("aria-invalid")).toBe("true")
    fireEvent.change(input("From"), { target: { value: "2024-06-01" } })
    fireEvent.change(input("Through"), { target: { value: "2024-05-01" } })
    fireEvent.click(screen.getByRole("button", { name: "Apply dates" }))
    expect(screen.getByRole("alert").textContent).toContain("on or after")
    expect(input("Through").getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id)
    expect(change).not.toHaveBeenCalled()
    fireEvent.change(input("Through"), { target: { value: "2024-06-01" } })
    fireEvent.keyDown(input("Through"), { key: "Enter" })
    expect(change).toHaveBeenLastCalledWith({ kind: "custom", from: "2024-06-01", through: "2024-06-01" })
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("initializes custom source dates from authoritative calendar coverage without a timezone shift", () => {
    render(<Harness
      timeZone="America/Los_Angeles"
      coverageDates={{ from: "1950-01-01", through: "2024-03-10" }}
    />)
    select("custom")
    expect(input("From").value).toBe("1950-01-01")
    expect(input("Through").value).toBe("2024-03-10")
  })

  it("leaves custom dates blank for explicitly empty timestamp coverage", () => {
    render(<Harness coverage={{ startMs: 0, endMs: 0 }} />)
    select("custom")
    expect(input("From").value).toBe("")
    expect(input("Through").value).toBe("")
  })

  it("preserves an in-progress draft on equal controlled rerenders and follows navigation to a different period", () => {
    const change = vi.fn()
    const period: HistoryPeriod = { kind: "custom", from: "2020-01-01", through: "2025-12-31" }
    const view = render(<HistoryPeriodSelect value={period} onChange={change} />)
    fireEvent.change(input("From"), { target: { value: "1960-01-01" } })
    view.rerender(<HistoryPeriodSelect value={{ ...period }} onChange={change} />)
    expect(input("From").value).toBe("1960-01-01")
    view.rerender(<HistoryPeriodSelect value="all" onChange={change} />)
    expect(screen.queryByLabelText("From")).toBeNull()
    expect(screen.getByRole("combobox").textContent).toContain("All history")
    expect(change).not.toHaveBeenCalled()
  })

  it("does not submit a containing form when applying dates with Enter", () => {
    const submit = vi.fn((event) => event.preventDefault())
    const change = vi.fn()
    render(<form onSubmit={submit}><Harness onChange={change} initialValue={{ kind: "custom", from: "2020-01-01", through: "2025-12-31" }} /></form>)
    fireEvent.keyDown(input("Through"), { key: "Enter" })
    expect(change).toHaveBeenCalledOnce()
    expect(submit).not.toHaveBeenCalled()
  })
})
