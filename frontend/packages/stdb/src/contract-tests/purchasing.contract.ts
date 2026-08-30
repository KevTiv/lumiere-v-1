/**
 * Compile-only — Purchasing BFF reducer keys stay aligned with command metadata.
 */
import {
  PURCHASING_BFF_REDUCERS,
  purchasingCommandContract,
} from "../commands/purchasing-http";

for (const k of PURCHASING_BFF_REDUCERS) {
  void purchasingCommandContract(k);
}
