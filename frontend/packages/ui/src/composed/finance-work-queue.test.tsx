import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OwnerControlLoop } from "../../../../web/app/(modules)/overview/owner-control-loop"
import { WorkspaceProfileProvider } from "../lib/workspace-profile-context"
const denied = vi.hoisted(() => new Set<string>())
vi.mock("@/lib/rbac-context", () => ({ useRBAC: () => ({ checkPermission: (resource: string) => ({ allowed: !denied.has(resource) }) }) }))
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a> }))
const props = { overdueInvoices: 0, unreconciledPayments: 2, lowStockProducts: 9, pendingMessageApprovals: 0, draftBills: 1, expenseApprovals: 0 }
function queue(overrides: Partial<typeof props> = {}) { return <WorkspaceProfileProvider value="finance-alpha"><OwnerControlLoop {...props} {...overrides} /></WorkspaceProfileProvider> }
beforeEach(() => denied.clear())
afterEach(cleanup)
describe("Finance work queue", () => {
  it("prioritizes open work, counts queues rather than adding unlike records, and links to task areas", () => {
    render(queue())
    expect(screen.getByText("2 queues need attention")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Reconcile payments" }).getAttribute("href")).toBe("/accounting?tab=payment-operations")
    expect(screen.queryByTestId("finance-queue-lowStockProducts")).toBeNull()
    const rows = document.querySelectorAll('[data-testid^="finance-queue-"]')
    expect(rows[0]?.getAttribute("data-testid")).toBe("finance-queue-unreconciledPayments")
  })
  it("does not expose a queue that the current role cannot read", () => {
    denied.add("hr_expense_sheet")
    render(queue({ expenseApprovals: 5 }))
    expect(screen.queryByTestId("finance-queue-expenseApprovals")).toBeNull()
  })
  it("keeps unavailable and missing-company counts separate from zero", () => {
    const view = render(<WorkspaceProfileProvider value="finance-alpha"><OwnerControlLoop {...props} expenseApprovals="Unavailable" /></WorkspaceProfileProvider>)
    expect(screen.getByTestId("finance-queue-expenseApprovals").textContent).toContain("Unavailable")
    expect(screen.getByText("Some counts unavailable")).toBeTruthy()
    view.rerender(<WorkspaceProfileProvider value="finance-alpha"><OwnerControlLoop {...props} companyReady={false} /></WorkspaceProfileProvider>)
    expect(screen.getByTestId("finance-queue-draftBills").textContent).toContain("Select a company")
  })
})
