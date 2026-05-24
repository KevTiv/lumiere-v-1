/**
 * Compile-only — settings BFF reducer keys stay aligned with `settingsBffCallUrl`.
 */
import {
  SETTINGS_BFF_REDUCERS,
  settingsBffCallUrl,
  settingsCommandContract,
} from "../commands/settings-http";

for (const k of SETTINGS_BFF_REDUCERS) {
  void settingsBffCallUrl(k);
  void settingsCommandContract(k);
}
