"use client"

import { useEffect, useMemo, useState } from "react"
import type { TFunction } from "i18next"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FormModal,
  Input,
  Label,
  workflowAddActivityForm,
  workflowAddTransitionForm,
  workflowImportCsvForm,
} from "@lumiere/ui"
import type { UseMutationResult } from "@tanstack/react-query"
import type { QueryRows } from "@/lib/query-fetch"
import { instanceStateTag, workitemStateTag } from "@/lib/workflow-enum"
import type {
  AddWorkflowActivityParams,
  AddWorkflowTransitionParams,
} from "@lumiere/stdb/generated/types"

function rowId(row: Record<string, unknown>): string {
  const v = row.id
  return v != null ? String(v) : ""
}

type Panel = "main" | "addActivity" | "addTransition" | "importCsv"

export interface WorkflowMutationsBundle {
  setWorkflowActive: UseMutationResult<
    unknown,
    Error,
    { workflowId: bigint | number | string; isActive: boolean },
    unknown
  >
  addWorkflowActivity: UseMutationResult<
    unknown,
    Error,
    { workflowId: bigint | number | string; params: AddWorkflowActivityParams },
    unknown
  >
  addWorkflowTransition: UseMutationResult<
    unknown,
    Error,
    {
      workflowId: bigint | number | string
      activityFrom: bigint | number | string
      activityTo: bigint | number | string
      params: AddWorkflowTransitionParams
    },
    unknown
  >
  importWorkflowCsv: UseMutationResult<unknown, Error, string, unknown>
  startWorkflow: UseMutationResult<
    unknown,
    Error,
    { workflowId: bigint | number | string; resId: bigint | number | string; resType: string },
    unknown
  >
  signalWorkflow: UseMutationResult<
    unknown,
    Error,
    { instanceId: bigint | number | string; signal: string },
    unknown
  >
  cancelWorkflowInstance: UseMutationResult<unknown, Error, bigint | number | string, unknown>
  setWorkitemException: UseMutationResult<unknown, Error, bigint | number | string, unknown>
}

export interface WorkflowsRowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tabId: "workflows" | "instances" | null
  row: Record<string, unknown> | null
  activities: QueryRows
  workitems: QueryRows
  mutations: WorkflowMutationsBundle
  t: TFunction
}

export function WorkflowsRowDialog({
  open,
  onOpenChange,
  tabId,
  row,
  activities,
  workitems,
  mutations,
  t,
}: WorkflowsRowDialogProps) {
  const [panel, setPanel] = useState<Panel>("main")
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [signalText, setSignalText] = useState("")
  const [resType, setResType] = useState("")
  const [resId, setResId] = useState("")

  useEffect(() => {
    if (open) {
      setPanel("main")
      setSubmitError(null)
      setSignalText("")
      setResType("")
      setResId("")
    }
  }, [open, tabId, row])

  const id = row ? rowId(row) : ""

  const activityOptions = useMemo(() => {
    if (!row || tabId !== "workflows") return []
    const wf = row.id
    return activities
      .filter((a) => String(a.workflowId) === String(wf))
      .map((a) => ({
        value: String(a.id ?? ""),
        label: `${String(a.name ?? "Activity")} (#${a.id})`,
      }))
      .filter((o) => o.value !== "")
  }, [activities, row, tabId])

  const instanceWorkitems = useMemo(() => {
    if (!row || tabId !== "instances") return []
    const iid = row.id
    return workitems.filter((w) => String(w.instanceId) === String(iid))
  }, [workitems, row, tabId])

  const instanceTag = row ? instanceStateTag(row.state) : ""
  const isWorkflow = tabId === "workflows" && row
  const isInstance = tabId === "instances" && row

  const addActivityConfig = useMemo(
    () => (isWorkflow ? workflowAddActivityForm(t, id) : null),
    [isWorkflow, t, id],
  )

  const addTransitionConfig = useMemo(
    () =>
      isWorkflow && activityOptions.length >= 2
        ? workflowAddTransitionForm(t, id, activityOptions)
        : null,
    [isWorkflow, t, id, activityOptions],
  )

  const importConfig = useMemo(() => workflowImportCsvForm(t), [t])

  if (!row || !tabId) return null

  return (
    <>
      <Dialog open={open && panel === "main"} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {tabId === "workflows"
                ? t("workflows.rowDialog.workflowTitle")
                : t("workflows.rowDialog.instanceTitle")}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs">id: {id}</DialogDescription>
          </DialogHeader>

          {isWorkflow && (
            <div className="space-y-3 py-2">
              <p className="text-sm">
                <span className="text-muted-foreground">{String(row.model ?? "")}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={row.isActive ? "outline" : "default"}
                  onClick={() =>
                    mutations.setWorkflowActive.mutate({
                      workflowId: id,
                      isActive: !Boolean(row.isActive),
                    })
                  }
                >
                  {row.isActive
                    ? t("workflows.rowDialog.toggleDeactivate")
                    : t("workflows.rowDialog.toggleActivate")}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setPanel("addActivity")}>
                  {t("workflows.rowDialog.addActivity")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={activityOptions.length < 2}
                  onClick={() => setPanel("addTransition")}
                >
                  {t("workflows.rowDialog.addTransition")}
                </Button>
                <Button type="button" variant="outline" onClick={() => setPanel("importCsv")}>
                  {t("workflows.rowDialog.importCsv")}
                </Button>
              </div>

              <div className="rounded-md border border-border/60 p-3 space-y-2">
                <p className="text-sm font-medium">{t("workflows.rowDialog.startInstance")}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="wf-res-type">{t("workflows.rowDialog.resType")}</Label>
                    <Input
                      id="wf-res-type"
                      value={resType}
                      onChange={(e) => setResType(e.target.value)}
                      placeholder="sale_order"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="wf-res-id">{t("workflows.rowDialog.resId")}</Label>
                    <Input
                      id="wf-res-id"
                      value={resId}
                      onChange={(e) => setResId(e.target.value)}
                      placeholder="1"
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    const rt = resType.trim()
                    const ri = resId.trim()
                    if (!rt || !ri) return
                    mutations.startWorkflow.mutate({
                      workflowId: id,
                      resType: rt,
                      resId: ri,
                    })
                  }}
                >
                  {t("workflows.rowDialog.start")}
                </Button>
              </div>
            </div>
          )}

          {isInstance && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                {String(row.resType ?? "")} · #{String(row.resId ?? "")} ·{" "}
                <span className="text-foreground">{instanceTag}</span>
              </p>

              {instanceTag === "Active" && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="wf-signal">{t("workflows.rowDialog.signalLabel")}</Label>
                    <Input
                      id="wf-signal"
                      value={signalText}
                      onChange={(e) => setSignalText(e.target.value)}
                      placeholder={t("workflows.rowDialog.signalPlaceholder")}
                    />
                  </div>
                  <Button
                    type="button"
                    onClick={() => {
                      const s = signalText.trim()
                      if (!s) return
                      mutations.signalWorkflow.mutate({ instanceId: id, signal: s })
                    }}
                  >
                    {t("workflows.rowDialog.sendSignal")}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className="ml-2"
                    onClick={() => mutations.cancelWorkflowInstance.mutate(id)}
                  >
                    {t("workflows.rowDialog.cancelInstance")}
                  </Button>
                </>
              )}

              {instanceTag === "Active" && instanceWorkitems.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-border/50">
                  <p className="text-sm font-medium">{t("workflows.rowDialog.workitems")}</p>
                  <ul className="space-y-1 text-sm">
                    {instanceWorkitems.map((w) => (
                      <li key={String(w.id)} className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs">
                          #{String(w.id)} act {String(w.actId)} · {workitemStateTag(w.state)}
                        </span>
                        {workitemStateTag(w.state) === "Active" && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => mutations.setWorkitemException.mutate(String(w.id))}
                          >
                            {t("workflows.rowDialog.markException")}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {addActivityConfig && (
        <FormModal
          open={open && panel === "addActivity"}
          onOpenChange={(o) => {
            if (!o) {
              setPanel("main")
              if (!open) onOpenChange(false)
            }
          }}
          config={addActivityConfig}
          closeOnSubmit={false}
          submitError={submitError}
          onSubmit={async (data) => {
            setSubmitError(null)
            try {
              const seq = Number(data.sequence)
              const params: AddWorkflowActivityParams = {
                name: String(data.name ?? "").trim(),
                kind: String(data.kind ?? "Dummy"),
                splitMode: String(data.splitMode ?? "XOR"),
                joinMode: String(data.joinMode ?? "XOR"),
                flowStart: Boolean(data.flowStart),
                flowStop: Boolean(data.flowStop),
                sequence: Number.isFinite(seq) ? (seq as number) : 0,
                action: undefined,
                actionId: undefined,
                triggerModel: undefined,
                triggerExprId: undefined,
                signalSend: undefined,
                subflowId: undefined,
                stateFrom: undefined,
                stateTo: undefined,
                description: undefined,
                metadata: undefined,
              }
              await mutations.addWorkflowActivity.mutateAsync({
                workflowId: id,
                params,
              })
              setPanel("main")
            } catch (e) {
              setSubmitError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      )}

      {addTransitionConfig && (
        <FormModal
          open={open && panel === "addTransition"}
          onOpenChange={(o) => {
            if (!o) {
              setPanel("main")
              if (!open) onOpenChange(false)
            }
          }}
          config={addTransitionConfig}
          closeOnSubmit={false}
          submitError={submitError}
          onSubmit={async (data) => {
            setSubmitError(null)
            try {
              const seq = Number(data.sequence)
              const sig = String(data.signal ?? "").trim()
              const params: AddWorkflowTransitionParams = {
                sequence: Number.isFinite(seq) ? (seq as number) : 0,
                signal: sig || undefined,
                condition: undefined,
                triggerModel: undefined,
                triggerExprId: undefined,
                groupId: undefined,
                metadata: undefined,
              }
              await mutations.addWorkflowTransition.mutateAsync({
                workflowId: id,
                activityFrom: String(data.activityFrom ?? ""),
                activityTo: String(data.activityTo ?? ""),
                params,
              })
              setPanel("main")
            } catch (e) {
              setSubmitError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      )}

      <FormModal
        open={open && panel === "importCsv"}
        onOpenChange={(o) => {
          if (!o) {
            setPanel("main")
            if (!open) onOpenChange(false)
          }
        }}
        config={importConfig}
        closeOnSubmit={false}
        submitError={submitError}
        onSubmit={async (data) => {
          setSubmitError(null)
          try {
            const csv = String(data.csvData ?? "")
            if (!csv.trim()) return
            await mutations.importWorkflowCsv.mutateAsync(csv)
            setPanel("main")
          } catch (e) {
            setSubmitError(e instanceof Error ? e.message : String(e))
          }
        }}
      />
    </>
  )
}
