import type { ReactNode } from "react"
import type { DashboardSection } from "./dashboard-types"
import type { EntityDetailConfig, EntitySurfacePermission, EntityViewConfig, BadgeVariant } from "./entity-view-types"
import type { FormConfig } from "./form-types"
import type { KanbanColumnDef, KanbanMoveHandler } from "./kanban-board-types"

export interface EntityRecordSheetTab {
  id: string
  label: string
  content: (record: Record<string, unknown>) => ReactNode
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
  /** Additional tabs rendered as ReactNode slots */
  customTabs?: EntityRecordSheetTab[]
  /** Optional action buttons rendered in the header area */
  actions?: ReactNode
  /** SpacetimeDB snake_case table name for the Audit tab filter */
  auditTableName?: string
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
}

export interface ModuleConfig {
  id: string
  title: string
  description?: string
  defaultTab?: string
  tabs: ModuleTab[]
}
