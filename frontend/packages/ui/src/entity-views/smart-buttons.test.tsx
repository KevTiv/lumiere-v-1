import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { SmartButtons } from "./smart-buttons"

afterEach(cleanup)

describe("SmartButtons", () => {
  it("shows the count and label, linking when there is an href", () => {
    render(<SmartButtons testIdPrefix="so" buttons={[{ id: "invoices", label: "Invoices", count: 2, href: "/x" }]} />)
    const button = screen.getByTestId("so-smart-invoices")
    expect(button.textContent).toContain("2")
    expect(button.textContent).toContain("Invoices")
    expect(button.getAttribute("href")).toBe("/x")
  })

  it("runs onClick for a button that stays on the page", () => {
    const onClick = vi.fn()
    render(<SmartButtons testIdPrefix="so" buttons={[{ id: "lines", label: "Lines", count: 3, onClick }]} />)
    fireEvent.click(screen.getByTestId("so-smart-lines"))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("hides a zero-count button only when asked to, and renders nothing when none are left", () => {
    const { container, rerender } = render(
      <SmartButtons
        testIdPrefix="so"
        buttons={[
          { id: "a", label: "A", count: 0 },
          { id: "b", label: "B", count: 0, hideWhenZero: true },
        ]}
      />,
    )
    expect(screen.getByTestId("so-smart-a")).toBeTruthy()
    expect(screen.queryByTestId("so-smart-b")).toBeNull()

    rerender(<SmartButtons testIdPrefix="so" buttons={[{ id: "b", label: "B", count: 0, hideWhenZero: true }]} />)
    expect(container.firstChild).toBeNull()
  })
})
