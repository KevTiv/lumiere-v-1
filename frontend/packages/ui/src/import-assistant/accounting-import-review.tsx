"use client"

import { useTranslation } from "@lumiere/i18n"
import type { AccountingImportReview as Review } from "../lib/accounting-import-review"
import { Label } from "../components/label"

export function AccountingImportReview({ review, reviewed, onReviewedChange }: {
  review: Review
  reviewed: boolean
  onReviewedChange: (reviewed: boolean) => void
}) {
  const { t } = useTranslation()
  return <section className="space-y-3 rounded-md border p-4" aria-label={t("accounting.importReview.title", { defaultValue: "Source control totals" })}>
    <h3 className="text-sm font-semibold">{t("accounting.importReview.title", { defaultValue: "Source control totals" })}</h3>
    <p className="text-sm text-muted-foreground">{t("accounting.importReview.scope", {
      defaultValue: "These totals cover all {{rows}} source rows, before posting or payment allocation. Compare them with your source records.", rows: review.rowCount,
    })}</p>
    {review.referenceCount != null ? <p className="text-sm">{t("accounting.importReview.references", { defaultValue: "{{count}} distinct document or journal references", count: review.referenceCount })}</p> : null}
    {review.issues.length ? <div role="alert" className="space-y-1 text-sm text-destructive">
      <p>{t("accounting.importReview.invalid", { defaultValue: "Fix source exceptions before importing. Totals are incomplete while exceptions remain." })}</p>
      <ul className="list-disc pl-5">{review.issues.slice(0, 10).map((issue, at) => <li key={at}>{issue.message}</li>)}</ul>
      {review.issues.length > 10 ? <p>{t("accounting.importReview.moreIssues", { defaultValue: "{{count}} more exceptions in the source file.", count: review.issues.length - 10 })}</p> : null}
    </div> : null}
    <dl className="grid gap-2 text-sm">
      {review.totals.map((total) => <div key={JSON.stringify([total.currency, total.documentType, total.field])} className="flex flex-wrap justify-between gap-2">
        <dt>{total.documentType ? `${total.documentType} · ` : ""}{t(`accounting.importReview.fields.${total.field}`, { defaultValue: total.field.replaceAll("_", " ") })} · {total.currency ? t("accounting.importReview.currency", { defaultValue: "Currency ID {{id}}", id: total.currency }) : t("accounting.importReview.companyCurrency", { defaultValue: "Currency unspecified; verify company default" })}</dt>
        <dd className="font-mono tabular-nums">{total.amount}</dd>
      </div>)}
    </dl>
    <Label className="flex items-start gap-2">
      <input type="checkbox" className="mt-0.5" checked={reviewed} disabled={review.issues.length > 0} onChange={(event) => onReviewedChange(event.target.checked)} />
      {t("accounting.importReview.confirm", { defaultValue: "I checked these source totals and references." })}
    </Label>
  </section>
}
