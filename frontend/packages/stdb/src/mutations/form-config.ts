import { stdbBrowserCall } from "../browser-http"
import type {
  CreateFormConfigParams,
  CreateFormFieldParams,
  CreateRoleConfigParams,
  CreateUserCustomFieldParams,
  UpdateFormFieldParams,
} from "../generated/types"

export type {
  CreateFormConfigParams,
  CreateFormFieldParams,
  CreateRoleConfigParams,
  CreateUserCustomFieldParams,
  UpdateFormFieldParams,
}

export function createFormConfiguration(
  organizationId: bigint,
  params: CreateFormConfigParams,
) {
  return stdbBrowserCall("create_form_configuration", [organizationId.toString(), params])
}

export function getFormConfiguration(
  organizationId: bigint,
  moduleId: string,
  formId: string,
) {
  return stdbBrowserCall("get_form_configuration", [organizationId.toString(), moduleId, formId])
}

export function getOrganizationFormConfigs(organizationId: bigint) {
  return stdbBrowserCall("get_organization_form_configs", [organizationId.toString()])
}

export function initializeDefaultFormConfigs(organizationId: bigint) {
  return stdbBrowserCall("initialize_default_form_configs", [organizationId.toString()])
}

export function seedOrganizationFormConfigs(organizationId: bigint) {
  return stdbBrowserCall("seed_organization_form_configs", [organizationId.toString()])
}

export function addFormField(
  organizationId: bigint,
  configurationId: bigint,
  params: CreateFormFieldParams,
) {
  return stdbBrowserCall("add_form_field", [
    organizationId.toString(),
    configurationId.toString(),
    params,
  ])
}

export function updateFormField(
  organizationId: bigint,
  configurationId: bigint,
  fieldId: string,
  params: UpdateFormFieldParams,
) {
  return stdbBrowserCall("update_form_field", [
    organizationId.toString(),
    configurationId.toString(),
    fieldId,
    params,
  ])
}

export function deleteFormField(
  organizationId: bigint,
  configurationId: bigint,
  fieldId: string,
) {
  return stdbBrowserCall("delete_form_field", [
    organizationId.toString(),
    configurationId.toString(),
    fieldId,
  ])
}

export function setFormRoleConfig(
  organizationId: bigint,
  configurationId: bigint,
  params: CreateRoleConfigParams,
) {
  return stdbBrowserCall("set_form_role_config", [
    organizationId.toString(),
    configurationId.toString(),
    params,
  ])
}

export function addUserCustomField(
  organizationId: bigint,
  params: CreateUserCustomFieldParams,
) {
  return stdbBrowserCall("add_user_custom_field", [organizationId.toString(), params])
}

export function deleteUserCustomField(
  organizationId: bigint,
  customFieldId: bigint,
) {
  return stdbBrowserCall("delete_user_custom_field", [
    organizationId.toString(),
    customFieldId.toString(),
  ])
}
