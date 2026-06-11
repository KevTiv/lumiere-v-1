"use client"

/**
 * Auth hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Auth module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { authBffPost } from "@lumiere/stdb/commands"
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

type ScalarId = bigint | number | string

function toScalarU64(v: ScalarId): bigint {
  return typeof v === "bigint" ? v : BigInt(String(v))
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useAuditLog(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['audit-log', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/audit-log', 'Failed to fetch audit log'),
    staleTime: 30_000,
    initialData,
  })
}

export function useAuditRules(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['audit-rules', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/audit-rules', 'Failed to fetch audit rules'),
    staleTime: 30_000,
    initialData,
  })
}

export function useUserSessions(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['user-sessions', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/user-sessions', 'Failed to fetch user sessions'),
    staleTime: 30_000,
    initialData,
  })
}

export function useUserInvites(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['user-invites', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/user-invites', 'Failed to fetch user invites'),
    staleTime: 30_000,
    initialData,
  })
}

function invalidateAuthModule(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: bigint,
) {
  const org = rqBigIntKey(organizationId)
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['audit-log', org] }),
    qc.invalidateQueries({ queryKey: ['audit-rules', org] }),
    qc.invalidateQueries({ queryKey: ['user-sessions', org] }),
    qc.invalidateQueries({ queryKey: ['user-invites', org] }),
    ...invalidateSettingsQueries(qc, organizationId),
  ])
}

function invalidateSettingsQueries(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: bigint,
) {
  const org = rqBigIntKey(organizationId)
  return [
    qc.invalidateQueries({ queryKey: ['settings-roles', org] }),
    qc.invalidateQueries({ queryKey: ['settings-users', org] }),
    qc.invalidateQueries({ queryKey: ['user-role-assignments', org] }),
    qc.invalidateQueries({ queryKey: ['user-organizations', org] }),
    qc.invalidateQueries({
      queryKey: ['api-gateway', org, 'GET', '/v1/settings/roles'],
    }),
    qc.invalidateQueries({
      queryKey: ['api-gateway', org, 'GET', '/v1/settings/users'],
    }),
  ]
}

async function fetchSettingsList(path: string, errorMessage: string): Promise<QueryRows> {
  const r = await apiFetch(path)
  if (!r.ok) throw new Error(errorMessage)
  const json = (await r.json()) as unknown
  if (!json || typeof json !== 'object' || !('data' in json)) return []
  const raw = (json as { data: unknown }).data
  if (!Array.isArray(raw)) return []
  return raw.filter((row): row is QueryRows[number] => !!row && typeof row === 'object')
}

function pickField<T>(row: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null) return value as T
  }
  return undefined
}

function normalizeIdentityHex(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''
    return trimmed.replace(/^0x/i, '').toLowerCase()
  }
  if (value && typeof value === 'object') {
    const hex = pickField<unknown>(value as Record<string, unknown>, 'hex', 'Hex')
    if (hex != null) return normalizeIdentityHex(hex)
  }
  return String(value ?? '').trim().replace(/^0x/i, '').toLowerCase()
}

function identityHexForAssign(value: string): string {
  const normalized = normalizeIdentityHex(value)
  return normalized ? `0x${normalized}` : value.trim()
}

function scalarIdString(value: unknown): string {
  if (value == null) return ''
  return String(value)
}

function isoTimestamp(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1_000_000_000_000 ? Math.floor(value / 1000) : value
    return new Date(ms).toISOString()
  }
  if (value && typeof value === 'object') {
    const micros = pickField<number>(
      value as Record<string, unknown>,
      'microsSinceUnixEpoch',
      'micros_since_unix_epoch',
    )
    if (typeof micros === 'number' && Number.isFinite(micros)) {
      return new Date(Math.floor(micros / 1000)).toISOString()
    }
  }
  return new Date().toISOString()
}

const ROLE_UI_COLORS = ['blue', 'green', 'orange', 'red', 'purple', 'teal'] as const

function defaultRoleColor(id: string): (typeof ROLE_UI_COLORS)[number] {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash + id.charCodeAt(i)) % ROLE_UI_COLORS.length
  }
  return ROLE_UI_COLORS[hash] ?? 'blue'
}

function parseRoleMetadata(metadata: unknown): {
  color?: (typeof ROLE_UI_COLORS)[number]
  uiPermissions?: string[]
} {
  if (typeof metadata !== 'string' || !metadata.trim()) return {}
  try {
    const parsed = JSON.parse(metadata) as { color?: string; uiPermissions?: unknown }
    const out: { color?: (typeof ROLE_UI_COLORS)[number]; uiPermissions?: string[] } = {}
    if (
      parsed.color &&
      (ROLE_UI_COLORS as readonly string[]).includes(parsed.color)
    ) {
      out.color = parsed.color as (typeof ROLE_UI_COLORS)[number]
    }
    if (Array.isArray(parsed.uiPermissions)) {
      out.uiPermissions = parsed.uiPermissions.map((entry) => String(entry))
    }
    return out
  } catch {
    // ignore malformed metadata
  }
  return {}
}

export type SettingsPolicyRule = {
  id: string
  subject: string
  resource: string
  action: string
  effect: 'allow' | 'deny'
}

export type SettingsRoleRecord = {
  id: string
  name: string
  description: string
  isSystem: boolean
  color: (typeof ROLE_UI_COLORS)[number]
  permissions: SettingsPolicyRule[]
  createdAt: string
  updatedAt: string
}

export type SettingsUserRoleAssignment = {
  assignmentId: string
  roleId: string
}

export type SettingsUserRecord = {
  id: string
  userOrgId: string | null
  name: string
  email: string
  department?: string
  status: 'active' | 'inactive' | 'pending'
  roles: string[]
  roleAssignments: SettingsUserRoleAssignment[]
  createdAt: string
  updatedAt: string
}

export function parsePermissionString(
  perm: string,
  roleId: string,
  index: number,
): SettingsPolicyRule {
  if (perm === '*:*') {
    return {
      id: `perm-${roleId}-${index}`,
      subject: roleId,
      resource: '*',
      action: '*',
      effect: 'allow',
    }
  }
  const lastColon = perm.lastIndexOf(':')
  if (lastColon === -1) {
    return {
      id: `perm-${roleId}-${index}`,
      subject: roleId,
      resource: perm,
      action: 'read',
      effect: 'allow',
    }
  }
  return {
    id: `perm-${roleId}-${index}`,
    subject: roleId,
    resource: perm.slice(0, lastColon),
    action: perm.slice(lastColon + 1),
    effect: 'allow',
  }
}

export function permissionsMapToStrings(
  selectedPermissions: Map<string, Set<string>>,
): string[] {
  const out = new Set<string>()
  selectedPermissions.forEach((actions, resource) => {
    actions.forEach((action) => {
      out.add(`${resource}:${action}`)
      for (const equivalent of backendPermissionEquivalents(resource, action)) {
        out.add(equivalent)
      }
    })
  })
  return [...out]
}

function backendPermissionEquivalents(resource: string, action: string): string[] {
  const writeAction = action === 'update' ? 'write' : action

  if (resource === 'admin:roles') {
    if (action === 'manage') return ['role:*']
    return [`role:${writeAction}`]
  }

  if (resource === 'admin:users') {
    if (action === 'create') return ['user_role_assignment:create']
    if (action === 'delete') return ['user_organization:delete', 'user_role_assignment:delete']
    if (action === 'manage') return ['user_organization:*', 'user_role_assignment:*']
    return [`user_organization:${writeAction}`]
  }

  if (resource === 'admin:permissions') {
    if (action === 'manage') return ['org_permission:*', 'casbin_rule:*']
    return [`org_permission:${writeAction}`, `casbin_rule:${writeAction}`]
  }

  if (resource === 'admin:audit-log') {
    return [`audit_log:${writeAction}`]
  }

  if (resource === 'admin:organization') {
    if (action === 'manage') return ['organization:*', 'organization_settings:*']
    return [`organization:${writeAction}`, `organization_settings:${writeAction}`]
  }

  return []
}

export function mapApiRoleRow(row: Record<string, unknown>): SettingsRoleRecord {
  const id = scalarIdString(pickField(row, 'id'))
  const metadata = parseRoleMetadata(pickField(row, 'metadata'))
  const permissionsRaw = pickField<unknown>(row, 'permissions')
  const permissionStrings = Array.isArray(permissionsRaw) && permissionsRaw.length > 0
    ? permissionsRaw.map((entry) => String(entry))
    : metadata.uiPermissions ?? []
  return {
    id,
    name: String(pickField(row, 'name') ?? ''),
    description: String(pickField(row, 'description') ?? ''),
    isSystem: Boolean(pickField(row, 'isSystem', 'is_system') ?? false),
    color: metadata.color ?? defaultRoleColor(id),
    permissions: permissionStrings.map((perm, index) =>
      parsePermissionString(perm, id, index),
    ),
    createdAt: isoTimestamp(pickField(row, 'createdAt', 'created_at')),
    updatedAt: isoTimestamp(pickField(row, 'updatedAt', 'updated_at')),
  }
}

function mapUserStatus(
  profile: Record<string, unknown>,
  membership?: Record<string, unknown>,
): SettingsUserRecord['status'] {
  const profileActive = pickField<boolean>(profile, 'isActive', 'is_active')
  const membershipActive = membership
    ? pickField<boolean>(membership, 'isActive', 'is_active')
    : undefined
  if (profileActive === false || membershipActive === false) return 'inactive'
  const emailVerified = pickField<boolean>(profile, 'emailVerified', 'email_verified')
  if (emailVerified === false) return 'pending'
  return 'active'
}

export function mapSettingsUsers(
  profiles: QueryRows,
  memberships: QueryRows,
  assignments: QueryRows,
): SettingsUserRecord[] {
  const membershipByIdentity = new Map<string, Record<string, unknown>>()
  for (const row of memberships) {
    const identity = normalizeIdentityHex(pickField(row, 'userIdentity', 'user_identity'))
    if (identity) membershipByIdentity.set(identity, row)
  }

  const assignmentsByIdentity = new Map<string, SettingsUserRoleAssignment[]>()
  for (const row of assignments) {
    const identity = normalizeIdentityHex(pickField(row, 'userIdentity', 'user_identity'))
    if (!identity) continue
    const isActive = pickField<boolean>(row, 'isActive', 'is_active')
    if (isActive === false) continue
    const assignmentId = scalarIdString(pickField(row, 'id'))
    const roleId = scalarIdString(pickField(row, 'roleId', 'role_id'))
    if (!assignmentId || !roleId) continue
    const existing = assignmentsByIdentity.get(identity) ?? []
    existing.push({ assignmentId, roleId })
    assignmentsByIdentity.set(identity, existing)
  }

  return profiles.flatMap((profile) => {
    const identity = normalizeIdentityHex(pickField(profile, 'identity'))
    if (!identity) return []
    const membership = membershipByIdentity.get(identity)
    const roleAssignments = assignmentsByIdentity.get(identity) ?? []
    const roles = [...new Set(roleAssignments.map((entry) => entry.roleId))]
    const department = membership
      ? String(pickField(membership, 'jobTitle', 'job_title') ?? '').trim() || undefined
      : undefined
    const userOrgIdRaw = membership ? pickField(membership, 'id') : undefined
    const record: SettingsUserRecord = {
      id: identity,
      userOrgId: userOrgIdRaw != null ? scalarIdString(userOrgIdRaw) : null,
      name: String(pickField(profile, 'name') ?? ''),
      email: String(pickField(profile, 'email') ?? ''),
      department,
      status: mapUserStatus(profile, membership),
      roles,
      roleAssignments,
      createdAt: isoTimestamp(pickField(profile, 'createdAt', 'created_at')),
      updatedAt: isoTimestamp(pickField(profile, 'updatedAt', 'updated_at')),
    }
    return [record]
  })
}

export function useSettingsRoles(organizationId: bigint) {
  return useQuery<SettingsRoleRecord[]>({
    queryKey: ['settings-roles', rqBigIntKey(organizationId)],
    queryFn: async () => {
      const rows = await fetchSettingsList(
        '/api/settings/roles?limit=100',
        'Failed to fetch settings roles',
      )
      return rows.map(mapApiRoleRow)
    },
    enabled: organizationId > 0n,
    staleTime: 30_000,
  })
}

export function useUserRoleAssignments(organizationId: bigint) {
  return useQuery<QueryRows>({
    queryKey: ['user-role-assignments', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/user-role-assignment',
        'Failed to fetch user role assignments',
      ),
    enabled: organizationId > 0n,
    staleTime: 30_000,
  })
}

export function useUserOrganizations(organizationId: bigint) {
  return useQuery<QueryRows>({
    queryKey: ['user-organizations', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/user-organization', 'Failed to fetch user organizations'),
    enabled: organizationId > 0n,
    staleTime: 30_000,
  })
}

export function useSettingsUsers(organizationId: bigint, search?: string) {
  const searchTerm = search?.trim() ?? ''
  return useQuery<SettingsUserRecord[]>({
    queryKey: ['settings-users', rqBigIntKey(organizationId), searchTerm],
    queryFn: async () => {
      const searchQuery = searchTerm
        ? `&search=${encodeURIComponent(searchTerm)}`
        : ''
      const [profiles, memberships, assignments] = await Promise.all([
        fetchSettingsList(
          `/api/settings/users?limit=100${searchQuery}`,
          'Failed to fetch settings users',
        ),
        fetchQueryList('/api/query/user-organization', 'Failed to fetch user organizations'),
        fetchQueryList(
          '/api/query/user-role-assignment',
          'Failed to fetch user role assignments',
        ),
      ])
      return mapSettingsUsers(profiles, memberships, assignments)
    },
    enabled: organizationId > 0n,
    staleTime: 30_000,
  })
}

// ── Mutations — Roles ─────────────────────────────────────────────────────────

export function useCreateRole(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (formData) => {
      const params = {
        name: String(formData.name ?? ''),
        description: formData.description ? String(formData.description) : null,
        parentId: formData.parentId ?? null,
        permissions: Array.isArray(formData.permissions)
          ? formData.permissions.map((entry) => String(entry))
          : [],
        isActive: formData.isActive !== false,
        metadata:
          formData.metadata != null && String(formData.metadata).trim() !== ''
            ? String(formData.metadata)
            : null,
      }
      const { urlPath, init } = authBffPost("create_role", [
        organizationId,
        stdbParamsToJson(params),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create role')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

export function useUpdateRole(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { roleId: string | number | bigint; params: Record<string, unknown> }
  >({
    mutationFn: async ({ roleId, params }) => {
      const { urlPath, init } = authBffPost("update_role", [
        toScalarU64(roleId),
        stdbParamsToJson(params),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update role')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

export type AssignRoleParamsInput = {
  expiresAtMicros: bigint | number | string | null
  metadata: string | null
}

export function useAssignRole(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      userIdentity: string
      roleId: string | number | bigint
      params: AssignRoleParamsInput
    }
  >({
    mutationFn: async ({ userIdentity, roleId, params }) => {
      const { urlPath, init } = authBffPost("assign_role", [
        userIdentity.trim(),
        toScalarU64(roleId),
        organizationId,
        stdbParamsToJson({
          expiresAtMicros:
            params.expiresAtMicros != null && String(params.expiresAtMicros).trim() !== ''
              ? toScalarU64(params.expiresAtMicros as ScalarId)
              : null,
          metadata: params.metadata,
        }),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to assign role')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

export function useRevokeRole(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { assignmentId: string | number | bigint }>({
    mutationFn: async ({ assignmentId }) => {
      const { urlPath, init } = authBffPost("revoke_role", [
        organizationId,
        toScalarU64(assignmentId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to revoke role')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

// ── Mutations — Audit ─────────────────────────────────────────────────────────

export function useCreateAuditRule(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (formData) => {
      const params = {
        name: String(formData.name ?? ''),
        resourceType: String(formData.resourceType ?? ''),
        actionType: String(formData.actionType ?? ''),
        isActive: Boolean(formData.isActive ?? true),
        severity: String(formData.severity ?? 'info'),
      }
      const { urlPath, init } = authBffPost("create_audit_rule", [
        organizationId,
        stdbParamsToJson(params),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create audit rule')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

export function useUpdateAuditRule(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { ruleId: string | number | bigint; params: Record<string, unknown> }
  >({
    mutationFn: async ({ ruleId, params }) => {
      const { urlPath, init } = authBffPost("update_audit_rule", [
        toScalarU64(ruleId),
        stdbParamsToJson(params),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update audit rule')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

/** Mirrors `LogAuditEventParams` — callers supply every field (use `null` / `[]` where the reducer allows none). */
export type LogAuditEventInput = {
  companyId: bigint | number | string | null
  tableName: string
  recordId: ScalarId
  action: string
  oldValues: string | null
  newValues: string | null
  changedFields: string[]
  sessionId: bigint | number | string | null
  ipAddress: string | null
  userAgent: string | null
  metadata: string | null
}

export function useLogAuditEvent(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, LogAuditEventInput>({
    mutationFn: async (params) => {
      const { urlPath, init } = authBffPost("log_audit_event", [
        organizationId,
        stdbParamsToJson({
          companyId:
            params.companyId != null ? toScalarU64(params.companyId as ScalarId) : null,
          tableName: params.tableName,
          recordId: toScalarU64(params.recordId),
          action: params.action,
          oldValues: params.oldValues,
          newValues: params.newValues,
          changedFields: params.changedFields,
          sessionId:
            params.sessionId != null ? toScalarU64(params.sessionId as ScalarId) : null,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          metadata: params.metadata,
        }),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to log audit event')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

// ── Mutations — User Management ───────────────────────────────────────────────

export function useCreateUserInvite(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (formData) => {
      const email = String(formData.email ?? "").trim()
      const roleIdRaw = formData.roleId ?? (formData.roleIds as unknown[])?.[0]
      if (!email) throw new Error("Email is required")
      if (roleIdRaw == null || String(roleIdRaw).trim() === "") {
        throw new Error("roleId is required")
      }
      const roleId = Number(String(roleIdRaw).trim())
      if (!Number.isFinite(roleId) || roleId <= 0) {
        throw new Error("roleId must be a positive number")
      }
      const r = await apiFetch("/api/auth/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          roleId,
          organizationId: Number(organizationId),
        }),
      })
      if (!r.ok) throw new Error('Failed to create user invite')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

/** Pass `targetIdentity` as hex (with or without 0x) and a bcrypt `newPasswordHash` (server-side admin flow). */
export function useUpdateUserPassword(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { targetIdentity: string; newPasswordHash: string }
  >({
    mutationFn: async ({ targetIdentity, newPasswordHash }) => {
      const { urlPath, init } = authBffPost("update_user_password", [
        targetIdentity.trim(),
        newPasswordHash,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update user password')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

export function useUpdateUserProfile(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const { urlPath, init } = authBffPost("update_user_profile", [stdbParamsToJson(params)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update user profile')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

export function useUpdateOrgMemberRole(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      userOrgId: string | number | bigint
      roleName: string
    }
  >({
    mutationFn: async ({ userOrgId, roleName }) => {
      const { urlPath, init } = authBffPost("update_org_member_role", [
        toScalarU64(userOrgId),
        roleName,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update org member role')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

export function useUpdateUserOrganizationStatus(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      userOrgId: string | number | bigint
      isActive: boolean
      isDefault?: boolean
    }
  >({
    mutationFn: async ({ userOrgId, isActive, isDefault = false }) => {
      const { urlPath, init } = authBffPost("update_user_organization_status", [
        toScalarU64(userOrgId),
        isActive,
        isDefault,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update user organization status')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

export function useRemoveUserFromOrganization(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, string | number | bigint>({
    mutationFn: async (userIdentity) => {
      const { urlPath, init } = authBffPost("remove_user_from_organization", [
        identityHexForAssign(String(userIdentity)),
        organizationId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to remove user from organization')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

export function useUpdateOrgMemberDetails(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      userOrgId: string | number | bigint
      params: Record<string, unknown>
    }
  >({
    mutationFn: async ({ userOrgId, params }) => {
      const { urlPath, init } = authBffPost("update_org_member_details", [
        toScalarU64(userOrgId),
        stdbParamsToJson(params),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update org member details')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

export function useUpdateUserEmail(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      email: string
      emailVerified: boolean
    }
  >({
    mutationFn: async ({ email, emailVerified }) => {
      const { urlPath, init } = authBffPost("update_user_email", [email.trim(), emailVerified])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update user email')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

// ── Mutations — User Sessions ────────────────────────────────────────────────

export function useCreateUserSession(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (sessionParams) => {
      const { urlPath, init } = authBffPost("create_user_session", [
        organizationId,
        stdbParamsToJson(sessionParams),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create user session')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

export function useEndUserSession(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, string | number | bigint>({
    mutationFn: async (sessionId) => {
      const { urlPath, init } = authBffPost("end_user_session", [toScalarU64(sessionId)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to end user session')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

// ── Mutations — Privacy & Credentials ────────────────────────────────────────

export type RecordPrivacyConsentInput = {
  contactId: ScalarId
  consentType: string
  granted: boolean
  ipAddress: string | null
  userAgent: string | null
  metadata: string | null
}

export function useRecordPrivacyConsent(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, RecordPrivacyConsentInput>({
    mutationFn: async (params) => {
      const { urlPath, init } = authBffPost("record_privacy_consent", [
        organizationId,
        stdbParamsToJson({
          contactId: toScalarU64(params.contactId),
          consentType: params.consentType,
          granted: params.granted,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          metadata: params.metadata,
        }),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to record privacy consent')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

export function useUpdateGoogleDriveCredentials(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      userId: string | number | bigint
      credentials: Record<string, unknown>
    }
  >({
    mutationFn: async ({ userId, credentials }) => {
      const { urlPath, init } = authBffPost("update_google_drive_credentials", [
        organizationId,
        userId,
        stdbParamsToJson(credentials),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update Google Drive credentials')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

export function useUpdateWhatsappCredentials(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      userId: string | number | bigint
      credentials: Record<string, unknown>
    }
  >({
    mutationFn: async ({ userId, credentials }) => {
      const { urlPath, init } = authBffPost("update_whatsapp_credentials", [
        organizationId,
        userId,
        stdbParamsToJson(credentials),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update WhatsApp credentials')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

// ── Types (re-exported so client components import from one place) ─────────────
export type {
  CreateRoleParams,
  UpdateRoleParams,
  CreateAuditRuleParams,
} from '@lumiere/stdb/types'
export type { CreateUserInviteParams } from '@lumiere/stdb/types'
