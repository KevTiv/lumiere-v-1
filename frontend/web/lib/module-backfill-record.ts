import type { HistoryFieldDiffRow } from '@lumiere/ui/entity-views/history-field-diff'
import type { BackfillModule } from './module-backfill-navigation'

export const moduleBackfillRecordKind = {
  sales: 'sales',
  shop_sales: 'shop_sale',
  warehouse: 'warehouse',
} as const satisfies Record<BackfillModule, string>

type Facts =
  | ({
      product: string
      quantity: string
      unit: string | null
      unitPrice: string
      amount: string
      currency: string
    } & (
      | { kind: 'sales'; customer: string; sourceCustomer?: string; reportedPayment: string | null }
      | { kind: 'shop_sale'; shop: string }
    ))
  | {
      kind: 'warehouse'
      product: string
      pieces: string
      kilograms: string
      location: string | null
    }

export type ModuleBackfillRecord = {
  id: string
  batchId: string
  itemId: string
  sourceRevision: number
  sourceFile: string
  sourceRow: number
  periodStart: string
  periodEnd: string
  savedAt?: string
  facts: Facts
}

const labels = {
  customer: 'moduleRecords.customer',
  shop: 'moduleRecords.shop',
  sourceCustomer: 'moduleRecords.sourceCustomer',
  product: 'moduleRecords.product',
  quantity: 'moduleRecords.quantity',
  unit: 'moduleRecords.unit',
  unitPrice: 'moduleRecords.unitPrice',
  amount: 'moduleRecords.reportedTotal',
  currency: 'moduleRecords.currency',
  reportedPayment: 'moduleRecords.paymentComment',
  pieces: 'moduleRecords.pieces',
  kilograms: 'moduleRecords.kilograms',
  location: 'moduleRecords.location',
} as const

type Field = keyof typeof labels
type Value = string | null | undefined

/** Each save creates a historical observation with its own recorded values. */
export function moduleBackfillSavedFields(
  facts: Facts,
  translate: (key: (typeof labels)[Field]) => string,
): HistoryFieldDiffRow[] {
  const fields: [Field, Value][] =
    facts.kind === 'warehouse'
      ? [
          ['product', facts.product],
          ['pieces', facts.pieces],
          ['kilograms', facts.kilograms],
          ['location', facts.location],
        ]
      : [
          ...(facts.kind === 'sales'
            ? [['customer', facts.customer], ['sourceCustomer', facts.sourceCustomer]] satisfies [Field, Value][]
            : [['shop', facts.shop]] satisfies [Field, Value][]),
          ['product', facts.product],
          ['quantity', facts.quantity],
          ['unit', facts.unit],
          ['unitPrice', facts.unitPrice],
          ['amount', facts.amount],
          ['currency', facts.currency],
          ...(facts.kind === 'sales'
            ? [['reportedPayment', facts.reportedPayment]] satisfies [Field, Value][]
            : []),
        ]
  return fields.map(([id, value]) => ({
    id,
    label: translate(labels[id]),
    before: { kind: 'absent' },
    after:
      value === undefined ? { kind: 'unavailable' } : { kind: 'value', value },
  }))
}
