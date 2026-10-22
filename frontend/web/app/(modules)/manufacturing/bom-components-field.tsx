"use client"

import { useTranslation } from "@lumiere/i18n"
import type { CustomField } from "@lumiere/ui/lib/form-types"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type BomComponentOption = { id: string; label: string; uomId: string }
export type BomComponentValue = { productId: string; productQty: string; productUomId: string; sequence: number }

export function createBomComponentsField(products: readonly BomComponentOption[]) {
  return function BomComponentsField({ value, onChange }: {
    field: CustomField
    value: unknown
    onChange: (value: unknown) => void
    error?: string
  }) {
    const { t } = useTranslation()
    const lines = Array.isArray(value) ? value as BomComponentValue[] : []
    const update = (index: number, changes: Partial<BomComponentValue>) =>
      onChange(lines.map((line, candidate) => candidate === index ? { ...line, ...changes } : line))
    return (
      <div className="space-y-3" data-testid="bom-components">
        {lines.map((line, index) => (
          <div key={index} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              {t("manufacturing.forms.newBom.components.product")}
              <Select value={line.productId} onValueChange={(value) => {
                  const matches = products.filter((product) => product.id === value)
                  update(index, { productId: value, productUomId: matches.length === 1 ? matches[0]!.uomId : "" })
                }}>
                <SelectTrigger data-testid={`bom-component-product-${index}`}>
                  <SelectValue placeholder={t("manufacturing.forms.newBom.components.selectProduct")} />
                </SelectTrigger>
                <SelectContent>
                  {products.map((product) => <SelectItem key={product.id} value={product.id}>{product.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              {t("manufacturing.forms.newBom.components.quantity")}
              <input
                data-testid={`bom-component-quantity-${index}`}
                className="w-28 rounded-md border bg-background p-2"
                type="number" min="0.0001" step="any" value={line.productQty}
                onChange={(event) => update(index, { productQty: event.target.value })}
              />
            </label>
            <button type="button" className="rounded-md border p-2" data-testid={`bom-component-remove-${index}`}
              onClick={() => onChange(lines.filter((_, candidate) => candidate !== index))}>
              {t("manufacturing.forms.newBom.components.remove")}
            </button>
          </div>
        ))}
        <button type="button" className="rounded-md border p-2" data-testid="bom-component-add"
          onClick={() => onChange([...lines, { productId: "", productQty: "1", productUomId: "", sequence: (lines.length + 1) * 10 }])}>
          {t("manufacturing.forms.newBom.components.add")}
        </button>
      </div>
    )
  }
}
