import { toCreateRoleConfigParams } from "@lumiere/erp-shared/forms-create-params"
import {
  publishFormConfiguration,
  type CreateFormFieldParams as StdbCreateFormFieldParams,
  type PublishFormConfigurationParams,
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

/** SpacetimeDB unit enum encoding: `{ text: [] }` for tag `Text`. */
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
    visibilityJson: field.visibilityJson ?? undefined,
  }
}

/**
 * Publishes the in-app registry default as form_config + fields + roles in one
 * SpacetimeDB transaction (avoids partial client-side create/field loops).
 */
export async function pushRegistryFormToDatabase(
  organizationId: number,
  formEntry: FormRegistryEntry,
): Promise<void> {
  const def = formEntry.defaultConfig()

  const roleConfigs = Object.values(def.roleConfigs ?? {})
    .map((rc) =>
      toCreateRoleConfigParams({
        roleId: rc.roleId,
        enabledFields: rc.enabledFields,
        requiredFields: rc.requiredFields,
        defaultPrompts: rc.defaultPrompts,
      }),
    )
    .filter((p): p is NonNullable<typeof p> => p != null)

  const params: PublishFormConfigurationParams = {
    moduleId: def.moduleId,
    formId: def.formId,
    name: def.name,
    description: def.description,
    isSystemDefault: def.isSystemDefault,
    fields: def.fields.map(registryFieldToStdbParams),
    roleConfigs,
    expectedUpdatedAtMicros: undefined,
    replaceMissingFields: false,
  }

  await publishFormConfiguration(BigInt(organizationId), params)
}
