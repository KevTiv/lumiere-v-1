"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, FormModal, newWorkflowForm, MissingOrganization } from "@lumiere/ui"
import type { FormConfig } from "@lumiere/ui"
import { workflowsModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useWorkflows,
  useWorkflowInstances,
  useWorkflowActivities,
  useWorkflowWorkitems,
  useCreateWorkflow,
  useSetWorkflowActive,
  useAddWorkflowActivity,
  useAddWorkflowTransition,
  useImportWorkflowCsv,
  useStartWorkflow,
  useSignalWorkflow,
  useCancelWorkflowInstance,
  useSetWorkitemException,
} from "@lumiere/query-hooks/hooks/workflows"
import type { CreateWorkflowParams } from "@lumiere/query-hooks/hooks/workflows"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { instanceStateTag } from "@/lib/workflow-enum"
import { WorkflowsRowDialog } from "./workflows-row-dialog"

interface WorkflowsClientProps {
  initialWorkflows?: Record<string, unknown>[]
  initialInstances?: Record<string, unknown>[]
  initialActivities?: Record<string, unknown>[]
  initialWorkitems?: Record<string, unknown>[]
  organizationId?: number
}

type WorkflowsClientLoadedProps = Omit<WorkflowsClientProps, "organizationId"> & {
  organizationId: number
}

export function WorkflowsClient(props: WorkflowsClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <WorkflowsClientLoaded {...props} organizationId={props.organizationId} />
}

function WorkflowsClientLoaded({
  initialWorkflows,
  initialInstances,
  initialActivities,
  initialWorkitems,
  organizationId,
}: WorkflowsClientLoadedProps) {
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => workflowsModuleConfig(t), [t])
  const { orgId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(
    null,
  )
  const [rowDialog, setRowDialog] = useState<{
    tabId: "workflows" | "instances"
    row: Record<string, unknown>
  } | null>(null)

  const { data: workflows = [] } = useWorkflows(orgId, initialWorkflows)
  const { data: instancesRaw = [] } = useWorkflowInstances(orgId, initialInstances)
  const { data: activities = [] } = useWorkflowActivities(orgId, initialActivities)
  const { data: workitems = [] } = useWorkflowWorkitems(orgId, initialWorkitems)

  const instances = useMemo(
    () =>
      instancesRaw.map((row) => ({
        ...row,
        stateTag: instanceStateTag(row.state),
      })),
    [instancesRaw],
  )

  const createWorkflow = useCreateWorkflow(orgId)
  const setWorkflowActive = useSetWorkflowActive(orgId)
  const addWorkflowActivity = useAddWorkflowActivity(orgId)
  const addWorkflowTransition = useAddWorkflowTransition(orgId)
  const importWorkflowCsv = useImportWorkflowCsv(orgId)
  const startWorkflow = useStartWorkflow(orgId)
  const signalWorkflow = useSignalWorkflow(orgId)
  const cancelWorkflowInstance = useCancelWorkflowInstance(orgId)
  const setWorkitemException = useSetWorkitemException(orgId)

  const liveSections = useMemo(() => {
    const activeDefs = workflows.filter((w) => w.isActive).length
    const activeInst = instances.filter((i) => i.stateTag === "Active").length
    const completeInst = instances.filter((i) => i.stateTag === "Complete").length

    const dashboardTab = moduleConfig.tabs.find((tab) => tab.id === "dashboard")
    if (!dashboardTab?.sections) return []

    return dashboardTab.sections.map((section) => ({
      ...section,
      widgets: section.widgets.map((w) => {
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                {
                  label: t("workflows.dashboard.totalWorkflows"),
                  value: String(workflows.length),
                  icon: "GitBranch",
                },
                {
                  label: t("workflows.dashboard.active"),
                  value: String(activeDefs),
                  icon: "CheckCircle",
                },
                {
                  label: t("workflows.dashboard.activeInstances"),
                  value: String(activeInst),
                  icon: "Play",
                },
                {
                  label: t("workflows.dashboard.completed"),
                  value: String(completeInst),
                  icon: "Flag",
                },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            new_workflow: () => setQuickActionForm({ form: newWorkflowForm(t), action: "createWorkflow" }),
            import_workflow_csv: () =>
              setQuickActionForm({
                form: {
                  id: "import-csv-quick",
                  title: t("workflows.forms.importCsv.title"),
                  description: t("workflows.forms.importCsv.description"),
                  sections: [
                    {
                      id: "csv",
                      title: t("workflows.forms.importCsv.sections.data"),
                      fields: [
                        {
                          id: "csvData",
                          name: "csvData",
                          type: "textarea",
                          label: t("workflows.forms.importCsv.fields.csvData"),
                          required: true,
                          rows: 10,
                          width: "full",
                        },
                      ],
                    },
                  ],
                },
                action: "importWorkflowCsv",
              }),
          }
          return {
            ...w,
            data: {
              ...w.data,
              actions: w.data.actions.map((a) => ({
                ...a,
                onClick: handlers[a.id],
              })),
            },
          }
        }
        return w
      }),
    }))
  }, [workflows, instances, moduleConfig, t])

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: moduleConfig.tabs.map((tab) =>
        tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab,
      ),
    }),
    [liveSections, moduleConfig],
  )

  const data = useMemo(
    () => ({
      workflows: workflows as unknown as Record<string, unknown>[],
      instances: instances as unknown as Record<string, unknown>[],
    }),
    [workflows, instances],
  )

  const handleFormSubmit = (_tabId: string, action: string, formData: Record<string, unknown>) => {
    if (action === "createWorkflow") {
      const name = String(formData.name ?? "").trim()
      const model = String(formData.model ?? "").trim()
      const stateField = String(formData.stateField ?? "").trim()
      if (!name || !model || !stateField) return
      const payload: CreateWorkflowParams = {
        name,
        model,
        stateField,
        onCreate: Boolean(formData.onCreate),
        isActive: formData.isActive !== false,
        description: formData.description ? String(formData.description) : undefined,
        metadata: undefined,
      }
      createWorkflow.mutate(payload)
      return
    }
    if (action === "importWorkflowCsv") {
      const csv = String(formData.csvData ?? "")
      if (!csv.trim()) return
      importWorkflowCsv.mutate(csv)
    }
  }

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
        onRowClick={(tabId, row) => {
          if (tabId === "workflows" || tabId === "instances") {
            setRowDialog({ tabId, row })
          }
        }}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? newWorkflowForm(t)}
        onSubmit={(formData) => {
          if (quickActionForm) {
            handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
      <WorkflowsRowDialog
        open={rowDialog !== null}
        onOpenChange={(open) => !open && setRowDialog(null)}
        tabId={rowDialog?.tabId ?? null}
        row={rowDialog?.row ?? null}
        activities={activities}
        workitems={workitems}
        t={t}
        mutations={{
          setWorkflowActive,
          addWorkflowActivity,
          addWorkflowTransition,
          importWorkflowCsv,
          startWorkflow,
          signalWorkflow,
          cancelWorkflowInstance,
          setWorkitemException,
        }}
      />
    </>
  )
}
