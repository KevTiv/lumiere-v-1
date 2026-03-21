"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, FormModal, newWorkflowForm } from "@lumiere/ui"
import type { FormConfig } from "@lumiere/ui"
import { workflowsModuleConfig } from "@/lib/module-dashboard-configs"
import { useWorkflows, useWorkflowInstances, useCreateWorkflow, useStdbConnection, getStdbConnection, workflowsSubscriptions } from "@lumiere/stdb"
import type { CreateWorkflowParams } from "@lumiere/stdb"

interface WorkflowsClientProps {
  initialWorkflows?: Record<string, unknown>[]
  initialInstances?: Record<string, unknown>[]
  organizationId?: number
}

export function WorkflowsClient({ initialWorkflows, initialInstances, organizationId }: WorkflowsClientProps) {
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => workflowsModuleConfig(t), [t])
  const orgId = BigInt(organizationId ?? 1)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const { connected } = useStdbConnection()

  useEffect(() => {
    const conn = getStdbConnection()
    if (!conn || !connected) return
    conn.subscriptionBuilder()
      .onError((err) => console.error("[stdb] workflows subscription error", err))
      .subscribe(workflowsSubscriptions(orgId))
  }, [connected, orgId])

  const { data: workflows = [] } = useWorkflows(orgId, initialWorkflows)
  const { data: instances = [] } = useWorkflowInstances(orgId, initialInstances)
  const createWorkflow = useCreateWorkflow(orgId)

  const liveSections = useMemo(() => {
    const active = workflows.filter((w) => w.isActive).length
    const running = instances.filter((i) => String(i.state) === "running").length
    const done = instances.filter((i) => String(i.state) === "done").length

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
                { label: "Total Workflows", value: String(workflows.length), icon: "GitBranch" },
                { label: "Active", value: String(active), icon: "CheckCircle" },
                { label: "Running Instances", value: String(running), icon: "Play" },
                { label: "Completed", value: String(done), icon: "Flag" },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            new_workflow: () => setQuickActionForm({ form: newWorkflowForm(t), action: "createWorkflow" }),
          }
          return {
            ...w,
            data: {
              ...w.data,
              actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
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

  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createWorkflow") {
      createWorkflow.mutate({
        name: formData.name as string,
        model: formData.model as string,
        stateField: formData.stateField as string,
        description: formData.description as string | undefined,
        metadata: undefined,
      } as unknown as CreateWorkflowParams)
    }
  }

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
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
    </>
  )
}
