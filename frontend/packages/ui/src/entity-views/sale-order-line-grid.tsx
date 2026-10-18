"use client"

import { useMemo, useState } from "react"
import { Plus, Trash2 } from "lucide-react"

import { Button } from "../components/button"
import { EditableNumber } from "../components/editable-number"
import { Input } from "../components/input"
import { RecordPicker } from "../components/record-picker"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/alert-dialog"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "../components/table"
import { lineAmounts, orderTotals, type LineEdit } from "../lib/sale-order-line-totals"
import { useEntityTable } from "./use-entity-table"

type LineRow = Record<string, unknown>

export interface LineGridProduct {
  id: string
  label: string
  /** Unit of measure the product is sold in; a line cannot be added without one. */
  uomId?: string
  listPrice?: number
}

export interface NewLine {
  productId: string
  uomId: string
  quantity: number
  /** Left out to take the price from the order's pricelist. */
  priceUnit?: number
  discount: number
}

export interface SaleOrderLineGridProps {
  lines: ReadonlyArray<LineRow>
  products: ReadonlyArray<LineGridProduct>
  /** Whether lines can be changed: an unlocked quotation. The server still has the last word. */
  editable: boolean
  onUpdateLine: (lineId: string, patch: LineEdit) => Promise<void>
  onCreateLine: (line: NewLine) => Promise<void>
  onDeleteLine: (lineId: string) => Promise<void>
  testIdPrefix?: string
}

const COLUMNS = [
  { key: "sequence", label: "#" },
  { key: "id", label: "ID" },
]
// Lines read in the order they were entered, not newest first like a list of orders.
const ENTRY_ORDER = [
  { id: "sequence", desc: false },
  { id: "id", desc: false },
]
const NO_FILTERS = {}
const ALL_LINES = 100_000

const money = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function num(row: LineRow, ...keys: string[]): number {
  for (const key of keys) {
    const value = Number(row[key])
    if (row[key] != null && Number.isFinite(value)) return value
  }
  return 0
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The lines of a sale order as a grid: change a quantity, price or discount in place, add a line by
 * picking a product, remove one, and watch the totals follow. Saving is the caller's job; this only
 * collects the change and reports a failure on the row it belongs to.
 */
export function SaleOrderLineGrid({
  lines,
  products,
  editable,
  onUpdateLine,
  onCreateLine,
  onDeleteLine,
  testIdPrefix = "sale-order-lines",
}: SaleOrderLineGridProps) {
  const { sortedRows } = useEntityTable({
    columns: COLUMNS,
    data: lines as LineRow[],
    rowKey: "id",
    pageSize: ALL_LINES,
    search: "",
    filters: NO_FILTERS,
    defaultSorting: ENTRY_ORDER,
  })

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products])
  const [drafts, setDrafts] = useState<Record<string, LineEdit>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [deleting, setDeleting] = useState<LineRow | null>(null)
  const totals = orderTotals(sortedRows, drafts)

  const setDraft = (lineId: string, field: keyof LineEdit, value: number | null) =>
    setDrafts((previous) => {
      const next = { ...previous, [lineId]: { ...previous[lineId] } }
      if (value == null) delete next[lineId]![field]
      else next[lineId]![field] = value
      if (Object.keys(next[lineId]!).length === 0) delete next[lineId]
      return next
    })

  const update = async (lineId: string, field: keyof LineEdit, value: number) => {
    setRowErrors(({ [lineId]: _cleared, ...rest }) => rest)
    try {
      await onUpdateLine(lineId, { [field]: value })
    } catch (error) {
      setRowErrors((previous) => ({ ...previous, [lineId]: messageOf(error) }))
      throw error
    }
  }

  return (
    <div className="space-y-3" data-testid={testIdPrefix}>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <Table>
          <TableHeader className="bg-muted/25">
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Unit price</TableHead>
              <TableHead className="text-right">Discount %</TableHead>
              <TableHead className="text-right">Subtotal</TableHead>
              {editable ? <TableHead className="w-10" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={editable ? 7 : 6} className="py-8 text-center text-sm text-muted-foreground">
                  No lines yet
                </TableCell>
              </TableRow>
            ) : null}
            {sortedRows.map((line) => {
              const id = String(line.id)
              const product = productById.get(String(line.productId ?? line.product_id ?? ""))
              const label = product?.label ?? String(line.name ?? `Product ${line.productId ?? ""}`)
              const amounts = lineAmounts(line, drafts[id])
              return (
                <TableRow key={id} data-testid={`${testIdPrefix}-row-${id}`}>
                  <TableCell className="font-medium">{label}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {String(line.name ?? "")}
                    {rowErrors[id] ? (
                      <p role="alert" className="text-xs text-destructive" data-testid={`${testIdPrefix}-error-${id}`}>
                        {rowErrors[id]}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <EditableNumber
                      aria-label={`Quantity of ${label}`}
                      data-testid={`${testIdPrefix}-qty-${id}`}
                      value={num(line, "productUomQty", "product_uom_qty")}
                      min={0.0001}
                      step={1}
                      disabled={!editable}
                      onDraft={(value) => setDraft(id, "quantity", value)}
                      onCommit={(value) => update(id, "quantity", value)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <EditableNumber
                      aria-label={`Unit price of ${label}`}
                      data-testid={`${testIdPrefix}-price-${id}`}
                      value={num(line, "priceUnit", "price_unit")}
                      min={0}
                      step={0.01}
                      disabled={!editable}
                      onDraft={(value) => setDraft(id, "priceUnit", value)}
                      onCommit={(value) => update(id, "priceUnit", value)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <EditableNumber
                      aria-label={`Discount of ${label}`}
                      data-testid={`${testIdPrefix}-discount-${id}`}
                      value={num(line, "discount")}
                      min={0}
                      max={100}
                      step={0.5}
                      disabled={!editable}
                      onDraft={(value) => setDraft(id, "discount", value)}
                      onCommit={(value) => update(id, "discount", value)}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums" data-testid={`${testIdPrefix}-subtotal-${id}`}>
                    {money.format(amounts.subtotal)}
                  </TableCell>
                  {editable ? (
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${label}`}
                        data-testid={`${testIdPrefix}-delete-${id}`}
                        onClick={() => setDeleting(line)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              )
            })}
          </TableBody>
          <TableFooter>
            <TotalRow label="Untaxed" value={totals.subtotal} testId={`${testIdPrefix}-untaxed`} editable={editable} />
            <TotalRow label="Taxes" value={totals.tax} testId={`${testIdPrefix}-tax`} editable={editable} />
            <TotalRow
              label={totals.estimated ? "Total (estimated until saved)" : "Total"}
              value={totals.total}
              testId={`${testIdPrefix}-total`}
              editable={editable}
              strong
            />
          </TableFooter>
        </Table>
      </div>

      {editable ? <AddLineRow products={products} onCreate={onCreateLine} testIdPrefix={testIdPrefix} /> : null}

      <AlertDialog open={deleting != null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent data-testid={`${testIdPrefix}-delete-confirm`}>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this line?</AlertDialogTitle>
            <AlertDialogDescription>
              The order's totals are recalculated without it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const line = deleting
                setDeleting(null)
                if (!line) return
                const id = String(line.id)
                onDeleteLine(id).catch((error) => setRowErrors((previous) => ({ ...previous, [id]: messageOf(error) })))
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** A totals line: the label runs under the first five columns, the amount sits under Subtotal. */
function TotalRow({
  label,
  value,
  testId,
  editable,
  strong,
}: {
  label: string
  value: number
  testId: string
  editable: boolean
  strong?: boolean
}) {
  return (
    <TableRow className={strong ? "font-semibold" : undefined}>
      <TableCell colSpan={5} className="text-right">
        {label}
      </TableCell>
      <TableCell className="text-right tabular-nums" data-testid={testId}>
        {money.format(value)}
      </TableCell>
      {editable ? <TableCell /> : null}
    </TableRow>
  )
}

function AddLineRow({
  products,
  onCreate,
  testIdPrefix,
}: {
  products: ReadonlyArray<LineGridProduct>
  onCreate: (line: NewLine) => Promise<void>
  testIdPrefix: string
}) {
  const [productId, setProductId] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [price, setPrice] = useState("")
  const [discount, setDiscount] = useState("0")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const product = products.find((candidate) => candidate.id === productId)
  const quantityValue = Number(quantity)
  const discountValue = discount.trim() === "" ? 0 : Number(discount)
  const priceValue = price.trim() === "" ? undefined : Number(price)
  const problem =
    !product
      ? "Pick a product"
      : !product.uomId
        ? "This product has no unit of measure"
        : !(quantityValue > 0)
          ? "Quantity must be above zero"
          : priceValue != null && !(priceValue >= 0)
            ? "Price cannot be negative"
            : !(discountValue >= 0 && discountValue <= 100)
              ? "Discount is a percentage from 0 to 100"
              : null

  const add = async () => {
    if (problem || !product?.uomId) return
    setSaving(true)
    setError(null)
    try {
      await onCreate({
        productId: product.id,
        uomId: product.uomId,
        quantity: quantityValue,
        priceUnit: priceValue,
        discount: discountValue,
      })
      setProductId("")
      setQuantity("1")
      setPrice("")
      setDiscount("0")
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-dashed border-border p-3" data-testid={`${testIdPrefix}-add`}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Product</label>
          <RecordPicker
            value={productId}
            onChange={setProductId}
            options={products.map((candidate) => ({ value: candidate.id, label: candidate.label }))}
            placeholder="Add a product…"
            searchPlaceholder="Search products…"
            emptyText="No products match"
            disabled={saving}
            data-testid={`${testIdPrefix}-add-product`}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${testIdPrefix}-add-qty`} className="text-xs font-medium text-muted-foreground">
            Quantity
          </label>
          <Input
            id={`${testIdPrefix}-add-qty`}
            type="number"
            min={0}
            step={1}
            value={quantity}
            disabled={saving}
            className="h-8 w-24 text-right"
            data-testid={`${testIdPrefix}-add-qty`}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${testIdPrefix}-add-price`} className="text-xs font-medium text-muted-foreground">
            Unit price
          </label>
          <Input
            id={`${testIdPrefix}-add-price`}
            type="number"
            min={0}
            step={0.01}
            value={price}
            disabled={saving}
            placeholder={
              product?.listPrice != null ? `List ${money.format(product.listPrice)}` : "From pricelist"
            }
            className="h-8 w-32 text-right"
            data-testid={`${testIdPrefix}-add-price`}
            onChange={(event) => setPrice(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${testIdPrefix}-add-discount`} className="text-xs font-medium text-muted-foreground">
            Discount %
          </label>
          <Input
            id={`${testIdPrefix}-add-discount`}
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={discount}
            disabled={saving}
            className="h-8 w-24 text-right"
            data-testid={`${testIdPrefix}-add-discount`}
            onChange={(event) => setDiscount(event.target.value)}
          />
        </div>
        <Button
          type="button"
          size="sm"
          disabled={saving || problem != null}
          title={problem ?? undefined}
          data-testid={`${testIdPrefix}-add-submit`}
          onClick={() => void add()}
        >
          <Plus className="mr-1 h-4 w-4" />
          Add line
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Leave the price empty to use the order's pricelist. Taxes are applied when the line is saved.
      </p>
      {error ? (
        <p role="alert" className="text-xs text-destructive" data-testid={`${testIdPrefix}-add-error`}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
