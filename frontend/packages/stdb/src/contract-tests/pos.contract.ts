/**
 * Compile-only — POS BFF reducer keys stay aligned with command metadata.
 */
import {
  POS_BFF_REDUCERS,
  posCommandContract,
} from "../commands/pos-http";

for (const k of POS_BFF_REDUCERS) {
  void posCommandContract(k);
}
