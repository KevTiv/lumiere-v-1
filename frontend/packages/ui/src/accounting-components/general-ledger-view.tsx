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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Search,
  Plus,
  Eye,
  CheckCircle2,
  Clock,
  FileText,
  ArrowUpRight,
  Trash2,
} from "lucide-react"
import type { AccountMove } from "../lib/accounting-types"

function formatTimestamp(ts?: { microsSinceUnixEpoch: bigint } | null): string {
  if (!ts) return "—"
  const ms = Number(ts.microsSinceUnixEpoch / 1000n)
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

interface GeneralLedgerViewProps {
  moves: AccountMove[]
  onCreate?: (data: Record<string, unknown>) => void
}

export function GeneralLedgerView({ moves, onCreate }: GeneralLedgerViewProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedMove, setSelectedMove] = useState<AccountMove | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newLines, setNewLines] = useState<EntryLine[]>([
    { id: "1", accountId: "", description: "", debit: 0, credit: 0 },
    { id: "2", accountId: "", description: "", debit: 0, credit: 0 },
  ])

  const filtered = moves.filter((m) => {
    const name = m.name?.toLowerCase() ?? ""
    const ref = m.ref?.toLowerCase() ?? ""
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
            <div className="p-2 rounded-lg bg-blue-500/10"><FileText className="h-5 w-5 text-blue-600" /></div>
            <div><p className="text-sm text-muted-foreground">Total Entries</p><p className="text-2xl font-bold">{stats.total}</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10"><CheckCircle2 className="h-5 w-5 text-emerald-600" /></div>
            <div><p className="text-sm text-muted-foreground">Posted</p><p className="text-2xl font-bold">{stats.posted}</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10"><Clock className="h-5 w-5 text-amber-600" /></div>
            <div><p className="text-sm text-muted-foreground">Draft</p><p className="text-2xl font-bold">{stats.pending}</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10"><ArrowUpRight className="h-5 w-5 text-purple-600" /></div>
            <div><p className="text-sm text-muted-foreground">Total Movement</p><p className="text-2xl font-bold">{formatCurrency(stats.totalMovement)}</p></div>
          </div>
        </CardContent></Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle>Journal Entries</CardTitle>
            <Button onClick={() => setShowCreateModal(true)} className="gap-2"><Plus className="h-4 w-4" />New Entry</Button>
          </div>
          <div className="relative mt-4 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search entries..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entry #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No journal entries found</TableCell></TableRow>
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
                        {isPosted ? <><CheckCircle2 className="h-3 w-3" />Posted</> : <><Clock className="h-3 w-3" />Draft</>}
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
                    {String(selectedMove.state) === "Posted" ? "Posted" : "Draft"}
                  </Badge>
                </div>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-3 gap-4">
                  <div><Label className="text-muted-foreground">Date</Label><p className="font-medium">{formatTimestamp(selectedMove.date)}</p></div>
                  <div><Label className="text-muted-foreground">Reference</Label><p className="font-medium">{selectedMove.ref ?? "—"}</p></div>
                  <div><Label className="text-muted-foreground">Type</Label><p className="font-medium">{String(selectedMove.moveType)}</p></div>
                </div>
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Partner</TableHead>
                        <TableHead className="text-right">Untaxed</TableHead>
                        <TableHead className="text-right">Tax</TableHead>
                        <TableHead className="text-right">Total</TableHead>
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
                      <p className="text-sm text-muted-foreground">Residual</p>
                      <p className="text-lg font-bold">{formatCurrency(selectedMove.amountResidual)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Payment</p>
                      <Badge variant="secondary">{String(selectedMove.paymentState)}</Badge>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Entry Dialog */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Create Journal Entry</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" defaultValue={new Date().toISOString().split("T")[0]} />
              </div>
              <div className="space-y-2">
                <Label>Reference (optional)</Label>
                <Input placeholder="e.g., INV-001" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input placeholder="Brief description of the entry" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Entry Lines</Label>
                <Button variant="outline" size="sm" onClick={addLine} className="gap-2">
                  <Plus className="h-4 w-4" />Add Line
                </Button>
              </div>
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead className="w-[130px]">Debit</TableHead>
                      <TableHead className="w-[130px]">Credit</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {newLines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>
                          <Input value={line.description} onChange={(e) => updateLine(line.id, "description", e.target.value)} placeholder="Line description" />
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
                    <p className="text-sm text-muted-foreground">Total Debits</p>
                    <p className="text-lg font-bold text-emerald-600">{formatCurrency(totalDebits)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Total Credits</p>
                    <p className="text-lg font-bold text-red-600">{formatCurrency(totalCredits)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Difference</p>
                    <Badge variant={isBalanced ? "default" : "destructive"}>
                      {isBalanced ? "Balanced" : formatCurrency(Math.abs(totalDebits - totalCredits))}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button variant="secondary" disabled={!isBalanced}>Save as Draft</Button>
            <Button disabled={!isBalanced} onClick={() => { onCreate?.({}); setShowCreateModal(false) }}>Post Entry</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
