"use client"

import { useState } from "react"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useTranslation } from "@lumiere/i18n"
import { GuidedImportWizard } from "./guided-import-wizard"
import { ImportReviewWorkspace } from "./import-review-workspace"
import type { ReviewedImportSource } from "./import-review-model"

export function DataImportWorkspace({ organizationId }: { organizationId: number }) {
  const companyId = useOperatingCompanyId(organizationId)
  const { t } = useTranslation()
  if (!companyId) return <p>{t("settings.importReview.companyRequired", { defaultValue: "Select an operating company to review source data." })}</p>
  return <Workspace key={`${organizationId}:${companyId}`} organizationId={organizationId} />
}
function Workspace({ organizationId }: { organizationId: number }) {
  const [handoff, setHandoff] = useState<{ key: number; source: ReviewedImportSource } | null>(null)
  const [reviewId, setReviewId] = useState<string>()
  return <div className="flex flex-col gap-8">
    <GuidedImportWizard key={handoff?.key ?? 0} organizationId={organizationId} initialSource={handoff?.source} onReviewSaved={setReviewId} />
    <ImportReviewWorkspace organizationId={organizationId} selectedId={reviewId} onContinue={source => setHandoff(previous => ({ key: (previous?.key ?? 0) + 1, source }))} />
  </div>
}
