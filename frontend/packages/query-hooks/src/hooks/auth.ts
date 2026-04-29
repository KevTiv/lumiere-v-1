"use client"

/**
 * Auth hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Auth module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { stringifyReducerCallBody } from "@lumiere/api-client"
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
  const org = organizationId
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['audit-log', org] }),
    qc.invalidateQueries({ queryKey: ['audit-rules', org] }),
    qc.invalidateQueries({ queryKey: ['user-sessions', org] }),
    qc.invalidateQueries({ queryKey: ['user-invites', org] }),
  ])
}

// ── Mutations — Roles ─────────────────────────────────────────────────────────

export function useCreateRole(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (formData) => {
      const params = {
        name: String(formData.name ?? ''),
        description: formData.description ? String(formData.description) : null,
        permissions: formData.permissions || [],
      }
      const r = await apiFetch('/api/call/create_role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, stdbParamsToJson(params)]),
      })
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
      const r = await apiFetch('/api/call/update_role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([toScalarU64(roleId), stdbParamsToJson(params)]),
      })
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
      const r = await apiFetch('/api/call/assign_role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
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
        ]),
      })
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
      const r = await apiFetch('/api/call/revoke_role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, toScalarU64(assignmentId)]),
      })
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
      const r = await apiFetch('/api/call/create_audit_rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, stdbParamsToJson(params)]),
      })
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
      const r = await apiFetch('/api/call/update_audit_rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([toScalarU64(ruleId), stdbParamsToJson(params)]),
      })
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
      const r = await apiFetch('/api/call/log_audit_event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
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
        ]),
      })
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
      const r = await apiFetch('/api/call/update_user_password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([targetIdentity.trim(), newPasswordHash]),
      })
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
      const r = await apiFetch('/api/call/update_user_profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([stdbParamsToJson(params)]),
      })
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
      const r = await apiFetch('/api/call/update_org_member_role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([toScalarU64(userOrgId), roleName]),
      })
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
      userId: string | number | bigint
      status: 'active' | 'inactive' | 'suspended'
    }
  >({
    mutationFn: async ({ userId, status }) => {
      const r = await apiFetch('/api/call/update_user_organization_status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, userId, status]),
      })
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
    mutationFn: async (userId) => {
      const r = await apiFetch('/api/call/remove_user_from_organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, userId]),
      })
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
      const r = await apiFetch('/api/call/update_org_member_details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([toScalarU64(userOrgId), stdbParamsToJson(params)]),
      })
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
      const r = await apiFetch('/api/call/update_user_email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([email.trim(), emailVerified]),
      })
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
      const r = await apiFetch('/api/call/create_user_session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          stdbParamsToJson(sessionParams),
        ]),
      })
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
      const r = await apiFetch('/api/call/end_user_session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([toScalarU64(sessionId)]),
      })
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
      const r = await apiFetch('/api/call/record_privacy_consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          stdbParamsToJson({
            contactId: toScalarU64(params.contactId),
            consentType: params.consentType,
            granted: params.granted,
            ipAddress: params.ipAddress,
            userAgent: params.userAgent,
            metadata: params.metadata,
          }),
        ]),
      })
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
      const r = await apiFetch('/api/call/update_google_drive_credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, userId, stdbParamsToJson(credentials)]),
      })
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
      const r = await apiFetch('/api/call/update_whatsapp_credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, userId, stdbParamsToJson(credentials)]),
      })
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
} from '@lumiere/stdb/generated/types'
export type { CreateUserInviteParams } from '@lumiere/stdb/generated/types/reducers'
