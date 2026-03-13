"use client"

import { useState, useMemo } from "react"
import { cn } from "@/lib/utils"
import type { EntryTableConfig, EntryData, TableColumn } from "@/lib/entry-table-types"
import { EntryTableCell } from "./entry-table-cell"
import { EntryDetailModal } from "./entry-detail-modal"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Eye,
  Pencil,
  Trash2,
  Plus,
  Download,
} from "lucide-react"

interface EntryTableViewerProps {
  config: EntryTableConfig
  data: EntryData[]
  onView?: (row: EntryData) => void
  onEdit?: (row: EntryData) => void
  onDelete?: (row: EntryData) => void
  onAdd?: () => void
  onSave?: (row: EntryData) => void
  className?: string
}

export function EntryTableViewer({
  config,
  data,
  onView,
  onEdit,
  onDelete,
  onAdd,
  onSave,
  className,
}: EntryTableViewerProps) {
  const [search, setSearch] = useState("")
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(config.pageSize || 10)
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<"view" | "edit">("view")
  const [selectedEntry, setSelectedEntry] = useState<EntryData | null>(null)

  const features = config.features || {}
  const actions = config.actions || { view: true, edit: true, delete: true }
  const visibleColumns = config.columns.filter((col) => !col.hidden)

  // Filtering
  const filteredData = useMemo(() => {
    if (!search || !features.search) return data
    const lowerSearch = search.toLowerCase()
    return data.filter((row) =>
      visibleColumns.some((col) => {
        const value = row[col.key]
        if (value == null) return false
        return String(value).toLowerCase().includes(lowerSearch)
      })
    )
  }, [data, search, visibleColumns, features.search])

  // Sorting
  const sortedData = useMemo(() => {
    if (!sortKey || !features.sort) return filteredData
    return [...filteredData].sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]
      if (aVal == null) return 1
      if (bVal == null) return -1
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1
      return 0
    })
  }, [filteredData, sortKey, sortDir, features.sort])

  // Pagination
  const totalPages = Math.ceil(sortedData.length / pageSize)
  const paginatedData = features.pagination
    ? sortedData.slice((page - 1) * pageSize, page * pageSize)
    : sortedData

  const handleSort = (key: string) => {
    if (!features.sort) return
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedRows(new Set(paginatedData.map((row) => String(row.id || row._id))))
    } else {
      setSelectedRows(new Set())
    }
  }

  const handleSelectRow = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedRows)
    if (checked) {
      newSelected.add(id)
    } else {
      newSelected.delete(id)
    }
    setSelectedRows(newSelected)
  }

  const handleRowClick = (row: EntryData) => {
    if (config.onRowClick === "none") return
    setSelectedEntry(row)
    setModalMode(config.onRowClick === "edit" ? "edit" : "view")
    setModalOpen(true)
  }

  const handleView = (row: EntryData) => {
    setSelectedEntry(row)
    setModalMode("view")
    setModalOpen(true)
    onView?.(row)
  }

  const handleEdit = (row: EntryData) => {
    setSelectedEntry(row)
    setModalMode("edit")
    setModalOpen(true)
    onEdit?.(row)
  }

  const handleSave = (updatedRow: EntryData) => {
    onSave?.(updatedRow)
    setModalOpen(false)
    setSelectedEntry(null)
  }

  const getSortIcon = (col: TableColumn) => {
    if (!col.sortable || !features.sort) return null
    if (sortKey !== col.key) return <ArrowUpDown className="h-4 w-4 ml-1 opacity-50" />
    return sortDir === "asc" 
      ? <ArrowUp className="h-4 w-4 ml-1" />
      : <ArrowDown className="h-4 w-4 ml-1" />
  }

  const allSelected = paginatedData.length > 0 && 
    paginatedData.every((row) => selectedRows.has(String(row.id || row._id)))

  return (
    <Card className={cn("bg-card border-border/50", className)}>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{config.title}</CardTitle>
            {config.description && (
              <CardDescription>{config.description}</CardDescription>
            )}
          </div>
          <div className="flex items-center gap-2">
            {features.export && (
              <Button variant="outline" size="sm" className="gap-2">
                <Download className="h-4 w-4" />
                Export
              </Button>
            )}
            {onAdd && (
              <Button size="sm" className="gap-2" onClick={onAdd}>
                <Plus className="h-4 w-4" />
                Add New
              </Button>
            )}
          </div>
        </div>
        
        {features.search && (
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search entries..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              className="pl-10 bg-secondary/50"
            />
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/50 bg-secondary/30">
                {features.selection && (
                  <th className="p-3 w-12">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={handleSelectAll}
                    />
                  </th>
                )}
                {visibleColumns.map((col) => (
                  <th
                    key={col.id}
                    className={cn(
                      "p-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider",
                      col.align === "center" && "text-center",
                      col.align === "right" && "text-right",
                      col.sortable && features.sort && "cursor-pointer hover:text-foreground transition-colors"
                    )}
                    onClick={() => col.sortable && handleSort(col.key)}
                  >
                    <div className={cn(
                      "flex items-center gap-1",
                      col.align === "center" && "justify-center",
                      col.align === "right" && "justify-end"
                    )}>
                      {col.label}
                      {getSortIcon(col)}
                    </div>
                  </th>
                ))}
                {(actions.view || actions.edit || actions.delete) && (
                  <th className="p-3 w-24 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {paginatedData.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleColumns.length + (features.selection ? 1 : 0) + (actions.view || actions.edit || actions.delete ? 1 : 0)}
                    className="p-8 text-center text-muted-foreground"
                  >
                    No entries found
                  </td>
                </tr>
              ) : (
                paginatedData.map((row, idx) => {
                  const rowId = String(row.id || row._id || idx)
                  return (
                    <tr
                      key={rowId}
                      className={cn(
                        "border-b border-border/30 hover:bg-secondary/20 transition-colors",
                        config.onRowClick !== "none" && "cursor-pointer"
                      )}
                      onClick={() => config.onRowClick !== "none" && handleRowClick(row)}
                    >
                      {features.selection && (
                        <td className="p-3" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedRows.has(rowId)}
                            onCheckedChange={(checked) => handleSelectRow(rowId, !!checked)}
                          />
                        </td>
                      )}
                      {visibleColumns.map((col) => (
                        <td
                          key={col.id}
                          className={cn(
                            "p-3",
                            col.align === "center" && "text-center",
                            col.align === "right" && "text-right"
                          )}
                        >
                          <EntryTableCell
                            column={col}
                            value={row[col.key]}
                            row={row}
                            imagePlaceholder={config.imagePlaceholder}
                          />
                        </td>
                      ))}
                      {(actions.view || actions.edit || actions.delete) && (
                        <td className="p-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {actions.view && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleView(row)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            )}
                            {actions.edit && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleEdit(row)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            {actions.delete && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => onDelete?.(row)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {features.pagination && totalPages > 0 && (
          <div className="flex items-center justify-between p-4 border-t border-border/50">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Rows per page:</span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v))
                  setPage(1)
                }}
              >
                <SelectTrigger className="w-16 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(config.pageSizeOptions || [5, 10, 20, 50]).map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="ml-4">
                {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, sortedData.length)} of {sortedData.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page === 1}
                onClick={() => setPage(1)}
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-3 text-sm">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page === totalPages}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page === totalPages}
                onClick={() => setPage(totalPages)}
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      {config.formFields && selectedEntry && (
        <EntryDetailModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          entry={selectedEntry}
          fields={config.formFields}
          mode={modalMode}
          onModeChange={setModalMode}
          onSave={handleSave}
          title={modalMode === "view" ? "View Entry" : "Edit Entry"}
        />
      )}
    </Card>
  )
}
