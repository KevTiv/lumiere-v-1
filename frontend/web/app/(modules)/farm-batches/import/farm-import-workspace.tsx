"use client"

import { useTranslation } from "@lumiere/i18n"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { pinnedSourceReview } from "@lumiere/query-hooks/hooks/source-review-navigation"
import { DashboardHeader } from "@lumiere/ui"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { DataImportWorkspace } from "@/lib/data-import-workspace"
import { ImportReviewPanel } from "@/lib/import-review-workspace"
import { farmBatchPath } from "../farm-batch-model"
import { FarmOperationsGate } from "../farm-operations-gate"

export function FarmImportWorkspace({ organizationId }: { organizationId?: number }) {
  const search = useSearchParams()
  const companyId = useOperatingCompanyId(organizationId)
  const expectedCompany = search.get("sourceReviewCompany") ?? search.get("companyId")

  return (
    <FarmOperationsGate organizationId={organizationId} expectedCompany={expectedCompany}>
      {organizationId && companyId ? <FarmImportContent organizationId={organizationId} companyId={companyId} /> : null}
    </FarmOperationsGate>
  )
}

function FarmImportContent({ organizationId, companyId }: { organizationId: number; companyId: number }) {
  const search = useSearchParams()
  const { t } = useTranslation()
  const { checkPermission } = useRBAC()
  const company = String(companyId)
  const pinned = pinnedSourceReview(search.toString(), company)
  if (search.has("sourceReview") && !pinned)
    return <p>{t("farmBatches.theFarmSourceReviewLinkIsIncomplete")}</p>
  if (!pinned && !checkPermission("farm_batch", "create").allowed)
    return <p>{t("farmBatches.farmBatchCreationAccessIsRequiredTo")}</p>

  return (
    <div className="min-w-0 space-y-6">
      <Link className="text-sm text-primary underline underline-offset-4" href={farmBatchPath}>
        {t("farmBatches.farmBatches")}
      </Link>
      <DashboardHeader
        title={pinned ? t("farmBatches.farmEventSourceReview") : t("farmBatches.importFarmBatchEvents")}
        description={pinned
          ? t("farmBatches.reviewTheSavedSourceRowAndDecision")
          : t("farmBatches.saveACSVOrExcelSourceAnd")}
      />
      {pinned ? (
        <ImportReviewPanel
          organizationId={organizationId}
          companyId={companyId}
          initialId={pinned.batchId}
          allowedReviewIds={[pinned.batchId]}
          allowUpload={false}
          allowImport={false}
          onContinue={() => undefined}
        />
      ) : (
        <DataImportWorkspace
          organizationId={organizationId}
          preparationTarget="farm_event"
          urlSearch={search.toString()}
        />
      )}
    </div>
  )
}
