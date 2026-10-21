import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EmptyStateCard } from "./empty-state-card"

afterEach(cleanup)

describe("EmptyStateCard", () => {
  it("renders the title, description, both CTAs and the hint", () => {
    const onPrimary = vi.fn()
    const onSecondary = vi.fn()
    render(
      <EmptyStateCard
        data-testid="card"
        title="No orders yet"
        description="Orders turn quotes into revenue."
        primaryAction={{ label: "New order", onClick: onPrimary }}
        secondaryAction={{ label: "Import CSV", onClick: onSecondary }}
        hint="Learn how orders flow"
      />,
    )
    expect(screen.getByText("No orders yet")).toBeTruthy()
    expect(screen.getByText("Orders turn quotes into revenue.")).toBeTruthy()
    fireEvent.click(screen.getByTestId("entity-empty-cta"))
    fireEvent.click(screen.getByTestId("entity-empty-secondary-cta"))
    expect(onPrimary).toHaveBeenCalledTimes(1)
    expect(onSecondary).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("entity-empty-hint").textContent).toBe("Learn how orders flow")
    expect(screen.getByTestId("card").getAttribute("data-compact")).toBeNull()
  })

  it("shows the read-only message only when there is no primary action", () => {
    const { rerender } = render(<EmptyStateCard title="t" readOnlyMessage="Ask an admin" />)
    expect(screen.getByTestId("entity-empty-read-only").textContent).toBe("Ask an admin")
    rerender(<EmptyStateCard title="t" readOnlyMessage="Ask an admin" primaryAction={{ label: "Go", onClick: vi.fn() }} />)
    expect(screen.queryByTestId("entity-empty-read-only")).toBeNull()
  })

  it("marks the compact variant and renders no buttons without actions", () => {
    render(<EmptyStateCard compact title="Nothing here" data-testid="card" />)
    expect(screen.getByTestId("card").getAttribute("data-compact")).toBe("true")
    expect(screen.queryByTestId("entity-empty-cta")).toBeNull()
  })

  it("disables a CTA that is pending", () => {
    render(<EmptyStateCard title="t" primaryAction={{ label: "Go", onClick: vi.fn(), disabled: true }} />)
    expect((screen.getByTestId("entity-empty-cta") as HTMLButtonElement).disabled).toBe(true)
  })
})
