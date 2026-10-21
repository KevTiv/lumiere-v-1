import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import type { InvoiceFormPayload } from "./create-invoice-modal"
import { CreateInvoiceModal } from "./create-invoice-modal"

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  if (typeof globalThis.PointerEvent === "undefined") {
    Object.defineProperty(globalThis, "PointerEvent", {
      value: MouseEvent,
      configurable: true,
    })
  }
})

vi.mock("../forms/hooks/use-form-config", () => ({
  useFormConfiguration: () => ({ config: { fields: [] } }),
}))

afterEach(cleanup)

describe("CreateInvoiceModal", () => {
  const configuredProps = {
    journalOptions: [{ value: "35", label: "Sales journal" }],
    partnerOptions: [{ value: "223", label: "Kigali Retail Ltd" }],
    accountOptions: [{ value: "4000", label: "4000 — Consulting revenue" }],
    counterpartAccountOptions: [{ value: "1200", label: "1200 — Accounts receivable" }],
    taxOptions: [{ value: "18", label: "VAT 18%", rate: 18 }],
    currencyId: 4n,
    currencyCode: "EUR",
  }

  const selectPartner = async () => {
    fireEvent.click(screen.getByTestId("create-invoice-partner"))
    fireEvent.click(await screen.findByRole("option", { name: "Kigali Retail Ltd" }))
  }

  it("emits valid business dates and preserves a fractional quantity", async () => {
    const onSave = vi.fn<(payload: InvoiceFormPayload) => void>()
    render(<CreateInvoiceModal open onClose={() => {}} onSave={onSave} {...configuredProps} />)

    await selectPartner()
    fireEvent.change(screen.getByLabelText("Invoice Date"), {
      target: { value: "2026-10-15" },
    })
    fireEvent.change(screen.getByLabelText("Due Date"), {
      target: { value: "2026-11-15" },
    })
    fireEvent.change(screen.getByTestId("create-invoice-line-description"), {
      target: { value: "Consulting" },
    })
    fireEvent.change(screen.getByLabelText("Qty"), {
      target: { value: "1.5" },
    })
    fireEvent.change(screen.getByTestId("create-invoice-line-unit-price"), {
      target: { value: "100" },
    })
    fireEvent.click(screen.getByTestId("create-invoice-line-tax"))
    fireEvent.click(await screen.findByRole("option", { name: "VAT 18%" }))
    fireEvent.click(screen.getByTestId("create-invoice-save-draft"))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const payload = onSave.mock.calls[0][0]
    expect(payload.date).toBe("2026-10-15")
    expect(payload.invoiceDate).toBe("2026-10-15")
    expect(payload.invoiceDateDue).toBe("2026-11-15")
    expect(payload.journalId).toBe(35n)
    expect(payload.currencyId).toBe(4n)
    expect(payload.partnerId).toBe(223n)
    expect(payload.counterpartAccountId).toBe(1200n)
    expect(payload.moveType).toBe("OutInvoice")
    expect(payload.type).toBe("invoice-draft")
    expect(payload.idempotencyKey).toMatch(/^create-manual-invoice:/)
    expect(payload.lineItems[0]).toMatchObject({
      accountId: 4000n,
      description: "Consulting",
      quantity: 1.5,
      unitPrice: 100,
      taxId: 18n,
      amountUntaxed: 150,
      amountTax: 27,
      amountTotal: 177,
    })
    expect(payload.amountTotal).toBe(177)
  })

  it("requires a valid invoice date before saving", async () => {
    const onSave = vi.fn()
    render(<CreateInvoiceModal open onClose={() => {}} onSave={onSave} {...configuredProps} />)

    await selectPartner()
    fireEvent.change(screen.getByTestId("create-invoice-line-description"), {
      target: { value: "Consulting" },
    })
    fireEvent.change(screen.getByLabelText("Invoice Date"), {
      target: { value: "" },
    })

    expect(screen.getByTestId("create-invoice-save-draft").hasAttribute("disabled")).toBe(true)
  })

  it("emits a vendor bill only as a draft command", async () => {
    const onSave = vi.fn<(payload: InvoiceFormPayload) => void>()
    render(
      <CreateInvoiceModal
        open
        documentKind="bill"
        formId="new-bill"
        onClose={() => {}}
        onSave={onSave}
        {...configuredProps}
        journalOptions={[{ value: "45", label: "Purchase journal" }]}
        accountOptions={[{ value: "6000", label: "6000 — Professional services" }]}
        counterpartAccountOptions={[{ value: "2100", label: "2100 — Accounts payable" }]}
      />,
    )

    await selectPartner()
    fireEvent.change(screen.getByTestId("create-invoice-line-description"), {
      target: { value: "Legal services" },
    })
    fireEvent.change(screen.getByTestId("create-invoice-line-unit-price"), {
      target: { value: "250" },
    })
    expect(screen.queryByTestId("create-invoice-submit")).toBeNull()
    fireEvent.click(screen.getByTestId("create-invoice-save-draft"))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toMatchObject({
      type: "invoice-draft",
      moveType: "InInvoice",
      journalId: 45n,
      counterpartAccountId: 2100n,
    })
  })
})
