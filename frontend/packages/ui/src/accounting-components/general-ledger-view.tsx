"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import {
  Dialog,
  DialogFooter,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Search,
  Plus,
  Eye,
  CheckCircle2,
  Clock,
  FileText,
  ArrowUpRight,
  Upload,
  Calculator,
  X,
} from "lucide-react"
import type { AccountMove } from "../lib/accounting-types"
import { moveStateIsDraft, moveTypeIsInvoiceOrRefund, stbEnumTag } from "../lib/accounting-move-utils"
import { getRowField } from "../lib/entity-row-utils"
import { useCurrencyFormat } from "../lib/currency-context"
import { useClearModuleUrlFilter, useModuleUrlFilters } from "../lib/module-url-filters"
import { useTranslation } from "@lumiere/i18n"
import type { RowValueMap } from "@lumiere/erp-shared/row-values"
import { TablePager, usePagedRows } from "../components/table-pager"

function routeFilterValue(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as RowValueMap
    if (typeof record.tag === "string") return record.tag
    if ("some" in record) return routeFilterValue(record.some)
  }
  return String(value)
}

type LedgerMoveLine = {
  moveId?: AccountMove["id"] | null
  companyId?: AccountMove["companyId"] | null
  companyCurrencyId?: AccountMove["currencyId"] | null
  debit?: number | null
  credit?: number | null
}

interface GeneralLedgerViewProps {
  moves: AccountMove[]
  moveLines?: LedgerMoveLine[]
  onCreate?: (data: Record<string, unknown>) => void
  onImportMovesCsv?: () => void
  onImportOutstandingDocumentsCsv?: () => void
  onImportHistoricalDocumentsForPaymentReplayCsv?: () => void
  onImportMoveLinesCsv?: () => void
  onPostMove?: (move: AccountMove) => void
  onCancelMove?: (move: AccountMove) => void
  /** Recompute invoice totals from lines (draft invoice/refund moves only). */
  onComputeInvoiceTotals?: (move: AccountMove) => void
  postMovePending?: boolean
  cancelMovePending?: boolean
  computeInvoiceTotalsPending?: boolean
}

export function GeneralLedgerView({
  moves,
  moveLines,
  onCreate,
  onImportMovesCsv,
  onImportOutstandingDocumentsCsv,
  onImportHistoricalDocumentsForPaymentReplayCsv,
  onImportMoveLinesCsv,
  onPostMove,
  onCancelMove,
  onComputeInvoiceTotals,
  postMovePending,
  cancelMovePending,
  computeInvoiceTotalsPending,
}: GeneralLedgerViewProps) {
  const { t } = useTranslation()
  const currency = useCurrencyFormat()
  const formatTimestamp = (ts?: { microsSinceUnixEpoch: bigint } | null): string =>
    ts ? currency.date(Number(ts.microsSinceUnixEpoch) / 1000) : "—"
  /** In the document's own currency when it names one, else the company's. */
  const formatCurrency = (value: number, currencyId?: unknown): string => currency.money(value, currencyId)
  const urlFilters = useModuleUrlFilters()
  const clearUrlFilter = useClearModuleUrlFilter()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedMove, setSelectedMove] = useState<AccountMove | null>(null)
  const linesByMove = useMemo(() => {
    const grouped = new Map<string, LedgerMoveLine[]>()
    for (const line of moveLines ?? []) {
      const key = `${line.companyId}:${line.moveId}`
      const group = grouped.get(key)
      if (group) group.push(line)
      else grouped.set(key, [line])
    }
    return grouped
  }, [moveLines])
  const amountFor = (move: AccountMove) => {
    if (stbEnumTag(move.moveType) !== "Entry") {
      return { amount: move.amountTotal ?? 0, currencyId: move.currencyId }
    }
    const lines = linesByMove.get(`${move.companyId}:${move.id}`)
    const companyCurrencyId = lines?.[0]?.companyCurrencyId
    if (!lines?.length || move.companyId == null || companyCurrencyId == null ||
      lines.some((line) => String(line.companyCurrencyId) !== String(companyCurrencyId) ||
        !Number.isFinite(line.debit) || !Number.isFinite(line.credit))) {
      return null
    }
    const debit = lines.reduce((total, line) => total + line.debit!, 0)
    const credit = lines.reduce((total, line) => total + line.credit!, 0)
    return Math.abs(debit - credit) <= 0.01 ? { amount: debit, currencyId: companyCurrencyId } : null
  }
  const formatMoveAmount = (move: AccountMove) => {
    const value = amountFor(move)
    return value ? formatCurrency(value.amount, value.currencyId) : "—"
  }

  const activeUrlFilters = Object.entries(urlFilters).filter(
    ([, value]) => value && value !== "__all__",
  )
  const filtered = moves.filter((m) => {
    const name = m?.name?.toLowerCase() ?? ""
    const ref = String(m?.ref)?.toLowerCase() ?? ""
    const matchesSearch =
      name.includes(searchQuery.toLowerCase()) || ref.includes(searchQuery.toLowerCase())
    const row = m as unknown as RowValueMap
    const matchesUrlFilters = activeUrlFilters.every(
      ([key, value]) =>
        routeFilterValue(getRowField(row, key)).toLowerCase() === value.toLowerCase(),
    )
    return matchesSearch && matchesUrlFilters
  })

  const amounts = moves.map(amountFor)
  const movementCurrencies = new Set(amounts.map((value) => String(value?.currencyId ?? "")))
  const stats = {
    total: moves.length,
    posted: moves.filter((m) => stbEnumTag(m.state) === "Posted").length,
    pending: moves.filter((m) => stbEnumTag(m.state) === "Draft").length,
    totalMovement: movementCurrencies.size <= 1 && amounts.every((value) => value != null)
      ? formatCurrency(amounts.reduce((total, value) => total + (value?.amount ?? 0), 0), amounts[0]?.currencyId)
      : "—",
  }

  const movesPager = usePagedRows(filtered)
  return (
    <div className="space-y-6" data-testid="entity-table">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-info/10"><FileText className="h-5 w-5 text-info" /></div>
            <div><p className="text-sm text-muted-foreground">{t("accounting.journalEntries.totalEntries")}</p><p className="text-2xl font-bold">{stats.total}</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-success/10"><CheckCircle2 className="h-5 w-5 text-success" /></div>
            <div><p className="text-sm text-muted-foreground">{t("accounting.states.posted")}</p><p className="text-2xl font-bold">{stats.posted}</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-warning/10"><Clock className="h-5 w-5 text-warning" /></div>
            <div><p className="text-sm text-muted-foreground">{t("accounting.states.draft")}</p><p className="text-2xl font-bold">{stats.pending}</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-category-3/10"><ArrowUpRight className="h-5 w-5 text-category-3" /></div>
            <div><p className="text-sm text-muted-foreground">{t("accounting.journalEntries.totalMovement")}</p><p className="text-2xl font-bold">{stats.totalMovement}</p></div>
          </div>
        </CardContent></Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{t("accounting.journalEntries.title")}</CardTitle>
            <div className="flex flex-wrap gap-2">
              {onImportMovesCsv ? (
                <Button type="button" variant="outline" onClick={onImportMovesCsv} className="gap-2">
                  <Upload className="h-4 w-4" />
                  {t("accounting.csvImport.toolbarMoves")}
                </Button>
              ) : null}
              {onImportOutstandingDocumentsCsv ? (
                <Button type="button" variant="outline" onClick={onImportOutstandingDocumentsCsv} className="gap-2">
                  <Upload className="h-4 w-4" />
                  {t("accounting.csvImport.toolbarOutstandingDocuments")}
                </Button>
              ) : null}
              {onImportHistoricalDocumentsForPaymentReplayCsv ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onImportHistoricalDocumentsForPaymentReplayCsv}
                  className="gap-2"
                >
                  <Upload className="h-4 w-4" />
                  {t("accounting.csvImport.toolbarHistoricalDocumentsForPaymentReplay")}
                </Button>
              ) : null}
              {onImportMoveLinesCsv ? (
                <Button type="button" variant="outline" onClick={onImportMoveLinesCsv} className="gap-2">
                  <Upload className="h-4 w-4" />
                  {t("accounting.csvImport.toolbarMoveLines")}
                </Button>
              ) : null}
              {onCreate ? (
                <Button onClick={() => onCreate({})} className="gap-2">
                  <Plus className="h-4 w-4" />
                  {t("accounting.actions.newEntry")}
                </Button>
              ) : null}
            </div>
          </div>
          {activeUrlFilters.length > 0 ? (
            <div
              className="mt-4 flex flex-wrap items-center gap-2"
              data-testid="entity-active-filters"
            >
              {activeUrlFilters.map(([key, value]) => (
                <Button
                  key={key}
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label={`Clear filter ${key}`}
                  data-testid={`entity-active-filter-${key}`}
                  onClick={() => clearUrlFilter(key)}
                >
                  {key}: {value}
                  <X className="ml-2 h-3 w-3" />
                </Button>
              ))}
            </div>
          ) : null}
          <div className="relative mt-4 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder={t("accounting.journalEntries.searchPlaceholder")} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
          </div>
        </CardHeader>
        <CardContent>
          <Table pagination={false}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("accounting.journalEntries.entryNumber")}</TableHead>
                <TableHead>{t("accounting.journalEntries.date")}</TableHead>
                <TableHead>{t("accounting.journalEntries.ref")}</TableHead>
                <TableHead>{t("accounting.journalEntries.type")}</TableHead>
                <TableHead className="text-right">{t("accounting.journalEntries.total")}</TableHead>
                <TableHead>{t("accounting.journalEntries.state")}</TableHead>
                <TableHead className="w-12.5"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t("accounting.journalEntries.noResults")}</TableCell></TableRow>
              ) : movesPager.pageRows.map((move) => {
                const isPosted = stbEnumTag(move.state) === "Posted"
                return (
                  <TableRow key={String(move.id)} data-testid={`entity-row-${move.id}`} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedMove(move)}>
                    <TableCell className="font-mono font-medium">{move.name}</TableCell>
                    <TableCell>{formatTimestamp(move.date)}</TableCell>
                    <TableCell>
                      {move.ref && <Badge variant="outline" className="text-xs">{move.ref}</Badge>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{stbEnumTag(move.moveType)}</TableCell>
                    <TableCell className="text-right font-medium">{formatMoveAmount(move)}</TableCell>
                    <TableCell>
                      <Badge variant={isPosted ? "default" : "secondary"} className="gap-1">
                        {isPosted
                          ? <><CheckCircle2 className="h-3 w-3" />{t("accounting.states.posted")}</>
                          : <><Clock className="h-3 w-3" />{t("accounting.states.draft")}</>}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); setSelectedMove(move) }}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <TablePager {...movesPager} />
        </CardContent>
      </Card>

      {/* Entry Detail Dialog */}
      <Dialog open={!!selectedMove} onOpenChange={() => setSelectedMove(null)}>
        <DialogContent className="max-w-2xl">
          {selectedMove && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <DialogTitle>Entry: {selectedMove.name}</DialogTitle>
                  <Badge variant={stbEnumTag(selectedMove.state) === "Posted" ? "default" : "secondary"}>
                    {stbEnumTag(selectedMove.state) === "Posted" ? t("accounting.states.posted") : t("accounting.states.draft")}
                  </Badge>
                </div>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-3 gap-4">
                  <div><Label className="text-muted-foreground">{t("accounting.journalEntries.date")}</Label><p className="font-medium">{formatTimestamp(selectedMove.date)}</p></div>
                  <div><Label className="text-muted-foreground">{t("accounting.journalEntries.ref")}</Label><p className="font-medium">{selectedMove.ref ?? "—"}</p></div>
                  <div><Label className="text-muted-foreground">{t("accounting.journalEntries.type")}</Label><p className="font-medium">{stbEnumTag(selectedMove.moveType)}</p></div>
                </div>
                <div className="border rounded-lg">
                  <Table pagination={false}>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("accounting.journalEntries.partner")}</TableHead>
                        <TableHead className="text-right">{t("accounting.journalEntries.untaxed")}</TableHead>
                        <TableHead className="text-right">{t("accounting.forms.newInvoice.summary.tax")}</TableHead>
                        <TableHead className="text-right">{t("accounting.journalEntries.total")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell>{selectedMove.invoicePartnerDisplayName ?? `Partner #${selectedMove.partnerId}`}</TableCell>
                        <TableCell className="text-right">{formatCurrency(selectedMove.amountUntaxed ?? 0, selectedMove.currencyId)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(selectedMove.amountTax ?? 0, selectedMove.currencyId)}</TableCell>
                        <TableCell className="text-right font-bold">{formatMoveAmount(selectedMove)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                  <div className="flex justify-end gap-8 p-4 border-t bg-muted/30">
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">{t("accounting.journalEntries.residual")}</p>
                      <p className="text-lg font-bold">{formatCurrency(selectedMove.amountResidual ?? 0, selectedMove.currencyId)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">{t("accounting.journalEntries.payment")}</p>
                      <Badge variant="secondary">{String(selectedMove.paymentState)}</Badge>
                    </div>
                  </div>
                </div>
              </div>
              {selectedMove &&
                (onPostMove || onCancelMove || onComputeInvoiceTotals) && (
                  <DialogFooter className="gap-2 sm:gap-2">
                    {moveStateIsDraft(selectedMove.state) &&
                      moveTypeIsInvoiceOrRefund(selectedMove.moveType) &&
                      onComputeInvoiceTotals && (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={computeInvoiceTotalsPending}
                          onClick={() => onComputeInvoiceTotals(selectedMove)}
                        >
                          <Calculator className="h-4 w-4 mr-2" />
                          {t("accounting.journalEntries.recalculateInvoiceTotals")}
                        </Button>
                      )}
                    {stbEnumTag(selectedMove.state) === 'Draft' && onPostMove && (
                      <Button
                        type="button"
                        data-testid="general-ledger-post-move"
                        disabled={postMovePending}
                        onClick={() => onPostMove(selectedMove)}
                      >
                        {t("accounting.journalEntries.postEntry")}
                      </Button>
                    )}
                    {(stbEnumTag(selectedMove.state) === 'Draft' ||
                      stbEnumTag(selectedMove.state) === 'Posted') &&
                      onCancelMove && (
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={cancelMovePending}
                          onClick={() => onCancelMove(selectedMove)}
                        >
                          {t("accounting.journalEntries.cancelEntry")}
                        </Button>
                      )}
                  </DialogFooter>
                )}
            </>
          )}
        </DialogContent>
      </Dialog>

    </div>
  )
}
