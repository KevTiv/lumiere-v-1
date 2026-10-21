import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { CreateInvoiceModal } from "./create-invoice-modal"

vi.mock("../forms/hooks/use-form-config", () => ({
  useFormConfiguration: () => ({ config: { fields: [] } }),
}))

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  if (typeof globalThis.PointerEvent === "undefined") Object.defineProperty(globalThis, "PointerEvent", { value: MouseEvent, configurable: true })
})

afterEach(cleanup)

const props = {
  open: true,
  companyId: 10n,
  currencyOptions: [{ value: "4", label: "Euro", code: "EUR" }],
  journalOptions: [{ value: "35", label: "Sales journal", currencyId: "4" }],
  partnerOptions: [{ value: "223", label: "Example customer" }],
  counterpartAccountOptions: [{ value: "1200", label: "Receivables" }],
  lineAccountOptions: [{ value: "4000", label: "Consulting revenue" }],
  profile: { logoUrl: "", accent: "teal" as const, email: "", phone: "", website: "", notice: "", terms: "", paymentInstructions: "", footer: "" },
  seller: { name: "Example company", address: [], taxId: "", registrationNumber: "", email: "", phone: "", website: "" },
  personalizationState: { status: "ready" as const },
  onClose: () => {},
  onCheckStatus: async () => null,
}

describe("manual invoice document preview", () => {
  it("shows the edited document and keeps preview actions separate from saving", async () => {
    const onSave = vi.fn()
    render(<CreateInvoiceModal {...props} onSave={onSave} />)
    fireEvent.click(screen.getByTestId("create-invoice-partner"))
    fireEvent.click(await screen.findByRole("option", { name: "Example customer" }))
    fireEvent.change(screen.getByTestId("create-invoice-line-description"), { target: { value: "Consulting work" } })
    fireEvent.change(screen.getByTestId("create-invoice-line-unit-price"), { target: { value: "100" } })
    fireEvent.change(screen.getByLabelText("Item 1 quantity"), { target: { value: "1.5" } })
    fireEvent.click(screen.getByTestId("create-invoice-preview-toggle"))

    const preview = within(await screen.findByTestId("invoice-document"))
    expect(preview.getByText("Draft document")).toBeTruthy()
    expect(preview.getByText("Example company")).toBeTruthy()
    expect(preview.getByText("Example customer")).toBeTruthy()
    expect(preview.getByText("Consulting work")).toBeTruthy()
    expect(preview.getByRole("cell", { name: /EUR\s150\.00/ })).toBeTruthy()
    expect(preview.getByText(/Draft preview. Review and confirm totals before posting/)).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    expect((await screen.findByTestId("create-invoice-line-description") as HTMLInputElement).value).toBe("Consulting work")
    expect((screen.getByTestId("create-invoice-line-unit-price") as HTMLInputElement).value).toBe("100")
  })

  it("uses bill wording and does not claim a missing partner has been selected", async () => {
    render(<CreateInvoiceModal {...props} kind="bill" onSave={vi.fn()} />)
    fireEvent.click(screen.getByTestId("create-invoice-preview-toggle"))
    const preview = within(await screen.findByTestId("invoice-document"))
    expect(preview.getByText("Vendor bill")).toBeTruthy()
    expect(preview.getByText("Vendor")).toBeTruthy()
    expect(preview.queryByText("Example customer")).toBeNull()
  })
})
