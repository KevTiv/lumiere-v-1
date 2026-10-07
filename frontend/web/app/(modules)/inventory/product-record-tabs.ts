import { field, idListOf, idOf, isRowActive, numberOf, textOf, type ReadRow } from '@/lib/row-field';

export interface VariantLineRow {
  id: string;
  attribute: string | null;
  values: string | null;
  valueCount: number;
}

export interface VendorPriceRow {
  id: string;
  vendor: string | null;
  vendorProductName: string | null;
  vendorProductCode: string | null;
  minQty: number | null;
  price: number | null;
  currency: string | null;
  delay: number | null;
  dateStart: unknown;
  dateEnd: unknown;
}

export interface PackagingRow {
  id: string;
  name: string | null;
  qty: number | null;
  barcode: string | null;
  sales: boolean;
  purchase: boolean;
  weight: number | null;
  volume: number | null;
}

function byId(rows: ReadonlyArray<ReadRow>, labelOf: (row: ReadRow) => string | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const id = idOf(row, 'id');
    const label = labelOf(row);
    if (id != null && label != null) map.set(id, label);
  }
  return map;
}

/**
 * Attribute lines of one product template with the value names each line offers.
 * Unknown attributes/values are left out (never shown as a raw id); inactive lines are skipped.
 */
export function variantLinesForTemplate(
  templateId: unknown,
  lines: ReadonlyArray<ReadRow>,
  attributes: ReadonlyArray<ReadRow>,
  values: ReadonlyArray<ReadRow>,
): VariantLineRow[] {
  if (templateId == null) return [];
  const wanted = String(templateId);
  const attributeName = byId(attributes, (row) => textOf(row, 'name'));
  const valueName = byId(values, (row) => textOf(row, 'name'));
  const sequence = new Map<string, number>();
  for (const row of attributes) {
    const id = idOf(row, 'id');
    if (id != null) sequence.set(id, numberOf(row, 'sequence') ?? 0);
  }
  return lines
    .filter((line) => idOf(line, 'productTmplId') === wanted && isRowActive(line, 'active'))
    .map((line) => {
      const attributeId = idOf(line, 'attributeId');
      const names = idListOf(line, 'valueIds')
        .map((id) => valueName.get(id))
        .filter((name): name is string => name != null);
      return {
        id: String(field(line, 'id')),
        attribute: attributeId != null ? (attributeName.get(attributeId) ?? null) : null,
        values: names.length > 0 ? names.join(', ') : null,
        valueCount: names.length,
        order: attributeId != null ? (sequence.get(attributeId) ?? 0) : 0,
      };
    })
    .sort((a, b) => a.order - b.order || String(a.attribute ?? '').localeCompare(String(b.attribute ?? '')))
    .map(({ order: _order, ...rest }) => rest);
}

/**
 * Vendor price lines of one product template, cheapest minimum quantity first.
 * `vendorNameById` comes from the module's partner lookup; `currencyCodeById` from currencies.
 */
export function vendorPricesForTemplate(
  templateId: unknown,
  infos: ReadonlyArray<ReadRow>,
  vendorNameById: ReadonlyMap<string, string>,
  currencyCodeById: ReadonlyMap<string, string>,
): VendorPriceRow[] {
  if (templateId == null) return [];
  const wanted = String(templateId);
  return infos
    .filter((info) => idOf(info, 'productTmplId') === wanted && isRowActive(info, 'isActive', 'active'))
    .map((info) => {
      const partnerId = idOf(info, 'partnerId');
      const currencyId = idOf(info, 'currencyId');
      return {
        id: String(field(info, 'id')),
        vendor: partnerId != null ? (vendorNameById.get(partnerId) ?? null) : null,
        vendorProductName: textOf(info, 'productName'),
        vendorProductCode: textOf(info, 'productCode'),
        minQty: numberOf(info, 'minQty'),
        price: numberOf(info, 'price'),
        currency: currencyId != null ? (currencyCodeById.get(currencyId) ?? null) : null,
        delay: numberOf(info, 'delay'),
        dateStart: field(info, 'dateStart') ?? null,
        dateEnd: field(info, 'dateEnd') ?? null,
        sequence: numberOf(info, 'sequence') ?? 0,
      };
    })
    .sort((a, b) => a.sequence - b.sequence || (a.minQty ?? 0) - (b.minQty ?? 0))
    .map(({ sequence: _sequence, ...rest }) => rest);
}

/** Packagings of one product, by sequence. */
export function packagingsForProduct(productId: unknown, packagings: ReadonlyArray<ReadRow>): PackagingRow[] {
  if (productId == null) return [];
  const wanted = String(productId);
  return packagings
    .filter((row) => idOf(row, 'productId') === wanted)
    .sort((a, b) => (numberOf(a, 'sequence') ?? 0) - (numberOf(b, 'sequence') ?? 0))
    .map((row) => ({
      id: String(field(row, 'id')),
      name: textOf(row, 'name'),
      qty: numberOf(row, 'qty'),
      barcode: textOf(row, 'barcode'),
      sales: field(row, 'sales') === true,
      purchase: field(row, 'purchase') === true,
      weight: numberOf(row, 'weight'),
      volume: numberOf(row, 'volume'),
    }));
}

/** Picker label for a vendor price line: product, vendor, minimum quantity, price (absent parts are dropped). */
export function vendorPriceOptionLabel(
  row: ReadRow,
  vendorNameById: ReadonlyMap<string, string>,
  productNameById: ReadonlyMap<string, string> = new Map(),
): string {
  const templateId = idOf(row, 'productTmplId');
  const product = templateId != null ? productNameById.get(templateId) : undefined;
  const partnerId = idOf(row, 'partnerId');
  const vendor = partnerId != null ? vendorNameById.get(partnerId) : undefined;
  const minQty = numberOf(row, 'minQty');
  const price = numberOf(row, 'price');
  return [product, vendor, minQty != null ? `min ${minQty}` : null, price != null ? `@ ${price}` : null]
    .filter((part): part is string => part != null)
    .join(' · ');
}

/** Picker label for a packaging: its name, quantity and product (absent parts are dropped). */
export function packagingOptionLabel(row: ReadRow, productNameById: ReadonlyMap<string, string> = new Map()): string {
  const productId = idOf(row, 'productId');
  const product = productId != null ? productNameById.get(productId) : undefined;
  const qty = numberOf(row, 'qty');
  return [textOf(row, 'name'), qty != null ? `x${qty}` : null, product]
    .filter((part): part is string => part != null)
    .join(' · ');
}
