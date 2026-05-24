/**
 * Compile-only — Manufacturing BFF reducer keys stay aligned with `manufacturingBffCallUrl`.
 */
import {
  MANUFACTURING_BFF_REDUCERS,
  manufacturingBffCallUrl,
  manufacturingCommandContract,
} from "../commands/manufacturing-http";

for (const k of MANUFACTURING_BFF_REDUCERS) {
  void manufacturingBffCallUrl(k);
  void manufacturingCommandContract(k);
}
