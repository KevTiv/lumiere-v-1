"use client"


import { stdbBffCommandPost, type StdbBffCommandInput } from "@lumiere/stdb/commands"
import { documentExportUrl, type DocumentExportFormat, type DocumentExportKind, type DocumentPdfKind } from "@lumiere/stdb/commands";
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type { CreateDocumentTemplateParams, CreateMailTemplateParams, UpdateDocumentTemplateParams } from "@lumiere/stdb/types"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "../http"

export type { DocumentPdfKind, DocumentExportFormat, DocumentExportKind }

import { responseErrorMessage as parseCallError } from "@lumiere/api-client/response-error"

export type DocumentTemplateRow = {
  id: number | string
  organizationId?: number | string
  organization_id?: number | string
  companyId?: number | string | null
  company_id?: number | string | null
  name?: string
  model?: string
  reportType?: string
  report_type?: string
  bodyHtml?: string
  body_html?: string
  metadata?: string | null
  isDefault?: boolean
  is_default?: boolean
  isActive?: boolean
  is_active?: boolean
}

type TemplateScopeId = number | string | bigint

export type DocumentTemplatesScope = {
  identity?: string | null
  companyId?: TemplateScopeId | null
}

function templateScopeId(value: unknown): string | null {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value <= 0)) return null
  if (typeof value !== "number" && typeof value !== "string" && typeof value !== "bigint") return null
  const text = String(value)
  if (!/^[1-9]\d{0,19}$/.test(text)) return null
  return BigInt(text) <= 18446744073709551615n ? text : null
}

function validTemplateScope(scope: DocumentTemplatesScope): boolean {
  return typeof scope.identity === "string" && scope.identity !== "unknown" && scope.identity.length > 0 && scope.identity.trim() === scope.identity &&
    (scope.companyId === null || templateScopeId(scope.companyId) !== null)
}

/** Preserve the legacy invalidation prefix while separating signed-in company contexts. */
export function documentTemplatesQueryKey(organizationId: number, scope?: DocumentTemplatesScope) {
  const prefix = ["document-templates", String(organizationId)] as const
  return scope === undefined ? prefix : [...prefix, {
    identity: scope.identity ?? null,
    companyId: scope.companyId === null ? null : templateScopeId(scope.companyId) ?? "invalid",
  }] as const
}

export function documentTemplatesQueryPath(scope?: DocumentTemplatesScope): string {
  if (scope === undefined) return "/api/query/document-templates"
  if (!validTemplateScope(scope)) throw new Error("The template company is no longer available.")
  if (scope.companyId === null) return "/api/query/document-templates"
  const companyId = templateScopeId(scope.companyId)
  if (companyId === null) throw new Error("The template company is no longer available.")
  return `/api/query/document-templates?companyId=${companyId}`
}

/** Organization defaults and the active company's templates are visible; absent scope fails closed. */
export function documentTemplateMatchesScope(
  row: DocumentTemplateRow,
  organizationId: TemplateScopeId,
  companyId: TemplateScopeId | null | undefined,
): boolean {
  if (!row || typeof row !== "object") return false
  const organization = templateScopeId(organizationId)
  if (organization === null || (companyId !== null && templateScopeId(companyId) === null)) return false
  if (templateScopeId(row.organizationId ?? row.organization_id) !== organization) return false
  const rowCompany = row.companyId !== undefined ? row.companyId : row.company_id
  if (rowCompany === null) return true
  const normalizedRowCompany = templateScopeId(rowCompany)
  return normalizedRowCompany !== null && normalizedRowCompany === templateScopeId(companyId)
}

export type MailTemplateRow = {
  id: number | string
  name?: string
  model?: string
  subject?: string
  isActive?: boolean
  is_active?: boolean
}

export function useDocumentTemplates(organizationId: number, enabled = true, scope?: DocumentTemplatesScope) {
  return useQuery({
    queryKey: documentTemplatesQueryKey(organizationId, scope),
    queryFn: async ({ signal }) => {
      if (scope !== undefined && (!validTemplateScope(scope) || templateScopeId(organizationId) === null)) return []
      const r = await apiFetch(documentTemplatesQueryPath(scope), { signal })
      if (!r.ok) throw new Error(await parseCallError(r))
      const j = (await r.json()) as { data?: DocumentTemplateRow[] }
      const rows = j.data ?? []
      return scope === undefined ? rows : rows.filter((row) => documentTemplateMatchesScope(row, organizationId, scope.companyId))
    },
    enabled: enabled && templateScopeId(organizationId) !== null && (scope === undefined || validTemplateScope(scope)),
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

/** One canonical builder shared by ordinary templates and append-only invoice profile versions. */
export function documentTemplateCreateRequest(
  params: Partial<CreateDocumentTemplateParams>,
  companyId: StdbBffCommandInput<"create_document_template">["companyId"] = null,
) {
  return stdbBffCommandPost("create_document_template", { companyId, params: stdbParamsToJson(params, "CreateDocumentTemplateParams") })
}

export function useCreateDocumentTemplate(
  organizationId: number,
  companyId: StdbBffCommandInput<"create_document_template">["companyId"] = null,
  scope?: DocumentTemplatesScope,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Partial<CreateDocumentTemplateParams>) => {
      if (scope !== undefined && (!validTemplateScope(scope) || templateScopeId(organizationId) === null ||
        (companyId === null ? scope.companyId !== null : templateScopeId(companyId) !== templateScopeId(scope.companyId)))) {
        throw new Error("The template's organization or company is no longer available.")
      }
      const { urlPath, init } = documentTemplateCreateRequest(params, companyId)
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["document-templates", String(organizationId)] })
    },
  })
}

export type UpdateDocumentTemplateInput = {
  templateId: TemplateScopeId
  /** The saved row's company: explicit null keeps an organization-wide template global. */
  companyId: TemplateScopeId | null
  params: Partial<UpdateDocumentTemplateParams>
}

/** Validate the current editor scope before building the canonical named operation request. */
export function documentTemplateUpdateRequest(
  organizationId: number,
  scope: DocumentTemplatesScope,
  input: UpdateDocumentTemplateInput,
) {
  const templateId = templateScopeId(input.templateId)
  const companyId = input.companyId === null ? null : templateScopeId(input.companyId)
  if (!validTemplateScope(scope) || templateScopeId(organizationId) === null || templateId === null ||
    (input.companyId !== null && (companyId === null || companyId !== templateScopeId(scope.companyId)))) {
    throw new Error("The template's organization or company is no longer available.")
  }
  return stdbBffCommandPost("update_document_template", {
    templateId: BigInt(templateId),
    companyId: companyId === null ? null : BigInt(companyId),
    params: stdbParamsToJson(input.params, "UpdateDocumentTemplateParams"),
  })
}

export function useUpdateDocumentTemplate(organizationId: number, scope: DocumentTemplatesScope) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateDocumentTemplateInput) => {
      const { urlPath, init } = documentTemplateUpdateRequest(organizationId, scope, input)
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
