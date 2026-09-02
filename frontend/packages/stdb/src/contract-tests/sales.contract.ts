/**
 * Compile-only — Sales BFF reducer keys stay aligned with command metadata.
 */
import {
  SALES_BFF_REDUCERS,
  salesCommandContract,
} from "../commands/sales-http";

for (const k of SALES_BFF_REDUCERS) {
  void salesCommandContract(k);
}
