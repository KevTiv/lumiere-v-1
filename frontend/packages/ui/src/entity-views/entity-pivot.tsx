"use client"

import { useMemo, useState } from "react"
import { cn } from "../lib/utils"
import type { EntityColumn, EntityPivotConfig, EntityTableConfig } from "../lib/entity-view-types"
import { buildPivot, type PivotCell } from "../lib/entity-pivot"
import { formatEntityFieldValue } from "../lib/entity-row-utils"
import { humanizeEnumValue } from "../lib/entity-row-values"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/table"

export interface EntityPivotViewProps {
  rows: Record<string, unknown>[]
  /** The list's table config: column labels and types, filter option labels. */
  table: EntityTableConfig
  pivot: EntityPivotConfig
  className?: string
}

const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"

export function EntityPivotView({ rows, table, pivot, className }: EntityPivotViewProps) {
  const { labels } = pivot
  const [groupKey, setGroupKey] = useState(pivot.groupKeys[0] ?? "")
  const [columnKey, setColumnKey] = useState("")

  const columnByKey = useMemo(() => {
    const map = new Map<string, EntityColumn>()
    for (const column of table.columns) map.set(column.key, column)
    return map
  }, [table.columns])

  const fieldLabel = (key: string) =>
    table.filters?.find((filter) => filter.key === key)?.label ?? columnByKey.get(key)?.label ?? key

  const measures = pivot.measureKeys
    .map((key) => columnByKey.get(key))
    .filter((column): column is EntityColumn => Boolean(column))
  const measureKeys = measures.map((column) => column.key)

  const labelFor = (key: string, value: string) => {
    if (value === "") return labels.empty
    const option = table.filters?.find((filter) => filter.key === key)?.options?.find((o) => o.value === value)
    return option?.label ?? columnByKey.get(key)?.badgeLabels?.[value] ?? humanizeEnumValue(value)
  }
  const orderFor = (key: string) => {
    const options = table.filters?.find((filter) => filter.key === key)?.options
    if (options) return options.map((o) => o.value)
    const badge = columnByKey.get(key)?.badgeLabels
    return badge ? Object.keys(badge) : undefined
  }

  const effectiveColumnKey = columnKey && columnKey !== groupKey ? columnKey : undefined
  const result = useMemo(
    () =>
      buildPivot({
        rows,
        rowKey: groupKey,
        columnKey: effectiveColumnKey,
        measureKeys,
        currencyKey: pivot.currencyKey,
        labelFor,
        orderFor,
      }),
    // labelFor/orderFor derive from table, which is the dependency that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, groupKey, effectiveColumnKey, measureKeys.join("|"), pivot.currencyKey, table],
  )

  const money = (value: number, column: EntityColumn) =>
    formatEntityFieldValue(value, column.type ?? "number")

  const cellContent = (cell: PivotCell | undefined) =>
    cell
      ? [
          <TableCell key="count" className="text-right tabular-nums">{cell.count}</TableCell>,
          ...measures.map((column, index) => (
            <TableCell key={column.key} className="text-right tabular-nums">
              {money(cell.sums[index] ?? 0, column)}
            </TableCell>
          )),
        ]
      : [
          <TableCell key="count" className="text-right text-muted-foreground">—</TableCell>,
          ...measures.map((column) => (
            <TableCell key={column.key} className="text-right text-muted-foreground">—</TableCell>
          )),
        ]

  const headSpan = 1 + measures.length
  const firstMeasure = measures[0]
  const maxBar = Math.max(0, ...result.rows.map((row) => row.total.sums[0] ?? 0))

  return (
    <div className={cn("space-y-4", className)} data-testid="entity-pivot">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">{labels.groupBy}</span>
          <select
            className={selectClass}
            data-testid="entity-pivot-group"
            value={groupKey}
            onChange={(event) => setGroupKey(event.target.value)}
          >
            {pivot.groupKeys.map((key) => (
              <option key={key} value={key}>{fieldLabel(key)}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">{labels.columnsBy}</span>
          <select
            className={selectClass}
            data-testid="entity-pivot-columns"
            value={effectiveColumnKey ?? ""}
            onChange={(event) => setColumnKey(event.target.value)}
          >
            <option value="">{labels.none}</option>
            {pivot.groupKeys
              .filter((key) => key !== groupKey)
              .map((key) => (
                <option key={key} value={key}>{fieldLabel(key)}</option>
              ))}
          </select>
        </label>
      </div>

      {result.mixedCurrencies ? (
        <p className="text-sm text-warning" role="note" data-testid="entity-pivot-currency-note">
          {labels.mixedCurrencies(result.currencies)}
        </p>
      ) : null}

      {result.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.noData}</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              {effectiveColumnKey ? (
                <TableRow>
                  <TableHead rowSpan={2}>{fieldLabel(groupKey)}</TableHead>
                  {result.columns.map((column) => (
                    <TableHead key={column.value} colSpan={headSpan} className="text-center">
                      {column.label}
                    </TableHead>
                  ))}
                  <TableHead colSpan={headSpan} className="text-center">{labels.total}</TableHead>
                </TableRow>
              ) : null}
              <TableRow>
                {effectiveColumnKey ? null : <TableHead>{fieldLabel(groupKey)}</TableHead>}
                {[...result.columns.map((c) => c.value), null].map((column) => (
                  <MeasureHeads key={column ?? "__total__"} labels={labels} measures={measures} show={effectiveColumnKey !== undefined || column === null} />
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((row) => (
                <TableRow key={row.value} data-testid={`entity-pivot-row-${row.value}`}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  {result.columns.flatMap((column) => cellContent(row.cells[column.value]))}
                  {cellContent(row.total)}
                </TableRow>
              ))}
              <TableRow className="font-semibold" data-testid="entity-pivot-total">
                <TableCell>{labels.total}</TableCell>
                {result.columns.flatMap((column) => cellContent(result.columnTotals[column.value]))}
                {cellContent(result.total)}
              </TableRow>
            </TableBody>
          </Table>

          {firstMeasure ? (
            <div className="space-y-2" data-testid="entity-pivot-chart">
              <h4 className="text-sm font-medium text-foreground">
                {labels.chartTitle(firstMeasure.label)}
              </h4>
              <ul className="space-y-1.5">
                {result.rows.map((row) => {
                  const value = row.total.sums[0] ?? 0
                  const width = maxBar > 0 ? Math.max(0, (value / maxBar) * 100) : 0
                  return (
                    <li key={row.value} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 text-sm">
                      <span className="truncate text-muted-foreground">{row.label}</span>
                      <span className="h-3 rounded bg-muted">
                        <span
                          className="block h-3 rounded bg-primary"
                          style={{ width: `${width}%` }}
                          data-testid={`entity-pivot-bar-${row.value}`}
                        />
                      </span>
                      <span className="tabular-nums">{money(value, firstMeasure)}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function MeasureHeads({
  labels,
  measures,
  show,
}: {
  labels: EntityPivotConfig["labels"]
  measures: EntityColumn[]
  show: boolean
}) {
  if (!show) return null
  return (
    <>
      <TableHead className="text-right">{labels.count}</TableHead>
      {measures.map((column) => (
        <TableHead key={column.key} className="text-right">{column.label}</TableHead>
      ))}
    </>
  )
}
