import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * Purchasing mutations via Next.js BFF `POST /api/call/:reducer`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` purchasing hooks.
 */
export const PURCHASING_BFF_REDUCERS = [
  "add_landed_cost_line",
  "add_purchase_order_line",
  "apply_landed_costs",
  "approve_purchase_requisition",
  "approve_supplier_intake",
  "cancel_landed_cost",
  "cancel_purchase_order",
  "cancel_purchase_requisition",
  "close_purchase_requisition",
  "compute_landed_costs",
  "compute_purchase_order_line_totals",
  "compute_purchase_order_totals",
  "confirm_purchase_order",
  "create_bill_from_purchase_order",
  "create_landed_cost",
  "create_partner_bank",
  "create_purchase_order",
  "create_purchase_requisition",
  "delete_landed_cost",
  "delete_partner_bank",
  "delete_supplier_intake",
  "hold_supplier_intake",
  "import_purchase_order_csv",
  "import_purchase_order_line_csv",
  "import_supplier_info_csv",
  "invoice_po_line",
  "lock_purchase_order",
  "post_landed_costs",
  "receive_po_line",
  "reject_supplier_intake",
  "remove_landed_cost_line",
  "remove_purchase_order_line",
  "review_supplier_intake",
  "send_purchase_order",
  "submit_purchase_requisition",
  "submit_supplier_intake",
  "unlock_purchase_order",
  "update_landed_cost",
  "update_partner_bank",
  "update_po_invoice_status",
  "update_po_receipt_status",
  "update_purchase_order",
  "update_purchase_order_line",
  "update_supplier_intake",
] as const;

export type PurchasingBffReducerKey = (typeof PURCHASING_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<PurchasingBffReducerKey>();

/** Same-origin path used by `apiFetch` in the web app. */
export function purchasingBffCallUrl(reducer: PurchasingBffReducerKey): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function purchasingBffPost(
  reducer: PurchasingBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: purchasingBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

const PURCHASING_HINT_OVERRIDES: Partial<
  Record<PurchasingBffReducerKey, readonly string[]>
> = {
  add_landed_cost_line: ["landed-costs", "purchase-orders"],
  add_purchase_order_line: ["purchase-orders", "purchase-order-lines"],
  apply_landed_costs: ["landed-costs", "purchase-orders"],
  approve_purchase_requisition: ["purchase-requisitions"],
  approve_supplier_intake: ["supplier-intakes", "contacts"],
  cancel_landed_cost: ["landed-costs", "purchase-orders"],
  cancel_purchase_order: ["purchase-orders"],
  cancel_purchase_requisition: ["purchase-requisitions"],
  close_purchase_requisition: ["purchase-requisitions"],
  compute_landed_costs: ["landed-costs", "purchase-orders"],
  compute_purchase_order_line_totals: ["purchase-orders", "purchase-order-lines"],
  compute_purchase_order_totals: ["purchase-orders", "purchase-order-lines"],
  confirm_purchase_order: ["purchase-orders"],
  create_bill_from_purchase_order: ["purchase-orders", "purchase-order-lines", "account-moves"],
  create_landed_cost: ["landed-costs", "purchase-orders"],
  create_partner_bank: ["partner-banks"],
  create_purchase_order: ["purchase-orders"],
  create_purchase_requisition: ["purchase-requisitions"],
  delete_landed_cost: ["landed-costs", "purchase-orders"],
  delete_partner_bank: ["partner-banks"],
  delete_supplier_intake: ["supplier-intakes", "contacts"],
  hold_supplier_intake: ["supplier-intakes", "contacts"],
  import_purchase_order_csv: ["purchase-orders"],
  import_purchase_order_line_csv: ["purchase-order-lines"],
  import_supplier_info_csv: [],
  invoice_po_line: ["purchase-orders", "purchase-order-lines"],
  lock_purchase_order: ["purchase-orders"],
  post_landed_costs: ["landed-costs", "purchase-orders"],
  receive_po_line: ["purchase-orders", "purchase-order-lines"],
  reject_supplier_intake: ["supplier-intakes", "contacts"],
  remove_landed_cost_line: ["landed-costs", "purchase-orders"],
  remove_purchase_order_line: ["purchase-orders", "purchase-order-lines"],
  review_supplier_intake: ["supplier-intakes", "contacts"],
  send_purchase_order: ["purchase-orders"],
  submit_purchase_requisition: ["purchase-requisitions"],
  submit_supplier_intake: ["supplier-intakes", "contacts"],
  unlock_purchase_order: ["purchase-orders"],
  update_landed_cost: ["landed-costs", "purchase-orders"],
  update_partner_bank: ["partner-banks"],
  update_po_invoice_status: ["purchase-orders"],
  update_po_receipt_status: ["purchase-orders"],
  update_purchase_order: ["purchase-orders"],
  update_purchase_order_line: ["purchase-orders", "purchase-order-lines"],
  update_supplier_intake: ["supplier-intakes", "contacts"],
};

function purchasingReducerHints(): Record<
  PurchasingBffReducerKey,
  readonly string[]
> {
  const o = {} as Record<PurchasingBffReducerKey, readonly string[]>;
  for (const k of PURCHASING_BFF_REDUCERS) {
    o[k] = PURCHASING_HINT_OVERRIDES[k] ?? [];
  }
  return o;
}

export const PURCHASING_COMMAND_SUBSCRIPTION_HINTS: Record<
  PurchasingBffReducerKey,
  readonly string[]
> = purchasingReducerHints();

export function purchasingCommandContract(
  reducer: PurchasingBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Purchasing reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: PURCHASING_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}
