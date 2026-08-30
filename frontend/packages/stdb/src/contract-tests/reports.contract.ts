/**
 * Compile-only — Reports BFF reducer keys stay aligned with command metadata.
 */
import {
  REPORTS_BFF_REDUCERS,
  reportsCommandContract,
} from "../commands/reports-http";

for (const k of REPORTS_BFF_REDUCERS) {
  void reportsCommandContract(k);
}
