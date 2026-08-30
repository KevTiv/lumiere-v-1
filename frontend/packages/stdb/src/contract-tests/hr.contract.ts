/**
 * Compile-only — HR BFF reducer keys stay aligned with command metadata.
 */
import {
  HR_BFF_REDUCERS,
  hrCommandContract,
} from "../commands/hr-http";

for (const k of HR_BFF_REDUCERS) {
  void hrCommandContract(k);
}
