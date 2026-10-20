import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Button } from "../components/button"
import { DashboardHeader } from "./dashboard-header"

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

afterEach(cleanup)

describe("DashboardHeader action hierarchy", () => {
  it("gives the first unspecified action prominence without consuming it for explicit variants", () => {
    const create = vi.fn()
    render(<DashboardHeader title="Accounting" actions={[
      { label: "Delete", variant: "destructive", onClick: vi.fn() },
      { label: "Export", variant: "outline", onClick: vi.fn() },
      { label: "New invoice", onClick: create },
      { label: "Import", onClick: vi.fn() },
    ]} />)

    expect(screen.getByRole("button", { name: "New invoice" }).classList.contains("bg-primary")).toBe(true)
    expect(screen.getByRole("button", { name: "Import" }).classList.contains("bg-primary")).toBe(false)
    expect(screen.getByRole("button", { name: "Delete" }).classList.contains("text-destructive")).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "New invoice" }))
    expect(create).toHaveBeenCalledOnce()
  })

  it("keeps unspecified actions secondary when the caller supplies the primary action", () => {
    render(<DashboardHeader title="Accounting" primaryAction={<Button>New invoice</Button>} actions={[
      { label: "Import", onClick: vi.fn() },
      { label: "Export", onClick: vi.fn() },
      { label: "Explicit primary", variant: "default", onClick: vi.fn() },
    ]} />)

    expect(screen.getByRole("button", { name: "New invoice" }).classList.contains("bg-primary")).toBe(true)
    expect(screen.getByRole("button", { name: "Import" }).classList.contains("bg-primary")).toBe(false)
    expect(screen.getByRole("button", { name: "Export" }).classList.contains("bg-primary")).toBe(false)
    expect(screen.getByRole("button", { name: "Explicit primary" }).classList.contains("bg-primary")).toBe(true)
  })

  it("does not reserve an action for a conditional null primary slot", () => {
    render(<DashboardHeader title="Accounting" primaryAction={null} actions={[
      { label: "New invoice", onClick: vi.fn() },
      { label: "Import", onClick: vi.fn() },
    ]} />)
    expect(screen.getByRole("button", { name: "New invoice" }).classList.contains("bg-primary")).toBe(true)
    expect(screen.getByRole("button", { name: "Import" }).classList.contains("bg-primary")).toBe(false)
  })
})
