import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { InvoiceWorkflowGuide, type InvoiceWorkflowGuideProps } from "./invoice-workflow-guide"

vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))
afterEach(cleanup)
const props: InvoiceWorkflowGuideProps = { stage: "draft", isBill: false, amountDue: "EUR 100.00", onReviewLines: vi.fn(), paymentsHref: "/accounting?tab=payments" }

describe("invoice and bill next steps", () => {
  it("explains draft versus posting and keeps a blocked action's reason visible", () => {
    const onClick = vi.fn()
    render(<InvoiceWorkflowGuide {...props} primaryAction={{ label: "Post invoice", onClick, blockedReason: "Company identity must be loaded" }} />)
    expect(screen.getByText(/Saving a draft does not post it to the ledger/)).toBeTruthy()
    expect(screen.getByTestId("invoice-next-step-blocked").textContent).toBe("Company identity must be loaded")
    fireEvent.click(screen.getByRole("button", { name: "Post invoice" }))
    expect(onClick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Review line items" }))
    expect(props.onReviewLines).toHaveBeenCalledOnce()
  })
  it.each([false, true])("explains an existing payment's effect for isBill=%s without claiming transfer or delivery", (isBill) => {
    render(<InvoiceWorkflowGuide {...props} stage="posted" isBill={isBill} />)
    expect(screen.getByText(/Amount due: EUR 100.00/)).toBeTruthy()
    expect(screen.getByText(isBill ? /does not send money to your vendor/ : /does not charge your customer/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Open Payments" }).getAttribute("href")).toBe("/accounting?tab=payments")
    if (!isBill) expect(screen.getByText(/do not confirm email delivery/)).toBeTruthy()
  })
  it("links paid documents to their actual payment section and keeps bank matching separate", () => {
    render(<InvoiceWorkflowGuide {...props} stage="paid" paymentsHref="#invoice-linked-payments" />)
    expect(screen.getByRole("link", { name: "View linked payments" }).getAttribute("href")).toBe("#invoice-linked-payments")
    expect(screen.getByText(/Bank matching is a separate step/)).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
  })
  it.each(["cancelled", "unavailable"] as const)("does not suggest posting or payment for %s records", (stage) => {
    render(<InvoiceWorkflowGuide {...props} stage={stage} />)
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.queryByText("Payment complete")).toBeNull()
  })
})
