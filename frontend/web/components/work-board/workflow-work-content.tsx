"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { KanbanBoard } from "@lumiere/ui/kanban/kanban-board"
import { KanbanCardContent } from "@lumiere/ui/kanban/kanban-card"
import { Badge } from "@lumiere/ui/components/badge"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@lumiere/ui/components/sheet"
import { Textarea } from "@lumiere/ui/components/textarea"
import { Field, FieldGroup, FieldLabel } from "@lumiere/ui/components/field"
import { useWorkBoard } from "@lumiere/query-hooks/hooks/work-board"
import {
  WORK_STATUSES,
  canMoveWorkTask,
  workActionForColumn,
  workActionsForActor,
  workStatus,
  workTeamKey,
  type WorkAction,
  type WorkBoardScope,
  type WorkTaskRow,
} from "@lumiere/query-hooks/hooks/work-board-model"
import {
  approvalActorOptions,
  approvalSelection,
  approvalResubmissionSelection,
  requireUnchangedApproval,
  requireUnchangedApprovalResubmission,
  resolveApprovalActor,
} from "@lumiere/query-hooks/hooks/approval-controls"
import {
  approvalRecordHref,
  newHumanTaskAttempt,
  recheckHumanTaskCommandEffect,
  useClaimHumanTask,
  useDecideHumanTask,
  useResubmitHumanTask,
  type ClaimHumanTaskInput,
  type DecideHumanTaskInput,
  type ResubmitHumanTaskInput,
} from "@lumiere/query-hooks/hooks/approvals"
import {
  humanTaskClaimExpectation,
  humanTaskDecisionExpectation,
  humanTaskResubmissionExpectation,
  normalizeHumanTaskResubmissionReason,
  type HumanTaskCommandExpectation,
} from "@lumiere/query-hooks/hooks/human-task-command"
import {
  AmbiguousOperationEffectError,
  UnresolvedOperationEffectError,
} from "@lumiere/query-hooks/hooks/operation-effect"

const selectClass =
  "h-9 max-w-full rounded-md border bg-background px-2 text-sm"

type FrozenCommand =
  | { kind: "claim"; input: ClaimHumanTaskInput }
  | { kind: "decision"; input: DecideHumanTaskInput }
  | { kind: "resubmit"; input: ResubmitHumanTaskInput }

function taskTitle(row: WorkTaskRow): string {
  return (
    row.workSourceTitle ||
    `${row.subjectModel ?? row.subject_model ?? ""} #${row.subjectId ?? row.subject_id ?? row.id}`
  )
}

export function WorkflowWorkContent({
  scope,
  online,
  layout,
  navigationPending = false,
  authorityRefreshing = false,
  onTeamChange,
}: {
  scope: WorkBoardScope
  online: boolean
  layout: "board" | "list"
  navigationPending?: boolean
  authorityRefreshing?: boolean
  onTeamChange: (team: string | null) => void
}) {
  const { t } = useTranslation()
  const query = useWorkBoard(scope, online)
  const claim = useClaimHumanTask(scope.organizationId, scope)
  const decide = useDecideHumanTask(scope.organizationId, scope)
  const resubmit = useResubmitHumanTask(scope.organizationId, scope)
  const [review, setReview] = useState<{
    row: WorkTaskRow
    action?: WorkAction
  } | null>(null)
  const [actor, setActor] = useState<string | null>(null)
  const [comment, setComment] = useState("")
  const commentId = useId()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [unresolved, setUnresolved] =
    useState<HumanTaskCommandExpectation | null>(null)
  const [checkingOutcome, setCheckingOutcome] = useState(false)
  const [preparingCommand, setPreparingCommand] = useState(false)
  // Only the immutable receipt expectation survives dispatch. It contains no
  // source fields or review comment, even if a presentation filter loses the row.
  const attempt = useRef<HumanTaskCommandExpectation | symbol | null>(null)
  const mounted = useRef(true)
  const submitting = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      attempt.current = null
    }
  }, [])
  // Failed refreshes hide retained cache data, including counts and the review sheet.
  const rows = useMemo(
    () =>
      query.isError
        ? []
        : Array.from(
            new Map(
              (query.data?.pages.flatMap((page) => page.data) ?? []).map(
                (row) => [String(row.id), row],
              ),
            ).values(),
          ),
    [query.data, query.isError],
  )
  const teams = useMemo(
    () =>
      Array.from(
        new Map(
          rows
            .flatMap((row) => row.workTeamRefs)
            .map((team) => [workTeamKey(team), team]),
        ).values(),
      ),
    [rows],
  )
  const busy =
    preparingCommand ||
    claim.isPending ||
    decide.isPending ||
    resubmit.isPending ||
    checkingOutcome
  const disabled =
    navigationPending ||
    authorityRefreshing ||
    !online ||
    query.isFetching ||
    query.isError ||
    busy ||
    unresolved != null
  const columns = WORK_STATUSES.map((status) => ({
    id: status,
    title: t(`workBoard.status.${status}`),
  }))
  const current = review
    ? rows.find((row) => String(row.id) === String(review.row.id))
    : undefined
  const selectedActorUnavailable =
    review != null &&
    current != null &&
    actor != null &&
    (workStatus(review.row) === "Cancelled"
      ? workActionsForActor(review.row, actor).includes("resubmit") &&
        !workActionsForActor(current, actor).includes("resubmit")
      : resolveApprovalActor(current, actor) == null)
  const unresolvedCurrent = unresolved
    ? rows.find((row) => String(row.id) === unresolved.taskId)
    : undefined
  useEffect(() => {
    if (
      query.isError ||
      selectedActorUnavailable ||
      (review && !query.isPending && !current)
    ) {
      setReview(null)
      setActor(null)
      setComment("")
      setError(null)
      setNotice(null)
      // List omission can be the successful result of a claim in Available
      // work. Clear sensitive review state now; exact authorized readback below
      // distinguishes that omission from loss of visibility.
      // A failed HTTP read cannot disprove an already dispatched command.
      // It can only cancel preparation that has not reached dispatch yet.
      if (typeof attempt.current === "symbol") {
        attempt.current = null
        setUnresolved(null)
      }
    }
  }, [
    current,
    query.isError,
    query.isPending,
    review,
    selectedActorUnavailable,
  ])
  useEffect(() => {
    if (
      !unresolved ||
      unresolvedCurrent ||
      !online ||
      authorityRefreshing ||
      query.isError ||
      query.isPending
    )
      return
    let cancelled = false
    void recheckHumanTaskCommandEffect(scope, unresolved)
      .then(({ effect, visible }) => {
        if (cancelled || !mounted.current || attempt.current !== unresolved)
          return
        if (!visible || effect) {
          attempt.current = null
          setUnresolved(null)
          if (effect) setNotice(t("workBoard.updated"))
        }
      })
      // An unavailable read proves neither success nor failure. Keep only the
      // generic unknown banner; a later explicit check never resends a command.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [
    unresolved,
    unresolvedCurrent,
    online,
    authorityRefreshing,
    query.isError,
    query.isPending,
    scope,
    t,
  ])
  let stale = false
  if (
    review &&
    current &&
    workStatus(review.row) === "Cancelled" &&
    review.row.workActions.includes("resubmit")
  ) {
    try {
      requireUnchangedApprovalResubmission(
        approvalResubmissionSelection(review.row, scope.companyId),
        current,
      )
    } catch {
      stale = true
    }
  }
  if (
    review &&
    current &&
    actor != null &&
    (workStatus(review.row) === "Open" || workStatus(review.row) === "Claimed")
  ) {
    try {
      requireUnchangedApproval(
        approvalSelection(review.row, scope.companyId, actor),
        current,
      )
    } catch {
      stale = true
    }
  }
  const actions = current && !stale ? workActionsForActor(current, actor) : []
  const openReview = (row: WorkTaskRow, action?: WorkAction) => {
    if (unresolved && unresolved.taskId !== String(row.id)) return
    setReview({ row, action })
    setActor(workStatus(row) === "Cancelled" ? "" : resolveApprovalActor(row))
    setComment("")
    setError(null)
    setNotice(null)
  }
  const submit = async (action: WorkAction) => {
    if (!review || !current || disabled || submitting.current) return
    submitting.current = true
    setPreparingCommand(true)
    setError(null)
    let command: FrozenCommand | null = null
    let expected: HumanTaskCommandExpectation | null = null
    const preparation = Symbol("workflow-command")
    attempt.current = preparation
    try {
      if (!workActionsForActor(current, actor).includes(action))
        throw new Error(t("workBoard.actionDenied"))
      if (
        action === "reject" &&
        (current.requireCommentOnReject ?? current.require_comment_on_reject) &&
        !comment.trim()
      )
        throw new Error(t("workBoard.commentRequired"))
      if (action === "resubmit") {
        const selection = approvalResubmissionSelection(
          review.row,
          scope.companyId,
        )
        requireUnchangedApprovalResubmission(selection, current)
        command = {
          kind: "resubmit",
          input: Object.freeze({
            companyId: selection.companyId,
            taskId: selection.requestId,
            expectedTaskRevision: selection.expectedTaskRevision,
            expectedInstanceRevision: selection.expectedInstanceRevision,
            expectedSubjectRevisionHash: selection.expectedSubjectRevisionHash,
            reason: normalizeHumanTaskResubmissionReason(comment),
            attempt: newHumanTaskAttempt("resubmit"),
          }),
        }
      } else {
        const selection = approvalSelection(review.row, scope.companyId, actor)
        requireUnchangedApproval(selection, current)
        if (action === "claim") {
          command = {
            kind: "claim",
            input: Object.freeze({
              companyId: selection.companyId,
              taskId: selection.requestId,
              expectedRevision: selection.expectedTaskRevision,
              actingFor: selection.actingFor,
              attempt: newHumanTaskAttempt("claim"),
            }),
          }
        } else {
          command = {
            kind: "decision",
            input: Object.freeze({
              companyId: selection.companyId,
              taskId: selection.requestId,
              expectedTaskRevision: selection.expectedTaskRevision,
              expectedInstanceRevision: selection.expectedInstanceRevision,
              actingFor: selection.actingFor,
              decision: Object.freeze({
                tag:
                  action === "approve"
                    ? "Approve"
                    : action === "reject"
                      ? "Reject"
                      : "Complete",
              }),
              comment: comment.trim() || null,
              attempt: newHumanTaskAttempt("decision"),
            }),
          }
        }
      }
      expected =
        command.kind === "claim"
          ? await humanTaskClaimExpectation(scope, command.input)
          : command.kind === "resubmit"
            ? await humanTaskResubmissionExpectation(scope, command.input)
            : await humanTaskDecisionExpectation(scope, command.input)
      if (!mounted.current || attempt.current !== preparation) return
      attempt.current = expected
      setPreparingCommand(false)
      if (command.kind === "claim") await claim.mutateAsync(command.input)
      else if (command.kind === "resubmit")
        await resubmit.mutateAsync(command.input)
      else await decide.mutateAsync(command.input)
      if (!mounted.current || attempt.current !== expected) return
      attempt.current = null
      setUnresolved(null)
      setReview(null)
      setActor(null)
      setComment("")
      setNotice(t("workBoard.updated"))
    } catch (cause) {
      if (!mounted.current || attempt.current !== (expected ?? preparation))
        return
      const outcomeUnknown =
        cause instanceof UnresolvedOperationEffectError ||
        cause instanceof AmbiguousOperationEffectError
      if (expected && outcomeUnknown) {
        setUnresolved(expected)
      } else {
        attempt.current = null
        setUnresolved(null)
      }
      setError(
        outcomeUnknown
          ? null
          : cause instanceof Error
            ? cause.message
            : t("workBoard.updateFailed"),
      )
    } finally {
      // Response loss can follow a committed command. Reconcile instead of moving optimistically.
      if (mounted.current) {
        await query.refetch()
        setPreparingCommand(false)
      }
      submitting.current = false
    }
  }
  const checkOutcome = async () => {
    const expected = unresolved
    if (
      !expected ||
      !online ||
      authorityRefreshing ||
      navigationPending ||
      query.isFetching ||
      query.isError ||
      busy ||
      submitting.current
    )
      return
    submitting.current = true
    setCheckingOutcome(true)
    setError(null)
    try {
      const { effect, visible } = await recheckHumanTaskCommandEffect(
        scope,
        expected,
      )
      if (!mounted.current || attempt.current !== expected) return
      if (!visible || effect) {
        attempt.current = null
        setUnresolved(null)
        setReview(null)
        setActor(null)
        setComment("")
        if (effect) setNotice(t("workBoard.updated"))
      }
    } catch {
      // A denied or unavailable proof read is not a failed command. Retain the
      // generic outcome state until current authorized reads resolve it.
    } finally {
      if (mounted.current) {
        await query.refetch()
        setCheckingOutcome(false)
      }
      submitting.current = false
    }
  }
  const outcomeControls = unresolved && (
    <div role="alert" className="space-y-2">
      <p>{t("workBoard.outcomeUnknown")}</p>
      <Button
        variant="outline"
        disabled={
          !online ||
          authorityRefreshing ||
          navigationPending ||
          query.isFetching ||
          query.isError ||
          busy
        }
        onClick={() => void checkOutcome()}
      >
        {checkingOutcome
          ? t("workBoard.checkingOutcome")
          : t("workBoard.checkOutcome")}
      </Button>
    </div>
  )
  const reason = (row: WorkTaskRow) =>
    !online
      ? t("workBoard.offline")
      : disabled
        ? t("workBoard.refreshing")
        : workActionsForActor(row).length === 0
          ? t("workBoard.reviewActions")
          : undefined
  const href = current
    ? approvalRecordHref(
        current.subjectModel ?? current.subject_model,
        current.subjectId ?? current.subject_id,
      )
    : undefined
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="grid gap-1 text-xs font-medium">
          {t("workBoard.team")}
          <select
            className={selectClass}
            value={scope.team ?? ""}
            disabled={navigationPending}
            onChange={(event) => onTeamChange(event.target.value || null)}
          >
            <option value="">{t("workBoard.allTeams")}</option>
            {scope.team &&
              !teams.some((team) => workTeamKey(team) === scope.team) && (
                <option value={scope.team}>{scope.team}</option>
              )}
            {teams.map((team) => (
              <option key={workTeamKey(team)} value={workTeamKey(team)}>
                {team.label ||
                  t(`workBoard.teamKind.${team.kind}`, { id: team.id })}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground" role="status">
            {t("workBoard.loaded", { count: rows.length })}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={!online || query.isFetching || busy}
            onClick={() => void query.refetch()}
          >
            {t("workBoard.refresh")}
          </Button>
        </div>
      </div>
      {!online && (
        <p role="alert" className="text-sm text-muted-foreground">
          {t("workBoard.offline")}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {query.isError ? (
        <div role="alert" className="rounded-lg border border-destructive p-4">
          <p>{t("workBoard.readFailed")}</p>
          <p className="text-sm">{query.error.message}</p>
        </div>
      ) : query.isPending ? (
        <p role="status">{t("workBoard.loading")}</p>
      ) : (
        <>
          {rows.length === 0 && (
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              {query.hasNextPage
                ? t("workBoard.moreToSearch")
                : t("workBoard.empty")}
            </p>
          )}
          {layout === "board" ? (
            <KanbanBoard<WorkTaskRow>
              columns={columns}
              items={rows}
              getItemId={(row) => String(row.id)}
              getColumnId={(row) => workStatus(row) ?? ""}
              isItemDraggable={(row) =>
                !disabled &&
                workActionsForActor(row).some((action) => action !== "resubmit")
              }
              canMove={(row, column) =>
                !disabled && canMoveWorkTask(row, column)
              }
              isItemPending={(row) =>
                busy && String(review?.row.id) === String(row.id)
              }
              moveDisabledReason={reason}
              onMove={({ item, toColumnId }) => {
                const action = workActionForColumn(toColumnId)
                if (action) openReview(item, action)
              }}
              onMoveError={(cause) =>
                setError(
                  cause instanceof Error
                    ? cause.message
                    : t("workBoard.updateFailed"),
                )
              }
              onItemClick={(row) => openReview(row)}
              renderCard={(row) => (
                <KanbanCardContent
                  title={taskTitle(row)}
                  subtitle={row.nodeKey ?? row.node_key}
                  priority={{
                    label: t(`workBoard.module.${row.workModule}`),
                    tone: "neutral",
                  }}
                  topRight={
                    row.workAssignedToMe ? (
                      <Badge variant="secondary">
                        {t("workBoard.mineBadge")}
                      </Badge>
                    ) : undefined
                  }
                />
              )}
              labels={{
                emptyColumn: t("workBoard.emptyColumn"),
                moveFailed: t("workBoard.updateFailed"),
                pendingMove: t("workBoard.saving"),
              }}
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="p-3">{t("workBoard.assignment")}</th>
                    <th className="p-3">{t("workBoard.scope")}</th>
                    <th className="p-3">{t("workBoard.statusLabel")}</th>
                    <th className="p-3">{t("workBoard.ownership")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={String(row.id)} className="border-b last:border-0">
                      <td className="p-3">
                        <button
                          className="text-left font-medium underline-offset-4 hover:underline"
                          onClick={() => openReview(row)}
                        >
                          {taskTitle(row)}
                        </button>
                        <p className="text-xs text-muted-foreground">
                          {row.nodeKey ?? row.node_key}
                        </p>
                      </td>
                      <td className="p-3">
                        {t(`workBoard.module.${row.workModule}`)}
                      </td>
                      <td className="p-3">
                        {t(`workBoard.status.${workStatus(row) ?? "Open"}`)}
                      </td>
                      <td className="p-3">
                        {row.workAssignedToMe
                          ? t("workBoard.mineBadge")
                          : t("workBoard.teamWork")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {query.hasNextPage && (
            <Button
              variant="outline"
              disabled={!online || query.isFetching || busy}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage
                ? t("workBoard.loading")
                : t("workBoard.loadMore")}
            </Button>
          )}
        </>
      )}
      {error && !review && <p role="alert">{error}</p>}
      {!review && outcomeControls}
      <Sheet
        open={
          review != null &&
          current != null &&
          !query.isError &&
          !selectedActorUnavailable
        }
        onOpenChange={(open) => {
          if (!open && !busy) {
            setReview(null)
            setActor(null)
            setComment("")
          }
        }}
      >
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>
              {current ? taskTitle(current) : t("workBoard.assignment")}
            </SheetTitle>
            <SheetDescription>
              {t("workBoard.reviewDescription")}
            </SheetDescription>
          </SheetHeader>
          {review && current && (
            <div className="space-y-4 p-4">
              <p className="text-sm">{current.nodeKey ?? current.node_key}</p>
              <Badge variant="secondary">
                {t(`workBoard.status.${workStatus(current) ?? "Open"}`)}
              </Badge>
              {href && (
                <p>
                  <Link className="text-sm font-medium underline" href={href}>
                    {t("workBoard.openRecord")}
                  </Link>
                </p>
              )}
              {workStatus(current) !== "Cancelled" &&
                approvalActorOptions(current).length > 0 && (
                  <label className="grid gap-1 text-sm">
                    {t("workBoard.actingAs")}
                    <select
                      className={selectClass}
                      value={actor ?? "select"}
                      disabled={busy || unresolved != null}
                      onChange={(event) => {
                        setActor(
                          event.target.value === "select"
                            ? null
                            : event.target.value,
                        )
                        setError(null)
                      }}
                    >
                      <option value="select" disabled>
                        {t("workBoard.selectActor")}
                      </option>
                      {current.directlyEligible && (
                        <option value="">{t("workBoard.myself")}</option>
                      )}
                      {approvalActorOptions(current).map((option) => (
                        <option
                          key={option.identityHex}
                          value={option.identityHex}
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              {unresolved ? (
                outcomeControls
              ) : stale || !current ? (
                <div role="alert" className="space-y-2">
                  <p>{t("workBoard.stale")}</p>
                  {current && (
                    <Button
                      variant="outline"
                      onClick={() => openReview(current)}
                    >
                      {t("workBoard.reviewLatest")}
                    </Button>
                  )}
                </div>
              ) : actions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("workBoard.noActions")}
                </p>
              ) : (
                <>
                  {actions.includes("resubmit") && (
                    <p className="text-sm text-muted-foreground">
                      {t("workBoard.resubmissionDescription")}
                    </p>
                  )}
                  {actions.some((action) => action !== "claim") && (
                    <FieldGroup>
                      <Field data-disabled={busy || unresolved != null}>
                        <FieldLabel htmlFor={commentId}>
                          {t(
                            actions.includes("resubmit")
                              ? "workBoard.resubmissionReason"
                              : "workBoard.comment",
                          )}
                        </FieldLabel>
                        <Textarea
                          id={commentId}
                          variant="plain"
                          value={comment}
                          onChange={(event) => setComment(event.target.value)}
                          disabled={busy || unresolved != null}
                          rows={4}
                        />
                      </Field>
                    </FieldGroup>
                  )}
                  {review.action && actions.includes(review.action) && (
                    <p className="text-sm font-medium">
                      {t("workBoard.confirmAction", {
                        action: t(`workBoard.action.${review.action}`),
                      })}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {actions.map((action) => (
                      <Button
                        key={action}
                        variant={action === "reject" ? "outline" : "default"}
                        disabled={
                          disabled ||
                          (action === "resubmit" && !comment.trim()) ||
                          (action === "reject" &&
                            !!(
                              current.requireCommentOnReject ??
                              current.require_comment_on_reject
                            ) &&
                            !comment.trim())
                        }
                        onClick={() => void submit(action)}
                      >
                        {busy
                          ? t("workBoard.saving")
                          : t(`workBoard.action.${action}`)}
                      </Button>
                    ))}
                  </div>
                </>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {!online && <p role="alert">{t("workBoard.offline")}</p>}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
