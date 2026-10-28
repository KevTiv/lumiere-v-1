import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mutations = vi.hoisted(() => ({ submit: vi.fn(), approve: vi.fn(), refuse: vi.fn(), allowed: true }))
vi.mock("@lumiere/query-hooks/hooks/expenses", () => ({
  useSubmitExpenseSheet: () => ({ mutateAsync: mutations.submit }),
  useApproveExpenseSheet: () => ({ mutateAsync: mutations.approve }),
  useRefuseExpenseSheet: () => ({ mutateAsync: mutations.refuse }),
}))
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))
vi.mock("@lumiere/ui/lib/rbac-context", () => ({ useRBAC: () => ({ permissionsReady: true, checkPermission: () => ({ allowed: mutations.allowed }) }) }))
import { useExpenseReportDecision } from "../../../../web/app/(modules)/expenses/expense-report-decision"

function Harness({ enabled = true }: { enabled?: boolean }) {
  const decision = useExpenseReportDecision(1n, 2n, enabled)
  return <><button onClick={() => decision.open("refuse", { id: "9007199254740993", name: "Trip", state: "Submitted", organizationId: 1n, companyId: 2n })}>Open refusal</button>{decision.modal}</>
}
afterEach(cleanup)
beforeEach(() => { vi.clearAllMocks(); mutations.allowed = true })

describe("shared report decisions", () => {
  it("requires a refusal reason and retains it after a failed request", async () => {
    mutations.refuse.mockRejectedValue(new Error("Approval changed; refresh this report"))
    render(<Harness />)
    fireEvent.click(screen.getByText("Open refusal"))
    fireEvent.click(screen.getByRole("button", { name: "expenses.workflow.refuseReport" }))
    expect(mutations.refuse).not.toHaveBeenCalled()
    fireEvent.change(screen.getByTestId("expense-report-refuse-reason"), { target: { value: "Receipt does not match" } })
    fireEvent.click(screen.getByRole("button", { name: "expenses.workflow.refuseReport" }))
    await screen.findByText("Approval changed; refresh this report")
    expect((screen.getByTestId("expense-report-refuse-reason") as HTMLTextAreaElement).value).toBe("Receipt does not match")
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(mutations.refuse).toHaveBeenCalledWith({ sheetId: "9007199254740993", params: { reason: "Receipt does not match" } })
  })
  it("blocks dismissal and duplicate dispatch while pending, then closes only on resolution", async () => {
    let resolve!: () => void
    mutations.refuse.mockImplementation(() => new Promise<void>(done => { resolve = done }))
    render(<Harness />)
    fireEvent.click(screen.getByText("Open refusal"))
    fireEvent.change(screen.getByTestId("expense-report-refuse-reason"), { target: { value: "Missing receipt" } })
    const confirm = screen.getByRole("button", { name: "expenses.workflow.refuseReport" })
    fireEvent.click(confirm); fireEvent.click(confirm)
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }))
    expect(mutations.refuse).toHaveBeenCalledOnce()
    expect(screen.getByRole("dialog")).toBeTruthy()
    await act(async () => { resolve() })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })
  it("does not offer a decision without its backend permission", () => {
    mutations.allowed = false
    render(<Harness />)
    fireEvent.click(screen.getByText("Open refusal"))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(mutations.refuse).not.toHaveBeenCalled()
  })
  it("does not open or dispatch when its source is unavailable", () => {
    render(<Harness enabled={false} />)
    fireEvent.click(screen.getByText("Open refusal"))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(mutations.refuse).not.toHaveBeenCalled()
  })
})
