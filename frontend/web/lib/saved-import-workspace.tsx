"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "@lumiere/i18n"
import { Badge } from "@lumiere/ui/components/badge"
import { useCompanies } from "@lumiere/query-hooks/hooks/organization-company"
import { useImportReviewCheckpoint } from "./use-import-review-checkpoint"
import { savedImportGoal, savedImportOperatorState, savedImportQueueLabel } from "./saved-import-operator"
import { useSavedImportRuns } from "./use-saved-import-runs"
import { ChatDecisionCard } from "@lumiere/ui"
import { importTaskNextView } from "@lumiere/ui/ai-chat/import-task-status-card"
import { FileIdentity } from "@lumiere/ui/components/file-identity"
import { Button } from "@lumiere/ui/components/button"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@lumiere/ui/components/tabs"
import {
  GuidedImportWizard,
  type GuidedImportContinuationBlock,
  type GuidedImportWizardHandle,
} from "./guided-import-wizard"
import { ImportReviewWorkspace } from "./import-review-workspace"
import { ImportTaskExecutionPanel } from "./import-task-execution-panel"
import {
  ImportDestinationSupport,
  ImportTaskProgress,
} from "./import-task-progress"
import { importWorkflowKey, useImportWorkflow } from "./use-import-workflow"
import {
  importTaskHref,
  isImportTaskView,
  pendingImportReviewId,
  pendingImportReviews,
  type ImportTaskView,
} from "./import-task-navigation"
import {
  useSavedImportTask,
  type SavedImportScope,
} from "./use-saved-import-task"
import type { ReviewedImportSource } from "./import-review-model"
import {
  canPrepareInspectedImport,
  chatImportReceiptKey,
  type ChatImportTask,
} from "./chat-import-task"
import { DocumentViewerDialog } from "../components/document-viewer-dialog"
import { ImportTaskHandoff } from "./import-task-handoff"
import { ImportPreparationPanel } from "./import-preparation-panel"
import type { ImportPreparationSection } from "./import-preparation"

export function SavedImportWorkspace({
  scope,
  taskId,
  view,
  initialReviewId,
  reviewFilter,
  resumeAtNextStep = false,
  preparationTarget,
  inspectionOnly = false,
  onNavigate,
  onBack,
  onTaskChange,
  onTaskFocus,
}: {
  scope: SavedImportScope
  taskId: string
  view: ImportTaskView
  initialReviewId?: string
  reviewFilter?: "needs_review"
  resumeAtNextStep?: boolean
  preparationTarget?: ImportPreparationSection["targetEntity"]
  inspectionOnly?: boolean
  onNavigate: (view: ImportTaskView, reviewId?: string, reviewFilter?: "needs_review") => void
  onBack: () => void
  onTaskChange: (task: ChatImportTask) => void
  onTaskFocus?: (task: ChatImportTask) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const saved = useSavedImportTask(scope, taskId)
  const task = saved.task
  const companies = useCompanies(scope.organizationId, !!task)
  const company = companies.isSuccess ? companies.data.find(row => String(row.id) === String(scope.companyId))?.name : undefined
  const runs = useSavedImportRuns(scope, taskId, task?.status === "needs_review")
  const runProgress = runs.isSuccess ? runs.data ?? undefined : undefined
  const runStamp = runProgress?.runs.map(run => `${run.id}:${run.status}`).join(",")
  const previousRunStamp = useRef<string | undefined>(undefined)
  const workflowScope = {
    organizationId: scope.organizationId,
    companyId: scope.companyId,
    taskId,
  }
  const canReview = task?.handoff?.canReview ?? true
  const workflow = useImportWorkflow(scope.identity, workflowScope, !!task && canReview)
  const workflowData = workflow.isError ? undefined : workflow.data
  const checkpoint = useImportReviewCheckpoint(scope, taskId, !!task && canReview)
  const checkpointReview = checkpoint.isSuccess && checkpoint.data.status === "saved"
    ? checkpoint.data.checkpoint?.reviewId : undefined
  const [autoResumeReview, setAutoResumeReview] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!runStamp || previousRunStamp.current === runStamp) return
    const previous = previousRunStamp.current
    previousRunStamp.current = runStamp
    if (previous && runProgress?.runs.some(run => !["queued", "running"].includes(run.status))) {
      void queryClient.invalidateQueries({
        queryKey: importWorkflowKey(scope.identity, { organizationId: scope.organizationId, companyId: scope.companyId, taskId }),
      })
    }
  }, [queryClient, runProgress, runStamp, scope.identity, scope.organizationId, scope.companyId, taskId])
  useEffect(() => {
    if (task) onTaskFocus?.(task)
  }, [task, onTaskFocus])
  const [reviewId, setReviewId] = useState(initialReviewId)
  useEffect(() => setReviewId(initialReviewId), [initialReviewId])
  const [executionView, setExecutionView] = useState<"preview" | "results">(
    view === "results" ? "results" : "preview",
  )
  const [nativePreview, setNativePreview] = useState(false)
  const [sourcePreview, setSourcePreview] = useState<{
    documentId: string
    versionId: string
  } | null>(null)
  const managedSource = task?.preparation?.files.find(
    (file) => file.managedSelection,
  )
  const managedSelection = managedSource?.managedSelection
  const managedDocument = task?.managedDocument ?? managedSelection
  const [continuationBlock, setContinuationBlock] =
    useState<GuidedImportContinuationBlock>(null)
  const lastContinuationBlock = useRef<GuidedImportContinuationBlock>(null)
  const onContinuationBlockChange = useCallback(
    (next: GuidedImportContinuationBlock) => {
      const previous = lastContinuationBlock.current
      lastContinuationBlock.current = next
      setContinuationBlock(next)
      if (previous !== null && next === null) {
        void queryClient.invalidateQueries({
          queryKey: importWorkflowKey(scope.identity, {
            organizationId: scope.organizationId,
            companyId: scope.companyId,
            taskId,
          }),
        })
      }
    },
    [
      queryClient,
      scope.identity,
      scope.organizationId,
      scope.companyId,
      taskId,
    ],
  )
  const wizard = useRef<GuidedImportWizardHandle>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const handoffPanel = useRef<HTMLDivElement>(null)
  const reviews = task?.reviews
  const pendingReviews = pendingImportReviews(reviews)
  const allowedReviewIds = useMemo(
    () => reviews?.map((review) => review.id) ?? [],
    [reviews],
  )
  const eligibleCheckpointReview = checkpointReview && allowedReviewIds.includes(checkpointReview) ? checkpointReview : undefined
  const selectedReviewId = reviewId && allowedReviewIds.includes(reviewId)
    ? reviewId
    : ((!initialReviewId && view !== "preview" ? eligibleCheckpointReview : undefined) ??
      (view === "preview" ? reviews?.find(review => review.confirmed > 0)?.id : pendingImportReviewId(reviews)) ??
      allowedReviewIds[0])
  const counts = useMemo(
    () =>
      (reviews ?? []).reduce(
        (totals, review) => ({
          total: totals.total + review.total,
          pending: totals.pending + review.pending,
          confirmed: totals.confirmed + review.confirmed,
          excluded: totals.excluded + review.excluded,
        }),
        { total: 0, pending: 0, confirmed: 0, excluded: 0 },
      ),
    [reviews],
  )
  const preparationApproved =
    task?.decision.status === "approved" &&
    task.decision.selectedOptionId === "prepare_import"
  const allowImport = !inspectionOnly && canReview && preparationApproved
  const nextView = importTaskNextView({
    preparationStatus:
      inspectionOnly && task?.status === "needs_review"
        ? "inspection_ready"
        : (task?.status ?? "saved"),
    sourceRows: {
      total: counts.total,
      ready: counts.confirmed,
      held: counts.pending,
      excluded: counts.excluded,
    },
    hasPreparedProposal: !!workflowData?.proposals.some(
      (proposal) => proposal.status === "prepared",
    ),
    hasResults: !!(
      workflowData?.proposals.some(
        (proposal) => proposal.approvedAt !== null,
      ) ||
      workflowData?.nativeResults.length ||
      workflowData?.backfilledRecords?.some((result) => result.count > 0) ||
      workflowData?.farmResults?.some((result) => result.count > 0)
    ),
  })
  const nextDecisionReviewId = (!initialReviewId ? eligibleCheckpointReview : undefined) ??
    pendingImportReviewId(reviews) ?? selectedReviewId
  const nextReviewId = nextView === "preview"
    ? reviews?.find(item => item.confirmed > 0)?.id ?? selectedReviewId : nextDecisionReviewId
  const resumeView = !initialReviewId && eligibleCheckpointReview ? "decisions"
    : runProgress?.runs.length ? "results" : nextView
  const resumeReviewId = resumeView === "decisions" ? nextDecisionReviewId : nextReviewId
  useEffect(() => {
    if (!resumeAtNextStep || !task || saved.busy || !canReview ||
        (!initialReviewId && checkpoint.isPending) || workflow.isPending || workflow.isFetching ||
        (task.status === "needs_review" && runs.isPending)) return
    if (!allowImport && (resumeView === "preview" || resumeView === "results")) return
    if (resumeView === "decisions" && !initialReviewId && resumeReviewId === eligibleCheckpointReview) {
      setAutoResumeReview(eligibleCheckpointReview)
    }
    onNavigate(resumeView, resumeReviewId)
  }, [
    resumeAtNextStep, task, saved.busy, initialReviewId, checkpoint.isPending,
    eligibleCheckpointReview, workflow.isPending, workflow.isFetching, runs.isPending,
    allowImport, canReview, resumeView, resumeReviewId, onNavigate,
  ])
  useEffect(() => {
    if (view === "preview" || view === "results") setExecutionView(view)
  }, [view])

  const navigate = (
    nextView: ImportTaskView,
    nextReviewId = selectedReviewId,
    focus = false,
    filter?: "needs_review",
  ) => {
    if (nextView === "preview" || nextView === "results")
      setExecutionView(nextView)
    if (nextReviewId) setReviewId(nextReviewId)
    onNavigate(nextView, nextReviewId, filter)
    if (focus) heading.current?.focus()
  }
  const continueImport = async (source: ReviewedImportSource) => {
    if (!allowImport) return
    const trackedTask = ["product", "contact", "stock_location"].includes(source.targetEntity)
      ? taskId
      : undefined
    if (await wizard.current?.continueFromReview(source, trackedTask)) {
      setNativePreview(true)
      navigate("preview", selectedReviewId, true)
    }
  }
  const refreshTask = () => {
    void saved.reload()
    void queryClient.invalidateQueries({
      queryKey: chatImportReceiptKey(scope, taskId),
    })
  }

  if (!task)
    return (
      <section className="space-y-3" aria-busy={saved.busy}>
        <Button type="button" variant="ghost" onClick={onBack}>
          {t("settings.importTask.back", {
            defaultValue: "Back to saved imports",
          })}
        </Button>
        {saved.error ? (
          <p role="alert" className="text-sm text-destructive">
            {saved.error}
          </p>
        ) : (
          <p role="status">
            {t("settings.importTask.loading", {
              defaultValue: "Checking the saved import…",
            })}
          </p>
        )}
        {saved.error ? (
          <Button
            type="button"
            variant="outline"
            disabled={saved.busy}
            onClick={() => void saved.reload()}
          >
            {t("common.refresh", { defaultValue: "Refresh" })}
          </Button>
        ) : null}
      </section>
    )

  const canPrepare =
    !inspectionOnly && !saved.pointer && canPrepareInspectedImport(task)
  const { action, queue } = savedImportOperatorState({
    task, progress: runProgress, workflow: workflowData, pendingAnswer: !!saved.pointer,
    runCheckFailed: runs.isError, canPrepare, nextView,
  })
  const primaryLabel = {
    check: t("settings.importOperator.checkResult"),
    handoff: t("settings.importOperator.openHandoff"),
    prepare: t("aiChat.import.approvePreparation"),
    resume: preparationApproved ? t("aiChat.import.resume") : t("aiChat.import.resumeInspection"),
    sources: t("settings.importTask.nextSources"),
    decisions: t("settings.importTask.nextDecisions"),
    preview: t("settings.importTask.nextPreview"),
    results: t("settings.importOperator.openResults"),
  }[action]
  const canOpenStage = canReview && ((action !== "preview" && action !== "results") || allowImport)
  const showPrimary = action === "check" || action === "handoff" ||
    (canOpenStage && (action === "prepare" || action === "resume" || action !== view))
  const checkSavedResult = () => {
    refreshTask()
    if (canReview) void workflow.refetch()
    if (task.status === "needs_review") void runs.refetch()
  }
  const runPrimaryAction = () => {
    switch (action) {
      case "check": checkSavedResult(); break
      case "handoff": handoffPanel.current?.focus(); break
      case "prepare":
        void saved.answer({
          requestId: task.decision.id, expectedRevision: task.decision.revision, optionId: "prepare_import",
        }).catch(() => undefined)
        break
      case "resume": void saved.resume().catch(() => undefined); break
      default:
        if (action === "decisions" && !initialReviewId && eligibleCheckpointReview) setAutoResumeReview(eligibleCheckpointReview)
        navigate(action, action === "decisions" ? nextDecisionReviewId : nextReviewId, true)
    }
  }
  const verifiedRows = runProgress?.coverage.verifiedRowCount ?? 0
  const latestRun = runProgress?.runs[0]

  return (
    <section
      id="import-task"
      className="min-w-0 space-y-4"
      aria-busy={saved.busy}
      data-testid="saved-import-workspace"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2
            ref={heading}
            tabIndex={-1}
            className="break-words text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {savedImportGoal(t, task, workflowData)}
          </h2>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {task.status === "needs_review" && runs.isPending
              ? <span className="text-muted-foreground">{t("settings.importOperator.checkingResult")}</span>
              : <Badge variant="outline" data-import-queue={queue}>{savedImportQueueLabel(t, queue)}</Badge>}
            <span>{company || t("settings.importOperator.company", { id: scope.companyId })}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("settings.importTask.originalFiles", {
              defaultValue: "{{count}} original files",
              count: task.files.length,
            })}
            {managedDocument && <> · {t("settings.importOperator.sourceVersion", { id: managedDocument.versionId })}</>}
          </p>
          <a
            className="text-sm underline underline-offset-4"
            href={importTaskHref({
              taskId,
              companyId: scope.companyId,
              view,
              reviewId: selectedReviewId,
            })}
          >
            {t("settings.importTask.permalink", {
              defaultValue: "Open this task in Data import",
            })}
          </a>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={saved.busy}
            onClick={onBack}
          >
            {t("settings.importTask.back", {
              defaultValue: "Back to saved imports",
            })}
          </Button>
          {action !== "check" && <Button type="button" variant="outline" disabled={saved.busy} onClick={checkSavedResult}>
            {t("common.refresh", { defaultValue: "Refresh" })}
          </Button>}
          {showPrimary && <Button
            type="button"
            disabled={saved.busy || (action === "check" && (workflow.isFetching || runs.isFetching))}
            onClick={runPrimaryAction}
            data-testid="saved-import-primary-action"
          >
            {primaryLabel}
          </Button>}
        </div>
      </header>
      {task.handoff && (
        <div ref={handoffPanel} tabIndex={-1} className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ImportTaskHandoff
            key={`${scope.identity}:${scope.companyId}:${taskId}:${task.handoff.revision}`}
            scope={scope}
            taskId={taskId}
            handoff={task.handoff}
            disabled={saved.busy}
            onChange={() => void saved.reload()}
          />
        </div>
      )}
      {verifiedRows > 0 && <p className="text-sm" role="status">{t("settings.importOperator.verifiedSourceRows", { rows: verifiedRows })}</p>}
      {latestRun && (latestRun.failedRows > 0 || latestRun.heldRows > 0) && (
        <p className="text-sm text-muted-foreground" role="status">{t("settings.importOperator.latestRunExceptions", { failed: latestRun.failedRows, held: latestRun.heldRows })}</p>
      )}
      {queue === "running" && <p className="text-sm text-muted-foreground" role="status">{t("settings.importOperator.serverRunning")}</p>}
      {runs.isError && <p className="text-sm text-muted-foreground" role="status">{t("settings.importOperator.runUnavailable")}</p>}
      {queue === "needs-me" && runProgress?.runs.some(run => ["partial", "failed", "blocked"].includes(run.status)) && (
        <p className="text-sm text-muted-foreground" role="status">{t("settings.importOperator.runNeedsAttention")}</p>
      )}
      {canReview && <ImportTaskProgress
        files={task.files.length}
        rows={counts}
        workflow={workflowData}
        resultsAvailable={allowImport}
        onNavigate={(next) => navigate(next, selectedReviewId, true)}
      />}
      {saved.busy ? (
        <p role="status" className="text-sm">
          {t("settings.importTask.checking", {
            defaultValue: "Checking the saved task and its decisions…",
          })}
        </p>
      ) : null}
      <Tabs
        value={
          !canReview || (!allowImport && (view === "preview" || view === "results"))
            ? "sources"
            : view
        }
        onValueChange={(value) => {
          if (isImportTaskView(value)) navigate(value)
        }}
      >
        <TabsList
          scrollable
          aria-label={t("settings.importTask.stages", {
            defaultValue: "Import task stages",
          })}
        >
          <TabsTrigger value="sources">
            {t("settings.importTask.sources", { defaultValue: "Sources" })}
          </TabsTrigger>
          <TabsTrigger value="decisions" disabled={!canReview}>
            {t("settings.importTask.decisions", { defaultValue: "Decisions" })}
          </TabsTrigger>
          <TabsTrigger value="preview" disabled={!allowImport}>
            {t("settings.importTask.preview", { defaultValue: "ERP preview" })}
          </TabsTrigger>
          <TabsTrigger value="results" disabled={!allowImport}>
            {t("settings.importTask.results", { defaultValue: "ERP results" })}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="sources" keepMounted className="space-y-4">
          {canReview && <ImportDestinationSupport
            capabilities={workflowData?.capabilities}
            failed={workflow.isError}
            onRetry={() => void workflow.refetch()}
          />}
          {managedDocument && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <p>
                {managedSelection
                  ? t("documents.viewer.savedSelection", {
                      defaultValue:
                        "Selected source · {{sheet}} · R{{firstRow}}C{{firstColumn}}:R{{lastRow}}C{{lastColumn}}",
                      sheet: managedSelection.sheetName,
                      firstRow: managedSelection.firstRow,
                      lastRow: managedSelection.lastRow,
                      firstColumn: managedSelection.firstColumn,
                      lastColumn: managedSelection.lastColumn,
                    })
                  : t("documents.viewer.savedDocumentVersion", {
                      defaultValue: "Source saved from Documents",
                    })}
              </p>
              {(task.handoff?.canManage ?? true) && <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setSourcePreview({
                    documentId: managedDocument.documentId,
                    versionId: managedDocument.versionId,
                  })
                }
              >
                {t("documents.viewer.openSourceVersion", {
                  defaultValue: "Open source version",
                })}
              </Button>}
            </div>
          )}
          {sourcePreview &&
            managedDocument?.documentId === sourcePreview.documentId &&
            managedDocument.versionId === sourcePreview.versionId && (
              <DocumentViewerDialog
                organizationId={BigInt(scope.organizationId)}
                documentId={sourcePreview.documentId}
                versionId={sourcePreview.versionId}
                recordHref={`/documents/${sourcePreview.documentId}?tab=versions`}
                onOpenChange={(open) => {
                  if (!open) setSourcePreview(null)
                }}
              />
            )}
          <ul className="space-y-2">
            {task.files.map((file) => (
              <li
                key={file.ordinal}
                className="min-w-0 rounded-lg border p-3 text-sm"
              >
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <FileIdentity
                    fileName={file.fileName}
                    size={file.size}
                    status={t("settings.importTask.sourceSaved", {
                      defaultValue: "Original saved",
                    })}
                    className="flex-1 basis-48"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={
                      <a
                        href={`/api/import-tasks/${taskId}/files/${file.ordinal}?companyId=${scope.companyId}`}
                        download={file.fileName}
                      />
                    }
                    aria-label={t("settings.importTask.downloadNamed", {
                      defaultValue: "Download {{fileName}}",
                      fileName: file.fileName,
                    })}
                  >
                    {t("settings.importTask.download", {
                      defaultValue: "Download",
                    })}
                  </Button>
                </div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    {t("settings.importTask.sourceFingerprint", {
                      defaultValue: "Source fingerprint",
                    })}
                  </summary>
                  <code className="break-all text-xs">{file.sha256}</code>
                </details>
                {file.previousMatch ? (
                  <p className="mt-1 text-muted-foreground">
                    {file.previousMatch.kind === "identical"
                      ? t("aiChat.import.identicalEarlierSource")
                      : t("aiChat.import.changedEarlierSource")}{" "}
                    <a
                      className="underline underline-offset-4"
                      href={importTaskHref({
                        taskId: file.previousMatch.requestId,
                        companyId: scope.companyId,
                        view: "sources",
                      })}
                    >
                      {t("settings.importTask.openEarlier", {
                        defaultValue: "Open the earlier import",
                      })}
                    </a>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {task.warnings.length ? (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {task.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          ) : null}
          {task.error ? (
            <p role="alert" className="text-sm text-destructive">
              {task.error}
            </p>
          ) : null}
          {saved.pointer ? (
            <div className="space-y-2 rounded-lg border p-3 text-sm">
              <p>
                {t("aiChat.import.decisionUncertain", {
                  defaultValue:
                    "This answer has no confirmed receipt yet. Check saved imports or retry the same saved answer before changing it.",
                })}
              </p>
              <p>
                {t("aiChat.import.savedAnswer", {
                  defaultValue: "Saved answer: {{answer}}",
                  answer:
                    saved.pointer.optionId === "other"
                      ? t("aiChat.decision.other", { defaultValue: "Other" })
                      : task.decision.options.find(
                          (option) => option.id === saved.pointer?.optionId,
                        )?.label,
                })}
              </p>
              {saved.pointer.otherText ? (
                <p className="whitespace-pre-wrap">{saved.pointer.otherText}</p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                disabled={saved.busy}
                onClick={() => {
                  void saved.retryDecision().catch(() => undefined)
                }}
              >
                {t("aiChat.import.retryDecision", {
                  defaultValue: "Retry saved answer",
                })}
              </Button>
            </div>
          ) : task.status === "awaiting_decision" ? (
            <ChatDecisionCard
              request={task.decision}
              scopeKey={JSON.stringify([
                scope.identity,
                scope.organizationId,
                scope.companyId,
                taskId,
              ])}
              disabled={saved.busy}
              submitLabels={{
                prepare_import: t("aiChat.import.approvePreparation", {
                  defaultValue: "Approve preparation",
                }),
                inspect_only: t("aiChat.import.approveInspection", {
                  defaultValue: "Approve inspection",
                }),
                other: t("aiChat.import.sendInstructions", {
                  defaultValue: "Send instructions",
                }),
              }}
              onSubmit={saved.answer}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {preparationApproved
                ? t("aiChat.import.preparationApproved", {
                    defaultValue:
                      "You approved import preparation. Creating business records still requires a separate review and confirmation.",
                  })
                : t("aiChat.import.inspectionApproved", {
                    defaultValue:
                      "You approved inspection only. No business-record import was authorized.",
                  })}
            </p>
          )}
          {task.handoff && task.decisionHistory.some((answer) => answer.actor) && (
            <details className="text-sm">
              <summary className="cursor-pointer">{t("settings.importHandoff.decisionActors")}</summary>
              <ul className="mt-2 space-y-1">
                {task.decisionHistory.filter((answer) => answer.actor).map((answer) => (
                  <li key={answer.decisionId} className="break-all">
                    {t("settings.importHandoff.decisionActor", { revision: answer.revision, actor: answer.actor })}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {task.decisionHistory.some(
            (answer) => answer.optionId === "other",
          ) ? (
            <p className="text-sm text-muted-foreground">
              {t("aiChat.import.instructionsSaved", {
                defaultValue:
                  "Your instructions are saved as a note. Custom instructions are not applied automatically when you choose a supported action.",
              })}
            </p>
          ) : null}
          {task.decision.otherText ? (
            <p className="whitespace-pre-wrap text-sm">
              {task.decision.otherText}
            </p>
          ) : null}
          {allowImport && !managedSelection && task.handoff?.canManage !== false ? (
            <ImportPreparationPanel
              task={task}
              defaultDestination={preparationTarget}
              organizationId={scope.organizationId}
              companyId={scope.companyId}
              onPrepared={onTaskChange}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="decisions" keepMounted>
          {canReview && selectedReviewId ? (
            <ImportReviewWorkspace
              key={`${selectedReviewId}:${reviewFilter ?? ""}`}
              organizationId={scope.organizationId}
              selectedId={selectedReviewId}
              allowedReviewIds={allowedReviewIds}
              historySource={
                task
                  ? { taskId: task.requestId, sessionKey: task.conversationKey }
                  : undefined
              }
              resumeCheckpoint={reviewFilter == null && selectedReviewId === eligibleCheckpointReview &&
                (!initialReviewId || autoResumeReview === selectedReviewId)}
              allowUpload={false}
              syncUrl={false}
              allowImport={allowImport}
              continuationBlock={continuationBlock}
              onContinue={(source) => {
                void continueImport(source)
              }}
              onSelectedIdChange={(id) => {
                setAutoResumeReview(undefined)
                setReviewId(id)
                onNavigate("decisions", id)
              }}
              onChanged={() => {
                void queryClient.invalidateQueries({
                  queryKey: ["import-workflow-source"],
                })
                refreshTask()
              }}
            />
          ) : (
            <p className="py-3 text-sm text-muted-foreground">
              {t("settings.importTask.noReviews", {
                defaultValue:
                  "Choose how to use the saved files in Sources. Prepared review groups will appear here.",
              })}
            </p>
          )}
        </TabsContent>
        <TabsContent value={executionView} keepMounted className="space-y-4">
          {allowImport ? (
            <>
              {executionView === "preview" && reviews && reviews.length > 1 ? (
                <label className="grid max-w-lg gap-1 text-sm">
                  {t("settings.importTask.previewReviewGroup", {
                    defaultValue: "Source group to preview",
                  })}
                  <select
                    className="rounded-md border bg-background px-2 py-2"
                    value={selectedReviewId}
                    onChange={(event) =>
                      navigate("preview", event.currentTarget.value)
                    }
                  >
                    {reviews.map((item) => (
                      <option key={item.id} value={item.id}>
                        {t("settings.importTask.previewReviewOption", {
                          defaultValue:
                            "{{title}} · {{confirmed}} confirmed · {{pending}} need review",
                          title: item.title,
                          confirmed: item.confirmed,
                          pending: item.pending,
                        })}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {executionView === "results" && pendingReviews.length > 0 && (
                <section className="space-y-2 rounded-md border p-3" aria-label={t("settings.importWorkflow.pendingSourceTitle")}>
                  <h3 className="font-medium">{t("settings.importWorkflow.pendingSourceTitle")}</h3>
                  <ul className="space-y-1">
                    {pendingReviews.map(review => (
                      <li key={review.id}>
                        <Button type="button" variant="link" className="h-auto min-h-9 whitespace-normal px-0 text-left" onClick={() =>
                          navigate("decisions", review.id, true, "needs_review")
                        }>
                          {t("settings.importWorkflow.openPendingSource", { title: review.title, rows: review.pending })}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <ImportTaskExecutionPanel
                organizationId={scope.organizationId}
                companyId={scope.companyId}
                taskId={taskId}
                reviewId={selectedReviewId}
                view={executionView}
                onReviewSource={(id) => {
                  if (allowedReviewIds.includes(id))
                    navigate("decisions", id, true)
                }}
                onChanged={refreshTask}
              />
              <div
                hidden={!nativePreview && continuationBlock !== "unresolved"}
              >
                <GuidedImportWizard
                  ref={wizard}
                  organizationId={scope.organizationId}
                  onContinuationBlockChange={onContinuationBlockChange}
                />
              </div>
            </>
          ) : null}
        </TabsContent>
      </Tabs>
    </section>
  )
}
