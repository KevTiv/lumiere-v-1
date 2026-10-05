"use client"

import type { TableWidget as TableWidgetType } from "../../lib/dashboard-types"
import { cn } from "../../lib/utils"
import { TablePager, usePagedRows } from "../../components/table-pager"

function alignmentClass(align?: "left" | "center" | "right") {
  if (align === "right") return "text-right"
  if (align === "center") return "text-center"
  return "text-left"
}

export function TableWidget({ data }: { data: TableWidgetType["data"] }) {
  const rowsPager = usePagedRows(data.rows)
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-muted/25">
            {data.columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "px-3 py-2.5 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground",
                  alignmentClass(col.align),
                )}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowsPager.pageRows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="border-b border-border/70 transition-colors last:border-0 hover:bg-muted/35"
            >
              {data.columns.map((col) => (
                <td
                  key={col.key}
                  className={cn("px-3 py-2.5 text-sm", alignmentClass(col.align))}
                >
                  {row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <TablePager {...rowsPager} />
    </div>
  )
}
