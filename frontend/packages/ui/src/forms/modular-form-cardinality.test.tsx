import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { FormConfig } from "../lib/form-types"
import { ModularForm } from "./modular-form"

vi.mock("@lumiere/i18n", async (importOriginal) => ({ ...(await importOriginal<typeof import("@lumiere/i18n")>()),  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string; value?: string }) => options?.defaultValue?.replace("{{value}}", options.value ?? "") ?? key }) }))
vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({ useAiFormSuggest: () => ({}) }))
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } }))

beforeAll(() => {
  // cmdk and Base UI popovers use browser APIs jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  if (typeof globalThis.PointerEvent === "undefined") {
    Object.defineProperty(globalThis, "PointerEvent", { value: MouseEvent, configurable: true })
  }
})

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

const chipLabels = () => Array.from(screen.queryByTestId("form-field-custom:regions-chips")?.querySelectorAll("li") ?? [], (chip) => chip.textContent)

async function toggle(...labels: string[]) {
  fireEvent.click(screen.getByTestId("form-field-custom:regions"))
  for (const label of labels) fireEvent.click(await screen.findByRole("option", { name: label }))
}

describe("ModularForm array fields", () => {
  it("initializes optional fields as arrays and submits multiple selections", async () => {
    const submit = vi.fn()
    render(<ModularForm config={config()} onSubmit={submit} />)
    fireEvent.click(screen.getByRole("button", { name: "common.submit" }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ "custom:regions": [] }))
    await toggle("North", "South")
    fireEvent.click(screen.getByRole("button", { name: "common.submit" }))
    await waitFor(() => expect(submit).toHaveBeenLastCalledWith({ "custom:regions": ["north", "south"] }))
  })
  it("blocks an empty required array and allows populated submission", async () => {
    const submit = vi.fn()
    render(<ModularForm config={config(undefined, true)} onSubmit={submit} />)
    fireEvent.click(screen.getByRole("button", { name: "common.submit" }))
    expect(screen.getByRole("alert").textContent).toContain("common.validation.required")
    expect(submit).not.toHaveBeenCalled()
    await toggle("South")
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
  it("resets to multiple defaults and notifies the review owner", () => {
    const onValuesChange = vi.fn()
    render(<ModularForm config={config(["north", "south"])} onValuesChange={onValuesChange} />)
    fireEvent.click(screen.getByRole("button", { name: "Remove South" }))
    expect(chipLabels()).toEqual(["North"])
    fireEvent.click(screen.getByRole("button", { name: "common.reset" }))
    expect(onValuesChange).toHaveBeenLastCalledWith({ "custom:regions": ["north", "south"] })
    expect(chipLabels()).toEqual(["North", "South"])
  })
  it("preserves unavailable and disabled saved values when other choices change", async () => {
    const submit = vi.fn()
    render(<ModularForm config={config(["retired", "locked"])} onSubmit={submit} />)
    expect(chipLabels()).toEqual(["Unavailable selection: retired", "Locked"])
    expect(screen.queryByRole("button", { name: "Remove Locked" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Remove Unavailable selection: retired" })).toBeNull()
    await toggle("Locked", "North")
    expect(screen.getByRole("option", { name: "Locked" }).getAttribute("aria-disabled")).toBe("true")
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
