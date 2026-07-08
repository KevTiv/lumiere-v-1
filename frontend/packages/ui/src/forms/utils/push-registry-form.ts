import { stdbBrowserQuery } from "@lumiere/stdb/browser-http"
import { toCreateRoleConfigParams } from "@lumiere/erp-shared/forms-create-params"
import {
  addFormField,
  createFormConfiguration,
  setFormRoleConfig,
  type CreateFormFieldParams as StdbCreateFormFieldParams,
} from "@lumiere/stdb/client-ui-bridge"
import type {
  FieldType as StdbFieldType,
  FieldWidth as StdbFieldWidth,
} from "@lumiere/stdb/types"
import type {
  CreateFormFieldParams as RegistryFieldParams,
  FormRegistryEntry,
} from "../config/types"
import { formOptionsToStdb, formValidationToStdb } from "./stdb-field-params"

function rowNum(row: Record<string, unknown>, camel: string, snake: string): number {
  return Number(row[camel] ?? row[snake] ?? 0)
}

function rowStr(row: Record<string, unknown>, camel: string, snake: string): string {
  return String(row[camel] ?? row[snake] ?? "")
}

function satsUnitVariant(tag: string): Record<string, unknown> {
  const key = tag.charAt(0).toLowerCase() + tag.slice(1)
  return { [key]: [] }
}

export function registryFieldToStdbParams(field: RegistryFieldParams): StdbCreateFormFieldParams {
  return {
    fieldId: field.fieldId,
    name: field.name,
    label: field.label,
    fieldType: satsUnitVariant(field.fieldType) as StdbFieldType,
    description: field.description,
    placeholder: field.placeholder,
    defaultValue: field.defaultValue,
    options: formOptionsToStdb(field.options),
    validation: formValidationToStdb(field.validation),
    aiSuggestions: field.aiSuggestions ?? [],
    order: field.order,
    isSystem: field.isSystem,
    isEnabled: field.isEnabled,
    category: field.category,
    showInList: field.showInList,
    width: satsUnitVariant(field.width) as StdbFieldWidth,
    sectionId: field.sectionId,
  }
}

/**
 * Creates the form_config row and all fields + role configs from the in-app registry default.
 * Use when the org has no DB row yet (registry-only fallback).
 */
export async function pushRegistryFormToDatabase(
  organizationId: number,
  formEntry: FormRegistryEntry,
): Promise<void> {
  const def = formEntry.defaultConfig()
  await createFormConfiguration(BigInt(organizationId), {
    moduleId: def.moduleId,
    formId: def.formId,
    name: def.name,
    description: def.description,
    isSystemDefault: def.isSystemDefault,
  })

  const rows = await stdbBrowserQuery("form-configs")
  const row = rows.find(
    c =>
      rowNum(c, "organizationId", "organization_id") === organizationId &&
      rowStr(c, "moduleId", "module_id") === def.moduleId &&
      rowStr(c, "formId", "form_id") === def.formId,
  )
  if (!row?.id) throw new Error("Form configuration not found after create")

  const configurationId = BigInt(String(row.id))

  for (const field of def.fields) {
    await addFormField(BigInt(organizationId), configurationId, registryFieldToStdbParams(field))
  }

  if (def.roleConfigs) {
    for (const rc of Object.values(def.roleConfigs)) {
      const params = toCreateRoleConfigParams({
        roleId: rc.roleId,
        enabledFields: rc.enabledFields,
        requiredFields: rc.requiredFields,
        defaultPrompts: rc.defaultPrompts,
      })
      if (!params) continue
      await setFormRoleConfig(BigInt(organizationId), configurationId, params)
    }
  }
}
