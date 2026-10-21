import { variantTag } from '@lumiere/erp-workflows';

type Row = Record<string, unknown>;

/** `add_purchase_requisition_line` accepts lines only while the requisition is a draft. */
export function requisitionCanAddLine(requisition: Row): boolean {
  return variantTag(requisition.state) === 'Draft';
}

export type RequisitionLineInput = {
  productId: bigint;
  productUom: bigint;
  productUomQty: number;
  name: string | null;
};

function idOf(value: unknown): bigint | null {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text) ? BigInt(text) : null;
}

/** Form values to the reducer args; null when the product, unit or a positive quantity is missing. */
export function toRequisitionLineInput(values: Row | null | undefined): RequisitionLineInput | null {
  if (values == null) return null;
  const productId = idOf(values.productId);
  const productUom = idOf(values.uomId);
  const productUomQty = Number(values.quantity);
  if (productId == null || productUom == null || !Number.isFinite(productUomQty) || productUomQty <= 0) return null;
  const name = String(values.name ?? '').trim();
  return { productId, productUom, productUomQty, name: name === '' ? null : name };
}
