import { parseStrictU64 } from '@lumiere/erp-shared/u64'

export const SALE_ORDER_RECEIPT_KEY = 'sales_create_receipt'

interface CreatedOrderProjection {
  id?: unknown
  organizationId?: unknown
  organization_id?: unknown
  companyId?: unknown
  company_id?: unknown
  receipt?: unknown
}

function metadataObject(raw: unknown): object {
  if (raw != null && typeof raw === 'object' && 'some' in raw) raw = raw.some
  if (typeof raw !== 'string' || !raw.trim()) return {}
  const parsed: unknown = JSON.parse(raw)
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Quotation metadata must be an object')
  }
  return parsed
}

export function withSaleOrderReceipt(metadata: unknown, receipt: string): string {
  return JSON.stringify({ ...metadataObject(metadata), [SALE_ORDER_RECEIPT_KEY]: receipt })
}

/** Validate the server's creator-scoped lookup, never infer identity from names or recency. */
export function createdSaleOrderId(
  rows: readonly CreatedOrderProjection[], receipt: string, organizationId: bigint, companyId: bigint,
): string | undefined {
  const matches = rows.filter((row) => {
    if (parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId ||
        parseStrictU64(row.companyId ?? row.company_id) !== companyId) return false
    return row.receipt === receipt
  })
  if (matches.length !== 1) return undefined
  const id = parseStrictU64(matches[0]?.id)
  return id != null && id > 0n ? String(id) : undefined
}
