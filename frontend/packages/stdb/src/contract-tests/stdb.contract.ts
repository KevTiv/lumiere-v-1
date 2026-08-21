/**
 * Compile-only — generic stdb BFF helpers accept arbitrary reducer names.
 */
import { stdbBffCallUrl, stdbBffPost, stdbCommandContract } from "../commands/stdb-http";

void stdbBffCallUrl("confirm_sales_order");
void stdbBffPost("confirm_sales_order", [1n, 2n]);
void stdbCommandContract("confirm_sales_order");

// @ts-expect-error reducer names absent from the exposure manifest are rejected.
void stdbBffPost("confirm_sale_order", [1n, 2n]);
