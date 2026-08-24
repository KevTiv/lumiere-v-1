/**
 * Compile-only — CRM metadata stays aligned with the generated named command transport.
 */
import { CRM_BFF_REDUCERS, crmCommandContract } from "../commands/crm-http";

for (const k of CRM_BFF_REDUCERS) {
  void crmCommandContract(k);
}
