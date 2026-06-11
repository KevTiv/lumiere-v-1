"use client"

import { useState } from "react"
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
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Search,
  Plus,
  Eye,
  CheckCircle2,
  Clock,
  FileText,
  ArrowUpRight,
  Trash2,
  Upload,
  Calculator,
} from "lucide-react"
import type { AccountMove } from "../lib/accounting-types"
import { moveStateIsDraft, moveTypeIsInvoiceOrRefund } from "../lib/accounting-move-utils"
import { useTranslation } from "@lumiere/i18n"

function formatTimestamp(ts?: { microsSinceUnixEpoch: bigint } | null): string {
  if (!ts) return "—"
  const ms = Number(ts.microsSinceUnixEpoch) / 1000
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v)

interface EntryLine {
  id: string
  accountId: string
  description: string
  debit: number
  credit: number
}

function moveStateStr(state: unknown): string {
  if (state != null && typeof state === 'object' && 'tag' in state) {
    return String((state as { tag: string }).tag)
  }
  return String(state ?? '')
}

interface GeneralLedgerViewProps {
  moves: AccountMove[]
  onCreate?: (data: Record<string, unknown>) => void
  onImportMovesCsv?: () => void
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
  onCreate,
  onImportMovesCsv,
  onImportMoveLinesCsv,
  onPostMove,
  onCancelMove,
  onComputeInvoiceTotals,
  postMovePending,
  cancelMovePending,
  computeInvoiceTotalsPending,
}: GeneralLedgerViewProps) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedMove, setSelectedMove] = useState<AccountMove | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newLines, setNewLines] = useState<EntryLine[]>([
    { id: "1", accountId: "", description: "", debit: 0, credit: 0 },
    { id: "2", accountId: "", description: "", debit: 0, credit: 0 },
  ])

  const filtered = moves.filter((m) => {
    const name = m?.name?.toLowerCase() ?? ""
    const ref = String(m?.ref)?.toLowerCase() ?? ""
    return name.includes(searchQuery.toLowerCase()) || ref.includes(searchQuery.toLowerCase())
  })

  const stats = {
    total: moves.length,
    posted: moves.filter((m) => String(m.state) === "Posted").length,
    pending: moves.filter((m) => String(m.state) === "Draft").length,
    totalMovement: moves.reduce((s, m) => s + m.amountTotal, 0),
  }

  const addLine = () =>
    setNewLines((prev) => [...prev, { id: String(Date.now()), accountId: "", description: "", debit: 0, credit: 0 }])

  const removeLine = (id: string) => {
    if (newLines.length > 2) setNewLines((prev) => prev.filter((l) => l.id !== id))
  }

  const updateLine = (id: string, field: keyof EntryLine, value: string | number) =>
    setNewLines((prev) => prev.map((l) => l.id === id ? { ...l, [field]: value } : l))

  const totalDebits = newLines.reduce((s, l) => s + l.debit, 0)
  const totalCredits = newLines.reduce((s, l) => s + l.credit, 0)
  const isBalanced = totalDebits === totalCredits && totalDebits > 0

  return (
    <div className="space-y-6">
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
            <div><p className="text-sm text-muted-foreground">{t("accounting.journalEntries.totalMovement")}</p><p className="text-2xl font-bold">{formatCurrency(stats.totalMovement)}</p></div>
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
              {onImportMoveLinesCsv ? (
                <Button type="button" variant="outline" onClick={onImportMoveLinesCsv} className="gap-2">
                  <Upload className="h-4 w-4" />
                  {t("accounting.csvImport.toolbarMoveLines")}
                </Button>
              ) : null}
              <Button onClick={() => setShowCreateModal(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                {t("accounting.actions.newEntry")}
              </Button>
            </div>
          </div>
          <div className="relative mt-4 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder={t("accounting.journalEntries.searchPlaceholder")} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
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
              ) : filtered.map((move) => {
                const isPosted = String(move.state) === "Posted"
                return (
                  <TableRow key={String(move.id)} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedMove(move)}>
                    <TableCell className="font-mono font-medium">{move.name}</TableCell>
                    <TableCell>{formatTimestamp(move.date)}</TableCell>
                    <TableCell>
                      {move.ref && <Badge variant="outline" className="text-xs">{move.ref}</Badge>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{String(move.moveType)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(move.amountTotal)}</TableCell>
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
                  <Badge variant={String(selectedMove.state) === "Posted" ? "default" : "secondary"}>
                    {String(selectedMove.state) === "Posted" ? t("accounting.states.posted") : t("accounting.states.draft")}
                  </Badge>
                </div>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-3 gap-4">
                  <div><Label className="text-muted-foreground">{t("accounting.journalEntries.date")}</Label><p className="font-medium">{formatTimestamp(selectedMove.date)}</p></div>
                  <div><Label className="text-muted-foreground">{t("accounting.journalEntries.ref")}</Label><p className="font-medium">{selectedMove.ref ?? "—"}</p></div>
                  <div><Label className="text-muted-foreground">{t("accounting.journalEntries.type")}</Label><p className="font-medium">{String(selectedMove.moveType)}</p></div>
                </div>
                <div className="border rounded-lg">
                  <Table>
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
                        <TableCell className="text-right">{formatCurrency(selectedMove.amountUntaxed)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(selectedMove.amountTax)}</TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(selectedMove.amountTotal)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                  <div className="flex justify-end gap-8 p-4 border-t bg-muted/30">
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">{t("accounting.journalEntries.residual")}</p>
                      <p className="text-lg font-bold">{formatCurrency(selectedMove.amountResidual)}</p>
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
                    {moveStateStr(selectedMove.state) === 'Draft' && onPostMove && (
                      <Button
                        type="button"
                        disabled={postMovePending}
                        onClick={() => onPostMove(selectedMove)}
                      >
                        {t("accounting.journalEntries.postEntry")}
                      </Button>
                    )}
                    {(moveStateStr(selectedMove.state) === 'Draft' ||
                      moveStateStr(selectedMove.state) === 'Posted') &&
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

      {/* Create Entry Dialog */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{t("accounting.forms.newJournalEntry.createTitle")}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("accounting.journalEntries.date")}</Label>
                <Input type="date" defaultValue={new Date().toISOString().split("T")[0]} />
              </div>
              <div className="space-y-2">
                <Label>{t("accounting.forms.newJournalEntry.refOptional")}</Label>
                <Input placeholder="e.g., INV-001" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("accounting.forms.newJournalEntry.fields.notes")}</Label>
              <Input placeholder={t("accounting.forms.newJournalEntry.descriptionPlaceholder")} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>{t("accounting.forms.newJournalEntry.entryLines")}</Label>
                <Button variant="outline" size="sm" onClick={addLine} className="gap-2">
                  <Plus className="h-4 w-4" />{t("accounting.forms.newJournalEntry.addLine")}
                </Button>
              </div>
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("accounting.forms.newJournalEntry.columns.description")}</TableHead>
                      <TableHead className="w-32.5">{t("accounting.forms.newJournalEntry.columns.debit")}</TableHead>
                      <TableHead className="w-32.5">{t("accounting.forms.newJournalEntry.columns.credit")}</TableHead>
                      <TableHead className="w-12.5"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {newLines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>
                          <Input value={line.description} onChange={(e) => updateLine(line.id, "description", e.target.value)} placeholder={t("accounting.forms.newJournalEntry.linePlaceholder")} />
                        </TableCell>
                        <TableCell>
                          <Input type="number" min={0} step={0.01} value={line.debit || ""}
                            onChange={(e) => { updateLine(line.id, "debit", parseFloat(e.target.value) || 0); if (parseFloat(e.target.value) > 0) updateLine(line.id, "credit", 0) }}
                            placeholder="0.00" />
                        </TableCell>
                        <TableCell>
                          <Input type="number" min={0} step={0.01} value={line.credit || ""}
                            onChange={(e) => { updateLine(line.id, "credit", parseFloat(e.target.value) || 0); if (parseFloat(e.target.value) > 0) updateLine(line.id, "debit", 0) }}
                            placeholder="0.00" />
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => removeLine(line.id)} disabled={newLines.length <= 2} className="h-8 w-8 text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex justify-end gap-8 p-4 border-t bg-muted/30">
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">{t("accounting.forms.newJournalEntry.summary.totalDebits")}</p>
                    <p className="text-lg font-bold text-success">{formatCurrency(totalDebits)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">{t("accounting.forms.newJournalEntry.summary.totalCredits")}</p>
                    <p className="text-lg font-bold text-destructive">{formatCurrency(totalCredits)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">{t("accounting.forms.newJournalEntry.summary.difference")}</p>
                    <Badge variant={isBalanced ? "default" : "destructive"}>
                      {isBalanced ? t("accounting.forms.newJournalEntry.summary.balanced") : formatCurrency(Math.abs(totalDebits - totalCredits))}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>{t("common.cancel")}</Button>
            <Button variant="secondary" disabled={!isBalanced}>{t("accounting.forms.newJournalEntry.saveDraft")}</Button>
            <Button disabled={!isBalanced} onClick={() => { onCreate?.({}); setShowCreateModal(false) }}>{t("accounting.forms.postMove.submitLabel")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
