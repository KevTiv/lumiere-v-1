/**
 * Compile-only — POS BFF reducer keys stay aligned with `posBffCallUrl`.
 */
import {
  POS_BFF_REDUCERS,
  posBffCallUrl,
  posCommandContract,
} from "../commands/pos-http";

for (const k of POS_BFF_REDUCERS) {
  void posBffCallUrl(k);
  void posCommandContract(k);
}
