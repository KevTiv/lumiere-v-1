import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ReconciliationWorkbench, type ReconciliationOutcome } from "./reconciliation-workbench"
import type { ReconciliationRequest, ReconciliationSource } from "./reconciliation-workbench-model"
import type { BankSettlementAttempt, BankSettlementRecoveryRequest } from "@lumiere/erp-shared/bank-settlement-lifecycle"

vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))
afterEach(cleanup)

function fixture(): ReconciliationSource {
  const line = { id: 10n, organizationId: 1n, statementId: 2n, journalId: 3n, amount: 1000, currencyId: null, journalCurrencyId: 7n, foreignCurrencyId: null, isReconciled: false, moveIds: [], transactionType: "Customer transfer" }
  return {
    organizationId: 1n, companyId: 4n, companyCurrencyId: 7n, state: { status: "ready" },
    statement: { id: 2n, organizationId: 1n, companyId: 4n, journalId: 3n, currencyId: 7n, state: "Open", name: "January statement" }, line, bankLines: [line],
    moves: [{ id: 20n, organizationId: 1n, companyId: 4n, name: "INV/001", state: "Posted", moveType: "OutInvoice", partnerId: 50n, invoicePartnerDisplayName: "Alpha customer" }, { id: 21n, organizationId: 1n, companyId: 4n, name: "INV/002", state: "Posted", moveType: "OutInvoice", partnerId: 50n, invoicePartnerDisplayName: "Beta customer" }],
    accounts: [{ id: 30n, organizationId: 1n, companyId: 4n, name: "Receivable", code: "1100", reconcile: true, deprecated: false, internalType: "Receivable" }],
    moveLines: [
      { id: 40n, organizationId: 1n, companyId: 4n, moveId: 20n, accountId: 30n, companyCurrencyId: 7n, currencyId: 7n, parentState: "Posted", name: "Consulting", debit: 600, credit: 0, balance: 600, amountResidual: 600, blocked: false, partnerId: 50n },
      { id: 41n, organizationId: 1n, companyId: 4n, moveId: 21n, accountId: 30n, companyCurrencyId: 7n, currencyId: 7n, parentState: "Posted", name: "Support", debit: 400, credit: 0, balance: 400, amountResidual: 400, blocked: false, partnerId: 50n },
    ], currencies: [{ id: 7n, code: "EUR", decimalPlaces: 2, roundingFactor: 0.01 }],
  }
}
const reviewLabel = /I reviewed the statement/
const recoveryReviewLabel = /I reviewed the original payment, selected invoices/
function attempt(status: BankSettlementAttempt["status"] = "approval_rejected"): BankSettlementAttempt {
  return { attemptId: "bank-10-attempt-1", generation: "1", paymentId: "88", status, selectedMoveLineIds: ["40", "41"],
    selectedResiduals: [{ lineId: "40", moveId: "20", residual: 600, residualCurrency: 600 }, { lineId: "41", moveId: "21", residual: 400, residualCurrency: 400 }] }
}
function lifecycleSource(saved: BankSettlementAttempt): ReconciliationSource {
  const source = fixture(), line = { ...source.line!, paymentIds: [saved.paymentId], metadata: { bankSettlement: saved } }
  return { ...source, line, bankLines: [line] }
}
function selectExactMatch() {
  fireEvent.click(screen.getByRole("checkbox", { name: "Select INV/001, Consulting" }))
  fireEvent.click(screen.getByRole("checkbox", { name: "Select INV/002, Support" }))
}
describe("bank matching desk", () => {
  it("requires explicit selection and reviewed exact totals before a single bank-line confirmation", async () => {
    const onConfirm = vi.fn().mockResolvedValue({ status: "confirmed" })
    render(<ReconciliationWorkbench actorKey="synthetic-accountant" source={fixture()} canReconcile onConfirm={onConfirm} />)
    const confirm = screen.getByTestId("reconciliation-confirm") as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(screen.getByTestId("bank-matching-next-step").textContent).toContain("Selecting records does not post a payment")
    expect(screen.getByRole("link", { name: "INV/001" }).getAttribute("href")).toBe("/accounting/invoices/20")
    selectExactMatch()
    expect(confirm.disabled).toBe(true)
    expect(screen.getByTestId("bank-matching-next-step").textContent).toContain("tick the review confirmation")
    const review = screen.getByRole("region", { name: "Review selected matches" })
    expect(within(review).getByText("Difference").nextElementSibling?.textContent).toContain("0.00")
    fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }))
    expect(screen.getByTestId("bank-matching-next-step").textContent).toContain("subject to any required approval")
    fireEvent.click(confirm)
    await screen.findByText("Bank settlement confirmed")
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onConfirm.mock.calls[0]![0]).toEqual({ organizationId: "1", companyId: "4", statementId: "2", lineId: "10", moveLineIds: ["40", "41"], amountResidual: 0 })
    expect(screen.getByText(/posted payment and selected invoice balances are settled/)).toBeTruthy()
  })
  it("searches readable document, partner, account and item labels without losing selections", () => {
    render(<ReconciliationWorkbench actorKey="synthetic-accountant" source={fixture()} canReconcile onConfirm={vi.fn()} />)
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
    const { rerender } = render(<ReconciliationWorkbench actorKey="synthetic-accountant" {...props} source={source} />)
    selectExactMatch()
    fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }))
    rerender(<ReconciliationWorkbench actorKey="synthetic-accountant" {...props} source={{ ...source, bankLines: [{ ...source.bankLines[0]!, amount: 1001 }] }} />)
    expect((screen.getByRole("checkbox", { name: reviewLabel }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByTestId("reconciliation-confirm") as HTMLButtonElement).disabled).toBe(true)
    rerender(<ReconciliationWorkbench actorKey="synthetic-accountant" {...props} source={{ ...source, moveLines: [source.moveLines[0]!] }} />)
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
    const { rerender } = render(<ReconciliationWorkbench actorKey="synthetic-accountant" {...props} source={source} />)
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
    rerender(<ReconciliationWorkbench actorKey="synthetic-accountant" {...props} canReconcile={false} source={{ ...source, companyId: 9n, state: { status: "denied" } }} />)
    expect(screen.queryByText("January statement")).toBeNull()
    expect(screen.queryByTestId("reconciliation-confirm")).toBeNull()
    expect(screen.getByText(/active company changed/)).toBeTruthy()
    fireEvent.click(screen.getByText("Check original action"))
    await screen.findByText(/Nothing has been resubmitted/)
    fireEvent.click(screen.getByText("Check original action"))
    await screen.findByText("Bank settlement confirmed")
    expect(onCheckStatus.mock.calls.every(([request]) => request === captured)).toBe(true)
    expect(onConfirm).toHaveBeenCalledOnce()
    await waitFor(() => expect(onOperationLockChange).toHaveBeenLastCalledWith(false))
  })
  it("treats thrown confirmation errors as unknown, not as permission to submit again", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("Network interrupted"))
    render(<ReconciliationWorkbench actorKey="synthetic-accountant" source={fixture()} canReconcile onConfirm={onConfirm} />)
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
    render(<ReconciliationWorkbench actorKey="synthetic-accountant" source={fixture()} canReconcile onConfirm={onConfirm} />)
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
    const { rerender } = render(<ReconciliationWorkbench actorKey="synthetic-accountant" source={source} canReconcile={false} onConfirm={onConfirm} />)
    expect((screen.getByRole("checkbox", { name: "Select INV/001, Consulting" }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/do not have permission/)).toBeTruthy()
    for (const status of ["denied", "error", "partial", "loading"] as const) {
      rerender(<ReconciliationWorkbench actorKey="synthetic-accountant" source={{ ...source, state: { status } }} canReconcile onConfirm={onConfirm} />)
      expect(screen.queryByTestId("reconciliation-candidate-40")).toBeNull()
      expect(screen.queryByTestId("reconciliation-confirm")).toBeNull()
    }
    expect(onConfirm).not.toHaveBeenCalled()
  })
  it("does not carry a selection into a different company or focused line", () => {
    const source = fixture()
    const props = { canReconcile: true, onConfirm: vi.fn() }
    const { rerender } = render(<ReconciliationWorkbench actorKey="synthetic-accountant" {...props} source={source} />)
    selectExactMatch()
    fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }))
    const nextLine = { ...source.line!, id: 11n }
    rerender(<ReconciliationWorkbench actorKey="synthetic-accountant" {...props} source={{ ...source, line: nextLine, bankLines: [...source.bankLines, nextLine] }} />)
    expect(screen.getByText("0 selected journal items")).toBeTruthy()
    expect((screen.getByTestId("reconciliation-confirm") as HTMLButtonElement).disabled).toBe(true)
    rerender(<ReconciliationWorkbench actorKey="synthetic-accountant" {...props} source={{ ...source, companyId: 9n }} />)
    expect(screen.queryByTestId("reconciliation-confirm")).toBeNull()
    expect(props.onConfirm).not.toHaveBeenCalled()
  })
  it("preserves approval waiting distinctly and completes only after explicit continuation", async () => {
    const onConfirm = vi.fn().mockResolvedValueOnce({ status: "awaiting_approval", paymentId: "88" }).mockResolvedValueOnce({ status: "confirmed" })
    const onCheckStatus = vi.fn().mockResolvedValue({ status: "awaiting_approval", paymentId: "88" })
    render(<ReconciliationWorkbench actorKey="synthetic-accountant" source={fixture()} canReconcile onConfirm={onConfirm} onCheckStatus={onCheckStatus} />)
    selectExactMatch()
    fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }))
    fireEvent.click(screen.getByTestId("reconciliation-confirm"))
    await screen.findByText("Payment awaiting approval or settlement completion")
    expect(screen.queryByText("Bank settlement confirmed")).toBeNull()
    expect(screen.getByRole("link", { name: "Review approval for payment #88" }).getAttribute("href")).toBe("/approvals?model=account_payment&resId=88")
    fireEvent.click(screen.getByText("Check payment status"))
    await screen.findByText("Payment awaiting approval or settlement completion")
    expect(onConfirm).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText("Complete approved settlement"))
    await screen.findByText("Bank settlement confirmed")
    expect(onConfirm).toHaveBeenCalledTimes(2)
    expect(onConfirm.mock.calls[1]![0]).toBe(onConfirm.mock.calls[0]![0])
  })

})


describe("reviewed bank settlement lifecycle recovery", () => {
  it("checks a persisted closed approval before enabling explicit abandonment and fresh review", async () => {
    const saved = attempt(), source = lifecycleSource(saved)
    const onCheckStatus = vi.fn().mockResolvedValue({ status: "lifecycle", attempt: saved })
    let finishRecovery!: (outcome: ReconciliationOutcome) => void
    const onRecover = vi.fn((_request: BankSettlementRecoveryRequest) => new Promise<ReconciliationOutcome>((resolve) => { finishRecovery = resolve }))
    const onOperationLockChange = vi.fn(), onConfirm = vi.fn()
    render(<ReconciliationWorkbench actorKey="operator-1" source={source} canReconcile canRecover={() => true} onConfirm={onConfirm} onCheckStatus={onCheckStatus} onRecover={onRecover} onOperationLockChange={onOperationLockChange} createRecoveryKey={() => "abandon-1"} />)
    await screen.findByText("Check the saved settlement before continuing")
    expect(screen.queryByText("Abandon unposted draft")).toBeNull()
    expect(screen.queryByTestId("reconciliation-confirm")).toBeNull()
    fireEvent.click(screen.getByText("Check settlement status"))
    await screen.findByText("The payment approval is closed; the bank line remains unmatched")
    fireEvent.click(screen.getByText("Abandon unposted draft"))
    const confirm = screen.getByText("Confirm reviewed recovery") as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByRole("textbox", { name: "Reason for recovery" }), { target: { value: "Supplier approval was cancelled" } })
    expect(confirm.disabled).toBe(true)
    fireEvent.click(screen.getByRole("checkbox", { name: recoveryReviewLabel }))
    fireEvent.click(confirm)
    await screen.findByText("Confirming the reviewed settlement recovery…")
    expect(onOperationLockChange).toHaveBeenLastCalledWith(true)
    expect(screen.queryByText("Unposted settlement draft abandoned")).toBeNull()
    expect(onRecover).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
    finishRecovery({ status: "lifecycle", attempt: { ...saved, status: "abandoned" } })
    await screen.findByText("Unposted settlement draft abandoned")
    expect(onRecover).toHaveBeenCalledOnce()
    expect(onRecover.mock.calls[0]![0]).toMatchObject({ organizationId: "1", companyId: "4", statementId: "2", lineId: "10", paymentId: "88", action: "abandon", reason: "Supplier approval was cancelled", idempotencyKey: "abandon-1", moveLineIds: ["40", "41"] })
    // The parent lock is notified by an effect, after the terminal DOM commits.
    await waitFor(() => expect(onOperationLockChange).toHaveBeenLastCalledWith(false))
    fireEvent.click(screen.getByText("Review another line"))
    expect(screen.queryByText("Check the saved settlement before continuing")).toBeNull()
    expect(screen.getByTestId("reconciliation-confirm")).toBeTruthy()
    expect(onConfirm).not.toHaveBeenCalled()
  })
  it("retains an unknown resubmission's immutable key through actor/company changes and a rejected retry", async () => {
    const saved = attempt(), source = lifecycleSource(saved)
    const onCheckStatus = vi.fn().mockResolvedValue({ status: "lifecycle", attempt: saved })
    const onRecover = vi.fn().mockResolvedValueOnce({ status: "unknown", message: "Synthetic response lost" }).mockResolvedValueOnce({ status: "rejected", message: "Retry access denied" })
    const props = { source, canReconcile: true, canRecover: () => true, onConfirm: vi.fn(), onCheckStatus, onRecover, createRecoveryKey: () => "resubmit-original" }
    const { rerender } = render(<ReconciliationWorkbench {...props} actorKey="operator-1" />)
    fireEvent.click(await screen.findByText("Check settlement status"))
    fireEvent.click(await screen.findByText("Resubmit for approval"))
    fireEvent.change(screen.getByRole("textbox", { name: "Reason for recovery" }), { target: { value: "Updated approval policy is ready" } })
    fireEvent.click(screen.getByRole("checkbox", { name: recoveryReviewLabel }))
    fireEvent.click(screen.getByText("Confirm reviewed recovery"))
    await screen.findByText(/Synthetic response lost/)
    const original = onRecover.mock.calls[0]![0] as BankSettlementRecoveryRequest
    expect(Object.isFrozen(original)).toBe(true)
    expect(Object.isFrozen(original.moveLineIds)).toBe(true)
    rerender(<ReconciliationWorkbench {...props} actorKey="operator-2" />)
    expect((screen.getByText("Retry original recovery") as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText("Check original action") as HTMLButtonElement).disabled).toBe(true)
    rerender(<ReconciliationWorkbench {...props} actorKey="operator-1" source={{ ...source, companyId: "9" }} />)
    expect((screen.getByText("Retry original recovery") as HTMLButtonElement).disabled).toBe(true)
    expect(onRecover).toHaveBeenCalledOnce()
    rerender(<ReconciliationWorkbench {...props} actorKey="operator-1" />)
    fireEvent.click(screen.getByText("Retry original recovery"))
    await screen.findByText(/Retry access denied/)
    expect(onRecover.mock.calls[1]![0]).toBe(original)
    expect(screen.getByText("Previous action is unconfirmed")).toBeTruthy()
    expect(screen.queryByText("Review another line")).toBeNull()
  })
  it("requires a fresh reviewed reason and date before reversing a posted statement", async () => {
    const saved = { ...attempt("settled"), paymentMoveId: "60" }, source = lifecycleSource(saved)
    source.statement = { ...source.statement!, state: "Posted" }
    const onCheckStatus = vi.fn().mockResolvedValue({ status: "lifecycle", attempt: saved })
    let finish!: (result: ReconciliationOutcome) => void
    const onRecover = vi.fn(() => new Promise<ReconciliationOutcome>((resolve) => { finish = resolve }))
    const onOperationLockChange = vi.fn()
    render(<ReconciliationWorkbench actorKey="operator-1" source={source} canReconcile canRecover={() => true} onConfirm={vi.fn()} onCheckStatus={onCheckStatus} onRecover={onRecover} onOperationLockChange={onOperationLockChange} createRecoveryKey={() => "reverse-original"} />)
    fireEvent.click(await screen.findByText("Check settlement status"))
    fireEvent.click(await screen.findByText("Reverse settlement"))
    fireEvent.change(screen.getByRole("textbox", { name: "Reason for recovery" }), { target: { value: "Receipt matched the wrong invoice" } })
    fireEvent.click(screen.getByRole("checkbox", { name: recoveryReviewLabel }))
    expect((screen.getByText("Confirm reviewed recovery") as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Reversal date"), { target: { value: "2026-10-18" } })
    expect((screen.getByRole("checkbox", { name: recoveryReviewLabel }) as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByRole("checkbox", { name: recoveryReviewLabel }))
    fireEvent.click(screen.getByText("Confirm reviewed recovery"))
    expect(onRecover).toHaveBeenCalledOnce()
    expect(onOperationLockChange).toHaveBeenLastCalledWith(true)
    expect(onRecover.mock.calls[0]![0]).toMatchObject({ action: "reverse", dateMicros: "1792281600000000", idempotencyKey: "reverse-original", reason: "Receipt matched the wrong invoice" })
    finish({ status: "lifecycle", attempt: { ...saved, status: "reversal_awaiting_approval", recoveryAction: "reverse", recoveryKey: "reverse-original", reversalRequestId: "9", reversalDateMicros: "1792281600000000", reversalReason: "Receipt matched the wrong invoice" } })
    await screen.findByText("Settlement reversal awaiting approval")
    expect(onOperationLockChange).toHaveBeenLastCalledWith(true)
    expect(screen.queryByText("Settlement reversal confirmed")).toBeNull()
  })
  it("resumes a persisted reversal as readonly and confirms only its canonical approved effect", async () => {
    const saved: BankSettlementAttempt = { ...attempt("reversal_awaiting_approval"), paymentMoveId: "60", recoveryAction: "reverse", recoveryKey: "saved-key", recoveryReason: "Original reviewed reason", reversalRequestId: "9", reversalDateMicros: "1792281600000000", reversalReason: "Original reviewed reason" }
    const onCheckStatus = vi.fn().mockResolvedValueOnce({ status: "lifecycle", attempt: saved }).mockResolvedValueOnce({ status: "lifecycle", attempt: { ...saved, status: "reversed", reversalMoveId: "80" } })
    const onRecover = vi.fn()
    render(<ReconciliationWorkbench actorKey="operator-1" source={lifecycleSource(saved)} canReconcile canRecover={() => true} onConfirm={vi.fn()} onCheckStatus={onCheckStatus} onRecover={onRecover} />)
    fireEvent.click(await screen.findByText("Check settlement status"))
    await screen.findByText("Settlement reversal awaiting approval")
    expect(screen.getByRole("link", { name: "Review reversal approval #9" }).getAttribute("href")).toBe("/approvals?model=account_payment&resId=88")
    expect(screen.queryByText("Complete approved reversal")).toBeNull()
    expect(screen.queryByText("Retry original recovery")).toBeNull()
    fireEvent.click(screen.getByText("Check original action"))
    await screen.findByText("Settlement reversal confirmed")
    expect(onCheckStatus.mock.calls[1]![1]).toMatchObject({ idempotencyKey: "saved-key", reason: "Original reviewed reason", dateMicros: "1792281600000000", paymentId: "88" })
    expect(onRecover).not.toHaveBeenCalled()
  })
  it("keeps approval waiting mounted and readonly until canonical posting is observed", async () => {
    const saved = attempt("awaiting_approval"), source = fixture()
    const onConfirm = vi.fn().mockResolvedValue({ status: "lifecycle", attempt: saved })
    const onOperationLockChange = vi.fn()
    render(<ReconciliationWorkbench actorKey="operator-1" source={source} canReconcile onConfirm={onConfirm} onOperationLockChange={onOperationLockChange} />)
    selectExactMatch()
    fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }))
    fireEvent.click(screen.getByTestId("reconciliation-confirm"))
    await screen.findByText("Payment awaiting approval or settlement completion")
    expect(onOperationLockChange).toHaveBeenLastCalledWith(true)
    expect(screen.queryByText("Complete approved settlement")).toBeNull()
    expect(onConfirm).toHaveBeenCalledOnce()
  })
  it("does not publish terminal success if the actor changes during an outstanding command", async () => {
    let finish!: (result: ReconciliationOutcome) => void
    const onConfirm = vi.fn(() => new Promise<ReconciliationOutcome>((resolve) => { finish = resolve }))
    const props = { source: fixture(), canReconcile: true, onConfirm, onCheckStatus: vi.fn().mockResolvedValue("confirmed") }
    const { rerender } = render(<ReconciliationWorkbench {...props} actorKey="operator-1" />)
    selectExactMatch()
    fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }))
    fireEvent.click(screen.getByTestId("reconciliation-confirm"))
    rerender(<ReconciliationWorkbench {...props} actorKey="operator-2" />)
    finish({ status: "confirmed" })
    await screen.findByText(/The signed-in user changed. Return to the original user and check this action./)
    expect(screen.queryByText("Bank settlement confirmed")).toBeNull()
    expect((screen.getByText("Check original action") as HTMLButtonElement).disabled).toBe(true)
    rerender(<ReconciliationWorkbench {...props} actorKey="operator-1" />)
    fireEvent.click(screen.getByText("Check original action"))
    await screen.findByText("Bank settlement confirmed")
  })
})
