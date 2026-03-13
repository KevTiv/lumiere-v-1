"use client"

import type { TableWidget as TableWidgetType } from "@/lib/dashboard-types"

export function TableWidget({ data }: { data: TableWidgetType["data"] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            {data.columns.map((col) => (
              <th 
                key={col.key}
                className={`px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider text-${col.align || "left"}`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, rowIndex) => (
            <tr 
              key={rowIndex}
              className="border-b border-border/50 hover:bg-secondary/30 transition-colors"
            >
              {data.columns.map((col) => (
                <td 
                  key={col.key}
                  className={`px-4 py-3 text-sm text-${col.align || "left"}`}
                >
                  {row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
