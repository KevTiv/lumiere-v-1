/**
 * Compile-only — Auth BFF reducer keys stay aligned with command metadata.
 */
import {
  AUTH_BFF_REDUCERS,
  authCommandContract,
} from "../commands/auth-http";

for (const k of AUTH_BFF_REDUCERS) {
  void authCommandContract(k);
}
