/**
 * Compile-only — Subscriptions BFF reducer keys stay aligned with command metadata.
 */
import {
  SUBSCRIPTIONS_BFF_REDUCERS,
  subscriptionsCommandContract,
} from "../commands/subscriptions-http";

for (const k of SUBSCRIPTIONS_BFF_REDUCERS) {
  void subscriptionsCommandContract(k);
}
