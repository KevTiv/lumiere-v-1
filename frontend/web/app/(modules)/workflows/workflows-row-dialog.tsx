"use client"

import { useState } from "react"
import type { TFunction } from "i18next"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  usePermission,
} from "@lumiere/ui"
import type { UseMutationResult } from "@tanstack/react-query"
import type {
  SignalWorkflowInput,
  StartWorkflowInput,
} from "@lumiere/query-hooks/hooks/workflows"
import type {
  CancelWorkflowOutboxParams,
  CancelWorkflowParams,
  CancelWorkflowTimerParams,
  FireWorkflowTimerParams,
  MigrateWorkflowInstanceParams,
  PreflightWorkflowMigrationParams,
  SimulateWorkflowParams,
} from "@lumiere/stdb/types"
import { instanceStateTag, versionStatusTag } from "@/lib/workflow-enum"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function rowId(row: Record<string, unknown>): string {
  const v = row.id
  return v != null ? String(v) : ""
}

function newKey(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}`
}

function workflowRuntimeKey(): string {
  return crypto.randomUUID()
}

function optionString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null
  if (value && typeof value === "object" && "some" in value) {
    const some = (value as { some?: unknown }).some
    return typeof some === "string" ? some.trim() || null : null
  }
  return null
}

function num(row: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = row[k]
    if (v != null && v !== "") return Number(v)
  }
  return 0
}

export type WorkflowRowTab =
  | "workflows"
  | "versions"
  | "instances"
  | "operations"
  | "deadLetters"
  | "migrations"
  | "migrationResults"

export interface WorkflowMutationsBundle {
  publishVersion: UseMutationResult<
    unknown,
    Error,
    { workflowVersionId: bigint | number | string; expectedDraftRevision: number },
    unknown
  >
  cloneVersion: UseMutationResult<
    unknown,
    Error,
    { workflowVersionId: bigint | number | string; expectedDraftRevision: number },
    unknown
  >
  retireVersion: UseMutationResult<
    unknown,
    Error,
    { workflowVersionId: bigint | number | string; expectedDraftRevision: number },
    unknown
  >
  startWorkflow: UseMutationResult<void, Error, StartWorkflowInput, unknown>
  signalWorkflow: UseMutationResult<void, Error, SignalWorkflowInput, unknown>
  cancelWorkflow: UseMutationResult<unknown, Error, CancelWorkflowParams, unknown>
  simulateWorkflow: UseMutationResult<
    unknown,
    Error,
    { workflowVersionId: bigint | number | string; params: SimulateWorkflowParams },
    unknown
  >
  setPlanActive: UseMutationResult<
    unknown,
    Error,
    { planId: bigint | number | string; active: boolean },
    unknown
  >
  preflightMigration: UseMutationResult<unknown, Error, PreflightWorkflowMigrationParams, unknown>
  migrateInstance: UseMutationResult<unknown, Error, MigrateWorkflowInstanceParams, unknown>
  fireTimer: UseMutationResult<unknown, Error, FireWorkflowTimerParams, unknown>
  cancelTimer: UseMutationResult<unknown, Error, CancelWorkflowTimerParams, unknown>
  cancelOutbox: UseMutationResult<unknown, Error, CancelWorkflowOutboxParams, unknown>
}

export interface WorkflowsRowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tabId: WorkflowRowTab | null
  row: Record<string, unknown> | null
  t: TFunction
  mutations: WorkflowMutationsBundle
  decisionEvents?: Record<string, unknown>[]
  activePlans?: Record<string, unknown>[]
  workflowEdges?: Record<string, unknown>[]
  operatingCompanyId?: number | null
}

export function WorkflowsRowDialog({
  open,
  onOpenChange,
  tabId,
  row,
  t,
  mutations,
  decisionEvents = [],
  activePlans = [],
  workflowEdges = [],
  operatingCompanyId,
}: WorkflowsRowDialogProps) {
  const [migratePlanId, setMigratePlanId] = useState("")
  const [migrateReason, setMigrateReason] = useState("Operator cutover")
  const [startSubjectId, setStartSubjectId] = useState("")
  const [singletonTriggerKey, setSingletonTriggerKey] = useState("")
  const [signalKey, setSignalKey] = useState("")
  const [error, setError] = useState<string | null>(null)
  const canStartWorkflow = usePermission("workflow_instance", "create")
  const canSignalWorkflow = usePermission("workflow_instance", "write")

  if (!row || !tabId) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent />
      </Dialog>
    )
  }

  const id = rowId(row)
  const companyId = num(row, "companyId", "company_id")
  const workflowId = num(row, "workflowId", "workflow_id")
  const workflowVersionId =
    tabId === "versions" ? Number(id) : num(row, "workflowVersionId", "workflow_version_id")
  const subjectModel = String(row.subjectModel ?? row.subject_model ?? row.model ?? "").trim()
  const subjectId = num(row, "subjectId", "subject_id")
  const isPublished =
    versionStatusTag(row.status) === "Published" || row.statusTag === "Published"
  const isActive = instanceStateTag(row.state) === "Active" || row.stateTag === "Active"
  const signalKeys = Array.from(
    new Set(
      workflowEdges
        .filter(
          (edge) =>
            num(edge, "workflowVersionId", "workflow_version_id") === workflowVersionId,
        )
        .map((edge) => optionString(edge.signalKey ?? edge.signal_key))
        .filter((key): key is string => key !== null),
    ),
  ).sort()
  const instanceEvents = decisionEvents
    .filter((e) => String(e.instanceId ?? e.instance_id) === id)
    .slice(0, 12)

  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {tabId === "versions"
              ? t("workflows.rowDialog.versionTitle", { defaultValue: `Version #${id}` })
              : tabId === "instances"
                ? t("workflows.rowDialog.instanceTitle", { defaultValue: `Instance #${id}` })
                : tabId === "operations"
                  ? t("workflows.workflowsRowDialog.timer", { value1: id })
                  : tabId === "deadLetters"
                    ? t("workflows.workflowsRowDialog.outbox", { value1: id })
                    : tabId === "migrations"
                      ? t("workflows.workflowsRowDialog.migrationPlan", { value1: id })
                      : tabId === "migrationResults"
                        ? t("workflows.workflowsRowDialog.migrationResult", { value1: id })
                        : t("workflows.rowDialog.workflowTitle", {
                            defaultValue: `Workflow #${id}`,
                          })}
          </DialogTitle>
          <DialogDescription>
            {tabId === "versions"
              ? t("workflows.workflowsRowDialog.publishCloneSimulateOrRetireThisVersion")
              : tabId === "instances"
                ? t("workflows.workflowsRowDialog.cancelInspectHistoryOrMigrateWithAnActivePlan")
                : tabId === "operations"
                  ? t("workflows.workflowsRowDialog.fireOrCancelAPendingTimer")
                  : tabId === "deadLetters"
                    ? t("workflows.workflowsRowDialog.cancelADeadLetteredOrReconciliationOutboxRow")
                    : tabId === "migrations"
                      ? t("workflows.workflowsRowDialog.activateThePlanOrLeaveItInactive")
                      : t("workflows.workflowsRowDialog.workflowDefinitionAndRuntimeDetail")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm" data-testid={`workflow-row-dialog-${tabId}`}>
          {error ? (
            <p
              className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-destructive"
              data-testid="workflow-row-dialog-error"
            >
              {error}
            </p>
          ) : null}

          {tabId === "workflows" ? (
            <dl className="grid grid-cols-2 gap-2">
              <dt className="text-muted-foreground">{t("workflows.workflows.columns.key")}</dt>
              <dd>{String(row.workflowKey ?? row.workflow_key ?? "—")}</dd>
              <dt className="text-muted-foreground">{t("workflows.workflows.columns.model")}</dt>
              <dd>{String(row.model ?? "—")}</dd>
            </dl>
          ) : null}

          {tabId === "versions" ? (
            <>
              <dl className="grid grid-cols-2 gap-2">
                <dt className="text-muted-foreground">{t("workflows.workflows.columns.name")}</dt>
                <dd>{String(row.name ?? "—")}</dd>
                <dt className="text-muted-foreground">{t("workflows.workflows.columns.state")}</dt>
                <dd>{t(`workflows.versions.states.${versionStatusTag(row.status)}`, { defaultValue: versionStatusTag(row.status) || String(row.statusTag ?? "—") })}</dd>
                <dt className="text-muted-foreground">{t("workflows.workflowsRowDialog.draftRevision")}</dt>
                <dd>{String(row.draftRevision ?? row.draft_revision ?? "—")}</dd>
              </dl>
              {isPublished &&
              canStartWorkflow.allowed &&
              operatingCompanyId != null &&
              workflowId > 0 &&
              workflowVersionId > 0 &&
              subjectModel ? (
                <div className="space-y-3 rounded border p-3">
                  <p className="font-medium">{t("workflows.rowDialog.start")}</p>
                  <div className="space-y-2">
                    <Label htmlFor="workflow-version-start-subject-id">
                      {t("workflows.workflowsRowDialog.subjectIdForModel", { model: subjectModel })}
                    </Label>
                    <Input
                      id="workflow-version-start-subject-id"
                      inputMode="numeric"
                      value={startSubjectId}
                      onChange={(event) => setStartSubjectId(event.target.value)}
                      data-testid="workflow-version-start-subject-id"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="workflow-version-start-singleton-key">
                      {t("workflows.workflowsRowDialog.singletonTriggerKeyOptional")}{" "}</Label>
                    <Input
                      id="workflow-version-start-singleton-key"
                      value={singletonTriggerKey}
                      onChange={(event) => setSingletonTriggerKey(event.target.value)}
                      data-testid="workflow-version-start-singleton-key"
                    />
                  </div>
                  <Button
                    size="sm"
                    data-testid="workflow-version-start"
                    disabled={
                      !/^[1-9]\d*$/.test(startSubjectId.trim()) ||
                      mutations.startWorkflow.isPending
                    }
                    onClick={() =>
                      void run(() =>
                        mutations.startWorkflow.mutateAsync({
                          companyId: operatingCompanyId,
                          workflowId,
                          workflowVersionId,
                          subjectModel,
                          subjectId: startSubjectId.trim(),
                          singletonTriggerKey,
                          idempotencyKey: workflowRuntimeKey(),
                          correlationId: workflowRuntimeKey(),
                        }),
                      )
                    }
                  >
                    {t("accounting.amortization.form.fields.startDate")}{" "}</Button>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-2">
                {versionStatusTag(row.status) === "Draft" || row.statusTag === "Draft" ? (
                  <Button
                    size="sm"
                    data-testid="workflow-version-publish"
                    onClick={() =>
                      void run(() =>
                        mutations.publishVersion.mutateAsync({
                          workflowVersionId: id,
                          expectedDraftRevision: Number(
                            row.draftRevision ?? row.draft_revision ?? 1,
                          ),
                        }),
                      )
                    }
                    disabled={mutations.publishVersion.isPending}
                  >
                    {t("documents.documentsClient.publish")}{" "}</Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="workflow-version-clone"
                  onClick={() =>
                    void run(() =>
                      mutations.cloneVersion.mutateAsync({
                        workflowVersionId: id,
                        expectedDraftRevision: Number(
                          row.draftRevision ?? row.draft_revision ?? 1,
                        ),
                      }),
                    )
                  }
                  disabled={mutations.cloneVersion.isPending}
                >
                  {t("workflows.workflowsRowDialog.cloneToDraft")}{" "}</Button>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="workflow-version-simulate"
                  onClick={() =>
                    void run(() =>
                      mutations.simulateWorkflow.mutateAsync({
                        workflowVersionId: id,
                        params: {
                          simulationKey: newKey("sim"),
                          signalKey: undefined,
                          snapshot: {
                            subjectModel: String(row.model ?? "e2e.subject"),
                            subjectId: BigInt(0),
                            subjectRevisionHash:
                              "sha256:0000000000000000000000000000000000000000000000000000000000000000",
                            fields: [],
                          },
                        },
                      }),
                    )
                  }
                  disabled={mutations.simulateWorkflow.isPending}
                >
                  {t("workflows.workflowsRowDialog.simulate")}{" "}</Button>
                {versionStatusTag(row.status) === "Published" ||
                row.statusTag === "Published" ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    data-testid="workflow-version-retire"
                    onClick={() =>
                      void run(() =>
                        mutations.retireVersion.mutateAsync({
                          workflowVersionId: id,
                          expectedDraftRevision: Number(
                            row.draftRevision ?? row.draft_revision ?? 1,
                          ),
                        }),
                      )
                    }
                    disabled={mutations.retireVersion.isPending}
                  >
                    {t("workflows.workflowsRowDialog.retire")}{" "}</Button>
                ) : null}
              </div>
            </>
          ) : null}

          {tabId === "instances" ? (
            <>
              <dl className="grid grid-cols-2 gap-2">
                <dt className="text-muted-foreground">{t("accounting.invoiceEmailReviewDialog.subject")}</dt>
                <dd>
                  {String(row.subjectModel ?? row.subject_model ?? "—")} #
                  {String(row.subjectId ?? row.subject_id ?? "—")}
                </dd>
                <dt className="text-muted-foreground">{t("moduleInsights.state")}</dt>
                <dd>{t(`workflows.instances.states.${instanceStateTag(row.state)}`, { defaultValue: instanceStateTag(row.state) || String(row.stateTag ?? "—") })}</dd>
                <dt className="text-muted-foreground">{t("workflows.instances.columns.versionId")}</dt>
                <dd>{String(row.workflowVersionId ?? row.workflow_version_id ?? "—")}</dd>
                <dt className="text-muted-foreground">{t("proposalWorkspace.sectionConflict.revision")}</dt>
                <dd>{String(row.revision ?? "—")}</dd>
              </dl>

              {isActive && canSignalWorkflow.allowed && signalKeys.length > 0 ? (
                <div className="space-y-3 rounded border p-3">
                  <p className="font-medium">{t("workflows.workflowsRowDialog.signalInstance")}</p>
                  <div className="space-y-2">
                    <Label htmlFor="workflow-instance-signal-key">{t("workflows.workflowsRowDialog.signal")}</Label>
                    <Select value={signalKey} onValueChange={setSignalKey}>
                      <SelectTrigger id="workflow-instance-signal-key" data-testid="workflow-instance-signal-key">
                        <SelectValue placeholder={t("workflows.workflowsRowDialog.selectSignal")} />
                      </SelectTrigger>
                      <SelectContent>
                        {signalKeys.map((key) => (
                          <SelectItem key={key} value={key}>
                            {key}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    data-testid="workflow-instance-signal"
                    disabled={!signalKey || mutations.signalWorkflow.isPending}
                    onClick={() =>
                      void run(() =>
                        mutations.signalWorkflow.mutateAsync({
                          companyId,
                          instanceId: id,
                          workflowVersionId,
                          subjectModel,
                          subjectId,
                          expectedRevision: num(row, "revision"),
                          signalKey,
                          idempotencyKey: workflowRuntimeKey(),
                          correlationId: workflowRuntimeKey(),
                        }),
                      )
                    }
                  >
                    {t("workflows.workflowsRowDialog.signal")}{" "}</Button>
                </div>
              ) : null}

              {isActive ? (
                <div className="space-y-3 rounded border p-3">
                  <p className="font-medium">{t("workflows.workflowsRowDialog.migrateInstance")}</p>
                  <div className="space-y-2">
                    <Label htmlFor="mig-plan">{t("workflows.workflowsRowDialog.activePlanId")}</Label>
                    <Select value={migratePlanId} onValueChange={setMigratePlanId}>
                      <SelectTrigger id="mig-plan" data-testid="workflow-instance-migrate-plan">
                        <SelectValue placeholder={t("workflows.workflowsRowDialog.selectPlan")} />
                      </SelectTrigger>
                      <SelectContent>
                        {activePlans.map((p) => (
                          <SelectItem key={String(p.id)} value={String(p.id)}>
                            #{String(p.id)} {" "}{t("workflows.workflowsRowDialog.wf")}{" "}{String(p.workflowId ?? p.workflow_id)} ·{" "}
                            {String(p.sourceWorkflowVersionId ?? p.source_workflow_version_id)} →{" "}
                            {String(p.targetWorkflowVersionId ?? p.target_workflow_version_id)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mig-reason">{t("accounting.forms.reverseOperationalPayment.reason")}</Label>
                    <Input
                      id="mig-reason"
                      value={migrateReason}
                      onChange={(e) => setMigrateReason(e.target.value)}
                      data-testid="workflow-instance-migrate-reason"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="workflow-instance-preflight"
                      disabled={!migratePlanId || mutations.preflightMigration.isPending}
                      onClick={() =>
                        void run(() =>
                          mutations.preflightMigration.mutateAsync({
                            companyId: BigInt(companyId),
                            planId: BigInt(Number(migratePlanId)),
                            instanceId: BigInt(Number(id)),
                          }),
                        )
                      }
                    >
                      {t("workflows.workflowsRowDialog.preflight")}{" "}</Button>
                    <Button
                      size="sm"
                      data-testid="workflow-instance-migrate"
                      disabled={
                        !migratePlanId || !migrateReason.trim() || mutations.migrateInstance.isPending
                      }
                      onClick={() =>
                        void run(() =>
                          mutations.migrateInstance.mutateAsync({
                            companyId: BigInt(companyId),
                            planId: BigInt(Number(migratePlanId)),
                            instanceId: BigInt(Number(id)),
                            expectedInstanceRevision: BigInt(Number(row.revision ?? 0)),
                            reason: migrateReason.trim(),
                            idempotencyKey: newKey("migrate"),
                            correlationId: newKey("corr"),
                            causationId: undefined,
                          }),
                        )
                      }
                    >
                      {t("workflows.workflowsRowDialog.migrate")}{" "}</Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      data-testid="workflow-instance-cancel"
                      onClick={() =>
                        void run(() =>
                          mutations.cancelWorkflow.mutateAsync({
                            companyId: BigInt(companyId),
                            instanceId: BigInt(Number(id)),
                            expectedRevision: BigInt(Number(row.revision ?? 0)),
                            reason: "Cancelled from workflows UI",
                            idempotencyKey: newKey("cancel"),
                            correlationId: newKey("corr"),
                            causationId: undefined,
                          }),
                        )
                      }
                      disabled={mutations.cancelWorkflow.isPending}
                    >
                      {t("workflows.workflowsRowDialog.cancelInstance")}{" "}</Button>
                  </div>
                </div>
              ) : null}

              <div className="space-y-2" data-testid="workflow-instance-decision-history">
                <p className="font-medium">{t("workflows.workflowsRowDialog.decisionHistory")}</p>
                {instanceEvents.length === 0 ? (
                  <p className="text-muted-foreground">{t("workflows.workflowsRowDialog.noDecisionEventsForThisInstance")}</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {instanceEvents.map((ev) => (
                      <li key={String(ev.id)} className="rounded border px-2 py-1">
                        <span className="font-medium">
                          {String(
                            ev.commandKindTag ??
                              (typeof ev.commandKind === "object" &&
                              ev.commandKind &&
                              "tag" in (ev.commandKind as object)
                                ? (ev.commandKind as { tag: string }).tag
                                : ev.command_kind ?? t("workflows.workflowsRowDialog.event")),
                          )}
                        </span>
                        {" · "}{t("workflows.workflowsRowDialog.revision")}{" "}
                        {String(ev.priorRevision ?? ev.prior_revision ?? "?")}→
                        {String(ev.nextRevision ?? ev.next_revision ?? "?")}
                        {ev.reason ? ` · ${String(ev.reason)}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : null}

          {tabId === "operations" ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                data-testid="workflow-timer-fire"
                onClick={() =>
                  void run(() =>
                    mutations.fireTimer.mutateAsync({
                      companyId: BigInt(companyId),
                      timerId: BigInt(Number(id)),
                      expectedTimerRevision: BigInt(Number(row.revision ?? 0)),
                      expectedInstanceRevision: BigInt(
                        Number(row.instanceRevision ?? row.instance_revision ?? 0),
                      ),
                      idempotencyKey: newKey("timer-fire"),
                      correlationId: newKey("corr"),
                      causationId: undefined,
                    }),
                  )
                }
                disabled={mutations.fireTimer.isPending}
              >
                {t("workflows.workflowsRowDialog.fireTimer")}{" "}</Button>
              <Button
                size="sm"
                variant="outline"
                data-testid="workflow-timer-cancel"
                onClick={() =>
                  void run(() =>
                    mutations.cancelTimer.mutateAsync({
                      companyId: BigInt(companyId),
                      timerId: BigInt(Number(id)),
                      expectedTimerRevision: BigInt(Number(row.revision ?? 0)),
                      reason: "Cancelled from operations UI",
                      idempotencyKey: newKey("timer-cancel"),
                    }),
                  )
                }
                disabled={mutations.cancelTimer.isPending}
              >
                {t("workflows.workflowsRowDialog.cancelTimer")}{" "}</Button>
            </div>
          ) : null}

          {tabId === "deadLetters" ? (
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-2">
                <dt className="text-muted-foreground">{t("accounting.amortization.colRecognize")}</dt>
                <dd>{String(row.actionKey ?? row.action_key ?? "—")}</dd>
                <dt className="text-muted-foreground">{t("common.error.title")}</dt>
                <dd>{String(row.errorSummary ?? row.error_summary ?? "—")}</dd>
              </dl>
              <Button
                size="sm"
                variant="destructive"
                data-testid="workflow-outbox-cancel"
                onClick={() =>
                  void run(() =>
                    mutations.cancelOutbox.mutateAsync({
                      companyId: BigInt(companyId),
                      outboxId: BigInt(Number(id)),
                      expectedOutboxRevision: BigInt(Number(row.revision ?? 0)),
                      expectedQueueRevision: BigInt(0),
                      reason: "Cancelled from dead-letter UI",
                      idempotencyKey: newKey("outbox-cancel"),
                    }),
                  )
                }
                disabled={mutations.cancelOutbox.isPending}
              >
                {t("workflows.workflowsRowDialog.cancelOutbox")}{" "}</Button>
            </div>
          ) : null}

          {tabId === "migrations" ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                data-testid="workflow-migration-plan-toggle"
                onClick={() =>
                  void run(() =>
                    mutations.setPlanActive.mutateAsync({
                      planId: id,
                      active: !(row.active === true || row.active === "true"),
                    }),
                  )
                }
                disabled={mutations.setPlanActive.isPending}
              >
                {row.active === true || row.active === "true" ? t("workflows.rowDialog.toggleDeactivate") : t("workflows.rowDialog.toggleActivate")}
              </Button>
            </div>
          ) : null}

          {tabId === "migrationResults" ? (
            <dl className="grid grid-cols-2 gap-2">
              <dt className="text-muted-foreground">{t("aiHarness.evidenceReviewer.outcome")}</dt>
              <dd>{String(row.outcomeTag ?? row.outcome ?? "—")}</dd>
              <dt className="text-muted-foreground">{t("accounting.forms.reverseOperationalPayment.reason")}</dt>
              <dd>{String(row.reason ?? "—")}</dd>
              <dt className="text-muted-foreground">{t("common.error.title")}</dt>
              <dd>{String(row.errorSummary ?? row.error_summary ?? "—")}</dd>
            </dl>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
