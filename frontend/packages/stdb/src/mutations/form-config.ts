import { getStdbConnection } from "../connection";
import type {
  CreateFormConfigParams,
  CreateFormFieldParams,
  CreateRoleConfigParams,
  CreateUserCustomFieldParams,
  UpdateFormFieldParams,
} from "../generated/types";

export type {
  CreateFormConfigParams,
  CreateFormFieldParams,
  CreateRoleConfigParams,
  CreateUserCustomFieldParams,
  UpdateFormFieldParams,
};

export function createFormConfiguration(
  organizationId: bigint,
  params: CreateFormConfigParams,
) {
  const conn = getStdbConnection();
  if (!conn) throw new Error("Not connected to SpacetimeDB");
  return conn.reducers.createFormConfiguration({ organizationId, params });
}

export function getFormConfiguration(
  organizationId: bigint,
  moduleId: string,
  formId: string,
) {
  const conn = getStdbConnection();
  if (!conn) throw new Error("Not connected to SpacetimeDB");
  return conn.reducers.getFormConfiguration({ organizationId, moduleId, formId });
}

export function getOrganizationFormConfigs(organizationId: bigint) {
  const conn = getStdbConnection();
  if (!conn) throw new Error("Not connected to SpacetimeDB");
  return conn.reducers.getOrganizationFormConfigs({ organizationId });
}

export function initializeDefaultFormConfigs(organizationId: bigint) {
  const conn = getStdbConnection();
  if (!conn) throw new Error("Not connected to SpacetimeDB");
  return conn.reducers.initializeDefaultFormConfigs({ organizationId });
}

export function seedOrganizationFormConfigs(organizationId: bigint) {
  const conn = getStdbConnection();
  if (!conn) throw new Error("Not connected to SpacetimeDB");
  return conn.reducers.seedOrganizationFormConfigs({ organizationId });
}

export function addFormField(
  organizationId: bigint,
  configurationId: bigint,
  params: CreateFormFieldParams,
) {
  const conn = getStdbConnection();
  if (!conn) throw new Error("Not connected to SpacetimeDB");
  return conn.reducers.addFormField({ organizationId, configurationId, params });
}

export function updateFormField(
  organizationId: bigint,
  configurationId: bigint,
  fieldId: string,
  params: UpdateFormFieldParams,
) {
  const conn = getStdbConnection();
  if (!conn) throw new Error("Not connected to SpacetimeDB");
  return conn.reducers.updateFormField({
    organizationId,
    configurationId,
    fieldId,
    params,
  });
}

export function deleteFormField(
  organizationId: bigint,
  configurationId: bigint,
  fieldId: string,
) {
  const conn = getStdbConnection();
  if (!conn) throw new Error("Not connected to SpacetimeDB");
  return conn.reducers.deleteFormField({
    organizationId,
    configurationId,
    fieldId,
  });
}

export function setFormRoleConfig(
  organizationId: bigint,
  configurationId: bigint,
  params: CreateRoleConfigParams,
) {
  const conn = getStdbConnection();
  if (!conn) throw new Error("Not connected to SpacetimeDB");
  return conn.reducers.setFormRoleConfig({ organizationId, configurationId, params });
}

export function addUserCustomField(
  organizationId: bigint,
  params: CreateUserCustomFieldParams,
) {
  const conn = getStdbConnection();
  if (!conn) throw new Error("Not connected to SpacetimeDB");
  return conn.reducers.addUserCustomField({ organizationId, params });
}

export function deleteUserCustomField(
  organizationId: bigint,
  customFieldId: bigint,
) {
  const conn = getStdbConnection();
  if (!conn) throw new Error("Not connected to SpacetimeDB");
  return conn.reducers.deleteUserCustomField({
    organizationId,
    customFieldId,
  });
}
