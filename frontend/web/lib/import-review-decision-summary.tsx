"use client"

import { useMemo } from "react"
import { isHistoryDate } from "@lumiere/erp-shared/history-period"
import { useTranslation } from "@lumiere/i18n"
import { useCompanies } from "@lumiere/query-hooks/hooks/organization-company"
import { shiftHistoryDate } from "./history-data"
import { wizardEntityByKey } from "./import-entities"
import type { ReviewDetail } from "./import-review-model"
import { confirmedReviewFields } from "./import-review-uncertainty"

export function ImportReviewDecisionSummary({
  detail,
  organizationId,
  companyId,
  canPrepareImport,
  allowImport,
}: {
  detail: ReviewDetail
  organizationId: number
  companyId: number
  canPrepareImport: boolean
  allowImport: boolean
}) {
  const { t } = useTranslation()
  const companies = useCompanies(organizationId, true)
  const company = companies.data?.find((item) => String(item.id) === String(companyId))
  const target = wizardEntityByKey(detail.targetEntity)
  const coverage = useMemo(() => {
    const files = new Map<string, { file: string; sha256: string }>()
    const counts = { needs_review: 0, confirmed: 0, excluded: 0 }
    let partial = 0
    let withoutDate = 0
    let from: string | undefined
    let toExclusive: string | undefined
    for (const item of detail.items) {
      const { file, sha256 } = item.source.source
      files.set(`${sha256}:${file}`, { file, sha256 })
      counts[item.state] += 1
      if (item.state === "needs_review" && confirmedReviewFields(item).length)
        partial += 1
      const date = item.source.businessDate
      if (isHistoryDate(date?.from) && isHistoryDate(date.toExclusive) && date.from < date.toExclusive) {
        if (!from || date.from < from) from = date.from
        if (!toExclusive || date.toExclusive > toExclusive) toExclusive = date.toExclusive
      } else {
        withoutDate += 1
      }
    }
    return {
      files,
      counts,
      partial,
      withoutDate,
      from,
      through: toExclusive ? shiftHistoryDate(toExclusive, -1) : undefined,
    }
  }, [detail.items])
  return (
    <section
      className="space-y-2 rounded-md border p-3 text-sm"
      aria-label={t("settings.importReview.decisionSummary.title")}
    >
      <dl className="flex flex-wrap gap-x-6 gap-y-2">
        <div>
          <dt className="text-muted-foreground">{t("settings.importReview.decisionSummary.company")}</dt>
          <dd className="font-medium">
            {company?.name || t("settings.importReview.decisionSummary.companyById", { id: companyId })}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("settings.importReview.decisionSummary.target")}</dt>
          <dd className="font-medium">
            {target?.label ?? t("settings.importReview.decisionSummary.sourceEvidence")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("settings.importReview.decisionSummary.period")}</dt>
          <dd className="font-medium">
            {coverage.from && coverage.through
              ? t("settings.importReview.decisionSummary.periodRange", { from: coverage.from, through: coverage.through })
              : t("settings.importReview.decisionSummary.noDates")}
          </dd>
          {coverage.from && coverage.withoutDate > 0 ? (
            <dd className="text-muted-foreground">
              {t("settings.importReview.decisionSummary.withoutDate", { count: coverage.withoutDate })}
            </dd>
          ) : null}
        </div>
      </dl>
      <details>
        <summary className="cursor-pointer font-medium">
          {t("settings.importReview.decisionSummary.files", { count: coverage.files.size })}
        </summary>
        <ul className="mt-1 space-y-1 text-muted-foreground">
          {[...coverage.files].map(([key, { file, sha256 }]) => (
            <li className="break-words" key={key}>
              {file} · <span title={sha256}>{sha256.slice(0, 12)}</span>
            </li>
          ))}
        </ul>
      </details>
      <div role="status">
        <p>
          {t("settings.importReview.decisionSummary.counts", {
            rows: detail.items.length,
            held: coverage.counts.needs_review,
            confirmed: coverage.counts.confirmed,
            excluded: coverage.counts.excluded,
          })}
        </p>
        {coverage.partial > 0 ? (
          <p className="text-muted-foreground">
            {t("settings.importReview.decisionSummary.partial", { count: coverage.partial })}
          </p>
        ) : null}
      </div>
      <p className="text-muted-foreground">
        {allowImport && canPrepareImport
          ? t("settings.importReview.decisionSummary.preview")
          : t("settings.importReview.decisionSummary.evidence")}
      </p>
    </section>
  )
}
