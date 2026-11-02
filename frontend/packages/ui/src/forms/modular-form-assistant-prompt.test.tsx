import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ModularForm } from "./modular-form"
import type { FormConfig } from "../lib/form-types"

const suggest = vi.hoisted(() => vi.fn())
vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}))
vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({
  useAiFormSuggest: () => ({ mutateAsync: suggest, isPending: false }),
}))
vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn() },
}))

afterEach(() => {
  cleanup()
  suggest.mockReset()
})
const config: FormConfig = {
  id: "assistant-order",
  title: "Order",
  sections: [
    {
      id: "main",
      fields: [
        {
          id: "reference",
          name: "reference",
          type: "text",
          label: "Reference",
        },
      ],
    },
  ],
}

describe("native form assistant proposal review", () => {
  it("shows the handed-off prompt without a provider request or implicit field edits", async () => {
    const submit = vi.fn()
    suggest.mockResolvedValue({
      suggestions: {
        reference: { value: "Suggested reference", confidence: 0.9 },
      },
      validation_notes: [],
      sources: [],
    })
    render(
      <ModularForm
        config={config}
        draft={false}
        onSubmit={submit}
        aiAssist={{
          companyId: 7,
          entityType: "sale_order",
          initialPrompt: "Prepare an order for our meeting",
        }}
      />,
    )
    expect(
      screen.getByDisplayValue("Prepare an order for our meeting"),
    ).toBeTruthy()
    expect(suggest).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText("Reference"), {
      target: { value: "My unsaved reference" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Suggest values" }))
    await waitFor(() => expect(suggest).toHaveBeenCalledOnce())
    expect(suggest.mock.calls[0]![0]).toMatchObject({
      companyId: 7,
      entityType: "sale_order",
      rawText: "Prepare an order for our meeting",
    })
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Apply suggestions",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    )
    expect((screen.getByLabelText("Reference") as HTMLInputElement).value).toBe(
      "My unsaved reference",
    )
    expect(submit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Apply suggestions" }))
    expect((screen.getByLabelText("Reference") as HTMLInputElement).value).toBe(
      "Suggested reference",
    )
    expect(submit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "common.submit" }))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({ reference: "Suggested reference" }),
    )
  })

  it("leaves ordinary native form discovery free of implicit generation", () => {
    render(
      <ModularForm
        config={config}
        draft={false}
        aiAssist={{ companyId: 7, entityType: "sale_order" }}
      />,
    )
    expect(screen.queryByRole("button", { name: "Suggest values" })).toBeNull()
    expect(suggest).not.toHaveBeenCalled()
  })

  it("does not redispatch on rapid clicks or apply a reply from a prior company", async () => {
    let finish!: (value: unknown) => void
    suggest.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const view = render(
      <ModularForm
        config={config}
        draft={false}
        aiAssist={{
          companyId: 7,
          entityType: "sale_order",
          initialPrompt: "Use my reference",
        }}
      />,
    )
    const trigger = screen.getByRole("button", { name: "Suggest values" })
    fireEvent.click(trigger)
    fireEvent.click(trigger)
    expect(suggest).toHaveBeenCalledTimes(1)
    view.rerender(
      <ModularForm
        config={config}
        draft={false}
        aiAssist={{
          companyId: 8,
          entityType: "sale_order",
          initialPrompt: "Use my reference",
        }}
      />,
    )
    await act(async () =>
      finish({
        suggestions: { reference: { value: "Prior company", confidence: 1 } },
        validation_notes: [],
        sources: [],
      }),
    )
    expect(
      (
        screen.getByRole("button", {
          name: "Apply suggestions",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect((screen.getByLabelText("Reference") as HTMLInputElement).value).toBe(
      "",
    )
  })

  it("invalidates staged values when the native field becomes readonly", async () => {
    suggest.mockResolvedValue({
      suggestions: {
        reference: { value: "Proposed reference", confidence: 1 },
      },
      validation_notes: [],
      sources: [],
    })
    const view = render(
      <ModularForm
        config={config}
        draft={false}
        aiAssist={{
          companyId: 7,
          entityType: "sale_order",
          initialPrompt: "Use my reference",
        }}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Suggest values" }))
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Apply suggestions",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    )
    const readonly = {
      ...config,
      sections: config.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) => ({ ...field, disabled: true })),
      })),
    }
    view.rerender(
      <ModularForm
        config={readonly}
        draft={false}
        aiAssist={{
          companyId: 7,
          entityType: "sale_order",
          initialPrompt: "Use my reference",
        }}
      />,
    )
    expect(
      (
        screen.getByRole("button", {
          name: "Apply suggestions",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect((screen.getByLabelText("Reference") as HTMLInputElement).value).toBe(
      "",
    )
  })
})
