import type UserProfileRow from "../generated/user_profile_table";
import type CasbinRuleRow from "../generated/casbin_rule_table";
import type RoleRow from "../generated/role_table";
import type UserRoleAssignmentRow from "../generated/user_role_assignment_table";
import type UserOrganizationRow from "../generated/user_organization_table";
import type { Infer } from "spacetimedb";
import { getStdbConnection } from "../connection";

export type UserProfile = Infer<typeof UserProfileRow>;
export type CasbinRule = Infer<typeof CasbinRuleRow>;
export type StdbRole = Infer<typeof RoleRow>;
export type UserRoleAssignment = Infer<typeof UserRoleAssignmentRow>;
export type UserOrganization = Infer<typeof UserOrganizationRow>;

function sqlQuoteIdentityHex(s: string): string {
  return s.replace(/'/g, "''");
}

function sqlQuoteStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function isNarrowIdentityHex(s: string | undefined): s is string {
  return typeof s === "string" && /^[0-9a-fA-F]{64}$/.test(s);
}

/**
 * Returns subscription SQL for the current user's auth data.
 *
 * When `identityHex` is a valid 64-char hex identity (and usually when the layout
 * passes `organizationId`), queries are scoped so clients do not mirror every
 * user's profile, memberships, or Casbin rows.
 *
 * When identity is unknown (e.g. dev-first connect before cookies), falls back
 * to broad `SELECT *` mirrors — same as historical behavior.
 */
export function authSubscriptions(
  identityHex?: string,
  roleNames?: string[],
  organizationId?: number,
): string[] {
  const id = isNarrowIdentityHex(identityHex) ? identityHex : undefined;
  const escId = id ? sqlQuoteIdentityHex(id) : "";
  const roles = (roleNames ?? []).filter((r) => r.length > 0 && r.length < 256);

  const userProfileSql = id
    ? `SELECT * FROM user_profile WHERE identity = '${escId}'`
    : "SELECT * FROM user_profile";

  const userRoleAssignmentSql = id
    ? `SELECT * FROM user_role_assignment WHERE user_identity = '${escId}' AND is_active = true`
    : "SELECT * FROM user_role_assignment";

  const orgIdNum =
    organizationId !== undefined &&
    organizationId !== null &&
    Number.isFinite(Number(organizationId)) &&
    Number(organizationId) > 0
      ? Math.floor(Number(organizationId))
      : undefined;

  const roleSql =
    orgIdNum !== undefined
      ? `SELECT * FROM role WHERE organization_id = ${orgIdNum}`
      : "SELECT * FROM role";

  const userOrganizationSql = id
    ? `SELECT * FROM user_organization WHERE user_identity = '${escId}' AND is_active = true`
    : "SELECT * FROM user_organization";

  const casbinSubjects: string[] = [];
  if (id) {
    casbinSubjects.push(id);
    for (const r of roles) {
      casbinSubjects.push(r);
    }
  }

  const casbinSql =
    casbinSubjects.length > 0
      ? `SELECT * FROM casbin_rule WHERE (${casbinSubjects
          .map((s) => `v0 = ${sqlQuoteStr(s)}`)
          .join(" OR ")})`
      : "SELECT * FROM casbin_rule";

  return [
    userProfileSql,
    userRoleAssignmentSql,
    roleSql,
    userOrganizationSql,
    casbinSql,
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
