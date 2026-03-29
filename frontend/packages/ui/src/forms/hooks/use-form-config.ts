//! Form Configuration Hooks
//!
//! React hooks for accessing and managing form configurations from SpacetimeDB.

import { useEffect, useMemo, useReducer, useState } from "react"
import { getStdbConnection, useStdbConnection } from "@lumiere/stdb"
import type {
  FormConfig,
  FormConfigField,
  FormRoleConfig,
  UserCustomField,
  ParsedFormField,
  ParsedRoleConfig,
  MergedFormConfiguration,
  CreateFormFieldParams,
  FieldType,
  FieldWidth,
} from "../config/types"
import {
  parseFormField,
  parseRoleConfig,
  getFieldsForRole,
  mergeWithCustomFields,
  isCustomField,
} from "../config/types"
import { getDefaultFormConfig } from "../config/registry"

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
        fields: state.fields.map(f => (f.id === action.payload.id ? action.payload : f)),
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
// STDB ↔ UI MAPPING
// ═════════════════════════════════════════════════════════════════════════════

function enumTag(v: unknown): string {
  if (v !== null && typeof v === "object" && "tag" in v) {
    return String((v as { tag: string }).tag)
  }
  return String(v)
}

function ts(t: { toDate?: () => Date } | undefined): string {
  try {
    return t?.toDate?.()?.toISOString() ?? ""
  } catch {
    return ""
  }
}

function mapStdbFormConfigRow(row: {
  id: bigint
  organizationId: bigint
  moduleId: string
  formId: string
  name: string
  description: string
  isActive: boolean
  isSystemDefault: boolean
  createdAt: { toDate?: () => Date }
  updatedAt: { toDate?: () => Date }
  createdBy: { toHexString?: () => string }
  updatedBy: { toHexString?: () => string }
}): FormConfig {
  return {
    id: Number(row.id),
    organizationId: Number(row.organizationId),
    moduleId: row.moduleId,
    formId: row.formId,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    isSystemDefault: row.isSystemDefault,
    createdAt: ts(row.createdAt),
    updatedAt: ts(row.updatedAt),
    createdBy: row.createdBy?.toHexString?.() ?? "",
    updatedBy: row.updatedBy?.toHexString?.() ?? "",
  }
}

function mapStdbFormConfigFieldRow(row: {
  id: bigint
  configurationId: bigint
  fieldId: string
  name: string
  label: string
  fieldType: unknown
  description: string
  placeholder: string
  defaultValue: string
  optionsJson: string
  validationJson: string
  aiSuggestionsJson: string
  order: number
  isSystem: boolean
  isEnabled: boolean
  category: string
  showInList: boolean
  width: unknown
  sectionId: string
  createdAt: { toDate?: () => Date }
  updatedAt: { toDate?: () => Date }
}): FormConfigField {
  return {
    id: Number(row.id),
    configurationId: Number(row.configurationId),
    fieldId: row.fieldId,
    name: row.name,
    label: row.label,
    fieldType: enumTag(row.fieldType) as FieldType,
    description: row.description,
    placeholder: row.placeholder,
    defaultValue: row.defaultValue,
    optionsJson: row.optionsJson,
    validationJson: row.validationJson,
    aiSuggestionsJson: row.aiSuggestionsJson,
    order: row.order,
    isSystem: row.isSystem,
    isEnabled: row.isEnabled,
    category: row.category,
    showInList: row.showInList,
    width: enumTag(row.width) as FieldWidth,
    sectionId: row.sectionId,
    createdAt: ts(row.createdAt),
    updatedAt: ts(row.updatedAt),
  }
}

function mapStdbFormRoleConfigRow(row: {
  id: bigint
  configurationId: bigint
  roleId: string
  enabledFieldsJson: string
  requiredFieldsJson: string
  defaultPromptsJson: string
  isActive: boolean
  createdAt: { toDate?: () => Date }
  updatedAt: { toDate?: () => Date }
}): FormRoleConfig {
  return {
    id: Number(row.id),
    configurationId: Number(row.configurationId),
    roleId: row.roleId,
    enabledFieldsJson: row.enabledFieldsJson,
    requiredFieldsJson: row.requiredFieldsJson,
    defaultPromptsJson: row.defaultPromptsJson,
    isActive: row.isActive,
    createdAt: ts(row.createdAt),
    updatedAt: ts(row.updatedAt),
  }
}

function mapStdbUserCustomFieldRow(row: {
  id: bigint
  organizationId: bigint
  userId: { toHexString?: () => string }
  configurationId: bigint
  fieldId: string
  fieldDataJson: string
  createdAt: { toDate?: () => Date }
  updatedAt: { toDate?: () => Date }
}): UserCustomField {
  return {
    id: Number(row.id),
    organizationId: Number(row.organizationId),
    userId: row.userId?.toHexString?.() ?? "",
    configurationId: Number(row.configurationId),
    fieldId: row.fieldId,
    fieldDataJson: row.fieldDataJson,
    createdAt: ts(row.createdAt),
    updatedAt: ts(row.updatedAt),
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
  /** Skip role filtering; include all enabled fields (for org admin form settings). */
  forAdminSettings?: boolean
}

/**
 * Hook to access a form configuration with all its fields, role configs, and custom fields.
 */
export function useFormConfiguration(options: UseFormConfigurationOptions): {
  config: MergedFormConfiguration | null
  isLoading: boolean
  error: string | null
  refetch: () => void
  /** Raw DB role rows for admin tools (e.g. append fields to enabled lists). */
  sourceRoleConfigs: FormRoleConfig[]
  /** 0 when using registry fallback only (no SpacetimeDB row yet). */
  dbConfigurationId: number
} {
  const {
    moduleId,
    formId,
    organizationId,
    roleId,
    userId,
    useDefaultIfMissing = true,
    forAdminSettings = false,
  } = options
  const { identity } = useStdbConnection()
  const [state, dispatch] = useReducer(formConfigReducer, initialState)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    dispatch({ type: "SET_LOADING", payload: true })

    function loadDefaultConfig() {
      const defaultConfig = getDefaultFormConfig(moduleId, formId)
      if (defaultConfig) {
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

        const mockFields: FormConfigField[] = defaultConfig.fields.map((field, index) => ({
          id: index + 1,
          configurationId: 0,
          fieldId: field.fieldId,
          name: field.name,
          label: field.label,
          fieldType: field.fieldType,
          description: field.description || "",
          placeholder: field.placeholder || "",
          defaultValue:
            field.defaultValue !== undefined && field.defaultValue !== null
              ? typeof field.defaultValue === "string"
                ? field.defaultValue
                : JSON.stringify(field.defaultValue)
              : "",
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

    if (!organizationId) {
      if (useDefaultIfMissing) loadDefaultConfig()
      else dispatch({ type: "SET_ERROR", payload: "Missing organization" })
      return
    }

    const conn = getStdbConnection()
    if (!conn) {
      if (useDefaultIfMissing) loadDefaultConfig()
      else dispatch({ type: "SET_ERROR", payload: "Not connected to SpacetimeDB" })
      return
    }

    const db = conn

    function syncFromDb() {
      const configs = [...db.db.form_config.iter()].filter(
        c =>
          Number(c.organizationId) === organizationId &&
          c.moduleId === moduleId &&
          c.formId === formId &&
          c.isActive,
      )

      if (configs.length === 0) {
        if (useDefaultIfMissing) loadDefaultConfig()
        else dispatch({ type: "SET_ERROR", payload: `No form configuration found for ${moduleId}:${formId}` })
        return
      }

      const cfg = configs[0]
      const configurationId = Number(cfg.id)

      const fields = [...db.db.form_config_field.iter()]
        .filter(f => Number(f.configurationId) === configurationId)
        .map(mapStdbFormConfigFieldRow)

      const roleConfigs = [...db.db.form_role_config.iter()]
        .filter(r => Number(r.configurationId) === configurationId)
        .map(mapStdbFormRoleConfigRow)

      const effectiveUser = userId ?? identity ?? ""
      const customRows = [...db.db.user_custom_field.iter()].filter(
        cf =>
          Number(cf.organizationId) === organizationId &&
          Number(cf.configurationId) === configurationId &&
          (!effectiveUser || cf.userId?.toHexString?.() === effectiveUser),
      )
      const customFields = customRows.map(mapStdbUserCustomFieldRow)

      dispatch({
        type: "SET_DATA",
        payload: {
          config: mapStdbFormConfigRow(cfg),
          fields,
          roleConfigs,
          customFields,
        },
      })
    }

    syncFromDb()

    const tables = [
      db.db.form_config,
      db.db.form_config_field,
      db.db.form_role_config,
      db.db.user_custom_field,
    ] as const
    for (const t of tables) {
      t.onInsert(() => syncFromDb())
      t.onUpdate(() => syncFromDb())
      t.onDelete(() => syncFromDb())
    }
  }, [
    moduleId,
    formId,
    organizationId,
    useDefaultIfMissing,
    refreshKey,
    userId,
    identity,
  ])

  const mergedConfig = useMemo<MergedFormConfiguration | null>(() => {
    if (!state.config) return null

    const parsedFields = state.fields.map(parseFormField)
    const parsedRoleConfig = roleId ? state.roleConfigs.find(rc => rc.roleId === roleId) : undefined

    const parsedCustomFields = state.customFields.map(cf => {
      const data = JSON.parse(cf.fieldDataJson) as Record<string, unknown>
      return parseFormField({
        id: cf.id,
        configurationId: cf.configurationId,
        fieldId: String(data.fieldId ?? ""),
        name: String(data.name ?? ""),
        label: String(data.label ?? ""),
        fieldType: (data.type as FieldType) ?? "Text",
        description: String(data.description ?? ""),
        placeholder: String(data.placeholder ?? ""),
        defaultValue: typeof data.defaultValue === "string" ? data.defaultValue : JSON.stringify(data.defaultValue ?? ""),
        optionsJson: JSON.stringify(data.options || []),
        validationJson: JSON.stringify(data.validation || { required: false }),
        aiSuggestionsJson: JSON.stringify(data.aiSuggestions || []),
        order: Number(data.order ?? 0),
        isSystem: false,
        isEnabled: true,
        category: "",
        showInList: false,
        width: (data.width as FieldWidth) || "Full",
        sectionId: String(data.sectionId ?? ""),
        createdAt: cf.createdAt,
        updatedAt: cf.updatedAt,
      } as FormConfigField)
    })

    let roleFields: ParsedFormField[]
    if (forAdminSettings) {
      roleFields = parsedFields.filter(f => f.isEnabled).sort((a, b) => a.order - b.order)
    } else {
      roleFields = getFieldsForRole(
        parsedFields,
        parsedRoleConfig ? parseRoleConfig(parsedRoleConfig) : undefined,
      )
    }

    const allFields = mergeWithCustomFields(roleFields, parsedCustomFields).sort((a, b) => a.order - b.order)

    return {
      config: state.config,
      fields: allFields,
      roleConfig: parsedRoleConfig ? parseRoleConfig(parsedRoleConfig) : undefined,
      customFields: parsedCustomFields,
    }
  }, [state.config, state.fields, state.roleConfigs, state.customFields, roleId, forAdminSettings])

  const refetch = () => setRefreshKey(k => k + 1)

  return {
    config: mergedConfig,
    isLoading: state.isLoading,
    error: state.error,
    refetch,
    sourceRoleConfigs: state.roleConfigs,
    dbConfigurationId: state.config?.id ?? 0,
  }
}

/**
 * Hook to get all form configurations for an organization.
 */
export function useOrganizationFormConfigs(organizationId: number): {
  configs: FormConfig[]
  isLoading: boolean
} {
  const [configs, setConfigs] = useReducer(listReducer<FormConfig>, [])
  const [isLoading, setIsLoading] = useState(true)
  const { connected } = useStdbConnection()

  useEffect(() => {
    if (!organizationId) {
      setConfigs([])
      setIsLoading(false)
      return
    }

    const conn = getStdbConnection()
    if (!conn) {
      setConfigs([])
      setIsLoading(false)
      return
    }

    const db = conn

    function load() {
      const rows = [...db.db.form_config.iter()].filter(c => Number(c.organizationId) === organizationId)
      setConfigs(rows.map(mapStdbFormConfigRow))
      setIsLoading(false)
    }

    load()
    db.db.form_config.onInsert(() => load())
    db.db.form_config.onUpdate(() => load())
    db.db.form_config.onDelete(() => load())
  }, [organizationId, connected])

  return { configs, isLoading }
}

/**
 * Hook to get fields for a specific role from a configuration.
 */
export function useRoleFormFields(
  configurationId: number,
  roleId: string,
): {
  fields: ParsedFormField[]
  isLoading: boolean
} {
  const [fields, setFields] = useReducer(listReducer<ParsedFormField>, [])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    setIsLoading(true)
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
  userId?: string,
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
    setCustomFields([])
    setIsLoading(false)
  }, [configurationId, userId])

  const addCustomField = async (field: CreateFormFieldParams) => {
    if (!isCustomField(field.fieldId)) {
      throw new Error("Custom field IDs must start with 'custom:'")
    }
    console.warn("addCustomField: wire add_user_custom_field reducer when needed", field)
  }

  const removeCustomField = async (fieldId: string) => {
    console.warn("removeCustomField: wire delete_user_custom_field reducer when needed", fieldId)
  }

  return {
    customFields,
    addCustomField,
    removeCustomField,
    isLoading,
  }
}

/**
 * Hook to check if a form field is visible for the current role.
 */
export function useFieldVisibility(fieldId: string, roleConfig?: ParsedRoleConfig): boolean {
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
  roleConfig?: ParsedRoleConfig,
): boolean {
  return useMemo(() => {
    const baseRequired = fieldValidation?.required ?? false
    const roleRequired = roleConfig?.requiredFields.includes(fieldId) ?? false
    return baseRequired || roleRequired
  }, [fieldId, fieldValidation, roleConfig])
}
