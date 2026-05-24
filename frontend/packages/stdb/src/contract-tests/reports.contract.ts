/**
 * Compile-only — Reports BFF reducer keys stay aligned with `reportsBffCallUrl`.
 */
import {
  REPORTS_BFF_REDUCERS,
  reportsBffCallUrl,
  reportsCommandContract,
} from "../commands/reports-http";

for (const k of REPORTS_BFF_REDUCERS) {
  void reportsBffCallUrl(k);
  void reportsCommandContract(k);
}
