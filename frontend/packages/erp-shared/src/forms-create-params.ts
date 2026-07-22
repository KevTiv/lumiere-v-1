/**
 * Maps form-builder payloads to SpacetimeDB Create*Params types.
 */

import type {
  CreateFormConfigParams,
  CreateFormFieldParams,
  CreateRoleConfigParams,
  CreateUserCustomFieldParams,
  FieldType,
  FieldValidation,
  FieldWidth,
} from "@lumiere/stdb/types"

import { formValue, optionalBigIntU64 } from "./form-coercion"

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === "" ? undefined : s
}

export function toCreateFormConfigParams(
  formData: Record<string, unknown>,
): CreateFormConfigParams | null {
  const moduleId = String(formValue(formData, "moduleId", "module_id") ?? "").trim()
  const formId = String(formValue(formData, "formId", "form_id") ?? "").trim()
  const name = String(formData.name ?? "").trim()
  if (!moduleId || !formId || !name) return null
  return {
    moduleId,
    formId,
    name,
    description: optionalTrimmedString(formData.description),
    isSystemDefault: formData.isSystemDefault === true || formData.is_system_default === true,
  }
}

function unitVariant<T extends string>(tag: T): { tag: T } {
  return { tag }
}

function fieldValidationFromForm(raw: unknown): FieldValidation {
  if (!raw || typeof raw !== "object") {
    return { required: false, minLength: undefined, maxLength: undefined, min: undefined, max: undefined, pattern: undefined, message: undefined }
  }
  const v = raw as Record<string, unknown>
  return {
    required: v.required === true,
    minLength: v.minLength != null ? Math.trunc(Number(v.minLength)) : undefined,
    maxLength: v.maxLength != null ? Math.trunc(Number(v.maxLength)) : undefined,
    min: v.min != null && v.min !== "" ? Number(v.min) : undefined,
    max: v.max != null && v.max !== "" ? Number(v.max) : undefined,
    pattern: optionalTrimmedString(v.pattern),
    message: optionalTrimmedString(v.message),
  }
}

export function toCreateFormFieldParams(
  formData: Record<string, unknown>,
): CreateFormFieldParams | null {
  const fieldId = String(formValue(formData, "fieldId", "field_id") ?? "").trim()
  const name = String(formData.name ?? "").trim()
  const label = String(formData.label ?? name).trim()
  if (!fieldId || !name || !label) return null
  const fieldTypeRaw = String(formValue(formData, "fieldType", "field_type") ?? "Text")
  const widthRaw = String(formData.width ?? "Full")
  return {
    fieldId,
    name,
    label,
    fieldType: unitVariant(fieldTypeRaw) as FieldType,
    description: optionalTrimmedString(formData.description),
    placeholder: optionalTrimmedString(formData.placeholder),
    defaultValue: optionalTrimmedString(formValue(formData, "defaultValue", "default_value")),
    options: Array.isArray(formData.options)
      ? (formData.options as Array<Record<string, unknown>>).map((o) => ({
          value: String(o.value ?? ""),
          label: String(o.label ?? o.value ?? ""),
          color: optionalTrimmedString(o.color),
          icon: optionalTrimmedString(o.icon),
        }))
      : [],
    validation: fieldValidationFromForm(formData.validation),
    aiSuggestions: Array.isArray(formData.aiSuggestions)
      ? (formData.aiSuggestions as unknown[]).map((s) => String(s))
      : Array.isArray(formData.ai_suggestions)
        ? (formData.ai_suggestions as unknown[]).map((s) => String(s))
        : [],
    order: Math.trunc(Number(formData.order ?? 0)),
    isSystem: formData.isSystem === true || formData.is_system === true,
    isEnabled: formData.isEnabled !== false && formData.is_enabled !== false,
    category: optionalTrimmedString(formData.category),
    showInList: formData.showInList === true || formData.show_in_list === true,
    width: unitVariant(widthRaw) as FieldWidth,
    sectionId: optionalTrimmedString(formValue(formData, "sectionId", "section_id")),
    visibilityJson: optionalTrimmedString(formValue(formData, "visibilityJson", "visibility_json")),
  }
}

function stringArrayFromForm(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean)
  return []
}

export function toCreateRoleConfigParams(
  formData: Record<string, unknown>,
): CreateRoleConfigParams | null {
  const roleId = String(formValue(formData, "roleId", "role_id") ?? "").trim()
  if (!roleId) return null
  return {
    roleId,
    enabledFields: stringArrayFromForm(formValue(formData, "enabledFields", "enabled_fields")),
    requiredFields: stringArrayFromForm(formValue(formData, "requiredFields", "required_fields")),
    defaultPrompts: stringArrayFromForm(formValue(formData, "defaultPrompts", "default_prompts")),
  }
}

export type UserCustomFieldMapperContext = {
  configurationId: bigint
}

export function toCreateUserCustomFieldParams(
  formData: Record<string, unknown>,
  context?: UserCustomFieldMapperContext,
): CreateUserCustomFieldParams | null {
  const base = toCreateFormFieldParams(formData)
  if (!base) return null
  const configurationId =
    optionalBigIntU64(formValue(formData, "configurationId", "configuration_id")) ??
    context?.configurationId
  if (configurationId === undefined) return null
  return {
    configurationId,
    fieldId: base.fieldId,
    name: base.name,
    label: base.label,
    fieldType: base.fieldType,
    description: base.description,
    placeholder: base.placeholder,
    defaultValue: base.defaultValue,
    options: base.options,
    validation: base.validation,
    order: base.order,
    width: base.width,
  }
}
