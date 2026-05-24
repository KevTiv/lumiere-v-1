/**
 * Compile-only — Subscriptions BFF reducer keys stay aligned with `subscriptionsBffCallUrl`.
 */
import {
  SUBSCRIPTIONS_BFF_REDUCERS,
  subscriptionsBffCallUrl,
  subscriptionsCommandContract,
} from "../commands/subscriptions-http";

for (const k of SUBSCRIPTIONS_BFF_REDUCERS) {
  void subscriptionsBffCallUrl(k);
  void subscriptionsCommandContract(k);
}
