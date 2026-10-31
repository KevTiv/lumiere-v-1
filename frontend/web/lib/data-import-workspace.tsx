"use client"

import { useRef, useState } from "react"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useTranslation } from "@lumiere/i18n"
import { GuidedImportWizard, type GuidedImportContinuationBlock, type GuidedImportWizardHandle } from "./guided-import-wizard"
import { ImportReviewWorkspace } from "./import-review-workspace"

export function DataImportWorkspace({ organizationId }: { organizationId: number }) {
  const companyId = useOperatingCompanyId(organizationId)
  const { t } = useTranslation()
  if (!companyId) return <p>{t("settings.importReview.companyRequired", { defaultValue: "Select an operating company to review source data." })}</p>
  return <Workspace key={`${organizationId}:${companyId}`} organizationId={organizationId} />
}
function Workspace({ organizationId }: { organizationId: number }) {
  const wizard = useRef<GuidedImportWizardHandle>(null)
  const [continuationBlock, setContinuationBlock] = useState<GuidedImportContinuationBlock>(null)
  const [reviewId, setReviewId] = useState<string>()
  return <div className="flex flex-col gap-8">
    <GuidedImportWizard ref={wizard} organizationId={organizationId} onReviewSaved={setReviewId} onContinuationBlockChange={setContinuationBlock} />
    <ImportReviewWorkspace organizationId={organizationId} selectedId={reviewId} continuationBlock={continuationBlock} onContinue={source => { void wizard.current?.continueFromReview(source) }} />
  </div>
}
