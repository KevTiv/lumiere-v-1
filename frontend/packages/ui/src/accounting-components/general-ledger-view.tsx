"use client"

import { useMemo, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
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
  DialogDescription,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Search, Plus, Upload, Calculator, X } from "lucide-react"
import type { AccountMove } from "../lib/accounting-types"
import {
  moveStateIsDraft,
  moveTypeIsInvoiceOrRefund,
  stbEnumTag,
} from "../lib/accounting-move-utils"
import { getRowField } from "../lib/entity-row-utils"
import { useCurrencyFormat } from "../lib/currency-context"
import {
  useClearModuleUrlFilter,
  useModuleUrlFilters,
} from "../lib/module-url-filters"
import { useTranslation } from "@lumiere/i18n"
import type { RowValueMap } from "@lumiere/erp-shared/row-values"
import { TablePager, usePagedRows } from "../components/table-pager"
import {
  entityScalarText,
  formatEntityReference,
  formatTimestampLike,
} from "../lib/entity-row-values"
import {
  accountingMovePartner,
  accountingMovePayment,
  accountingMoveState,
  accountingMoveType,
} from "./accounting-move-display"

type LedgerMoveLine = {
  id?: AccountMove["id"] | null
  accountId?: AccountMove["id"] | null
  name?: string | null
  moveId?: AccountMove["id"] | null
  companyId?: AccountMove["companyId"] | null
  companyCurrencyId?: AccountMove["currencyId"] | null
  debit?: number | null
  credit?: number | null
}

interface GeneralLedgerViewProps {
  moves: AccountMove[]
  moveLines?: LedgerMoveLine[]
  partnerLabels?: ReadonlyMap<string, string>
  accountLabels?: ReadonlyMap<string, string>
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
  partnerLabels,
  accountLabels,
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
  const formatTimestamp = (value: unknown): string => {
    const date = formatTimestampLike(value)
    return date ? currency.date(date.getTime()) : "—"
  }
  const formatCurrency = (
    value: number | null | undefined,
    currencyId?: unknown,
  ): string =>
    value != null && Number.isFinite(value)
      ? currency.money(value, currencyId)
      : "—"
  const urlFilters = useModuleUrlFilters()
  const clearUrlFilter = useClearModuleUrlFilter()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedMoveId, setSelectedMoveId] = useState<
    AccountMove["id"] | null
  >(null)
  const moveTrigger = useRef<HTMLButtonElement | null>(null)
  const selectedMove =
    selectedMoveId == null
      ? null
      : (moves.find((move) => move.id === selectedMoveId) ?? null)
  const linesByMove = useMemo(() => {
    const grouped = new Map<string, LedgerMoveLine[]>()
    for (const line of moveLines ?? []) {
      if (line.companyId == null || line.moveId == null) continue
      const key = `${line.companyId}:${line.moveId}`
      const group = grouped.get(key)
      if (group) group.push(line)
      else grouped.set(key, [line])
    }
    return grouped
  }, [moveLines])
  const amountFor = (move: AccountMove) => {
    if (stbEnumTag(move.moveType) !== "Entry") {
      return move.amountTotal != null && Number.isFinite(move.amountTotal)
        ? { amount: move.amountTotal, currencyId: move.currencyId }
        : null
    }
    const lines = linesByMove.get(`${move.companyId}:${move.id}`)
    const companyCurrencyId = lines?.[0]?.companyCurrencyId
    if (
      !lines?.length ||
      move.companyId == null ||
      companyCurrencyId == null ||
      lines.some(
        (line) =>
          String(line.companyCurrencyId) !== String(companyCurrencyId) ||
          !Number.isFinite(line.debit) ||
          !Number.isFinite(line.credit),
      )
    ) {
      return null
    }
    const debit = lines.reduce((total, line) => total + line.debit!, 0)
    const credit = lines.reduce((total, line) => total + line.credit!, 0)
    return Math.abs(debit - credit) <= 0.01
      ? { amount: debit, currencyId: companyCurrencyId }
      : null
  }
  const formatMoveAmount = (move: AccountMove) => {
    const value = amountFor(move)
    return value ? formatCurrency(value.amount, value.currencyId) : "—"
  }

  const activeUrlFilters = Object.entries(urlFilters).filter(
    ([, value]) => value && value !== "__all__",
  )
  const query = searchQuery.trim().toLowerCase()
  const filtered = moves.filter((m) => {
    const matchesSearch = [m.name, m.ref].some((value) =>
      (value ?? "").toLowerCase().includes(query),
    )
    const row = m as unknown as RowValueMap
    const matchesUrlFilters = activeUrlFilters.every(([key, value]) => {
      const field = getRowField(row, key)
      const actual = stbEnumTag(field) || entityScalarText(field)
      return (
        actual?.toLowerCase() === (stbEnumTag(value) || value).toLowerCase()
      )
    })
    return matchesSearch && matchesUrlFilters
  })

  const stats = {
    total: filtered.length,
    posted: filtered.filter((m) => stbEnumTag(m.state) === "Posted").length,
    pending: filtered.filter((m) => stbEnumTag(m.state) === "Draft").length,
  }

  const movesPager = usePagedRows(filtered)
  const selected = selectedMove && {
    state: accountingMoveState(selectedMove.state, t),
    type: accountingMoveType(selectedMove.moveType, t),
    draft: moveStateIsDraft(selectedMove.state),
    cancellable:
      ["Draft", "Posted"].includes(stbEnumTag(selectedMove.state)) &&
      Boolean(onCancelMove),
    paymentApplies: moveTypeIsInvoiceOrRefund(selectedMove.moveType),
    partner: accountingMovePartner(selectedMove, t, partnerLabels),
    lines:
      linesByMove.get(`${selectedMove.companyId}:${selectedMove.id}`) ?? [],
  }
  return (
    <div className="min-w-0 space-y-6" data-testid="entity-table">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{t("accounting.journalEntries.title")}</CardTitle>
            <div className="flex min-w-0 flex-wrap gap-2 [&_button]:h-auto [&_button]:min-h-8 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:text-left">
              {onImportMovesCsv ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onImportMovesCsv}
                  className="gap-2"
                >
                  <Upload className="h-4 w-4" />
                  {t("accounting.csvImport.toolbarMoves")}
                </Button>
              ) : null}
              {onImportOutstandingDocumentsCsv ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onImportOutstandingDocumentsCsv}
                  className="gap-2"
                >
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
                  {t(
                    "accounting.csvImport.toolbarHistoricalDocumentsForPaymentReplay",
                  )}
                </Button>
              ) : null}
              {onImportMoveLinesCsv ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onImportMoveLinesCsv}
                  className="gap-2"
                >
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
            <Input
              aria-label={t("accounting.journalEntries.searchPlaceholder")}
              placeholder={t("accounting.journalEntries.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            {[
              [
                t("accounting.journalEntries.entriesInView", {
                  defaultValue: "Entries in this view",
                }),
                stats.total,
              ],
              [t("accounting.states.posted"), stats.posted],
              [t("accounting.states.draft"), stats.pending],
            ].map(([label, count]) => (
              <div key={label} className="flex items-baseline gap-1.5">
                <dt>{label}</dt>
                <dd className="font-medium tabular-nums text-foreground">
                  {count}
                </dd>
              </div>
            ))}
          </dl>
        </CardHeader>
        <CardContent>
          <Table pagination={false}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[24%]">
                  {t("accounting.journalEntries.entryNumber")}
                </TableHead>
                <TableHead>{t("accounting.journalEntries.date")}</TableHead>
                <TableHead className="w-[25%]">
                  {t("accounting.journalEntries.ref")}
                </TableHead>
                <TableHead>{t("accounting.journalEntries.type")}</TableHead>
                <TableHead className="text-right">
                  {t("accounting.journalEntries.total")}
                </TableHead>
                <TableHead>{t("accounting.journalEntries.state")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {t("accounting.journalEntries.noResults")}
                  </TableCell>
                </TableRow>
              ) : (
                movesPager.pageRows.map((move) => {
                  const state = accountingMoveState(move.state, t)
                  return (
                    <TableRow
                      key={String(move.id)}
                      data-testid={`entity-row-${move.id}`}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={(event) => {
                        moveTrigger.current =
                          event.currentTarget.querySelector("button")
                        setSelectedMoveId(move.id)
                      }}
                    >
                      <TableCell className="whitespace-normal [overflow-wrap:anywhere]">
                        <button
                          type="button"
                          className="min-h-8 text-left font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                          onClick={(event) => {
                            event.stopPropagation()
                            moveTrigger.current = event.currentTarget
                            setSelectedMoveId(move.id)
                          }}
                        >
                          {move.name || `#${move.id}`}
                        </button>
                      </TableCell>
                      <TableCell>{formatTimestamp(move.date)}</TableCell>
                      <TableCell className="whitespace-normal text-muted-foreground [overflow-wrap:anywhere]">
                        {move.ref || "—"}
                      </TableCell>
                      <TableCell className="whitespace-normal text-muted-foreground">
                        {accountingMoveType(move.moveType, t)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoveAmount(move)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={state.variant}>{state.label}</Badge>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
          <TablePager {...movesPager} />
        </CardContent>
      </Card>

      {/* Entry Detail Dialog */}
      <Dialog
        open={!!selectedMove}
        onOpenChange={(open) => {
          if (!open) setSelectedMoveId(null)
        }}
      >
        <DialogContent
          size="review"
          finalFocus={moveTrigger}
          className="flex flex-col overflow-hidden"
        >
          {selectedMove && selected && (
            <>
              <DialogHeader className="min-w-0 shrink-0">
                <DialogTitle className="text-lg leading-snug [overflow-wrap:anywhere]">
                  {selectedMove.name || `#${selectedMove.id}`}
                </DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-2">
                  <span>{selected.type}</span>
                  <Badge variant={selected.state.variant}>
                    {selected.state.label}
                  </Badge>
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 overflow-y-auto">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t py-4 sm:grid-cols-3">
                  <LedgerDetail
                    label={t("accounting.journalEntries.date")}
                    value={formatTimestamp(selectedMove.date)}
                  />
                  <LedgerDetail
                    label={t("accounting.journalEntries.ref")}
                    value={selectedMove.ref || "—"}
                  />
                  <LedgerDetail
                    label={t("accounting.journalEntries.partner")}
                    value={selected.partner}
                  />
                </dl>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-3">
                  {selected.paymentApplies ? (
                    <>
                      <LedgerDetail
                        label={t("accounting.journalEntries.untaxed")}
                        value={formatCurrency(
                          selectedMove.amountUntaxed,
                          selectedMove.currencyId,
                        )}
                        amount
                      />
                      <LedgerDetail
                        label={t("accounting.forms.newInvoice.summary.tax")}
                        value={formatCurrency(
                          selectedMove.amountTax,
                          selectedMove.currencyId,
                        )}
                        amount
                      />
                    </>
                  ) : null}
                  <LedgerDetail
                    label={t("accounting.journalEntries.total")}
                    value={formatMoveAmount(selectedMove)}
                    amount
                  />
                  {selected.paymentApplies ? (
                    <>
                      <LedgerDetail
                        label={t("accounting.journalEntries.residual")}
                        value={formatCurrency(
                          selectedMove.amountResidual,
                          selectedMove.currencyId,
                        )}
                        amount
                      />
                      <LedgerDetail
                        label={t("accounting.journalEntries.payment")}
                        value={accountingMovePayment(
                          selectedMove.paymentState,
                          t,
                        )}
                      />
                    </>
                  ) : null}
                </dl>
                {selected.lines.length > 0 ? (
                  <section
                    aria-labelledby="ledger-entry-lines"
                    className="mt-4 min-w-0 space-y-2"
                  >
                    <h3 id="ledger-entry-lines" className="font-medium">
                      {t("accounting.tabs.moveLines")}
                    </h3>
                    <Table aria-labelledby="ledger-entry-lines">
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            {t(
                              "accounting.entities.moveLines.columns.accountId",
                            )}
                          </TableHead>
                          <TableHead>
                            {t("accounting.entities.moveLines.columns.name")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("accounting.entities.moveLines.columns.debit")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("accounting.entities.moveLines.columns.credit")}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selected.lines.map((line, index) => (
                          <TableRow
                            key={line.id != null ? String(line.id) : index}
                          >
                            <TableCell className="min-w-28 whitespace-normal [overflow-wrap:anywhere]">
                              {formatEntityReference(line.accountId, {
                                labels: accountLabels,
                              })}
                            </TableCell>
                            <TableCell className="min-w-28 whitespace-normal [overflow-wrap:anywhere]">
                              {line.name || "—"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(
                                line.debit,
                                line.companyCurrencyId,
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(
                                line.credit,
                                line.companyCurrencyId,
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </section>
                ) : null}
              </div>
              {(selected.draft &&
                (onPostMove ||
                  (selected.paymentApplies && onComputeInvoiceTotals))) ||
              selected.cancellable ? (
                <DialogFooter className="shrink-0 flex-col sm:flex-row sm:flex-wrap [&_button]:h-auto [&_button]:min-h-8 [&_button]:whitespace-normal">
                  {selected.draft &&
                  selected.paymentApplies &&
                  onComputeInvoiceTotals ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={computeInvoiceTotalsPending}
                      onClick={() => onComputeInvoiceTotals(selectedMove)}
                    >
                      <Calculator className="size-4" />
                      {t("accounting.journalEntries.recalculateInvoiceTotals")}
                    </Button>
                  ) : null}
                  {selected.cancellable && onCancelMove ? (
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={cancelMovePending}
                      onClick={() => onCancelMove(selectedMove)}
                    >
                      {t("accounting.journalEntries.cancelEntryAction", {
                        defaultValue: "Cancel entry",
                      })}
                    </Button>
                  ) : null}
                  {selected.draft && onPostMove ? (
                    <Button
                      type="button"
                      data-testid="general-ledger-post-move"
                      disabled={postMovePending}
                      onClick={() => onPostMove(selectedMove)}
                    >
                      {t("accounting.journalEntries.postEntry")}
                    </Button>
                  ) : null}
                </DialogFooter>
              ) : null}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function LedgerDetail({
  label,
  value,
  amount = false,
}: {
  label: string
  value: string
  amount?: boolean
}) {
  return (
    <div className={amount ? "min-w-0 text-right" : "min-w-0"}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          amount
            ? "font-medium tabular-nums [overflow-wrap:anywhere]"
            : "font-medium [overflow-wrap:anywhere]"
        }
      >
        {value}
      </dd>
    </div>
  )
}
