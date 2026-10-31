"use client"

import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useTranslation } from "@lumiere/i18n"
import { useIdentityLabelMap } from "@lumiere/ui/hooks/use-identity-label-map"
import { resolveIdentityLabel } from "@lumiere/ui/lib/identity-label"
import { FormModal, type FormConfig } from "@lumiere/ui"
import type { FormField, FormValues } from "@lumiere/ui/lib/form-types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { apiFetch } from "@/lib/api-fetch"
import { reviewedImportSource, reviewArithmetic, type ReviewBatch, type ReviewDetail, type ReviewRow, type ReviewedImportSource } from "./import-review-model"
import { productReviewReferenceOptions, productReviewStoredUnit, validateProductReviewReferences, type ProductReviewReferences, type ProductReviewReference } from "./import-review-product-references"

const PRODUCT_SETUP_FIELDS = new Set(["internal_reference", "type_field", "active", "can_be_sold", "can_be_purchased", "metadata"])

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(url, init)
  const body = await response.json()
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Source review is unavailable.")
  return body as T
}

async function loadProductReferences(companyId: number): Promise<ProductReviewReferences> {
  const [categories, uoms] = await Promise.all([
    request<{ data: ProductReviewReference[] }>(`/api/query/product-categories?companyId=${companyId}`),
    request<{ data: ProductReviewReference[] }>(`/api/query/uoms?companyId=${companyId}`),
  ])
  return { categories: categories.data, uoms: uoms.data }
}

export function ImportReviewWorkspace({ organizationId, selectedId, onContinue, continuationBlock }: { organizationId: number; selectedId?: string; onContinue: (source: ReviewedImportSource) => void; continuationBlock?: "busy" | "unresolved" | null }) {
  const companyId = useOperatingCompanyId(organizationId)
  const { t } = useTranslation()
  if (!companyId) return <p>{t("settings.importReview.companyRequired", { defaultValue: "Select an operating company to review source data." })}</p>
  return <ImportReviewPanel organizationId={organizationId} companyId={companyId} initialId={selectedId} onContinue={onContinue} continuationBlock={continuationBlock} />
}

export function ImportReviewPanel(props: { organizationId: number; companyId: number; initialId?: string; onContinue: (source: ReviewedImportSource) => void; continuationBlock?: "busy" | "unresolved" | null }) {
  return <ReviewWorkspace key={`${props.organizationId}:${props.companyId}:${props.initialId ?? ""}`} {...props} />
}

function ReviewWorkspace({ organizationId, companyId, initialId, onContinue, continuationBlock }: { organizationId: number; companyId: number; initialId?: string; onContinue: (source: ReviewedImportSource) => void; continuationBlock?: "busy" | "unresolved" | null }) {
  const { t } = useTranslation()
  const cache = useQueryClient()
  const identityLabels = useIdentityLabelMap(organizationId)
  const sourceLabel = (item: ReviewRow) => `${item.source.source.file} · ${t(item.source.source.rowBasis === "import_row" ? "settings.importReview.importRow" : "settings.importReview.sourceLine", { defaultValue: item.source.source.rowBasis === "import_row" ? "Import row {{row}}" : "Source row {{row}}", row: item.source.source.row })}`
  const [selectedId, setSelectedId] = useState(initialId ?? "")
  const [selected, setSelected] = useState<ReviewRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestKey, setRequestKey] = useState("")
  const [filter, setFilter] = useState("needs_review")
  const [search, setSearch] = useState("")
  const list = useQuery({ queryKey: ["import-reviews", organizationId, companyId], queryFn: () => request<{ data: ReviewBatch[] }>(`/api/import-reviews?companyId=${companyId}`), retry: false })
  const detail = useQuery({ queryKey: ["import-review", organizationId, companyId, selectedId], queryFn: () => request<ReviewDetail>(`/api/import-reviews/${selectedId}?companyId=${companyId}`), enabled: !!selectedId, retry: false })
  const productReferenceQuery = { queryKey: ["import-review-product-references", organizationId, companyId], queryFn: () => loadProductReferences(companyId), staleTime: 30_000 }
  const productReferences = useQuery({ ...productReferenceQuery, enabled: !!selected && detail.data?.targetEntity === "product", retry: false })
  const productReview = detail.data?.targetEntity === "product"
  const config = useMemo<FormConfig>(() => {
    const fields: FormField[] = (selected?.source.fields ?? []).map(field => {
      const reference = productReview && ["category_id", "uom_id", "uom_po_id"].includes(field.key)
      if (reference) return { id: field.key, name: field.key, type: "select", width: "1/2", defaultValue: selected?.values[field.key] ?? "", disabled: !productReferences.data,
        label: field.key === "category_id" ? t("settings.importReview.category", { defaultValue: "Product category" }) : field.key === "uom_id" ? t("settings.importReview.productUnit", { defaultValue: "Product catalog unit" }) : t("settings.importReview.purchaseUnit", { defaultValue: "Purchase unit" }),
        description: t("settings.importReview.referenceHint", { defaultValue: "Choose from this organization. Enter quantities and prices for the chosen unit." }),
        options: productReviewReferenceOptions((field.key === "category_id" ? productReferences.data?.categories : productReferences.data?.uoms) ?? [], organizationId, field.key === "category_id" ? undefined : productReviewStoredUnit(selected)),
      }
      const base = { id: field.key, name: field.key, label: productReview && field.key === "stored_unit" ? t("settings.importReview.priceUnit", { defaultValue: "Unit for corrected prices" }) : field.label, width: "1/2" as const,
        defaultValue: selected?.values[field.key] ?? "", description: `${t("settings.importReview.sourceValue", { defaultValue: "Source value" })}: ${field.sourceValue ?? t("settings.importReview.unknown", { defaultValue: "Unknown" })}`,
      }
      const fixedUnit = productReview && field.key === "stored_unit" ? productReviewStoredUnit(selected) : undefined
      return field.kind === "choice" ? { ...base, type: "select" as const, options: (fixedUnit ? [fixedUnit] : field.options ?? []).map(value => ({ value, label: value })) } : { ...base, type: "text" as const, inputMode: field.kind === "decimal" ? "decimal" as const : "text" as const }
    })
    const setupFields = productReview ? fields.filter(field => PRODUCT_SETUP_FIELDS.has(field.name)) : []
    return {
    id: "source-review-correction", title: selected?.source.label ?? "", description: selected?.source.issue,
    submitLabel: t("settings.importReview.save", { defaultValue: "Save review" }), size: "xl",
    sections: [{ id: "corrections", title: t("settings.importReview.proposed", { defaultValue: "Proposed values" }), fields: fields.filter(field => !productReview || !PRODUCT_SETUP_FIELDS.has(field.name)) },
      ...(setupFields.length ? [{ id: "import-setup", title: t("settings.importReview.importSetup", { defaultValue: "Advanced import settings" }), collapsible: true, fields: setupFields }] : []),
      { id: "decision", title: t("settings.importReview.decision", { defaultValue: "Review decision" }), fields: [
      { id: "_decision", name: "_decision", type: "select", label: t("settings.importReview.status", { defaultValue: "Status" }), required: true, defaultValue: selected?.state ?? "needs_review", options: [
        { value: "needs_review", label: t("settings.importReview.pending", { defaultValue: "Keep for review" }) },
        { value: "confirmed", label: t("settings.importReview.confirmed", { defaultValue: "Confirm corrected values" }) },
        { value: "excluded", label: t("settings.importReview.excluded", { defaultValue: "Exclude from import" }) },
      ] },
      { id: "_reason", name: "_reason", type: "textarea", format: "plain", label: t("settings.importReview.reason", { defaultValue: "Reason or supporting evidence" }), defaultValue: selected?.reason ?? "", description: t("settings.importReview.reasonHint", { defaultValue: "Required when you confirm or exclude a row. State any assumption that remains." }), rows: 3 },
    ] }],
    }
  }, [selected, t, productReview, productReferences.data, organizationId])

  const upload = async (file: File) => {
    setBusy(true); setError(null)
    try {
      if (file.size > 4_000_000) throw new Error(t("settings.importReview.fileTooLarge", { defaultValue: "The review document exceeds 4 MB." }))
      const dataset: unknown = JSON.parse(await file.text())
      const result = await request<{ id: string }>("/api/import-reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, dataset }) })
      setSelectedId(result.id)
      await cache.invalidateQueries({ queryKey: ["import-reviews", organizationId, companyId] })
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  const open = (item: ReviewRow) => { setSelected(item); setRequestKey(crypto.randomUUID()); setError(null) }
  const save = async (values: FormValues) => {
    if (!selected) return
    setBusy(true); setError(null)
    try {
      const corrected = Object.fromEntries(selected.source.fields.map(field => {
        const value = productReview && ["category_id", "uom_id", "uom_po_id"].includes(field.key) && values[field.key] === undefined ? selected.values[field.key] : values[field.key]
        return [field.key, value === "" || value == null ? null : String(value)]
      }))
      if (productReview && values._decision === "confirmed") validateProductReviewReferences(selected, corrected, await cache.fetchQuery(productReferenceQuery), organizationId)
      await request(`/api/import-reviews/${selectedId}/items/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, expectedRevision: selected.revision, requestKey, state: values._decision, reason: String(values._reason ?? ""), values: corrected }) })
      await Promise.all([cache.invalidateQueries({ queryKey: ["import-review", organizationId, companyId, selectedId] }), cache.invalidateQueries({ queryKey: ["import-reviews", organizationId, companyId] })])
      setSelected(null)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); throw failure }
    finally { setBusy(false) }
  }
  const confirmed = detail.data?.items.filter(item => item.state === "confirmed").length ?? 0
  const continueImport = async () => {
    if (!detail.data) return
    setBusy(true); setError(null)
    try {
      if (productReview) {
        const references = await cache.fetchQuery(productReferenceQuery)
        for (const item of detail.data.items.filter(item => item.state === "confirmed")) validateProductReviewReferences(item, item.values, references, organizationId)
      }
      onContinue(reviewedImportSource(detail.data))
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <section className="flex flex-col gap-4" aria-label={t("settings.importReview.title", { defaultValue: "Source data review" })}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div>
      <h2 className="text-lg font-semibold">{t("settings.importReview.title", { defaultValue: "Source data review" })}</h2>
      <p className="text-sm text-muted-foreground">{t("settings.importReview.description", { defaultValue: "Save uncertain rows, correct their interpretation and keep the original source. Confirmed rows return to the normal import preview." })}</p>
    </div><FieldGroup className="max-w-xs"><Field><FieldLabel htmlFor="source-review-upload">{t("settings.importReview.upload", { defaultValue: "Load review document" })}</FieldLabel><Input id="source-review-upload" type="file" accept=".json,application/json" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = "" }} /></Field></FieldGroup></div>
    {(error || list.error || detail.error) && !selected ? <Alert variant="destructive"><AlertTitle>{t("settings.importReview.error", { defaultValue: "Review could not be completed" })}</AlertTitle><AlertDescription>{error ?? list.error?.message ?? detail.error?.message}</AlertDescription></Alert> : null}
    {list.isPending ? <p>{t("common.loading", { defaultValue: "Loading…" })}</p> : null}
    <div className="flex flex-wrap gap-2">{list.data?.data.map(batch => <Button key={batch.id} variant={selectedId === batch.id ? "secondary" : "outline"} onClick={() => { setSelectedId(batch.id); setError(null) }} aria-pressed={selectedId === batch.id}>{batch.title} ({batch.pending} {t("settings.importReview.remaining", { defaultValue: "to review" })})</Button>)}</div>
    {list.data?.data.length === 0 ? <p className="text-sm text-muted-foreground">{t("settings.importReview.empty", { defaultValue: "No source drafts yet. Save a CSV preview for review or load a prepared review document." })}</p> : null}
    {detail.data ? <>
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{detail.data.title}</h3><div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!confirmed || busy || !!continuationBlock || !["product", "stock_location"].includes(detail.data.targetEntity)} onClick={() => void continueImport()}>{t("settings.importReview.continue", { defaultValue: "Continue import ({{count}} confirmed)", count: confirmed })}</Button>
        <Button variant="outline" onClick={() => { setError(null); void detail.refetch(); void list.refetch() }}>{t("common.refresh", { defaultValue: "Refresh" })}</Button>
      </div></div>
      {continuationBlock ? <p role="status" data-testid="import-review-handoff-status">{continuationBlock === "busy" ? t("common.formSubmit.busy") : t("settings.importReview.resolveCurrent", { defaultValue: "Check the current import result before loading another source." })}</p> : null}
      {!["product", "stock_location"].includes(detail.data.targetEntity) ? <p className="text-sm text-muted-foreground">{t("settings.importReview.moduleSpecific", { defaultValue: "These source corrections are saved. Use Accounting or the relevant module to create complete business records." })}</p> : null}
      <div className="flex flex-wrap gap-2" aria-label={t("settings.importReview.filterLabel", { defaultValue: "Filter review status" })}>{(["needs_review", "confirmed", "excluded", "all"] as const).map(state => <Button key={state} size="sm" variant={filter === state ? "secondary" : "outline"} aria-pressed={filter === state} onClick={() => setFilter(state)}>{t(`settings.importReview.filter.${state}`, { defaultValue: ({ needs_review: "Needs review", confirmed: "Confirmed", excluded: "Excluded", all: "All" })[state] })}</Button>)}</div>
      <Field className="max-w-md"><FieldLabel htmlFor="review-search">{t("settings.importReview.search", { defaultValue: "Find an item or source file" })}</FieldLabel><Input id="review-search" type="search" value={search} onChange={event => setSearch(event.target.value)} /></Field>
      <Table><TableHeader><TableRow><TableHead>{t("settings.importReview.item", { defaultValue: "Item" })}</TableHead><TableHead>{t("settings.importReview.source", { defaultValue: "Source" })}</TableHead><TableHead>{t("settings.importReview.question", { defaultValue: "Uncertainty" })}</TableHead><TableHead>{t("settings.importReview.status", { defaultValue: "Status" })}</TableHead><TableHead><span className="sr-only">{t("settings.importReview.actions", { defaultValue: "Actions" })}</span></TableHead></TableRow></TableHeader><TableBody>
        {detail.data.items.filter(item => (filter === "all" || item.state === filter) && `${item.source.label} ${item.source.source.file} ${item.source.issue}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map(item => <TableRow key={item.id}><TableCell>{item.source.label}</TableCell><TableCell>{sourceLabel(item)}</TableCell><TableCell className="max-w-sm whitespace-normal">{item.source.issue}</TableCell><TableCell>{t(`settings.importReview.filter.${item.state}`, { defaultValue: item.state.replaceAll("_", " ") })}</TableCell><TableCell><Button variant="outline" size="sm" onClick={() => open(item)}>{t("settings.importReview.correct", { defaultValue: "Review and correct" })}</Button></TableCell></TableRow>)}
      </TableBody></Table>
      {detail.data.history.length ? <details><summary className="cursor-pointer text-sm font-medium">{t("settings.importReview.history", { defaultValue: "Recent decisions" })}</summary><ul className="mt-2 flex flex-col gap-2 text-sm">{detail.data.history.map(entry => <li key={`${entry.itemId}:${entry.revision}`}>{entry.createdAt} · {resolveIdentityLabel(entry.actor, identityLabels)} · {entry.reason}</li>)}</ul></details> : null}
    </> : null}
    <FormModal key={selected ? `${selected.id}:${selected.revision}` : "closed"} open={!!selected} onOpenChange={open => { if (!open) { setSelected(null); setError(null) } }} config={config} onSubmit={save} isPending={busy || (!!selected && productReview && productReferences.isPending)} submitError={error ?? (productReview ? productReferences.error?.message : undefined)} draft={false} renderPreview={values => <div className="flex flex-col gap-2 text-sm"><p>{t("settings.importReview.originalRetained", { defaultValue: "Original source values remain unchanged. Save a draft if the correct value is still unknown." })}</p>{reviewArithmetic(values) != null ? <p>{t("settings.importReview.calculated", { defaultValue: "Proposed quantity × unit price: {{amount}}", amount: reviewArithmetic(values) })}</p> : null}{selected ? <p className="break-all text-xs text-muted-foreground">{sourceLabel(selected)} · SHA-256 {selected.source.source.sha256}</p> : null}</div>} />
  </section>
}
