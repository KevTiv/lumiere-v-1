import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
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

// AI suggestions are not under test and need a query client.
vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({
  useAiFormSuggest: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}))

afterEach(cleanup)

const config: FormConfig = {
  id: "new-contract",
  title: "New contract",
  submitLabel: "Save",
  sections: [
    {
      id: "main",
      fields: [
        {
          id: "partnerId",
          name: "partnerId",
          label: "Partner",
          type: "select",
          required: true,
          searchable: true,
          options: [
            { value: "1", label: "Acme Corp" },
            { value: "2", label: "Globex" },
          ],
        },
      ],
    },
  ],
}

function renderForm(onSubmit: (values: Record<string, unknown>) => void) {
  return render(
    <FormModal open onOpenChange={() => {}} config={config} onSubmit={onSubmit} showSubmitSuccessToast={false} />,
  )
}

describe("searchable select field in a form dialog", () => {
  it("refreshes linked choices without replacing edited fields or the selected file", async () => {
    const submit = vi.fn()
    const configWithOptions = (options: Array<{ value: string; label: string }>): FormConfig => ({
      ...config,
      sections: [{ id: "main", fields: [
        { id: "partnerId", name: "partnerId", label: "Partner", type: "select", required: true, options, searchable: true },
        { id: "purpose", name: "purpose", label: "Purpose", type: "text" },
        { id: "receipt", name: "receipt", label: "Receipt", type: "file" },
      ] }],
    })
    const props = { open: true, onOpenChange: vi.fn(), onSubmit: submit, draft: false }
    const { rerender } = render(<FormModal {...props} config={configWithOptions([])} />)
    fireEvent.change(screen.getByTestId("form-field-purpose"), { target: { value: "Receipt to retain" } })
    const receipt = new File(["receipt"], "receipt.pdf", { type: "application/pdf" })
    const fileInput = screen.getByTestId("form-field-receipt") as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [receipt] } })

    rerender(<FormModal {...props} config={configWithOptions([{ value: "7", label: "Available employee" }])} />)
    expect((screen.getByTestId("form-field-purpose") as HTMLInputElement).value).toBe("Receipt to retain")
    expect(fileInput.files?.[0]).toBe(receipt)
    fireEvent.click(screen.getByTestId("form-field-partnerId"))
    fireEvent.click(await screen.findByRole("option", { name: "Available employee" }))
    fireEvent.click(screen.getByTestId("form-submit-new-contract"))
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ partnerId: "7", purpose: "Receipt to retain", receipt: [receipt] }))
  })

  it("lets the user search, pick a record, and submits its id", async () => {
    const onSubmit = vi.fn()
    renderForm(onSubmit)

    fireEvent.click(screen.getByRole("combobox", { name: /Partner/ }))
    fireEvent.change(await screen.findByPlaceholderText("Search..."), { target: { value: "glob" } })
    fireEvent.click(await screen.findByRole("option", { name: /Globex/ }))
    await waitFor(() => expect(screen.getByTestId("form-field-partnerId").textContent).toContain("Globex"))

    fireEvent.click(screen.getByTestId("form-submit-new-contract"))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ partnerId: "2" })
  })

  it("keeps a required searchable select from submitting empty", async () => {
    const onSubmit = vi.fn()
    renderForm(onSubmit)

    fireEvent.click(screen.getByTestId("form-submit-new-contract"))

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})


describe("plain select field accessibility", () => {
  it("exposes the visible field label as the picker accessible name", () => {
    const plain: FormConfig = { ...config, sections: [{ ...config.sections![0], fields: [{ ...config.sections![0].fields[0], searchable: false }] }] }
    render(<FormModal open onOpenChange={() => {}} config={plain} onSubmit={vi.fn()} showSubmitSuccessToast={false} />)
    expect(screen.getByRole("combobox", { name: /Partner/ })).toBeTruthy()
  })
})
