"use client"


import { settingsBffPost, stdbBffPost } from "@lumiere/stdb/commands"
import { apiFetch, rqBigIntKey } from "../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
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
      const { urlPath, init } = settingsBffPost('upsert_organization_settings', [
        organizationId,
        stdbParamsToJson(settings as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to save organization settings')
    },
    onSuccess: () => {
      // Invalidate any queries that might depend on organization settings
      qc.invalidateQueries({ queryKey: ['organization-settings', rqBigIntKey(organizationId)] })
    },
  })
}

export function useUpdateOrganization(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const { urlPath, init } = settingsBffPost('update_organization', [
        organizationId,
        stdbParamsToJson(params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update organization')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organization', rqBigIntKey(organizationId)] })
    },
  })
}

export function useCreateOrganization() {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const { urlPath, init } = settingsBffPost('create_organization', [
        stdbParamsToJson(params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create organization')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organizations'] })
    },
  })
}

// ── Reference data (superuser) ───────────────────────────────────────────────

export function useCreateCountry() {
  const qc = useQueryClient()
  return useMutation<void, Error, { code: string; params: Record<string, unknown> }>({
    mutationFn: async ({ code, params }) => {
      const { urlPath, init } = stdbBffPost('create_country', [code.trim(), stdbParamsToJson(params)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create country')
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['countries'] })
    },
  })
}

export function useCreateCurrency() {
  const qc = useQueryClient()
  return useMutation<void, Error, { code: string; params: Record<string, unknown> }>({
    mutationFn: async ({ code, params }) => {
      const { urlPath, init } = stdbBffPost('create_currency', [code.trim(), stdbParamsToJson(params)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create currency')
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['currencies'] })
    },
  })
}
