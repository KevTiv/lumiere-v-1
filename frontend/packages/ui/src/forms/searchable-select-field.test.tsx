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

// The real Select imports a web-only path alias that vitest cannot resolve.
vi.mock("../components/select", () => ({
  Select: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}))

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
  it("lets the user search, pick a record, and submits its id", async () => {
    const onSubmit = vi.fn()
    renderForm(onSubmit)

    fireEvent.click(screen.getByTestId("form-field-partnerId"))
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
