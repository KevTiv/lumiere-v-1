"use client"


import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import type { UpdateAiReducerAllowlistParams } from "@lumiere/stdb/types"
import { toCreateAiReducerAllowlistParams } from "@lumiere/erp-shared/settings-create-params"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "../http"

import { responseErrorMessage as parseCallError } from "@lumiere/api-client/response-error"

export function aiReducerAllowlistQueryKey(organizationId: number) {
  return ["ai-reducer-allowlist", String(organizationId)] as const
}

export function useAiReducerAllowlist(organizationId: number, enabled: boolean) {
  return useQuery({
    queryKey: aiReducerAllowlistQueryKey(organizationId),
    queryFn: async () => {
      const r = await apiFetch("/api/query/ai-reducer-allowlist")
      if (!r.ok) throw new Error(await parseCallError(r))
      const j = (await r.json()) as { data?: Record<string, unknown>[] }
      return j.data ?? []
    },
    enabled: enabled && organizationId > 0,
    staleTime: 30_000,
  })
}

function invalidateAllowlist(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: number,
) {
  void qc.invalidateQueries({ queryKey: aiReducerAllowlistQueryKey(organizationId) })
}

export function useCreateAiReducerAllowlist(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (formData: Record<string, unknown>) => {
      const params = toCreateAiReducerAllowlistParams(formData)
      if (!params) throw new Error("Invalid allowlist form data")
      const { urlPath, init } = stdbBffCommandPost("create_ai_reducer_allowlist", { params: stdbParamsToJson(params, "CreateAiReducerAllowlistParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAllowlist(qc, organizationId),
  })
}

export function useUpdateAiReducerAllowlist(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      allowlistId: number
      params: UpdateAiReducerAllowlistParams
    }) => {
      const { urlPath, init } = stdbBffCommandPost("update_ai_reducer_allowlist", { allowlistId: args.allowlistId, params: stdbParamsToJson(args.params, "UpdateAiReducerAllowlistParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAllowlist(qc, organizationId),
  })
}

export function useDeleteAiReducerAllowlist(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (allowlistId: number) => {
      const { urlPath, init } = stdbBffCommandPost("delete_ai_reducer_allowlist", { allowlistId: allowlistId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAllowlist(qc, organizationId),
  })
}

export function useSetAiReducerAllowlistEnabled(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { allowlistId: number; enabled: boolean }) => {
      const { urlPath, init } = stdbBffCommandPost("set_ai_reducer_allowlist_enabled", { allowlistId: args.allowlistId, enabled: args.enabled })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAllowlist(qc, organizationId),
  })
}
