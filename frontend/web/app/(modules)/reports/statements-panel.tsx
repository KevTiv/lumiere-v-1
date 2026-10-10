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
import { Button, downloadCsv, rowsToCsv } from "@lumiere/ui"
import { FileSpreadsheet } from "lucide-react"
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
  formatStatementAmount,
  journalItemsHref,
  type StatementDisplayRow,
} from "./statement-tree"

type StatementsPanelProps = {
  organizationId: bigint
  financialReports: Record<string, unknown>[]
}

function reportIdOf(row: Record<string, unknown>): string {
  const v = row.id
  return typeof v === "bigint" || typeof v === "number" || typeof v === "string" ? String(v) : ""
}

export function StatementsPanel({ organizationId, financialReports }: StatementsPanelProps) {
  const { t } = useTranslation()

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
    if (!selected) return []
    const lines = (query.data ?? []).filter((l) => l.reportId === selected.id)
    return buildStatementRows(lines, (name) =>
      t("reports.statements.subtotal", { defaultValue: "Total {{name}}", name }),
    )
  }, [query.data, selected, t])

  const exportCsv = () => {
    if (!selected) return
    const headers = [
      t("reports.statements.columns.line", { defaultValue: "Line" }),
      t("reports.statements.columns.amount", { defaultValue: "Amount" }),
      ...(showComparison
        ? [t("reports.statements.columns.comparison", { defaultValue: "Comparison" })]
        : []),
    ]
    const body = rows.map((r) => [
      `${"  ".repeat(r.depth)}${r.label}`,
      r.amount ?? "",
      ...(showComparison ? [r.comparisonAmount ?? ""] : []),
    ])
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
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1 space-y-1">
          <label htmlFor="statement-report" className="text-sm font-medium">
            {t("reports.statements.report", { defaultValue: "Report" })}
          </label>
          <select
            id="statement-report"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={selected?.id ?? ""}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {statementReports.map((r) => (
              <option key={r.id} value={r.id}>
                {typeof r.row.name === "string" && r.row.name !== "" ? r.row.name : `#${r.id}`}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={rows.length === 0}
          onClick={exportCsv}
        >
          <FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden />
          {t("reports.statements.exportCsv", { defaultValue: "Export CSV" })}
        </Button>
      </div>

      {query.isLoading ? (
        <div className="p-6 text-sm text-muted-foreground" role="status">
          {t("common.loading", { defaultValue: "Loading..." })}
        </div>
      ) : query.isError ? (
        <div className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive" role="alert">
          {query.error instanceof Error && query.error.message
            ? query.error.message
            : t("reports.statements.loadError", { defaultValue: "Could not load statement lines." })}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground" role="status">
          {t("reports.statements.empty", {
            defaultValue: "This report has no statement lines. Generate the report to populate it.",
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
                  <TableHead className="text-right">
                    {t("reports.statements.columns.comparison", { defaultValue: "Comparison" })}
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const href = journalItemsHref(r.accountId)
                const bold = r.kind !== "line"
                return (
                  <TableRow
                    key={r.key}
                    className={r.kind === "section" ? "bg-muted/40" : r.kind === "total" ? "border-t-2" : undefined}
                  >
                    <TableCell
                      className={bold ? "font-semibold" : undefined}
                      style={{ paddingLeft: `${0.75 + r.depth * 1.25}rem` }}
                    >
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
                      {r.amount == null ? "" : formatStatementAmount(r.amount)}
                    </TableCell>
                    {showComparison ? (
                      <TableCell className={`text-right tabular-nums ${bold ? "font-semibold" : ""}`}>
                        {r.comparisonAmount == null ? "" : formatStatementAmount(r.comparisonAmount)}
                      </TableCell>
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
