import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WorkflowError } from "@lumiere/erp-workflows"
import { chooseSelectValue } from "../components/select-test-utils"
import { ApplyPostedPaymentDialog, type ApplyPostedPaymentDialogProps } from "./apply-posted-payment-dialog"

vi.mock("@lumiere/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lumiere/i18n")>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { defaultValue?: string; [name: string]: unknown }) =>
        options?.defaultValue ? actual.i18n.t(key, { ...options, lng: "en" }) : key,
    }),
  }
})
afterEach(cleanup)
const props = (): ApplyPostedPaymentDialogProps => ({ options: [{ value: "9007199254740993", label: "PAY/001" }], sourceState: { status: "ready" }, canApply: true, isPending: false, onApply: vi.fn().mockResolvedValue(undefined), onClose: vi.fn() })

describe("applying an existing posted payment", () => {
  it.each(["loading", "error", "denied", "partial"] as const)("does not turn a %s read into a successful empty list or offer cached payments", (status) => {
    const p = props()
    render(<ApplyPostedPaymentDialog {...p} sourceState={{ status }} />)
    expect(screen.queryByText("No posted payments available")).toBeNull()
    expect(screen.queryByRole("combobox")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Apply payment" }))
    expect(p.onApply).not.toHaveBeenCalled()
  })
  it("gives a useful empty-state path to record and post a payment first", () => {
    render(<ApplyPostedPaymentDialog {...props()} options={[]} />)
    expect(screen.getByText("No posted payments available")).toBeTruthy()
    expect(screen.getByText(/complete any required approval and posting/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Open Payments" }).getAttribute("href")).toBe("/accounting?tab=payments")
  })
  it("retains a rejected selection and only closes after a confirmed callback", async () => {
    const p = props()
    const onApply = vi.fn().mockRejectedValueOnce(new Error("Payment was rejected")).mockResolvedValueOnce(undefined)
    render(<ApplyPostedPaymentDialog {...p} onApply={onApply} />)
    chooseSelectValue(screen.getByRole("combobox", { name: "Posted payment" }), "9007199254740993")
    fireEvent.click(screen.getByRole("button", { name: "Apply payment" }))
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Payment was rejected")
    expect(screen.getByRole("combobox").textContent).toContain("PAY/001")
    expect(p.onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Apply payment" }))
    await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce())
    expect(onApply).toHaveBeenNthCalledWith(2, "9007199254740993")
  })
  it("blocks a revoked selection and permission changes without discarding values", async () => {
    const p = props()
    const { rerender } = render(<ApplyPostedPaymentDialog {...p} />)
    chooseSelectValue(screen.getByRole("combobox", { name: "Posted payment" }), "9007199254740993")
    rerender(<ApplyPostedPaymentDialog {...p} canApply={false} />)
    fireEvent.click(screen.getByRole("button", { name: "Apply payment" }))
    expect(p.onApply).not.toHaveBeenCalled()
    expect(screen.getByText(/You need permission/)).toBeTruthy()
    rerender(<ApplyPostedPaymentDialog {...p} options={[{ value: "2", label: "Different payment" }]} />)
    fireEvent.click(screen.getByRole("button", { name: "Apply payment" }))
    expect(p.onApply).not.toHaveBeenCalled()
  })
  it("blocks resubmission after an unconfirmed result and offers canonical payment review", async () => {
    const p = props()
    p.onApply = vi.fn().mockRejectedValue(new WorkflowError("outcome_unknown", "The original result could not be confirmed"))
    render(<ApplyPostedPaymentDialog {...p} />)
    chooseSelectValue(screen.getByRole("combobox", { name: "Posted payment" }), "9007199254740993")
    fireEvent.click(screen.getByRole("button", { name: "Apply payment" }))
    await screen.findByText(/The result is unconfirmed/)
    fireEvent.click(screen.getByRole("button", { name: "Apply payment" }))
    expect(p.onApply).toHaveBeenCalledOnce()
    expect(p.onClose).not.toHaveBeenCalled()
    expect(screen.getByRole("link", { name: "Open Payments" })).toBeTruthy()
  })
  it("prevents duplicate submission and dismissal while confirming", async () => {
    const p = props()
    let finish!: () => void
    p.onApply = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    render(<ApplyPostedPaymentDialog {...p} />)
    chooseSelectValue(screen.getByRole("combobox", { name: "Posted payment" }), "9007199254740993")
    const button = screen.getByRole("button", { name: "Apply payment" })
    fireEvent.click(button); fireEvent.click(button)
    expect(p.onApply).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }))
    expect(p.onClose).not.toHaveBeenCalled()
    finish()
    await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce())
  })
})
