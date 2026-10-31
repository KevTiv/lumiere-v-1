import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PurchaseDiscrepancyPanel } from "../../../../web/app/(modules)/purchasing/purchase-discrepancy-panel"

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }))
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))
const ready = { status: "ready" as const }
const scope = { organizationId: 1n, companyId: 2n }
const order = { ...scope, id: "7", name: "PO Seven", state: "Purchase", receiptStatus: "partial", invoiceIds: ["21"] }
const line = { ...scope, id: "8", orderId: "7", name: "Material line", state: "Draft", productQty: 10, qtyReceived: 5, qtyInvoiced: 8 }
const props = { scope, orders: [order], lines: [line], partialQueue: [order], overBilledQueue: [line],
  pickings: [{ ...scope, id: "31", purchaseId: "7", pickingCode: "incoming", state: "Done" }],
  bills: [{ ...scope, id: "21", name: "Vendor Bill Exact", moveType: "InInvoice", state: "Draft" }],
  states: { partial: ready, overBilled: ready, orders: ready, lines: ready, receipts: ready, bills: ready } }
afterEach(cleanup)

describe("read-only purchasing discrepancy review", () => {
  it("shows quantities and exact existing owner links without a write action", () => {
    render(<PurchaseDiscrepancyPanel {...props} />)
    expect(screen.getByRole("link", { name: "Material line" }).getAttribute("href")).toBe("/purchasing?tab=lines&filter=id%3A8")
    expect(screen.getAllByRole("link", { name: "Review order receipts and vendor bills" })[0].getAttribute("href")).toBe("/purchasing/orders/7?tab=handoffs")
    expect(screen.getAllByRole("link", { name: "bill: Vendor Bill Exact" })[0].getAttribute("href")).toBe("/accounting?tab=journal-entries&filter=id%3A21")
    expect(screen.getByText("Ordered")).toBeTruthy()
    expect(screen.queryAllByRole("button")).toHaveLength(0)
  })

  it("removes stale rows after a failed/denied parent read and retries the owning source", () => {
    const retry = vi.fn()
    const { rerender } = render(<PurchaseDiscrepancyPanel {...props} />)
    rerender(<PurchaseDiscrepancyPanel {...props} states={{ ...props.states, orders: { status: "error", onRetry: retry } }} />)
    expect(screen.queryByText("Material line")).toBeNull()
    expect(screen.queryByRole("link", { name: "PO Seven" })).toBeNull()
    fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0])
    expect(retry).toHaveBeenCalled()
    rerender(<PurchaseDiscrepancyPanel {...props} states={{ ...props.states, orders: { status: "denied" } }} />)
    expect(screen.queryByText("Material line")).toBeNull()
    expect(screen.queryByText("No verified discrepancies in this queue.")).toBeNull()
  })

  it("separates a verified empty queue from loading and failed linked-record reads", () => {
    const { rerender } = render(<PurchaseDiscrepancyPanel {...props} partialQueue={[]} overBilledQueue={[]} />)
    expect(screen.getAllByText("No verified discrepancies in this queue.")).toHaveLength(2)
    rerender(<PurchaseDiscrepancyPanel {...props} states={{ ...props.states, receipts: { status: "error" } }} />)
    expect(screen.getByRole("link", { name: "Material line" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "bill: Vendor Bill Exact" })).toBeNull()
    rerender(<PurchaseDiscrepancyPanel {...props} states={{ ...props.states, partial: { status: "loading" }, overBilled: { status: "loading" } }} />)
    expect(screen.queryByText("Material line")).toBeNull()
    expect(screen.queryByText("No verified discrepancies in this queue.")).toBeNull()
  })

  it("never retains another company's queued records after scope changes", () => {
    const { rerender } = render(<PurchaseDiscrepancyPanel {...props} />)
    rerender(<PurchaseDiscrepancyPanel {...props} scope={{ ...scope, companyId: 3n }} />)
    expect(screen.queryByText("Material line")).toBeNull()
    expect(screen.queryByRole("link", { name: "PO Seven" })).toBeNull()
  })
})
