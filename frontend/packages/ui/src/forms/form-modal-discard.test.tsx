import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import type { FormConfig } from "../lib/form-types"
import { FormModal } from "./form-modal"

beforeAll(() => {
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

vi.mock("../components/select", () => ({
  Select: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}))

vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({
  useAiFormSuggest: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}))

afterEach(cleanup)

const config: FormConfig = {
  id: "new-note",
  title: "New note",
  submitLabel: "Save",
  sections: [
    { id: "main", fields: [{ id: "title", name: "title", label: "Title", type: "text", defaultValue: "Draft" }] },
  ],
}

function setup(onSubmit: (values: Record<string, unknown>) => void = () => {}) {
  const onOpenChange = vi.fn()
  const addSpy = vi.spyOn(window, "addEventListener")
  render(<FormModal open onOpenChange={onOpenChange} config={config} onSubmit={onSubmit} showSubmitSuccessToast={false} />)
  const unloadRegistrations = () => addSpy.mock.calls.filter(([type]) => type === "beforeunload").length
  return { onOpenChange, unloadRegistrations }
}

const edit = (value: string) =>
  fireEvent.change(screen.getByTestId("form-field-title"), { target: { value } })
const cancel = () => fireEvent.click(screen.getByRole("button", { name: /cancel/i }))

describe("FormModal unsaved-changes guard", () => {
  it("keeps edits protected when the form has no submit binding", async () => {
    const onOpenChange = vi.fn()
    render(<FormModal open onOpenChange={onOpenChange} config={config} showSubmitSuccessToast={false} />)
    edit("Changed")
    fireEvent.click(screen.getByTestId("form-submit-new-note"))
    await waitFor(() => expect(screen.getByTestId("form-submit-new-note").hasAttribute("disabled")).toBe(false))
    cancel()
    expect(await screen.findByTestId("discard-changes-dialog")).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("ignores Escape during a save and protects edits after a rejected save", async () => {
    let reject!: (reason: Error) => void
    const { onOpenChange } = setup(() => new Promise<void>((_, fail) => { reject = fail }))
    edit("Changed")
    fireEvent.click(screen.getByTestId("form-submit-new-note"))
    fireEvent.keyDown(screen.getByTestId("form-modal-new-note"), { key: "Escape" })
    expect(onOpenChange).not.toHaveBeenCalled()
    await act(async () => { reject(new Error("Save failed")) })
    cancel()
    expect(await screen.findByTestId("discard-changes-dialog")).toBeTruthy()
    expect((screen.getByTestId("form-field-title") as HTMLInputElement).value).toBe("Changed")
  })

  it("closes straight away when nothing was edited", () => {
    const { onOpenChange, unloadRegistrations } = setup()
    cancel()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByTestId("discard-changes-dialog")).toBeNull()
    expect(unloadRegistrations()).toBe(0)
  })

  it("asks before closing a dirty form and keeps it open on Keep editing", async () => {
    const { onOpenChange } = setup()
    edit("Changed")
    cancel()
    expect(await screen.findByTestId("discard-changes-dialog")).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId("discard-changes-keep"))
    await waitFor(() => expect(screen.queryByTestId("discard-changes-dialog")).toBeNull())
    expect(onOpenChange).not.toHaveBeenCalled()
    expect((screen.getByTestId("form-field-title") as HTMLInputElement).value).toBe("Changed")
  })

  it("closes after the user confirms Discard", async () => {
    const { onOpenChange } = setup()
    edit("Changed")
    cancel()
    fireEvent.click(await screen.findByTestId("discard-changes-confirm"))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("treats editing back to the original value as pristine", () => {
    const { onOpenChange } = setup()
    edit("Changed")
    edit("Draft")
    cancel()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByTestId("discard-changes-dialog")).toBeNull()
  })

  it("closes after a successful submit without asking", async () => {
    const onSubmit = vi.fn()
    const { onOpenChange } = setup(onSubmit)
    edit("Changed")
    fireEvent.click(screen.getByTestId("form-submit-new-note"))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onSubmit).toHaveBeenCalled()
    expect(screen.queryByTestId("discard-changes-dialog")).toBeNull()
  })

  it("closes an edited form without a discard warning after durable recovery is available", async () => {
    const onOpenChange = vi.fn()
    const add = vi.spyOn(window, "addEventListener")
    const remove = vi.spyOn(window, "removeEventListener")
    const props = { open: true, onOpenChange, config, onSubmit: vi.fn(), draft: false }
    const { rerender } = render(<FormModal {...props} />)
    edit("Retained expense")
    const handler = add.mock.calls.filter(([type]) => type === "beforeunload").at(-1)![1]

    rerender(<FormModal {...props} hasDurableRecovery />)
    await waitFor(() => expect(remove.mock.calls.some(([type, listener]) => type === "beforeunload" && listener === handler)).toBe(true))
    cancel()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByTestId("discard-changes-dialog")).toBeNull()
  })

  it("keeps the close lock during a save even when durable recovery is available", async () => {
    let resolve!: () => void
    const onOpenChange = vi.fn()
    const onSubmit = vi.fn(() => new Promise<void>((done) => { resolve = done }))
    const props = { open: true, onOpenChange, config, onSubmit, draft: false, hasDurableRecovery: true, closeOnSubmit: false }
    const { rerender } = render(<FormModal {...props} />)
    edit("Retained expense")
    fireEvent.click(screen.getByTestId("form-submit-new-note"))
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.queryByTestId("discard-changes-dialog")).toBeNull()

    await act(async () => { resolve() })
    rerender(<FormModal {...props} isPending />)
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(onOpenChange).not.toHaveBeenCalled()
    rerender(<FormModal {...props} isPending={false} />)
    cancel()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByTestId("discard-changes-dialog")).toBeNull()
  })

  it("registers beforeunload only while dirty and removes it when clean", async () => {
    const add = vi.spyOn(window, "addEventListener")
    const remove = vi.spyOn(window, "removeEventListener")
    const count = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === "beforeunload").length
    const before = count(add)
    render(<FormModal open onOpenChange={() => {}} config={config} onSubmit={() => {}} showSubmitSuccessToast={false} />)
    expect(count(add)).toBe(before)

    edit("Changed")
    await waitFor(() => expect(count(add)).toBe(before + 1))
    const handler = add.mock.calls.filter(([type]) => type === "beforeunload").at(-1)![1] as EventListener
    const event = new Event("beforeunload", { cancelable: true })
    handler(event)
    expect(event.defaultPrevented).toBe(true)

    edit("Draft")
    await waitFor(() => expect(count(remove)).toBeGreaterThan(0))
  })
})

describe("FormModal authoring preview", () => {
  it("shows a rejected save inline and retains the draft and selected receipt without closing", async () => {
    const onOpenChange = vi.fn()
    const onSubmit = vi.fn(async (_values: Record<string, unknown>) => { throw new Error("Select an employee available in this company.") })
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const receiptConfig: FormConfig = { ...config, showReset: true, sections: [{ id: "main", fields: [
      ...config.sections[0]!.fields,
      { id: "receipt", name: "receipt", type: "file", label: "Receipt" },
    ] }] }
    const props = { open: true, onOpenChange, config: receiptConfig, onSubmit, draft: false }
    const { rerender } = render(<FormModal {...props} />)
    edit("Expense to correct")
    const receipt = new File(["receipt"], "receipt.pdf", { type: "application/pdf" })
    const fileInput = screen.getByTestId("form-field-receipt") as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [receipt] } })
    fireEvent.click(screen.getByTestId("form-submit-new-note"))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe("Select an employee available in this company.")
    expect(alert.closest("[data-form-body]")).not.toBeNull()
    expect(alert.getAttribute("tabindex")).toBe("-1")
    expect(onOpenChange).not.toHaveBeenCalled()
    expect((screen.getByTestId("form-field-title") as HTMLInputElement).value).toBe("Expense to correct")
    expect(fileInput.files?.[0]).toBe(receipt)
    expect(onSubmit.mock.calls[0]?.[0].receipt).toEqual([receipt])

    rerender(<FormModal {...props} config={{ ...receiptConfig }} />)
    expect(screen.getByRole("alert").textContent).toBe("Select an employee available in this company.")
    rerender(<FormModal {...props} submitError="The selected company is unavailable." />)
    expect(screen.getByRole("alert").textContent).toBe("The selected company is unavailable.")
    rerender(<FormModal {...props} />)
    fireEvent.click(screen.getByRole("button", { name: /reset/i }))
    expect(screen.queryByRole("alert")).toBeNull()
    consoleError.mockRestore()
  })

  it("keeps submission feedback beside the fields without replacing an edited draft", () => {
    const onOpenChange = vi.fn()
    const props = { open: true, onOpenChange, config, onSubmit: vi.fn() }
    const { rerender } = render(<FormModal {...props} />)
    edit("Entry to correct")

    rerender(<FormModal {...props} submitError="The selected account is unavailable. Choose another account." />)
    const error = screen.getByRole("alert")
    expect(error.closest("[data-form-body]")).not.toBeNull()
    expect((screen.getByTestId("form-field-title") as HTMLInputElement).value).toBe("Entry to correct")

    rerender(<FormModal {...props} submitError={null} />)
    expect(screen.queryByRole("alert")).toBeNull()
    expect((screen.getByTestId("form-field-title") as HTMLInputElement).value).toBe("Entry to correct")
    cancel()
    expect(screen.getByTestId("discard-changes-dialog")).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("prevents example inputs from implicitly submitting the record", () => {
    const onSubmit = vi.fn()
    render(
      <FormModal
        open
        onOpenChange={vi.fn()}
        config={config}
        onSubmit={onSubmit}
        renderPreview={() => <input aria-label="Sample amount" defaultValue="100" />}
      />,
    )
    expect(fireEvent.keyDown(screen.getByLabelText("Sample amount"), { key: "Enter" })).toBe(false)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("uses the submitted form state for defaults, edits, and reset", async () => {
    const onSubmit = vi.fn()
    render(
      <FormModal
        open
        onOpenChange={vi.fn()}
        config={{ ...config, showReset: true }}
        onSubmit={onSubmit}
        showSubmitSuccessToast={false}
        renderPreview={(values) => <output data-testid="draft-preview">{String(values.title)}</output>}
      />,
    )
    expect(screen.getByTestId("draft-preview").textContent).toBe("Draft")
    edit("New invoice")
    expect(screen.getByTestId("draft-preview").textContent).toBe("New invoice")
    fireEvent.click(screen.getByRole("button", { name: /reset/i }))
    expect(screen.getByTestId("draft-preview").textContent).toBe("Draft")
    edit("Reviewed invoice")
    fireEvent.click(screen.getByTestId("form-submit-new-note"))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ title: "Reviewed invoice" }))
  })

  it("keeps a rejected draft and its preview available for correction", async () => {
    const onOpenChange = vi.fn()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    render(
      <FormModal
        open
        onOpenChange={onOpenChange}
        config={config}
        onSubmit={async () => { throw new Error("Posting is unavailable") }}
        renderPreview={(values) => <output data-testid="draft-preview">{String(values.title)}</output>}
      />,
    )
    edit("Unsaved entry")
    fireEvent.click(screen.getByTestId("form-submit-new-note"))
    await waitFor(() => expect(screen.getByTestId("form-submit-new-note").hasAttribute("disabled")).toBe(false))
    expect(screen.getByTestId("draft-preview").textContent).toBe("Unsaved entry")
    expect(onOpenChange).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it("does not create a preview region for forms without an authoring tool", () => {
    setup()
    expect(screen.queryByTestId("form-preview-new-note")).toBeNull()
  })
})


describe("FormModal dependent fields", () => {
  const conditionalConfig: FormConfig = {
    id: "conditional", title: "Conditional form", submitLabel: "Save",
    sections: [{ id: "main", fields: [
      { id: "method", name: "method", label: "Method", type: "text", defaultValue: "Linear" },
      { id: "factor", name: "factor", label: "Factor", type: "number", required: true,
        visibleWhen: { field: "method", oneOf: ["Degressive", "DegressiveThenLinear"] } },
      { id: "dependent", name: "dependent", type: "custom", component: ({ values }) =>
        <output data-testid="dependent-value">{String(values?.method)}</output> },
    ] }],
  }

  it("skips hidden required fields and passes current values to custom pickers", async () => {
    const onSubmit = vi.fn()
    render(<FormModal open onOpenChange={vi.fn()} config={conditionalConfig} onSubmit={onSubmit} showSubmitSuccessToast={false} />)
    expect(screen.queryByTestId("form-field-factor")).toBeNull()
    expect(screen.getByTestId("dependent-value").textContent).toBe("Linear")
    fireEvent.click(screen.getByTestId("form-submit-conditional"))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
  })

  it("validates visible required fields and retains an edited value when hidden", async () => {
    const onSubmit = vi.fn()
    render(<FormModal open onOpenChange={vi.fn()} config={conditionalConfig} onSubmit={onSubmit} showSubmitSuccessToast={false} />)
    const method = screen.getByTestId("form-field-method")
    fireEvent.change(method, { target: { value: "DegressiveThenLinear" } })
    expect(screen.getByTestId("dependent-value").textContent).toBe("DegressiveThenLinear")
    fireEvent.click(screen.getByTestId("form-submit-conditional"))
    await waitFor(() => expect(screen.getByTestId("form-field-factor").getAttribute("aria-invalid")).toBe("true"))
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.change(screen.getByTestId("form-field-factor"), { target: { value: "0.2" } })
    fireEvent.change(method, { target: { value: "Linear" } })
    expect(screen.queryByTestId("form-field-factor")).toBeNull()
    fireEvent.change(method, { target: { value: "Degressive" } })
    expect((screen.getByTestId("form-field-factor") as HTMLInputElement).value).toBe("0.2")
    fireEvent.click(screen.getByTestId("form-submit-conditional"))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ method: "Degressive", factor: 0.2 })))
  })
})


describe("FormModal conditional file selection", () => {
  it("clears a file when its input is hidden and requires a new choice when shown again", async () => {
    const onSubmit = vi.fn()
    const fileConfig: FormConfig = { id: "receipt", title: "Receipt", sections: [{ id: "main", fields: [
      { id: "hasReceipt", name: "hasReceipt", type: "text", defaultValue: "true" },
      { id: "receiptFile", name: "receiptFile", type: "file", required: true,
        visibleWhen: { field: "hasReceipt", equals: "true" } },
    ] }] }
    render(<FormModal open onOpenChange={vi.fn()} config={fileConfig} onSubmit={onSubmit} showSubmitSuccessToast={false} />)
    fireEvent.change(screen.getByTestId("form-field-receiptFile"), { target: { files: [new File(["receipt"], "receipt.pdf", { type: "application/pdf" })] } })
    fireEvent.change(screen.getByTestId("form-field-hasReceipt"), { target: { value: "false" } })
    expect(screen.queryByTestId("form-field-receiptFile")).toBeNull()
    fireEvent.change(screen.getByTestId("form-field-hasReceipt"), { target: { value: "true" } })
    fireEvent.click(screen.getByTestId("form-submit-receipt"))
    await waitFor(() => expect(screen.getByTestId("form-field-receiptFile").getAttribute("aria-invalid")).toBe("true"))
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.change(screen.getByTestId("form-field-hasReceipt"), { target: { value: "false" } })
    fireEvent.click(screen.getByTestId("form-submit-receipt"))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ hasReceipt: "false", receiptFile: undefined }))
  })
})
