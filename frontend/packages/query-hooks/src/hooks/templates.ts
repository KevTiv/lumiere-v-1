"use client"


import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { documentExportUrl, type DocumentExportFormat, type DocumentExportKind, type DocumentPdfKind } from "@lumiere/stdb/commands";
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type { CreateDocumentTemplateParams, CreateMailTemplateParams } from "@lumiere/stdb/types"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "../http"

export type { DocumentPdfKind, DocumentExportFormat, DocumentExportKind }

import { responseErrorMessage as parseCallError } from "@lumiere/api-client/response-error"

export type DocumentTemplateRow = {
  id: number | string
  name?: string
  model?: string
  reportType?: string
  report_type?: string
  isActive?: boolean
  is_active?: boolean
}

export type MailTemplateRow = {
  id: number | string
  name?: string
  model?: string
  subject?: string
  isActive?: boolean
  is_active?: boolean
}

export function useDocumentTemplates(organizationId: number, enabled = true) {
  return useQuery({
    queryKey: ["document-templates", String(organizationId)],
    queryFn: async () => {
      const r = await apiFetch("/api/query/document-templates")
      if (!r.ok) throw new Error(await parseCallError(r))
      const j = (await r.json()) as { data?: DocumentTemplateRow[] }
      return j.data ?? []
    },
    enabled: enabled && organizationId > 0,
  })
}

export function useMailTemplates(organizationId: number, enabled = true) {
  return useQuery({
    queryKey: ["mail-templates", String(organizationId)],
    queryFn: async () => {
      const r = await apiFetch("/api/query/mail-templates")
      if (!r.ok) throw new Error(await parseCallError(r))
      const j = (await r.json()) as { data?: MailTemplateRow[] }
      return j.data ?? []
    },
    enabled: enabled && organizationId > 0,
  })
}

export function useCreateDocumentTemplate(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Partial<CreateDocumentTemplateParams>) => {
      const { urlPath, init } = stdbBffCommandPost("create_document_template", { companyId: null, params: stdbParamsToJson(params, "CreateDocumentTemplateParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["document-templates", String(organizationId)] })
    },
  })
}

export function useCreateMailTemplate(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Partial<CreateMailTemplateParams>) => {
      const { urlPath, init } = stdbBffCommandPost("create_mail_template", { companyId: null, params: stdbParamsToJson(params, "CreateMailTemplateParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["mail-templates", String(organizationId)] })
    },
  })
}

export function useQueueMailFromTemplate(organizationId: number, companyId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      templateId: number
      model: string
      resId: number
      recipientEmail: string
      contextJson?: string | null
    }) => {
      const { urlPath, init } = stdbBffCommandPost("queue_mail_from_template", { companyId: companyId, params: {
          template_id: input.templateId,
          model: input.model,
          res_id: input.resId,
          recipient_email: input.recipientEmail,
          context_json: input.contextJson ?? null,
        } })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["mail-messages"] })
    },
  })
}

export function useDispatchQueuedMail() {
  return useMutation({
    mutationFn: async () => {
      const r = await apiFetch("/api/mail/dispatch-queued", { method: "POST" })
      if (!r.ok) throw new Error(await parseCallError(r))
      return (await r.json()) as { sent?: number; skipped?: number; errors?: string[] }
    },
  })
}

export async function downloadDocumentPdf(
  kind: DocumentPdfKind,
  id: number,
  filename?: string,
): Promise<void> {
  await downloadDocumentExport("pdf", kind, id, filename)
}

/** Fetch a rendered PDF as a Blob (for DMS archive) without forcing a browser download. */
export async function fetchDocumentPdfBlob(
  kind: DocumentPdfKind,
  id: number,
): Promise<Blob> {
  const r = await apiFetch(documentExportUrl("pdf", kind, id))
  if (!r.ok) throw new Error(await parseCallError(r))
  return r.blob()
}

export async function downloadDocumentExport(
  format: DocumentExportFormat,
  kind: DocumentExportKind,
  id: number,
  filename?: string,
): Promise<void> {
  const r = await apiFetch(documentExportUrl(format, kind, id))
  if (!r.ok) throw new Error(await parseCallError(r))
  const blob = await r.blob()
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = objectUrl
  const ext = format === "pdf" ? "pdf" : format
  anchor.download = filename ?? `${kind.replace(/-/g, "_")}_${id}.${ext}`
  anchor.click()
  URL.revokeObjectURL(objectUrl)
}

export async function downloadPivotTableXlsx(
  title: string,
  headers: string[],
  rows: (string | number)[][],
  filename?: string,
): Promise<void> {
  const r = await apiFetch("/api/documents/xlsx/pivot-table", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, headers, rows }),
  })
  if (!r.ok) throw new Error(await parseCallError(r))
  const blob = await r.blob()
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = objectUrl
  anchor.download = filename ?? `${title.replace(/\s+/g, "_").toLowerCase()}.xlsx`
  anchor.click()
  URL.revokeObjectURL(objectUrl)
}
