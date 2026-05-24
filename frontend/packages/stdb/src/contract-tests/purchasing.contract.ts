/**
 * Compile-only — Purchasing BFF reducer keys stay aligned with `purchasingBffCallUrl`.
 */
import {
  PURCHASING_BFF_REDUCERS,
  purchasingBffCallUrl,
  purchasingCommandContract,
} from "../commands/purchasing-http";

for (const k of PURCHASING_BFF_REDUCERS) {
  void purchasingBffCallUrl(k);
  void purchasingCommandContract(k);
}
