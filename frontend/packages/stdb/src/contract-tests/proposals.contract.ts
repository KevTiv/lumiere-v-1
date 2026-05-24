/**
 * Compile-only — Proposals BFF reducer keys stay aligned with `proposalsBffCallUrl`.
 */
import {
  PROPOSALS_BFF_REDUCERS,
  proposalsBffCallUrl,
  proposalsCommandContract,
} from "../commands/proposals-http";

for (const k of PROPOSALS_BFF_REDUCERS) {
  void proposalsBffCallUrl(k);
  void proposalsCommandContract(k);
}
