"use client"

import { ModuleDataNotice } from "./module-data-notice"
import { canUseModuleData, type ModuleDataState,
} from "../lib/module-data-state"

import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode,
} from "react"
import { useErpSession } from "@lumiere/erp-session"
import { buildEntitySelection, resolveAiEntityType,
} from "@lumiere/query-hooks/ai-ui-context"
import {
  useErpAiSelectionReporter,
  useErpAiSelectionState,
} from "@lumiere/query-hooks/erp-ai-selection-context"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/tabs"
import { Button } from "../components/button"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "../components/select"
import { Label } from "../components/label"
import { useTranslation } from "@lumiere/i18n"
import { LayoutGrid, Plus, Table as TableIcon } from "lucide-react"
import { useClearModuleUrlFilter, useModuleUrlFilters,
} from "../lib/module-url-filters"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { DashboardGrid } from "./dashboard-grid"
import { ModulePageComposition, PageCompositionActionTargetProvider, usePageCompositionActionSlot,
  type PageCompositionMountProps,
} from "./page-composition-host"
import { DashboardHeader, type TimeRangeValue } from "./dashboard-header"
import { EntityView } from "../entity-views/entity-view"
import { EntityRecordSheet } from "../entity-views/entity-record-sheet"
import { FormModal } from "../forms/form-modal"
import { RuntimeFormModal } from "../forms/runtime-form-modal"
import { buildModuleNavigationAreas, type ModuleConfig, type ModuleTab,
} from "../lib/module-types"
import type { EntityBoardRuntimeContext } from "../lib/module-types"
import type { EntityRow, EntitySurfacePermission,
} from "../lib/entity-view-types"
import type { FormConfig, FormValues } from "../lib/form-types"
import { getEntityRowKey } from "../lib/entity-row-utils"
import { decideCreateGate, withTabCreateCta } from "../lib/list-empty-state"
import { useRBAC } from "../lib/rbac-context"
import { exportDashboardToPng } from "../lib/export-dashboard-png"
import { KpiStrip } from "../components/kpi-strip"
import { filterRowsByKpi, activeKpiTile, toggleKpiKey, type KpiTileDef,
} from "../lib/kpi-tiles"
import { WorkspaceNav } from "./workspace-nav"
import { moduleTabHref, moduleWorkspaceNavigation,
} from "../lib/workspace-navigation"
import { HistoryPeriodSelect } from "../components/history-period-select"
import { parseHistoryPeriod, resolveHistoryPeriod, serializeHistoryPeriod,
} from "@lumiere/erp-shared/history-period"
import { configuredModuleHistoryField, filterModuleHistoryRows, removeModuleHistoryFilter, resolveModuleHistoryFilter,
} from "../lib/module-history-filter"
import { useAssistantNativeForms, type AssistantNativeFormStatus,
} from "../components/assistant-native-form-provider"
import { cn } from "../lib/utils"

/** When set, tab create forms use STDB-merged {@link RuntimeFormModal} instead of static-only FormModal. */
export interface ModuleViewRuntimeForms {
  organizationId: number
  roleId?: string
  userId?: string
}

interface ModuleViewProps {
  config: ModuleConfig
  /** Let a sibling workspace surface follow the module without a full-height gap. */
  fillHeight?: boolean
  /** Live data keyed by tab id — entity tabs receive data[tab.id] */
  data?: Record<string, Record<string, unknown>[]>
  /** Called when a create form is submitted: tabId, createAction, form values */
  onFormSubmit?: (
    tabId: string,
    action: string,
    data: Record<string, unknown>,
    onActivationSaved?: (recordId: string) => void,
  ) => void | Promise<void>
  /** Forwarded to tab create {@link FormModal} — e.g. parent mutation `isPending`. */
  isPending?: boolean
  /** Disable when the caller supplies domain-specific completion feedback. */
  showSubmitSuccessToast?: boolean
  /** Optional local authoring tool shared by table and dashboard creation paths. */
  renderCreatePreview?: (
    tabId: string,
    values: FormValues,
    config: FormConfig,
  ) => React.ReactNode
  /** Called when a table row is clicked: tabId, row record */
  /** Fallback record opener for tabs without a configured record sheet. */
  onRowClick?: (tabId: string, row: Record<string, unknown>) => void
  /** Controlled tab (use with `onActiveTabChange`, e.g. dashboard quick action → vendors tab) */
  activeTab?: string
  onActiveTabChange?: (tab: string) => void
  /** Opt in to retaining an open create form and its source workspace across tab changes. */
  onOpenFormChange?: (tab: string | null) => void
  /** Route existing gated create controls to a domain-owned instance of FormModal. */
  onOpenCreateForm?: (tabId: string, assistant?: { prompt?: string
      scopeKey: string
      activationRequestId?: string },
  ) => void | boolean
  /** Custom native editors (for example invoices) keep their existing domain owner. */
  assistantCreate?: {
    tabIds: readonly string[]
    blocked?: boolean
    open: (tabId: string, prompt?: string, scopeKey?: string,
    ) => AssistantNativeFormStatus | "loading"
  }
  /** Prevent a second assistant form from replacing a domain-owned editor. */
  assistantFormBlocked?: boolean
  /** Dismiss a domain-owned assistant editor when its actor/company scope changes. */
  onAssistantFormScopeChange?: () => void
  /** Runtime kanban columns + move handlers keyed by entity tab id */
  entityBoardContext?: Record<string, EntityBoardRuntimeContext>
  /** Per-tab loading flags keyed by tab id — forwarded to EntityTable as skeleton rows. */
  dataLoading?: Record<string, boolean>
  /** Explicit collection status. Failed or denied reads must not look like empty lists. */
  dataState?: Record<string, ModuleDataState>
  /** Dashboard time range — shown in header only on the dashboard tab. */
  dashboardTimeRange?: TimeRangeValue
  onDashboardTimeRangeChange?: (value: TimeRangeValue) => void
  /** Prefer an authoritative company zone when supplied; otherwise a drill link carries its zone. */
  historyTimeZone?: string
  /** Scoped overview composition owns its controls/exports; other module tabs are unchanged. */
  dashboardContent?: ReactNode
  /** Rich overview components register their own individually editable blocks. */
  dashboardCompositionOwned?: boolean
  /** Keep native dashboard work outside the personal widget layout. */
  dashboardComposition?: Pick<
    PageCompositionMountProps,
    "startingLayouts" | "fixedWidgetIds"
  > & { fixedContent: ReactNode }
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

/**
 * The open record sheet shows the row as the list has it now, so edits made from the sheet (and
 * refetches) show up without reopening it. Falls back to the clicked row.
 */
function liveSheetRecord(
  rows: EntityRow[] | undefined,
  selected: EntityRow | null,
  rowKey: string | undefined,
): EntityRow | null {
  if (!selected || !rows || !rowKey || selected[rowKey] == null) return selected
  const key = String(selected[rowKey])
  return (
    rows.find((row) => row[rowKey] != null && String(row[rowKey]) === key) ?? selected
  )
}

export function ModuleView({
  config,
  fillHeight = true,
  data = {},
  onFormSubmit,
  onRowClick,
  activeTab: activeTabProp,
  onActiveTabChange,
  onOpenFormChange,
  onOpenCreateForm,
  assistantCreate,
  assistantFormBlocked,
  onAssistantFormScopeChange,
  isPending,
  showSubmitSuccessToast,
  renderCreatePreview,
  entityBoardContext,
  dataLoading,
  dataState,
  dashboardTimeRange,
  onDashboardTimeRangeChange,
  historyTimeZone,
  dashboardContent,
  dashboardCompositionOwned = false,
  dashboardComposition,
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
    decideCreateGate(permission, (p) => checkPermission(p.resource, p.action).allowed, permissionsReady !== false,
    )
  const { companyIds, activeCompanyId, activeCompanyReady } = useErpSession()
  const aiReporter = useErpAiSelectionReporter()
  const aiSelection = useErpAiSelectionState()
  const defaultCompanyId = activeCompanyReady === false ? undefined : Number(activeCompanyId ?? companyIds?.[0]) || undefined
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
  const rawHistoryPeriod = searchParams?.get("period") ?? null
  const periodTimeZone = historyTimeZone ?? searchParams?.get("periodTimeZone") ?? "UTC"
  const activeEntityView = config.tabs.find((tab) => tab.id === activeTab)?.entityConfig?.view
  const historyColumns = activeEntityView?.mode === "table" ? activeEntityView.columns
    : activeEntityView?.mode === "table-or-board" ? activeEntityView.table.columns : []
  const historyField = configuredModuleHistoryField(config.id, activeTab, historyColumns,
  )
  const historyFieldKey = historyField?.dateField
  const historyFilter = useMemo(
    () => resolveModuleHistoryFilter(config.id, activeTab, rawHistoryPeriod, { timeZone: periodTimeZone, field: historyFieldKey ? { tabId: activeTab, dateField: historyFieldKey } : null,
      }),
    [config.id, activeTab, rawHistoryPeriod, periodTimeZone, historyFieldKey],
  )
  const activeRows = data[activeTab]
  const historyRows = useMemo(() => filterModuleHistoryRows(activeRows ?? [], historyFilter), [activeRows, historyFilter],
  )
  const entityRows = (tabId: string) => tabId === activeTab ? historyRows : (data[tabId] ?? [])
  const clearHistoryFilter = () => {
    const query = removeModuleHistoryFilter(searchParams?.toString() ?? "")
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }
  const navigationAreas = config.tabNavigation === "areas"
    ? buildModuleNavigationAreas(config.tabs, config.tabGroups, t("common.moduleNavigation.overview", { defaultValue: "Overview" }),
        ) : []
  const currentArea = navigationAreas.find((area) => area.tabIds.includes(activeTab)) ?? navigationAreas[0]
  const tabAreas = Object.fromEntries(navigationAreas.flatMap((area) => area.tabIds.map((tabId) => [tabId, area.id]),
    ),
  )
  const visibleTabs = currentArea ? config.tabs.filter((tab) => currentArea.tabIds.includes(tab.id)) : config.tabs
  const prevActiveTabRef = useRef<string | null>(null)
  const setActiveTab = (v: string) => {
    onActiveTabChange?.(v)
    if (activeTabProp !== undefined) return
    setInternalTab(v)
    const href = moduleTabHref(pathname, searchParams?.toString() ?? "", v, defaultTab,
    )
    router.push(href, { scroll: false })
  }
  // Tabs with an alternate view open on it; the table choice is remembered per tab.
  const [altViewChoice, setAltViewChoice] = useState<Readonly<Partial<Record<string, "alt" | "table">>>>({})
  useEffect(() => {
    const restored: Partial<Record<string, "alt" | "table">> = {}
    for (const tab of config.tabs) {
      if (!tab.entityAltView) continue
      try {
        const stored = window.localStorage.getItem(`lumiere:module-alt-view:${config.id}:${tab.id}`,
        )
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
      window.localStorage.setItem(`lumiere:module-alt-view:${config.id}:${tabId}`, choice,
      )
    } catch {
      /* not remembered */
    }
  }
  const showAltView = (tab: ModuleTab) =>
    tab.entityAltView != null &&
    altViewChoice[tab.id] !== "table" &&
    !(activeTab === tab.id && historyFilter.status !== "inactive") &&
    !(activeTab === tab.id && Object.keys(urlFilters ?? {}).length > 0)
  const tabListRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Deep links can land on a tab far along the scrollable tab row.
    const trigger = tabListRef.current?.querySelector<HTMLElement>('[data-active], [aria-selected="true"]',
    )
    trigger?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [activeTab])
  const workspaceNav = moduleWorkspaceNavigation(config, {
    overview: t("modules.workspaces.overview"), more: t("modules.workspaces.more"),
  })
  const [openForm, setOpenForm] = useState<string | null>(null)
  const [assistantFormPrompt, setAssistantFormPrompt] = useState<{ tabId: string
    text: string } | null>(null)
  const [assistantEditorScope, setAssistantEditorScope] = useState<string | null>(null)
  const assistantForms = useAssistantNativeForms()
  const [activationEditor, setActivationEditor] = useState<{ requestId: string
    tabId: string } | null>(null)
  const activationRecord = useRef<{ requestId: string
    recordId: string } | null>(null)
  const finishActivation = assistantForms?.finishActivation
  const abandonActivation = assistantForms?.abandonActivation
  const assistantScopeCurrent = !assistantEditorScope || assistantEditorScope === assistantForms?.scopeKey
  const openCreateForm = (tabId: string, prompt?: string, scopeKey?: string, activationRequestId?: string,
  ) => {
    if (onOpenCreateForm && !useRuntimeCreate) {
      const opened = scopeKey
        ? onOpenCreateForm(tabId, { prompt, scopeKey, ...(activationRequestId ? { activationRequestId } : {}),
          })
        : onOpenCreateForm(tabId)
      if (opened === false) return false
    } else setOpenForm(tabId)
    setAssistantFormPrompt(prompt ? { tabId, text: prompt } : null)
    setAssistantEditorScope(scopeKey ?? null)
    if (activationRequestId) setActivationEditor({ requestId: activationRequestId, tabId })
    return true
  }
  const closeCreateForm = () => {
    setOpenForm(null)
    setAssistantEditorScope(null)
    setAssistantFormPrompt(null)
    if (!activationEditor) return
    const { requestId } = activationEditor
    const saved = activationRecord.current
    finishActivation?.(requestId, saved?.requestId === requestId
      ? { status: "saved", recordId: saved.recordId }
      : { status: "cancelled" },
    )
    setActivationEditor(null)
    activationRecord.current = null
  }
  const submitCreateForm = async (tab: ModuleTab, formData: FormValues) => {
    const activation = activationEditor?.tabId === tab.id ? activationEditor : null
    const action = tab.createAction ?? tab.id
    if (!activation) {
      await onFormSubmit?.(tab.id, action, formData)
      return
    }
    await onFormSubmit?.(tab.id, action, formData, (recordId) => {
      activationRecord.current = { requestId: activation.requestId, recordId }
    })
  }
  useEffect(() => {
    if (activationEditor) return () => abandonActivation?.(activationEditor.requestId)
  }, [activationEditor, abandonActivation])
  useEffect(() => { onOpenFormChange?.(openForm) }, [openForm, onOpenFormChange])
  const [kpiSelection, setKpiSelection] = useState<Record<string, string | null>>({})
  const [selectedRecord, setSelectedRecord] = useState<Record<string, unknown> | null>(null)
  useEffect(() => { setSelectedRecord(null) }, [rawHistoryPeriod, periodTimeZone])
  const dashboardGridRef = useRef<HTMLDivElement>(null)

  const handleDashboardExport = useCallback(async () => {
    if (!dashboardGridRef.current) return
    await exportDashboardToPng(dashboardGridRef.current, `${config.title}-dashboard`,
    )
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
  const activationReadAllowed = (tab: ModuleTab | undefined) =>
    tab?.createPermission != null && checkPermission(tab.createPermission.resource, "read").allowed
  useEffect(() => {
    if (!activationEditor || !assistantScopeCurrent) return
    const tab = config.tabs.find((candidate) => candidate.id === activationEditor.tabId,
    )
    const denied = permissionsReady === false || createGate(tab?.createPermission) !== "allowed"
      || !activationReadAllowed(tab) || dataState?.[activationEditor.tabId]?.status === "denied"
    if (!denied && tabUsable(activationEditor.tabId)) return
    finishActivation?.(activationEditor.requestId, { status: denied ? "denied" : "unavailable",
    })
    setOpenForm(null)
    setActivationEditor(null)
    onAssistantFormScopeChange?.()
  })
  const { target: compositionActionTarget, slot: compositionActionSlot } = usePageCompositionActionSlot()
  const showHeaderCreate = activeTabConfig?.type === "entity" &&
    activeTabConfig.createForm &&
    activeTabConfig.entityConfig &&
    !showAltView(activeTabConfig) &&
    dataState?.[activeTab]?.status !== "error" &&
    dataState?.[activeTab]?.status !== "denied" &&
    createGate(activeTabConfig.createPermission) !== "denied"
  const dashboardHistoryBounds = useMemo(() => {
    if (rawHistoryPeriod != null && !parseHistoryPeriod(rawHistoryPeriod)) return null
    if (dashboardTimeRange === undefined) return undefined
    try {
      return resolveHistoryPeriod(dashboardTimeRange, { timeZone: periodTimeZone,
      })
    } catch {
      return null
    }
  }, [dashboardTimeRange, periodTimeZone, rawHistoryPeriod])
  useEffect(() => {
    if (!assistantEditorScope || assistantEditorScope === assistantForms?.scopeKey) return
    setOpenForm(null)
    setAssistantFormPrompt(null)
    setAssistantEditorScope(null)
    setActivationEditor(null)
    onAssistantFormScopeChange?.()
  }, [assistantEditorScope, assistantForms?.scopeKey, onAssistantFormScopeChange,
  ])
  // Consume a shell-owned, scope-bound presentation request through the very same
  // create controls as the user. Never submit, replace an editor, or invent a form.
  useEffect(() => {
    const request = assistantForms?.pending
    if (!request || request.moduleId !== config.id) return
    if (request.onActivationReturn && searchParams?.get("activationForm") !== request.requestId) return
    const settle = (status: AssistantNativeFormStatus) => assistantForms.settle(request.requestId, status)
    const tab = config.tabs.find((candidate) => candidate.id === request.tabId)
    if (request.onActivationReturn && permissionsReady !== false && !activationReadAllowed(tab)) { settle("denied")
      return }
    if (request.tabId !== activeTab) return
    if (!assistantForms.isCurrent(request.requestId)) { settle("unavailable")
      return }
    if (openForm || selectedRecord || assistantFormBlocked || assistantCreate?.blocked || isPending) { settle("busy")
      return }
    if (permissionsReady === false) return
    if (assistantCreate?.tabIds.includes(request.tabId)) {
      const status = assistantCreate.open(request.tabId, request.prompt, request.scopeKey,
      )
      if (status === "opened") setAssistantEditorScope(request.scopeKey)
      if (status !== "loading") settle(status)
      return
    }
    const state = dataState?.[request.tabId]
    if (state?.status === "loading" || dataLoading?.[request.tabId]) return
    if (state?.status === "denied") { settle("denied")
      return }
    if (!tab?.createForm || !tab.createPermission || !tabUsable(request.tabId) || (!onFormSubmit && !(!useRuntimeCreate && onOpenCreateForm))) { settle("unavailable")
      return }
    if (createGate(tab.createPermission) !== "allowed") { settle("denied")
      return }
    const opened = openCreateForm(tab.id, request.prompt, request.scopeKey, request.onActivationReturn ? request.requestId : undefined,
    )
    settle(opened ? "opened" : "unavailable")
  })
  const showDashboardTimeRange =
    dashboardContent == null && activeTabConfig?.type === "dashboard" && onDashboardTimeRangeChange != null
  const showDashboardExport = dashboardContent == null && activeTabConfig?.type === "dashboard" && activeTabUsable

  return (
    <div
      className={cn("flex min-w-0 flex-col gap-2", fillHeight && "min-h-full")}
      data-testid={`module-view-${config.id}`}
      data-hydrated={isHydrated ? "true" : "false"}
    >
      <DashboardHeader
        title={config.title}
        description={
          activeTabConfig?.description ??
          (activeTabConfig?.type === "dashboard" || activeTabConfig == null ? config.description : undefined)
        }
        primaryAction={showHeaderCreate ? (
          <Button onClick={() => openCreateForm(activeTab)} data-testid={`module-create-${config.id}-${activeTab}`}>
            <Plus className="h-4 w-4" />
            {activeTabConfig.createLabel ?? "New"}
          </Button>
        ) : activeTabUsable ? (
            activeTabConfig?.primaryAction
          ) : undefined}
        secondaryAction={compositionActionSlot}
        timeRange={showDashboardTimeRange ? dashboardTimeRange : undefined}
        onTimeRangeChange={showDashboardTimeRange ? onDashboardTimeRangeChange : undefined}
        timeZone={historyTimeZone}
        onExport={showDashboardExport ? () => void handleDashboardExport() : undefined}
      />

      <PageCompositionActionTargetProvider value={compositionActionTarget}>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-w-0 flex-col">
        {currentArea ? (
          <>
            <div className="flex flex-wrap items-center gap-3" data-testid={`module-navigation-${config.id}`}>
              <Label htmlFor={`module-area-${config.id}`}>
                {t("common.moduleNavigation.area", { defaultValue: "Task area",
                  })}
              </Label>
              <Select value={currentArea.id} onValueChange={(id) => {
                const area = navigationAreas.find((candidate) => candidate.id === id,
                    )
                if (area?.tabIds[0]) setActiveTab(area.tabIds[0])
              }}>
                <SelectTrigger id={`module-area-${config.id}`} data-testid={`module-area-${config.id}`} data-tab-areas={JSON.stringify(tabAreas)} className="w-full sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent><SelectGroup>
                  {navigationAreas.map((area) => (
                        <SelectItem key={area.id} value={area.id}>{area.label}</SelectItem>))}
                </SelectGroup></SelectContent>
              </Select>
            </div>
            {visibleTabs.length > 1 && (
              <div ref={tabListRef} className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]" data-testid={`module-tabs-${config.id}`}>
                <TabsList variant="line" className="h-auto w-max min-w-full justify-start gap-1 border-b border-border p-0 group-data-horizontal/tabs:h-auto">
                  {visibleTabs.map((tab) => (
                    <TabsTrigger
                      key={tab.id}
                      className="-mb-px flex-none rounded-none border-0 border-b-2 border-transparent px-2.5 pb-2.5 pt-1.5 after:hidden data-active:border-foreground data-active:text-foreground"
                      data-navigation-group={currentArea.id}
                      value={tab.id}
                      data-testid={`module-tab-${config.id}-${tab.id}`}
                    >
                      {tab.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            )}
          </>
        ) : (
          <WorkspaceNav
            moduleId={config.id}
            tabs={config.tabs}
            config={workspaceNav}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            hrefForTab={(tabId) => moduleTabHref(pathname, searchParams?.toString() ?? "", tabId, defaultTab,
                )}
          />
        )}

        {config.tabs.map((tab) => (
          <TabsContent
            key={tab.id}
            value={tab.id}
            keepMounted={onOpenFormChange != null && openForm === tab.id}
            className="mt-3 space-y-4"
            aria-label={tab.label}
            aria-busy={dataState?.[tab.id]?.status === "loading"}
            data-testid={`module-panel-${config.id}-${tab.id}`}
          >
            <ModuleDataNotice state={dataState?.[tab.id]} />
            {dataState?.[tab.id]?.status !== "error" && dataState?.[tab.id]?.status !== "denied" && (<>
            {tab.type === "dashboard" && dashboardCompositionOwned && dashboardContent}
            {tab.type === "dashboard" && !dashboardCompositionOwned && (
              <div
                        ref={
                          dashboardComposition ? dashboardGridRef : undefined
                        }
                        className={
                          dashboardComposition ? "space-y-4" : "contents"
                        }
                      >
                        {dashboardComposition?.fixedContent}
                        <ModulePageComposition
                moduleId={config.id}
                pageId={tab.id}
                title={`${config.title} · ${tab.label}`}
                sections={dashboardContent == null ? tab.sections : undefined}
                          startingLayouts={
                            dashboardComposition?.startingLayouts
                          }
                          fixedWidgetIds={dashboardComposition?.fixedWidgetIds}
                          historyBounds={showDashboardTimeRange ? dashboardHistoryBounds : undefined
                          }
                          historyTimeZone={periodTimeZone}
                isLoading={dataState?.[tab.id]?.status === "loading" || Object.values(dataLoading ?? {}).some(Boolean)}
              >
                {dashboardContent ?? (tab.sections && (
                              <DashboardGrid
                  ref={
                                  dashboardComposition
                                    ? undefined
                                    : dashboardGridRef}
                  sections={tab.sections}
                  isLoading={dataState?.[tab.id]?.status === "loading" || Object.values(dataLoading ?? {}).some(Boolean)}
                />))}
                        </ModulePageComposition>
                      </div>
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
                  ["table", tab.entityAltView.tableLabel, TableIcon,
                              ],
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
                      active: activeKpiTile(kpiStrips[tab.id]!.tiles, kpiSelection[tab.id] ?? null,
                                  )?.key === kpi.key,
                      onSelect: kpi.matches
                        ? () =>
                            setKpiSelection((prev) => ({
                              ...prev,
                              [tab.id]: toggleKpiKey(prev[tab.id] ?? null, kpi.key,
                                        ),
                            }))
                        : undefined,
                    }))}
                  />
                ) : null}
                {activeTab === tab.id && historyField && (
                  <div className="flex flex-wrap items-center gap-3">
                    <HistoryPeriodSelect
                      value={historyFilter.status === "active" ? historyFilter.period : "all"}
                      timeZone={historyFilter.status === "active" ? historyFilter.timeZone : "UTC"}
                      onChange={(period) => {
                        const params = new URLSearchParams(searchParams?.toString(),
                                  )
                        params.set("period", serializeHistoryPeriod(period),
                                  )
                        params.set("periodTimeZone", historyTimeZone ?? "UTC",
                                  )
                        router.replace(`${pathname}?${params.toString()}`, { scroll: false },
                                  )
                      }}
                    />
                    <span className="text-xs text-muted-foreground">{historyColumns.find((column) => column.key === historyField.dateField,
                                )?.label ?? historyField.dateField}</span>
                  </div>
                )}
                {activeTab === tab.id && historyFilter.status !== "inactive" && (
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                    role={historyFilter.status === "invalid" ? "alert" : "status"}
                    data-testid="module-history-filter"
                  >
                    <p>
                      {historyFilter.status === "invalid"
                        ? historyFilter.reason === "invalid-time-zone"
                          ? t("common.historyPeriod.invalidTimeZone", { defaultValue: "This link has an invalid time zone. Clear it to view the records.",
                                          },
                                        )
                          : t("common.historyPeriod.invalidLink", { defaultValue: "This link has an invalid date range. Clear it to view the records.",
                                        })
                        : historyFilter.period === "all"
                          ? t("common.historyPeriod.filteredAll", { defaultValue: "Table date range: all dated records ({{timeZone}}).", timeZone: historyFilter.timeZone,
                                        })
                          : t("common.historyPeriod.filteredRange", {
                              defaultValue: "Table date range: {{from}} through {{through}} ({{timeZone}}).",
                              from: historyFilter.dates.from, through: historyFilter.dates.through, timeZone: historyFilter.timeZone,
                            },
                                        )}
                    </p>
                    <Button type="button" variant="ghost" size="sm" onClick={clearHistoryFilter}>
                      {t("common.historyPeriod.clear", { defaultValue: "Clear date range",
                                  })}
                    </Button>
                  </div>
                )}
                <EntityView
                  useCard={false}
                  config={
                    tab.createForm
                      ? {
                          ...tab.entityConfig,
                          view: withTabCreateCta(tab.entityConfig.view, {
                            label: tab.createLabel ?? "New",
                            onClick: () => openCreateForm(tab.id),
                            // Not gated until permissions load, so the empty state never flashes read-only.
                            permission: createGate(tab.createPermission) === "loading" ? undefined : tab.createPermission,
                          },
                                    ),
                        }
                      : tab.entityConfig
                  }
                  externalFilter={
                    kpiStrips?.[tab.id]
                      ? {
                          active: activeKpiTile(kpiStrips[tab.id]!.tiles, kpiSelection[tab.id] ?? null,
                                      ) != null,
                          onClear: () => setKpiSelection((prev) => ({ ...prev, [tab.id]: null,
                                      })),
                        }
                      : undefined
                  }
                  data={
                    kpiStrips?.[tab.id]
                      ? filterRowsByKpi(entityRows(tab.id), kpiStrips[tab.id]!.tiles, kpiSelection[tab.id] ?? null,
                                  )
                      : entityRows(tab.id)
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
                    const entityType = resolveAiEntityType(tab.entityConfig!,
                              )
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
                    } else {
                      // A row has one record presentation owner. Opening the
                      // legacy dialog as well creates competing modal roots.
                      onRowClick?.(tab.id, row)
                    }
                  }}
                />

                {tab.recordSheet && (
                  <EntityRecordSheet
                    open={selectedRecord != null}
                    onOpenChange={(open) => !open && setSelectedRecord(null)}
                    config={tab.recordSheet}
                    record={liveSheetRecord(data[tab.id], selectedRecord, getEntityRowKey(tab.entityConfig!),
                              )}
                  />
                )}

                {tab.createForm &&
                  (useRuntimeCreate && runtimeForms ? (
                    <RuntimeFormModal
                      open={openForm === tab.id && assistantScopeCurrent && (!assistantEditorScope || createGate(tab.createPermission) === "allowed")}
                      draftKey={assistantEditorScope ? `${activationEditor ? "activation" : "assistant"}:${assistantEditorScope}` : tab.createDraftKey
                                }
                      onOpenChange={(open) => !open && closeCreateForm()}
                      staticConfig={tab.createForm}
                      renderPreview={renderCreatePreview
                        ? (values) => renderCreatePreview(tab.id, values, tab.createForm!,
                                        )
                        : undefined}
                      moduleId={config.id}
                      formId={tab.createForm.id}
                      organizationId={runtimeForms.organizationId}
                      roleId={runtimeForms.roleId}
                      userId={runtimeForms.userId}
                      isPending={isPending}
                      showSubmitSuccessToast={showSubmitSuccessToast}
                      preferStdbVisibility
          aiAssist={
                        defaultCompanyId && tab.entityConfig
                          ? {
                              companyId: defaultCompanyId,
                              formId: tab.createForm.id,
                              initialPrompt: assistantFormPrompt?.tabId === tab.id ? assistantFormPrompt.text : undefined,
                              entityType:
                                resolveAiEntityType(tab.entityConfig,
                                          ) ?? tab.entityConfig.id,
                            }
                          : undefined
                      }
                      onSubmit={(formData) => submitCreateForm(tab, formData)}
                    />
                  ) : (
                    <FormModal
                      open={openForm === tab.id && assistantScopeCurrent && (!assistantEditorScope || createGate(tab.createPermission) === "allowed")}
                      draftKey={assistantEditorScope ? `${activationEditor ? "activation" : "assistant"}:${assistantEditorScope}` : tab.createDraftKey
                                }
                      onOpenChange={(open) => !open && closeCreateForm()}
                      config={tab.createForm}
                      renderPreview={renderCreatePreview
                        ? (values) => renderCreatePreview(tab.id, values, tab.createForm!,
                                        )
                        : undefined}
                      isPending={isPending}
                      showSubmitSuccessToast={showSubmitSuccessToast}
                      aiAssist={
                        defaultCompanyId && tab.entityConfig
                          ? {
                              companyId: defaultCompanyId,
                              formId: tab.createForm.id,
                              initialPrompt: assistantFormPrompt?.tabId === tab.id ? assistantFormPrompt.text : undefined,
                              entityType:
                                resolveAiEntityType(tab.entityConfig,
                                          ) ?? tab.entityConfig.id,
                            }
                          : undefined
                      }
                      onSubmit={(formData) => submitCreateForm(tab, formData)}
                    />
                  ))}
              </div>
            )}
            {tab.type !== "dashboard" && activeTab === tab.id && (
              <ModulePageComposition
                moduleId={config.id}
                pageId={tab.id}
                title={`${config.title} · ${tab.label}`}
                placement="insights"
                sections={tab.insightSections}
                historyBounds={historyFilter.status === "active" ? historyFilter.bounds : historyFilter.status === "invalid" ? null : undefined}
                        historyTimeZone={periodTimeZone}
              />
            )}
            </>)}
          </TabsContent>
        ))}
      </Tabs>
      </PageCompositionActionTargetProvider>
    </div>
  )
}
