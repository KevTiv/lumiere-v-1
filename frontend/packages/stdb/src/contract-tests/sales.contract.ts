/**
 * Compile-only — Sales BFF reducer keys stay aligned with `salesBffCallUrl`.
 */
import {
  SALES_BFF_REDUCERS,
  salesBffCallUrl,
  salesCommandContract,
} from "../commands/sales-http";

for (const k of SALES_BFF_REDUCERS) {
  void salesBffCallUrl(k);
  void salesCommandContract(k);
}
