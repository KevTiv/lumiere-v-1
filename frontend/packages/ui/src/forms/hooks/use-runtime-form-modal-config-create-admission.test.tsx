import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MergedFormConfiguration, ParsedFormField } from "../config/types"
import { useRuntimeFormModalConfig } from "./use-runtime-form-modal-config"

const state = vi.hoisted(() => ({ runtime: null as MergedFormConfiguration | null }))
vi.mock("./use-form-config", () => ({ useFormConfiguration: () => ({ config: state.runtime, isLoading: false, error: null, dbConfigurationId: 1 }) }))
afterEach(cleanup)

const field = (overrides: Partial<ParsedFormField> = {}): ParsedFormField => ({
  id: 1, fieldId: "custom:reviewer", name: "custom:reviewer", label: "Reviewer", type: "UserSelect",
  validation: { required: false }, options: [], aiSuggestions: [], order: 1, isSystem: false, isEnabled: true, showInList: false, width: "Full", ...overrides,
})

describe("runtime native create capability", () => {
  it("checks stored UserSelect options before runtime organization-user hydration", () => {
    const stored = field()
    const hydrated = field({ options: [{ value: "actor", label: "Authorized user" }] })
    state.runtime = { config: {} as MergedFormConfiguration["config"], fields: [hydrated], sourceFields: [stored], customFields: [] }
    const { result, rerender } = renderHook(() => useRuntimeFormModalConfig({
      staticConfig: { id: "new-contact", title: "Contact", customFieldCreateCapability: "atomic-configured-v1", sections: [] },
      moduleId: "crm", organizationId: 1,
    }))
    expect(result.current.config.sections[0]?.fields[0]?.type).toBe("select")
    expect(result.current.customFieldCreateIssues).toEqual([{ fieldId: "custom:reviewer", label: "Reviewer", reason: "unavailableChoices" }])
    state.runtime = { ...state.runtime, sourceFields: [hydrated] }
    rerender()
    expect(result.current.customFieldCreateIssues).toEqual([])
  })
})
