import type { ComponentType, ReactNode } from "react"
import type { Action, PermissionCheckResult, Resource } from "./rbac-types"

export type FieldWidth = "full" | "1/2" | "1/3" | "2/3" | "1/4"

/** Canonical structural row accepted by generic entity surfaces. */
export interface EntityRow {
  [field: string]: unknown
}

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
  | "relative-date"
  | "badge"
  | "status"
  | "avatar"
  | "progress"
  | "boolean"
  | "percent"
  | "custom"

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info"

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
  render?: (value: unknown, row: EntityRow) => ReactNode
  /** Makes the cell editable in place (double-click). The caller owns the write. */
  inlineEdit?: EntityInlineEdit
}

export interface EntityInlineEdit {
  kind: "text" | "number" | "select"
  /** Choices for `kind: "select"`. */
  options?: Array<{ value: string; label: string }>
  /** Rows the cell may be edited on (e.g. only drafts). Defaults to every row. */
  canEdit?: (row: EntityRow) => boolean
  /** Persists the new value; a rejection puts the old value back and shows the error. */
  save: (row: EntityRow, value: string | number) => Promise<unknown>
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
  /**
   * Presentation-only state gate: when rows are selected and this returns false the button is
   * disabled. Never a permission check — the server re-validates every command.
   */
  isApplicable?: (selectedRows: EntityRow[]) => boolean
  /**
   * Which selections the action accepts, for actions with `requiresSelection`. "single" (the
   * default) is disabled while more than one row is selected, so an action that only reads the
   * first row never silently ignores the rest; "multiple" receives every selected row.
   */
  selection?: "single" | "multiple"
  /** Ask before running: the table shows this dialog and only calls `onClick` on confirm. */
  confirm?: EntityActionConfirmation
  /** Toast shown when `onClick` completes without throwing. */
  successMessage?: string
  /**
   * Return the promise of the work: the table keeps the button pending until it settles and
   * reports a rejection as an error toast. Actions that handle their own errors may swallow them.
   */
  onClick: (selectedRows: EntityRow[]) => void | Promise<unknown>
}

export interface EntityActionConfirmation {
  title: string
  /** Text, or a function of the selected rows for wording that depends on the selection. */
  description: string | ((selectedRows: EntityRow[]) => string)
  confirmLabel: string
  cancelLabel: string
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
  emptyState?: {
    title?: string
    description?: string
    actionLabel?: string
    onAction?: () => void
    icon?: ReactNode
  }
}

// ─── Detail field (read-only display) ───────────────────────────────────────

export interface EntityDetailField extends EntityPermissioned {
  key: string
  label: string
  type?: ColumnType
  width?: FieldWidth
  badgeVariants?: Record<string, string>
  badgeLabels?: Record<string, string>
  render?: (value: unknown, record: EntityRow) => ReactNode
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
  /** Display title when the raw `titleKey` value is not what the table shows (e.g. a formatted name). */
  title?: (row: EntityRow) => string
  fields?: EntityColumn[]
  footerFields?: EntityColumn[]
  render?: (row: EntityRow) => ReactNode
}

export interface EntityBoardConfig {
  mode: "board"
  groupKey: string
  rowKey?: string
  card: EntityBoardCardConfig
  emptyColumnMessage?: string
  /** Title of the read-only board's catch-all column for rows whose state has no column. */
  otherColumnLabel?: string
  /** Placeholder of the read-only board's search box. */
  searchPlaceholder?: string
}

// ─── Pivot view config ───────────────────────────────────────────────────────

export interface EntityPivotConfig {
  /** Keys to group by: filter keys with options, or columns with badge labels. */
  groupKeys: string[]
  /** Numeric column keys that are summed per group (the first one is graphed). */
  measureKeys: string[]
  /** Row field holding the row's currency; when present and mixed, a note is shown. */
  currencyKey?: string
  labels: {
    groupBy: string
    columnsBy: string
    none: string
    count: string
    total: string
    empty: string
    noData: string
    /** Receives the currencies found on the rows. */
    mixedCurrencies: (currencies: string[]) => string
    chartTitle: (measure: string) => string
  }
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
    /** Only needed when `pivot` is set. */
    pivot?: string
    ariaLabel?: string
  }
  /** Offers a third, summary (pivot) view in the toggle. */
  pivot?: EntityPivotConfig
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

/** Extract the table portion of an entity view for list runtime config merging. */
export function entityTableConfigFromView(
  view: EntityViewConfig["view"],
): EntityTableConfig {
  if (view.mode === "table") return view
  if (view.mode === "table-or-board") return view.table
  throw new Error(`Expected table or table-or-board view, got ${view.mode}`)
}
