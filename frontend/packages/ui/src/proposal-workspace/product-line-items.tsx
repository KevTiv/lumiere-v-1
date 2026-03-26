"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Trash2, GripVertical } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { ProposalLineItem } from "@lumiere/stdb"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Product = Record<string, any>

const TYPE_BADGE: Record<string, string> = {
  Service: "bg-blue-100 text-blue-700",
  Product: "bg-green-100 text-green-700",
  Storable: "bg-amber-100 text-amber-700",
  Consumable: "bg-purple-100 text-purple-700",
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val)
}

interface ProductLineItemsProps {
  items: ProposalLineItem[]
  products: Product[]
  onUpdate: (id: bigint, quantity: number, priceUnit: number, discount: number, notes?: string) => void
  onDelete: (id: bigint) => void
}

interface LineItemRowProps {
  item: ProposalLineItem
  product: Product | undefined
  onUpdate: ProductLineItemsProps["onUpdate"]
  onDelete: ProductLineItemsProps["onDelete"]
}

function LineItemRow({ item, product, onUpdate, onDelete }: LineItemRowProps) {
  const { t } = useTranslation()
  const [qty, setQty] = useState(item.quantity ?? 1)
  const [price, setPrice] = useState(item.priceUnit ?? 0)
  const [discount, setDiscount] = useState(item.discount ?? 0)
  const [notes, setNotes] = useState(item.notes ?? "")
  const [expanded, setExpanded] = useState(false)

  const subtotal = qty * price * (1 - discount / 100)
  const productType = product?.type_ ?? product?.type ?? ""
  const typeBadgeClass = TYPE_BADGE[productType] ?? "bg-muted text-muted-foreground"

  const handleSave = () => {
    onUpdate(item.id, qty, price, discount, notes || undefined)
  }

  return (
    <div className="rounded-md border border-border bg-background group">
      <div className="flex items-center gap-2 px-3 py-2">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 cursor-grab" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium truncate">{item.productName}</span>
            {productType && (
              <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", typeBadgeClass)}>
                {productType}
              </span>
            )}
          </div>
        </div>

        {/* Qty */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] text-muted-foreground">{t("proposalWorkspace.productLineItems.qty")}</span>
          <input
            type="number"
            min={0}
            step={0.01}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            onBlur={handleSave}
            className="w-14 text-xs text-right border border-border rounded px-1.5 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Unit price */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] text-muted-foreground">{t("proposalWorkspace.productLineItems.unitPrice")}</span>
          <input
            type="number"
            min={0}
            step={0.01}
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            onBlur={handleSave}
            className="w-20 text-xs text-right border border-border rounded px-1.5 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Subtotal */}
        <span className="text-xs font-semibold text-foreground shrink-0 w-20 text-right">
          {formatCurrency(subtotal)}
        </span>

        {/* Expand / delete */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1"
          >
            {expanded ? t("proposalWorkspace.productLineItems.collapse") : t("proposalWorkspace.productLineItems.expand")}
          </button>
          <button
            onClick={() => onDelete(item.id)}
            className="p-0.5 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors opacity-0 group-hover:opacity-100"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Expanded row: discount + notes */}
      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-16 shrink-0">{t("proposalWorkspace.productLineItems.discountPercent")}</span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={discount}
              onChange={(e) => setDiscount(Number(e.target.value))}
              onBlur={handleSave}
              className="w-16 text-xs text-right border border-border rounded px-1.5 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {discount > 0 && (
              <span className="text-[10px] text-muted-foreground">
                = {formatCurrency(subtotal)} ({t("proposalWorkspace.productLineItems.saved", { amount: formatCurrency(qty * price * discount / 100) })})
              </span>
            )}
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[10px] text-muted-foreground w-16 shrink-0 pt-1">{t("proposalWorkspace.productLineItems.notes")}</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={handleSave}
              rows={2}
              placeholder={t("proposalWorkspace.productLineItems.additionalNotes")}
              className="flex-1 text-xs border border-border rounded px-1.5 py-0.5 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
      )}
    </div>
  )
}

export function ProductLineItems({ items, products, onUpdate, onDelete }: ProductLineItemsProps) {
  const { t } = useTranslation()
  if (items.length === 0) return null

  const total = items.reduce((sum, item) => {
    const subtotal = (item.quantity ?? 1) * (item.priceUnit ?? 0) * (1 - (item.discount ?? 0) / 100)
    return sum + subtotal
  }, 0)

  return (
    <div className="mt-3 space-y-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-muted-foreground">{t("proposalWorkspace.productLineItems.productsAndServices")}</span>
        <span className="text-xs font-semibold text-foreground">{formatCurrency(total)}</span>
      </div>
      {items.map((item) => {
        const product = products.find((p) => String(p.id) === String(item.productId))
        return (
          <LineItemRow
            key={String(item.id)}
            item={item}
            product={product}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
        )
      })}
    </div>
  )
}
