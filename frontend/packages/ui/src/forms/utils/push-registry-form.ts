import { toCreateRoleConfigParams } from "@lumiere/erp-shared/forms-create-params"
import {
  formConfigUpdatedAtMicros,
  formConfigVersion,
  nextFormConfigVersion,
  resolvePublishedFormConfig,
  type FormConfigKey,
} from "@lumiere/query-hooks/hooks/form-config-publish"
import type { CanonicalRecordRef } from "@lumiere/query-hooks/hooks/operation-effect"
import { stdbBrowserQuery } from "@lumiere/stdb/browser-http"
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
 *
 * COV-22: a publish over an existing configuration sends the `updated_at` it read as
 * `expectedUpdatedAtMicros`, so a stale or replayed publish is rejected by the server.
 * The publish is read back from `form-configs` for the exact (organization, module,
 * form): the version must be the one read before plus one (1 for a first publish).
 * Any other version means the publish did not apply once or raced another publish,
 * and is reported instead of assumed.
 */
export async function pushRegistryFormToDatabase(
  organizationId: number,
  formEntry: FormRegistryEntry,
): Promise<CanonicalRecordRef> {
  const def = formEntry.defaultConfig()
  const key: FormConfigKey = {
    organizationId: BigInt(organizationId),
    moduleId: def.moduleId,
    formId: def.formId,
  }
  const existingRows = await stdbBrowserQuery("form-configs")
  const previousVersion = formConfigVersion(existingRows, key)
  const expectedVersion = nextFormConfigVersion(previousVersion)
  const expectedUpdatedAtMicros = previousVersion == null ? undefined : formConfigUpdatedAtMicros(existingRows, key)
  if (previousVersion != null && expectedUpdatedAtMicros == null) {
    throw new Error(`Form ${def.moduleId}:${def.formId} is published but its updated_at could not be read`)
  }

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
    expectedUpdatedAtMicros,
    replaceMissingFields: false,
  }

  await publishFormConfiguration(BigInt(organizationId), params)

  const published = resolvePublishedFormConfig(await stdbBrowserQuery("form-configs"), key, expectedVersion)
  if (!published) {
    throw new Error(
      `Form ${def.moduleId}:${def.formId} did not read back at version ${expectedVersion}; it may have been published concurrently`,
    )
  }
  return published
}
