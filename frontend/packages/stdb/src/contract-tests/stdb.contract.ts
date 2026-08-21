/**
 * Compile-only — generic stdb BFF helpers use generated named inputs.
 */
import {
  stdbBffCallUrl,
  stdbBffCommandPost,
  stdbCommandContract,
} from "../commands/stdb-http";

void stdbBffCallUrl("confirm_sales_order");
void stdbBffCommandPost("confirm_sales_order", { companyId: 1n, orderId: 2n });
void stdbCommandContract("confirm_sales_order");

// @ts-expect-error reducer names absent from the exposure manifest are rejected.
void stdbBffCommandPost("confirm_sale_order", { companyId: 1n, orderId: 2n });
