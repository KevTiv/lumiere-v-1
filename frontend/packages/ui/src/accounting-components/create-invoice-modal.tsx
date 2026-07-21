"use client"

import { useLayoutEffect, useMemo, useState } from "react"
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
import { useTranslation } from "@lumiere/i18n"
import { useFormConfiguration } from "../forms/hooks/use-form-config"
import { isCustomField } from "../forms/config/types"

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

const EMPTY_JOURNAL_OPTIONS: Array<{ value: string; label: string }> = []

interface CreateInvoiceModalProps {
  open: boolean
  onClose: () => void
  onSave?: (params: Partial<CreateAccountMoveParams>) => void | Promise<void>
  /**
   * Journals from `/api/query/account-journals`. Pass an empty array when none exist —
   * save stays disabled until there is at least one journal (invoice moves require `journal_id`).
   */
  journalOptions?: Array<{ value: string; label: string }>
  /** When set, loads org form config custom fields (`custom:*`) for this form. */
  organizationId?: number
  formId?: string
}

export function CreateInvoiceModal({
  open,
  onClose,
  onSave,
  journalOptions,
  organizationId,
  formId = "new-invoice",
}: CreateInvoiceModalProps) {
  const { t } = useTranslation()
  const today = new Date().toISOString().split("T")[0]
  const [partnerName, setPartnerName] = useState("")
  const [invoiceDate, setInvoiceDate] = useState(today)
  const [dueDate, setDueDate] = useState("")
  const [notes, setNotes] = useState("")
  const [journalId, setJournalId] = useState("")
  const [customValues, setCustomValues] = useState<Record<string, string>>({})
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: "1", description: "", quantity: 1, unitPrice: 0, taxRate: 8, discount: 0 },
  ])
  const [saving, setSaving] = useState(false)

  const { config: formConfig } = useFormConfiguration({
    moduleId: "accounting",
    formId,
    organizationId: organizationId ?? 0,
    useDefaultIfMissing: true,
  })

  const customFields = useMemo(
    () =>
      (formConfig?.fields ?? []).filter(
        (f) => f.isEnabled && isCustomField(f.fieldId),
      ),
    [formConfig?.fields],
  )

  const journalList = journalOptions ?? EMPTY_JOURNAL_OPTIONS
  const hasJournals = journalList.length > 0

  /** Sync before paint so Submit is not stuck disabled while journals exist (avoids effect + disabled race). */
  useLayoutEffect(() => {
    if (!open) return
    if (!hasJournals) {
      setJournalId("")
      return
    }
    setJournalId((prev) =>
      prev !== "" && journalList.some((o) => o.value === prev) ? prev : journalList[0].value,
    )
  }, [open, hasJournals, journalList])

  const addLine = () =>
    setLineItems((prev) => [
      ...prev,
      { id: String(Date.now()), description: "", quantity: 1, unitPrice: 0, taxRate: 8, discount: 0 },
    ])

  const removeLine = (id: string) => {
    if (lineItems.length > 1) setLineItems((prev) => prev.filter((l) => l.id !== id))
  }

  const updateLine = (id: string, field: keyof LineItem, value: string | number) =>
    setLineItems((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)))

  const subtotal = lineItems.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
  const totalDisc = lineItems.reduce((s, l) => s + l.quantity * l.unitPrice * (l.discount / 100), 0)
  const totalTax = lineItems.reduce((s, l) => {
    const sub = l.quantity * l.unitPrice
    const disc = sub * (l.discount / 100)
    return s + (sub - disc) * (l.taxRate / 100)
  }, 0)
  const total = subtotal - totalDisc + totalTax

  const resolvedJournalId =
    journalId !== "" && journalList.some((o) => o.value === journalId)
      ? journalId
      : (journalList[0]?.value ?? "")

  const visibleCustomFields = useMemo(() => {
    return customFields.filter((f) => {
      const rule = f.visibleWhen
      if (!rule?.field) return true
      const fromCustom = customValues[rule.field]
      if (fromCustom !== undefined) return String(fromCustom) === String(rule.equals ?? "")
      if (rule.field === "partner" || rule.field === "invoicePartnerDisplayName") {
        return partnerName === String(rule.equals ?? "")
      }
      return String(rule.equals ?? "") === ""
    })
  }, [customFields, customValues, partnerName])

  const requiredCustomOk = visibleCustomFields.every((f) => {
    if (!f.validation.required) return true
    return String(customValues[f.fieldId] ?? "").trim() !== ""
  })

  const canSave =
    hasJournals &&
    resolvedJournalId !== "" &&
    partnerName.trim() !== "" &&
    lineItems.some((l) => l.description.trim() !== "") &&
    requiredCustomOk &&
    !saving

  const handleSave = async (asDraft: boolean) => {
    const customMeta = Object.fromEntries(
      visibleCustomFields
        .map((field) => [field.fieldId, customValues[field.fieldId]] as const)
        .filter(([, raw]) => raw != null && String(raw).trim() !== ""),
    )
    const metadata = JSON.stringify({
      notes,
      lineItems,
      invoiceDate,
      dueDate,
      ...customMeta,
    })
    setSaving(true)
    try {
      await onSave?.({
        type: asDraft ? "invoice-draft" : "invoice",
        moveType: "OutInvoice",
        invoicePartnerDisplayName: partnerName,
        amountUntaxed: subtotal - totalDisc,
        amountTax: totalTax,
        amountTotal: total,
        amountResidual: total,
        journalId: resolvedJournalId !== "" ? BigInt(resolvedJournalId) : undefined,
        metadata,
      } as unknown as Partial<CreateAccountMoveParams>)
      handleReset()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setPartnerName("")
    setInvoiceDate(today)
    setDueDate("")
    setNotes("")
    setJournalId("")
    setCustomValues({})
    setLineItems([{ id: "1", description: "", quantity: 1, unitPrice: 0, taxRate: 8, discount: 0 }])
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          handleReset()
          onClose()
        }
      }}
    >
      <DialogContent
        data-testid="create-invoice-modal"
        className="flex max-h-[90vh] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
      >
        <div className="shrink-0 space-y-2 px-4 pt-4">
          <DialogHeader>
            <DialogTitle>{t("accounting.forms.newInvoice.createTitle")}</DialogTitle>
          </DialogHeader>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
          {/* Customer & Dates */}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>{t("accounting.forms.newInvoice.fields.partner")}</Label>
              <Input
                data-testid="create-invoice-partner"
                placeholder={t("accounting.forms.newInvoice.fields.partnerPlaceholder")}
                value={partnerName}
                onChange={(e) => setPartnerName(e.target.value)}
              />
            </div>
            <div className="space-y-4">
              {hasJournals ? (
                <div className="space-y-2">
                  <Label>{t("accounting.forms.newInvoice.fields.journal")}</Label>
                  <Select value={resolvedJournalId} onValueChange={setJournalId}>
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={t("accounting.forms.newInvoice.fields.journalPlaceholder")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {journalList.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("accounting.forms.newInvoice.noJournalsHint")}
                </p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("accounting.forms.newInvoice.fields.invoiceDate")}</Label>
                  <Input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("accounting.forms.newInvoice.fields.dueDate")}</Label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          {visibleCustomFields.length > 0 ? (
            <div className="grid grid-cols-2 gap-4" data-testid="create-invoice-custom-fields">
              {visibleCustomFields.map((field) => (
                <div key={field.fieldId} className="space-y-2">
                  <Label>
                    {field.label}
                    {field.validation.required ? " *" : ""}
                  </Label>
                  <Input
                    data-testid={`create-invoice-custom-${field.fieldId}`}
                    value={customValues[field.fieldId] ?? ""}
                    onChange={(e) =>
                      setCustomValues((prev) => ({ ...prev, [field.fieldId]: e.target.value }))
                    }
                    placeholder={field.placeholder}
                  />
                </div>
              ))}
            </div>
          ) : null}

          {/* Line Items */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>{t("accounting.forms.newInvoice.lineItems")}</Label>
              <Button variant="outline" size="sm" onClick={addLine} className="gap-2">
                <Plus className="h-4 w-4" />
                {t("accounting.forms.newInvoice.addItem")}
              </Button>
            </div>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-70">
                      {t("accounting.forms.newInvoice.columns.description")}
                    </TableHead>
                    <TableHead className="w-20">
                      {t("accounting.forms.newInvoice.columns.qty")}
                    </TableHead>
                    <TableHead className="w-30">
                      {t("accounting.forms.newInvoice.columns.unitPrice")}
                    </TableHead>
                    <TableHead className="w-20">
                      {t("accounting.forms.newInvoice.columns.taxPercent")}
                    </TableHead>
                    <TableHead className="w-20">
                      {t("accounting.forms.newInvoice.columns.discountPercent")}
                    </TableHead>
                    <TableHead className="w-30 text-right">
                      {t("accounting.forms.newInvoice.columns.total")}
                    </TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Input
                          data-testid={
                            item.id === lineItems[0]?.id ? "create-invoice-line-description" : undefined
                          }
                          value={item.description}
                          onChange={(e) => updateLine(item.id, "description", e.target.value)}
                          placeholder={t("accounting.forms.newInvoice.columns.description")}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(e) =>
                            updateLine(item.id, "quantity", parseInt(e.target.value) || 1)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          data-testid={
                            item.id === lineItems[0]?.id ? "create-invoice-line-unit-price" : undefined
                          }
                          value={item.unitPrice}
                          onChange={(e) =>
                            updateLine(item.id, "unitPrice", parseFloat(e.target.value) || 0)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step={0.25}
                          value={item.taxRate}
                          onChange={(e) =>
                            updateLine(item.id, "taxRate", parseFloat(e.target.value) || 0)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={item.discount}
                          onChange={(e) =>
                            updateLine(item.id, "discount", parseFloat(e.target.value) || 0)
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(calcLineTotal(item))}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeLine(item.id)}
                          disabled={lineItems.length === 1}
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={5} className="text-right">
                      {t("accounting.forms.newInvoice.summary.subtotal")}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(subtotal)}</TableCell>
                    <TableCell />
                  </TableRow>
                  {totalDisc > 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-right">
                        {t("accounting.forms.newInvoice.summary.discount")}
                      </TableCell>
                      <TableCell className="text-right text-destructive">
                        -{formatCurrency(totalDisc)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  )}
                  <TableRow>
                    <TableCell colSpan={5} className="text-right">
                      {t("accounting.forms.newInvoice.summary.tax")}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(totalTax)}</TableCell>
                    <TableCell />
                  </TableRow>
                  <TableRow className="bg-muted/50">
                    <TableCell colSpan={5} className="text-right font-bold">
                      {t("accounting.forms.newInvoice.summary.total")}
                    </TableCell>
                    <TableCell className="text-right text-lg font-bold">
                      {formatCurrency(total)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>{t("accounting.forms.newInvoice.notesOptional")}</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("accounting.forms.newInvoice.notesForCustomer")}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            data-testid="create-invoice-save-draft"
            variant="secondary"
            onClick={() => void handleSave(true)}
            disabled={!canSave}
          >
            {t("accounting.forms.newInvoice.saveDraft")}
          </Button>
          <Button
            data-testid="create-invoice-submit"
            onClick={() => void handleSave(false)}
            disabled={!canSave}
          >
            {t("accounting.forms.newInvoice.createAndSend")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
