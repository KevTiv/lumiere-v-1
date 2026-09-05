"use client"


import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { scalarToU64 as toScalarU64 } from "@lumiere/erp-shared/u64"
import type { CreateInvoiceReminderBatchParams, CreateMessageBatchParams, CreateMessageTemplateParams, MailFollower, MailMessage, ReviewMessageBatchParams } from "@lumiere/stdb/types"
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, rqBigIntKey } from "../http"
import { useStdbQuery } from "./stdb"

export type PostMessageInput = {
  model: string
  resId: bigint | number | string
  body: string
  messageType?: string
  subtype?: string | null
  parentId: bigint | number | string | null
  attachmentIds: (bigint | number | string)[]
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export function useMailMessages(
  organizationId: bigint,
  initialData?: MailMessage[],
) {
  return useQuery({
    queryKey: ['mail-messages', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/mail-messages', 'Failed to fetch messages'),
    staleTime: 30_000,
    initialData,
  })
}

export function useMessageTemplates(organizationId: bigint) {
  return useStdbQuery("message-templates", organizationId)
}

export function useOperationalMessages(organizationId: bigint) {
  return useStdbQuery("operational-messages", organizationId)
}

export function useMessageBatches(organizationId: bigint) {
  return useStdbQuery("message-batches", organizationId)
}

function invalidateOperationalMessages(qc: ReturnType<typeof useQueryClient>, organizationId: bigint) {
  for (const resource of ["message-templates", "operational-messages", "message-batches", "contact-communication-preferences"]) {
    qc.invalidateQueries({ queryKey: ["stdb", resource, String(organizationId)] })
  }
}

export function useCreateMessageBatch(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateMessageBatchParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_message_batch", { params: stdbParamsToJson(params, "CreateMessageBatchParams") })
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await response.text() || "Unable to create message batch")
    },
    onSuccess: () => invalidateOperationalMessages(qc, organizationId),
  })
}

export function useCreateInvoiceReminderBatch(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateInvoiceReminderBatchParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_invoice_reminder_batch", { params: stdbParamsToJson(params, "CreateInvoiceReminderBatchParams") })
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await response.text() || "Unable to create invoice reminder batch")
    },
    onSuccess: () => invalidateOperationalMessages(qc, organizationId),
  })
}

export function useCreateMessageTemplate(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateMessageTemplateParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_message_template", { params: stdbParamsToJson(params, "CreateMessageTemplateParams") })
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await response.text() || "Unable to create message template")
    },
    onSuccess: () => invalidateOperationalMessages(qc, organizationId),
  })
}

export function useReviewMessageBatch(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { batchId: bigint; params: ReviewMessageBatchParams }>({
    mutationFn: async ({ batchId, params }) => {
      const { urlPath, init } = stdbBffCommandPost("review_message_batch", { batchId: batchId, params: stdbParamsToJson(params, "ReviewMessageBatchParams") })
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await response.text() || "Unable to review message batch")
    },
    onSuccess: () => invalidateOperationalMessages(qc, organizationId),
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function usePostMessage(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, PostMessageInput>({
    mutationFn: async ({ model, resId, body, parentId, attachmentIds }) => {
      const { urlPath, init } = stdbBffCommandPost("post_message", { model: model, resId: toScalarU64(resId), body: body, parentId: parentId != null ? toScalarU64(parentId) : null, attachmentIds: attachmentIds.map((id) => toScalarU64(id)) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to post message')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mail-messages', rqBigIntKey(organizationId)] }),
  })
}

export function useMailFollowers(
  organizationId: bigint,
  initialData?: MailFollower[],
) {
  return useQuery({
    queryKey: ['mail-followers', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/mail-followers', 'Failed to fetch followers'),
    staleTime: 30_000,
    initialData,
  })
}

export function useSubscribeToRecord(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { resModel: string; resId: bigint | number | string; subtypes: string[] }
  >({
    mutationFn: async ({ resModel, resId, subtypes }) => {
      const { urlPath, init } = stdbBffCommandPost("subscribe_to_record", { resModel: resModel, resId: toScalarU64(resId), subtypes: subtypes })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to subscribe to record')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mail-followers', rqBigIntKey(organizationId)] }),
  })
}

export function useUnsubscribeFromRecord(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { resModel: string; resId: bigint | number | string }>({
    mutationFn: async ({ resModel, resId }) => {
      const { urlPath, init } = stdbBffCommandPost("unsubscribe_from_record", { resModel: resModel, resId: toScalarU64(resId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to unsubscribe from record')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mail-followers', rqBigIntKey(organizationId)] }),
  })
}

export function usePostInternalNote(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { model: string; resId: bigint | number | string; body: string }
  >({
    mutationFn: async ({ model, resId, body }) => {
      const { urlPath, init } = stdbBffCommandPost("post_internal_note", { model: model, resId: toScalarU64(resId), body: body })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to post internal note')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mail-messages', rqBigIntKey(organizationId)] }),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type { PostMessageParams, MailMessage, MailFollower } from "@lumiere/stdb/types"
