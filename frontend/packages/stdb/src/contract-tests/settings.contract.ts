/**
 * Compile-only — settings BFF reducer keys stay aligned with command metadata.
 */
import {
  SETTINGS_BFF_REDUCERS,
  settingsCommandContract,
} from "../commands/settings-http";

for (const k of SETTINGS_BFF_REDUCERS) {
  void settingsCommandContract(k);
}
