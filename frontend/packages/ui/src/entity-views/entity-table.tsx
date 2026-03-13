import { useState, useMemo } from "react"
import { cn } from "../lib/utils"
import type { EntityTableConfig } from "../lib/entity-view-types"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/table"
import { Badge } from "../components/badge"
import { Input } from "../components/input"
import { Button } from "../components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/select"
import { Search } from "lucide-react"

interface EntityTableProps {
  config: EntityTableConfig
  data: Record<string, unknown>[]
  onRowClick?: (row: Record<string, unknown>) => void
  className?: string
}

function formatValue(
  value: unknown,
  type: string | undefined,
  badgeVariants?: Record<string, string>,
  badgeLabels?: Record<string, string>,
): React.ReactNode {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">—</span>

  switch (type) {
    case "currency":
      return typeof value === "number"
        ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)
        : String(value)

    case "number":
      return typeof value === "number"
        ? new Intl.NumberFormat("en-US").format(value)
        : String(value)

    case "percent":
      return typeof value === "number" ? `${value.toFixed(1)}%` : String(value)

    case "date":
      return value instanceof Date
        ? value.toLocaleDateString()
        : typeof value === "string"
          ? new Date(value).toLocaleDateString()
          : String(value)

    case "datetime":
      return value instanceof Date
        ? value.toLocaleString()
        : typeof value === "string"
          ? new Date(value).toLocaleString()
          : String(value)

    case "boolean":
      return (
        <Badge variant={value ? "default" : "secondary"}>
          {value ? "Yes" : "No"}
        </Badge>
      )

    case "badge": {
      const raw = String(value)
      const variant = (badgeVariants?.[raw] ?? "secondary") as "default" | "secondary" | "destructive" | "outline"
      const label = badgeLabels?.[raw] ?? raw
      return <Badge variant={variant}>{label}</Badge>
    }

    default:
      return String(value)
  }
}

export function EntityTable({ config, data, onRowClick, className }: EntityTableProps) {
  const [search, setSearch] = useState("")
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

  const rowKey = config.rowKey ?? "id"

  const filtered = useMemo(() => {
    let rows = data

    // Search
    if (search && config.searchKeys?.length) {
      const q = search.toLowerCase()
      rows = rows.filter((row) =>
        config.searchKeys!.some((k) => String(row[k] ?? "").toLowerCase().includes(q))
      )
    }

    // Filters
    for (const [key, val] of Object.entries(filters)) {
      if (val && val !== "__all__") {
        rows = rows.filter((row) => String(row[key]) === val)
      }
    }

    return rows
  }, [data, search, filters, config.searchKeys])

  const selectedRows = filtered.filter((row) => selectedKeys.has(String(row[rowKey])))

  const toggleRow = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const hasActions = (config.actions?.length ?? 0) > 0

  return (
    <div className={cn("space-y-4", className)}>
      {/* Toolbar */}
      {(config.searchable || (config.filters?.length ?? 0) > 0 || hasActions) && (
        <div className="flex flex-wrap items-center gap-3">
          {config.searchable && (
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={config.searchPlaceholder ?? "Search…"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          )}
          {config.filters?.map((f) => (
            <Select
              key={f.key}
              value={filters[f.key] ?? "__all__"}
              onValueChange={(val) => setFilters((prev) => ({ ...prev, [f.key]: val }))}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder={f.placeholder ?? f.label} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All {f.label}s</SelectItem>
                {f.options?.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {config.actions?.map((action) => {
              const Icon = action.icon
              return (
                <Button
                  key={action.id}
                  variant={action.variant ?? "outline"}
                  size="sm"
                  disabled={action.requiresSelection && selectedRows.length === 0}
                  onClick={() => action.onClick(selectedRows)}
                >
                  {Icon && <Icon className="h-4 w-4 mr-2" />}
                  {action.label}
                </Button>
              )
            })}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-md border border-border/50">
        <Table>
          <TableHeader>
            <TableRow>
              {config.columns.map((col) => (
                <TableHead
                  key={col.key}
                  className={cn(
                    col.width,
                    col.align === "right" && "text-right",
                    col.align === "center" && "text-center",
                  )}
                >
                  {col.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={config.columns.length}
                  className="text-center text-muted-foreground py-12"
                >
                  {config.emptyMessage ?? "No records found."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row, i) => {
                const key = String(row[rowKey] ?? i)
                const isSelected = selectedKeys.has(key)
                return (
                  <TableRow
                    key={key}
                    onClick={() => {
                      if (hasActions) toggleRow(key)
                      onRowClick?.(row)
                    }}
                    className={cn(
                      onRowClick || hasActions ? "cursor-pointer" : "",
                      isSelected && "bg-primary/5",
                    )}
                  >
                    {config.columns.map((col) => {
                      const value = row[col.key]
                      return (
                        <TableCell
                          key={col.key}
                          className={cn(
                            col.align === "right" && "text-right",
                            col.align === "center" && "text-center",
                          )}
                        >
                          {col.render
                            ? col.render(value, row)
                            : formatValue(value, col.type, col.badgeVariants, col.badgeLabels)}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {filtered.length} of {data.length} record{data.length !== 1 ? "s" : ""}
          {selectedKeys.size > 0 && ` · ${selectedKeys.size} selected`}
        </p>
      )}
    </div>
  )
}
