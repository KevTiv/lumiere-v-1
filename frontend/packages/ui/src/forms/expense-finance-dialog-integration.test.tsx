import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { FormModalProps } from "./form-modal"

const state = vi.hoisted(() => ({ post: vi.fn(), reimburse: vi.fn(), rebill: vi.fn() }))
vi.mock("@lumiere/ui", () => ({
  FormModal: () => null,
  mergeFieldDefaultValues: (config: unknown) => config,
  mergeSelectOptionsForFields: (config: unknown) => config,
  postExpenseReportForm: () => ({ id: "post", title: "Post", sections: [] }),
  reimburseExpenseReportForm: () => ({ id: "pay", title: "Pay", sections: [] }),
  projectRebillExpenseReportForm: () => ({ id: "bill", title: "Bill", sections: [] }),
}))
vi.mock("@lumiere/i18n", async (importOriginal) => ({ ...(await importOriginal<typeof import("@lumiere/i18n")>()),  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))
vi.mock("@lumiere/query-hooks/hooks/expenses", () => ({
  usePostExpenseSheet: () => ({ mutateAsync: state.post, isPending: false }),
  useCreateExpenseReimbursementPayment: () => ({ mutateAsync: state.reimburse, isPending: false }),
  useCreateExpenseProjectRebill: () => ({ mutateAsync: state.rebill, isPending: false }),
}))
vi.mock("@lumiere/query-hooks/hooks/accounting", () => ({ useAccountAccounts: () => ({ data: [] }), useAccountJournals: () => ({ data: [] }) }))
vi.mock("../../../../web/lib/form-lookup", () => ({ accountAccountRowsToSelectOptions: () => [], accountJournalRowsToSelectOptions: () => [] }))
vi.mock("../../../../web/app/(modules)/expenses/expense-report-finance", () => ({
  sheetIdOf: (row: { id: unknown }) => String(row.id),
  buildPostParams: (_sheetId: string, values: { accountingDate?: unknown }) => values.accountingDate ? { sheetId: "4", params: {} } : undefined,
  buildReimburseParams: () => ({ sheetId: "4", params: {} }),
  buildRebillParams: () => ({ sheetId: "4", params: {} }),
}))
import { useExpenseReportFinance } from "../../../../web/app/(modules)/expenses/expense-report-finance-dialogs"

afterEach(cleanup)
beforeEach(() => { state.post.mockReset(); state.reimburse.mockReset(); state.rebill.mockReset() })
function opened() {
  const hook = renderHook(() => useExpenseReportFinance(9n, 2n))
  act(() => hook.result.current.open("postReport", { id: 4 }))
  hook.rerender()
  return hook
}

describe("expense finance form failures", () => {
  it("keeps the dialog and inline failure after rejection and rejects the form promise", async () => {
    const hook = opened()
    const modal = () => hook.result.current.modal!.props as FormModalProps
    state.post.mockRejectedValue(new Error("Locked accounting period"))
    expect(modal().closeOnSubmit).toBe(false)
    expect(modal().showSubmitSuccessToast).toBe(false)
    await act(async () => { await expect(modal().onSubmit!({ accountingDate: "2026-10-20" })).rejects.toThrow("Locked accounting period") })
    hook.rerender()
    expect(hook.result.current.modal).not.toBeNull()
    expect(modal().submitError).toBe("Locked accounting period")
  })
  it("does not close or dispatch when required values are missing", async () => {
    const hook = opened()
    const modal = () => hook.result.current.modal!.props as FormModalProps
    await act(async () => { await expect(modal().onSubmit!({})).rejects.toThrow("Complete the required") })
    hook.rerender()
    expect(state.post).not.toHaveBeenCalled()
    expect(hook.result.current.modal).not.toBeNull()
    expect(modal().submitError).toMatch(/Complete the required/)
  })
  it("closes after the selected canonical operation resolves", async () => {
    const hook = opened()
    const modal = () => hook.result.current.modal!.props as FormModalProps
    state.post.mockResolvedValue({ kind: "applied" })
    await act(async () => { await modal().onSubmit!({ accountingDate: "2026-10-20" }) })
    hook.rerender()
    expect(state.post).toHaveBeenCalledOnce()
    expect(hook.result.current.modal).toBeNull()
  })
})
