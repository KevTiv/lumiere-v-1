"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table"
import { Plus, Trash2 } from "lucide-react"
import type { CreateAccountMoveParams } from "../lib/accounting-types"

interface LineItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
  taxRate: number
  discount: number
}

function calcLineTotal(item: LineItem) {
  const sub = item.quantity * item.unitPrice
  const disc = sub * (item.discount / 100)
  const tax = (sub - disc) * (item.taxRate / 100)
  return sub - disc + tax
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v)

interface CreateInvoiceModalProps {
  open: boolean
  onClose: () => void
  onSave?: (params: Partial<CreateAccountMoveParams>) => void
}

export function CreateInvoiceModal({ open, onClose, onSave }: CreateInvoiceModalProps) {
  const today = new Date().toISOString().split("T")[0]
  const [partnerName, setPartnerName] = useState("")
  const [invoiceDate, setInvoiceDate] = useState(today)
  const [dueDate, setDueDate] = useState("")
  const [notes, setNotes] = useState("")
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: "1", description: "", quantity: 1, unitPrice: 0, taxRate: 8, discount: 0 },
  ])

  const addLine = () =>
    setLineItems((prev) => [...prev, { id: String(Date.now()), description: "", quantity: 1, unitPrice: 0, taxRate: 8, discount: 0 }])

  const removeLine = (id: string) => {
    if (lineItems.length > 1) setLineItems((prev) => prev.filter((l) => l.id !== id))
  }

  const updateLine = (id: string, field: keyof LineItem, value: string | number) =>
    setLineItems((prev) => prev.map((l) => l.id === id ? { ...l, [field]: value } : l))

  const subtotal = lineItems.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
  const totalDisc = lineItems.reduce((s, l) => s + l.quantity * l.unitPrice * (l.discount / 100), 0)
  const totalTax = lineItems.reduce((s, l) => {
    const sub = l.quantity * l.unitPrice
    const disc = sub * (l.discount / 100)
    return s + (sub - disc) * (l.taxRate / 100)
  }, 0)
  const total = subtotal - totalDisc + totalTax

  const canSave = partnerName.trim() !== "" && lineItems.some((l) => l.description.trim() !== "")

  const handleSave = (asDraft: boolean) => {
    onSave?.({
      moveType: "OutInvoice",
      invoicePartnerDisplayName: partnerName,
      amountUntaxed: subtotal - totalDisc,
      amountTax: totalTax,
      amountTotal: total,
      amountResidual: total,
      metadata: JSON.stringify({ notes, lineItems, invoiceDate, dueDate }),
    } as unknown as Partial<CreateAccountMoveParams>)
    handleReset()
    onClose()
  }

  const handleReset = () => {
    setPartnerName("")
    setInvoiceDate(today)
    setDueDate("")
    setNotes("")
    setLineItems([{ id: "1", description: "", quantity: 1, unitPrice: 0, taxRate: 8, discount: 0 }])
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) { handleReset(); onClose() } }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Invoice</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Customer & Dates */}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Customer / Partner</Label>
              <Input
                placeholder="Customer name"
                value={partnerName}
                onChange={(e) => setPartnerName(e.target.value)}
              />
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Invoice Date</Label>
                  <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Due Date</Label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Line Items</Label>
              <Button variant="outline" size="sm" onClick={addLine} className="gap-2">
                <Plus className="h-4 w-4" />Add Item
              </Button>
            </div>
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[280px]">Description</TableHead>
                    <TableHead className="w-[80px]">Qty</TableHead>
                    <TableHead className="w-[120px]">Unit Price</TableHead>
                    <TableHead className="w-[80px]">Tax %</TableHead>
                    <TableHead className="w-[80px]">Disc %</TableHead>
                    <TableHead className="w-[120px] text-right">Total</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Input value={item.description} onChange={(e) => updateLine(item.id, "description", e.target.value)} placeholder="Item description" />
                      </TableCell>
                      <TableCell>
                        <Input type="number" min={1} value={item.quantity} onChange={(e) => updateLine(item.id, "quantity", parseInt(e.target.value) || 1)} />
                      </TableCell>
                      <TableCell>
                        <Input type="number" min={0} step={0.01} value={item.unitPrice} onChange={(e) => updateLine(item.id, "unitPrice", parseFloat(e.target.value) || 0)} />
                      </TableCell>
                      <TableCell>
                        <Input type="number" min={0} max={100} step={0.25} value={item.taxRate} onChange={(e) => updateLine(item.id, "taxRate", parseFloat(e.target.value) || 0)} />
                      </TableCell>
                      <TableCell>
                        <Input type="number" min={0} max={100} value={item.discount} onChange={(e) => updateLine(item.id, "discount", parseFloat(e.target.value) || 0)} />
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(calcLineTotal(item))}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => removeLine(item.id)} disabled={lineItems.length === 1} className="h-8 w-8 text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={5} className="text-right">Subtotal</TableCell>
                    <TableCell className="text-right">{formatCurrency(subtotal)}</TableCell>
                    <TableCell />
                  </TableRow>
                  {totalDisc > 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-right">Discount</TableCell>
                      <TableCell className="text-right text-red-600">-{formatCurrency(totalDisc)}</TableCell>
                      <TableCell />
                    </TableRow>
                  )}
                  <TableRow>
                    <TableCell colSpan={5} className="text-right">Tax</TableCell>
                    <TableCell className="text-right">{formatCurrency(totalTax)}</TableCell>
                    <TableCell />
                  </TableRow>
                  <TableRow className="bg-muted/50">
                    <TableCell colSpan={5} className="text-right font-bold">Total</TableCell>
                    <TableCell className="text-right font-bold text-lg">{formatCurrency(total)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes for the customer..." rows={3} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" onClick={() => handleSave(true)} disabled={!canSave}>Save as Draft</Button>
          <Button onClick={() => handleSave(false)} disabled={!canSave}>Create & Send</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
