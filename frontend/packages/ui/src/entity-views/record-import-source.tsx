"use client"

import { useId } from "react"
import { useTranslation } from "@lumiere/i18n"
import { parseRecordImportSource } from "../lib/record-import-source"

/** Display recorded provenance as text, without treating editable metadata as verification. */
export function RecordImportSource({ metadata }: { metadata: unknown }) {
  const headingId = useId()
  const { t } = useTranslation()
  const source = parseRecordImportSource(metadata)
  if (!source) return null

  const fields = [
    { label: t("common.importSource.file", { defaultValue: "Original file" }), value: source.file },
    {
      label: source.rowBasis === "source_line"
        ? t("common.importSource.sourceLine", { defaultValue: "Source line" })
        : t("common.importSource.importRow", { defaultValue: "Import row" }),
      value: String(source.row),
    },
    { label: t("common.importSource.sha256", { defaultValue: "Recorded file SHA-256" }), value: source.sha256 },
    { label: t("common.importSource.batch", { defaultValue: "Review batch" }), value: source.batchId },
    { label: t("common.importSource.item", { defaultValue: "Review item" }), value: source.itemId },
    { label: t("common.importSource.revision", { defaultValue: "Review revision" }), value: String(source.revision) },
    ...(source.reason ? [{ label: t("common.importSource.reason", { defaultValue: "Review decision reason" }), value: source.reason }] : []),
  ]

  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-3 rounded-lg border p-4">
      <h3 id={headingId} className="text-sm font-semibold">
        {t("common.importSource.title", { defaultValue: "Recorded import source" })}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t("common.importSource.description", { defaultValue: "File and review details retained with this record." })}
      </p>
      <dl className="grid min-w-0 gap-3">
        {fields.map((field) => (
          <div key={field.label} className="min-w-0">
            <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
            <dd className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{field.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
