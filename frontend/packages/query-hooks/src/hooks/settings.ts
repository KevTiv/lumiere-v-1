"use client"


import { stringifyReducerCallBody } from "@lumiere/api-client"
import { apiFetch } from "../http"
/**
 * Settings hooks — Organization and system configuration
 *
 * Wraps REST API calls with React Query for the Settings module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'

// ── Organization Mutations ─────────────────────────────────────────────────

export function useUpsertOrganizationSettings(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (settings) => {
      const r = await apiFetch('/api/call/upsert_organization_settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, settings]),
      })
      if (!r.ok) throw new Error('Failed to save organization settings')
    },
    onSuccess: () => {
      // Invalidate any queries that might depend on organization settings
      qc.invalidateQueries({ queryKey: ['organization-settings', organizationId] })
    },
  })
}

export function useUpdateOrganization(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/update_organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, params]),
      })
      if (!r.ok) throw new Error('Failed to update organization')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organization', organizationId] })
    },
  })
}

export function useCreateOrganization() {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([params]),
      })
      if (!r.ok) throw new Error('Failed to create organization')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organizations'] })
    },
  })
}
