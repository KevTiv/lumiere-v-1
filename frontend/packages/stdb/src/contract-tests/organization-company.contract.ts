/**
 * Compile-only — organization/company BFF reducer keys stay aligned with command metadata.
 */
import {
  ORGANIZATION_COMPANY_BFF_REDUCERS,
  organizationCompanyCommandContract,
} from "../commands/organization-company-http";

for (const k of ORGANIZATION_COMPANY_BFF_REDUCERS) {
  void organizationCompanyCommandContract(k);
}
