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
import { Plus } from "lucide-react"
import { useClearModuleUrlFilter, useModuleUrlFilters } from "../lib/module-url-filters"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { DashboardGrid } from "./dashboard-grid"
import { DashboardHeader, type TimeRangeValue } from "./dashboard-header"
import { EntityView } from "../entity-views/entity-view"
import { EntityRecordSheet } from "../entity-views/entity-record-sheet"
import { FormModal } from "../forms/form-modal"
import { RuntimeFormModal } from "../forms/runtime-form-modal"
import { buildModuleTabRow, type ModuleConfig } from "../lib/module-types"
import type { EntityBoardRuntimeContext } from "../lib/module-types"
import { isEntitySurfaceVisible } from "../lib/entity-view-types"
import { getEntityRowKey } from "../lib/entity-row-utils"
import { withTabCreateCta } from "../lib/list-empty-state"
import { useRBAC } from "../lib/rbac-context"
import { exportDashboardToPng } from "../lib/export-dashboard-png"
import { KpiStrip } from "../components/kpi-strip"
import { filterRowsByKpi, activeKpiTile, toggleKpiKey, type KpiTileDef } from "../lib/kpi-tiles"

/** When set, tab create forms use STDB-merged {@link RuntimeFormModal} instead of static-only FormModal. */
export interface ModuleViewRuntimeForms {
  organizationId: number
  roleId?: string
  userId?: string
}

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
  /**
   * Filters applied to the active entity tab. Defaults to the URL's `?filter=key:value` entries,
   * so chart drill-downs and record links work in every module without per-client wiring.
   */
  urlFilters?: Record<string, string>
  /**
   * Prefer SpacetimeDB form configuration (labels, visibility, custom fields) for create modals.
   * Static `createForm` remains the reducer field-name scaffold.
   */
  runtimeForms?: ModuleViewRuntimeForms
  /**
   * Actionable KPI strip above an entity tab's list, keyed by tab id. Figures come from rows the
   * module already holds; selecting a tile narrows the list to the rows behind it.
   */
  kpiStrips?: Record<string, { tiles: KpiTileDef[]; loading?: boolean }>
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
  urlFilters: urlFiltersProp,
  runtimeForms,
  kpiStrips,
}: ModuleViewProps) {
  const routeFilters = useModuleUrlFilters()
  const clearRouteFilter = useClearModuleUrlFilter()
  const urlFilters = urlFiltersProp ?? routeFilters
  const { checkPermission } = useRBAC()
  const { companyIds } = useErpSession()
  const aiReporter = useErpAiSelectionReporter()
  const aiSelection = useErpAiSelectionState()
  const defaultCompanyId = companyIds?.[0]
  const useRuntimeCreate = runtimeForms != null && runtimeForms.organizationId > 0
  const defaultTab = config.defaultTab ?? config.tabs[0]?.id ?? ""
  // Uncontrolled modules keep the active tab in `?tab=` so every tab is linkable.
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const rawRouteTab = searchParams?.get("tab") ?? null
  const routeTab =
    rawRouteTab && config.tabs.some((tab) => tab.id === rawRouteTab) ? rawRouteTab : null
  const [internalTab, setInternalTab] = useState(routeTab ?? defaultTab)
  useEffect(() => {
    if (activeTabProp === undefined && routeTab) setInternalTab(routeTab)
  }, [activeTabProp, routeTab])
  const [isHydrated, setIsHydrated] = useState(false)
  const activeTab = activeTabProp ?? internalTab
  const prevActiveTabRef = useRef<string | null>(null)
  const setActiveTab = (v: string) => {
    onActiveTabChange?.(v)
    if (activeTabProp !== undefined) return
    setInternalTab(v)
    const params = new URLSearchParams(searchParams?.toString() ?? "")
    // Record filters belong to the tab they were opened on.
    params.delete("filter")
    if (v === defaultTab) params.delete("tab")
    else params.set("tab", v)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }
  const tabListRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Deep links can land on a tab far along the scrollable tab row.
    const trigger = tabListRef.current?.querySelector<HTMLElement>('[data-active], [aria-selected="true"]')
    trigger?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [activeTab])
  const [openForm, setOpenForm] = useState<string | null>(null)
  const [kpiSelection, setKpiSelection] = useState<Record<string, string | null>>({})
  const [selectedRecord, setSelectedRecord] = useState<Record<string, unknown> | null>(null)
  const dashboardGridRef = useRef<HTMLDivElement>(null)

  const handleDashboardExport = useCallback(async () => {
    if (!dashboardGridRef.current) return
    await exportDashboardToPng(dashboardGridRef.current, `${config.title}-dashboard`)
  }, [config.title])

  useEffect(() => {
    setIsHydrated(true)
  }, [])

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
    <div
      className="flex flex-col min-h-full gap-2"
      data-testid={`module-view-${config.id}`}
      data-hydrated={isHydrated ? "true" : "false"}
    >
      <DashboardHeader
        title={config.title}
        description={
          activeTabConfig?.description ??
          (activeTabConfig?.type === "dashboard" || activeTabConfig == null ? config.description : undefined)
        }
        timeRange={showDashboardTimeRange ? dashboardTimeRange : undefined}
        onTimeRangeChange={showDashboardTimeRange ? onDashboardTimeRangeChange : undefined}
        onExport={showDashboardExport ? () => void handleDashboardExport() : undefined}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className={"flex-col flex"}>
        <div
          ref={tabListRef}
          className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]"
          data-testid={`module-tabs-${config.id}`}
        >
        <TabsList
          variant="line"
          className="h-auto w-max min-w-full justify-start gap-1 border-b border-border p-0 group-data-horizontal/tabs:h-auto"
        >
          {buildModuleTabRow(config.tabs, config.tabGroups).map((item, i) =>
            item.kind === "group" ? (
              <span
                key={`group-${item.label}`}
                aria-hidden
                className="ml-3 mr-1 shrink-0 border-l border-border pl-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80"
              >
                {item.label}
              </span>
            ) : (
              <TabsTrigger
                tabIndex={i}
                key={item.tab.id}
                // Natural width with an underline on the active tab; the
                // default pseudo-underline is clipped by the scroll container.
                className="-mb-px flex-none rounded-none border-0 border-b-2 border-transparent px-2.5 pb-2.5 pt-1.5 after:hidden data-active:border-foreground data-active:text-foreground"
                value={item.tab.id}
                data-testid={`module-tab-${config.id}-${item.tab.id}`}
              >
                {item.tab.label}
              </TabsTrigger>
            ),
          )}
        </TabsList>
        </div>

        {config.tabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="mt-6">
            {tab.type === "dashboard" && tab.sections && (
              <DashboardGrid
                ref={dashboardGridRef}
                sections={tab.sections}
                // Dashboard figures derive from the module's collections.
                isLoading={Object.values(dataLoading ?? {}).some(Boolean)}
              />
            )}

            {tab.type === "custom" && tab.customContent}

            {tab.type === "entity" && tab.entityConfig && (
              <div className="space-y-3">
                {kpiStrips?.[tab.id] ? (
                  <KpiStrip
                    loading={kpiStrips[tab.id]!.loading}
                    tiles={kpiStrips[tab.id]!.tiles.map((kpi) => ({
                      key: kpi.key,
                      label: kpi.label,
                      value: kpi.value,
                      hint: kpi.hint,
                      tone: kpi.tone,
                      active: activeKpiTile(kpiStrips[tab.id]!.tiles, kpiSelection[tab.id] ?? null)?.key === kpi.key,
                      onSelect: kpi.matches
                        ? () =>
                            setKpiSelection((prev) => ({
                              ...prev,
                              [tab.id]: toggleKpiKey(prev[tab.id] ?? null, kpi.key),
                            }))
                        : undefined,
                    }))}
                  />
                ) : null}
                <EntityView
                  useCard={false}
                  headerAction={
                    tab.createForm &&
                    isEntitySurfaceVisible({ permission: tab.createPermission }, checkPermission) ? (
                      <Button
                        onClick={() => setOpenForm(tab.id)}
                        data-testid={`module-create-${config.id}-${tab.id}`}
                      >
                        <Plus className="h-4 w-4" />
                        {tab.createLabel ?? "New"}
                      </Button>
                    ) : undefined
                  }
                  config={
                    tab.createForm
                      ? {
                          ...tab.entityConfig,
                          view: withTabCreateCta(tab.entityConfig.view, {
                            label: tab.createLabel ?? "New",
                            onClick: () => setOpenForm(tab.id),
                            permission: tab.createPermission,
                          }),
                        }
                      : tab.entityConfig
                  }
                  externalFilter={
                    kpiStrips?.[tab.id]
                      ? {
                          active: activeKpiTile(kpiStrips[tab.id]!.tiles, kpiSelection[tab.id] ?? null) != null,
                          onClear: () => setKpiSelection((prev) => ({ ...prev, [tab.id]: null })),
                        }
                      : undefined
                  }
                  data={
                    kpiStrips?.[tab.id]
                      ? filterRowsByKpi(data[tab.id] ?? [], kpiStrips[tab.id]!.tiles, kpiSelection[tab.id] ?? null)
                      : (data[tab.id] ?? [])
                  }
                  isLoading={dataLoading?.[tab.id]}
                  initialFilters={activeTab === tab.id ? urlFilters : undefined}
                  onInitialFilterClear={clearRouteFilter}
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

                {tab.createForm &&
                  (useRuntimeCreate && runtimeForms ? (
                    <RuntimeFormModal
                      open={openForm === tab.id}
                      onOpenChange={(open) => !open && setOpenForm(null)}
                      staticConfig={tab.createForm}
                      moduleId={config.id}
                      formId={tab.createForm.id}
                      organizationId={runtimeForms.organizationId}
                      roleId={runtimeForms.roleId}
                      userId={runtimeForms.userId}
                      isPending={isPending}
                      preferStdbVisibility
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
                  ) : (
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
                  ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
