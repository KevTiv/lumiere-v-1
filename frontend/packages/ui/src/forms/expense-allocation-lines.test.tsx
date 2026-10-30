import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { TFunction } from "i18next"
import { ModularForm } from "./modular-form"
import { ExpenseAllocationLines, type ExpenseAllocationField } from "./expense-allocation-lines"
import { setExpenseAllocationsForm } from "../lib/expenses-form-configs"
import { expenseAllocationLines } from "../../../../web/app/(modules)/expenses/expense-allocation-input"

vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t, i18n: { language: "en" } }) }))
vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({ useAiFormSuggest: () => ({ isPending: false }) }))
vi.mock("../components/record-picker", () => ({
  RecordPicker: ({ id, value, onChange, options, disabled }: { id: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; disabled: boolean }) => <select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
}))
const t = ((key: string, options?: { defaultValue?: string; [key: string]: unknown }) => {
  let value = options?.defaultValue ?? key
  for (const [name, replacement] of Object.entries(options ?? {})) value = value.replaceAll(`{{${name}}}`, String(replacement))
  return value
}) as TFunction
const choices = {
  projectOptions: [{ value: "9007199254740993", label: "Client project" }],
  analyticAccountOptions: [{ value: "3", label: "Marketing" }],
  projectsState: { status: "ready" as const }, analyticAccountsState: { status: "ready" as const },
}

beforeAll(() => {
  if (typeof globalThis.PointerEvent === "undefined") Object.defineProperty(globalThis, "PointerEvent", { value: MouseEvent, configurable: true })
})
afterEach(cleanup)

describe("dynamic expense allocation form", () => {
  it("preserves edits while adding/removing rows and refreshing named choices", async () => {
    const onSubmit = vi.fn()
    const { rerender } = render(<ModularForm config={setExpenseAllocationsForm(t, choices)} draft={false} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "9007199254740993" } })
    fireEvent.change(screen.getByLabelText("Share (%)"), { target: { value: "20" } })
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "Add allocation" }))
    expect(screen.getAllByLabelText("Share (%)")).toHaveLength(5)
    for (let i = 1; i < 5; i++) {
      fireEvent.change(screen.getAllByLabelText("Project")[i], { target: { value: "9007199254740993" } })
      fireEvent.change(screen.getAllByLabelText("Share (%)")[i], { target: { value: "20" } })
    }
    expect(screen.getByText("Allocated: 100%. Total must equal 100%.")).toBeTruthy()
    rerender(<ModularForm config={setExpenseAllocationsForm(t, { ...choices, projectOptions: [{ value: "9007199254740993", label: "Renamed project" }] })} draft={false} onSubmit={onSubmit} />)
    expect((screen.getAllByLabelText("Project")[0] as HTMLSelectElement).value).toBe("9007199254740993")
    expect((screen.getAllByLabelText("Share (%)")[0] as HTMLInputElement).value).toBe("20")
    fireEvent.click(screen.getByRole("button", { name: "Remove last allocation" }))
    expect(screen.getAllByLabelText("Share (%)")).toHaveLength(4)
    expect((screen.getAllByLabelText("Share (%)")[0] as HTMLInputElement).value).toBe("20")
    expect(screen.getByText("Allocated: 80%. Total must equal 100%.")).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("retains all rows and displays rejected replacement inline, then submits an exact valid vector", async () => {
    const save = vi.fn((data: { [key: string]: unknown }) => expenseAllocationLines(data.allocationLines, new Set(["9007199254740993"]), new Set(["3"]), "Invalid allocation", "Shares must total 100%"))
    render(<ModularForm config={setExpenseAllocationsForm(t, choices)} draft={false} onSubmit={save} />)
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "9007199254740993" } })
    fireEvent.change(screen.getByLabelText("Share (%)"), { target: { value: "50" } })
    fireEvent.click(screen.getByRole("checkbox", { name: "I have reviewed these rows and want to replace this expense's allocations." }))
    fireEvent.click(screen.getByRole("button", { name: "Replace allocations" }))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Shares must total 100%"))
    expect((screen.getByLabelText("Share (%)") as HTMLInputElement).value).toBe("50")
    fireEvent.click(screen.getByRole("button", { name: "Add allocation" }))
    fireEvent.change(screen.getAllByLabelText("Analytic account")[1], { target: { value: "3" } })
    fireEvent.change(screen.getAllByLabelText("Share (%)")[1], { target: { value: "50" } })
    fireEvent.click(screen.getByRole("button", { name: "Replace allocations" }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.results[1]?.value).toEqual([
      { projectId: 9007199254740993n, analyticAccountId: undefined, sharePercent: 50, billable: true, metadata: undefined },
      { projectId: undefined, analyticAccountId: 3n, sharePercent: 50, billable: false, metadata: undefined },
    ])
  })

  it("shows denied/failed sources, retries the canonical read, and never silently clears a retained selection", () => {
    const retry = vi.fn()
    const field = { id: "allocations", name: "allocationLines", type: "custom", component: ExpenseAllocationLines, ...choices, projectsState: { status: "denied" }, analyticAccountsState: { status: "error", onRetry: retry } } as ExpenseAllocationField
    const onChange = vi.fn()
    render(<ExpenseAllocationLines field={field} value={[{ projectId: "4", analyticAccountId: "", sharePercent: "100", billable: true }]} onChange={onChange} />)
    expect(screen.getByText("Project: Access restricted")).toBeTruthy()
    expect(screen.getByText("Analytic account: Choices could not be verified")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })
})
