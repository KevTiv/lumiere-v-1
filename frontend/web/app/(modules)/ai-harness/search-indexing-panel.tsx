"use client"

import { useRef, useState, type FormEvent } from "react"
import { useErpSession } from "@lumiere/erp-session"
import { useTranslation } from "@lumiere/i18n"
import { useAiMemoryIngest } from "@lumiere/query-hooks/hooks/ai-memory"
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
import { companyRowsToSelectOptions } from "@/lib/form-lookup"

export function SearchIndexingPanel({
  companies,
}: {
  companies: Record<string, unknown>[]
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
          <IndexRecordsForm
            key={company.value}
            companyId={activeCompanyId}
            companyName={company.label}
          />
        ) : (
          <p role="status">{t("aiHarness.searchIndex.selectCompany")}</p>
        )}
      </CardContent>
    </Card>
  )
}

function IndexRecordsForm({
  companyId,
  companyName,
}: {
  companyId: number
  companyName: string
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
      <p className="text-sm font-medium">
        {companyName} · #{companyId}
      </p>
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
