import { getStdbConnection } from "../connection";
import type {
  CreateFormFieldParams,
  CreateRoleConfigParams,
} from "../generated/types";

export type { CreateFormFieldParams, CreateRoleConfigParams };

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

export function setFormRoleConfig(
  organizationId: bigint,
  configurationId: bigint,
  params: CreateRoleConfigParams,
) {
  const conn = getStdbConnection();
  if (!conn) throw new Error("Not connected to SpacetimeDB");
  return conn.reducers.setFormRoleConfig({ organizationId, configurationId, params });
}
