"use client"

import { useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
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

function formatTimestamp(ts?: { microsSinceUnixEpoch: bigint } | null): string {
  if (!ts) return "—"
  const ms = Number(ts.microsSinceUnixEpoch) / 1000
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v)

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
  open: boolean
  onOpenChange: (open: boolean) => void
  onViewMove?: (move: AccountMove) => void
}

export function AccountGlDrilldownPanel({
  account,
  moveLines,
  moves,
  open,
  onOpenChange,
  onViewMove,
}: AccountGlDrilldownPanelProps) {
  const { t } = useTranslation()
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {account
                ? t("accounting.glDrilldown.title", { code: account.code, name: account.name })
                : t("accounting.glDrilldown.titleFallback")}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2 py-2">
            <div className="space-y-2">
              <Label htmlFor="gl-drill-from">{t("accounting.glDrilldown.dateFrom")}</Label>
              <Input
                id="gl-drill-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gl-drill-to">{t("accounting.glDrilldown.dateTo")}</Label>
              <Input
                id="gl-drill-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("accounting.glDrilldown.columns.date")}</TableHead>
                  <TableHead>{t("accounting.glDrilldown.columns.move")}</TableHead>
                  <TableHead>{t("accounting.glDrilldown.columns.partner")}</TableHead>
                  <TableHead className="text-right">{t("accounting.glDrilldown.columns.debit")}</TableHead>
                  <TableHead className="text-right">{t("accounting.glDrilldown.columns.credit")}</TableHead>
                  <TableHead className="text-right">{t("accounting.glDrilldown.columns.balance")}</TableHead>
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
                  linesWithBalance.map(({ line, runningBalance }) => {
                    const moveId = lineMoveId(line)
                    const move = moveById.get(moveId)
                    const moveName = String(line.moveName ?? line.move_name ?? move?.name ?? moveId)
                    const partnerId = line.partnerId ?? line.partner_id
                    return (
                      <TableRow key={String(line.id)} className="hover:bg-muted/50">
                        <TableCell>{formatTimestamp(line.date as AccountMove["date"])}</TableCell>
                        <TableCell className="font-mono text-sm">{moveName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {partnerId != null ? `#${String(partnerId)}` : "—"}
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(Number(line.debit ?? 0))}</TableCell>
                        <TableCell className="text-right">{formatCurrency(Number(line.credit ?? 0))}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(runningBalance)}
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={!move}
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
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedMove} onOpenChange={() => setSelectedMove(null)}>
        <DialogContent className="max-w-lg">
          {selectedMove && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between gap-2">
                  <DialogTitle>{selectedMove.name ?? t("accounting.glDrilldown.moveDetail")}</DialogTitle>
                  <Badge variant="secondary">{String(selectedMove.state)}</Badge>
                </div>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-2 text-sm">
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
                  <p className="font-medium">{String(selectedMove.moveType)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t("accounting.journalEntries.total")}</p>
                  <p className="font-medium">{formatCurrency(selectedMove.amountTotal)}</p>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
