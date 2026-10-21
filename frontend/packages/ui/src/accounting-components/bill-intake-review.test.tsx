import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { billIntakeReview } from "./bill-intake-review-model"
import { BillIntakeReview, type BillIntakeReviewProps } from "./bill-intake-review"

vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))
afterEach(cleanup)

const bill = { id: 10n, organizationId: 1n, companyId: 2n, moveType: { tag: "InInvoice" }, state: { tag: "Draft" }, partnerId: 4n, name: "Vendor bill A", ref: "INV-A", invoiceDate: { microsSinceUnixEpoch: BigInt(Date.UTC(2026, 0, 15)) * 1000n }, amountTotal: 100 }
const line = { id: 20n, organizationId: 1n, companyId: 2n, moveId: 10n, accountId: 5n, debit: 100, credit: 0 }
const props = (overrides: Partial<BillIntakeReviewProps> = {}): BillIntakeReviewProps => ({ organizationId: 1n, companyId: 2n, bills: [bill], lines: [line, { ...line, id: 21n, debit: 0, credit: 100 }], sourceState: { status: "ready" }, onOpenBill: vi.fn(), ...overrides })

describe("bill intake canonical review", () => {
  it("joins only scoped lines and presents concrete exceptions", () => {
    const review = billIntakeReview(props({ bills: [{ ...bill, partnerId: null, ref: null, amountTotal: 0 }], lines: [line, { ...line, id: 23n, organizationId: 9n, debit: 0, credit: 100 }] }))
    expect(review.available).toBe(true)
    expect(review.items[0]?.issues).toEqual(["supplier", "reference", "balance", "total"])
    expect(review.items[0]?.lineCount).toBe(1)
  })

  it("fails closed for incomplete ownership or duplicate canonical IDs", () => {
    expect(billIntakeReview(props({ lines: [{ ...line, companyId: undefined }] })).available).toBe(false)
    expect(billIntakeReview(props({ bills: [bill, bill] })).available).toBe(false)
    expect(billIntakeReview(props({ lines: [line, line] })).available).toBe(false)
  })

  it("does not show posted bills or another company's rows as draft work", () => {
    const review = billIntakeReview(props({ bills: [{ ...bill, state: { posted: [] } }, { ...bill, id: 11n, companyId: 3n }] }))
    expect(review).toEqual({ available: true, items: [] })
  })

  it("opens the exact bill in the existing review path", () => {
    const onOpenBill = vi.fn()
    render(<BillIntakeReview {...props({ onOpenBill })} />)
    fireEvent.click(screen.getByRole("button", { name: "Review bill" }))
    expect(onOpenBill).toHaveBeenCalledWith(bill)
    expect(screen.getByRole("link", { name: "Review orders and receipts" }).getAttribute("href")).toBe("/purchasing?tab=orders")
  })

  it("hides cached rows on partial reads and provides retry", () => {
    const retry = vi.fn()
    const { rerender } = render(<BillIntakeReview {...props({ sourceState: { status: "partial", onRetry: retry } })} />)
    expect(screen.queryByText("Vendor bill A")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(retry).toHaveBeenCalledTimes(1)
    rerender(<BillIntakeReview {...props()} />)
    expect(screen.getByText("Vendor bill A")).toBeTruthy()
  })

  it("clears visible bill data and actions when access or company changes", () => {
    const { rerender } = render(<BillIntakeReview {...props()} />)
    rerender(<BillIntakeReview {...props({ sourceState: { status: "denied" } })} />)
    expect(screen.queryByText("Vendor bill A")).toBeNull()
    expect(screen.queryByRole("button", { name: "Review bill" })).toBeNull()
    rerender(<BillIntakeReview {...props({ companyId: 3n })} />)
    expect(screen.queryByText("Vendor bill A")).toBeNull()
    expect(screen.getByText("No draft bills in this company.")).toBeTruthy()
  })
})
