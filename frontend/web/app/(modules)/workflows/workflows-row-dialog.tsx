"use client"

import type { TFunction } from "i18next"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@lumiere/ui"
import type { UseMutationResult } from "@tanstack/react-query"
import type { CancelWorkflowParams } from "@lumiere/stdb/types"
import { instanceStateTag, versionStatusTag } from "@/lib/workflow-enum"

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

export interface WorkflowMutationsBundle {
  publishVersion: UseMutationResult<
    unknown,
    Error,
    { workflowVersionId: bigint | number | string; expectedDraftRevision: number },
    unknown
  >
  cloneVersion: UseMutationResult<unknown, Error, bigint | number | string, unknown>
  retireVersion: UseMutationResult<unknown, Error, bigint | number | string, unknown>
  cancelWorkflow: UseMutationResult<unknown, Error, CancelWorkflowParams, unknown>
}

export interface WorkflowsRowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tabId: "workflows" | "versions" | "instances" | null
  row: Record<string, unknown> | null
  t: TFunction
  mutations: WorkflowMutationsBundle
}

export function WorkflowsRowDialog({
  open,
  onOpenChange,
  tabId,
  row,
  t,
  mutations,
}: WorkflowsRowDialogProps) {
  if (!row || !tabId) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent />
      </Dialog>
    )
  }

  const id = rowId(row)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {tabId === "versions"
              ? t("workflows.rowDialog.versionTitle", { defaultValue: `Version #${id}` })
              : tabId === "instances"
                ? t("workflows.rowDialog.instanceTitle", { defaultValue: `Instance #${id}` })
                : t("workflows.rowDialog.workflowTitle", { defaultValue: `Workflow #${id}` })}
          </DialogTitle>
          <DialogDescription>
            {tabId === "versions"
              ? "Publish, clone to draft, or retire this version."
              : tabId === "instances"
                ? "Cancel a running instance (requires current revision)."
                : "Stable workflow identity. Edit draft versions from the Versions tab."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {tabId === "workflows" ? (
            <dl className="grid grid-cols-2 gap-2">
              <dt className="text-muted-foreground">Key</dt>
              <dd>{String(row.workflowKey ?? row.workflow_key ?? "—")}</dd>
              <dt className="text-muted-foreground">Model</dt>
              <dd>{String(row.model ?? "—")}</dd>
            </dl>
          ) : null}

          {tabId === "versions" ? (
            <>
              <dl className="grid grid-cols-2 gap-2">
                <dt className="text-muted-foreground">Name</dt>
                <dd>{String(row.name ?? "—")}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>{versionStatusTag(row.status) || String(row.statusTag ?? "—")}</dd>
                <dt className="text-muted-foreground">Draft revision</dt>
                <dd>{String(row.draftRevision ?? row.draft_revision ?? "—")}</dd>
              </dl>
              <div className="flex flex-wrap gap-2 pt-2">
                {versionStatusTag(row.status) === "Draft" || row.statusTag === "Draft" ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      mutations.publishVersion.mutate({
                        workflowVersionId: id,
                        expectedDraftRevision: Number(
                          row.draftRevision ?? row.draft_revision ?? 1,
                        ),
                      })
                    }
                    disabled={mutations.publishVersion.isPending}
                  >
                    Publish
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => mutations.cloneVersion.mutate(id)}
                  disabled={mutations.cloneVersion.isPending}
                >
                  Clone to draft
                </Button>
                {versionStatusTag(row.status) === "Published" ||
                row.statusTag === "Published" ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => mutations.retireVersion.mutate(id)}
                    disabled={mutations.retireVersion.isPending}
                  >
                    Retire
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}

          {tabId === "instances" ? (
            <>
              <dl className="grid grid-cols-2 gap-2">
                <dt className="text-muted-foreground">Subject</dt>
                <dd>
                  {String(row.subjectModel ?? row.subject_model ?? "—")} #
                  {String(row.subjectId ?? row.subject_id ?? "—")}
                </dd>
                <dt className="text-muted-foreground">State</dt>
                <dd>{instanceStateTag(row.state) || String(row.stateTag ?? "—")}</dd>
                <dt className="text-muted-foreground">Revision</dt>
                <dd>{String(row.revision ?? "—")}</dd>
              </dl>
              {instanceStateTag(row.state) === "Active" || row.stateTag === "Active" ? (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() =>
                    mutations.cancelWorkflow.mutate({
                      companyId: BigInt(Number(row.companyId ?? row.company_id ?? 0)),
                      instanceId: BigInt(Number(id)),
                      expectedRevision: BigInt(Number(row.revision ?? 0)),
                      reason: "Cancelled from workflows UI",
                      idempotencyKey: newKey("cancel"),
                      correlationId: newKey("corr"),
                      causationId: undefined,
                    })
                  }
                  disabled={mutations.cancelWorkflow.isPending}
                >
                  Cancel instance
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
