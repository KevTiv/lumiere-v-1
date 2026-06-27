import { buildCanonicalCsv, type ColumnMappingMap } from "./csv-import-transform"

export type ImportBundleDefinition = {
  key: string
  parentEntity: string
  lineEntity: string
  /** Canonical parent field used to group rows (e.g. client_order_ref). */
  parentLinkField: string
  /** Aliases for detecting the parent link source column in flat CSV. */
  parentLinkAliases: readonly string[]
  /** Line reducer field populated after parent import. */
  lineOrderIdField: string
}

export const SALE_ORDER_IMPORT_BUNDLE: ImportBundleDefinition = {
  key: "sale_order_bundle",
  parentEntity: "sale_order",
  lineEntity: "sale_order_line",
  parentLinkField: "client_order_ref",
  parentLinkAliases: ["client_order_ref", "reference", "order_ref", "orderref", "po", "so_number"],
  lineOrderIdField: "order_id",
}

export const IMPORT_BUNDLES: readonly ImportBundleDefinition[] = [SALE_ORDER_IMPORT_BUNDLE]

export function importBundleForParentEntity(
  parentEntity: string,
): ImportBundleDefinition | undefined {
  return IMPORT_BUNDLES.find((bundle) => bundle.parentEntity === parentEntity)
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
}

export function detectParentLinkSourceColumn(
  headers: string[],
  mapping: ColumnMappingMap,
  bundle: ImportBundleDefinition,
): string | undefined {
  for (const [source, target] of Object.entries(mapping)) {
    if (target === bundle.parentLinkField) return source
  }
  for (const header of headers) {
    const normalized = normalizeHeader(header)
    if (bundle.parentLinkAliases.some((alias) => normalizeHeader(alias) === normalized)) {
      return header
    }
  }
  return undefined
}

export type SplitImportBundleArgs = {
  headers: string[]
  rows: string[][]
  parentMapping: ColumnMappingMap
  lineMapping: ColumnMappingMap
  parentLinkSourceColumn: string
}

export type SplitImportBundleResult = {
  parentHeaders: string[]
  parentRows: string[][]
  lineHeaders: string[]
  lineRows: string[][]
  parentLinkValues: string[]
}

/** Split a flat CSV into deduplicated parent rows and line rows linked by parent ref. */
export function splitImportBundleCsv(args: SplitImportBundleArgs): SplitImportBundleResult {
  const { headers, rows, parentMapping, lineMapping, parentLinkSourceColumn } = args
  const headerIndex = Object.fromEntries(headers.map((header, index) => [header, index]))
  const linkIndex = headerIndex[parentLinkSourceColumn]
  if (linkIndex == null) {
    throw new Error(`Parent link column "${parentLinkSourceColumn}" not found in CSV headers`)
  }

  const parentHeaders = [...headers]
  const parentRows: string[][] = []
  const lineHeaders = [...headers, "__parent_ref"]
  const lineRows: string[][] = []
  const parentLinkValues: string[] = []
  const seenParentKeys = new Set<string>()

  for (const row of rows) {
    const linkValue = (row[linkIndex] ?? "").trim()
    if (!linkValue) continue

    if (!seenParentKeys.has(linkValue)) {
      seenParentKeys.add(linkValue)
      parentLinkValues.push(linkValue)
      parentRows.push([...row])
    }

    if (Object.keys(lineMapping).length > 0) {
      lineRows.push([...row, linkValue])
    }
  }

  return { parentHeaders, parentRows, lineHeaders, lineRows, parentLinkValues }
}

export function buildBundleParentCsv(
  headers: string[],
  rows: string[][],
  parentMapping: ColumnMappingMap,
): string {
  return buildCanonicalCsv(headers, rows, parentMapping)
}

export function buildBundleLineCsv(
  headers: string[],
  lineRows: string[][],
  lineMapping: ColumnMappingMap,
  orderIdByRef: Map<string, string>,
  bundle: ImportBundleDefinition,
): string {
  const augmentedHeaders = [...headers, bundle.lineOrderIdField]
  const augmentedRows: string[][] = []

  for (const row of lineRows) {
    const ref = (row[headers.length] ?? "").trim()
    const orderId = orderIdByRef.get(ref)
    if (!orderId) continue
    augmentedRows.push([...row.slice(0, headers.length), orderId])
  }

  return buildCanonicalCsv(augmentedHeaders, augmentedRows, {
    ...lineMapping,
    [bundle.lineOrderIdField]: bundle.lineOrderIdField,
  })
}

export type SaleOrderLinkRow = {
  id?: number | string
  clientOrderRef?: string | null
  client_order_ref?: string | null
}

export function buildOrderIdMapFromSaleOrders(
  orders: SaleOrderLinkRow[],
  refs: readonly string[],
): Map<string, string> {
  const refToId = new Map<string, string>()
  for (const order of orders) {
    const ref = String(order.clientOrderRef ?? order.client_order_ref ?? "").trim()
    const id = order.id
    if (ref && id != null) refToId.set(ref, String(id))
  }

  const out = new Map<string, string>()
  for (const ref of refs) {
    const id = refToId.get(ref)
    if (id) out.set(ref, id)
  }
  return out
}

export function partitionMappingsByEntity(
  headers: string[],
  parentMapping: ColumnMappingMap,
  lineMapping: ColumnMappingMap,
): { parentHeaders: string[]; lineHeaders: string[] } {
  const parentHeaders: string[] = []
  const lineHeaders: string[] = []
  for (const header of headers) {
    if (parentMapping[header] && !lineMapping[header]) parentHeaders.push(header)
    else if (lineMapping[header]) lineHeaders.push(header)
    else if (parentMapping[header]) parentHeaders.push(header)
  }
  return { parentHeaders, lineHeaders }
}
