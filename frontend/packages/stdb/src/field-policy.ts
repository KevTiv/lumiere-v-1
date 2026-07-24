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

export interface FieldPermissionLike {
  id?: number | string | bigint | null
  organizationId?: number | null
  organization_id?: number | null
  roleId?: number | string | null
  role_id?: number | string | null
  resource?: string | null
  /** `"read"` or `"write"` (SpacetimeDB enum JSON may use `{ read: [] }`). */
  action?: string | Record<string, unknown> | null
  allowedFields?: string[] | null
  allowed_fields?: string[] | null
  subjectUserHex?: string | null
  subject_user_hex?: string | null
  subjectRoleId?: number | string | null
  subject_role_id?: number | string | null
}

export interface FieldAccessContext {
  organizationId: number
  roleId: number
  roleName: string
  isSuperuser: boolean
  rolePermissions: readonly string[]
  identityHex: string
  fieldPermissions: ReadonlyArray<FieldPermissionLike>
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

function fieldPermissionActionLabel(action: FieldPermissionLike['action']): string {
  if (typeof action === 'string') return action.toLowerCase()
  if (action && typeof action === 'object') {
    const key = Object.keys(action)[0]
    if (key) return key.toLowerCase()
  }
  return ''
}

function fieldResourceMatches(configured: string, resourceKey: QueryResourceKey): boolean {
  if (!configured) return false
  if (configured === '*' || configured === resourceKey) return true
  const configuredNorm = configured.replace(/-/g, '_')
  const resourceNorm = resourceKey.replace(/-/g, '_')
  if (configuredNorm === resourceNorm) return true
  const reg = RESOURCE_REGISTRY[resourceKey]
  return reg.aliases.includes(configured) || reg.aliases.some(
    (alias) => alias.replace(/-/g, '_') === configuredNorm,
  )
}

function fieldPermissionApplies(rule: FieldPermissionLike, ctx: FieldAccessContext): boolean {
  const subjectRoleId = rule.subjectRoleId ?? rule.subject_role_id
  if (subjectRoleId != null && Number(subjectRoleId) === ctx.roleId) {
    return true
  }

  const subjectUserHex = (rule.subjectUserHex ?? rule.subject_user_hex ?? '')
    .trim()
    .replace(/^0x/i, '')
    .toLowerCase()
  const identityHex = ctx.identityHex.trim().replace(/^0x/i, '').toLowerCase()
  if (subjectUserHex && subjectUserHex === identityHex) {
    return true
  }

  const roleId = rule.roleId ?? rule.role_id
  if (roleId != null && Number(roleId) === ctx.roleId) {
    return true
  }

  return false
}

function allowedFieldsFromRule(rule: FieldPermissionLike): string[] {
  const raw = rule.allowedFields ?? rule.allowed_fields ?? []
  if (!Array.isArray(raw)) return []
  return assertSafeSqlIdentifiers(
    raw.filter((f): f is string => typeof f === 'string').map((s) => s.trim()).filter(Boolean),
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

  const reg = RESOURCE_REGISTRY[resourceKey]
  const fieldBatches: string[][] = []

  for (const rule of fieldAccess.fieldPermissions) {
    if (fieldPermissionActionLabel(rule.action) !== 'read') continue
    if (!fieldPermissionApplies(rule, fieldAccess)) continue
    const resource = String(rule.resource ?? '')
    if (!fieldResourceMatches(resource, resourceKey)) continue
    const fields = allowedFieldsFromRule(rule)
    if (fields.length > 0) fieldBatches.push(fields)
  }

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
 * Column list for SpacetimeDB HTTP SQL — never `*`. Uses field-permission restrictions when set;
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

export function selectFieldPermissionsForOrgSql(
  organizationId: bigint | number,
): string {
  return `SELECT id, organization_id, subject, role_id, resource, action, allowed_fields, created_by, created_at FROM field_permission WHERE organization_id = ${organizationId}`
}
