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

/**
 * Returns subscription SQL for the current user's auth data.
 *
 * When `identityHex` is provided, `casbin_rule` is filtered to only rules
 * where v0 matches the user's identity or their assigned role names.
 * This prevents broadcasting the full permission matrix to every client.
 *
 * When called without arguments (before identity is known), casbin_rule is
 * omitted — the server prefetch via serverQueryCasbinRulesForUser covers that.
 */
export function authSubscriptions(
  _identityHex?: string,
  _roleNames?: string[],
): string[] {
  const base = [
    "SELECT * FROM user_profile",
    "SELECT * FROM user_role_assignment",
    "SELECT * FROM role",
    "SELECT * FROM user_organization",
  ];

  // SpacetimeDB subscriptions don't support IN expressions — subscribe to
  // all casbin_rule rows and filter client-side in queryCasbinRules().
  return [...base, "SELECT * FROM casbin_rule"];
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
