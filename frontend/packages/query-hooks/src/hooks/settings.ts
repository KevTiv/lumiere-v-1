"use client"



import { stdbBffCommandPost } from "@lumiere/stdb/commands";
import { apiFetch, rqBigIntKey } from "../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
/**
 * Settings hooks — Organization and system configuration
 *
 * Wraps REST API calls with React Query for the Settings module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

// ── Organization Mutations ─────────────────────────────────────────────────

export function useUpsertOrganizationSettings(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (settings) => {
      const { urlPath, init } = stdbBffCommandPost("upsert_organization_settings", { params: stdbParamsToJson(settings as object) })
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
      const { urlPath, init } = stdbBffCommandPost("update_organization", { params: stdbParamsToJson(params as object) })
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
      const { urlPath, init } = stdbBffCommandPost("create_organization", { params: stdbParamsToJson(params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create organization')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organizations'] })
    },
  })
}

// ── Reference data (superuser) ───────────────────────────────────────────────

/** Active global currencies, also available before a user creates their tenant. */
export function useCurrencies() {
  return useQuery<Record<string, unknown>[]>({
    queryKey: ['currencies'],
    queryFn: async () => {
      const response = await apiFetch('/api/bootstrap/currencies')
      if (!response.ok) throw new Error('Failed to load currencies')
      const payload = (await response.json()) as { data?: Record<string, unknown>[] }
      return payload.data ?? []
    },
    staleTime: 5 * 60_000,
  })
}

export function useCreateCountry() {
  const qc = useQueryClient()
  return useMutation<void, Error, { code: string; params: Record<string, unknown> }>({
    mutationFn: async ({ code, params }) => {
      const { urlPath, init } = stdbBffCommandPost('create_country', {
        code: code.trim(),
        params: stdbParamsToJson(params),
      })
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
      const { urlPath, init } = stdbBffCommandPost('create_currency', {
        code: code.trim(),
        params: stdbParamsToJson(params),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create currency')
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['currencies'] })
    },
  })
}
