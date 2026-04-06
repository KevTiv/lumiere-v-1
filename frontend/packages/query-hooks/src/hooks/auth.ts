"use client"

/**
 * Auth hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Auth module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows } from "../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

// ── Reads ────────────────────────────────────────────────────────────────────

export function useAuditLog(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['audit-log', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/audit-log', 'Failed to fetch audit log'),
    staleTime: 30_000,
    initialData,
  })
}

export function useAuditRules(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['audit-rules', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/audit-rules', 'Failed to fetch audit rules'),
    staleTime: 30_000,
    initialData,
  })
}

export function useUserSessions(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['user-sessions', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/user-sessions', 'Failed to fetch user sessions'),
    staleTime: 30_000,
    initialData,
  })
}

export function useUserInvites(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['user-invites', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/user-invites', 'Failed to fetch user invites'),
    staleTime: 30_000,
    initialData,
  })
}

function invalidateAuthModule(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: bigint,
) {
  const org = organizationId.toString()
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
        body: JSON.stringify([organizationId.toString(), stdbParamsToJson(params)]),
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
        body: JSON.stringify([organizationId.toString(), String(roleId), stdbParamsToJson(params)]),
      })
      if (!r.ok) throw new Error('Failed to update role')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

export function useAssignRole(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { userId: string | number | bigint; roleId: string | number | bigint }
  >({
    mutationFn: async ({ userId, roleId }) => {
      const r = await apiFetch('/api/call/assign_role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), String(userId), String(roleId)]),
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
  return useMutation<
    void,
    Error,
    { userId: string | number | bigint; roleId: string | number | bigint }
  >({
    mutationFn: async ({ userId, roleId }) => {
      const r = await apiFetch('/api/call/revoke_role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), String(userId), String(roleId)]),
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
        body: JSON.stringify([organizationId.toString(), stdbParamsToJson(params)]),
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
        body: JSON.stringify([organizationId.toString(), String(ruleId), stdbParamsToJson(params)]),
      })
      if (!r.ok) throw new Error('Failed to update audit rule')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

export function useLogAuditEvent(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      resourceType: string
      resourceId: string | number | bigint
      action: string
      details?: Record<string, unknown>
    }
  >({
    mutationFn: async ({ resourceType, resourceId, action, details }) => {
      const r = await apiFetch('/api/call/log_audit_event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          resourceType,
          String(resourceId),
          action,
          details ? stdbParamsToJson(details) : null,
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
      const params = {
        email: String(formData.email ?? ''),
        roleIds: formData.roleIds || [],
        expiresInDays: Number(formData.expiresInDays ?? 7),
      }
      const r = await apiFetch('/api/call/create_user_invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), stdbParamsToJson(params)]),
      })
      if (!r.ok) throw new Error('Failed to create user invite')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

export function useUpdateUserPassword(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      userId: string | number | bigint
      newPassword: string
      requireReset?: boolean
    }
  >({
    mutationFn: async ({ userId, newPassword, requireReset = false }) => {
      const r = await apiFetch('/api/call/update_user_password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          String(userId),
          newPassword,
          requireReset,
        ]),
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
  return useMutation<
    void,
    Error,
    {
      userId: string | number | bigint
      params: Record<string, unknown>
    }
  >({
    mutationFn: async ({ userId, params }) => {
      const r = await apiFetch('/api/call/update_user_profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), String(userId), stdbParamsToJson(params)]),
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
      userId: string | number | bigint
      newRole: string
    }
  >({
    mutationFn: async ({ userId, newRole }) => {
      const r = await apiFetch('/api/call/update_org_member_role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), String(userId), newRole]),
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
        body: JSON.stringify([organizationId.toString(), String(userId), status]),
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
        body: JSON.stringify([organizationId.toString(), String(userId)]),
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
      userId: string | number | bigint
      params: Record<string, unknown>
    }
  >({
    mutationFn: async ({ userId, params }) => {
      const r = await apiFetch('/api/call/update_org_member_details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), String(userId), stdbParamsToJson(params)]),
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
      userId: string | number | bigint
      newEmail: string
    }
  >({
    mutationFn: async ({ userId, newEmail }) => {
      const r = await apiFetch('/api/call/update_user_email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), String(userId), newEmail]),
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
  return useMutation<
    void,
    Error,
    {
      userId: string | number | bigint
      sessionData?: Record<string, unknown>
    }
  >({
    mutationFn: async ({ userId, sessionData }) => {
      const r = await apiFetch('/api/call/create_user_session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          String(userId),
          sessionData ? stdbParamsToJson(sessionData) : null,
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
        body: JSON.stringify([organizationId.toString(), String(sessionId)]),
      })
      if (!r.ok) throw new Error('Failed to end user session')
    },
    onSuccess: async () => {
      await invalidateAuthModule(qc, organizationId)
    },
  })
}

// ── Mutations — Privacy & Credentials ────────────────────────────────────────

export function useRecordPrivacyConsent(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      userId: string | number | bigint
      consentType: string
      consented: boolean
    }
  >({
    mutationFn: async ({ userId, consentType, consented }) => {
      const r = await apiFetch('/api/call/record_privacy_consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), String(userId), consentType, consented]),
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
        body: JSON.stringify([organizationId.toString(), String(userId), stdbParamsToJson(credentials)]),
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
        body: JSON.stringify([organizationId.toString(), String(userId), stdbParamsToJson(credentials)]),
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
