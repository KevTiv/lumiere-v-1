import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { FormConfig } from "../lib/form-types"
import { ModularForm } from "./modular-form"

vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string; value?: string }) => options?.defaultValue?.replace("{{value}}", options.value ?? "") ?? key }) }))
vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({ useAiFormSuggest: () => ({}) }))
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } }))

afterEach(cleanup)

function config(defaultValue?: string[], required = false): FormConfig {
  return {
    id: "cardinality", title: "Cardinality", showReset: true,
    sections: [{ id: "main", fields: [{
      id: "regions", name: "custom:regions", label: "Regions", type: "multiselect",
      required, defaultValue,
      options: [{ value: "north", label: "North" }, { value: "south", label: "South" }, { value: "locked", label: "Locked", disabled: true }],
    }] }],
  }
}

function select(...values: string[]) {
  const input = screen.getByRole("listbox") as HTMLSelectElement
  for (const option of Array.from(input.options)) option.selected = values.includes(option.value)
  fireEvent.change(input)
}

describe("ModularForm array fields", () => {
  it("initializes optional fields as arrays and submits multiple selections", async () => {
    const submit = vi.fn()
    render(<ModularForm config={config()} onSubmit={submit} />)
    fireEvent.click(screen.getByRole("button", { name: "common.submit" }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ "custom:regions": [] }))
    select("north", "south")
    fireEvent.click(screen.getByRole("button", { name: "common.submit" }))
    await waitFor(() => expect(submit).toHaveBeenLastCalledWith({ "custom:regions": ["north", "south"] }))
  })
  it("blocks an empty required array and allows populated submission", async () => {
    const submit = vi.fn()
    render(<ModularForm config={config(undefined, true)} onSubmit={submit} />)
    fireEvent.click(screen.getByRole("button", { name: "common.submit" }))
    expect(screen.getByRole("alert").textContent).toContain("common.validation.required")
    expect(submit).not.toHaveBeenCalled()
    select("south")
    fireEvent.click(screen.getByRole("button", { name: "common.submit" }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ "custom:regions": ["south"] }))
  })
  it("blocks direct form submission when configuration disables submission", () => {
    const submit = vi.fn()
    render(<ModularForm config={config(["north"])} onSubmit={submit} submissionDisabled />)
    const button = screen.getByRole("button", { name: "common.submit" })
    fireEvent.submit(button.closest("form")!)
    expect(submit).not.toHaveBeenCalled()
  })
  it("resets to multiple defaults", () => {
    render(<ModularForm config={config(["north", "south"])} />)
    select("north")
    fireEvent.click(screen.getByRole("button", { name: "common.reset" }))
    const input = screen.getByRole("listbox") as HTMLSelectElement
    expect(Array.from(input.selectedOptions, (option) => option.value)).toEqual(["north", "south"])
  })
  it("preserves unavailable and disabled saved values when other choices change", async () => {
    const submit = vi.fn()
    render(<ModularForm config={config(["retired", "locked"])} onSubmit={submit} />)
    expect((screen.getByRole("option", { name: "Locked" }) as HTMLOptionElement).disabled).toBe(true)
    expect((screen.getByRole("option", { name: "Unavailable selection: retired" }) as HTMLOptionElement).disabled).toBe(true)
    select("north")
    fireEvent.click(screen.getByRole("button", { name: "common.submit" }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ "custom:regions": ["retired", "locked", "north"] }))
  })
})

describe("ModularForm asynchronous hidden context", () => {
  function referenceForm(checkId: string): FormConfig {
    return { id: "quality", title: "Quality", sections: [{ id: "main", fields: [
      { type: "hidden", id: "checkId", name: "checkId", defaultValue: checkId },
      { type: "text", id: "note", name: "note", label: "Review note", defaultValue: "Initial note" },
    ] }] }
  }

  it("binds late context without discarding edits or replacing an existing binding", async () => {
    const submit = vi.fn()
    const { rerender } = render(<ModularForm config={referenceForm("")} onSubmit={submit} />)
    fireEvent.change(screen.getByTestId("form-field-note"), { target: { value: "Operator review" } })
    rerender(<ModularForm config={referenceForm("17")} onSubmit={submit} />)
    fireEvent.click(screen.getByRole("button", { name: "common.submit" }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ checkId: "17", note: "Operator review" }))
    rerender(<ModularForm config={referenceForm("18")} onSubmit={submit} />)
    fireEvent.click(screen.getByRole("button", { name: "common.submit" }))
    await waitFor(() => expect(submit).toHaveBeenLastCalledWith({ checkId: "17", note: "Operator review" }))
  })

  it("does not mark a pristine form dirty when reference data arrives", async () => {
    const dirty = vi.fn()
    const { rerender } = render(<ModularForm config={referenceForm("")} onDirtyChange={dirty} />)
    rerender(<ModularForm config={referenceForm("17")} onDirtyChange={dirty} />)
    await waitFor(() => expect((screen.getByTestId("form-field-checkId") as HTMLInputElement).value).toBe("17"))
    expect(dirty).not.toHaveBeenCalledWith(true)
  })
})
