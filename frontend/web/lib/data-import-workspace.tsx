"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useErpSession } from "@lumiere/erp-session"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useTranslation } from "@lumiere/i18n"
import { GuidedImportWizard, type GuidedImportContinuationBlock, type GuidedImportWizardHandle } from "./guided-import-wizard"
import { ImportReviewWorkspace } from "./import-review-workspace"
import { SavedImportWorkspace } from "./saved-import-workspace"
import { SavedImportTaskPicker } from "./saved-import-task-picker"
import { SavedImportTaskIntake } from "./saved-import-task-intake"
import { readImportTaskLocation, withImportTaskLocation, type ImportTaskLocation, type ImportTaskView } from "./import-task-navigation"
import type { SavedImportScope } from "./use-saved-import-task"
import type { ChatImportTask } from "./chat-import-task"

export type DataImportWorkspaceProps = {
  organizationId: number
  initialReviewId?: string
  taskId?: string
  initialView?: ImportTaskView
  inspectionOnly?: boolean
  syncUrl?: boolean
  onTaskFocus?: (task: ChatImportTask) => void
}

export function DataImportWorkspace(props: DataImportWorkspaceProps) {
  const { organizationId } = props
  const { identity } = useErpSession()
  const companyId = useOperatingCompanyId(organizationId)
  const { t } = useTranslation()
  if (!identity || !companyId) return <p>{t("settings.importReview.companyRequired", { defaultValue: "Select an operating company to review source data." })}</p>
  return <ScopedWorkspace key={`${identity}:${organizationId}:${companyId}:${props.taskId ?? ""}:${props.initialReviewId ?? ""}`} {...props} identity={identity} companyId={companyId} />
}

function ScopedWorkspace({ organizationId, identity, companyId, initialReviewId, taskId, initialView, inspectionOnly, syncUrl = true, onTaskFocus }: DataImportWorkspaceProps & { identity: string; companyId: number }) {
  const scope = useMemo<SavedImportScope>(() => ({ identity, organizationId, companyId }), [identity, organizationId, companyId])
  const [location, setLocation] = useState<ImportTaskLocation | null>(taskId ? { taskId, companyId, reviewId: initialReviewId, view: initialView ?? (initialReviewId ? "decisions" : "sources") } : null)
  useEffect(() => {
    if (!syncUrl || taskId) return
    const restore = () => setLocation(readImportTaskLocation(window.location.search, companyId))
    restore()
    window.addEventListener("popstate", restore)
    return () => window.removeEventListener("popstate", restore)
  }, [companyId, taskId, syncUrl])
  const navigate = useCallback((next: ImportTaskLocation) => {
    setLocation(next)
    if (syncUrl) window.history.replaceState(window.history.state, "", withImportTaskLocation(new URL(window.location.href), next))
  }, [syncUrl])

  if (location) return <SavedImportWorkspace
    key={location.taskId}
    scope={scope}
    taskId={location.taskId}
    view={location.view}
    initialReviewId={location.reviewId}
    inspectionOnly={location.taskId === taskId ? inspectionOnly : undefined}
    onNavigate={(view, reviewId) => navigate({ ...location, view, reviewId })}
    onTaskChange={task => {
      if (task.companyId !== String(companyId)) return
      navigate({ taskId: task.requestId, companyId, view: "sources" })
      onTaskFocus?.(task)
    }}
    onTaskFocus={onTaskFocus}
    onBack={() => {
      setLocation(null)
      if (syncUrl) {
        const url = new URL(window.location.href)
        for (const name of ["importTask", "importCompany", "importView", "sourceReview", "sourceReviewCompany", "sourceReviewItem", "sourceReviewRevision"]) url.searchParams.delete(name)
        if (url.hash === "#import-task") url.hash = ""
        window.history.replaceState(window.history.state, "", url)
      }
    }}
  />

  return <div className="min-w-0 space-y-6">
    {!initialReviewId || taskId ? <>
      <SavedImportTaskIntake scope={scope} onSaved={id => navigate({ taskId: id, companyId, view: "sources" })} />
      <SavedImportTaskPicker scope={scope} onSelect={id => navigate({ taskId: id, companyId, view: "sources" })} />
    </> : null}
    <LegacyWorkspace organizationId={organizationId} initialReviewId={initialReviewId} />
  </div>
}

function LegacyWorkspace({ organizationId, initialReviewId }: { organizationId: number; initialReviewId?: string }) {
  const wizard = useRef<GuidedImportWizardHandle>(null)
  const [continuationBlock, setContinuationBlock] = useState<GuidedImportContinuationBlock>(null)
  const [reviewId, setReviewId] = useState<string | undefined>(initialReviewId)
  return <div className="flex flex-col gap-8">
    <GuidedImportWizard ref={wizard} organizationId={organizationId} onReviewSaved={setReviewId} onContinuationBlockChange={setContinuationBlock} />
    <ImportReviewWorkspace organizationId={organizationId} selectedId={reviewId} continuationBlock={continuationBlock} onContinue={source => { void wizard.current?.continueFromReview(source) }} />
  </div>
}
