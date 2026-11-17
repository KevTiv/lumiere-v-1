"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useErpSession } from "@lumiere/erp-session"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { pinnedSourceReview } from "@lumiere/query-hooks/hooks/source-review-navigation"
import { DashboardHeader } from "@lumiere/ui"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { moduleQueryState } from "@lumiere/ui/lib/module-data-state"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"
import { DataImportWorkspace } from "@/lib/data-import-workspace"
import { ImportReviewPanel } from "@/lib/import-review-workspace"
import { useFarmOperationsAvailability } from "@/lib/use-farm-operations-enabled"
import { farmBatchPath } from "../farm-batch-model"

export function FarmImportWorkspace({ organizationId }: { organizationId?: number }) {
  const search = useSearchParams()
  const { activeCompanyReady } = useErpSession()
  const companyId = useOperatingCompanyId(organizationId)
  const { enabled, packs } = useFarmOperationsAvailability(companyId)
  const { permissionsReady, checkPermission } = useRBAC()
  if (!activeCompanyReady || !permissionsReady) return <p role="status">Loading Farm Operations…</p>
  if (!organizationId || !companyId) return <p>Select an operating company to import farm events.</p>
  const packState = moduleQueryState(packs)
  if (packState.status === "loading") return <p role="status">Checking Farm Operations…</p>
  if (packState.status !== "ready") return <ModuleDataNotice state={packState} />
  if (!enabled) return <p>Farm Operations is unavailable for this company or role.</p>

  const company = String(companyId)
  const expectedCompany = search.get("sourceReviewCompany") ?? search.get("companyId")
  if (expectedCompany !== null && expectedCompany !== company)
    return <p>Switch to the operating company for this farm import or source review.</p>

  const pinned = pinnedSourceReview(search.toString(), company)
  if (search.has("sourceReview") && !pinned)
    return <p>The farm source review link is incomplete.</p>
  if (!pinned && !checkPermission("farm_batch", "create").allowed)
    return <p>Farm batch creation access is required to import farm events.</p>

  return (
    <div className="min-w-0 space-y-6">
      <Link className="text-sm text-primary underline underline-offset-4" href={farmBatchPath}>
        Farm Batches
      </Link>
      <DashboardHeader
        title={pinned ? "Farm event source review" : "Import farm batch events"}
        description={pinned
          ? "Review the saved source row and decision that produced this farm event."
          : "Save a CSV or Excel source and prepare Farm batch events for review. Include flock reference, event reference, event type and business date."}
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
