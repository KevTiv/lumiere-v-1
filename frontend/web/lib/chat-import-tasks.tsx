"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "@lumiere/i18n"
import { ChatDecisionCard } from "@lumiere/ui"
import type { ChatDecisionAnswer } from "@lumiere/ui/lib/chat-decision-types"
import type { ChatImportInitialMode } from "@lumiere/ui/lib/chat-import-files"
import { FileIdentity } from "@lumiere/ui/components/file-identity"
import { Button } from "@lumiere/ui/components/button"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@lumiere/ui/components/dialog"
import { apiFetch } from "./api-fetch"
import { ChatImportReceipt, chatImportReceiptKey } from "./chat-import-receipt"
import { ChatReconciliationPreview } from "./chat-reconciliation-preview"
import { DataImportWorkspace } from "./data-import-workspace"
import { SavedImportTaskPicker, useSavedImportTaskList } from "./saved-import-task-picker"
import { importTaskHref, type ImportTaskView } from "./import-task-navigation"
import type { ImportPreparation } from "./import-preparation"
import {
  canPrepareInspectedImport, chatImportScopeKey, listChatImportTasks, parseChatImportTask,
  readChatImportTask, recoverChatImportPointer, recoverChatImportDecision,
  retryChatImportDecision, submitChatImportDecision, submitChatImportFiles,
  type ChatImportDecisionAnswer, type ChatImportDecisionPointer, type ChatImportPointer, type ChatImportScope, type ChatImportTask,
} from "./chat-import-task"

function mergeTask(tasks: ChatImportTask[], task: ChatImportTask): ChatImportTask[] {
  return [task, ...tasks.filter(existing => existing.requestId !== task.requestId)].slice(0, 100)
}

async function resumeImportTask(scope: ChatImportScope, task: ChatImportTask, isCurrent: () => boolean) {
  const response = await apiFetch(
    `/api/import-tasks/${task.requestId}/resume?companyId=${scope.companyId}`,
    { method: "POST" },
  ).catch(() => null)
  if (!isCurrent()) throw new Error("The active import changed.")
  if (response?.ok) {
    return parseChatImportTask(await response.json(), scope, task.requestId)
  }
  const saved = await readChatImportTask(apiFetch, scope, task.requestId)
  if (saved) return saved
  throw new Error("The saved task could not be checked. Reopen it in Data import.")
}

function ChatSavedImportPicker({ scope, onSelect }: {
  scope: ChatImportScope
  onSelect: (taskId: string) => void
}) {
  const tasks = useSavedImportTaskList(scope)
  return <SavedImportTaskPicker query={tasks} onSelect={onSelect} />
}

/** Chat coordinates durable preparation; reviewed records still use the existing import workspace. */
export function useChatImportTasks(args: {
  identity: string | null; organizationId: number; companyId: number | null; conversationKey: string | null;
  renderHistoryDecision?: (task: ChatImportTask) => ReactNode;
  readonly?: boolean;
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const scope = useMemo<ChatImportScope | null>(() => {
    if (!args.identity || !args.companyId || !args.conversationKey) return null
    const candidate = { identity: args.identity, organizationId: args.organizationId, companyId: args.companyId, conversationKey: args.conversationKey }
    try { chatImportScopeKey(candidate); return candidate } catch { return null }
  }, [args.identity, args.organizationId, args.companyId, args.conversationKey])
  const key = scope ? chatImportScopeKey(scope) : null
  const currentScope = useRef({ key, epoch: 0 })
  if (currentScope.current.key !== key) currentScope.current = { key, epoch: currentScope.current.epoch + 1 }
  const epoch = currentScope.current.epoch
  const mounted = useRef(false)
  const running = useRef<{ epoch: number; version: number } | null>(null)
  const authorization = useRef({ epoch, available: false })
  const loadVersion = useRef(0)
  const [state, setState] = useState<{
    key: string | null; epoch: number; tasks: ChatImportTask[]; pointer: ChatImportPointer | null;
    decisionPointers: Record<string, ChatImportDecisionPointer>;
    available: boolean; busy: boolean; error: string | null;
  }>({ key: null, epoch, tasks: [], pointer: null, decisionPointers: {}, available: false, busy: false, error: null })
  const [review, setReview] = useState<{ key: string; epoch: number; taskId: string | null; id?: string; view?: ImportTaskView } | null>(null)
  const [focus, setFocus] = useState<{ key: string; epoch: number; taskId: string | null; task?: ChatImportTask } | null>(null)
  const isCurrent = useCallback(() => mounted.current && currentScope.current.key === key && currentScope.current.epoch === epoch, [key, epoch])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const reload = useCallback(async () => {
    if (!scope || !isCurrent()) return
    const version = ++loadVersion.current
    running.current = null
    authorization.current = { epoch, available: false }
    const current = () => isCurrent() && loadVersion.current === version
    void queryClient.invalidateQueries({ queryKey: chatImportReceiptKey(scope) })
    setState(previous => ({ ...previous, key, epoch, tasks: [], available: false, busy: false, error: null }))
    try {
      const tasks = await listChatImportTasks(apiFetch, scope)
      if (!current()) return
      if (args.readonly) {
        authorization.current = { epoch, available: true }
        setState(previous => ({ ...previous, key, epoch, tasks, pointer: null, decisionPointers: {}, available: true, error: null }))
        return
      }
      const recovered = await recoverChatImportPointer({ scope, storage: window.localStorage, fetcher: apiFetch, isCurrent: current })
      if (!current()) return
      const currentTasks = recovered.task ? mergeTask(tasks, recovered.task) : tasks
      const decisionPointers: Record<string, ChatImportDecisionPointer> = {}
      for (let index = 0; index < currentTasks.length; index++) {
        const answer = await recoverChatImportDecision({ task: currentTasks[index], scope, storage: window.localStorage, fetcher: apiFetch, isCurrent: current })
        if (!current()) return
        currentTasks[index] = answer.task
        if (answer.pointer) decisionPointers[answer.task.requestId] = answer.pointer
      }
      authorization.current = { epoch, available: true }
      setState(previous => ({ ...previous, key, epoch, tasks: currentTasks, pointer: recovered.pointer, decisionPointers, available: true, error: null }))
    } catch (error) {
      if (current()) setState(previous => ({ ...previous, key, tasks: [], pointer: null, available: false, error: error instanceof Error ? error.message : "Saved imports could not be checked." }))
    }
  }, [scope, key, epoch, isCurrent, args.readonly, queryClient])

  useEffect(() => {
    running.current = null
    setState({ key, epoch, tasks: [], pointer: null, decisionPointers: {}, available: false, busy: false, error: null })
    void reload()
  }, [key, epoch, reload])

  const importFiles = useCallback(async (files: File[], intent?: ChatImportInitialMode | ImportPreparation) => {
    if (!scope || !isCurrent() || running.current?.epoch === epoch || authorization.current.epoch !== epoch || !authorization.current.available) throw new Error("Check access to saved imports and wait for the current submission before adding files.")
    const operation = { epoch, version: ++loadVersion.current }
    running.current = operation
    const current = () => isCurrent() && running.current === operation && loadVersion.current === operation.version
    setState(previous => ({ ...previous, busy: true, error: null }))
    const preparation = typeof intent === "object" ? intent : undefined
    const initialMode = typeof intent === "string" ? intent : preparation ? "prepare_import" : "inspect_only"
    try {
      const task = await submitChatImportFiles({
        files, scope, storage: window.localStorage, fetcher: apiFetch, isCurrent: current,
        knownTasks: state.key === key && state.epoch === epoch ? state.tasks : [],
        preparation, initialMode,
      })
      if (!current()) return
      setState(previous => ({ ...previous, tasks: mergeTask(previous.tasks, task), pointer: null }))
      setFocus({ key: key!, epoch, taskId: task.requestId })
      if (task.status === "saved") {
        const scanned = await resumeImportTask(scope, task, current)
        if (current()) setState(previous => ({ ...previous, tasks: mergeTask(previous.tasks, scanned) }))
      }
    } catch (error) {
      if (current()) {
        // Reauthorize saved cards after any uncertain read instead of retaining possibly revoked data.
        authorization.current = { epoch, available: false }
        setState(previous => ({ ...previous, tasks: [], available: false, error: error instanceof Error ? error.message : "Import preparation is unavailable." }))
      }
      throw error
    } finally {
      if (running.current === operation) {
        running.current = null
        if (isCurrent() && loadVersion.current === operation.version) setState(previous => ({ ...previous, busy: false }))
      }
    }
  }, [scope, isCurrent, state.key, state.epoch, state.tasks, key, epoch])

  const resume = useCallback(async (task: ChatImportTask) => {
    if (!scope || !isCurrent() || running.current?.epoch === epoch || authorization.current.epoch !== epoch || !authorization.current.available) return
    const operation = { epoch, version: ++loadVersion.current }
    running.current = operation
    const current = () => isCurrent() && running.current === operation && loadVersion.current === operation.version
    setState(previous => ({ ...previous, busy: true, error: null }))
    try {
      const saved = await resumeImportTask(scope, task, current)
      if (current()) {
        setState(previous => ({ ...previous, tasks: mergeTask(previous.tasks, saved) }))
        void queryClient.invalidateQueries({ queryKey: chatImportReceiptKey(scope, task.requestId) })
      }
    } catch (error) {
      if (current()) {
        authorization.current = { epoch, available: false }
        setState(previous => ({ ...previous, tasks: [], available: false, error: error instanceof Error ? error.message : "Preparation could not be resumed." }))
      }
    } finally {
      if (running.current === operation) {
        running.current = null
        if (isCurrent() && loadVersion.current === operation.version) setState(previous => ({ ...previous, busy: false }))
      }
    }
  }, [scope, isCurrent, epoch, queryClient])

  const answerTask = useCallback(async (task: ChatImportTask, answer?: ChatDecisionAnswer) => {
    if (!scope || !isCurrent() || running.current?.epoch === epoch || authorization.current.epoch !== epoch || !authorization.current.available) throw new Error("Check the current file decision before submitting an answer.")
    const operation = { epoch, version: ++loadVersion.current }
    running.current = operation
    const current = () => isCurrent() && running.current === operation && loadVersion.current === operation.version
    setState(previous => ({ ...previous, busy: true, error: null }))
    try {
      let saved: ChatImportTask
      if (answer) {
        if (!["prepare_import", "inspect_only", "other"].includes(answer.optionId)) throw new Error("Choose one of the supported file actions.")
        saved = await submitChatImportDecision({ task, answer: { ...answer, optionId: answer.optionId as ChatImportDecisionAnswer["optionId"] }, scope, storage: window.localStorage, fetcher: apiFetch, isCurrent: current })
      } else {
        saved = await retryChatImportDecision({ taskRequestId: task.requestId, scope, storage: window.localStorage, fetcher: apiFetch, isCurrent: current })
      }
      if (current()) {
        setState(previous => {
          const decisionPointers = { ...previous.decisionPointers }
          delete decisionPointers[task.requestId]
          return { ...previous, tasks: mergeTask(previous.tasks, saved), decisionPointers }
        })
        void queryClient.invalidateQueries({ queryKey: chatImportReceiptKey(scope, task.requestId) })
      }
    } catch (error) {
      if (current()) {
        authorization.current = { epoch, available: false }
        setState(previous => ({ ...previous, tasks: [], available: false, error: error instanceof Error ? error.message : "The file decision could not be saved." }))
      }
      throw error
    } finally {
      if (running.current === operation) {
        running.current = null
        if (isCurrent() && loadVersion.current === operation.version) setState(previous => ({ ...previous, busy: false }))
      }
    }
  }, [scope, isCurrent, epoch, queryClient])

  const visible = state.key === key && state.epoch === epoch && scope ? state : null
  const selectedReview = review?.key === key && review.epoch === epoch ? review : null
  const focusTask = useCallback((task: ChatImportTask) => {
    if (!key || !scope || !isCurrent() || task.companyId !== String(scope.companyId)) return
    setFocus(previous => previous?.key === key && previous.epoch === epoch && previous.task === task
      ? previous : { key, epoch, taskId: task.requestId, task })
  }, [key, scope, isCurrent, epoch])
  const clearFocus = useCallback(() => {
    if (key && isCurrent()) setFocus({ key, epoch, taskId: null })
  }, [key, epoch, isCurrent])
  const focusedTask = visible?.available
    ? focus?.key === key && focus.epoch === epoch
      ? visible.tasks.find(task => task.requestId === focus.taskId) ?? focus.task
      : visible.tasks.length === 1 ? visible.tasks[0] : undefined
    : undefined
  const selectedImport = focusedTask?.requestId === selectedReview?.taskId
    ? focusedTask
    : visible?.tasks.find(task => task.requestId === selectedReview?.taskId)
  const inspecting = selectedImport?.decision.selectedOptionId === "inspect_only"
  const openSavedTask = (taskId: string | null, view?: ImportTaskView, id?: string) => {
    if (key && visible?.available) setReview({ key, epoch, taskId, id, view })
  }
  const openTask = (task: ChatImportTask, view?: ImportTaskView, id?: string) => {
    focusTask(task)
    openSavedTask(task.requestId, view, id)
  }
  const renderReceipt = (taskId: string) => {
    if (!scope) return null
    const saved = visible?.tasks.find(task => task.requestId === taskId)
      ?? (focusedTask?.requestId === taskId ? focusedTask : undefined)
    return <ChatImportReceipt
      scope={saved ? { ...scope, conversationKey: saved.conversationKey } : scope}
      taskId={taskId}
      onOpen={saved && !args.readonly ? view => openTask(saved, view) : undefined}
    />
  }
  const archivedContent = scope && visible && args.readonly && visible.tasks.length > 0 ? (
    <div className="space-y-2" data-testid="chat-import-tasks">
      {visible.tasks.map(task => (
        <article key={task.requestId} className="space-y-2 rounded-lg border p-3 text-sm">
          {args.renderHistoryDecision?.(task)}
          <a className="underline underline-offset-4" href={importTaskHref({
            companyId: scope.companyId, taskId: task.requestId, view: "decisions",
          })}>
            {t("settings.importTask.openTask", { defaultValue: "Open saved task" })}
          </a>
        </article>
      ))}
    </div>
  ) : null
  const content = args.readonly ? archivedContent : scope && visible ? <div className="space-y-3" data-testid="chat-import-tasks">
    {visible.available ? <>
      <ChatReconciliationPreview key={key} organizationId={scope.organizationId} companyId={scope.companyId} />
      <Button type="button" variant="outline" size="sm" disabled={visible.busy} onClick={() => openSavedTask(null)}>
        {t("settings.importTask.continueShortcut", { defaultValue: "Continue saved import" })}
      </Button>
    </> : null}
    {visible.busy ? <p role="status" className="text-sm">{t("aiChat.import.savingTask", { defaultValue: "Saving files or checking the selected action…" })}</p> : null}
    {visible.error ? <p role="alert" className="text-sm text-destructive">{visible.error}</p> : null}
    {visible.pointer ? <p role="status" className="text-sm">{t("aiChat.import.uncertain", { defaultValue: "An upload has no confirmed result yet. Check again, or select the same original files in the same order to retry its saved request." })}</p> : null}
    {(visible.error || visible.pointer || visible.tasks.length > 0) && <Button type="button" variant="outline" size="sm" disabled={visible.busy} onClick={() => void reload()}>{t("aiChat.import.check", { defaultValue: "Check saved imports" })}</Button>}
    {visible.tasks.map(task => <article key={task.requestId} data-testid={`chat-import-task-${task.requestId}`} className="space-y-2 rounded-lg border bg-background p-3 text-sm">
      <p className="font-medium">{task.status === "awaiting_decision"
        ? t("aiChat.import.awaitingDecision", { defaultValue: "Files saved · choose what happens next" })
        : task.status === "inspection_ready" ? t("aiChat.import.inspectionReady", { defaultValue: "Inspection ready · no import proposal created" })
        : task.status === "needs_review"
        ? t("aiChat.import.ready", { defaultValue: "Import prepared for review" })
        : task.status === "failed" ? t("aiChat.import.preparationFailed", { defaultValue: "Files saved · preparation needs attention" })
          : task.decision.selectedOptionId === "inspect_only" ? t("aiChat.import.inspectionSaved", { defaultValue: "Files saved · inspection can be resumed" })
            : t("aiChat.import.saved", { defaultValue: "Files saved · preparation can be resumed" })}</p>
      {task.status !== "needs_review" ? <p className="text-xs text-muted-foreground">{t("aiChat.import.noRecords", { defaultValue: "Preparation creates no business records. Review the source before importing." })}</p> : null}
      <ul className="space-y-2">{task.files.map(file => <li key={file.ordinal} className="min-w-0 [overflow-wrap:anywhere]">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <FileIdentity fileName={file.fileName} size={file.size} className="flex-1 basis-36" />
          <a
            className="inline-flex min-h-8 shrink-0 items-center text-sm font-medium text-primary underline underline-offset-4"
            href={`/api/import-tasks/${task.requestId}/files/${file.ordinal}?companyId=${scope.companyId}`}
            download={file.fileName}
            aria-label={t("settings.importTask.downloadNamed", { defaultValue: "Download {{fileName}}", fileName: file.fileName })}
          >
            {t("settings.importTask.download", { defaultValue: "Download" })}
          </a>
        </div>
        {file.previousMatch ? <div className="text-muted-foreground">
          <p>{file.previousMatch.kind === "identical"
            ? t("aiChat.import.identicalEarlierSource")
            : t("aiChat.import.changedEarlierSource")}</p>
          <a className="underline" href={`/api/import-tasks/${file.previousMatch.requestId}/files/${file.previousMatch.ordinal}?companyId=${scope.companyId}`} download={file.previousMatch.fileName}>
            {t("aiChat.import.downloadEarlierSource", { fileName: file.previousMatch.fileName })}
          </a>
          {file.previousMatch.kind === "identical" ? <a className="ml-3 underline" href={importTaskHref({
            companyId: scope.companyId, taskId: file.previousMatch.requestId, view: "sources",
          })}>{t("settings.importTask.openTask", { defaultValue: "Open saved task" })}</a> : null}
        </div> : null}
      </li>)}</ul>
      {task.warnings.map((warning, i) => <p key={i} className="text-muted-foreground">{warning}</p>)}
      {task.error ? <p role="alert" className="text-destructive">{task.error}</p> : null}
      {task.decision.status === "approved" ? <p className="text-muted-foreground">{task.decision.selectedOptionId === "inspect_only"
        ? t("aiChat.import.inspectionApproved", { defaultValue: "You approved inspection only. No business-record import was authorized." })
        : t("aiChat.import.preparationApproved", { defaultValue: "You approved import preparation. Creating business records still requires a separate review and confirmation." })}</p> : null}
      {args.renderHistoryDecision?.(task)}
      {task.decisionHistory.some(answer => answer.optionId === "other") ? <p className="text-muted-foreground">{t("aiChat.import.instructionsSaved", { defaultValue: "Your instructions are saved as a note. Custom instructions are not applied automatically when you choose a supported action." })}</p> : null}
      {task.decision.selectedOptionId === "other" && task.decision.otherText ? <p className="whitespace-pre-wrap">{task.decision.otherText}</p> : null}
      {visible.decisionPointers[task.requestId] ? <div className="space-y-2">
        <p role="status">{t("aiChat.import.decisionUncertain", { defaultValue: "This answer has no confirmed receipt yet. Check saved imports or retry the same saved answer before changing it." })}</p>
        <p>{t("aiChat.import.savedAnswer", { defaultValue: "Saved answer: {{answer}}", answer: visible.decisionPointers[task.requestId].optionId === "other" ? t("aiChat.decision.other", { defaultValue: "Other" }) : task.decision.options.find(option => option.id === visible.decisionPointers[task.requestId].optionId)?.label })}</p>
        {visible.decisionPointers[task.requestId].otherText ? <p className="whitespace-pre-wrap">{visible.decisionPointers[task.requestId].otherText}</p> : null}
        <Button type="button" variant="outline" size="sm" disabled={visible.busy} onClick={() => { void answerTask(task).catch(() => undefined) }}>{t("aiChat.import.retryDecision", { defaultValue: "Retry saved answer" })}</Button>
      </div> : task.status === "awaiting_decision" ? <ChatDecisionCard
        request={task.decision}
        scopeKey={`${key}:${epoch}`}
        disabled={visible.busy || !visible.available}
        submitLabels={{
          prepare_import: t("aiChat.import.approvePreparation", { defaultValue: "Approve preparation" }),
          inspect_only: t("aiChat.import.approveInspection", { defaultValue: "Approve inspection" }),
          other: t("aiChat.import.sendInstructions", { defaultValue: "Send instructions" }),
        }}
        onSubmit={answer => answerTask(task, answer)}
      /> : null}
      {task.status === "saved" ? <Button type="button" variant="outline" size="sm" disabled={visible.busy} onClick={() => void resume(task)}>{task.decision.selectedOptionId === "inspect_only" ? t("aiChat.import.resumeInspection", { defaultValue: "Resume inspection" }) : t("aiChat.import.resume", { defaultValue: "Resume preparation" })}</Button> : null}
      {canPrepareInspectedImport(task) && !visible.decisionPointers[task.requestId] ? <Button type="button" size="sm"
        disabled={visible.busy}
        onClick={() => void answerTask(task, {
          requestId: task.decision.id, expectedRevision: task.decision.revision, optionId: "prepare_import",
        }).catch(() => undefined)}
      >{t("aiChat.import.approvePreparation", { defaultValue: "Approve preparation" })}</Button> : null}
      <div className="flex flex-wrap items-center gap-2">
        {focusedTask?.requestId !== task.requestId || task.status !== "needs_review" ? (
          <Button type="button" variant="outline" size="sm" disabled={visible.busy} onClick={() => openTask(task)}>{t("settings.importTask.openTask", { defaultValue: "Open saved task" })}</Button>
        ) : null}
        <a className="text-sm underline underline-offset-4" href={importTaskHref({
          companyId: scope.companyId, taskId: task.requestId, view: task.reviews.length ? "decisions" : "sources",
        })}>{t("settings.importTask.permalink", { defaultValue: "Open this task in Data import" })}</a>
      </div>
      {focusedTask?.requestId === task.requestId
        ? <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t("settings.importTask.chatFocus", { defaultValue: "Using this saved task for your next chat question." })}</p>
          {task.status === "needs_review" ? renderReceipt(task.requestId) : null}
        </div>
        : <Button type="button" variant="ghost" size="sm" disabled={visible.busy} onClick={() => focusTask(task)}>{t("settings.importTask.askAboutTask", { defaultValue: "Ask about this task" })}</Button>}
      {task.reviews.map(batch => <div key={batch.id} className="space-y-1">
        <p>{t("aiChat.import.counts", { defaultValue: "{{total}} source rows · {{pending}} unresolved · {{confirmed}} confirmed · {{excluded}} excluded", ...batch })}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => openTask(task, "decisions", batch.id)}>{task.status === "inspection_ready" ? t("aiChat.import.viewInspection", { defaultValue: "View inspection {{title}}", title: batch.title }) : t("aiChat.import.review", { defaultValue: "Review {{title}}", title: batch.title })}</Button>
      </div>)}
    </article>)}
    {!selectedReview && focusedTask?.status === "needs_review" &&
      !visible.tasks.some(task => task.requestId === focusedTask.requestId)
      ? renderReceipt(focusedTask.requestId)
      : null}
    {selectedReview ? <Dialog open onOpenChange={open => { if (!open) { setReview(null); void reload() } }}>
      <DialogContent size="document" layout="bounded">
        <DialogHeader>
          <DialogTitle>{!selectedReview.taskId
            ? t("settings.importTask.continueShortcut", { defaultValue: "Continue saved import" })
            : inspecting
              ? t("aiChat.import.inspectionTitle", { defaultValue: "Inspect saved source files" })
              : t("aiChat.import.reviewTitle", { defaultValue: "Review source and prepare import" })}</DialogTitle>
          <DialogDescription>{!selectedReview.taskId
            ? t("settings.importTask.savedTasksHint", {
              defaultValue: "Continue files and decisions saved for this company, including imports started in another conversation.",
            })
            : inspecting
              ? t("aiChat.import.inspectionDescription", { defaultValue: "Review the source evidence. This action does not prepare business records." })
              : t("aiChat.import.reviewDescription", { defaultValue: "Resolve uncertain values, then use the import preview to confirm the records to create." })}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {selectedReview.taskId
            ? <DataImportWorkspace organizationId={scope.organizationId} taskId={selectedReview.taskId} initialReviewId={selectedReview.id} initialView={selectedReview.view} resumeAtNextStep={!selectedReview.view} syncUrl={false} onTaskFocus={focusTask} />
            : <ChatSavedImportPicker scope={scope} onSelect={openSavedTask} />}
        </DialogBody>
      </DialogContent>
    </Dialog> : null}
  </div> : null

  return {
    onImportFiles: visible?.available && !args.readonly ? importFiles : undefined,
    fileNames: visible?.tasks.flatMap(task => task.files.map(file => file.fileName)),
    focusedTask: args.readonly ? undefined : focusedTask,
    focusedFileNames: args.readonly ? undefined : focusedTask?.files.map(file => file.fileName),
    clearFocus,
    renderReceipt,
    content,
  }
}
