/**
 * Compile-only — generic stdb BFF helpers accept arbitrary reducer names.
 */
import { stdbBffCallUrl, stdbBffPost, stdbCommandContract } from "../commands/stdb-http";

void stdbBffCallUrl("confirm_sale_order");
void stdbBffPost("confirm_sale_order", [1n, 2n]);
void stdbCommandContract("confirm_sale_order");
