"use client"

import { ModuleDataNotice } from "./module-data-notice"
import { canUseModuleData, type ModuleDataState } from "../lib/module-data-state"

import { useEffect, useRef, useState, useCallback, type ReactNode } from "react"
import { useErpSession } from "@lumiere/erp-session"
import { useTranslation } from "@lumiere/i18n"
import { buildEntitySelection, resolveAiEntityType } from "@lumiere/query-hooks/ai-ui-context"
import {
  useErpAiSelectionReporter,
  useErpAiSelectionState,
} from "@lumiere/query-hooks/erp-ai-selection-context"
import { Tabs, TabsContent } from "../components/tabs"
import { Button } from "../components/button"
import { LayoutGrid, Plus, Table as TableIcon } from "lucide-react"
import { useClearModuleUrlFilter, useModuleUrlFilters } from "../lib/module-url-filters"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { DashboardGrid } from "./dashboard-grid"
import { DashboardHeader, type TimeRangeValue } from "./dashboard-header"
import { EntityView } from "../entity-views/entity-view"
import { EntityRecordSheet } from "../entity-views/entity-record-sheet"
import { FormModal } from "../forms/form-modal"
import { RuntimeFormModal } from "../forms/runtime-form-modal"
import { type ModuleConfig, type ModuleTab } from "../lib/module-types"
import type { EntityBoardRuntimeContext } from "../lib/module-types"
import type { EntitySurfacePermission } from "../lib/entity-view-types"
import { getEntityRowKey } from "../lib/entity-row-utils"
import { decideCreateGate, withTabCreateCta } from "../lib/list-empty-state"
import { useRBAC } from "../lib/rbac-context"
import { exportDashboardToPng } from "../lib/export-dashboard-png"
import { KpiStrip } from "../components/kpi-strip"
import { filterRowsByKpi, activeKpiTile, toggleKpiKey, type KpiTileDef } from "../lib/kpi-tiles"
import { WorkspaceNav } from "./workspace-nav"
import { moduleTabHref, moduleWorkspaceNavigation } from "../lib/workspace-navigation"

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
  /** Opt in to retaining an open create form and its source workspace across tab changes. */
  onOpenFormChange?: (tab: string | null) => void
  /** Runtime kanban columns + move handlers keyed by entity tab id */
  entityBoardContext?: Record<string, EntityBoardRuntimeContext>
  /** Per-tab loading flags keyed by tab id — forwarded to EntityTable as skeleton rows. */
  dataLoading?: Record<string, boolean>
  /** Explicit collection status. Failed or denied reads must not look like empty lists. */
  dataState?: Record<string, ModuleDataState>
  /** Dashboard time range — shown in header only on the dashboard tab. */
  dashboardTimeRange?: TimeRangeValue
  onDashboardTimeRangeChange?: (value: TimeRangeValue) => void
  /** Scoped overview composition owns its controls/exports; other module tabs are unchanged. */
  dashboardContent?: ReactNode
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
  onOpenFormChange,
  isPending,
  entityBoardContext,
  dataLoading,
  dataState,
  dashboardTimeRange,
  onDashboardTimeRangeChange,
  dashboardContent,
  urlFilters: urlFiltersProp,
  runtimeForms,
  kpiStrips,
}: ModuleViewProps) {
  const { t } = useTranslation()
  const routeFilters = useModuleUrlFilters()
  const clearRouteFilter = useClearModuleUrlFilter()
  const urlFilters = urlFiltersProp ?? routeFilters
  const { checkPermission, permissionsReady } = useRBAC()
  const createGate = (permission: EntitySurfacePermission | undefined) =>
    decideCreateGate(permission, (p) => checkPermission(p.resource, p.action).allowed, permissionsReady !== false)
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
    if (activeTabProp === undefined) setInternalTab(routeTab ?? defaultTab)
  }, [activeTabProp, routeTab, defaultTab])
  const [isHydrated, setIsHydrated] = useState(false)
  const activeTab = activeTabProp ?? internalTab
  const prevActiveTabRef = useRef<string | null>(null)
  const setActiveTab = (v: string) => {
    onActiveTabChange?.(v)
    if (activeTabProp !== undefined) return
    setInternalTab(v)
    const href = moduleTabHref(pathname, searchParams?.toString() ?? "", v, defaultTab)
    router.push(href, { scroll: false })
  }
  // Tabs with an alternate view open on it; the table choice is remembered per tab.
  const [altViewChoice, setAltViewChoice] = useState<Readonly<Partial<Record<string, "alt" | "table">>>>({})
  useEffect(() => {
    const restored: Partial<Record<string, "alt" | "table">> = {}
    for (const tab of config.tabs) {
      if (!tab.entityAltView) continue
      try {
        const stored = window.localStorage.getItem(`lumiere:module-alt-view:${config.id}:${tab.id}`)
        if (stored === "alt" || stored === "table") restored[tab.id] = stored
      } catch {
        /* storage unavailable */
      }
    }
    setAltViewChoice(restored)
  }, [config.id]) // tabs are read once per module
  const chooseAltView = (tabId: string, choice: "alt" | "table") => {
    setAltViewChoice((prev) => ({ ...prev, [tabId]: choice }))
    try {
      window.localStorage.setItem(`lumiere:module-alt-view:${config.id}:${tabId}`, choice)
    } catch {
      /* not remembered */
    }
  }
  const showAltView = (tab: ModuleTab) =>
    tab.entityAltView != null &&
    altViewChoice[tab.id] !== "table" &&
    !(activeTab === tab.id && Object.keys(urlFilters ?? {}).length > 0)
  const tabListRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Deep links can land on a tab far along the scrollable tab row.
    const trigger = tabListRef.current?.querySelector<HTMLElement>('[data-active], [aria-selected="true"]')
    trigger?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [activeTab])
  const workspaceNav = moduleWorkspaceNavigation(config, {
    overview: t("modules.workspaces.overview"), more: t("modules.workspaces.more"),
  })
  const [openForm, setOpenForm] = useState<string | null>(null)
  useEffect(() => { onOpenFormChange?.(openForm) }, [openForm, onOpenFormChange])
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

  // A create form or record sheet must not outlive the collection it was opened from.
  const tabUsable = (tabId: string | null) => {
    const state = tabId == null ? undefined : dataState?.[tabId]
    return state == null || canUseModuleData(state)
  }
  const openFormUsable = tabUsable(openForm)
  const activeTabUsable = tabUsable(activeTab)
  useEffect(() => {
    if (!openFormUsable) setOpenForm(null)
  }, [openFormUsable])
  useEffect(() => {
    if (!activeTabUsable) setSelectedRecord(null)
  }, [activeTabUsable])

  const activeTabConfig = config.tabs.find((tab) => tab.id === activeTab)
  const showDashboardTimeRange =
    dashboardContent == null && activeTabConfig?.type === "dashboard" && onDashboardTimeRangeChange != null
  const showDashboardExport = dashboardContent == null && activeTabConfig?.type === "dashboard" && activeTabUsable

  return (
    <div
      className="flex min-h-full min-w-0 flex-col gap-2"
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-w-0 flex-col">
        <WorkspaceNav
          moduleId={config.id}
          tabs={config.tabs}
          config={workspaceNav}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          hrefForTab={(tabId) => moduleTabHref(pathname, searchParams?.toString() ?? "", tabId, defaultTab)}
        />

        {config.tabs.map((tab) => (
          <TabsContent
            key={tab.id}
            value={tab.id}
            keepMounted={onOpenFormChange != null && openForm === tab.id}
            className="mt-6"
            aria-busy={dataState?.[tab.id]?.status === "loading"}
            data-testid={`module-panel-${config.id}-${tab.id}`}
          >
            <ModuleDataNotice state={dataState?.[tab.id]} />
            {dataState?.[tab.id]?.status !== "error" && dataState?.[tab.id]?.status !== "denied" && (<>
            {tab.type === "dashboard" && dashboardContent != null && dashboardContent}
            {tab.type === "dashboard" && dashboardContent == null && tab.sections && (
              <DashboardGrid
                ref={dashboardGridRef}
                sections={tab.sections}
                // Dashboard figures derive from the module's collections.
                isLoading={dataState?.[tab.id]?.status === "loading" || Object.values(dataLoading ?? {}).some(Boolean)}
              />
            )}

            {tab.type === "custom" && tab.customContent}

            {tab.type === "entity" && tab.entityConfig && tab.entityAltView && (
              <div
                className="flex w-fit items-center rounded-lg border border-border p-1"
                role="group"
                aria-label={`${tab.entityAltView.label} / ${tab.entityAltView.tableLabel}`}
              >
                {([
                  ["alt", tab.entityAltView.label, LayoutGrid],
                  ["table", tab.entityAltView.tableLabel, TableIcon],
                ] as const).map(([choice, label, Icon]) => {
                  const pressed = (showAltView(tab) ? "alt" : "table") === choice
                  return (
                    <Button
                      key={choice}
                      variant={pressed ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 gap-1.5 px-2"
                      aria-pressed={pressed}
                      onClick={() => chooseAltView(tab.id, choice)}
                      data-testid={`module-view-${choice}-${tab.id}`}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </Button>
                  )
                })}
              </div>
            )}

            {tab.type === "entity" && tab.entityConfig && showAltView(tab) && tab.entityAltView?.content}

            {tab.type === "entity" && tab.entityConfig && !showAltView(tab) && (
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
                    tab.createForm && createGate(tab.createPermission) !== "denied" ? (
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
                            // Not gated until permissions load, so the empty state never flashes read-only.
                            permission: createGate(tab.createPermission) === "loading" ? undefined : tab.createPermission,
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
                  isLoading={dataState?.[tab.id]?.status === "loading" || dataLoading?.[tab.id]}
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
            </>)}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
