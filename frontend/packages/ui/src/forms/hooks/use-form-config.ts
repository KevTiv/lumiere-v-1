//! Form Configuration Hooks
//!
//! React hooks for accessing and managing form configurations from SpacetimeDB.

import { useEffect, useMemo, useReducer, useState } from "react"
import { useErpSession } from "@lumiere/erp-session"
import { stdbBrowserQuery } from "@lumiere/stdb/browser-http"
import {
  addUserCustomField,
  deleteUserCustomField,
  getFormConfiguration,
  getOrganizationFormConfigs,
} from "@lumiere/stdb/client-ui-bridge"
import type {
  FieldType as StdbFieldType,
  FieldWidth as StdbFieldWidth,
} from "@lumiere/stdb/types"
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
import { formOptionsToStdb, formValidationToStdb } from "../utils/stdb-field-params"

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

function ts(t: unknown): string {
  if (typeof t === "string" && t.length > 0) return t
  if (t !== null && typeof t === "object" && "toDate" in t) {
    const td = (t as { toDate?: () => Date }).toDate
    if (typeof td === "function") {
      try {
        return td.call(t)?.toISOString() ?? ""
      } catch {
        return ""
      }
    }
  }
  return ""
}

function n64(v: unknown): bigint {
  if (typeof v === "bigint") return v
  if (typeof v === "number") return BigInt(Math.trunc(v))
  return BigInt(String(v ?? 0))
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
  createdAt: unknown
  updatedAt: unknown
  createdBy?: { toHexString?: () => string } | string
  updatedBy?: { toHexString?: () => string } | string
}): FormConfig {
  const hex = (v: { toHexString?: () => string } | string | undefined) =>
    typeof v === "string" ? v : v?.toHexString?.() ?? ""
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
    createdBy: hex(row.createdBy),
    updatedBy: hex(row.updatedBy),
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
  createdAt: unknown
  updatedAt: unknown
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
  createdAt: unknown
  updatedAt: unknown
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
  userId: { toHexString?: () => string } | string
  configurationId: bigint
  fieldId: string
  fieldDataJson: string
  createdAt: unknown
  updatedAt: unknown
}): UserCustomField {
  const uid = row.userId
  const userIdStr =
    typeof uid === "string" ? uid.toLowerCase() : uid?.toHexString?.().toLowerCase() ?? ""
  return {
    id: Number(row.id),
    organizationId: Number(row.organizationId),
    userId: userIdStr,
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
  const { identity } = useErpSession()
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

    let cancelled = false
    ;(async () => {
      try {
        const [configRows, fieldRows, roleRows, allCustomRows] = await Promise.all([
          stdbBrowserQuery("form-configs"),
          stdbBrowserQuery("form-config-fields"),
          stdbBrowserQuery("form-role-configs"),
          stdbBrowserQuery("user-custom-fields"),
        ])
        if (cancelled) return

        const configs = configRows.filter(
          c =>
            Number(c.organizationId) === organizationId &&
            c.moduleId === moduleId &&
            c.formId === formId &&
            (c.isActive === true || c.is_active === true || c.isActive === 1 || c.is_active === 1),
        )

        if (configs.length === 0) {
          if (useDefaultIfMissing) loadDefaultConfig()
          else dispatch({ type: "SET_ERROR", payload: `No form configuration found for ${moduleId}:${formId}` })
          return
        }

        const cfg = configs[0] as Record<string, unknown>
        const configurationId = Number(cfg.id)

        const fields = fieldRows
          .filter(f => Number(f.configurationId) === configurationId)
          .map(f =>
            mapStdbFormConfigFieldRow({
              id: n64(f.id),
              configurationId: n64(f.configurationId),
              fieldId: String(f.fieldId ?? ""),
              name: String(f.name ?? ""),
              label: String(f.label ?? ""),
              fieldType: f.fieldType,
              description: String(f.description ?? ""),
              placeholder: String(f.placeholder ?? ""),
              defaultValue: String(f.defaultValue ?? ""),
              optionsJson: String(f.optionsJson ?? ""),
              validationJson: String(f.validationJson ?? ""),
              aiSuggestionsJson: String(f.aiSuggestionsJson ?? ""),
              order: Number(f.order ?? 0),
              isSystem: Boolean(f.isSystem),
              isEnabled: Boolean(f.isEnabled),
              category: String(f.category ?? ""),
              showInList: Boolean(f.showInList),
              width: f.width,
              sectionId: String(f.sectionId ?? ""),
              createdAt: f.createdAt,
              updatedAt: f.updatedAt,
            }),
          )

        const roleConfigs = roleRows
          .filter(r => Number(r.configurationId) === configurationId)
          .map(r =>
            mapStdbFormRoleConfigRow({
              id: n64(r.id),
              configurationId: n64(r.configurationId),
              roleId: String(r.roleId ?? ""),
              enabledFieldsJson: String(r.enabledFieldsJson ?? ""),
              requiredFieldsJson: String(r.requiredFieldsJson ?? ""),
              defaultPromptsJson: String(r.defaultPromptsJson ?? ""),
              isActive: Boolean(r.isActive),
              createdAt: r.createdAt,
              updatedAt: r.updatedAt,
            }),
          )

        const effectiveUser = (userId ?? identity ?? "").toLowerCase()
        const customFields = allCustomRows
          .filter(
            cf =>
              Number(cf.organizationId) === organizationId &&
              Number(cf.configurationId) === configurationId &&
              (!effectiveUser ||
                String(cf.userId ?? "")
                  .toLowerCase()
                  .replace(/^0x/, "") === effectiveUser.replace(/^0x/, "")),
          )
          .map(cf =>
            mapStdbUserCustomFieldRow({
              id: n64(cf.id),
              organizationId: n64(cf.organizationId),
              userId: cf.userId as string,
              configurationId: n64(cf.configurationId),
              fieldId: String(cf.fieldId ?? ""),
              fieldDataJson: String(cf.fieldDataJson ?? ""),
              createdAt: cf.createdAt,
              updatedAt: cf.updatedAt,
            }),
          )

        dispatch({
          type: "SET_DATA",
          payload: {
            config: mapStdbFormConfigRow({
              id: n64(cfg.id),
              organizationId: n64(cfg.organizationId),
              moduleId: String(cfg.moduleId ?? ""),
              formId: String(cfg.formId ?? ""),
              name: String(cfg.name ?? ""),
              description: String(cfg.description ?? ""),
              isActive: Boolean(cfg.isActive),
              isSystemDefault: Boolean(cfg.isSystemDefault),
              createdAt: cfg.createdAt,
              updatedAt: cfg.updatedAt,
              createdBy: cfg.createdBy as string | { toHexString?: () => string } | undefined,
              updatedBy: cfg.updatedBy as string | { toHexString?: () => string } | undefined,
            }),
            fields,
            roleConfigs,
            customFields,
          },
        })

        void getFormConfiguration(BigInt(organizationId), moduleId, formId).catch(() => {
          /* no-op: legacy reducer; HTTP load is source of truth */
        })
      } catch {
        if (cancelled) return
        if (useDefaultIfMissing) loadDefaultConfig()
        else dispatch({ type: "SET_ERROR", payload: "Failed to load form configuration" })
      }
    })()

    return () => {
      cancelled = true
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

  useEffect(() => {
    if (!organizationId) {
      setConfigs([])
      setIsLoading(false)
      return
    }

    let cancelled = false
    ;(async () => {
      setIsLoading(true)
      try {
        const rows = await stdbBrowserQuery("form-configs")
        if (cancelled) return
        const filtered = rows.filter(c => Number(c.organizationId) === organizationId)
        setConfigs(
          filtered.map(c =>
            mapStdbFormConfigRow({
              id: n64(c.id),
              organizationId: n64(c.organizationId),
              moduleId: String(c.moduleId ?? ""),
              formId: String(c.formId ?? ""),
              name: String(c.name ?? ""),
              description: String(c.description ?? ""),
              isActive: Boolean(c.isActive),
              isSystemDefault: Boolean(c.isSystemDefault),
              createdAt: c.createdAt,
              updatedAt: c.updatedAt,
              createdBy: c.createdBy as string | { toHexString?: () => string } | undefined,
              updatedBy: c.updatedBy as string | { toHexString?: () => string } | undefined,
            }),
          ),
        )
        void getOrganizationFormConfigs(BigInt(organizationId)).catch(() => {})
      } catch {
        if (!cancelled) setConfigs([])
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [organizationId])

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
  const [reloadNonce, setReloadNonce] = useState(0)
  const { organizationId: sessionOrgId, identity } = useErpSession()

  useEffect(() => {
    if (!sessionOrgId || !configurationId) {
      setCustomFields([])
      setIsLoading(false)
      return
    }

    let cancelled = false
    const effectiveUser = (userId ?? identity ?? "").toLowerCase()

    ;(async () => {
      setIsLoading(true)
      try {
        const allRows = await stdbBrowserQuery("user-custom-fields")
        if (cancelled) return
        const rows = allRows.filter(
          cf =>
            Number(cf.organizationId) === sessionOrgId &&
            Number(cf.configurationId) === configurationId &&
            (!effectiveUser ||
              String(cf.userId ?? "")
                .toLowerCase()
                .replace(/^0x/, "") === effectiveUser.replace(/^0x/, "")),
        )
        const parsed = rows
          .map(cf =>
            mapStdbUserCustomFieldRow({
              id: n64(cf.id),
              organizationId: n64(cf.organizationId),
              userId: cf.userId as string,
              configurationId: n64(cf.configurationId),
              fieldId: String(cf.fieldId ?? ""),
              fieldDataJson: String(cf.fieldDataJson ?? ""),
              createdAt: cf.createdAt,
              updatedAt: cf.updatedAt,
            }),
          )
          .map(cf => {
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
              defaultValue:
                typeof data.defaultValue === "string" ? data.defaultValue : JSON.stringify(data.defaultValue ?? ""),
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
        setCustomFields(parsed)
      } catch {
        if (!cancelled) setCustomFields([])
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [configurationId, userId, identity, sessionOrgId, reloadNonce])

  const addCustomField = async (field: CreateFormFieldParams) => {
    if (!isCustomField(field.fieldId)) {
      throw new Error("Custom field IDs must start with 'custom:'")
    }
    if (!sessionOrgId) throw new Error("No organization")
    await addUserCustomField(BigInt(sessionOrgId), {
      configurationId: BigInt(configurationId),
      fieldId: field.fieldId,
      name: field.name,
      label: field.label,
      fieldType: { tag: field.fieldType } as StdbFieldType,
      description: field.description,
      placeholder: field.placeholder,
      defaultValue: field.defaultValue,
      options: formOptionsToStdb(field.options),
      validation: formValidationToStdb(field.validation ?? { required: false }),
      order: field.order,
      width: { tag: field.width } as StdbFieldWidth,
    })
    setReloadNonce(n => n + 1)
  }

  const removeCustomField = async (fieldId: string) => {
    if (!sessionOrgId) throw new Error("No organization")
    const rowId = customFields.find(f => f.fieldId === fieldId)?.id
    if (!rowId) throw new Error("Custom field not found")
    await deleteUserCustomField(BigInt(sessionOrgId), BigInt(rowId))
    setReloadNonce(n => n + 1)
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
