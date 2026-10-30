import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { FormConfig } from "../lib/form-types"
import { RuntimeFormModal } from "./runtime-form-modal"

const state = vi.hoisted(() => ({ config: null as FormConfig | null }))
vi.mock("./hooks/use-runtime-form-modal-config", () => ({
  useRuntimeFormModalConfig: ({ staticConfig }: { staticConfig: FormConfig }) => ({
    config: state.config ?? staticConfig, isLoading: false, error: null,
    customFieldIds: ["custom:reference"], customFieldCreateIssues: [], runtimeFromDatabase: true,
  }),
}))
vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({ useAiFormSuggest: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }) }))
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(cleanup)

describe("real configured-create editor retention", () => {
  it("retains real form values and blocks dispatch while an unsupported definition is present", async () => {
    const config: FormConfig = { id: "new-contact", title: "Create contact", customFieldCreateCapability: "atomic-configured-v1", submitLabel: "Save contact", sections: [{ id: "identity", fields: [
      { id: "name", name: "name", label: "Name", type: "text", required: true },
      { id: "custom:reference", name: "custom:reference", label: "Reference", type: "text" },
    ] }] }
    state.config = config
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const props = { open: true, onOpenChange: vi.fn(), staticConfig: config, moduleId: "crm", organizationId: 1, onSubmit, draft: false, closeOnSubmit: false, showSubmitSuccessToast: false }
    const { rerender } = render(<RuntimeFormModal {...props} />)
    fireEvent.change(screen.getByTestId("form-field-name"), { target: { value: "A saved contact" } })
    const reference = screen.getByTestId("form-field-custom:reference") as HTMLInputElement
    fireEvent.change(reference, { target: { value: "Exact retained reference" } })
    state.config = { ...config, sections: [{ ...config.sections[0]!, fields: [...config.sections[0]!.fields,
      { id: "custom:attachment", name: "custom:attachment", label: "Attachment", type: "file" },
    ] }] }
    rerender(<RuntimeFormModal {...props} />)
    expect(screen.getByRole("alert").textContent).toContain("Attachment")
    expect(screen.getByTestId("form-field-custom:reference")).toBe(reference)
    expect(reference.value).toBe("Exact retained reference")
    expect(reference.disabled).toBe(true)
    fireEvent.click(screen.getByTestId("form-submit-new-contact"))
    expect(onSubmit).not.toHaveBeenCalled()
    state.config = config
    rerender(<RuntimeFormModal {...props} />)
    expect(reference.disabled).toBe(false)
    expect(reference.value).toBe("Exact retained reference")
    fireEvent.click(screen.getByTestId("form-submit-new-contact"))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ name: "A saved contact", metadata: JSON.stringify({ "custom:reference": "Exact retained reference" }) })
  })
})
