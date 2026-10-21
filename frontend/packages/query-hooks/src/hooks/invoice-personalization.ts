"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  INVOICE_PROFILE_MODEL, INVOICE_PROFILE_REPORT_TYPE, invoiceProfileId,
  resolveInvoiceProfile, selectInvoiceProfileVersions, validateInvoiceProfileValues,
  type InvoicePersonalizationProfile, type InvoiceProfileRow, type InvoiceProfileValues,
  type InvoiceProfileVersion, type InvoiceProfileVersionIds,
} from "@lumiere/erp-shared/invoice-personalization"
import { apiFetch } from "../http"
import { documentTemplateCreateRequest } from "./templates"

export type InvoicePersonalizationState = { status: "ready" | "loading" | "error" | "denied"; message?: string; onRetry?: () => void }
export interface InvoiceProfileSaveInput {
  organizationId: string | number
  companyId: string | null
  expectedVersionId: string | null
  values: InvoiceProfileValues
}
export interface InvoiceProfileSubmission extends InvoiceProfileSaveInput { name: string }
export type InvoiceProfileSaveOutcome =
  | { status: "saved"; submission: InvoiceProfileSubmission; version: InvoiceProfileVersion; isCurrent: boolean }
  | { status: "unconfirmed"; submission: InvoiceProfileSubmission; message: string }
export class InvoicePersonalizationError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = "InvoicePersonalizationError" }
}
type Fetcher = (path: string, init?: RequestInit) => Promise<Response>

function profileValuesEqual(left: InvoiceProfileValues, right: InvoiceProfileValues): boolean {
  return JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort())
}

async function responseError(response: Response): Promise<InvoicePersonalizationError> {
  const body: unknown = await response.json().catch(() => null)
  const message = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : `Invoice profile request failed (${response.status})`
  return new InvoicePersonalizationError(message, response.status)
}

/** Read complete template rows, including scope and metadata; malformed payloads fail closed. */
export async function fetchInvoiceProfileRows(fetcher: Fetcher = apiFetch): Promise<InvoiceProfileRow[]> {
  const response = await fetcher("/api/query/document-templates")
  if (!response.ok) throw await responseError(response)
  const body: unknown = await response.json()
  if (!body || typeof body !== "object" || !("data" in body) || !Array.isArray(body.data) || body.data.some((row) => !row || typeof row !== "object" || Array.isArray(row) || !("id" in row))) throw new InvoicePersonalizationError("Invoice profile data is malformed")
  return body.data as InvoiceProfileRow[]
}

/** Read-only reconciliation of the exact append attempt. Never retries the create command. */
export async function checkInvoiceProfileSubmission(submission: InvoiceProfileSubmission, fetcher: Fetcher = apiFetch): Promise<InvoiceProfileSaveOutcome> {
  try {
    const rows = await fetchInvoiceProfileRows(fetcher)
    const matching = rows.filter((row) => row.name === submission.name)
    const exact = selectInvoiceProfileVersions(matching, submission.organizationId, submission.companyId)
    if (exact.status !== "valid") throw new InvoicePersonalizationError(exact.status === "invalid" ? exact.error : "Invoice profile readback is missing")
    const version = submission.companyId === null ? exact.value.organization : exact.value.company
    if (!version || !profileValuesEqual(version.values, submission.values)) return { status: "unconfirmed", submission, message: "This profile version is not confirmed. Check the saved version before starting another save." }
    const latest = selectInvoiceProfileVersions(rows, submission.organizationId, submission.companyId)
    if (latest.status !== "valid") throw new InvoicePersonalizationError(latest.status === "invalid" ? latest.error : "Invoice profile readback is missing")
    const current = submission.companyId === null ? latest.value.organization : latest.value.company
    return { status: "saved", submission, version, isCurrent: current?.id === version.id }
  } catch (cause) {
    return { status: "unconfirmed", submission, message: cause instanceof Error ? cause.message : "Invoice profile readback failed" }
  }
}

/** Append one version only after checking the expected current version, then read it back exactly. */
export async function saveInvoiceProfileVersion(input: InvoiceProfileSaveInput, fetcher: Fetcher = apiFetch, createName = () => `Invoice profile ${crypto.randomUUID()}`, mayDispatch = () => true): Promise<InvoiceProfileSaveOutcome> {
  if (!invoiceProfileId(input.organizationId) || (input.companyId !== null && !invoiceProfileId(input.companyId))) throw new InvoicePersonalizationError("Invoice profile scope is invalid")
  const validated = validateInvoiceProfileValues(input.values, input.organizationId)
  if (validated.status !== "valid") throw new InvoicePersonalizationError(validated.status === "invalid" ? validated.error : "Invoice profile values are missing")
  const rows = await fetchInvoiceProfileRows(fetcher)
  const selection = selectInvoiceProfileVersions(rows, input.organizationId, input.companyId)
  if (selection.status !== "valid") throw new InvoicePersonalizationError(selection.status === "invalid" ? selection.error : "Invoice profile data is missing")
  const current = input.companyId === null ? selection.value.organization : selection.value.company
  if ((current?.id ?? null) !== input.expectedVersionId) throw new InvoicePersonalizationError("Invoice settings changed while you were editing. Reload the latest version before saving.", 409)
  if (!mayDispatch()) throw new InvoicePersonalizationError("The active scope or access changed before publication. No profile version was sent.", 409)
  const submission: InvoiceProfileSubmission = { ...input, values: validated.value, name: createName() }
  const command = documentTemplateCreateRequest({
      name: submission.name, model: INVOICE_PROFILE_MODEL, reportType: INVOICE_PROFILE_REPORT_TYPE,
      bodyHtml: "<p>Invoice personalization profile</p>", isDefault: true, isActive: true,
      metadata: JSON.stringify({ invoiceProfile: { schemaVersion: 1, values: submission.values } }),
  }, submission.companyId)
  try {
    const response = await fetcher(command.urlPath, command.init)
    if (!response.ok) {
      const error = await responseError(response)
      if (response.status >= 400 && response.status < 500) throw error
      return { status: "unconfirmed", submission, message: error.message }
    }
  } catch (cause) {
    if (cause instanceof InvoicePersonalizationError && cause.status !== undefined && cause.status >= 400 && cause.status < 500) throw cause
    return { status: "unconfirmed", submission, message: cause instanceof Error ? cause.message : "Invoice profile submission is not confirmed" }
  }
  return checkInvoiceProfileSubmission(submission, fetcher)
}

export function useInvoicePersonalization({ organizationId, companyId, enabled = true }: { organizationId: number; companyId: string | number | bigint | null; enabled?: boolean }) {
  const active = enabled && invoiceProfileId(organizationId) !== null && (companyId === null || invoiceProfileId(companyId) !== null)
  const query = useQuery({
    queryKey: ["invoice-personalization", String(organizationId), companyId === null ? "organization" : String(companyId)],
    queryFn: () => fetchInvoiceProfileRows(), enabled: active, retry: false,
  })
  const retry = () => { void query.refetch() }
  let state: InvoicePersonalizationState = { status: "loading" }
  let profile: InvoicePersonalizationProfile | null = null
  let organizationVersion: InvoiceProfileVersion | null = null
  let companyVersion: InvoiceProfileVersion | null = null
  if (active && query.isError) {
    const status = query.error && "status" in query.error ? query.error.status : undefined
    state = { status: status === 401 || status === 403 ? "denied" : "error", message: query.error.message, onRetry: retry }
  } else if (active && query.data !== undefined && !query.isPending) {
    const selected = selectInvoiceProfileVersions(query.data, organizationId, companyId)
    if (selected.status !== "valid") state = { status: "error", message: selected.status === "invalid" ? selected.error : "Invoice profile data is missing", onRetry: retry }
    else {
      state = { status: "ready" }
      organizationVersion = selected.value.organization
      companyVersion = selected.value.company
      profile = resolveInvoiceProfile(organizationVersion?.values, companyVersion?.values)
    }
  }
  const profileVersionIds: InvoiceProfileVersionIds = { organization: organizationVersion?.id ?? null, company: companyVersion?.id ?? null }
  return { profile, profileVersionIds, organizationVersion, companyVersion, state, refetch: query.refetch, isFetching: query.isFetching }
}

export function useSaveInvoicePersonalizationVersion(options?: { mayDispatch?: (input: InvoiceProfileSaveInput) => boolean }) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: InvoiceProfileSaveInput) => saveInvoiceProfileVersion(input, apiFetch, undefined, () => options?.mayDispatch?.(input) ?? true), retry: false,
    onSuccess: (outcome) => {
      if (outcome.status === "saved") void client.invalidateQueries({ queryKey: ["invoice-personalization", String(outcome.submission.organizationId)] })
    },
  })
}
