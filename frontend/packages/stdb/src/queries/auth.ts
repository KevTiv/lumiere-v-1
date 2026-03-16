import UserProfileRow from "../generated/user_profile_table";
import CasbinRuleRow from "../generated/casbin_rule_table";
import RoleRow from "../generated/role_table";
import UserRoleAssignmentRow from "../generated/user_role_assignment_table";
import UserOrganizationRow from "../generated/user_organization_table";
import type { Infer } from "spacetimedb";
import { getStdbConnection } from "../connection";

export type UserProfile = Infer<typeof UserProfileRow>;
export type CasbinRule = Infer<typeof CasbinRuleRow>;
export type StdbRole = Infer<typeof RoleRow>;
export type UserRoleAssignment = Infer<typeof UserRoleAssignmentRow>;
export type UserOrganization = Infer<typeof UserOrganizationRow>;

export function authSubscriptions(): string[] {
  return [
    "SELECT * FROM user_profile",
    "SELECT * FROM user_role_assignment",
    "SELECT * FROM role",
    "SELECT * FROM casbin_rule",
    "SELECT * FROM user_organization",
  ];
}

export function queryUserProfile(identityHex: string): UserProfile | null {
  const conn = getStdbConnection();
  if (!conn) return null;
  for (const row of conn.db.user_profile.iter()) {
    if (row.identity.toHexString() === identityHex) return row;
  }
  return null;
}

export function queryCasbinRules(): CasbinRule[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.casbin_rule.iter()];
}

export function queryStdbRoles(): StdbRole[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.role.iter()].filter((r) => r.isActive);
}

export function queryUserRoleAssignments(identityHex: string): UserRoleAssignment[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.user_role_assignment.iter()].filter(
    (a) => a.userIdentity.toHexString() === identityHex && a.isActive,
  );
}

export function queryUserOrganization(identityHex: string): UserOrganization | null {
  const conn = getStdbConnection();
  if (!conn) return null;
  const orgs = [...conn.db.user_organization.iter()].filter(
    (o) => o.userIdentity.toHexString() === identityHex && o.isActive,
  );
  return orgs.find((o) => o.isDefault) ?? orgs[0] ?? null;
}
