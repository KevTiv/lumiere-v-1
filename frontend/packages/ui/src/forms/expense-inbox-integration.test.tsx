import type { AnchorHTMLAttributes } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ status: "ready", error: undefined as unknown, rows: [] as { id: string; organizationId: number; companyId: number; name: string; state: string }[] }))
vi.mock("@lumiere/query-hooks/hooks/expenses", () => {
  const query = () => ({ data: state.rows, isLoading: state.status === "loading", isError: state.status === "error", error: state.error, refetch: vi.fn() })
  return { useExpenses: query, useExpenseSheetsToApprove: query, useExpensesMissingReceipt: query, useExpenseCardStatementUnmatched: query,
    useMatchExpenseCardStatementLine: () => ({ mutateAsync: vi.fn() }) }
})
vi.mock("../../../../web/app/(modules)/expenses/expense-report-decision", () => ({ useExpenseReportDecision: () => ({ open: vi.fn(), modal: null, isPending: false, error: null, can: () => true }) }))
vi.mock("../../../../web/app/(modules)/expenses/expense-record-picker", () => ({ ExpenseRecordPicker: () => null }))
vi.mock("@lumiere/i18n", async (importOriginal) => ({ ...(await importOriginal<typeof import("@lumiere/i18n")>()),  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))
vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} /> }))
import { ExpensesInboxPanel } from "../../../../web/app/(modules)/expenses/expenses-inbox-panel"

afterEach(cleanup)
beforeEach(() => { state.status = "ready"; state.error = undefined; state.rows = [] })
it("shows loading and denied access without claiming an empty queue or revealing cached rows", () => {
  state.status = "loading"
  const view = render(<ExpensesInboxPanel organizationId={1} companyId={2n} onOpenExpense={vi.fn()} />)
  expect(screen.getByRole("status").textContent).toBe("common.loading")
  expect(screen.queryByText("expenses.inbox.empty")).toBeNull()
  state.status = "error"; state.error = { status: 403 }
  state.rows = [{ id: "secret", name: "Cached report", organizationId: 1, companyId: 2, state: "Submitted" }]
  view.rerender(<ExpensesInboxPanel organizationId={1} companyId={2n} onOpenExpense={vi.fn()} />)
  expect(screen.queryByText("Cached report")).toBeNull()
  expect(screen.queryByText("expenses.inbox.empty")).toBeNull()
  expect(screen.getByRole("status").textContent).toContain("access")
})
it("opens the exact missing-receipt record and excludes other companies", () => {
  const open = vi.fn()
  state.rows = [{ id: "9007199254740993", name: "Taxi", organizationId: 1, companyId: 2, state: "Draft" }, { id: "2", name: "Other company", organizationId: 1, companyId: 3, state: "Draft" }]
  render(<ExpensesInboxPanel organizationId={1} companyId={2n} onOpenExpense={open} />)
  fireEvent.click(screen.getByTestId("expenses-inbox-missing-receipt"))
  fireEvent.click(screen.getByText("expenses.workflowUi.attachReceipt"))
  expect(open).toHaveBeenCalledWith(state.rows[0])
  expect(screen.queryByText("Other company")).toBeNull()
})
