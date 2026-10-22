"use client"

import { useMemo, useState } from "react"
import { Tabs, TabsList, TabsTrigger } from "../../components/tabs"
import { EntityTable } from "../../entity-views/entity-table"
import type { EntityTableConfig } from "../../lib/entity-view-types"
import type { TabbedTableRow, TabbedTableWidget as TabbedTableWidgetType } from "../../lib/dashboard-types"

/** Rows a tab lists: every row for "all", else rows tagged with the tab. */
export function rowsForTab(rows: readonly TabbedTableRow[], tabId: string): TabbedTableRow[] {
  return tabId === "all" ? [...rows] : rows.filter((row) => row.tabIds.includes(tabId))
}

/** Tabs (All / Overdue / Draft / Paid…) over a paged entity table with status badges. */
export function TabbedTableWidget({ data }: { data: TabbedTableWidgetType["data"] }) {
  const [activeTab, setActiveTab] = useState(data.tabs[0]?.id ?? "all")
  const config = useMemo<EntityTableConfig>(
    () => ({
      mode: "table",
      columns: data.columns,
      rowKey: "id",
      rowSelectionToggleOnClick: false,
      emptyMessage: data.emptyMessage,
    }),
    [data.columns, data.emptyMessage],
  )
  const visibleRows = useMemo(() => rowsForTab(data.rows, activeTab), [data.rows, activeTab])
  const onRowClick = data.onRowClick

  return (
    <div className="space-y-3">
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(String(value))}>
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList>
            {data.tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="flex-none">
                {tab.label}
                <span className="ml-1 rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
                  {rowsForTab(data.rows, tab.id).length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>
      <EntityTable
        config={config}
        data={visibleRows}
        onRowClick={
          onRowClick
            ? (row) => {
                const match = visibleRows.find((candidate) => candidate.id === row.id)
                if (match) onRowClick(match)
              }
            : undefined
        }
      />
    </div>
  )
}
