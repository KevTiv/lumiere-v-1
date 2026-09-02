/**
 * Compile-only — Proposals BFF reducer keys stay aligned with command metadata.
 */
import {
  PROPOSALS_BFF_REDUCERS,
  proposalsCommandContract,
} from "../commands/proposals-http";

for (const k of PROPOSALS_BFF_REDUCERS) {
  void proposalsCommandContract(k);
}
