import type { Infer } from "spacetimedb";
import type UserProfileRow from "../generated/user_profile_table";
import type CasbinRuleRow from "../generated/casbin_rule_table";
import type RoleRow from "../generated/role_table";
import type UserRoleAssignmentRow from "../generated/user_role_assignment_table";
import type UserOrganizationRow from "../generated/user_organization_table";

export type UserProfile = Infer<typeof UserProfileRow>;
export type CasbinRule = Infer<typeof CasbinRuleRow>;
export type StdbRole = Infer<typeof RoleRow>;
export type UserRoleAssignment = Infer<typeof UserRoleAssignmentRow>;
export type UserOrganization = Infer<typeof UserOrganizationRow>;

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
  const id = isNarrowIdentityHex(identityHex) ? identityHex.toLowerCase() : undefined;
  const roles = (roleNames ?? []).filter((r) => r.length > 0 && r.length < 256);

  const userProfileSql = id
    ? `SELECT * FROM user_profile WHERE identity = 0x${id}`
    : "SELECT * FROM user_profile";

  const userRoleAssignmentSql = id
    ? `SELECT * FROM user_role_assignment WHERE user_identity = 0x${id} AND is_active = true`
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
    ? `SELECT * FROM user_organization WHERE user_identity = 0x${id} AND is_active = true`
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

  const orgPermissionSql =
    orgIdNum !== undefined
      ? `SELECT * FROM org_permission WHERE organization_id = ${orgIdNum}`
      : "SELECT * FROM org_permission";

  const policySnapshotSql =
    orgIdNum !== undefined && id
      ? `SELECT * FROM policy_snapshot WHERE organization_id = ${orgIdNum} AND user_identity = 0x${id}`
      : id
        ? `SELECT * FROM policy_snapshot WHERE user_identity = 0x${id}`
        : "SELECT * FROM policy_snapshot";

  return [
    userProfileSql,
    userRoleAssignmentSql,
    roleSql,
    userOrganizationSql,
    casbinSql,
    orgPermissionSql,
    policySnapshotSql,
  ];
}
