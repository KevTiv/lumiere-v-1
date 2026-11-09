"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "@lumiere/i18n"
import { ChatDecisionCard } from "@lumiere/ui"
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
  importTaskHref,
  isImportTaskView,
  type ImportTaskView,
} from "./import-task-navigation"
import {
  useSavedImportTask,
  type SavedImportScope,
} from "./use-saved-import-task"
import type { ReviewedImportSource } from "./import-review-model"
import type { ChatImportTask } from "./chat-import-task"
import { DocumentViewerDialog } from "../components/document-viewer-dialog"
import { ImportPreparationPanel } from "./import-preparation-panel"

export function SavedImportWorkspace({
  scope,
  taskId,
  view,
  initialReviewId,
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
  inspectionOnly?: boolean
  onNavigate: (view: ImportTaskView, reviewId?: string) => void
  onBack: () => void
  onTaskChange: (task: ChatImportTask) => void
  onTaskFocus?: (task: ChatImportTask) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const saved = useSavedImportTask(scope, taskId)
  const task = saved.task
  useEffect(() => {
    if (task) onTaskFocus?.(task)
  }, [task, onTaskFocus])
  const [reviewId, setReviewId] = useState(initialReviewId)
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
          queryKey: [
            "import-workflow",
            scope.identity,
            scope.organizationId,
            scope.companyId,
            taskId,
          ],
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
  const reviews = task?.reviews
  const allowedReviewIds = useMemo(
    () => reviews?.map((review) => review.id) ?? [],
    [reviews],
  )
  const selectedReviewId =
    reviewId && allowedReviewIds.includes(reviewId)
      ? reviewId
      : allowedReviewIds[0]
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
  const allowImport =
    !inspectionOnly &&
    task?.decision.status === "approved" &&
    task.decision.selectedOptionId === "prepare_import"
  useEffect(() => {
    if (view === "preview" || view === "results") setExecutionView(view)
  }, [view])

  const navigate = (
    nextView: ImportTaskView,
    nextReviewId = selectedReviewId,
    focus = false,
  ) => {
    if (nextView === "preview" || nextView === "results")
      setExecutionView(nextView)
    if (nextReviewId) setReviewId(nextReviewId)
    onNavigate(nextView, nextReviewId)
    if (focus) heading.current?.focus()
  }
  const continueImport = async (source: ReviewedImportSource) => {
    if (!allowImport) return
    if (await wizard.current?.continueFromReview(source)) {
      setNativePreview(true)
      navigate("preview", selectedReviewId, true)
    }
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

  const nextView: ImportTaskView =
    task.status === "awaiting_decision" || !reviews?.length
      ? "sources"
      : counts.pending > 0 || !allowImport
        ? "decisions"
        : "preview"
  const nextLabel =
    nextView === "sources"
      ? t("settings.importTask.nextSources", {
          defaultValue: "Review files and choose an action",
        })
      : nextView === "decisions"
        ? t("settings.importTask.nextDecisions", {
            defaultValue: "Review source decisions",
          })
        : t("settings.importTask.nextPreview", {
            defaultValue: "Review ERP options",
          })

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
            className="text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("settings.importTask.title", { defaultValue: "Saved import" })}
          </h2>
          <p className="break-words text-sm text-muted-foreground">
            {task.files.map((file) => file.fileName).join(" · ")}
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
          <Button
            type="button"
            variant="outline"
            disabled={saved.busy}
            onClick={() => void saved.reload()}
          >
            {t("common.refresh", { defaultValue: "Refresh" })}
          </Button>
          <Button
            type="button"
            disabled={saved.busy}
            onClick={() => navigate(nextView, selectedReviewId, true)}
          >
            {nextLabel}
          </Button>
        </div>
      </header>
      <dl className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">
            {t("settings.importTask.reviewRows", {
              defaultValue: "Review rows",
            })}
          </dt>
          <dd className="font-medium">{counts.total}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {t("settings.importTask.unresolved", {
              defaultValue: "Needs a decision",
            })}
          </dt>
          <dd className="font-medium">{counts.pending}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {t("settings.importTask.confirmed", {
              defaultValue: "Confirmed review rows",
            })}
          </dt>
          <dd className="font-medium">{counts.confirmed}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {t("settings.importTask.excluded", {
              defaultValue: "Excluded with a reason",
            })}
          </dt>
          <dd className="font-medium">{counts.excluded}</dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">
        {t("settings.importTask.confirmationBoundary", {
          defaultValue:
            "Confirmed source facts are ready for review. ERP creation and verified results are tracked separately.",
        })}
      </p>
      {saved.busy ? (
        <p role="status" className="text-sm">
          {t("settings.importTask.checking", {
            defaultValue: "Checking the saved task and its decisions…",
          })}
        </p>
      ) : null}
      <Tabs
        value={
          !allowImport && (view === "preview" || view === "results")
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
          <TabsTrigger value="decisions">
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
          {managedSelection && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <p>
                {t("documents.viewer.savedSelection", {
                  defaultValue:
                    "Selected source · {{sheet}} · R{{firstRow}}C{{firstColumn}}:R{{lastRow}}C{{lastColumn}}",
                  sheet: managedSelection.sheetName,
                  firstRow: managedSelection.firstRow,
                  lastRow: managedSelection.lastRow,
                  firstColumn: managedSelection.firstColumn,
                  lastColumn: managedSelection.lastColumn,
                })}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setSourcePreview({
                    documentId: managedSelection.documentId,
                    versionId: managedSelection.versionId,
                  })
                }
              >
                {t("documents.viewer.openSourceVersion", {
                  defaultValue: "Open source version",
                })}
              </Button>
            </div>
          )}
          {sourcePreview &&
            managedSelection?.documentId === sourcePreview.documentId &&
            managedSelection.versionId === sourcePreview.versionId && (
              <DocumentViewerDialog
                organizationId={BigInt(scope.organizationId)}
                documentId={sourcePreview.documentId}
                versionId={sourcePreview.versionId}
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
                <a
                  className="break-words font-medium underline underline-offset-4"
                  href={
                    "/api/import-tasks/" +
                    taskId +
                    "/files/" +
                    file.ordinal +
                    "?companyId=" +
                    scope.companyId
                  }
                  download={file.fileName}
                >
                  {file.fileName}
                </a>
                <p className="text-xs text-muted-foreground">
                  {t("settings.importTask.savedBytes", {
                    defaultValue: "Original file saved · {{bytes}} bytes",
                    bytes: file.size,
                  })}
                </p>
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
              {allowImport
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
          {task.status === "saved" ? (
            <Button
              type="button"
              variant="outline"
              disabled={saved.busy}
              onClick={() => {
                void saved.resume().catch(() => undefined)
              }}
            >
              {allowImport
                ? t("aiChat.import.resume", {
                    defaultValue: "Resume preparation",
                  })
                : t("aiChat.import.resumeInspection", {
                    defaultValue: "Resume inspection",
                  })}
            </Button>
          ) : null}
          {allowImport && !managedSelection ? (
            <ImportPreparationPanel
              task={task}
              organizationId={scope.organizationId}
              companyId={scope.companyId}
              onPrepared={onTaskChange}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="decisions" keepMounted>
          {selectedReviewId ? (
            <ImportReviewWorkspace
              organizationId={scope.organizationId}
              selectedId={selectedReviewId}
              allowedReviewIds={allowedReviewIds}
              allowUpload={false}
              syncUrl={false}
              allowImport={allowImport}
              continuationBlock={continuationBlock}
              onContinue={(source) => {
                void continueImport(source)
              }}
              onSelectedIdChange={(id) => {
                setReviewId(id)
                onNavigate("decisions", id)
              }}
              onChanged={() => {
                void queryClient.invalidateQueries({
                  queryKey: ["import-workflow-source"],
                })
                void saved.reload()
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
              <ImportTaskExecutionPanel
                organizationId={scope.organizationId}
                companyId={scope.companyId}
                taskId={taskId}
                reviewId={selectedReviewId}
                view={executionView}
                onChanged={() => {
                  void saved.reload()
                }}
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
