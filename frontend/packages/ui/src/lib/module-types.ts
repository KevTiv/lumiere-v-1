import type { ReactNode } from "react"
import type { DashboardSection } from "./dashboard-types"
import type {
  EntityDetailConfig,
  EntitySurfacePermission,
  EntityViewConfig,
  EntityRow,
  BadgeVariant,
} from "./entity-view-types"
import type { FormConfig } from "./form-types"
import type { KanbanColumnDef, KanbanMoveHandler } from "./kanban-board-types"

export interface EntityRecordSheetTab {
  id: string
  label: string
  content: (record: Record<string, unknown>) => ReactNode
}

export interface EntityRecordSheetDiscussion {
  /** Record model the notes are filed under; defaults to `auditTableName`. */
  resModel?: string
  /** Attachments for the record, shown under the notes (the web app supplies its document panel). */
  attachments?: (record: Record<string, unknown>) => ReactNode
}

export interface EntityRecordSheetConfig {
  /** Record field key used for the sheet title */
  titleKey: string
  /** Record field key for an optional status badge in the header */
  statusKey?: string
  /** Map raw status value → badge variant */
  statusBadgeVariants?: Record<string, BadgeVariant>
  /** Map raw status value → display label */
  statusBadgeLabels?: Record<string, string>
  /** Overview tab field layout */
  detailConfig: EntityDetailConfig
  /** Optional contextual review content; the original detail config remains available. */
  overviewContent?: (record: EntityRow) => ReactNode
  wide?: boolean
  /** Additional tabs rendered as ReactNode slots */
  customTabs?: EntityRecordSheetTab[]
  /** Optional action buttons rendered in the header area */
  actions?: ReactNode
  /** SpacetimeDB snake_case table name for the Audit tab filter */
  auditTableName?: string
  /** Adds a Discussion tab with the record's notes, followers and attachments. */
  discussion?: EntityRecordSheetDiscussion
  /** Where the record has a page of its own: the sheet then offers an "Open" link to it. */
  openHref?: (record: Record<string, unknown>) => string | undefined
}

export interface EntityBoardRuntimeContext {
  columns: KanbanColumnDef[]
  onMove: KanbanMoveHandler
  filterItem?: (row: Record<string, unknown>) => boolean
}

export interface ModuleTab {
  id: string
  label: string
  type: "dashboard" | "entity" | "custom"
  /** Subtitle shown in the page header while this tab is active. */
  description?: string
  /** For type='dashboard': sections rendered by DashboardGrid */
  sections?: DashboardSection[]
  /** For type='entity': EntityView config */
  entityConfig?: EntityViewConfig
  /** Optional 'New X' button that opens a FormModal */
  createForm?: FormConfig
  /** Label for the create button, e.g. 'New Invoice' */
  createLabel?: string
  /** When set, create button is hidden unless checkPermission(resource, action) allows */
  createPermission?: EntitySurfacePermission
  /** Identifier passed to onFormSubmit so callers know which mutation to invoke */
  createAction?: string
  /** Optional right-side record sheet opened on row click */
  recordSheet?: EntityRecordSheetConfig
  /** For type='custom': arbitrary content rendered inside the tab panel */
  customContent?: ReactNode
  /**
   * For type='entity': another presentation of the tab's records (e.g. a file browser), shown
   * by default with a toggle back to the table. Route filters always open the table.
   */
  entityAltView?: ModuleTabAltView
}

export interface ModuleTabAltView {
  /** Toggle label of the alternate view. */
  label: string
  /** Toggle label of the table. */
  tableLabel: string
  content: ReactNode
}

export interface ModuleConfig {
  id: string
  title: string
  description?: string
  defaultTab?: string
  tabs: ModuleTab[]
  /**
   * Optional workspace groups used by the shared navigation fallback. Tabs not
   * listed remain individual workspaces; large sets move into the overflow menu.
   */
  tabGroups?: ModuleTabGroup[]
  /** Show one task area at a time, preserving canonical links to every tab. */
  tabNavigation?: "areas"
  /** Curated job-oriented groups for modules using WorkspaceNav. */
  workspaceNav?: ModuleWorkspaceNav
}

export interface ModuleWorkspace {
  id: string
  label: string
  /** The first available tab is the workspace's landing destination. */
  tabIds: readonly string[]
}

export interface ModuleWorkspaceNav {
  label?: string
  workspaces: readonly ModuleWorkspace[]
  overflow?: readonly ModuleWorkspace[]
  overflowLabel?: string
}

export interface ModuleTabGroup {
  label: string
  tabIds: readonly string[]
}

export type ModuleTabRowItem = { kind: "group"; label: string } | { kind: "tab"; tab: ModuleTab }

/** Tab row in display order, with a group label before each group's tabs. */
export function buildModuleTabRow(
  tabs: readonly ModuleTab[],
  groups: readonly ModuleTabGroup[] | undefined,
): ModuleTabRowItem[] {
  if (!groups?.length) return tabs.map((tab) => ({ kind: "tab", tab }))
  const groupOf = new Map<string, number>()
  groups.forEach((group, index) => group.tabIds.forEach((id) => groupOf.set(id, index)))
  const firstGrouped = tabs.findIndex((tab) => groupOf.has(tab.id))
  const leading = tabs.filter(
    (tab, index) => !groupOf.has(tab.id) && (firstGrouped < 0 || index < firstGrouped),
  )
  const trailing = tabs.filter(
    (tab, index) => !groupOf.has(tab.id) && firstGrouped >= 0 && index > firstGrouped,
  )
  const row: ModuleTabRowItem[] = leading.map((tab) => ({ kind: "tab", tab }))
  groups.forEach((group, index) => {
    const members = tabs.filter((tab) => groupOf.get(tab.id) === index)
    if (members.length === 0) return
    row.push({ kind: "group", label: group.label })
    members.forEach((tab) => row.push({ kind: "tab", tab }))
  })
  trailing.forEach((tab) => row.push({ kind: "tab", tab }))
  return row
}

export interface ModuleNavigationArea {
  id: string
  label: string
  tabIds: string[]
}

/** Areas only organize existing tabs. They do not grant access or create destinations. */
export function buildModuleNavigationAreas(
  tabs: readonly ModuleTab[],
  groups: readonly ModuleTabGroup[] | undefined,
  overviewLabel: string,
): ModuleNavigationArea[] {
  const assigned = new Set<string>()
  const areas: ModuleNavigationArea[] = []
  for (const group of groups ?? []) {
    const members = tabs
      .filter((tab) => group.tabIds.includes(tab.id) && !assigned.has(tab.id))
      .map((tab) => tab.id)
    if (!members.length) continue
    members.forEach((id) => assigned.add(id))
    areas.push({ id: members[0]!, label: group.label, tabIds: members })
  }
  const remaining = tabs.filter((tab) => !assigned.has(tab.id)).map((tab) => tab.id)
  return remaining.length
    ? [{ id: remaining[0]!, label: overviewLabel, tabIds: remaining }, ...areas]
    : areas
}
