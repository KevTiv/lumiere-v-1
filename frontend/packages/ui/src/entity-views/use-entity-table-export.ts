"use client"

import { useCallback } from "react"
import { useTranslation } from "@lumiere/i18n"
import type { EntityColumn, EntityRow } from "../lib/entity-view-types"
import {
  EXPORT_ROW_LIMIT,
  buildEntityTableCsv,
  capExportRows,
  exportFilename,
  exportableColumns,
  selectExportRows,
} from "../lib/entity-table-export"
import { showWorkflowToast } from "../lib/workflow-toast"

interface UseEntityTableExportArgs {
  /** The visible columns, in displayed order. */
  columns: readonly EntityColumn[]
  selectedRows: readonly EntityRow[]
  /** Every row matching the current search and filters, across all pages. */
  filteredRows: readonly EntityRow[]
  listViewKey?: string
}

/** Downloads the selected rows (or all filtered rows) as CSV and tells the user how many. */
export function useEntityTableExport({ columns, selectedRows, filteredRows, listViewKey }: UseEntityTableExportArgs) {
  const { t } = useTranslation()

  const exportCsv = useCallback(() => {
    const { rows, truncated } = capExportRows(selectExportRows(selectedRows, filteredRows))
    if (rows.length === 0 || exportableColumns(columns).length === 0) return
    const csv = buildEntityTableCsv(columns, rows)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = exportFilename(listViewKey)
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    if (truncated) {
      showWorkflowToast({
        kind: "info",
        title: t("common.entityView.exportTruncated", {
          defaultValue: "Export limited to the first {{max}} rows",
          max: EXPORT_ROW_LIMIT.toLocaleString("en-US"),
        }),
      })
    }
    showWorkflowToast({
      kind: "success",
      title: t("common.entityView.exportDone", {
        count: rows.length,
        defaultValue_one: "Exported {{count}} row",
        defaultValue_other: "Exported {{count}} rows",
      }),
    })
  }, [columns, selectedRows, filteredRows, listViewKey, t])

  return { exportCsv }
}
