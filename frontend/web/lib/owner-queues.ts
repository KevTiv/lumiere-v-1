import { parseStrictU64 } from "@lumiere/erp-shared/u64";
import { ownerQueueRoutes, type OwnerQueue } from "@lumiere/erp-shared/record-links";
import { normalizedTag } from "@lumiere/erp-workflows";
import { unwrapEntityValue } from "@lumiere/ui/lib/entity-row-values";
import { kpiDate } from "@lumiere/ui/lib/kpi-tiles";

export { ownerQueueHref, ownerQueueRoutes, type OwnerQueue } from "@lumiere/erp-shared/record-links";

export function isOwnerQueue(
  queue: OwnerQueue,
  tab: string,
  value: string | null,
): boolean {
  const route = ownerQueueRoutes[queue];
  return route.tab === tab && route.value === value;
}

export function clearOwnerQueueHref(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete("ownerQueue");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

interface QueueMove {
  state?: unknown;
  moveType?: unknown;
  move_type?: unknown;
  amountResidual?: unknown;
  invoiceDateDue?: unknown;
}

/** A posted customer invoice is overdue only after its UTC due day and while a balance is open. */
export function overduePostedInvoices<Row extends QueueMove>(
  rows: readonly Row[],
  now = new Date(),
): Row[] {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return rows.filter((row) => {
    const residual = row.amountResidual;
    const due = kpiDate(row.invoiceDateDue);
    return (
      normalizedTag(row.state) === "posted" &&
      normalizedTag(row.moveType ?? row.move_type) === "outinvoice" &&
      residual != null &&
      residual !== "" &&
      Number.isFinite(Number(residual)) &&
      Number(residual) > 0 &&
      due != null &&
      due.getTime() < today
    );
  });
}

export function overdueInvoiceInputsComplete(
  rows: readonly QueueMove[],
): boolean {
  return rows.every((row) => {
    const state = normalizedTag(row.state);
    const moveType = normalizedTag(row.moveType ?? row.move_type);
    if (!state || !moveType) return false;
    if (state !== "posted" || moveType !== "outinvoice") return true;
    return (
      row.amountResidual != null &&
      row.amountResidual !== "" &&
      Number.isFinite(Number(row.amountResidual)) &&
      "invoiceDateDue" in row &&
      (row.invoiceDateDue == null || kpiDate(row.invoiceDateDue) != null)
    );
  });
}

export function isDraftVendorBill(row: QueueMove): boolean {
  return (
    normalizedTag(row.moveType ?? row.move_type) === "ininvoice" &&
    normalizedTag(row.state) === "draft"
  );
}

interface QueueStockQuant {
  organizationId?: unknown;
  organization_id?: unknown;
  companyId?: unknown;
  company_id?: unknown;
  productId?: unknown;
  product_id?: unknown;
  availableQuantity?: unknown;
  available_quantity?: unknown;
  isOutdated?: unknown;
  is_outdated?: unknown;
}

interface QueueStockProduct {
  organizationId?: unknown;
  organization_id?: unknown;
  id?: unknown;
  productTmplId?: unknown;
  reorderingMinQty?: unknown;
  reordering_min_qty?: unknown;
}

function quantity(value: unknown): number | null {
  const raw = unwrapEntityValue(value);
  if (typeof raw !== "number" && (typeof raw !== "string" || !raw.trim()))
    return null;
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : null;
}

/** Each matching stock row counts, including distinct locations for the same product. */
export function lowStockQuants<Row extends QueueStockQuant>(
  quants: readonly Row[],
  products: readonly QueueStockProduct[],
  scope: { organizationId: bigint; companyId: bigint | number | null },
): Row[] {
  const companyId = parseStrictU64(scope.companyId);
  if (!companyId || scope.organizationId <= 0n) return [];
  const productsById = new Map<bigint, QueueStockProduct | null>();
  for (const product of products) {
    if (
      parseStrictU64(product.organizationId ?? product.organization_id) !==
      scope.organizationId
    )
      continue;
    const id = parseStrictU64(product.productTmplId ?? product.id);
    if (id) productsById.set(id, productsById.has(id) ? null : product);
  }
  return quants.filter((quant) => {
    if (
      parseStrictU64(quant.organizationId ?? quant.organization_id) !==
        scope.organizationId ||
      parseStrictU64(quant.companyId ?? quant.company_id) !== companyId
    )
      return false;
    const productId = parseStrictU64(quant.productId ?? quant.product_id);
    const product = productId && productsById.get(productId);
    if (!product) return false;
    const outdated = unwrapEntityValue(quant.isOutdated ?? quant.is_outdated);
    if (
      outdated === true ||
      (typeof outdated === "string" && outdated.toLowerCase() === "true")
    )
      return true;
    const available = quantity(
      quant.availableQuantity ?? quant.available_quantity,
    );
    // The canonical product template projection has no reorder minimum.
    const minimum =
      "reorderingMinQty" in product || "reordering_min_qty" in product
        ? quantity(product.reorderingMinQty ?? product.reordering_min_qty)
        : 0;
    return available !== null && minimum !== null && available <= minimum;
  });
}
