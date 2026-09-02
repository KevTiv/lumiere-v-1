/**
 * Compile-only — org master CSV import BFF reducer keys stay aligned with command metadata.
 */
import {
  ORG_MASTER_CSV_IMPORTS_BFF_REDUCERS,
  orgMasterCsvImportsCommandContract,
} from "../commands/org-master-csv-imports-http";

for (const k of ORG_MASTER_CSV_IMPORTS_BFF_REDUCERS) {
  void orgMasterCsvImportsCommandContract(k);
}
