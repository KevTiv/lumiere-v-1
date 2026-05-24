/**
 * Compile-only — HR BFF reducer keys stay aligned with `hrBffCallUrl`.
 */
import {
  HR_BFF_REDUCERS,
  hrBffCallUrl,
  hrCommandContract,
} from "../commands/hr-http";

for (const k of HR_BFF_REDUCERS) {
  void hrBffCallUrl(k);
  void hrCommandContract(k);
}
