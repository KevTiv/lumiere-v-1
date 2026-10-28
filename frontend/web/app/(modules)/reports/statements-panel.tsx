"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  useBalanceSheetLines,
  useCashFlowLines,
  useProfitLossLines,
} from "@lumiere/query-hooks/hooks/bff-company-rows"
import { statementKindForReportType, type StatementKind } from "@lumiere/query-hooks/hooks/read-ui-rows"
import { Button, downloadCsv, resolveCurrencyCode, rowsToCsv } from "@lumiere/ui"
import { ChevronDown, ChevronRight, FileSpreadsheet, Printer } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  buildStatementRows,
  collapsibleSectionKeys,
  formatStatementAmount,
  formatStatementPercent,
  journalItemsHref,
  statementVariance,
  visibleStatementRows,
  type StatementDisplayRow,
} from "./statement-tree"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type StatementsPanelProps = {
  organizationId: bigint
  financialReports: Record<string, unknown>[]
  hideSelector?: boolean
  currencyCode?: string
}

const EMPTY_SET: ReadonlySet<string> = new Set()

function reportIdOf(row: Record<string, unknown>): string {
  const v = row.id
  return typeof v === "bigint" || typeof v === "number" || typeof v === "string" ? String(v) : ""
}

export function StatementsPanel({ organizationId, financialReports, hideSelector = false, currencyCode }: StatementsPanelProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language

  const statementReports = useMemo(
    () =>
      financialReports
        .map((row) => ({
          row,
          id: reportIdOf(row),
          kind: statementKindForReportType(row.reportType ?? row.report_type),
        }))
        .filter((r): r is { row: Record<string, unknown>; id: string; kind: StatementKind } =>
          r.id !== "" && r.kind != null,
        ),
    [financialReports],
  )

  const [selectedId, setSelectedId] = useState("")
  const selected =
    statementReports.find((r) => r.id === selectedId) ?? statementReports[0] ?? null
  const kind = selected?.kind ?? null

  const profitLoss = useProfitLossLines(organizationId, { enabled: kind === "profit-loss" })
  const balanceSheet = useBalanceSheetLines(organizationId, { enabled: kind === "balance-sheet" })
  const cashFlow = useCashFlowLines(organizationId, { enabled: kind === "cash-flow" })
  const query =
    kind === "profit-loss" ? profitLoss : kind === "balance-sheet" ? balanceSheet : cashFlow

  const showComparison = useMemo(() => {
    const cm = selected?.row.comparisonMode ?? selected?.row.comparison_mode
    return typeof cm === "string" && cm !== "" && cm !== "none"
  }, [selected])

  const rows: StatementDisplayRow[] = useMemo(() => {
    if (!selected || query.isLoading || query.isError) return []
    const lines = (query.data ?? []).filter((l) => l.reportId === selected.id)
    return buildStatementRows(lines, (name) =>
      t("reports.statements.subtotal", { defaultValue: "Total {{name}}", name }),
    )
  }, [query.data, query.isLoading, query.isError, selected, t])

  const currency = resolveCurrencyCode(currencyCode ?? selected?.row.currency ?? selected?.row.currencyCode ?? selected?.row.currency_code)

  // Collapsed groups are remembered per report so switching reports starts fully expanded.
  const [collapsedByReport, setCollapsedByReport] = useState<Record<string, ReadonlySet<string>>>({})
  const collapsed = (selected && collapsedByReport[selected.id]) || EMPTY_SET
  const sectionKeys = useMemo(() => collapsibleSectionKeys(rows), [rows])
  const visibleRows = useMemo(() => visibleStatementRows(rows, collapsed), [rows, collapsed])
  const setCollapsed = (next: ReadonlySet<string>) => {
    if (selected) setCollapsedByReport((prev) => ({ ...prev, [selected.id]: next }))
  }
  const toggleSection = (key: string) => {
    const next = new Set(collapsed)
    if (!next.delete(key)) next.add(key)
    setCollapsed(next)
  }
  const allCollapsed = sectionKeys.length > 0 && sectionKeys.every((key) => collapsed.has(key))

  const exportCsv = () => {
    if (!selected) return
    const headers = [
      t("reports.statements.columns.line", { defaultValue: "Line" }),
      t("reports.statements.columns.amount", { defaultValue: "Amount" }),
      ...(showComparison
        ? [
            t("reports.statements.columns.comparison", { defaultValue: "Comparison" }),
            t("reports.statements.columns.variance", { defaultValue: "Variance" }),
            t("reports.statements.columns.variancePercent", { defaultValue: "Variance %" }),
          ]
        : []),
    ]
    const body = rows.map((r) => {
      const variance = statementVariance(r)
      return [
        `${"  ".repeat(r.depth)}${r.label}`,
        r.amount ?? "",
        ...(showComparison
          ? [r.comparisonAmount ?? "", variance?.amount ?? "", variance?.percent == null ? "" : Math.round(variance.percent * 10) / 10]
          : []),
      ]
    })
    const name = typeof selected.row.name === "string" ? selected.row.name : `statement-${selected.id}`
    downloadCsv(name, rowsToCsv(headers, body))
  }

  if (statementReports.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground" role="status">
        {t("reports.statements.noReports", {
          defaultValue:
            "No profit and loss, balance sheet or cash flow reports yet. Generate one in Financial Reports first.",
        })}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        {!hideSelector && <div className="min-w-0 flex-1 space-y-1 sm:min-w-60">
          <label htmlFor="statement-report" className="text-sm font-medium">
            {t("reports.statements.report", { defaultValue: "Report" })}
          </label>
          <Select value={selected?.id ?? ""} onValueChange={setSelectedId}>
            <SelectTrigger id="statement-report">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statementReports.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {typeof r.row.name === "string" && r.row.name !== "" ? r.row.name : `#${r.id}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>}
        {!hideSelector && <Button
          type="button"
          variant="outline"
          disabled={rows.length === 0}
          onClick={exportCsv}
        >
          <FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden />
          {t("reports.statements.exportCsv", { defaultValue: "Export CSV" })}
        </Button>}
        <Button
          type="button"
          variant="outline"
          disabled={sectionKeys.length === 0}
          onClick={() => setCollapsed(allCollapsed ? EMPTY_SET : new Set(sectionKeys))}
        >
          {allCollapsed
            ? t("reports.statements.expandAll", { defaultValue: "Expand all" })
            : t("reports.statements.collapseAll", { defaultValue: "Collapse all" })}
        </Button>
        {!hideSelector && <Button type="button" variant="outline" disabled={rows.length === 0} onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" aria-hidden />
          {t("reports.statements.print", { defaultValue: "Print / PDF" })}
        </Button>}
      </div>

      {selected ? (
        <h2 className="hidden text-lg font-semibold print:block">
          {typeof selected.row.name === "string" && selected.row.name !== "" ? selected.row.name : `#${selected.id}`}
        </h2>
      ) : null}

      {query.isLoading ? (
        <div className="p-6 text-sm text-muted-foreground" role="status">
          {t("common.loading", { defaultValue: "Loading..." })}
        </div>
      ) : query.isError ? (
        <div className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive" role="alert">
          {query.error instanceof Error && query.error.message
            ? query.error.message
            : t("reports.statements.loadError", { defaultValue: "Could not load statement lines." })}
          <Button variant="outline" className="ml-3" onClick={() => { void query.refetch() }}>{t("common.retry")}</Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground" role="status">
          {t("reports.statements.empty", {
            defaultValue: "This report has no saved statement lines. Check its period and accounting basis before regenerating.",
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("reports.statements.columns.line", { defaultValue: "Line" })}</TableHead>
                <TableHead className="text-right">
                  {t("reports.statements.columns.amount", { defaultValue: "Amount" })}
                </TableHead>
                {showComparison ? (
                  <>
                    <TableHead className="text-right">
                      {t("reports.statements.columns.comparison", { defaultValue: "Comparison" })}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("reports.statements.columns.variance", { defaultValue: "Variance" })}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("reports.statements.columns.variancePercent", { defaultValue: "Variance %" })}
                    </TableHead>
                  </>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((r) => {
                const href = journalItemsHref(r.accountId)
                const bold = r.kind !== "line"
                const variance = statementVariance(r)
                const isCollapsed = r.kind === "section" && collapsed.has(r.key)
                return (
                  <TableRow
                    key={r.key}
                    className={r.kind === "section" ? "bg-muted/40" : r.kind === "total" ? "border-t-2" : undefined}
                  >
                    <TableCell
                      className={bold ? "font-semibold" : undefined}
                      style={{ paddingLeft: `${0.75 + r.depth * 1.25}rem` }}
                    >
                      {r.kind === "section" ? (
                        <button
                          type="button"
                          className="mr-1 inline-flex align-middle print:hidden"
                          aria-expanded={!isCollapsed}
                          aria-label={t(isCollapsed ? "reports.statements.expandSection" : "reports.statements.collapseSection", {
                            defaultValue: isCollapsed ? "Expand {{name}}" : "Collapse {{name}}",
                            name: r.label,
                          })}
                          onClick={() => toggleSection(r.key)}
                        >
                          {isCollapsed ? <ChevronRight className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
                        </button>
                      ) : null}
                      {href ? (
                        <Link
                          href={href}
                          className="underline-offset-2 hover:underline"
                          title={t("reports.statements.viewJournalItems", {
                            defaultValue: "View journal items",
                          })}
                        >
                          {r.label}
                        </Link>
                      ) : (
                        r.label
                      )}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${bold ? "font-semibold" : ""}`}>
                      {r.amount == null ? "" : formatStatementAmount(r.amount, locale, currency)}
                    </TableCell>
                    {showComparison ? (
                      <>
                        <TableCell className={`text-right tabular-nums ${bold ? "font-semibold" : ""}`}>
                          {r.comparisonAmount == null ? "" : formatStatementAmount(r.comparisonAmount, locale, currency)}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${bold ? "font-semibold" : ""} ${variance && variance.amount < 0 ? "text-destructive" : ""}`}>
                          {variance ? formatStatementAmount(variance.amount, locale, currency) : ""}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${bold ? "font-semibold" : ""} ${variance?.percent != null && variance.percent < 0 ? "text-destructive" : ""}`}>
                          {variance ? formatStatementPercent(variance.percent, locale) : ""}
                        </TableCell>
                      </>
                    ) : null}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
