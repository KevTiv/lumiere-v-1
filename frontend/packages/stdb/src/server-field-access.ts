/**
 * Builds {@link FieldAccessContext} for HTTP SQL callers (e.g. `/api/query`) from
 * SpacetimeDB auth tables. Column-level policies are applied in {@link ./field-policy}.
 */

import type { CasbinRuleLike, FieldAccessContext } from './field-policy'
import {
  selectCasbinRulesInSubjectsSql,
  selectRolesActiveSql,
  selectUserOrganizationForIdentitySql,
  selectUserProfileByIdentitySql,
} from './field-policy'
import { stdbSql, type StdbHttpOptions } from './http'

export async function loadFieldAccessContext(
  identityHex: string,
  organizationId: number,
  opts: StdbHttpOptions,
): Promise<FieldAccessContext | undefined> {
  if (!identityHex || identityHex === 'unknown') return undefined

  const profiles = await stdbSql(
    selectUserProfileByIdentitySql(identityHex, undefined),
    opts,
  )
  const profile = profiles[0] as { isSuperuser?: boolean } | undefined
  if (!profile) return undefined

  const orgs = await stdbSql(
    selectUserOrganizationForIdentitySql(identityHex, undefined),
    opts,
  )
  const uo = orgs.find((o) => Number((o as { organizationId?: number }).organizationId) === organizationId)
  if (!uo) return undefined

  const roles = await stdbSql(selectRolesActiveSql(undefined), opts)
  const roleId = Number((uo as { roleId?: number }).roleId)
  const role = roles.find((r) => Number(r.id) === roleId)
  if (!role) return undefined

  const roleName = String(role['name'] ?? '')
  const esc = (s: string) => s.replace(/'/g, "''")
  const subjects = [identityHex, String(role.id), roleName].map((s) => `'${esc(s)}'`).join(', ')
  const casbin = await stdbSql<CasbinRuleLike>(
    selectCasbinRulesInSubjectsSql(subjects, undefined),
    opts,
  )

  const perms = role['permissions']
  const rolePermissions = Array.isArray(perms) ? perms.map(String) : []

  return {
    organizationId,
    roleId: Number(role.id),
    roleName,
    isSuperuser: Boolean(profile.isSuperuser),
    rolePermissions,
    identityHex,
    casbinRules: casbin,
  }
}
