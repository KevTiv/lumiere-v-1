/**
 * Field-level read policy for SpacetimeDB SQL (API / subscriptions).
 *
 * Registry keys and column metadata live in Rust (`crates/stdb-auth/assets/resource_registry.json`).
 * Run `make codegen` to refresh `./generated/query-registry.ts`.
 */

import stdbGeneratedSqlColumns from './stdb-generated-sql-columns.json'
import {
  QUERY_RESOURCE_KEYS,
  RESOURCE_REGISTRY,
  type QueryResourceKey,
  type ResourceEntry,
} from './generated/query-registry'

export type { QueryResourceKey, ResourceEntry }
export { QUERY_RESOURCE_KEYS, RESOURCE_REGISTRY }

export interface FieldAccessContext {
  organizationId: number
  roleId: number
  roleName: string
  isSuperuser: boolean
  rolePermissions: readonly string[]
  identityHex: string
  casbinRules: ReadonlyArray<CasbinRuleLike>
}

export interface CasbinRuleLike {
  ptype: string
  v0?: string | null
  v1?: string | null
  v2?: string | null
  v3?: string | null
  v4?: string | null
  v5?: string | null
  metadata?: string | null
}

export function assertSafeSqlIdentifiers(cols: string[]): string[] {
  for (const c of cols) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(c)) {
      throw new Error(`Invalid SQL identifier: ${c}`)
    }
  }
  return cols
}

function uniquePreserveOrder(cols: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of cols) {
    if (!seen.has(c)) {
      seen.add(c)
      out.push(c)
    }
  }
  return out
}

function parseFieldsFromMetadata(metadata: string | null | undefined): string[] | null {
  if (!metadata) return null
  try {
    const j = JSON.parse(metadata) as { fields?: unknown }
    if (!Array.isArray(j.fields)) return null
    const raw = j.fields.filter((x): x is string => typeof x === 'string')
    if (raw.length === 0) return null
    return assertSafeSqlIdentifiers(raw.map(s => s.trim()))
  } catch {
    return null
  }
}

function parseFieldsFromV5(v5: string | null | undefined): string[] | null {
  if (!v5?.trim()) return null
  const parts = v5.split(',').map(s => s.trim()).filter(Boolean)
  if (parts.length === 0) return null
  return assertSafeSqlIdentifiers(parts)
}

function matchesResource(v2: string | null | undefined, resourceKey: QueryResourceKey): boolean {
  if (!v2) return false
  const reg = RESOURCE_REGISTRY[resourceKey]
  if (v2 === resourceKey) return true
  return reg.aliases.includes(v2)
}

function subjectMatches(
  v0: string | null | undefined,
  ctx: FieldAccessContext,
): boolean {
  if (!v0) return false
  return (
    v0 === ctx.identityHex
    || v0 === String(ctx.roleId)
    || v0 === ctx.roleName
  )
}

/**
 * @returns `null` = full row access (`SELECT *`), else explicit column list (snake_case).
 */
export function resolveReadColumns(
  resourceKey: QueryResourceKey,
  fieldAccess: FieldAccessContext | undefined,
): string[] | null {
  if (!fieldAccess) return null

  if (fieldAccess.isSuperuser) return null

  if (fieldAccess.rolePermissions.includes('*:*')) return null

  const orgStr = String(fieldAccess.organizationId)
  const reg = RESOURCE_REGISTRY[resourceKey]

  let sawFullWildcard = false
  const fieldBatches: string[][] = []

  for (const rule of fieldAccess.casbinRules) {
    if (rule.ptype !== 'p') continue
    if (!subjectMatches(rule.v0, fieldAccess)) continue
    if (rule.v1 !== orgStr) continue

    const v2 = rule.v2 ?? ''
    const v3 = rule.v3 ?? ''

    if (v2 === '*' && (v3 === '*' || v3 === 'read')) {
      const deny = rule.v4?.toLowerCase() === 'deny'
      if (!deny) sawFullWildcard = true
      continue
    }

    if (!matchesResource(v2, resourceKey)) continue
    if (!(v3 === 'read' || v3 === '*')) continue

    const fromMeta = parseFieldsFromMetadata(rule.metadata ?? null)
    const fromV5 = parseFieldsFromV5(rule.v5 ?? null)
    const fields = fromMeta ?? fromV5
    if (fields?.length) fieldBatches.push(fields)
  }

  if (sawFullWildcard) return null

  if (fieldBatches.length > 0) {
    const merged = uniquePreserveOrder([...reg.mandatory, ...fieldBatches.flat()])
    return assertSafeSqlIdentifiers(merged)
  }

  return assertSafeSqlIdentifiers([...reg.mandatory, ...reg.defaultRestricted])
}

const HR_EMPLOYEE_SENSITIVE = [
  'gender',
  'birthday',
  'marital',
  'emergency_contact',
  'emergency_phone',
  'barcode',
] as const
const HR_EMPLOYEE_PIN = 'pin'
const HR_CONTRACT_COMP = ['wage'] as const
const HR_PAYSLIP_COMP = ['basic_wage', 'gross_wage', 'net_wage'] as const

export function hasHrPermission(
  fieldAccess: FieldAccessContext | undefined,
  resource: string,
  action: string,
): boolean {
  if (!fieldAccess) return false
  if (fieldAccess.isSuperuser) return true
  const perm = `${resource}:${action}`
  const wildcard = `${resource}:*`
  return (
    fieldAccess.rolePermissions.includes('*:*')
    || fieldAccess.rolePermissions.includes(perm)
    || fieldAccess.rolePermissions.includes(wildcard)
  )
}

const HR_STATUTORY_ID_VALUE = 'value'

/** Strip `pin` from broad feeds; gate wages behind `view_comp`; purpose-scoped sensitive columns. */
export function applyHrFieldPolicy(
  resourceKey: QueryResourceKey,
  cols: string[],
  fieldAccess: FieldAccessContext | undefined,
): string[] {
  if (!fieldAccess || fieldAccess.isSuperuser || fieldAccess.rolePermissions.includes('*:*')) {
    return cols
  }

  let out = cols.filter(c => c !== HR_EMPLOYEE_PIN)

  if (resourceKey === 'employees') {
    out = out.filter(c => !(HR_EMPLOYEE_SENSITIVE as readonly string[]).includes(c))
  }

  if (resourceKey === 'my-employee') {
    if (hasHrPermission(fieldAccess, 'hr_employee', 'view_pii')) {
      out = uniquePreserveOrder([
        ...out,
        ...HR_EMPLOYEE_SENSITIVE,
        HR_EMPLOYEE_PIN,
      ])
    }
  }

  if (resourceKey === 'direct-reports') {
    out = out.filter(c => !(HR_EMPLOYEE_SENSITIVE as readonly string[]).includes(c))
  }

  if (resourceKey === 'contracts') {
    if (hasHrPermission(fieldAccess, 'hr_contract', 'view_comp')) {
      out = uniquePreserveOrder([...out, ...HR_CONTRACT_COMP])
    } else {
      out = out.filter(c => !(HR_CONTRACT_COMP as readonly string[]).includes(c))
    }
  }

  if (resourceKey === 'payslips') {
    if (hasHrPermission(fieldAccess, 'hr_payroll', 'view_comp')) {
      out = uniquePreserveOrder([...out, ...HR_PAYSLIP_COMP])
    } else {
      out = out.filter(c => !(HR_PAYSLIP_COMP as readonly string[]).includes(c))
    }
  }

  if (resourceKey === 'hr-statutory-ids') {
    if (hasHrPermission(fieldAccess, 'hr_employee', 'view_statutory_id')) {
      out = uniquePreserveOrder([...out, HR_STATUTORY_ID_VALUE])
    } else {
      out = out.filter(c => c !== HR_STATUTORY_ID_VALUE)
    }
  }

  return assertSafeSqlIdentifiers(out)
}

export function purposeForHrResource(resourceKey: string): string {
  if (resourceKey === 'my-employee') return 'hr_self'
  if (resourceKey === 'direct-reports') return 'hr_manager'
  return 'hr_admin'
}

export function isHrPiiResource(resourceKey: string): boolean {
  return (
    resourceKey === 'employees'
    || resourceKey === 'my-employee'
    || resourceKey === 'direct-reports'
    || resourceKey === 'contracts'
    || resourceKey === 'payslips'
    || resourceKey === 'hr-statutory-ids'
  )
}

/**
 * Columns to exclude from HTTP SQL queries for specific resources.
 * Identity columns (user_id, assigned_to, created_by) cause "Unsupported" errors in SpacetimeDB HTTP SQL.
 */
const HTTP_SQL_EXCLUDED_COLUMNS: Record<string, Set<string>> = {
  activities: new Set(['user_id', 'assigned_to', 'created_by', 'date_deadline', 'date_done']),
  'contact-segments': new Set(['domain']),
  'opportunity-stages': new Set(['requirements']),
  roles: new Set(['permissions']),
}

/** Per-resource columns selected even when globally excluded (e.g. metadata for credit-note linkage). */
const HTTP_SQL_INCLUDED_COLUMNS: Record<string, Set<string>> = {
  'account-moves': new Set(['metadata']),
}

/** Columns unsafe in SpacetimeDB HTTP SQL across most tables (audit, vecs, identity refs). */
const GLOBAL_HTTP_SQL_EXCLUDED_COLUMNS = new Set([
  'metadata',
  'create_uid',
  'write_uid',
  'create_date',
  'write_date',
  'created_at',
  'updated_at',
  'message_follower_ids',
  'message_ids',
  'activity_ids',
  'tag_ids',
])

function filterHttpSqlUnsafeColumns(
  cols: readonly string[],
  resourceKey?: QueryResourceKey,
): string[] {
  const resourceExcluded = resourceKey ? HTTP_SQL_EXCLUDED_COLUMNS[resourceKey] : undefined
  const resourceIncluded = resourceKey ? HTTP_SQL_INCLUDED_COLUMNS[resourceKey] : undefined
  return cols.filter((col) => {
    if (resourceIncluded?.has(col)) return true
    if (GLOBAL_HTTP_SQL_EXCLUDED_COLUMNS.has(col)) return false
    if (resourceExcluded?.has(col)) return false
    if (col.endsWith('_ids')) return false
    return true
  })
}

/**
 * Column list for SpacetimeDB HTTP SQL — never `*`. Uses Casbin/role restrictions when set;
 * otherwise registry mandatory + defaultRestricted (full generated schema often includes
 * Timestamp/Identity/Vec/enum columns that HTTP SQL rejects).
 */
export function resolveHttpSqlColumns(
  resourceKey: QueryResourceKey,
  fieldAccess: FieldAccessContext | undefined,
): string[] {
  const restricted = resolveReadColumns(resourceKey, fieldAccess)
  const reg = RESOURCE_REGISTRY[resourceKey]
  const cols =
    restricted !== null
      ? restricted
      : assertSafeSqlIdentifiers(uniquePreserveOrder([...reg.mandatory, ...reg.defaultRestricted]))
  const policyCols = applyHrFieldPolicy(resourceKey, cols, fieldAccess)
  return assertSafeSqlIdentifiers(filterHttpSqlUnsafeColumns(policyCols, resourceKey))
}

/** Explicit column list for a generated row `typeName` (PascalCase, e.g. `UserProfile`). */
export function sqlColumnListForGeneratedType(typeName: string): string[] {
  const fromSchema = (stdbGeneratedSqlColumns as Record<string, string[]>)[typeName]
  if (!fromSchema?.length) {
    throw new Error(`sqlColumnListForGeneratedType: unknown type "${typeName}"`)
  }
  return assertSafeSqlIdentifiers(fromSchema)
}

export function selectOrgScopedSql(
  resourceKey: QueryResourceKey,
  table: string,
  organizationId: bigint | number,
  fieldAccess: FieldAccessContext | undefined,
  extraWhere: string,
  orderBy = '',
): string {
  const cols = resolveHttpSqlColumns(resourceKey, fieldAccess)
  const colPart = cols.join(', ')
  const where = `organization_id = ${organizationId}${extraWhere}`
  return `SELECT ${colPart} FROM ${table} WHERE ${where}${orderBy}`
}

/** Build SELECT for tables filtered by `company_id` (legacy company scope). */
export function selectCompanyScopedSql(
  resourceKey: QueryResourceKey,
  table: string,
  companyId: bigint | number,
  fieldAccess: FieldAccessContext | undefined,
  extraWhere: string,
  orderBy = '',
): string {
  const cols = resolveHttpSqlColumns(resourceKey, fieldAccess)
  const colPart = cols.join(', ')
  const where = `company_id = ${companyId}${extraWhere}`
  return `SELECT ${colPart} FROM ${table} WHERE ${where}${orderBy}`
}

export function selectRawSql(
  resourceKey: QueryResourceKey,
  sqlBody: string,
  fieldAccess: FieldAccessContext | undefined,
): string {
  const cols = resolveHttpSqlColumns(resourceKey, fieldAccess)
  const colPart = cols.join(', ')
  return `SELECT ${colPart} ${sqlBody}`
}

export function selectRolesActiveSql(fieldAccess: FieldAccessContext | undefined): string {
  const cols = resolveHttpSqlColumns('roles', fieldAccess)
  const colPart = cols.join(', ')
  return `SELECT ${colPart} FROM role WHERE is_active = true`
}

/** SpacetimeDB HTTP SQL: Identity columns use `0x` + 64 hex, not quoted UUIDs. */
export function identitySqlLiteral(hex64: string): string {
  const s = hex64.trim().replace(/^0x/i, '')
  if (s.length !== 64 || !/^[0-9a-fA-F]+$/.test(s)) {
    throw new Error(`invalid SpacetimeDB identity hex (expected 64 hex digits, got len ${s.length})`)
  }
  return `0x${s.toLowerCase()}`
}

export function selectUserProfileByIdentitySql(
  identityHex: string,
  fieldAccess: FieldAccessContext | undefined,
): string {
  const cols = resolveHttpSqlColumns('user-profile', fieldAccess)
  const colPart = cols.join(', ')
  const id = identitySqlLiteral(identityHex)
  return `SELECT ${colPart} FROM user_profile WHERE identity = ${id} LIMIT 1`
}

export function selectUserRoleAssignmentsForIdentitySql(
  identityHex: string,
  fieldAccess: FieldAccessContext | undefined,
): string {
  const cols = resolveHttpSqlColumns('user-roles', fieldAccess)
  const colPart = cols.join(', ')
  const id = identitySqlLiteral(identityHex)
  return `SELECT ${colPart} FROM user_role_assignment WHERE user_identity = ${id} AND is_active = true`
}

export function selectUserOrganizationForIdentitySql(
  identityHex: string,
  fieldAccess: FieldAccessContext | undefined,
): string {
  const cols = resolveHttpSqlColumns('user-organization', fieldAccess)
  const colPart = cols.join(', ')
  const id = identitySqlLiteral(identityHex)
  return `SELECT ${colPart} FROM user_organization WHERE user_identity = ${id} AND is_active = true`
}

export function selectCasbinRulesInSubjectsSql(
  subjectsListSql: string,
  fieldAccess: FieldAccessContext | undefined,
): string {
  const cols = resolveHttpSqlColumns('casbin-rule', fieldAccess)
  const colPart = cols.join(', ')
  return `SELECT ${colPart} FROM casbin_rule WHERE v0 IN (${subjectsListSql})`
}
