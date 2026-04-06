import { stdbBrowserQuery } from "@lumiere/stdb/browser-http"
import {
  addFormField,
  createFormConfiguration,
  setFormRoleConfig,
  type CreateFormFieldParams as StdbCreateFormFieldParams,
} from "@lumiere/stdb/client-ui-bridge"
import type {
  FieldType as StdbFieldType,
  FieldWidth as StdbFieldWidth,
} from "@lumiere/stdb/generated/types"
import type {
  CreateFormFieldParams as RegistryFieldParams,
  FormRegistryEntry,
} from "../config/types"
import { formOptionsToStdb, formValidationToStdb } from "./stdb-field-params"

export function registryFieldToStdbParams(field: RegistryFieldParams): StdbCreateFormFieldParams {
  return {
    fieldId: field.fieldId,
    name: field.name,
    label: field.label,
    fieldType: { tag: field.fieldType } as StdbFieldType,
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
    width: { tag: field.width } as StdbFieldWidth,
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
      Number(c.organizationId) === organizationId &&
      c.moduleId === def.moduleId &&
      c.formId === def.formId,
  )
  if (!row?.id) throw new Error("Form configuration not found after create")

  const configurationId = BigInt(String(row.id))

  for (const field of def.fields) {
    await addFormField(BigInt(organizationId), configurationId, registryFieldToStdbParams(field))
  }

  if (def.roleConfigs) {
    for (const rc of Object.values(def.roleConfigs)) {
      await setFormRoleConfig(BigInt(organizationId), configurationId, {
        roleId: rc.roleId,
        enabledFields: rc.enabledFields,
        requiredFields: rc.requiredFields,
        defaultPrompts: rc.defaultPrompts,
      })
    }
  }
}
