import { stdbBrowserCommand, stdbBrowserCompatCall } from "../browser-http"
import type {
  CreateFormConfigParams,
  CreateFormFieldParams,
  CreateRoleConfigParams,
  CreateUserCustomFieldParams,
  PublishFormConfigurationParams,
  SetRecordCustomFieldValuesParams,
  UpdateFormFieldParams,
} from "../generated/types"
import { stdbParamsToJson } from "../stdb-params-json"

export type {
  CreateFormConfigParams,
  CreateFormFieldParams,
  CreateRoleConfigParams,
  CreateUserCustomFieldParams,
  PublishFormConfigurationParams,
  SetRecordCustomFieldValuesParams,
  UpdateFormFieldParams,
}

export function createFormConfiguration(
  organizationId: bigint,
  params: CreateFormConfigParams,
) {
  return stdbBrowserCompatCall("create_form_configuration", [organizationId.toString(), params])
}

export function publishFormConfiguration(
  _organizationId: bigint,
  params: PublishFormConfigurationParams,
) {
  return stdbBrowserCommand("publish_form_configuration", {
    params: stdbParamsToJson(params as object, "PublishFormConfigurationParams"),
  })
}

export function getFormConfiguration(
  organizationId: bigint,
  moduleId: string,
  formId: string,
) {
  return stdbBrowserCompatCall("get_form_configuration", [organizationId.toString(), moduleId, formId])
}

export function getOrganizationFormConfigs(organizationId: bigint) {
  return stdbBrowserCompatCall("get_organization_form_configs", [organizationId.toString()])
}

export function initializeDefaultFormConfigs(_organizationId: bigint) {
  return stdbBrowserCommand("initialize_default_form_configs", {})
}

export function seedOrganizationFormConfigs(organizationId: bigint) {
  return stdbBrowserCompatCall("seed_organization_form_configs", [organizationId.toString()])
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

export function setFormFieldLabel(
  organizationId: bigint,
  fieldRowId: bigint,
  params: { locale: string; label: string },
) {
  return stdbBrowserCompatCall("set_form_field_label", [
    organizationId.toString(),
    fieldRowId.toString(),
    params,
  ])
}

export function addUserCustomField(
  organizationId: bigint,
  params: CreateUserCustomFieldParams,
) {
  return stdbBrowserCompatCall("add_user_custom_field", [organizationId.toString(), params])
}

export function deleteUserCustomField(
  organizationId: bigint,
  customFieldId: bigint,
) {
  return stdbBrowserCompatCall("delete_user_custom_field", [
    organizationId.toString(),
    customFieldId.toString(),
  ])
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
