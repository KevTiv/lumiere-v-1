import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { CreateInvoiceModal } from "./create-invoice-modal"
import { AssistantFormProposals } from "../components/assistant-form-proposals"

const suggest = vi.hoisted(() => vi.fn())
vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({
  useAiFormSuggest: () => ({ mutateAsync: suggest, isPending: false }),
}))
vi.mock("../forms/hooks/use-form-config", () => ({
  useFormConfiguration: () => ({ config: { fields: [] } }),
}))

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(() => {
  cleanup()
  suggest.mockReset()
})
const reply = (
  suggestions: Record<string, { value: unknown; confidence: number }>,
) => ({ suggestions, validation_notes: [], sources: [] })
const fields = [
  {
    name: "partnerId",
    label: "Customer",
    type: "select",
    required: true,
    options: [{ value: "22", label: "Allowed customer" }],
  },
]

describe("assistant values in the released invoice and bill editor", () => {
  for (const kind of ["invoice", "bill"] as const) {
    it(`retains the original ${kind} request and stages header values before explicit apply`, async () => {
      const save = vi.fn()
      suggest.mockResolvedValue(
        reply({
          reference: { value: "Reviewed AI reference", confidence: 0.9 },
        }),
      )
      render(
        <CreateInvoiceModal
          open
          kind={kind}
          companyId={7n}
          onClose={() => {}}
          onSave={save}
          onCheckStatus={async () => null}
          assistantRequest={{
            prompt: "Create this draft with reference PO-42",
            scopeKey: "actor:org:7",
          }}
          journalOptions={[{ value: "1", label: "Journal", currencyId: "3" }]}
          partnerOptions={[{ value: "22", label: "Allowed partner" }]}
          counterpartAccountOptions={[{ value: "2", label: "Counterpart" }]}
          lineAccountOptions={[{ value: "4", label: "Line account" }]}
        />,
      )
      expect(
        screen.getByDisplayValue("Create this draft with reference PO-42"),
      ).toBeTruthy()
      expect(suggest).not.toHaveBeenCalled()
      fireEvent.change(screen.getByLabelText("Reference"), {
        target: { value: "My current reference" },
      })
      fireEvent.click(screen.getByRole("button", { name: "Suggest values" }))
      await screen.findByText("Reviewed AI reference")
      expect(
        (screen.getByLabelText("Reference") as HTMLInputElement).value,
      ).toBe("My current reference")
      expect(save).not.toHaveBeenCalled()
      expect(suggest.mock.calls[0]![0]).toMatchObject({
        companyId: 7,
        entityType: "account_move",
        formId: kind === "bill" ? "new-bill" : "new-invoice",
      })
      fireEvent.click(screen.getByRole("button", { name: "Apply suggestions" }))
      expect(
        (screen.getByLabelText("Reference") as HTMLInputElement).value,
      ).toBe("Reviewed AI reference")
      expect(save).not.toHaveBeenCalled()
    })
  }

  it("rejects unregistered fields and partner IDs outside the current native choices", async () => {
    const apply = vi.fn()
    suggest.mockResolvedValue(
      reply({ partnerId: { value: "foreign-partner", confidence: 1 } }),
    )
    render(
      <AssistantFormProposals
        companyId={7}
        scopeKey="actor:org:7"
        entityType="account_move"
        formId="new-invoice"
        prompt="Choose my customer"
        fields={fields}
        onApply={apply}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Suggest values" }))
    await screen.findByRole("alert")
    expect(
      (
        screen.getByRole("button", {
          name: "Apply suggestions",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(apply).not.toHaveBeenCalled()
    suggest.mockResolvedValue(
      reply({ companyId: { value: "8", confidence: 1 } }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Suggest values" }))
    await waitFor(() => expect(suggest).toHaveBeenCalledTimes(2))
    await screen.findByRole("alert")
    expect(apply).not.toHaveBeenCalled()
  })

  it("discards a late reply after actor scope or reference choices change", async () => {
    let finish!: (value: ReturnType<typeof reply>) => void
    suggest.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const apply = vi.fn()
    const view = render(
      <AssistantFormProposals
        companyId={7}
        scopeKey="actor:org:7"
        entityType="account_move"
        formId="new-invoice"
        prompt="Choose my customer"
        fields={fields}
        onApply={apply}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Suggest values" }))
    view.rerender(
      <AssistantFormProposals
        companyId={7}
        scopeKey="other-actor:org:7"
        entityType="account_move"
        formId="new-invoice"
        prompt="Choose my customer"
        fields={[{ ...fields[0]!, options: [] }]}
        onApply={apply}
      />,
    )
    await act(async () =>
      finish(reply({ partnerId: { value: "22", confidence: 1 } })),
    )
    expect(screen.queryByText("Allowed customer")).toBeNull()
    expect(
      (
        screen.getByRole("button", {
          name: "Apply suggestions",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(apply).not.toHaveBeenCalled()
  })

  it("dispatches one suggestion request for repeated clicks and ignores an unmounted reply", async () => {
    let finish!: (value: ReturnType<typeof reply>) => void
    suggest.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const apply = vi.fn()
    const view = render(
      <AssistantFormProposals
        companyId={7}
        scopeKey="actor:org:7"
        entityType="account_move"
        formId="new-invoice"
        prompt="Choose my customer"
        fields={fields}
        onApply={apply}
      />,
    )
    const trigger = screen.getByRole("button", { name: "Suggest values" })
    fireEvent.click(trigger)
    fireEvent.click(trigger)
    expect(suggest).toHaveBeenCalledTimes(1)
    view.unmount()
    await act(async () =>
      finish(reply({ partnerId: { value: "22", confidence: 1 } })),
    )
    expect(apply).not.toHaveBeenCalled()
  })
})
