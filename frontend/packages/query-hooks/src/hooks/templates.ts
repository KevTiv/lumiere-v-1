"use client"

import {
  documentExportUrl,
  templatesBffPost,
  type DocumentExportFormat,
  type DocumentExportKind,
  type DocumentPdfKind,
} from "@lumiere/stdb/commands/templates-http"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "../http"

export type { DocumentPdfKind, DocumentExportFormat, DocumentExportKind }

async function parseCallError(r: Response): Promise<string> {
  const j = (await r.json().catch(() => ({}))) as { error?: string; detail?: string }
  return j.error ?? j.detail ?? `Request failed (${r.status})`
}

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
      const { urlPath, init } = templatesBffPost("queue_mail_from_template", [
        organizationId,
        companyId,
        {
          template_id: input.templateId,
          model: input.model,
          res_id: input.resId,
          recipient_email: input.recipientEmail,
          context_json: input.contextJson ?? null,
        },
      ])
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
