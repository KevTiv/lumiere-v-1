import { stdbBrowserCommand } from "../browser-http"
import type {
  CreateFormFieldParams,
  CreateRoleConfigParams,
  CreateUserCustomFieldParams,
  PublishFormConfigurationParams,
  SetRecordCustomFieldValuesParams,
  UpdateFormFieldParams,
} from "../generated/types"
import { stdbParamsToJson } from "../stdb-params-json"

export type {
  CreateFormFieldParams,
  CreateRoleConfigParams,
  CreateUserCustomFieldParams,
  PublishFormConfigurationParams,
  SetRecordCustomFieldValuesParams,
  UpdateFormFieldParams,
}

export function publishFormConfiguration(
  _organizationId: bigint,
  params: PublishFormConfigurationParams,
) {
  return stdbBrowserCommand("publish_form_configuration", {
    params: stdbParamsToJson(params as object, "PublishFormConfigurationParams"),
  })
}

export function initializeDefaultFormConfigs(_organizationId: bigint) {
  return stdbBrowserCommand("initialize_default_form_configs", {})
}

export function addFormField(
  _organizationId: bigint,
  configurationId: bigint,
  params: CreateFormFieldParams,
) {
  return stdbBrowserCommand("add_form_field", {
    configurationId,
    params: stdbParamsToJson(params as object, "CreateFormFieldParams"),
  })
}

export function updateFormField(
  _organizationId: bigint,
  configurationId: bigint,
  fieldId: string,
  params: UpdateFormFieldParams,
) {
  return stdbBrowserCommand("update_form_field", {
    configurationId,
    fieldId,
    params: stdbParamsToJson(params as object, "UpdateFormFieldParams"),
  })
}

export function deleteFormField(
  _organizationId: bigint,
  configurationId: bigint,
  fieldId: string,
) {
  return stdbBrowserCommand("delete_form_field", { configurationId, fieldId })
}

export function setFormRoleConfig(
  _organizationId: bigint,
  configurationId: bigint,
  params: CreateRoleConfigParams,
) {
  return stdbBrowserCommand("set_form_role_config", {
    configurationId,
    params: stdbParamsToJson(params as object, "CreateRoleConfigParams"),
  })
}

export function addUserCustomField(
  _organizationId: bigint,
  params: CreateUserCustomFieldParams,
) {
  return stdbBrowserCommand("add_user_custom_field", {
    params: stdbParamsToJson(params as object, "CreateUserCustomFieldParams"),
  })
}

export function deleteUserCustomField(
  _organizationId: bigint,
  customFieldId: bigint,
) {
  return stdbBrowserCommand("delete_user_custom_field", { customFieldId })
}

export function setRecordCustomFieldValues(
  _organizationId: bigint,
  companyId: bigint,
  params: SetRecordCustomFieldValuesParams,
) {
  return stdbBrowserCommand("set_record_custom_field_values", {
    companyId,
    params: stdbParamsToJson(params as object, "SetRecordCustomFieldValuesParams"),
  })
}

export function deleteRecordCustomFieldValues(
  _organizationId: bigint,
  companyId: bigint,
  model: string,
  recordId: bigint,
) {
  return stdbBrowserCommand("delete_record_custom_field_values", {
    companyId,
    model,
    recordId,
  })
}
