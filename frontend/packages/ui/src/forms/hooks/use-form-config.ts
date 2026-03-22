//! Form Configuration Hooks
//!
//! React hooks for accessing and managing form configurations from SpacetimeDB.
//! These hooks work with the unified form configuration system.

import { useEffect, useMemo, useReducer, useState } from "react"
import type {
  FormConfig,
  FormConfigField,
  FormRoleConfig,
  UserCustomField,
  ParsedFormField,
  ParsedRoleConfig,
  MergedFormConfiguration,
  CreateFormFieldParams,
  CreateRoleConfigParams,
} from "../config/types"
import {
  parseFormField,
  parseRoleConfig,
  getFieldsForRole,
  mergeWithCustomFields,
  isCustomField,
} from "../config/types"
import { formRegistry, getDefaultFormConfig } from "../config/registry"

// ═════════════════════════════════════════════════════════════════════════════
// STATE REDUCERS
// ═════════════════════════════════════════════════════════════════════════════

function listReducer<T>(_: T[], next: T[]): T[] {
  return next
}

interface FormConfigState {
  config: FormConfig | null
  fields: FormConfigField[]
  roleConfigs: FormRoleConfig[]
  customFields: UserCustomField[]
  isLoading: boolean
  error: string | null
}

const initialState: FormConfigState = {
  config: null,
  fields: [],
  roleConfigs: [],
  customFields: [],
  isLoading: true,
  error: null,
}

type FormConfigAction =
  | { type: "SET_DATA"; payload: Partial<FormConfigState> }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string }
  | { type: "UPDATE_FIELD"; payload: FormConfigField }
  | { type: "ADD_CUSTOM_FIELD"; payload: UserCustomField }
  | { type: "REMOVE_CUSTOM_FIELD"; payload: number }

function formConfigReducer(state: FormConfigState, action: FormConfigAction): FormConfigState {
  switch (action.type) {
    case "SET_DATA":
      return { ...state, ...action.payload, isLoading: false, error: null }
    case "SET_LOADING":
      return { ...state, isLoading: action.payload }
    case "SET_ERROR":
      return { ...state, error: action.payload, isLoading: false }
    case "UPDATE_FIELD":
      return {
        ...state,
        fields: state.fields.map(f =>
          f.id === action.payload.id ? action.payload : f
        ),
      }
    case "ADD_CUSTOM_FIELD":
      return {
        ...state,
        customFields: [...state.customFields, action.payload],
      }
    case "REMOVE_CUSTOM_FIELD":
      return {
        ...state,
        customFields: state.customFields.filter(f => f.id !== action.payload),
      }
    default:
      return state
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// HOOKS
// ═════════════════════════════════════════════════════════════════════════════

interface UseFormConfigurationOptions {
  moduleId: string
  formId: string
  organizationId: number
  roleId?: string
  userId?: string
  useDefaultIfMissing?: boolean
}

/**
 * Hook to access a form configuration with all its fields, role configs, and custom fields.
 * This is the main hook for consuming form configurations.
 */
export function useFormConfiguration(options: UseFormConfigurationOptions): {
  config: MergedFormConfiguration | null
  isLoading: boolean
  error: string | null
  refetch: () => void
} {
  const { moduleId, formId, organizationId, roleId, useDefaultIfMissing = true } = options
  const [state, dispatch] = useReducer(formConfigReducer, initialState)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    dispatch({ type: "SET_LOADING", payload: true })

    // TODO: Replace with generated bindings once forms module is published
    // import { FormConfig, FormConfigField, FormRoleConfig, UserCustomField } from "@/stdb/generated";
    //
    // // Subscribe to form config
    // const config = FormConfig.filter({ organizationId, moduleId, formId }).find(c => c.isActive);
    // if (config) {
    //   const fields = FormConfigField.filterByConfigurationId(config.id);
    //   const roleConfigs = FormRoleConfig.filterByConfigurationId(config.id);
    //   const customFields = UserCustomField.filter({ configurationId: config.id });
    //   dispatch({ type: "SET_DATA", payload: { config, fields, roleConfigs, customFields } });
    // } else if (useDefaultIfMissing) {
    //   // Use default config from registry
    //   loadDefaultConfig();
    // }

    // For now, use default config
    if (useDefaultIfMissing) {
      loadDefaultConfig()
    } else {
      dispatch({ type: "SET_ERROR", payload: "Form configuration not found" })
    }

    function loadDefaultConfig() {
      const defaultConfig = getDefaultFormConfig(moduleId, formId)
      if (defaultConfig) {
        // Convert default config to mock FormConfig structure
        const mockConfig: FormConfig = {
          id: 0,
          organizationId,
          moduleId,
          formId,
          name: defaultConfig.name,
          description: defaultConfig.description,
          isActive: true,
          isSystemDefault: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: "",
          updatedBy: "",
        }

        // Convert default fields to mock FormConfigField structure
        const mockFields: FormConfigField[] = defaultConfig.fields.map((field, index) => ({
          id: index + 1,
          configurationId: 0,
          fieldId: field.fieldId,
          name: field.name,
          label: field.label,
          fieldType: field.fieldType,
          description: field.description || "",
          placeholder: field.placeholder || "",
          defaultValue: field.defaultValue || "",
          optionsJson: JSON.stringify(field.options || []),
          validationJson: JSON.stringify(field.validation || { required: false }),
          aiSuggestionsJson: JSON.stringify(field.aiSuggestions || []),
          order: field.order,
          isSystem: field.isSystem,
          isEnabled: field.isEnabled,
          category: field.category || "",
          showInList: field.showInList,
          width: field.width,
          sectionId: field.sectionId || "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }))

        // Convert role configs
        const mockRoleConfigs: FormRoleConfig[] = defaultConfig.roleConfigs
          ? Object.values(defaultConfig.roleConfigs).map((rc, index) => ({
              id: index + 1,
              configurationId: 0,
              roleId: rc.roleId,
              enabledFieldsJson: JSON.stringify(rc.enabledFields),
              requiredFieldsJson: JSON.stringify(rc.requiredFields),
              defaultPromptsJson: JSON.stringify(rc.defaultPrompts || []),
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }))
          : []

        dispatch({
          type: "SET_DATA",
          payload: {
            config: mockConfig,
            fields: mockFields,
            roleConfigs: mockRoleConfigs,
            customFields: [],
          },
        })
      } else {
        dispatch({ type: "SET_ERROR", payload: `No form configuration found for ${moduleId}:${formId}` })
      }
    }
  }, [moduleId, formId, organizationId, useDefaultIfMissing, refreshKey])

  // Memoize the merged configuration
  const mergedConfig = useMemo<MergedFormConfiguration | null>(() => {
    if (!state.config) return null

    const parsedFields = state.fields.map(parseFormField)
    const parsedRoleConfig = roleId
      ? state.roleConfigs.find(rc => rc.roleId === roleId)
      : undefined
    const parsedCustomFields = state.customFields.map(cf => {
      const data = JSON.parse(cf.fieldDataJson)
      return parseFormField({
        id: cf.id,
        configurationId: cf.configurationId,
        fieldId: data.fieldId,
        name: data.name,
        label: data.label,
        fieldType: data.type,
        description: data.description || "",
        placeholder: data.placeholder || "",
        defaultValue: data.defaultValue || "",
        optionsJson: JSON.stringify(data.options || []),
        validationJson: JSON.stringify(data.validation || { required: false }),
        aiSuggestionsJson: JSON.stringify(data.aiSuggestions || []),
        order: data.order,
        isSystem: false,
        isEnabled: true,
        category: "",
        showInList: false,
        width: data.width || "Full",
        sectionId: data.sectionId || "",
        createdAt: cf.createdAt,
        updatedAt: cf.updatedAt,
      } as FormConfigField)
    })

    // Get fields filtered by role
    const roleFields = getFieldsForRole(
      parsedFields,
      parsedRoleConfig ? parseRoleConfig(parsedRoleConfig) : undefined
    )

    // Merge with custom fields
    const allFields = mergeWithCustomFields(roleFields, parsedCustomFields)

    return {
      config: state.config,
      fields: parsedFields,
      roleConfig: parsedRoleConfig ? parseRoleConfig(parsedRoleConfig) : undefined,
      customFields: parsedCustomFields,
    }
  }, [state.config, state.fields, state.roleConfigs, state.customFields, roleId])

  const refetch = () => setRefreshKey(k => k + 1)

  return {
    config: mergedConfig,
    isLoading: state.isLoading,
    error: state.error,
    refetch,
  }
}

/**
 * Hook to get all form configurations for an organization.
 * Useful for the settings page.
 */
export function useOrganizationFormConfigs(organizationId: number): {
  configs: FormConfig[]
  isLoading: boolean
} {
  const [configs, setConfigs] = useReducer(listReducer<FormConfig>, [])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    setIsLoading(true)

    // TODO: Replace with generated bindings
    // import { FormConfig } from "@/stdb/generated";
    // setConfigs(FormConfig.filter({ organizationId }));
    // const unsub = FormConfig.onUpdate(() => {
    //   setConfigs(FormConfig.filter({ organizationId }));
    // });
    // return unsub;

    // For now, return empty
    setConfigs([])
    setIsLoading(false)
  }, [organizationId])

  return { configs, isLoading }
}

/**
 * Hook to get fields for a specific role from a configuration.
 */
export function useRoleFormFields(
  configurationId: number,
  roleId: string
): {
  fields: ParsedFormField[]
  isLoading: boolean
} {
  const [fields, setFields] = useReducer(listReducer<ParsedFormField>, [])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    setIsLoading(true)

    // TODO: Replace with generated bindings
    // Load fields and role config
    // Filter by enabled fields for role
    // Apply required field overrides

    setFields([])
    setIsLoading(false)
  }, [configurationId, roleId])

  return { fields, isLoading }
}

/**
 * Hook to manage user custom fields.
 */
export function useUserCustomFields(
  configurationId: number,
  userId?: string
): {
  customFields: ParsedFormField[]
  addCustomField: (field: CreateFormFieldParams) => Promise<void>
  removeCustomField: (fieldId: string) => Promise<void>
  isLoading: boolean
} {
  const [customFields, setCustomFields] = useReducer(listReducer<ParsedFormField>, [])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    setIsLoading(true)

    // TODO: Replace with generated bindings
    // Subscribe to UserCustomField table

    setCustomFields([])
    setIsLoading(false)
  }, [configurationId, userId])

  const addCustomField = async (field: CreateFormFieldParams) => {
    if (!isCustomField(field.fieldId)) {
      throw new Error("Custom field IDs must start with 'custom:'")
    }

    // TODO: Call reducer to add custom field
    console.log("Adding custom field:", field)
  }

  const removeCustomField = async (fieldId: string) => {
    // TODO: Call reducer to remove custom field
    console.log("Removing custom field:", fieldId)
  }

  return {
    customFields,
    addCustomField,
    removeCustomField,
    isLoading,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// UTILITY HOOKS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Hook to check if a form field is visible for the current role.
 */
export function useFieldVisibility(
  fieldId: string,
  roleConfig?: ParsedRoleConfig
): boolean {
  return useMemo(() => {
    if (!roleConfig) return true
    return roleConfig.enabledFields.includes(fieldId)
  }, [fieldId, roleConfig])
}

/**
 * Hook to check if a form field is required for the current role.
 */
export function useFieldRequired(
  fieldId: string,
  fieldValidation?: { required?: boolean },
  roleConfig?: ParsedRoleConfig
): boolean {
  return useMemo(() => {
    const baseRequired = fieldValidation?.required ?? false
    const roleRequired = roleConfig?.requiredFields.includes(fieldId) ?? false
    return baseRequired || roleRequired
  }, [fieldId, fieldValidation, roleConfig])
}
