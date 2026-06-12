"use client"

import { useEffect, useRef, useState } from "react"
import { useErpSession } from "@lumiere/erp-session"
import { buildEntitySelection, resolveAiEntityType } from "@lumiere/query-hooks/ai-ui-context"
import {
  useErpAiSelectionReporter,
  useErpAiSelectionState,
} from "@lumiere/query-hooks/erp-ai-selection-context"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/tabs"
import { Button } from "../components/button"
import { DashboardGrid } from "./dashboard-grid"
import { DashboardHeader } from "./dashboard-header"
import { EntityView } from "../entity-views/entity-view"
import { FormModal } from "../forms/form-modal"
import type { ModuleConfig } from "../lib/module-types"
import { isEntitySurfaceVisible } from "../lib/entity-view-types"
import { useRBAC } from "../lib/rbac-context"

interface ModuleViewProps {
  config: ModuleConfig
  /** Live data keyed by tab id — entity tabs receive data[tab.id] */
  data?: Record<string, Record<string, unknown>[]>
  /** Called when a create form is submitted: tabId, createAction, form values */
  onFormSubmit?: (
    tabId: string,
    action: string,
    data: Record<string, unknown>,
  ) => void | Promise<void>
  /** Forwarded to tab create {@link FormModal} — e.g. parent mutation `isPending`. */
  isPending?: boolean
  /** Called when a table row is clicked: tabId, row record */
  onRowClick?: (tabId: string, row: Record<string, unknown>) => void
  /** Controlled tab (use with `onActiveTabChange`, e.g. dashboard quick action → vendors tab) */
  activeTab?: string
  onActiveTabChange?: (tab: string) => void
}

export function ModuleView({
  config,
  data = {},
  onFormSubmit,
  onRowClick,
  activeTab: activeTabProp,
  onActiveTabChange,
  isPending,
}: ModuleViewProps) {
  const { checkPermission } = useRBAC()
  const { companyIds } = useErpSession()
  const aiReporter = useErpAiSelectionReporter()
  const aiSelection = useErpAiSelectionState()
  const defaultCompanyId = companyIds?.[0]
  const defaultTab = config.defaultTab ?? config.tabs[0]?.id ?? ""
  const [internalTab, setInternalTab] = useState(defaultTab)
  const activeTab = activeTabProp ?? internalTab
  const prevActiveTabRef = useRef<string | null>(null)
  const setActiveTab = (v: string) => {
    onActiveTabChange?.(v)
    if (activeTabProp === undefined) setInternalTab(v)
  }
  const [openForm, setOpenForm] = useState<string | null>(null)

  useEffect(() => {
    if (prevActiveTabRef.current === activeTab) return
    prevActiveTabRef.current = activeTab
    aiReporter?.setActiveTab(activeTab)
  }, [activeTab, aiReporter])

  return (
    <div className="flex flex-col min-h-full gap-2" data-testid={`module-view-${config.id}`}>
      <DashboardHeader title={config.title} description={config.description} />

      <Tabs value={activeTab} onValueChange={setActiveTab} className={"flex-col flex"}>
        <TabsList variant="default" className="w-full flex flex-wrap justify-start max-w-fit gap-2">
          {config.tabs.map((tab, i) => (
            <TabsTrigger
              tabIndex={i}
              key={tab.id}
              value={tab.id}
              data-testid={`module-tab-${config.id}-${tab.id}`}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {config.tabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="mt-6">
            {tab.type === "dashboard" && tab.sections && (
              <DashboardGrid sections={tab.sections} />
            )}

            {tab.type === "custom" && tab.customContent}

            {tab.type === "entity" && tab.entityConfig && (
              <div className="space-y-3">
                {tab.createForm &&
                  isEntitySurfaceVisible(
                    { permission: tab.createPermission },
                    checkPermission,
                  ) && (
                  <div className="flex justify-end">
                    <Button
                      size="lg"
                      onClick={() => setOpenForm(tab.id)}
                      data-testid={`module-create-${config.id}-${tab.id}`}
                    >
                      {tab.createLabel ?? "New"}
                    </Button>
                  </div>
                )}

                <EntityView
                  config={tab.entityConfig}
                  data={data[tab.id] ?? []}
                  aiFocusRowKey={
                    aiSelection.selection?.activeTab === tab.id &&
                    aiSelection.selection.entityId &&
                    resolveAiEntityType(tab.entityConfig) === aiSelection.selection.entityType
                      ? aiSelection.selection.entityId
                      : undefined
                  }
                  onRowClick={(row) => {
                    const entityType = resolveAiEntityType(tab.entityConfig!)
                    if (entityType) {
                      aiReporter?.setSelection(
                        buildEntitySelection({
                          activeTab: tab.id,
                          entityType,
                          row,
                          rowKey:
                            tab.entityConfig!.view.mode === "table"
                              ? tab.entityConfig!.view.rowKey
                              : undefined,
                        }),
                      )
                    }
                    onRowClick?.(tab.id, row)
                  }}
                />

                {tab.createForm && (
                  <FormModal
                    open={openForm === tab.id}
                    onOpenChange={(open) => !open && setOpenForm(null)}
                    config={tab.createForm}
                    isPending={isPending}
                    aiAssist={
                      defaultCompanyId && tab.entityConfig
                        ? {
                            companyId: defaultCompanyId,
                            formId: tab.createForm.id,
                            entityType:
                              resolveAiEntityType(tab.entityConfig) ?? tab.entityConfig.id,
                          }
                        : undefined
                    }
                    onSubmit={async (formData) => {
                      await onFormSubmit?.(
                        tab.id,
                        tab.createAction ?? tab.id,
                        formData,
                      )
                    }}
                  />
                )}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
