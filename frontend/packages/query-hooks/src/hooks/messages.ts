"use client"

/**
 * Messages hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Messages module.
 */


import { stringifyReducerCallBody } from "@lumiere/api-client"
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"

function toScalarU64(v: bigint | number | string): bigint {
  return typeof v === "bigint" ? v : BigInt(String(v))
}

export type PostMessageInput = {
  model: string
  resId: bigint | number | string
  body: string
  parentId: bigint | number | string | null
  attachmentIds: (bigint | number | string)[]
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export function useMailMessages(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['mail-messages', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/mail-messages', 'Failed to fetch messages'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function usePostMessage(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, PostMessageInput>({
    mutationFn: async ({ model, resId, body, parentId, attachmentIds }) => {
      const r = await apiFetch('/api/call/post_message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          model,
          toScalarU64(resId),
          body,
          parentId != null ? toScalarU64(parentId) : null,
          attachmentIds.map((id) => toScalarU64(id)),
        ]),
      })
      if (!r.ok) throw new Error('Failed to post message')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mail-messages', rqBigIntKey(organizationId)] }),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type { PostMessageParams } from "@lumiere/stdb/generated/types/reducers"
