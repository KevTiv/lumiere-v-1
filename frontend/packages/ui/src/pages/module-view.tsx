"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useErpSession } from "@lumiere/erp-session"
import { buildEntitySelection, resolveAiEntityType } from "@lumiere/query-hooks/ai-ui-context"
import {
  useErpAiSelectionReporter,
  useErpAiSelectionState,
} from "@lumiere/query-hooks/erp-ai-selection-context"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/tabs"
import { Button } from "../components/button"
import { DashboardGrid } from "./dashboard-grid"
import { DashboardHeader, type TimeRangeValue } from "./dashboard-header"
import { EntityView } from "../entity-views/entity-view"
import { EntityRecordSheet } from "../entity-views/entity-record-sheet"
import { FormModal } from "../forms/form-modal"
import type { ModuleConfig } from "../lib/module-types"
import type { EntityBoardRuntimeContext } from "../lib/module-types"
import { isEntitySurfaceVisible } from "../lib/entity-view-types"
import { getEntityRowKey } from "../lib/entity-row-utils"
import { useRBAC } from "../lib/rbac-context"
import { exportDashboardToPng } from "../lib/export-dashboard-png"

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
  /** Runtime kanban columns + move handlers keyed by entity tab id */
  entityBoardContext?: Record<string, EntityBoardRuntimeContext>
  /** Per-tab loading flags keyed by tab id — forwarded to EntityTable as skeleton rows. */
  dataLoading?: Record<string, boolean>
  /** Dashboard time range — shown in header only on the dashboard tab. */
  dashboardTimeRange?: TimeRangeValue
  onDashboardTimeRangeChange?: (value: TimeRangeValue) => void
  /** URL filters applied to the active entity tab (chart drill-down). */
  urlFilters?: Record<string, string>
}

export function ModuleView({
  config,
  data = {},
  onFormSubmit,
  onRowClick,
  activeTab: activeTabProp,
  onActiveTabChange,
  isPending,
  entityBoardContext,
  dataLoading,
  dashboardTimeRange,
  onDashboardTimeRangeChange,
  urlFilters,
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
  const [selectedRecord, setSelectedRecord] = useState<Record<string, unknown> | null>(null)
  const dashboardGridRef = useRef<HTMLDivElement>(null)

  const handleDashboardExport = useCallback(async () => {
    if (!dashboardGridRef.current) return
    await exportDashboardToPng(dashboardGridRef.current, `${config.title}-dashboard`)
  }, [config.title])

  useEffect(() => {
    if (prevActiveTabRef.current === activeTab) return
    prevActiveTabRef.current = activeTab
    aiReporter?.setActiveTab(activeTab)
    setSelectedRecord(null)
  }, [activeTab, aiReporter])

  const activeTabConfig = config.tabs.find((tab) => tab.id === activeTab)
  const showDashboardTimeRange =
    activeTabConfig?.type === "dashboard" && onDashboardTimeRangeChange != null
  const showDashboardExport = activeTabConfig?.type === "dashboard"

  return (
    <div className="flex flex-col min-h-full gap-2" data-testid={`module-view-${config.id}`}>
      <DashboardHeader
        title={config.title}
        description={config.description}
        timeRange={showDashboardTimeRange ? dashboardTimeRange : undefined}
        onTimeRangeChange={showDashboardTimeRange ? onDashboardTimeRangeChange : undefined}
        onExport={showDashboardExport ? () => void handleDashboardExport() : undefined}
      />

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
              <DashboardGrid ref={dashboardGridRef} sections={tab.sections} />
            )}

            {tab.type === "custom" && tab.customContent}

            {tab.type === "entity" && tab.entityConfig && (
              <div className="space-y-3">
                <div className="flex justify-end">
                  {tab.createForm &&
                    isEntitySurfaceVisible(
                      { permission: tab.createPermission },
                      checkPermission,
                    ) && (
                    <Button
                      size="lg"
                      onClick={() => setOpenForm(tab.id)}
                      data-testid={`module-create-${config.id}-${tab.id}`}
                    >
                      {tab.createLabel ?? "New"}
                    </Button>
                  )}
                </div>

                <EntityView
                  config={tab.entityConfig}
                  data={data[tab.id] ?? []}
                  isLoading={dataLoading?.[tab.id]}
                  initialFilters={activeTab === tab.id ? urlFilters : undefined}
                  boardColumns={entityBoardContext?.[tab.id]?.columns}
                  onBoardMove={entityBoardContext?.[tab.id]?.onMove}
                  boardFilterItem={entityBoardContext?.[tab.id]?.filterItem}
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
                          rowKey: getEntityRowKey(tab.entityConfig!),
                        }),
                      )
                    }
                    if (tab.recordSheet) {
                      setSelectedRecord(row)
                    }
                    onRowClick?.(tab.id, row)
                  }}
                />

                {tab.recordSheet && (
                  <EntityRecordSheet
                    open={selectedRecord != null}
                    onOpenChange={(open) => !open && setSelectedRecord(null)}
                    config={tab.recordSheet}
                    record={selectedRecord}
                  />
                )}

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
