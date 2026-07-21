"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, FormModal, newWorkflowForm, MissingOrganization } from "@lumiere/ui"
import type { FormConfig, ModuleConfig } from "@lumiere/ui"
import { workflowsModuleConfig } from "@/lib/module-dashboard-configs"
import { useWorkflowsModuleSubscription } from "@/lib/module-subscription-hooks"
import {
  useWorkflows,
  useWorkflowVersions,
  useWorkflowNodes,
  useWorkflowEdges,
  useWorkflowInstances,
  useWorkflowTimersLate,
  useWorkflowOutboxDead,
  useWorkflowDecisionEvents,
  useWorkflowMigrationPlans,
  useWorkflowMigrationResults,
  useCreateWorkflow,
  usePublishWorkflowVersion,
  useCloneWorkflowVersionToDraft,
  useRetireWorkflowVersion,
  useImportWorkflowCsv,
  useCancelWorkflow,
  useSimulateWorkflow,
  useCreateWorkflowMigrationPlan,
  useSetWorkflowMigrationPlanActive,
  usePreflightWorkflowMigration,
  useMigrateWorkflowInstance,
  useFireWorkflowTimer,
  useCancelWorkflowTimer,
  useCancelWorkflowOutbox,
} from "@lumiere/query-hooks/hooks/workflows"
import { toCreateWorkflowParams } from "@lumiere/erp-shared/workflows-create-params"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { instanceStateTag, versionStatusTag } from "@/lib/workflow-enum"
import {
  WorkflowsRowDialog,
  type WorkflowRowTab,
} from "./workflows-row-dialog"

interface WorkflowsClientProps {
  initialWorkflows?: Record<string, unknown>[]
  initialVersions?: Record<string, unknown>[]
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
  initialVersions,
  initialInstances,
  organizationId,
}: WorkflowsClientLoadedProps) {
  useWorkflowsModuleSubscription()
  const { t } = useTranslation()
  const baseConfig = useMemo(() => workflowsModuleConfig(t), [t])
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useOperatingCompanyId(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{
    form: FormConfig
    action: string
  } | null>(null)
  const [rowDialog, setRowDialog] = useState<{
    tabId: WorkflowRowTab
    row: Record<string, unknown>
  } | null>(null)

  const { data: workflows = [] } = useWorkflows(orgId, initialWorkflows)
  const { data: versionsRaw = [] } = useWorkflowVersions(orgId, initialVersions)
  const { data: nodesRaw = [] } = useWorkflowNodes(orgId)
  const { data: edgesRaw = [] } = useWorkflowEdges(orgId)
  const { data: instancesRaw = [] } = useWorkflowInstances(orgId, initialInstances)
  const { data: timersRaw = [] } = useWorkflowTimersLate(orgId)
  const { data: outboxRaw = [] } = useWorkflowOutboxDead(orgId)
  const { data: eventsRaw = [] } = useWorkflowDecisionEvents(orgId)
  const { data: plansRaw = [] } = useWorkflowMigrationPlans(orgId)
  const { data: resultsRaw = [] } = useWorkflowMigrationResults(orgId)

  const versions = useMemo(
    () => {
      const modelByWorkflowId = new Map<string, string>()
      for (const w of workflows) {
        modelByWorkflowId.set(String(w.id), String(w.model ?? ""))
      }
      return versionsRaw.map((row) => {
        const workflowId = String(row.workflowId ?? row.workflow_id ?? "")
        return {
          ...row,
          statusTag: versionStatusTag(row.status),
          draftRevision: row.draftRevision ?? row.draft_revision,
          schemaVersion: row.schemaVersion ?? row.schema_version,
          workflowId: row.workflowId ?? row.workflow_id,
          model: row.model ?? modelByWorkflowId.get(workflowId) ?? "",
        }
      })
    },
    [versionsRaw, workflows],
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
        companyId: row.companyId ?? row.company_id,
      })) as Record<string, unknown>[],
    [instancesRaw],
  )

  const instanceRevisionById = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of instances) {
      map.set(String(row.id), Number(row.revision ?? 0))
    }
    return map
  }, [instances])

  const operations = useMemo(
    () =>
      timersRaw.map((row) => {
        const instanceId = String(row.instanceId ?? row.instance_id ?? "")
        return {
          ...row,
          instanceId: row.instanceId ?? row.instance_id,
          dueAt: row.dueAt ?? row.due_at,
          semanticKey: row.semanticKey ?? row.semantic_key,
          companyId: row.companyId ?? row.company_id,
          instanceRevision: instanceRevisionById.get(instanceId) ?? 0,
        }
      }) as Record<string, unknown>[],
    [timersRaw, instanceRevisionById],
  )

  const deadLetters = useMemo(
    () =>
      outboxRaw.map((row) => ({
        ...row,
        instanceId: row.instanceId ?? row.instance_id,
        actionKey: row.actionKey ?? row.action_key,
        errorSummary: row.errorSummary ?? row.error_summary,
        companyId: row.companyId ?? row.company_id,
      })) as Record<string, unknown>[],
    [outboxRaw],
  )

  const migrations = useMemo(
    () =>
      plansRaw.map((row) => ({
        ...row,
        workflowId: row.workflowId ?? row.workflow_id,
        sourceWorkflowVersionId:
          row.sourceWorkflowVersionId ?? row.source_workflow_version_id,
        targetWorkflowVersionId:
          row.targetWorkflowVersionId ?? row.target_workflow_version_id,
        compatibilityTag: row.compatibilityTag ?? row.compatibility_tag,
        companyId: row.companyId ?? row.company_id,
      })) as Record<string, unknown>[],
    [plansRaw],
  )

  const migrationResults = useMemo(
    () =>
      resultsRaw.map((row) => ({
        ...row,
        planId: row.planId ?? row.plan_id,
        instanceId: row.instanceId ?? row.instance_id,
        outcomeTag: row.outcomeTag ?? row.outcome_tag,
        priorInstanceRevision:
          row.priorInstanceRevision ?? row.prior_instance_revision,
        nextInstanceRevision: row.nextInstanceRevision ?? row.next_instance_revision,
        errorSummary: row.errorSummary ?? row.error_summary,
      })) as Record<string, unknown>[],
    [resultsRaw],
  )

  const activePlans = useMemo(
    () =>
      migrations.filter((p) => p.active === true || p.active === "true"),
    [migrations],
  )

  const createWorkflow = useCreateWorkflow(orgId, operatingCompanyId)
  const publishVersion = usePublishWorkflowVersion(orgId, operatingCompanyId)
  const cloneVersion = useCloneWorkflowVersionToDraft(orgId, operatingCompanyId)
  const retireVersion = useRetireWorkflowVersion(orgId, operatingCompanyId)
  const importWorkflowCsv = useImportWorkflowCsv(orgId)
  const cancelWorkflow = useCancelWorkflow(orgId)
  const simulateWorkflow = useSimulateWorkflow(orgId)
  const createMigrationPlan = useCreateWorkflowMigrationPlan(orgId)
  const setPlanActive = useSetWorkflowMigrationPlanActive(orgId, operatingCompanyId)
  const preflightMigration = usePreflightWorkflowMigration(orgId)
  const migrateInstance = useMigrateWorkflowInstance(orgId)
  const fireTimer = useFireWorkflowTimer(orgId)
  const cancelTimer = useCancelWorkflowTimer(orgId)
  const cancelOutbox = useCancelWorkflowOutbox(orgId)

  const migrationPlanForm = useMemo<FormConfig>(
    () => ({
      id: "create-migration-plan",
      title: "New migration plan",
      description:
        "Map a published source version to a published target. Identity node/edge mappings are generated from the source graph.",
      sections: [
        {
          id: "plan",
          title: "Versions",
          fields: [
            {
              id: "workflowId",
              name: "workflowId",
              type: "number",
              label: "Workflow id",
              required: true,
              width: "1/2",
            },
            {
              id: "sourceWorkflowVersionId",
              name: "sourceWorkflowVersionId",
              type: "number",
              label: "Source version id",
              required: true,
              width: "1/2",
            },
            {
              id: "targetWorkflowVersionId",
              name: "targetWorkflowVersionId",
              type: "number",
              label: "Target version id",
              required: true,
              width: "1/2",
            },
            {
              id: "active",
              name: "active",
              type: "checkbox",
              label: "Activate immediately",
              width: "1/2",
            },
          ],
        },
      ],
    }),
    [],
  )

  const liveSections = useMemo(() => {
    const published = versions.filter((v) => v.statusTag === "Published").length
    const activeInst = instances.filter((i) => i.stateTag === "Active").length
    const completeInst = instances.filter((i) => i.stateTag === "Completed").length
    const cancelledInst = instances.filter((i) => i.stateTag === "Cancelled").length

    const dashboardTab = baseConfig.tabs.find((tab) => tab.id === "dashboard")
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
  }, [workflows, versions, instances, baseConfig, t])

  const config = useMemo<ModuleConfig>(
    () => ({
      ...baseConfig,
      tabs: baseConfig.tabs.map((tab) => {
        if (tab.id === "dashboard") return { ...tab, sections: liveSections }
        if (tab.id === "migrations") {
          return {
            ...tab,
            createForm: migrationPlanForm,
            createLabel: "New migration plan",
            createAction: "createMigrationPlan",
          }
        }
        return tab
      }),
    }),
    [liveSections, baseConfig, migrationPlanForm],
  )

  const data = useMemo(
    () => ({
      workflows: workflows as unknown as Record<string, unknown>[],
      versions: versions as unknown as Record<string, unknown>[],
      instances,
      operations,
      deadLetters,
      migrations,
      migrationResults,
    }),
    [
      workflows,
      versions,
      instances,
      operations,
      deadLetters,
      migrations,
      migrationResults,
    ],
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
      return
    }
    if (action === "createMigrationPlan") {
      if (operatingCompanyId == null) return
      const workflowId = Number(formData.workflowId)
      const sourceId = Number(formData.sourceWorkflowVersionId)
      const targetId = Number(formData.targetWorkflowVersionId)
      if (!workflowId || !sourceId || !targetId) return
      const sourceNodes = nodesRaw.filter(
        (n) => Number(n.workflowVersionId ?? n.workflow_version_id) === sourceId,
      )
      const sourceEdges = edgesRaw.filter(
        (e) => Number(e.workflowVersionId ?? e.workflow_version_id) === sourceId,
      )
      createMigrationPlan.mutate({
        companyId: BigInt(operatingCompanyId),
        workflowId: BigInt(workflowId),
        sourceWorkflowVersionId: BigInt(sourceId),
        targetWorkflowVersionId: BigInt(targetId),
        nodeMappings: sourceNodes.map((n) => {
          const key = String(n.nodeKey ?? n.node_key)
          return { fromNodeKey: key, toNodeKey: key }
        }),
        forkMappings: [],
        edgeMappings: sourceEdges.map((e) => {
          const key = String(e.edgeKey ?? e.edge_key)
          return { fromEdgeKey: key, toEdgeKey: key }
        }),
        active: Boolean(formData.active),
      })
    }
  }

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
        onRowClick={(tabId, row) => {
          const allowed: WorkflowRowTab[] = [
            "workflows",
            "versions",
            "instances",
            "operations",
            "deadLetters",
            "migrations",
            "migrationResults",
          ]
          if (allowed.includes(tabId as WorkflowRowTab)) {
            setRowDialog({ tabId: tabId as WorkflowRowTab, row })
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
        decisionEvents={eventsRaw as Record<string, unknown>[]}
        activePlans={activePlans}
        mutations={{
          publishVersion,
          cloneVersion,
          retireVersion,
          cancelWorkflow,
          simulateWorkflow,
          setPlanActive,
          preflightMigration,
          migrateInstance,
          fireTimer,
          cancelTimer,
          cancelOutbox,
        }}
      />
    </>
  )
}
