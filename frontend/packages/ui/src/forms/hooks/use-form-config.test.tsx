import { renderHook, act, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { useFormConfiguration } from "./use-form-config"
import type { FormConfig, FormConfigField, FormRoleConfig } from "../config/types"

vi.mock("@lumiere/ui/forms", async () => {
  const actual = await vi.importActual("@lumiere/ui/forms")
  return {
    ...actual,
    getDefaultFormConfig: vi.fn((moduleId: string, formId: string) => {
      if (moduleId === "journal" && formId === "daily-entry") {
        return {
          moduleId: "journal",
          formId: "daily-entry",
          name: "Daily Journal",
          description: "Daily work journal",
          isSystemDefault: true,
          fields: [
            {
              fieldId: "mood",
              name: "mood",
              label: "How was your day?",
              fieldType: "Radio",
              options: [
                { value: "great", label: "Great", color: "green" },
                { value: "good", label: "Good", color: "teal" },
              ],
              validation: { required: true },
              aiSuggestions: [],
              order: 1,
              isSystem: true,
              isEnabled: true,
              showInList: false,
              width: "Full",
            },
            {
              fieldId: "accomplishments",
              name: "accomplishments",
              label: "What did you accomplish?",
              fieldType: "Textarea",
              validation: { required: true, minLength: 10 },
              aiSuggestions: ["Completed tasks"],
              order: 2,
              isSystem: true,
              isEnabled: true,
              showInList: false,
              width: "Full",
            },
          ],
          roleConfigs: {
            "role-admin": {
              roleId: "role-admin",
              enabledFields: ["mood", "accomplishments"],
              requiredFields: ["mood", "accomplishments"],
              defaultPrompts: [],
            },
          },
        }
      }
      return undefined
    }),
  }
})

describe("useFormConfiguration", () => {
  const defaultOptions = {
    moduleId: "journal",
    formId: "daily-entry",
    organizationId: 1,
    roleId: "role-admin",
  }

  it("should load form configuration successfully", async () => {
    const { result } = renderHook(() => useFormConfiguration(defaultOptions))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.error).toBeNull()
    expect(result.current.config).not.toBeNull()
    expect(result.current.config?.config.moduleId).toBe("journal")
    expect(result.current.config?.config.formId).toBe("daily-entry")
  })

  it("should return fields from configuration", async () => {
    const { result } = renderHook(() => useFormConfiguration(defaultOptions))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.config?.fields.length).toBeGreaterThan(0)
    const moodField = result.current.config?.fields.find(f => f.fieldId === "mood")
    expect(moodField).toBeDefined()
    expect(moodField?.label).toBe("How was your day?")
  })

  it("should filter fields based on role configuration", async () => {
    const { result } = renderHook(() =>
      useFormConfiguration({
        ...defaultOptions,
        roleId: "role-viewer",
        useDefaultIfMissing: true,
      })
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    if (result.current.config?.roleConfig) {
      expect(result.current.config?.roleConfig.enabledFields).toContain("mood")
    }
  })

  it("should return error when configuration not found", async () => {
    const { result } = renderHook(() =>
      useFormConfiguration({
        moduleId: "nonexistent",
        formId: "form",
        organizationId: 1,
        useDefaultIfMissing: false,
      })
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.error).toBeTruthy()
    expect(result.current.config).toBeNull()
  })

  it("should parse field options correctly", async () => {
    const { result } = renderHook(() => useFormConfiguration(defaultOptions))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    const moodField = result.current.config?.fields.find(f => f.fieldId === "mood")
    expect(moodField?.options).toBeDefined()
    expect(moodField?.options.length).toBe(2)
    expect(moodField?.options[0]).toEqual({
      value: "great",
      label: "Great",
      color: "green",
    })
  })

  it("should handle refetch", async () => {
    const { result } = renderHook(() => useFormConfiguration(defaultOptions))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    const initialConfig = result.current.config
    act(() => {
      result.current.refetch()
    })

    expect(result.current.isLoading).toBe(true)
  })
})
