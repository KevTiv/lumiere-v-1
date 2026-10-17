import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ReconciliationWorkbench, type ReconciliationOutcome } from "./reconciliation-workbench"
import type { ReconciliationRequest, ReconciliationSource } from "./reconciliation-workbench-model"

vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
afterEach(cleanup)

function fixture(): ReconciliationSource {
  const line = { id: 10n, organizationId: 1n, statementId: 2n, journalId: 3n, amount: 1000, currencyId: null, journalCurrencyId: 7n, foreignCurrencyId: null, isReconciled: false, moveIds: [], transactionType: "Customer transfer" }
  return {
    organizationId: 1n, companyId: 4n, companyCurrencyId: 7n, state: { status: "ready" },
    statement: { id: 2n, organizationId: 1n, companyId: 4n, journalId: 3n, currencyId: 7n, state: "Open", name: "January statement" }, line, bankLines: [line],
    moves: [{ id: 20n, organizationId: 1n, companyId: 4n, name: "INV/001", state: "Posted", invoicePartnerDisplayName: "Alpha customer" }, { id: 21n, organizationId: 1n, companyId: 4n, name: "INV/002", state: "Posted", invoicePartnerDisplayName: "Beta customer" }],
    accounts: [{ id: 30n, organizationId: 1n, companyId: 4n, name: "Receivable", code: "1100", reconcile: true, deprecated: false }],
    moveLines: [
      { id: 40n, organizationId: 1n, companyId: 4n, moveId: 20n, accountId: 30n, companyCurrencyId: 7n, currencyId: 7n, parentState: "Posted", name: "Consulting", debit: 600, credit: 0, balance: 600, amountResidual: 600, blocked: false },
      { id: 41n, organizationId: 1n, companyId: 4n, moveId: 21n, accountId: 30n, companyCurrencyId: 7n, currencyId: 7n, parentState: "Posted", name: "Support", debit: 400, credit: 0, balance: 400, amountResidual: 400, blocked: false },
    ], currencies: [{ id: 7n, code: "EUR", decimalPlaces: 2, roundingFactor: 0.01 }],
  }
}
const reviewLabel = /I reviewed the statement/
function selectExactMatch() {
  fireEvent.click(screen.getByRole("checkbox", { name: "Select INV/001, Consulting" }))
  fireEvent.click(screen.getByRole("checkbox", { name: "Select INV/002, Support" }))
}
describe("bank matching desk", () => {
  it("requires explicit selection and reviewed exact totals before a single bank-line confirmation", async () => {
    const onConfirm = vi.fn().mockResolvedValue({ status: "confirmed" })
    render(<ReconciliationWorkbench source={fixture()} canReconcile onConfirm={onConfirm} />)
    const confirm = screen.getByTestId("reconciliation-confirm") as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(screen.getByRole("link", { name: "INV/001" }).getAttribute("href")).toBe("/accounting/invoices/20")
    selectExactMatch()
    expect(confirm.disabled).toBe(true)
    const review = screen.getByRole("region", { name: "Review selected matches" })
    expect(within(review).getByText("Difference").nextElementSibling?.textContent).toContain("0.00")
    fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }))
    fireEvent.click(confirm)
    await screen.findByText("Bank-line link confirmed")
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onConfirm.mock.calls[0]![0]).toEqual({ organizationId: "1", companyId: "4", statementId: "2", lineId: "10", moveLineIds: ["40", "41"], amountResidual: 0 })
    expect(screen.getByText(/Invoice and payment balances have not been settled/)).toBeTruthy()
  })
  it("searches readable document, partner, account and item labels without losing selections", () => {
    render(<ReconciliationWorkbench source={fixture()} canReconcile onConfirm={vi.fn()} />)
    fireEvent.click(screen.getByRole("checkbox", { name: "Select INV/001, Consulting" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Search matching records" }), { target: { value: "Beta customer" } })
    expect(screen.queryByTestId("reconciliation-candidate-40")).toBeNull()
    expect(screen.getByTestId("reconciliation-candidate-41")).toBeTruthy()
    expect(screen.getByText("1 selected journal item")).toBeTruthy()
    fireEvent.change(screen.getByRole("textbox", { name: "Search matching records" }), { target: { value: "" } })
    expect((screen.getByRole("checkbox", { name: "Select INV/001, Consulting" }) as HTMLInputElement).checked).toBe(true)
  })
  it("invalidates review on live amount changes and clears obsolete selected records explicitly", () => {
    const source = fixture()
    const props = { canReconcile: true, onConfirm: vi.fn() }
    const { rerender } = render(<ReconciliationWorkbench {...props} source={source} />)
    selectExactMatch()
    fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }))
    rerender(<ReconciliationWorkbench {...props} source={{ ...source, bankLines: [{ ...source.bankLines[0]!, amount: 1001 }] }} />)
    expect((screen.getByRole("checkbox", { name: reviewLabel }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByTestId("reconciliation-confirm") as HTMLButtonElement).disabled).toBe(true)
    rerender(<ReconciliationWorkbench {...props} source={{ ...source, moveLines: [source.moveLines[0]!] }} />)
    expect(screen.getByText(/A selected item is no longer eligible/)).toBeTruthy()
    fireEvent.click(screen.getByText("Clear selection"))
    expect(screen.queryByText(/A selected item is no longer eligible/)).toBeNull()
    expect(props.onConfirm).not.toHaveBeenCalled()
  })
  it("locks unknown outcomes to the original request across company and permission changes without replay", async () => {
    let finish!: (outcome: ReconciliationOutcome) => void
    const onConfirm = vi.fn((_request: ReconciliationRequest) => {
      expect(onOperationLockChange).toHaveBeenLastCalledWith(true)
      return new Promise<ReconciliationOutcome>((resolve) => { finish = resolve })
    })
    const onCheckStatus = vi.fn().mockResolvedValueOnce("unconfirmed").mockResolvedValueOnce("confirmed")
    const onOperationLockChange = vi.fn()
    const source = fixture()
    const props = { canReconcile: true, onConfirm, onCheckStatus, onOperationLockChange }
    const { rerender } = render(<ReconciliationWorkbench {...props} source={source} />)
    selectExactMatch()
    fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }))
    const confirm = screen.getByTestId("reconciliation-confirm")
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onOperationLockChange).toHaveBeenLastCalledWith(true)
    const captured = onConfirm.mock.calls[0]![0]
    expect(Object.isFrozen(captured)).toBe(true)
    expect(Object.isFrozen(captured.moveLineIds)).toBe(true)
    finish({ status: "unknown", message: "No exact receipt yet" })
    await screen.findByText("Previous action is unconfirmed")
    rerender(<ReconciliationWorkbench {...props} canReconcile={false} source={{ ...source, companyId: 9n, state: { status: "denied" } }} />)
    expect(screen.queryByText("January statement")).toBeNull()
    expect(screen.queryByTestId("reconciliation-confirm")).toBeNull()
    expect(screen.getByText(/active company changed/)).toBeTruthy()
    fireEvent.click(screen.getByText("Check original action"))
    await screen.findByText(/Nothing has been resubmitted/)
    fireEvent.click(screen.getByText("Check original action"))
    await screen.findByText("Bank-line link confirmed")
    expect(onCheckStatus.mock.calls.every(([request]) => request === captured)).toBe(true)
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onOperationLockChange).toHaveBeenLastCalledWith(false)
  })
  it("treats thrown confirmation errors as unknown, not as permission to submit again", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("Network interrupted"))
    render(<ReconciliationWorkbench source={fixture()} canReconcile onConfirm={onConfirm} />)
    selectExactMatch()
    fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }))
    fireEvent.click(screen.getByTestId("reconciliation-confirm"))
    await screen.findByText("Previous action is unconfirmed")
    expect((screen.getByTestId("reconciliation-confirm") as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Exact read-back is unavailable/)).toBeTruthy()
    expect(onConfirm).toHaveBeenCalledOnce()
  })
  it("allows a definite rejection to be reviewed again without automatic submission", async () => {
    const onConfirm = vi.fn().mockResolvedValue({ status: "rejected", message: "The statement is no longer open" })
    render(<ReconciliationWorkbench source={fixture()} canReconcile onConfirm={onConfirm} />)
    selectExactMatch()
    fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }))
    fireEvent.click(screen.getByTestId("reconciliation-confirm"))
    await screen.findByText("The statement is no longer open")
    expect((screen.getByRole("checkbox", { name: reviewLabel }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByTestId("reconciliation-confirm") as HTMLButtonElement).disabled).toBe(true)
    expect(onConfirm).toHaveBeenCalledOnce()
  })
  it("never exposes stale options or enables writes without fresh reads and permission", () => {
    const source = fixture()
    const onConfirm = vi.fn()
    const { rerender } = render(<ReconciliationWorkbench source={source} canReconcile={false} onConfirm={onConfirm} />)
    expect((screen.getByRole("checkbox", { name: "Select INV/001, Consulting" }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/do not have permission/)).toBeTruthy()
    for (const status of ["denied", "error", "partial", "loading"] as const) {
      rerender(<ReconciliationWorkbench source={{ ...source, state: { status } }} canReconcile onConfirm={onConfirm} />)
      expect(screen.queryByTestId("reconciliation-candidate-40")).toBeNull()
      expect(screen.queryByTestId("reconciliation-confirm")).toBeNull()
    }
    expect(onConfirm).not.toHaveBeenCalled()
  })
  it("does not carry a selection into a different company or focused line", () => {
    const source = fixture()
    const props = { canReconcile: true, onConfirm: vi.fn() }
    const { rerender } = render(<ReconciliationWorkbench {...props} source={source} />)
    selectExactMatch()
    fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }))
    const nextLine = { ...source.line!, id: 11n }
    rerender(<ReconciliationWorkbench {...props} source={{ ...source, line: nextLine, bankLines: [...source.bankLines, nextLine] }} />)
    expect(screen.getByText("0 selected journal items")).toBeTruthy()
    expect((screen.getByTestId("reconciliation-confirm") as HTMLButtonElement).disabled).toBe(true)
    rerender(<ReconciliationWorkbench {...props} source={{ ...source, companyId: 9n }} />)
    expect(screen.queryByTestId("reconciliation-confirm")).toBeNull()
    expect(props.onConfirm).not.toHaveBeenCalled()
  })
})
