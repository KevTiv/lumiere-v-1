import type { ComponentType, ReactNode } from "react"
import type { Action, PermissionCheckResult, Resource } from "./rbac-types"

export type FieldWidth = "full" | "1/2" | "1/3" | "2/3" | "1/4"

/** Optional RBAC gate for entity UI surfaces (columns, fields, actions). */
export interface EntitySurfacePermission {
  resource: Resource
  action: Action
}

export type EntityPermissioned = {
  permission?: EntitySurfacePermission
}

export type EntityPermissionChecker = (
  resource: Resource,
  action: Action,
) => PermissionCheckResult

/** Items without `permission` are always visible (backwards compatible). */
export function isEntitySurfaceVisible<T extends EntityPermissioned>(
  item: T,
  checkPermission: EntityPermissionChecker,
): boolean {
  if (!item.permission) return true
  return checkPermission(item.permission.resource, item.permission.action).allowed
}

/** Filter a list of permissioned entity UI items; undefined input → empty array. */
export function filterEntitySurface<T extends EntityPermissioned>(
  items: T[] | undefined,
  checkPermission: EntityPermissionChecker,
): T[] {
  if (!items) return []
  return items.filter((item) => isEntitySurfaceVisible(item, checkPermission))
}

export type ColumnType =
  | "text"
  | "number"
  | "currency"
  | "date"
  | "datetime"
  | "badge"
  | "boolean"
  | "percent"
  | "custom"

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline"

// ─── Column (table view) ────────────────────────────────────────────────────

export interface EntityColumn extends EntityPermissioned {
  key: string
  label: string
  type?: ColumnType
  align?: "left" | "center" | "right"
  /** Tailwind min-width class e.g. "min-w-32" */
  width?: string
  sortable?: boolean
  /** Map raw value → badge variant key (semantic names resolved in the table renderer) */
  badgeVariants?: Record<string, string>
  /** Map raw value → display label for type="badge" */
  badgeLabels?: Record<string, string>
  /** Override rendering entirely */
  render?: (value: unknown, row: Record<string, unknown>) => ReactNode
}

// ─── Filter ─────────────────────────────────────────────────────────────────

export interface EntityFilter {
  key: string
  label: string
  type: "select" | "text"
  options?: Array<{ value: string; label: string }>
  placeholder?: string
}

// ─── Action ─────────────────────────────────────────────────────────────────

export interface EntityAction extends EntityPermissioned {
  id: string
  label: string
  icon?: ComponentType<{ className?: string }>
  variant?: "default" | "outline" | "ghost" | "destructive"
  /** If true, button is disabled when no rows are selected */
  requiresSelection?: boolean
  onClick: (selectedRows: Record<string, unknown>[]) => void
}

// ─── Table view config ───────────────────────────────────────────────────────

export interface EntityTableConfig {
  mode: "table"
  columns: EntityColumn[]
  /** Key used for row identity (for selection) */
  rowKey?: string
  /** When set, filter UI state is persisted in localStorage under this key. */
  listViewKey?: string
  searchable?: boolean
  searchPlaceholder?: string
  searchKeys?: string[]
  filters?: EntityFilter[]
  actions?: EntityAction[]
  /**
   * When true, clicking a row toggles selection (for bulk actions).
   * Defaults to true only if an action has `requiresSelection: true`.
   * Set false when toolbar actions (e.g. import) should not hijack row clicks.
   */
  rowSelectionToggleOnClick?: boolean
  emptyMessage?: string
}

// ─── Detail field (read-only display) ───────────────────────────────────────

export interface EntityDetailField extends EntityPermissioned {
  key: string
  label: string
  type?: ColumnType
  width?: FieldWidth
  badgeVariants?: Record<string, string>
  badgeLabels?: Record<string, string>
  render?: (value: unknown, record: Record<string, unknown>) => ReactNode
}

export interface EntityDetailSection {
  id: string
  title?: string
  description?: string
  fields: EntityDetailField[]
}

export interface EntityDetailConfig {
  mode: "detail"
  sections: EntityDetailSection[]
}

// ─── Board view config ───────────────────────────────────────────────────────

export interface EntityBoardCardConfig {
  titleKey: string
  fields?: EntityColumn[]
  footerFields?: EntityColumn[]
  render?: (row: Record<string, unknown>) => ReactNode
}

export interface EntityBoardConfig {
  mode: "board"
  groupKey: string
  rowKey?: string
  card: EntityBoardCardConfig
  emptyColumnMessage?: string
}

// ─── Table + board hybrid ────────────────────────────────────────────────────

export interface EntityTableBoardViewConfig {
  mode: "table-or-board"
  table: EntityTableConfig
  board: Omit<EntityBoardConfig, "mode">
  /** Labels for the table/kanban view toggle */
  viewToggleLabels?: {
    table: string
    board: string
    ariaLabel?: string
  }
  /** Default surface when the tab opens */
  defaultView?: "table" | "board"
}

// ─── Top-level config ────────────────────────────────────────────────────────

export interface EntityViewConfig {
  id: string
  /** Canonical SpacetimeDB entity_type for AI context / live snapshots (snake_case). */
  entityType?: string
  title: string
  description?: string
  view: EntityTableConfig | EntityDetailConfig | EntityBoardConfig | EntityTableBoardViewConfig
}
