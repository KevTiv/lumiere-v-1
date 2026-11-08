"use client"

import { useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Eye } from "lucide-react"
import type { AccountAccount, AccountMove } from "../lib/accounting-types"
import { useTranslation } from "@lumiere/i18n"
import { useCurrencyFormat } from "../lib/currency-context"
import { TablePager, usePagedRows } from "../components/table-pager"
import { DatePicker } from "@/components/ui/date-picker"
import { entityScalarText, formatEntityReference, formatTimestampLike } from "../lib/entity-row-values"
import { accountingMoveState, accountingMoveType } from "./accounting-move-display"

function lineAccountId(line: Record<string, unknown>): string {
  return String(line.accountId ?? line.account_id ?? "")
}

function lineMoveId(line: Record<string, unknown>): string {
  return String(line.moveId ?? line.move_id ?? "")
}

function lineMicros(line: Record<string, unknown>): number {
  const ts = (line.date ?? null) as { microsSinceUnixEpoch?: bigint } | null
  if (!ts?.microsSinceUnixEpoch) return 0
  return Number(ts.microsSinceUnixEpoch)
}

export interface AccountGlDrilldownPanelProps {
  account: AccountAccount | null
  moveLines: Record<string, unknown>[]
  moves: AccountMove[]
  partnerLabels?: ReadonlyMap<string, string>
  open: boolean
  onOpenChange: (open: boolean) => void
  onViewMove?: (move: AccountMove) => void
}

export function AccountGlDrilldownPanel({
  account,
  moveLines,
  moves,
  partnerLabels,
  open,
  onOpenChange,
  onViewMove,
}: AccountGlDrilldownPanelProps) {
  const { t } = useTranslation()
  const currency = useCurrencyFormat()
  const formatTimestamp = (value: unknown): string => {
    const date = formatTimestampLike(value)
    return date ? currency.date(date.getTime()) : "—"
  }
  /** In the document's own currency when it names one, else the company's. */
  const formatCurrency = (value: number, currencyId?: unknown): string => currency.money(value, currencyId)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [selectedMove, setSelectedMove] = useState<AccountMove | null>(null)

  const accountId = account ? String(account.id) : ""

  const moveById = useMemo(() => {
    const map = new Map<string, AccountMove>()
    for (const m of moves) map.set(String(m.id), m)
    return map
  }, [moves])

  const filteredLines = useMemo(() => {
    if (!accountId) return []
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null

    return moveLines
      .filter((line) => lineAccountId(line) === accountId)
      .filter((line) => {
        const ms = lineMicros(line) / 1000
        if (fromMs != null && ms < fromMs) return false
        if (toMs != null && ms > toMs) return false
        return true
      })
      .sort((a, b) => lineMicros(a) - lineMicros(b))
  }, [accountId, moveLines, dateFrom, dateTo])

  const linesWithBalance = useMemo(() => {
    let running = account?.openingBalance ?? 0
    return filteredLines.map((line) => {
      const debit = Number(line.debit ?? 0)
      const credit = Number(line.credit ?? 0)
      running += debit - credit
      return { line, runningBalance: running }
    })
  }, [filteredLines, account?.openingBalance])

  const handleViewMove = (moveId: string) => {
    const move = moveById.get(moveId)
    if (!move) return
    if (onViewMove) {
      onViewMove(move)
      return
    }
    setSelectedMove(move)
  }

  const linesPager = usePagedRows(linesWithBalance)
  const selectedState = selectedMove ? accountingMoveState(selectedMove.state, t) : null
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="review" className="flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="leading-snug [overflow-wrap:anywhere]">
              {account
                ? t("accounting.glDrilldown.title", { code: account.code, name: account.name })
                : t("accounting.glDrilldown.titleFallback")}
            </DialogTitle>
          </DialogHeader>

          <div className="grid shrink-0 gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="gl-drill-from">{t("accounting.glDrilldown.dateFrom")}</Label>
              <DatePicker
                id="gl-drill-from"
                value={dateFrom}
                onChange={(value) => setDateFrom(value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gl-drill-to">{t("accounting.glDrilldown.dateTo")}</Label>
              <DatePicker
                id="gl-drill-to"
                value={dateTo}
                onChange={(value) => setDateTo(value)}
              />
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto rounded-lg border">
            <Table pagination={false}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("accounting.glDrilldown.columns.date")}</TableHead>
                  <TableHead>{t("accounting.glDrilldown.columns.move")}</TableHead>
                  <TableHead>{t("accounting.glDrilldown.columns.partner")}</TableHead>
                  <TableHead className="text-right tabular-nums">{t("accounting.glDrilldown.columns.debit")}</TableHead>
                  <TableHead className="text-right tabular-nums">{t("accounting.glDrilldown.columns.credit")}</TableHead>
                  <TableHead className="text-right tabular-nums">{t("accounting.glDrilldown.columns.balance")}</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {linesWithBalance.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      {t("accounting.glDrilldown.empty")}
                    </TableCell>
                  </TableRow>
                ) : (
                  linesPager.pageRows.map(({ line, runningBalance }) => {
                    const moveId = lineMoveId(line)
                    const move = moveById.get(moveId)
                    const moveName = entityScalarText(line.moveName ?? line.move_name ?? move?.name) ?? formatEntityReference(moveId)
                    const partnerId = line.partnerId ?? line.partner_id
                    return (
                      <TableRow key={String(line.id)} className="hover:bg-muted/50">
                        <TableCell>{formatTimestamp(line.date)}</TableCell>
                        <TableCell className="min-w-28 whitespace-normal text-sm [overflow-wrap:anywhere]">{moveName}</TableCell>
                        <TableCell className="min-w-28 whitespace-normal text-sm text-muted-foreground [overflow-wrap:anywhere]">
                          {formatEntityReference(partnerId, { labels: partnerLabels })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(Number(line.debit ?? 0), line.companyCurrencyId)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(Number(line.credit ?? 0), line.companyCurrencyId)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(runningBalance)}
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={!move}
                            aria-label={t("accounting.glDrilldown.viewMove", { defaultValue: "View {{move}}", move: moveName })}
                            onClick={() => handleViewMove(moveId)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
            <TablePager {...linesPager} />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedMove} onOpenChange={() => setSelectedMove(null)}>
        <DialogContent size="record">
          {selectedMove && selectedState && (
            <>
              <DialogHeader>
                <DialogTitle className="leading-snug [overflow-wrap:anywhere]">{selectedMove.name ?? t("accounting.glDrilldown.moveDetail")}</DialogTitle>
                <DialogDescription><Badge variant={selectedState.variant}>{selectedState.label}</Badge></DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-2 text-sm [overflow-wrap:anywhere]">
                <div>
                  <p className="text-muted-foreground">{t("accounting.journalEntries.date")}</p>
                  <p className="font-medium">{formatTimestamp(selectedMove.date)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t("accounting.journalEntries.ref")}</p>
                  <p className="font-medium">{selectedMove.ref ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t("accounting.journalEntries.type")}</p>
                  <p className="font-medium">{accountingMoveType(selectedMove.moveType, t)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t("accounting.journalEntries.total")}</p>
                  <p className="font-medium tabular-nums">{selectedMove.amountTotal != null && Number.isFinite(selectedMove.amountTotal) ? formatCurrency(selectedMove.amountTotal, selectedMove.currencyId) : "—"}</p>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
