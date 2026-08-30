/**
 * Compile-only — Manufacturing BFF reducer keys stay aligned with command metadata.
 */
import {
  MANUFACTURING_BFF_REDUCERS,
  manufacturingCommandContract,
} from "../commands/manufacturing-http";

for (const k of MANUFACTURING_BFF_REDUCERS) {
  void manufacturingCommandContract(k);
}
