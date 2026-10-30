import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import type { TFunction } from "i18next"
import { editAnalyticLineForm } from "../lib/accounting-form-configs"
import { mergeFieldDefaultValues } from "../lib/form-config-merge"
import { ModularForm } from "./modular-form"
import { ExpenseTextField } from "../../../../web/app/(modules)/expenses/expense-text-field"

vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({ useAiFormSuggest: () => ({}) }))
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } }))
afterEach(cleanup)

it("keeps specialist input labels and values after editing and through disabled state", () => {
  const change = vi.fn()
  const result = render(<ExpenseTextField label="Statement reference" value="STAT-42" onChange={change} />)
  const input = screen.getByLabelText("Statement reference") as HTMLInputElement
  expect(input.value).toBe("STAT-42")
  fireEvent.change(input, { target: { value: "STAT-43" } })
  expect(change).toHaveBeenCalledOnce()
  result.rerender(<ExpenseTextField label="Statement reference" value="STAT-43" disabled onChange={change} />)
  expect((screen.getByLabelText("Statement reference") as HTMLInputElement).disabled).toBe(true)
  expect(screen.getByText("Statement reference")).toBeTruthy()
})

it("omits unsupported tag assignment from an analytic edit so the patch preserves existing tags", async () => {
  const t = ((key: string) => key) as TFunction
  const config = mergeFieldDefaultValues(editAnalyticLineForm(t), { lineId: "42", name: "Consulting", amount: 10, tagIds: "3, 8" })
  const submit = vi.fn()
  render(<ModularForm config={config} onSubmit={submit} />)
  expect(screen.queryByLabelText("accounting.forms.analyticLine.fields.tagIds")).toBeNull()
  fireEvent.change(screen.getByLabelText(/accounting.forms.analyticLine.fields.name/), { target: { value: "Consulting updated" } })
  fireEvent.click(screen.getByRole("button", { name: "common.save" }))
  await waitFor(() => expect(submit).toHaveBeenCalledOnce())
  const values = submit.mock.calls[0]![0]
  expect(values.name).toBe("Consulting updated")
  expect(values.lineId).toBe("42")
  expect(Object.hasOwn(values, "tagIds")).toBe(false)
})
