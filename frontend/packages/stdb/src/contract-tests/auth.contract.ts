/**
 * Compile-only — Auth BFF reducer keys stay aligned with `authBffCallUrl`.
 */
import {
  AUTH_BFF_REDUCERS,
  authBffCallUrl,
  authCommandContract,
} from "../commands/auth-http";

for (const k of AUTH_BFF_REDUCERS) {
  void authBffCallUrl(k);
  void authCommandContract(k);
}
