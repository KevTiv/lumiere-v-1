import type { ComponentType, ReactNode } from "react"

export type FieldWidth = "full" | "1/2" | "1/3" | "2/3" | "1/4"

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

export interface EntityColumn {
  key: string
  label: string
  type?: ColumnType
  align?: "left" | "center" | "right"
  /** Tailwind min-width class e.g. "min-w-32" */
  width?: string
  sortable?: boolean
  /** Map raw value → badge variant for type="badge" */
  badgeVariants?: Record<string, BadgeVariant>
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

export interface EntityAction {
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
  searchable?: boolean
  searchPlaceholder?: string
  searchKeys?: string[]
  filters?: EntityFilter[]
  actions?: EntityAction[]
  emptyMessage?: string
}

// ─── Detail field (read-only display) ───────────────────────────────────────

export interface EntityDetailField {
  key: string
  label: string
  type?: ColumnType
  width?: FieldWidth
  badgeVariants?: Record<string, BadgeVariant>
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

// ─── Top-level config ────────────────────────────────────────────────────────

export interface EntityViewConfig {
  id: string
  title: string
  description?: string
  view: EntityTableConfig | EntityDetailConfig
}
