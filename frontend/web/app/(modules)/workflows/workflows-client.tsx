"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, FormModal, newWorkflowForm, MissingOrganization } from "@lumiere/ui"
import type { FormConfig } from "@lumiere/ui"
import { workflowsModuleConfig } from "@/lib/module-dashboard-configs"
import { useWorkflowsModuleSubscription } from "@/lib/module-subscription-hooks"
import {
  useWorkflows,
  useWorkflowVersions,
  useWorkflowInstances,
  useCreateWorkflow,
  usePublishWorkflowVersion,
  useCloneWorkflowVersionToDraft,
  useRetireWorkflowVersion,
  useImportWorkflowCsv,
  useCancelWorkflow,
} from "@lumiere/query-hooks/hooks/workflows"
import { toCreateWorkflowParams } from "@lumiere/erp-shared/workflows-create-params"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { instanceStateTag, versionStatusTag } from "@/lib/workflow-enum"
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
  organizationId,
}: WorkflowsClientLoadedProps) {
  useWorkflowsModuleSubscription()
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => workflowsModuleConfig(t), [t])
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useOperatingCompanyId(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{
    form: FormConfig
    action: string
  } | null>(null)
  const [rowDialog, setRowDialog] = useState<{
    tabId: "workflows" | "versions" | "instances"
    row: Record<string, unknown>
  } | null>(null)

  const { data: workflows = [] } = useWorkflows(orgId, initialWorkflows)
  const { data: versionsRaw = [] } = useWorkflowVersions(orgId)
  const { data: instancesRaw = [] } = useWorkflowInstances(orgId, initialInstances)

  const versions = useMemo(
    () =>
      versionsRaw.map((row) => ({
        ...row,
        statusTag: versionStatusTag(row.status),
        draftRevision: row.draftRevision ?? row.draft_revision,
        schemaVersion: row.schemaVersion ?? row.schema_version,
        workflowId: row.workflowId ?? row.workflow_id,
      })),
    [versionsRaw],
  )

  const instances = useMemo(
    () =>
      instancesRaw.map((row) => ({
        ...row,
        stateTag: instanceStateTag(row.state),
        subjectModel: row.subjectModel ?? row.subject_model,
        subjectId: row.subjectId ?? row.subject_id,
        workflowVersionId: row.workflowVersionId ?? row.workflow_version_id,
        startedAt: row.startedAt ?? row.started_at,
      })),
    [instancesRaw],
  )

  const createWorkflow = useCreateWorkflow(orgId, operatingCompanyId)
  const publishVersion = usePublishWorkflowVersion(orgId, operatingCompanyId)
  const cloneVersion = useCloneWorkflowVersionToDraft(orgId, operatingCompanyId)
  const retireVersion = useRetireWorkflowVersion(orgId, operatingCompanyId)
  const importWorkflowCsv = useImportWorkflowCsv(orgId)
  const cancelWorkflow = useCancelWorkflow(orgId)

  const liveSections = useMemo(() => {
    const published = versions.filter((v) => v.statusTag === "Published").length
    const activeInst = instances.filter((i) => i.stateTag === "Active").length
    const completeInst = instances.filter((i) => i.stateTag === "Completed").length
    const cancelledInst = instances.filter((i) => i.stateTag === "Cancelled").length

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
                  label: t("workflows.dashboard.active", { defaultValue: "Published versions" }),
                  value: String(published),
                  icon: "CheckCircle",
                },
                {
                  label: t("workflows.dashboard.activeInstances"),
                  value: String(activeInst),
                  icon: "Play",
                },
                {
                  label: t("workflows.dashboard.completed"),
                  value: String(completeInst + cancelledInst),
                  icon: "Flag",
                },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            new_workflow: () =>
              setQuickActionForm({ form: newWorkflowForm(t), action: "createWorkflow" }),
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
  }, [workflows, versions, instances, moduleConfig, t])

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
      versions: versions as unknown as Record<string, unknown>[],
      instances: instances as unknown as Record<string, unknown>[],
    }),
    [workflows, versions, instances],
  )

  const handleFormSubmit = (_tabId: string, action: string, formData: Record<string, unknown>) => {
    if (action === "createWorkflow") {
      const payload = toCreateWorkflowParams(formData)
      if (!payload) return
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
          if (tabId === "workflows" || tabId === "versions" || tabId === "instances") {
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
        t={t}
        mutations={{
          publishVersion,
          cloneVersion,
          retireVersion,
          cancelWorkflow,
        }}
      />
    </>
  )
}
