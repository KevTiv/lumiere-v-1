/**
 * Compile-only — CRM BFF reducer keys stay aligned with `crmBffCallUrl`.
 */
import { CRM_BFF_REDUCERS, crmBffCallUrl, crmCommandContract } from "../commands/crm-http";

for (const k of CRM_BFF_REDUCERS) {
  void crmBffCallUrl(k);
  void crmCommandContract(k);
}
