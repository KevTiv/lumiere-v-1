import type { FormField } from "./form-types"

export type ColumnType = 
  | "text"
  | "number"
  | "date"
  | "datetime"
  | "currency"
  | "image"
  | "avatar"
  | "badge"
  | "status"
  | "progress"
  | "actions"
  | "custom"

export type ColumnWidth = "xs" | "sm" | "md" | "lg" | "xl" | "auto"

export interface BaseColumn {
  id: string
  key: string
  label: string
  type: ColumnType
  width?: ColumnWidth
  sortable?: boolean
  filterable?: boolean
  hidden?: boolean
  align?: "left" | "center" | "right"
}

export interface TextColumn extends BaseColumn {
  type: "text"
  truncate?: boolean
  maxLength?: number
}

export interface NumberColumn extends BaseColumn {
  type: "number"
  decimals?: number
  prefix?: string
  suffix?: string
}

export interface DateColumn extends BaseColumn {
  type: "date" | "datetime"
  format?: string
}

export interface CurrencyColumn extends BaseColumn {
  type: "currency"
  currency?: string
  locale?: string
}

export interface ImageColumn extends BaseColumn {
  type: "image"
  fallback?: string
  size?: "sm" | "md" | "lg"
  rounded?: boolean
}

export interface AvatarColumn extends BaseColumn {
  type: "avatar"
  fallbackKey?: string
  size?: "sm" | "md" | "lg"
}

export interface BadgeColumn extends BaseColumn {
  type: "badge"
  variants?: Record<string, {
    label?: string
    color: "default" | "primary" | "secondary" | "success" | "warning" | "danger" | "info"
  }>
}

export interface StatusColumn extends BaseColumn {
  type: "status"
  statuses: Record<string, {
    label: string
    color: "green" | "yellow" | "red" | "blue" | "gray" | "purple" | "orange"
    icon?: string
  }>
}

export interface ProgressColumn extends BaseColumn {
  type: "progress"
  maxKey?: string
  showLabel?: boolean
  color?: "primary" | "success" | "warning" | "danger"
}

export interface ActionsColumn extends BaseColumn {
  type: "actions"
  actions: Array<{
    id: string
    label: string
    icon?: string
    variant?: "default" | "destructive" | "outline" | "ghost"
    onClick?: (row: EntryData) => void
  }>
}

export interface CustomColumn extends BaseColumn {
  type: "custom"
  render: (value: unknown, row: EntryData) => React.ReactNode
}

export type TableColumn =
  | TextColumn
  | NumberColumn
  | DateColumn
  | CurrencyColumn
  | ImageColumn
  | AvatarColumn
  | BadgeColumn
  | StatusColumn
  | ProgressColumn
  | ActionsColumn
  | CustomColumn

export type EntryData = Record<string, unknown>

export interface EntryTableConfig {
  id: string
  title: string
  description?: string
  columns: TableColumn[]
  // Form config for view/edit modal
  formFields?: FormField[]
  // Features
  features?: {
    search?: boolean
    filter?: boolean
    sort?: boolean
    pagination?: boolean
    selection?: boolean
    export?: boolean
    bulkActions?: boolean
  }
  // Pagination
  pageSize?: number
  pageSizeOptions?: number[]
  // Image placeholder
  imagePlaceholder?: string
  // Row click behavior
  onRowClick?: "view" | "edit" | "none"
  // Custom actions
  actions?: {
    view?: boolean
    edit?: boolean
    delete?: boolean
    custom?: Array<{
      id: string
      label: string
      icon?: string
      onClick: (row: EntryData) => void
    }>
  }
}

export const columnWidthClasses: Record<ColumnWidth, string> = {
  xs: "w-16",
  sm: "w-24",
  md: "w-32",
  lg: "w-48",
  xl: "w-64",
  auto: "w-auto",
}
