import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { FormConfig } from "../lib/form-types"
import type { MergedFormConfiguration, ParsedFormField } from "./config/types"
import { workspaceStyles } from "../lib/workspace-styles"
import { ModularForm } from "./modular-form"
import { RuntimeFormModal } from "./runtime-form-modal"

vi.mock("@lumiere/i18n", async (importOriginal) => ({ ...(await importOriginal<typeof import("@lumiere/i18n")>()),  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))
vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({ useAiFormSuggest: () => ({ isPending: false }) }))
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock("./hooks/use-form-config", () => ({
  useFormConfiguration: () => ({ config: runtimeConfig, isLoading: false, error: null, dbConfigurationId: 1 }),
}))

const staticConfig: FormConfig = {
  id: "style-contract", title: "Create accounting record", description: "Prepare the document for review.", submitLabel: "Save draft",
  sections: [{ id: "document", title: "Document details", description: "Record identity and context", fields: [
    { id: "reference", name: "reference", type: "text", label: "Reference", required: true, width: "1/2" },
  ] }],
}
const field = (overrides: Partial<ParsedFormField>): ParsedFormField => ({
  id: 1, fieldId: "reference", name: "reference", label: "Customer reference", type: "Text",
  options: [], validation: { required: true }, aiSuggestions: [], order: 1, isSystem: true,
  isEnabled: true, showInList: false, width: "Half", ...overrides,
})
const runtimeFields = [field({}), field({ id: 2, fieldId: "custom:alpha_reference", name: "alpha_reference", label: "Alpha reference", defaultValue: "ALPHA-01", isSystem: false, width: "Full" })]
const runtimeConfig: MergedFormConfiguration = {
  config: {} as MergedFormConfiguration["config"], fields: runtimeFields, sourceFields: runtimeFields, customFields: [runtimeFields[1]!],
}

afterEach(cleanup)

function expectStyle(element: Element, style: string) {
  for (const token of style.split(" ")) expect(element.classList.contains(token), `Expected ${token} on ${element.tagName}`).toBe(true)
}

describe("renderer-owned form styling", () => {
  it.each(["default", "card"] as const)("propagates shared heading, section and action roles to a static %s form", (layout) => {
    const { container } = render(<ModularForm config={{ ...staticConfig, layout }} onSubmit={vi.fn()} />)
    const title = screen.getByText(staticConfig.title)
    expect(title.classList.contains("ui-page-title")).toBe(true)
    expect(title.closest(".ui-page-header")).toBeTruthy()
    expectStyle(screen.getByText("Document details"), workspaceStyles.sectionTitle)
    expectStyle(screen.getByText("Record identity and context"), workspaceStyles.sectionDescription)
    expect(screen.getByTestId("form-submit-style-contract").closest(".ui-form-actions")).toBeTruthy()
    const input = screen.getByTestId("form-field-reference")
    expect(input.classList.contains("focus-visible:ring-ring")).toBe(true)
    expect(input.classList.contains("focus-visible:ring-ring/20")).toBe(false)
    const fieldContainer = input.parentElement!
    expect(fieldContainer.classList.contains("col-span-12")).toBe(true)
    expect(fieldContainer.classList.contains("md:col-span-6")).toBe(true)
    if (layout === "card") expectStyle(container.querySelector('[data-slot="card"]')!, workspaceStyles.surface)
  })

  it("carries runtime merged fields through the styled modal while retaining metadata submission", async () => {
    const onSubmit = vi.fn()
    render(<RuntimeFormModal open onOpenChange={vi.fn()} staticConfig={staticConfig} moduleId="accounting" organizationId={1} onSubmit={onSubmit} closeOnSubmit={false} showSubmitSuccessToast={false} />)
    const dialog = screen.getByTestId("form-modal-style-contract")
    expectStyle(dialog, workspaceStyles.surface)
    expectStyle(screen.getByTestId("form-modal-title"), workspaceStyles.sectionTitle)
    expect(screen.getByTestId("form-modal-title").closest(".ui-page-header")).toBeTruthy()
    expect(screen.getByText("Customer reference")).toBeTruthy()
    expect(screen.getByTestId("form-field-reference").classList.contains("focus-visible:ring-ring")).toBe(true)
    expectStyle(screen.getByText("Additional fields"), workspaceStyles.sectionTitle)
    expect(screen.getByTestId("form-submit-style-contract").closest(".ui-form-actions")).toBeTruthy()
    fireEvent.change(screen.getByTestId("form-field-reference"), { target: { value: "INV-ALPHA" } })
    fireEvent.click(screen.getByTestId("form-submit-style-contract"))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ reference: "INV-ALPHA", metadata: JSON.stringify({ "custom:alpha_reference": "ALPHA-01" }) }))
  })
})
