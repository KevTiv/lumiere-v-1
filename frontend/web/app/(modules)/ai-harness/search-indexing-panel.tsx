"use client"

import { useRef, useState, type FormEvent } from "react"
import { useErpSession } from "@lumiere/erp-session"
import { useTranslation } from "@lumiere/i18n"
import { useAiCatalogIngest, useAiMemoryIngest } from "@lumiere/query-hooks/hooks/ai-memory"
import { Button } from "@lumiere/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lumiere/ui/components/card"
import { Field, FieldLabel } from "@lumiere/ui/components/field"
import { Input } from "@lumiere/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lumiere/ui/components/select"
import {
  ACTIVITY_INDEX_KINDS,
  parseActivityIngestBody,
} from "@/app/api/ai/context/ingest/body"
import {
  companyRowsToSelectOptions,
  type CompanyLookupRow,
} from "@/lib/form-lookup"

export function SearchIndexingPanel({
  companies,
}: {
  companies: readonly CompanyLookupRow[]
}) {
  const { t } = useTranslation()
  const { activeCompanyId } = useErpSession()
  const company = companyRowsToSelectOptions(companies).find(
    ({ value }) => value === String(activeCompanyId),
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("aiHarness.searchIndex.title")}</CardTitle>
        <CardDescription>
          {t("aiHarness.searchIndex.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {company && activeCompanyId != null ? (
          <div key={company.value} className="space-y-6">
            <p className="text-sm font-medium">{company.label} · #{activeCompanyId}</p>
            <CatalogIndexForm companyId={activeCompanyId} />
            <details className="space-y-4">
              <summary className="cursor-pointer text-sm font-medium">{t("aiHarness.searchIndex.personalTitle")}</summary>
              <IndexRecordsForm companyId={activeCompanyId} />
            </details>
          </div>
        ) : (
          <p role="status">{t("aiHarness.searchIndex.selectCompany")}</p>
        )}
      </CardContent>
    </Card>
  )
}

function CatalogIndexForm({ companyId }: { companyId: number }) {
  const { t } = useTranslation()
  const indexing = useAiCatalogIngest()
  const submitting = useRef(false)
  const [before, setBefore] = useState<string>()
  const result = indexing.data
  const preview = result?.catalog.preview

  async function run(cursor: string | undefined, confirmation?: string) {
    if (submitting.current) return
    submitting.current = true
    setBefore(cursor)
    try {
      await indexing.mutateAsync({ companyId, catalog: { before: cursor, preview: confirmation } })
    } catch {
      // Keep the same cursor so the owner can preview and resume the batch.
    } finally {
      submitting.current = false
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">{t("aiHarness.searchIndex.catalogTitle")}</h3>
      <p className="text-sm text-muted-foreground">{t("aiHarness.searchIndex.catalogDescription")}</p>
      {result && (
        <p role="status">
          {preview
            ? t("aiHarness.searchIndex.catalogPreviewResult", { ...result, ready: result.catalog.ready })
            : t("aiHarness.searchIndex.result", { ...result })}
        </p>
      )}
      {indexing.error && <p role="alert">{indexing.error.message}</p>}
      <div className="flex flex-wrap gap-2">
        {(!result || (preview && result.catalog.ready > 0)) && (
          <Button type="button" variant={preview ? "outline" : "default"} disabled={indexing.isPending} onClick={() => void run(before)}>
            {t("aiHarness.searchIndex.previewCatalog")}
          </Button>
        )}
        {preview && result.catalog.ready > 0 && (
          <Button type="button" disabled={indexing.isPending} onClick={() => void run(before, preview)}>
            {t("aiHarness.searchIndex.applyCatalog")}
          </Button>
        )}
        {result?.catalog.next_before && (!preview || result.catalog.ready === 0) && (
          <Button type="button" disabled={indexing.isPending} onClick={() => void run(result.catalog.next_before ?? undefined)}>
            {t("aiHarness.searchIndex.nextCatalogBatch")}
          </Button>
        )}
        {result && !result.catalog.next_before && (!preview || result.catalog.ready === 0) && (
          <p role="status">{t("aiHarness.searchIndex.catalogComplete")}</p>
        )}
      </div>
    </section>
  )
}

function IndexRecordsForm({
  companyId,
}: {
  companyId: number
}) {
  const { t } = useTranslation()
  const indexing = useAiMemoryIngest()
  const submitting = useRef(false)
  const [kind, setKind] = useState("product")
  const [ids, setIds] = useState("")
  const [validationError, setValidationError] = useState<string>()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    indexing.reset()
    setValidationError(undefined)
    const resources = ids
      .trim()
      .split(/[\s,]+/)
      .map((resource_id) => ({ resource_kind: kind, resource_id }))
    let request: ReturnType<typeof parseActivityIngestBody>
    try {
      request = parseActivityIngestBody({ companyId, resources })
    } catch {
      setValidationError(t("aiHarness.searchIndex.invalidIds"))
      return
    }
    submitting.current = true
    try {
      await indexing.mutateAsync(request)
    } catch {
      // The mutation exposes the server's scoped error below.
    } finally {
      submitting.current = false
    }
  }

  return (
    <form className="max-w-xl space-y-4" onSubmit={submit}>
      <Field>
        <FieldLabel htmlFor="index-record-kind">
          {t("aiHarness.searchIndex.recordType")}
        </FieldLabel>
        <Select
          value={kind}
          onValueChange={setKind}
          disabled={indexing.isPending}
        >
          <SelectTrigger id="index-record-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTIVITY_INDEX_KINDS.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`aiHarness.searchIndex.kinds.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="index-record-ids">
          {t("aiHarness.searchIndex.recordIds")}
        </FieldLabel>
        <Input
          id="index-record-ids"
          value={ids}
          onChange={(event) => setIds(event.target.value)}
          maxLength={200}
          disabled={indexing.isPending}
        />
      </Field>
      <Button type="submit" disabled={indexing.isPending || !ids.trim()}>
        {t(
          indexing.isPending
            ? "aiHarness.searchIndex.indexing"
            : "aiHarness.searchIndex.apply",
        )}
      </Button>
      {validationError || indexing.error ? (
        <p role="alert">{validationError ?? indexing.error?.message}</p>
      ) : null}
      {indexing.data ? (
        <p role="status">
          {t("aiHarness.searchIndex.result", { ...indexing.data })}
        </p>
      ) : null}
    </form>
  )
}
