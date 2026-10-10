import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { KpiStrip, type KpiStripTile } from "./kpi-strip"

afterEach(cleanup)

const tile = (over: Partial<KpiStripTile> = {}): KpiStripTile => ({
  key: "late",
  label: "Late",
  value: 4,
  active: false,
  onSelect: () => {},
  ...over,
})

describe("KpiStrip", () => {
  it("renders label, value and hint, and reports the pressed state", () => {
    render(<KpiStrip tiles={[tile({ hint: "of 9" }), tile({ key: "ready", label: "Ready", value: 2, active: true })]} />)
    expect(screen.getByTestId("kpi-tile-late").textContent).toContain("Late")
    expect(screen.getByTestId("kpi-tile-late-value").textContent).toBe("4")
    expect(screen.getByTestId("kpi-tile-late").textContent).toContain("of 9")
    expect(screen.getByTestId("kpi-tile-late").getAttribute("aria-pressed")).toBe("false")
    expect(screen.getByTestId("kpi-tile-ready").getAttribute("aria-pressed")).toBe("true")
  })

  it("calls onSelect on click", () => {
    const onSelect = vi.fn()
    render(<KpiStrip tiles={[tile({ onSelect })]} />)
    fireEvent.click(screen.getByTestId("kpi-tile-late"))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it("renders a tile without onSelect as plain text", () => {
    render(<KpiStrip tiles={[tile({ onSelect: undefined })]} />)
    expect(screen.getByTestId("kpi-tile-late").tagName).toBe("DIV")
  })

  it("shows placeholders instead of figures while loading, and nothing with no tiles", () => {
    const { container, rerender } = render(<KpiStrip tiles={[tile()]} loading />)
    expect(screen.getByTestId("kpi-tile-late-loading")).toBeTruthy()
    expect(screen.queryByTestId("kpi-tile-late-value")).toBeNull()
    rerender(<KpiStrip tiles={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
