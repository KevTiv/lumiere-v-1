/**
 * Compile-only — organization/company BFF reducer keys stay aligned with `organizationCompanyBffCallUrl`.
 */
import {
  ORGANIZATION_COMPANY_BFF_REDUCERS,
  organizationCompanyBffCallUrl,
  organizationCompanyCommandContract,
} from "../commands/organization-company-http";

for (const k of ORGANIZATION_COMPANY_BFF_REDUCERS) {
  void organizationCompanyBffCallUrl(k);
  void organizationCompanyCommandContract(k);
}
