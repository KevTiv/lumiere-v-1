import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * Sales mutations via Next.js BFF `POST /api/call/:reducer`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` sales hooks.
 */
export const SALES_BFF_REDUCERS = [
  "accrue_sale_commission",
  "apply_sale_order_options",
  "apply_sale_promotion_to_order",
  "cancel_picking_batch",
  "cancel_return_order",
  "cancel_sale_commission",
  "cancel_sale_order",
  "complete_picking_batch",
  "compute_so_totals",
  "confirm_return_order",
  "confirm_sales_order",
  "create_credit_note_from_return_order",
  "create_delivery_carrier",
  "create_delivery_price_rule",
  "create_exchange_order_from_return",
  "create_fiscal_position",
  "create_fiscal_position_tax",
  "create_incoterm",
  "create_invoice_from_sale_order",
  "create_loyalty_card",
  "create_loyalty_program",
  "create_payment_method",
  "create_picking_batch",
  "create_pricelist",
  "create_pricelist_item",
  "create_return_order",
  "create_sale_order",
  "create_sale_order_line",
  "create_sale_order_option",
  "create_sale_promotion",
  "create_shipping_method",
  "delete_pricelist",
  "delete_pricelist_item",
  "delete_sale_order_line",
  "delete_sale_order_option",
  "import_sale_order_csv",
  "import_sale_order_line_csv",
  "lock_sale_order",
  "reverse_sale_commission_settlement",
  "send_sale_order_quotation",
  "settle_sale_commissions",
  "start_picking_batch",
  "unlock_sale_order",
  "update_pricelist",
  "update_sale_order",
  "update_sale_order_line",
  "update_sale_order_option",
] as const;

export type SalesBffReducerKey = (typeof SALES_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<SalesBffReducerKey>();

/** Same-origin path used by `apiFetch` in the web app. */
export function salesBffCallUrl(reducer: SalesBffReducerKey): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function salesBffPost(
  reducer: SalesBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: salesBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

/** Mirrors hook invalidation targets where explicit (TanStack uses query keys separately). */
const SALES_HINT_OVERRIDES: Partial<
  Record<SalesBffReducerKey, readonly string[]>
> = {
  cancel_picking_batch: ["picking-batches"],
  cancel_return_order: ["return-orders"],
  cancel_sale_commission: ["sale-commissions"],
  cancel_sale_order: ["sale-orders", "sale-order-lines", "sale-commissions"],
  complete_picking_batch: ["picking-batches"],
  compute_so_totals: ["sale-orders", "sale-order-lines"],
  confirm_return_order: ["return-orders", "stock-pickings", "stock-moves"],
  confirm_sales_order: ["sale-orders", "sale-order-lines", "picking-batches"],
  send_sale_order_quotation: ["sale-orders"],
  settle_sale_commissions: ["sale-commissions", "account-moves"],
  reverse_sale_commission_settlement: ["sale-commissions", "account-moves"],
  create_credit_note_from_return_order: [
    "return-orders",
    "account-moves",
    "sale-commissions",
  ],
  accrue_sale_commission: ["sale-commissions"],
  create_delivery_carrier: ["delivery-carriers"],
  create_delivery_price_rule: ["delivery-price-rules"],
  create_invoice_from_sale_order: ["sale-orders", "account-moves"],
  create_loyalty_card: ["pos-loyalty-cards", "pos-loyalty-programs"],
  create_loyalty_program: ["pos-loyalty-programs"],
  create_payment_method: ["pos-payment-methods"],
  create_picking_batch: ["picking-batches"],
  create_pricelist: ["pricelists"],
  create_pricelist_item: ["pricelists", "pricelist-items"],
  create_return_order: ["return-orders", "return-order-lines"],
  create_sale_order: ["sale-orders"],
  create_sale_order_line: ["sale-order-lines"],
  create_shipping_method: ["shipping-methods"],
  delete_pricelist: ["pricelists", "pricelist-items"],
  delete_pricelist_item: ["pricelists", "pricelist-items"],
  delete_sale_order_line: ["sale-order-lines"],
  import_sale_order_csv: ["sale-orders"],
  import_sale_order_line_csv: ["sale-order-lines"],
  lock_sale_order: ["sale-orders"],
  start_picking_batch: ["picking-batches"],
  unlock_sale_order: ["sale-orders"],
  update_pricelist: ["pricelists"],
  update_sale_order: ["sale-orders", "sale-order-lines"],
  update_sale_order_line: ["sale-order-lines"],
};

function salesReducerHints(): Record<SalesBffReducerKey, readonly string[]> {
  const o = {} as Record<SalesBffReducerKey, readonly string[]>;
  for (const k of SALES_BFF_REDUCERS) {
    o[k] = SALES_HINT_OVERRIDES[k] ?? [];
  }
  return o;
}

export const SALES_COMMAND_SUBSCRIPTION_HINTS: Record<
  SalesBffReducerKey,
  readonly string[]
> = salesReducerHints();

export function salesCommandContract(
  reducer: SalesBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Sales reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: SALES_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}
