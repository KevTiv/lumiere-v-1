import { ownerQueueRoutes, type OwnerQueue } from "@lumiere/erp-shared/record-links";
import { normalizedTag } from "@lumiere/erp-workflows";
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
