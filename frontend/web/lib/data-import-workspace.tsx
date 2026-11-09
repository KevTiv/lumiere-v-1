"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useErpSession } from "@lumiere/erp-session"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useTranslation } from "@lumiere/i18n"
import {
  GuidedImportWizard,
  type GuidedImportContinuationBlock,
  type GuidedImportWizardHandle,
} from "./guided-import-wizard"
import { ImportReviewWorkspace } from "./import-review-workspace"
import { SavedImportWorkspace } from "./saved-import-workspace"
import {
  SavedImportTaskPicker,
  useSavedImportTaskList,
} from "./saved-import-task-picker"
import { SavedImportTaskIntake } from "./saved-import-task-intake"
import {
  readImportTaskLocation,
  withImportTaskLocation,
  type ImportTaskLocation,
  type ImportTaskView,
} from "./import-task-navigation"
import type { SavedImportScope } from "./use-saved-import-task"
import type { ChatImportTask } from "./chat-import-task"

export type DataImportWorkspaceProps = {
  organizationId: number
  initialReviewId?: string
  taskId?: string
  initialView?: ImportTaskView
  inspectionOnly?: boolean
  syncUrl?: boolean
  sourceHistory?: ReactNode
  urlSearch?: string
  onTaskFocus?: (task: ChatImportTask) => void
}

export function DataImportWorkspace(props: DataImportWorkspaceProps) {
  const { organizationId } = props
  const {
    identity,
    organizationId: sessionOrganizationId,
    activeCompanyReady,
  } = useErpSession()
  const companyId = useOperatingCompanyId(organizationId)
  const { t } = useTranslation()
  if (!activeCompanyReady)
    return (
      <p role="status">
        {t("availableHistory.loadingCompany", {
          defaultValue: "Loading the current company…",
        })}
      </p>
    )
  if (!identity || !companyId || sessionOrganizationId !== organizationId) {
    return (
      <p>
        {t("settings.importTask.companyRequired", {
          defaultValue:
            "Select an operating company to start or review an import.",
        })}
      </p>
    )
  }
  return (
    <ScopedWorkspace
      key={`${identity}:${organizationId}:${companyId}:${props.taskId ?? ""}:${props.initialReviewId ?? ""}`}
      {...props}
      identity={identity}
      companyId={companyId}
    />
  )
}

function ScopedWorkspace({
  organizationId,
  identity,
  companyId,
  initialReviewId,
  taskId,
  initialView,
  inspectionOnly,
  syncUrl = true,
  sourceHistory,
  urlSearch,
  onTaskFocus,
}: DataImportWorkspaceProps & { identity: string; companyId: number }) {
  const { t } = useTranslation()
  const scope = useMemo<SavedImportScope>(
    () => ({ identity, organizationId, companyId }),
    [identity, organizationId, companyId],
  )
  const [location, setLocation] = useState<ImportTaskLocation | null>(() => {
    if (taskId)
      return {
        taskId,
        companyId,
        reviewId: initialReviewId,
        view: initialView ?? (initialReviewId ? "decisions" : "sources"),
      }
    return syncUrl && urlSearch !== undefined
      ? readImportTaskLocation(urlSearch, companyId)
      : null
  })
  useEffect(() => {
    if (!syncUrl || taskId) return
    if (urlSearch !== undefined) {
      setLocation(readImportTaskLocation(urlSearch, companyId))
      return
    }
    const restore = () =>
      setLocation(readImportTaskLocation(window.location.search, companyId))
    restore()
    window.addEventListener("popstate", restore)
    return () => window.removeEventListener("popstate", restore)
  }, [companyId, taskId, syncUrl, urlSearch])
  const navigate = useCallback(
    (next: ImportTaskLocation) => {
      setLocation(next)
      if (syncUrl)
        window.history.replaceState(
          window.history.state,
          "",
          withImportTaskLocation(new URL(window.location.href), next),
        )
    },
    [syncUrl],
  )

  const history = sourceHistory ? (
    <div
      id="available-history"
      tabIndex={-1}
      className="scroll-mt-6 border-t pt-6"
    >
      {sourceHistory}
    </div>
  ) : null
  const historyLink = history ? (
    <a
      href="#available-history"
      className="inline-flex min-h-9 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      {t("settings.importTask.reviewHistory", {
        defaultValue: "Review source history",
      })}
    </a>
  ) : null

  if (location)
    return (
      <div className="min-w-0 space-y-6">
        {historyLink}
        <SavedImportWorkspace
          key={location.taskId}
          scope={scope}
          taskId={location.taskId}
          view={location.view}
          initialReviewId={location.reviewId}
          inspectionOnly={
            location.taskId === taskId ? inspectionOnly : undefined
          }
          onNavigate={(view, reviewId) =>
            navigate({ ...location, view, reviewId })
          }
          onTaskChange={(task) => {
            if (task.companyId !== String(companyId)) return
            navigate({ taskId: task.requestId, companyId, view: "sources" })
            onTaskFocus?.(task)
          }}
          onTaskFocus={onTaskFocus}
          onBack={() => {
            setLocation(null)
            if (syncUrl) {
              const url = new URL(window.location.href)
              for (const name of [
                "importTask",
                "importCompany",
                "importView",
                "sourceReview",
                "sourceReviewCompany",
                "sourceReviewItem",
                "sourceReviewRevision",
              ])
                url.searchParams.delete(name)
              if (url.hash === "#import-task") url.hash = ""
              window.history.replaceState(window.history.state, "", url)
            }
          }}
        />
        {history}
      </div>
    )

  return (
    <div className="min-w-0 space-y-6">
      {history ? (
        <nav
          className="flex flex-wrap gap-x-5 gap-y-1 border-b pb-2"
          aria-label={t("settings.importTask.shortcuts", {
            defaultValue: "Data import shortcuts",
          })}
        >
          <a
            href="#start-import"
            className="inline-flex min-h-9 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("settings.importTask.startShortcut", {
              defaultValue: "Start import",
            })}
          </a>
          <a
            href="#continue-import"
            className="inline-flex min-h-9 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("settings.importTask.continueShortcut", {
              defaultValue: "Continue saved import",
            })}
          </a>
          {historyLink}
          <a
            href="#guided-import"
            className="inline-flex min-h-9 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("settings.importTask.guidedShortcut", {
              defaultValue: "Guided import and review",
            })}
          </a>
        </nav>
      ) : null}
      {!initialReviewId || taskId ? (
        <SavedImportEntries
          scope={scope}
          onSelect={(id) =>
            navigate({ taskId: id, companyId, view: "sources" })
          }
        />
      ) : null}
      {history}
      <LegacyWorkspace
        organizationId={organizationId}
        initialReviewId={initialReviewId}
      />
    </div>
  )
}

function SavedImportEntries({
  scope,
  onSelect,
}: {
  scope: SavedImportScope
  onSelect: (id: string) => void
}) {
  const query = useSavedImportTaskList(scope)
  const canUseIntake =
    query.isSuccess && (!query.isFetching || query.isFetchingNextPage)
  return (
    <>
      <SavedImportTaskIntake
        scope={scope}
        onSaved={onSelect}
        available={canUseIntake}
      />
      <SavedImportTaskPicker query={query} onSelect={onSelect} />
    </>
  )
}

function LegacyWorkspace({
  organizationId,
  initialReviewId,
}: {
  organizationId: number
  initialReviewId?: string
}) {
  const wizard = useRef<GuidedImportWizardHandle>(null)
  const [continuationBlock, setContinuationBlock] =
    useState<GuidedImportContinuationBlock>(null)
  const [reviewId, setReviewId] = useState<string | undefined>(initialReviewId)
  return (
    <div
      id="guided-import"
      tabIndex={-1}
      className="flex min-w-0 scroll-mt-6 flex-col gap-8"
    >
      <GuidedImportWizard
        ref={wizard}
        organizationId={organizationId}
        onReviewSaved={setReviewId}
        onContinuationBlockChange={setContinuationBlock}
      />
      <ImportReviewWorkspace
        organizationId={organizationId}
        selectedId={reviewId}
        continuationBlock={continuationBlock}
        onContinue={(source) => {
          void wizard.current?.continueFromReview(source)
        }}
      />
    </div>
  )
}
